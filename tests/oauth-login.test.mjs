import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { base64url, browserCommand, buildAuthorizeUrl, discover, pkcePair, registerClient } from "../scripts/crustdata-login.mjs";

// ── PKCE ─────────────────────────────────────────────────────────────────────

test("pkcePair: verifier is 43-char base64url (32 random bytes), unreserved charset", () => {
  const { verifier } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/); // RFC 7636 §4.1 window is 43–128
});

test("pkcePair: challenge = BASE64URL(SHA256(ASCII(verifier))), no padding", () => {
  const { verifier, challenge } = pkcePair();
  const expected = createHash("sha256").update(verifier, "ascii").digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(challenge, expected);
  assert.ok(!challenge.includes("="));
  assert.ok(!challenge.includes("+"));
  assert.ok(!challenge.includes("/"));
});

test("pkcePair: deterministic for fixed input bytes (RFC 7636 appendix B vector shape)", () => {
  const bytes = Buffer.alloc(32, 7);
  const a = pkcePair(bytes);
  const b = pkcePair(bytes);
  assert.deepEqual(a, b);
  assert.equal(a.verifier, base64url(bytes));
});

test("pkcePair: two calls yield distinct verifiers", () => {
  assert.notEqual(pkcePair().verifier, pkcePair().verifier);
});

// ── authorize URL ────────────────────────────────────────────────────────────

test("buildAuthorizeUrl carries all required OAuth 2.1 + PKCE params", () => {
  const url = new URL(
    buildAuthorizeUrl(
      { authorization_endpoint: "https://as.example/authorize" },
      { clientId: "cid", redirectUri: "http://127.0.0.1:49152/callback", challenge: "chal", state: "st" },
    ),
  );
  assert.equal(url.origin + url.pathname, "https://as.example/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:49152/callback");
  assert.equal(url.searchParams.get("code_challenge"), "chal");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "st");
});

// ── discovery ────────────────────────────────────────────────────────────────

function scriptedFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const hit = routes[String(url)];
    if (hit === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => hit };
  };
  return { impl, calls };
}

const AS_META = {
  issuer: "https://as.example/",
  authorization_endpoint: "https://as.example/authorize",
  token_endpoint: "https://as.example/token",
  registration_endpoint: "https://as.example/register",
};

test("discover: direct oauth-authorization-server metadata wins (issuer self-consistent)", async () => {
  const { impl, calls } = scriptedFetch({
    "https://as.example/.well-known/oauth-authorization-server": AS_META,
  });
  assert.deepEqual(await discover("https://as.example/", impl), AS_META);
  assert.equal(calls.length, 1);
});

test("discover: rejects an http (plaintext) base — no discovery over insecure transport", async () => {
  const { impl, calls } = scriptedFetch({
    "http://as.example/.well-known/oauth-authorization-server": AS_META,
  });
  assert.equal(await discover("http://as.example", impl), null);
  assert.equal(calls.length, 0); // never even fetched
});

test("discover: rejects metadata whose issuer origin != where it was served (spoofed issuer)", async () => {
  const { impl } = scriptedFetch({
    // served at mcp.example, but AS_META claims issuer as.example → not self-consistent
    "https://mcp.example/.well-known/oauth-authorization-server": AS_META,
  });
  assert.equal(await discover("https://mcp.example", impl), null);
});

test("discover: rejects a metadata doc that points its token_endpoint at another origin", async () => {
  const poisoned = { ...AS_META, token_endpoint: "https://evil.example/token" };
  const { impl } = scriptedFetch({
    "https://as.example/.well-known/oauth-authorization-server": poisoned,
  });
  assert.equal(await discover("https://as.example", impl), null);
});

test("discover: ignores a cross-origin AS advertised over http, keeps the https one", async () => {
  const { impl } = scriptedFetch({
    "https://mcp.example/.well-known/oauth-protected-resource": {
      resource: "https://mcp.example/mcp",
      authorization_servers: ["http://evil.example", "https://as.example"],
    },
    "https://as.example/.well-known/oauth-authorization-server": AS_META,
  });
  assert.deepEqual(await discover("https://mcp.example", impl), AS_META);
});

test("discover: falls back to protected-resource metadata → its authorization server", async () => {
  const { impl, calls } = scriptedFetch({
    "https://mcp.example/.well-known/oauth-protected-resource": {
      resource: "https://mcp.example/mcp",
      authorization_servers: ["https://as.example"],
    },
    "https://as.example/.well-known/oauth-authorization-server": AS_META,
  });
  assert.deepEqual(await discover("https://mcp.example", impl), AS_META);
  assert.deepEqual(calls, [
    "https://mcp.example/.well-known/oauth-authorization-server",
    "https://mcp.example/.well-known/oauth-protected-resource",
    "https://as.example/.well-known/oauth-authorization-server",
  ]);
});

test("discover: nothing usable anywhere → null (never throws)", async () => {
  const { impl } = scriptedFetch({});
  assert.equal(await discover("https://mcp.example", impl), null);
});

test("discover: metadata missing token_endpoint is not usable", async () => {
  const { impl } = scriptedFetch({
    "https://mcp.example/.well-known/oauth-authorization-server": { authorization_endpoint: "https://as.example/authorize" },
  });
  assert.equal(await discover("https://mcp.example", impl), null);
});

// ── dynamic client registration ──────────────────────────────────────────────

test("registerClient: DCR posts a public-client registration and returns client_id", async () => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ client_id: "dcr-client" }) };
  };
  const clientId = await registerClient(AS_META, "http://127.0.0.1:49152/callback", impl);
  assert.equal(clientId, "dcr-client");
  assert.equal(calls[0].url, "https://as.example/register");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.redirect_uris, ["http://127.0.0.1:49152/callback"]);
  assert.equal(body.token_endpoint_auth_method, "none");
  assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
  assert.deepEqual(body.response_types, ["code"]);
});

test("registerClient: no registration_endpoint → falls back to discovery client_id", async () => {
  const meta = { ...AS_META, registration_endpoint: undefined, client_id: "static-client" };
  const clientId = await registerClient(meta, "http://127.0.0.1:1/callback", async () => {
    throw new Error("must not fetch");
  });
  assert.equal(clientId, "static-client");
});

test("registerClient: DCR failure and no static client_id → throws a human error", async () => {
  const failing = async () => ({ ok: false, status: 400, json: async () => ({}) });
  await assert.rejects(() => registerClient(AS_META, "http://127.0.0.1:1/callback", failing), /registration failed/);
  await assert.rejects(
    () => registerClient({ authorization_endpoint: "x", token_endpoint: "y" }, "http://127.0.0.1:1/callback", failing),
    /no registration_endpoint and no client_id/,
  );
});

// ── browser command ──────────────────────────────────────────────────────────

test("browserCommand picks the platform opener and escapes & for cmd.exe", () => {
  const url = "https://as.example/authorize?a=1&b=2";
  assert.deepEqual(browserCommand(url, "darwin"), { cmd: "open", args: [url] });
  assert.deepEqual(browserCommand(url, "linux"), { cmd: "xdg-open", args: [url] });
  assert.deepEqual(browserCommand(url, "win32"), {
    cmd: "cmd",
    args: ["/c", "start", "", "https://as.example/authorize?a=1^&b=2"],
  });
});
