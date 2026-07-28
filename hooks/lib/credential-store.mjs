/**
 * Shared local credential store for the Crustdata Claude Code plugin.
 *
 * One JSON file — `${CRUSTDATA_CONFIG_DIR:-$HOME/.crustdata}/credentials.json`,
 * mode 0600 — written by the login CLI (`scripts/crustdata-login.mjs`) and read by
 * BOTH consumers of the token:
 *   - the MCP server headers helper (`scripts/crustdata-headers.mjs`)
 *   - the SessionStart skill-sync hook (`hooks/skills-sync.mjs`)
 *
 * Shape (extra fields are preserved on refresh):
 *   {
 *     access_token:  string,        // the Bearer token (Crustdata API key)
 *     refresh_token: string,        // OAuth refresh token
 *     expires_at:    number,        // epoch MILLISECONDS; absent → treated as non-expiring
 *     token_type:    string,        // "Bearer"
 *     token_endpoint?: string,      // persisted at login so refresh needs no re-discovery
 *     client_id?:      string       // ditto (DCR result)
 *   }
 *
 * Zero dependencies (Node built-ins + global fetch), and NOTHING here throws to
 * callers: readStore/getAccessToken return null on any problem, writeStore
 * returns false — a broken credentials file must never break a session hook.
 * Tokens are never logged.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where refresh goes when the store predates `token_endpoint` persistence. */
const DEFAULT_TOKEN_ENDPOINT = "https://install.crustdata.com/token";
/** Refresh this long BEFORE nominal expiry, so an in-flight request can't race it. */
const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TIMEOUT_MS = 10_000;
// Cross-process single-flight for the refresh POST (headers helper + hook both
// start at session start; two POSTs of the SAME refresh token would trip an AS
// that does rotation-reuse detection and revoke the family → forced logout).
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 8_000;
const LOCK_POLL_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A refresh endpoint MUST be https (loopback-http allowed for the local e2e
 * harness). Guards a store whose persisted `token_endpoint` was poisoned at
 * login time (C2): even then, a rotating refresh token can never be POSTed over
 * plaintext or the DEFAULT could never be silently downgraded.
 */
