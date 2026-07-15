/**
 * Shared local credential store for the Crustdata Claude Code plugin.
 *
 * One JSON file — `${CRUSTDATA_CONFIG_DIR:-$HOME/.crustdata}/credentials.json`,
 * mode 0600 — written by the login CLI (`bin/crustdata-login.mjs`) and read by
 * BOTH consumers of the token:
 *   - the MCP server headers helper (`bin/crustdata-headers.mjs`)
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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where refresh goes when the store predates `token_endpoint` persistence. */
const DEFAULT_TOKEN_ENDPOINT = "https://install.crustdata.com/token";
/** Refresh this long BEFORE nominal expiry, so an in-flight request can't race it. */
const EXPIRY_SKEW_MS = 60_000;
const REFRESH_TIMEOUT_MS = 10_000;

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
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
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
 * startup) are harmless: the server's refresh tokens are stateless and stay
 * valid, and the store write is atomic — last writer wins with a good token.
 */
export async function getAccessToken(opts = {}) {
  const { env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = opts;
  try {
    const store = readStore({ env });
    if (store === null) return null;

    const expiresAt = Number.isFinite(store.expires_at) ? store.expires_at : null;
    if (expiresAt === null || now() < expiresAt - EXPIRY_SKEW_MS) return store.access_token;

    if (typeof store.refresh_token !== "string" || store.refresh_token === "") return null;
    if (typeof fetchImpl !== "function") return null;

    const tokenEndpoint =
      typeof store.token_endpoint === "string" && store.token_endpoint !== ""
        ? store.token_endpoint
        : DEFAULT_TOKEN_ENDPOINT;
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
      // The server rotates the refresh token on every grant; keep the old one
      // only if the response somehow omits it (it stays valid server-side).
      refresh_token:
        typeof tokens.refresh_token === "string" && tokens.refresh_token !== ""
          ? tokens.refresh_token
          : store.refresh_token,
      expires_at: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_600_000),
      token_type: typeof tokens.token_type === "string" && tokens.token_type !== "" ? tokens.token_type : "Bearer",
    };
    // A failed persist is not fatal for THIS caller — the refreshed token is
    // still good; the next run just refreshes again.
    writeStore(next, { env });
    return next.access_token;
  } catch {
    return null;
  }
}
