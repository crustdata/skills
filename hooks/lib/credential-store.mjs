/** The credential store, read by the MCP headers helper and the SessionStart hook. Never throws. */

import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where refresh goes when the store predates `token_endpoint` persistence. */
const DEFAULT_TOKEN_ENDPOINT = "https://install.crustdata.com/token";
/** Refresh this long BEFORE nominal expiry, so an in-flight request can't race it. */
const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TIMEOUT_MS = 10_000;
// Two POSTs of the same refresh token trip rotation-reuse detection and revoke the family.
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 8_000;
const LOCK_POLL_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Loopback http is for the e2e harness; a poisoned `token_endpoint` must not get plaintext. */
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

export function credentialsPath(env = process.env) {
  const dir = (env.CRUSTDATA_CONFIG_DIR ?? "").trim() || path.join(os.homedir(), ".crustdata");
  return path.join(dir, "credentials.json");
}

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

export function writeStore(store, opts = {}) {
  const { env = process.env } = opts;
  try {
    const file = credentialsPath(env);
    const dir = path.dirname(file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // mkdir's mode is ignored when the dir already exists, so a pre-existing one keeps its own.
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* best-effort; the 0600 file is the real protection */
    }
    const tmp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
    // Windows only: a concurrent reader or an AV scan holds the destination and fails this transiently.
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, file);
        return true;
      } catch (err) {
        const code = err?.code;
        const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
        if (!transient || attempt >= 3) {
          try {
            unlinkSync(tmp);
          } catch {
            /* best-effort tmp cleanup */
          }
          throw err;
        }
        const until = Date.now() + 25;
        while (Date.now() < until) {
          /* bounded sync backoff — writeStore is synchronous by contract */
        }
      }
    }
  } catch {
    return false;
  }
}

// `expires_at` is epoch MILLISECONDS, and its absence means a non-expiring hand-written key.
function tokenIsFresh(store, now) {
  if (store === null || typeof store.access_token !== "string" || store.access_token === "") return false;
  const expiresAt = Number.isFinite(store.expires_at) ? store.expires_at : null;
  return expiresAt === null || now() < expiresAt - EXPIRY_SKEW_MS;
}

/** Steals a lock past LOCK_STALE_MS, whose holder died; resolves `{ acquired: false }` on timeout. */
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

/** Returns a valid token, refreshing if the stored one is spent, or null. Never throws. */
export async function getAccessToken(opts = {}) {
  const { env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = opts;
  try {
    const store = readStore({ env });
    if (store === null) return null;
    if (tokenIsFresh(store, now)) return store.access_token;

    if (typeof store.refresh_token !== "string" || store.refresh_token === "") return null;
    if (typeof fetchImpl !== "function") return null;

    // A racing process may have just refreshed, and then the refresh token is never spent.
    const file = credentialsPath(env);
    const outcome = await withRefreshLock(file, async () => {
      const current = readStore({ env });
      if (tokenIsFresh(current, now)) return current.access_token;
      return doRefresh(current ?? store, { env, fetchImpl, now });
    });
    if (outcome.acquired) return outcome.result;

    // The holder is still refreshing. A rare double-refresh beats a failed auth.
    const after = readStore({ env });
    if (tokenIsFresh(after, now)) return after.access_token;
    return doRefresh(after ?? store, { env, fetchImpl, now });
  } catch {
    return null;
  }
}

async function doRefresh(store, { env, fetchImpl, now }) {
  const tokenEndpoint =
    typeof store.token_endpoint === "string" && store.token_endpoint !== ""
      ? store.token_endpoint
      : DEFAULT_TOKEN_ENDPOINT;
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
    // The server rotates on every grant; an omitted one stays valid server-side, so keep it.
    refresh_token:
      typeof tokens.refresh_token === "string" && tokens.refresh_token !== "" ? tokens.refresh_token : store.refresh_token,
    expires_at: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_600_000),
    token_type: typeof tokens.token_type === "string" && tokens.token_type !== "" ? tokens.token_type : "Bearer",
  };
  // Not fatal for this caller: the token is good, and the next run just refreshes again.
  writeStore(next, { env });
  return next.access_token;
}