function isSecureUrl(s) {
  let u;
  try {
    u = new URL(String(s));
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1" || u.hostname === "[::1]");
}

/** Resolve the credentials file path from the environment. */
export function credentialsPath(env = process.env) {
  const dir = (env.CRUSTDATA_CONFIG_DIR ?? "").trim() || path.join(os.homedir(), ".crustdata");
  return path.join(dir, "credentials.json");
}

/**
 * Read + shape-check the store. Returns the parsed object or null; never throws.
 * `access_token` must be a non-empty string for the store to count as present.
 */
export function readStore(opts = {}) {
  const { env = process.env } = opts;
  try {
    const doc = JSON.parse(readFileSync(credentialsPath(env), "utf8"));
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
    if (typeof doc.access_token !== "string" || doc.access_token === "") return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Write the store atomically (temp file + rename, same directory) with mode
 * 0600; the config dir is created 0700 on demand. Returns true on success,
 * false on any error — never throws.
 */
export function writeStore(store, opts = {}) {
  const { env = process.env } = opts;
  try {
    const file = credentialsPath(env);
    const dir = path.dirname(file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // mkdir's mode is ignored when the dir already exists, so tighten it
    // explicitly (best-effort) — a pre-existing ~/.crustdata must not leak dir
    // metadata to other local users (C9). The creds file itself is already 0600.
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* best-effort; the 0600 file is the real protection */
    }
    const tmp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** Is this store's token currently valid (unexpired, or non-expiring)? */
function tokenIsFresh(store, now) {
  if (store === null || typeof store.access_token !== "string" || store.access_token === "") return false;
  const expiresAt = Number.isFinite(store.expires_at) ? store.expires_at : null;
  return expiresAt === null || now() < expiresAt - EXPIRY_SKEW_MS;
}

/**
 * Run `fn` while holding an exclusive cross-process lock (an O_EXCL lockfile
 * beside the store). Returns { acquired, result }. If another process holds the
 * lock we poll up to LOCK_WAIT_MS (stealing a lock older than LOCK_STALE_MS,
 * whose holder must have died); if we still can't get it, resolve
 * { acquired: false } so the caller can re-read the store for the holder's
 * freshly-written token. Never throws.
 */
async function withRefreshLock(file, fn) {
  const lock = `${file}.refresh.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, "wx"); // exclusive create — fails if held
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          try {
            unlinkSync(lock);
          } catch {
            /* raced another stealer */
          }
          continue; // retry the acquire
        }
      } catch {
        continue; // lock vanished (released) between open and stat → retry
      }
      if (Date.now() >= deadline) return { acquired: false };
      await sleep(LOCK_POLL_MS);
      continue;
    }
    try {
      return { acquired: true, result: await fn() };
    } finally {
      closeSync(fd);
      try {
        unlinkSync(lock);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Return a currently-valid access token, or null.
 *
 *   - unexpired (or no `expires_at` recorded, e.g. a hand-written raw API key)
 *     → returned as-is, no network;
 *   - expired / within the 60s skew → refreshed at the token endpoint via
 *     `refresh_token`, the rotated tokens are persisted, the new token returned;
 *   - absent store, no refresh token, or refresh failure → null.
 *
 * Never throws. Concurrent refreshes (headers helper + session hook racing at
 * startup) are single-flighted across processes by a lockfile beside the store,
 * so the SAME refresh token is never POSTed twice — an AS with rotation-reuse
 * detection would otherwise revoke the token family and force a logout.
 */
export async function getAccessToken(opts = {}) {
  const { env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = opts;
  try {
    const store = readStore({ env });
    if (store === null) return null;
    if (tokenIsFresh(store, now)) return store.access_token;

    if (typeof store.refresh_token !== "string" || store.refresh_token === "") return null;
    if (typeof fetchImpl !== "function") return null;

    // One POST of the refresh token, across processes. Under the lock we re-read
    // the store first: a racing process may have just refreshed, in which case
    // we return its token and never touch the refresh token at all.
    const file = credentialsPath(env);
    const outcome = await withRefreshLock(file, async () => {
      const current = readStore({ env });
      if (tokenIsFresh(current, now)) return current.access_token;
      return doRefresh(current ?? store, { env, fetchImpl, now });
    });
    if (outcome.acquired) return outcome.result;

    // We couldn't take the lock within the wait window → another process is
    // refreshing. Re-read for its freshly-written token; only if it's still not
    // there do we refresh unlocked (a rare double-refresh beats a failed auth).
    const after = readStore({ env });
    if (tokenIsFresh(after, now)) return after.access_token;
    return doRefresh(after ?? store, { env, fetchImpl, now });
  } catch {
    return null;
  }
}

/** POST the refresh grant, persist the rotated tokens, return the new access token or null. */
async function doRefresh(store, { env, fetchImpl, now }) {
  const tokenEndpoint =
    typeof store.token_endpoint === "string" && store.token_endpoint !== ""
      ? store.token_endpoint
      : DEFAULT_TOKEN_ENDPOINT;
  // C2: never ship a rotating refresh token over an insecure/mismatched transport,
  // even if a poisoned login persisted the endpoint.
  if (!isSecureUrl(tokenEndpoint)) return null;
  if (typeof store.refresh_token !== "string" || store.refresh_token === "") return null;

  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: store.refresh_token });
  if (typeof store.client_id === "string" && store.client_id !== "") form.set("client_id", store.client_id);

  const res = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const tokens = await res.json();
  if (typeof tokens?.access_token !== "string" || tokens.access_token === "") return null;

  const expiresIn = Number(tokens.expires_in);
  const next = {
    ...store,
    access_token: tokens.access_token,
    // The server rotates the refresh token on every grant; keep the old one only
    // if the response somehow omits it (it stays valid server-side).
    refresh_token:
      typeof tokens.refresh_token === "string" && tokens.refresh_token !== "" ? tokens.refresh_token : store.refresh_token,
    expires_at: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_600_000),
    token_type: typeof tokens.token_type === "string" && tokens.token_type !== "" ? tokens.token_type : "Bearer",
  };
  // A failed persist is not fatal for THIS caller — the refreshed token is still
  // good; the next run just refreshes again.
  writeStore(next, { env });
  return next.access_token;
}
