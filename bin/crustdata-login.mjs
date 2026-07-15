#!/usr/bin/env node
/**
 * Crustdata login — OAuth 2.1 Authorization Code + PKCE (S256), public client.
 *
 *   node "$CLAUDE_PLUGIN_ROOT/bin/crustdata-login.mjs"
 *
 * Flow: discover the authorization server via RFC 8414 well-known metadata
 * (fallback: RFC 9728 protected-resource metadata → its authorization server),
 * dynamically register a client (RFC 7591) when a registration endpoint is
 * advertised, open the browser to /authorize with a loopback redirect
 * (127.0.0.1, random port), capture the code, exchange it at the token
 * endpoint, and persist the tokens to the shared credential store
 * (`${CRUSTDATA_CONFIG_DIR:-$HOME/.crustdata}/credentials.json`, mode 0600) —
 * read by both the MCP headers helper and the SessionStart skill-sync hook.
 *
 * Zero dependencies: node:http, node:crypto, node:child_process, global fetch.
 * Only human-readable status goes to stderr; tokens are never printed (masked
 * to a 4-char tail at most).
 *
 * Environment:
 *   CRUSTDATA_MCP_BASE_URL     — server origin override (default
 *                                https://install.crustdata.com); for local testing.
 *   CRUSTDATA_CONFIG_DIR       — credential store dir override (see store module).
 *   CRUSTDATA_LOGIN_NO_BROWSER — set to skip auto-opening a browser (headless /
 *                                SSH: copy the printed URL into any browser).
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { credentialsPath, writeStore } from "../hooks/lib/credential-store.mjs";

const DEFAULT_BASE_URL = "https://install.crustdata.com";
const CLIENT_NAME = "Crustdata Claude Code plugin";
const CALLBACK_PATH = "/callback";
/** How long we wait for the user to finish signing in in the browser. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 15_000;

function logLine(message) {
  process.stderr.write(`[crustdata-login] ${message}\n`);
}

/** Mask a secret for display: never more than a 4-char tail. */
function maskTail(secret) {
  return typeof secret === "string" && secret.length > 0 ? `…${secret.slice(-4)}` : "(none)";
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

export function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * RFC 7636 verifier/challenge pair. 32 random bytes → a 43-char base64url
 * verifier (within the 43–128 spec window); challenge = BASE64URL(SHA256(ASCII(verifier))).
 */
export function pkcePair(bytes = randomBytes(32)) {
  const verifier = base64url(bytes);
  const challenge = base64url(createHash("sha256").update(verifier, "ascii").digest());
  return { verifier, challenge };
}

// ── discovery + registration ─────────────────────────────────────────────────

async function fetchJson(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Transport pin: an OAuth endpoint MUST be https, EXCEPT an explicit loopback
 * host over http (127.0.0.1/localhost/::1) so the local e2e harness can point
 * CRUSTDATA_MCP_BASE_URL at a dev backend. Anything else (http to a remote host,
 * or an unparseable URL) is rejected — a poisoned discovery doc can't downgrade
 * the auth-code / PKCE-verifier / refresh-token exchange onto plaintext.
 */
export function isSecureUrl(s) {
  let u;
  try {
    u = new URL(String(s));
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1" || u.hostname === "[::1]");
}

function sameOrigin(a, b) {
  try {
    return new URL(String(a)).origin === new URL(String(b)).origin;
  } catch {
    return false;
  }
}

/**
 * Trust gate for discovered AS metadata (closes the "poisoned discovery doc"
 * path, C1/C2). Beyond the shape check:
 *   - `issuer` must be secure transport AND self-consistent — same-origin as the
 *     well-known URL we fetched the doc FROM (RFC 8414 §3.3: the issuer identifies
 *     the server, so a doc can't claim to be a different issuer than where it lives);
 *   - every endpoint must be secure transport AND same-origin as that issuer.
 * So a metadata doc can only ever send the auth code, the PKCE verifier, and the
 * rotating refresh token to its own (TLS-authenticated) issuer origin — never to
 * an attacker endpoint smuggled into the doc. A cross-origin authorization server
 * is still allowed (RFC 9728), but only when the protected-resource doc that
 * named it was itself fetched over TLS from the trusted base.
 */
export function isTrustedMetadata(meta, metadataUrl) {
  if (typeof meta !== "object" || meta === null) return false;
  const { issuer, authorization_endpoint, token_endpoint, registration_endpoint } = meta;
  if (typeof issuer !== "string" || !isSecureUrl(issuer) || !sameOrigin(issuer, metadataUrl)) return false;
  for (const ep of [authorization_endpoint, token_endpoint]) {
    if (typeof ep !== "string" || ep === "" || !isSecureUrl(ep) || !sameOrigin(ep, issuer)) return false;
  }
  if (registration_endpoint !== undefined && registration_endpoint !== "") {
    if (typeof registration_endpoint !== "string" || !isSecureUrl(registration_endpoint) || !sameOrigin(registration_endpoint, issuer)) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve the authorization-server metadata for `baseUrl`.
 * Primary: GET <base>/.well-known/oauth-authorization-server (RFC 8414).
 * Fallback: GET <base>/.well-known/oauth-protected-resource (RFC 9728) → for each
 * advertised authorization server (secure transport only) → fetch THAT server's
 * RFC 8414 metadata. Every returned doc passes `isTrustedMetadata` (https +
 * issuer self-consistency + endpoint origin pinning). Returns the metadata or
 * null; never throws.
 */
export async function discover(baseUrl, fetchImpl = globalThis.fetch) {
  const base = String(baseUrl).replace(/\/+$/, "");
  if (!isSecureUrl(base)) return null; // don't even discover over an insecure/hostile transport

  const directUrl = `${base}/.well-known/oauth-authorization-server`;
  const direct = await fetchJson(fetchImpl, directUrl);
  if (isTrustedMetadata(direct, directUrl)) return direct;

  const resource = await fetchJson(fetchImpl, `${base}/.well-known/oauth-protected-resource`);
  const servers = Array.isArray(resource?.authorization_servers) ? resource.authorization_servers : [];
  for (const server of servers) {
    if (typeof server !== "string" || server === "" || !isSecureUrl(server)) continue;
    const asUrl = `${server.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`;
    const meta = await fetchJson(fetchImpl, asUrl);
    if (isTrustedMetadata(meta, asUrl)) return meta;
  }
  return null;
}

/**
 * Obtain a client_id: Dynamic Client Registration (RFC 7591) at the advertised
 * registration_endpoint when present — registered as a public client
 * (token_endpoint_auth_method "none") with our loopback redirect — else fall
 * back to a static `client_id` published in the discovery metadata. Throws
 * (with a human message, no secrets) when neither path yields one.
 */
export async function registerClient(meta, redirectUri, fetchImpl = globalThis.fetch) {
  if (typeof meta.registration_endpoint === "string" && meta.registration_endpoint !== "") {
    const res = await fetchImpl(meta.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (typeof body?.client_id === "string" && body.client_id !== "") return body.client_id;
    }
    throw new Error(`dynamic client registration failed (status ${res.status})`);
  }
  if (typeof meta.client_id === "string" && meta.client_id !== "") return meta.client_id;
  throw new Error("server advertises no registration_endpoint and no client_id — cannot proceed");
}

// ── authorize round-trip ─────────────────────────────────────────────────────

export function buildAuthorizeUrl(meta, { clientId, redirectUri, challenge, state }) {
  const url = new URL(meta.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Platform-appropriate browser-open command (pure, for tests). */
export function browserCommand(url, platform = process.platform) {
  if (platform === "darwin") return { cmd: "open", args: [url] };
  // `start` is a cmd builtin; `&` in the query string must be escaped for cmd.
  if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", url.replace(/&/g, "^&")] };
  return { cmd: "xdg-open", args: [url] };
}

function openBrowser(url) {
  const { cmd, args } = browserCommand(url);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* fall through to the printed URL */
    });
    child.unref();
  } catch {
    /* fall through to the printed URL */
  }
}

const PAGE_STYLE =
  "font: 16px/1.6 system-ui, sans-serif; max-width: 26rem; margin: 4rem auto; padding: 0 1.5rem; color: #374151;";
function landingPage(title, detail) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title></head>
<body style="${PAGE_STYLE}"><h1 style="font-size:1.4rem;color:#111827;">${title}</h1><p>${detail}</p></body></html>`;
}

/**
 * Loopback server on 127.0.0.1:<random port> that waits for exactly one
 * authorization redirect. Resolves { redirectUri, waitForCode() }; waitForCode
 * resolves the `code` (state-checked, and iss-checked per RFC 9207 when the AS
 * sends/advertises it) or rejects on error/timeout.
 */
function startLoopback(expectedState, { expectedIssuer, requireIss = false } = {}) {
  return new Promise((resolveStart, rejectStart) => {
    let settle;
    const outcome = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const iss = url.searchParams.get("iss");
      // RFC 9207: if the AS advertised issuer identification (or simply sent an
      // `iss`), it MUST equal the issuer we discovered — a mismatch means the
      // response came from a different AS than we authorized against.
      const issBad = (requireIss && iss === null) || (iss !== null && iss !== expectedIssuer);
      if (err !== null || code === null || state !== expectedState || issBad) {
        const reason =
          err !== null
            ? `authorization failed: ${err}`
            : code === null
              ? "authorization response carried no code"
              : state !== expectedState
                ? "state mismatch — possible cross-request forgery; aborting"
                : "issuer (iss) mismatch — response from an unexpected authorization server; aborting";
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(landingPage("Sign-in failed", "Return to the terminal and try again."), () => settle.reject(new Error(reason)));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(landingPage("You're signed in", "Crustdata is connected. You can close this tab and return to the terminal."), () =>
        settle.resolve(code),
      );
    });
    const timer = setTimeout(() => {
      settle.reject(new Error(`timed out after ${LOGIN_TIMEOUT_MS / 60000} minutes waiting for the browser sign-in`));
    }, LOGIN_TIMEOUT_MS);
    server.on("error", (err) => rejectStart(err));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveStart({
        redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        waitForCode: () =>
          outcome.finally(() => {
            clearTimeout(timer);
            server.close();
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

// ── token exchange ───────────────────────────────────────────────────────────

async function exchangeCode({ meta, clientId, code, verifier, redirectUri, fetchImpl = globalThis.fetch }) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetchImpl(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.access_token !== "string" || body.access_token === "") {
    const detail = typeof body?.error === "string" ? body.error : `status ${res.status}`;
    throw new Error(`token exchange failed (${detail})`);
  }
  return body;
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function runLogin() {
  const base = (process.env.CRUSTDATA_MCP_BASE_URL ?? "").trim() || DEFAULT_BASE_URL;

  logLine(`discovering OAuth endpoints at ${base} …`);
  const meta = await discover(base);
  if (meta === null) {
    logLine(`could not discover an OAuth authorization server at ${base}`);
    logLine("check your network, or set CRUSTDATA_MCP_BASE_URL if you use a non-default server");
    return 1;
  }

  const { verifier, challenge } = pkcePair();
  const state = base64url(randomBytes(16));

  const { redirectUri, waitForCode } = await startLoopback(state, {
    expectedIssuer: meta.issuer,
    requireIss: meta.authorization_response_iss_parameter_supported === true,
  });

  let clientId;
  try {
    clientId = await registerClient(meta, redirectUri);
  } catch (err) {
    logLine(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const authorizeUrl = buildAuthorizeUrl(meta, { clientId, redirectUri, challenge, state });
  const noBrowser = (process.env.CRUSTDATA_LOGIN_NO_BROWSER ?? "").trim() !== "";
  if (noBrowser) {
    logLine(`sign in to Crustdata by visiting:\n  ${authorizeUrl}`);
  } else {
    logLine("opening your browser to sign in to Crustdata …");
    logLine(`if it doesn't open, visit:\n  ${authorizeUrl}`);
    openBrowser(authorizeUrl);
  }

  let code;
  try {
    code = await waitForCode();
  } catch (err) {
    logLine(err instanceof Error ? err.message : String(err));
    return 1;
  }

  let tokens;
  try {
    tokens = await exchangeCode({ meta, clientId, code, verifier, redirectUri });
  } catch (err) {
    logLine(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const expiresIn = Number(tokens.expires_in);
  const stored = writeStore({
    access_token: tokens.access_token,
    refresh_token: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
    expires_at: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_600_000),
    token_type: typeof tokens.token_type === "string" && tokens.token_type !== "" ? tokens.token_type : "Bearer",
    // Persisted so silent refresh (credential-store.mjs) needs no re-discovery.
    token_endpoint: meta.token_endpoint,
    client_id: clientId,
  });
  if (!stored) {
    logLine(`signed in, but writing ${credentialsPath()} failed — check directory permissions`);
    return 1;
  }
  logLine(`signed in — token ${maskTail(tokens.access_token)} saved to ${credentialsPath()}`);
  logLine("the Crustdata MCP server and skill sync will use it automatically from now on");
  return 0;
}

// Run only when executed directly; tests import this module without side effects.
const invokedAs = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedAs !== "" && fileURLToPath(import.meta.url) === invokedAs) {
  let exitCode = 1;
  try {
    exitCode = await runLogin();
  } catch (err) {
    logLine(`login failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(exitCode);
}
