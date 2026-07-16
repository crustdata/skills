/**
 * End-to-end login test WITHOUT a browser: a fake OAuth 2.1 authorization
 * server (plain node:http) serves discovery + DCR + authorize + token; the
 * login CLI runs as a subprocess with CRUSTDATA_LOGIN_NO_BROWSER set, the test
 * plays the browser by fetching the printed authorize URL (following the 302
 * to the CLI's loopback callback), and the fake token endpoint performs a REAL
 * PKCE S256 check on the code_verifier. Asserts the credential store lands on
 * disk with the issued tokens, mode 0600.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const LOGIN = fileURLToPath(new URL("../claude/bin/crustdata-login.mjs", import.meta.url));

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Fake authorization server; records what it saw for assertions. */
function startFakeAS() {
  const seen = { registered: null, challenge: null, verifierOk: false, tokenForm: null };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const readBody = async () => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      return Buffer.concat(chunks).toString("utf8");
    };

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      json(200, {
        issuer: `${origin}/`,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
      });
      return;
    }
    if (url.pathname === "/register" && req.method === "POST") {
      seen.registered = JSON.parse(await readBody());
      json(201, { client_id: "e2e-client" });
      return;
    }
    if (url.pathname === "/authorize") {
      seen.challenge = url.searchParams.get("code_challenge");
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      redirect.searchParams.set("code", "e2e-code");
      redirect.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: redirect.toString() });
      res.end();
      return;
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await readBody());
      seen.tokenForm = Object.fromEntries(form);
      seen.verifierOk = b64url(createHash("sha256").update(form.get("code_verifier") ?? "", "ascii").digest()) === seen.challenge;
      if (form.get("code") !== "e2e-code" || !seen.verifierOk) {
        json(400, { error: "invalid_grant" });
        return;
      }
      json(200, { access_token: "e2e-access", refresh_token: "e2e-refresh", expires_in: 3600, token_type: "Bearer" });
      return;
    }
    json(404, {});
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("login CLI end-to-end against a fake AS (no browser): DCR, PKCE, code exchange, store write", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-login-e2e-"));
  const { server, seen, origin } = await startFakeAS();
  try {
    const env = { ...process.env, CRUSTDATA_MCP_BASE_URL: origin, CRUSTDATA_CONFIG_DIR: dir, CRUSTDATA_LOGIN_NO_BROWSER: "1" };
    delete env.CRUSTDATA_API_KEY;
    const child = spawn(process.execPath, [LOGIN], { env, stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    const exited = new Promise((resolve) => child.on("exit", resolve));

    // Play the browser: grab the authorize URL off stderr and follow it
    // (fetch follows the 302 to the CLI's loopback callback).
    const authorizeUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no authorize URL printed; stderr so far:\n${stderr}`)), 15_000);
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/(http:\/\/127\.0\.0\.1:\d+\/authorize\?\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    const browser = await fetch(authorizeUrl, { redirect: "follow" });
    assert.equal(browser.status, 200);
    assert.match(await browser.text(), /signed in/i);

    assert.equal(await exited, 0, `login CLI exited nonzero; stderr:\n${stderr}`);

    // The fake AS saw a public-client DCR and a PKCE-correct token exchange.
    assert.equal(seen.registered.token_endpoint_auth_method, "none");
    assert.equal(seen.verifierOk, true);
    assert.equal(seen.tokenForm.grant_type, "authorization_code");
    assert.equal(seen.tokenForm.client_id, "e2e-client");

    // The store landed with the issued tokens, refresh context, and mode 0600.
    const file = path.join(dir, "credentials.json");
    const store = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(store.access_token, "e2e-access");
    assert.equal(store.refresh_token, "e2e-refresh");
    assert.equal(store.token_type, "Bearer");
    assert.equal(store.token_endpoint, `${origin}/token`);
    assert.equal(store.client_id, "e2e-client");
    assert.ok(store.expires_at > Date.now() + 3_000_000 && store.expires_at <= Date.now() + 3_600_000);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);

    // No token material ever printed.
    assert.doesNotMatch(stderr, /e2e-access|e2e-refresh/);
  } finally {
    server.close();
    server.closeAllConnections?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
