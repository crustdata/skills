import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { credentialsPath, getAccessToken, readStore, writeStore } from "../core/credential-store.mjs";

/** Fresh isolated store dir per test; returns { env, dir, cleanup }. */
function tempStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-store-"));
  return {
    dir,
    env: { CRUSTDATA_CONFIG_DIR: dir },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const HOUR = 3_600_000;

function validStore(overrides = {}) {
  return {
    access_token: "tok-live-abcd",
    refresh_token: "refresh-1",
    expires_at: Date.now() + HOUR,
    token_type: "Bearer",
    token_endpoint: "https://as.example/token",
    client_id: "client-1",
    ...overrides,
  };
}

/** A fetch mock that records calls and replays scripted responses. */
function fetchMock(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return { impl, calls };
}

const noFetch = async () => {
  throw new Error("fetch must not be called");
};

test("writeStore/readStore roundtrip, file mode 0600", () => {
  const { env, cleanup } = tempStore();
  try {
    const store = validStore();
    assert.equal(writeStore(store, { env }), true);
    assert.deepEqual(readStore({ env }), store);
    if (process.platform !== "win32") {
      assert.equal(statSync(credentialsPath(env)).mode & 0o777, 0o600);
    }
  } finally {
    cleanup();
  }
});

test("readStore: absent file, corrupt JSON, wrong shape → null", () => {
  const { env, dir, cleanup } = tempStore();
  try {
    assert.equal(readStore({ env }), null);
    mkdirSync(dir, { recursive: true });
    writeFileSync(credentialsPath(env), "{not json");
    assert.equal(readStore({ env }), null);
    writeFileSync(credentialsPath(env), JSON.stringify(["nope"]));
    assert.equal(readStore({ env }), null);
    writeFileSync(credentialsPath(env), JSON.stringify({ access_token: "" }));
    assert.equal(readStore({ env }), null);
  } finally {
    cleanup();
  }
});

test("getAccessToken: unexpired token returned without any network", async () => {
  const { env, cleanup } = tempStore();
  try {
    writeStore(validStore(), { env });
    assert.equal(await getAccessToken({ env, fetchImpl: noFetch }), "tok-live-abcd");
  } finally {
    cleanup();
  }
});

test("getAccessToken: absent store → null", async () => {
  const { env, cleanup } = tempStore();
  try {
    assert.equal(await getAccessToken({ env, fetchImpl: noFetch }), null);
  } finally {
    cleanup();
  }
});

test("getAccessToken: no expires_at (hand-written raw key) → returned as-is", async () => {
  const { env, cleanup } = tempStore();
  try {
    writeStore({ access_token: "raw-api-key" }, { env });
    assert.equal(await getAccessToken({ env, fetchImpl: noFetch }), "raw-api-key");
  } finally {
    cleanup();
  }
});

test("getAccessToken: token inside the 60s skew triggers refresh and persists rotation", async () => {
  const { env, cleanup } = tempStore();
  try {
    const now = Date.now();
    // 30s of life left → within the 60s skew → must refresh, not reuse.
    writeStore(validStore({ expires_at: now + 30_000 }), { env });
    const { impl, calls } = fetchMock([
      { status: 200, body: { access_token: "tok-new", refresh_token: "refresh-2", expires_in: 7200, token_type: "Bearer" } },
    ]);

    const token = await getAccessToken({ env, fetchImpl: impl, now: () => now });
    assert.equal(token, "tok-new");

    // The refresh hit the persisted token endpoint with the right grant.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://as.example/token");
    const form = new URLSearchParams(calls[0].init.body);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "refresh-1");
    assert.equal(form.get("client_id"), "client-1");
    assert.equal(calls[0].init.headers["content-type"], "application/x-www-form-urlencoded");

    // Rotated tokens + new expiry landed on disk (extra fields preserved).
    const persisted = JSON.parse(readFileSync(credentialsPath(env), "utf8"));
    assert.equal(persisted.access_token, "tok-new");
    assert.equal(persisted.refresh_token, "refresh-2");
    assert.equal(persisted.expires_at, now + 7200 * 1000);
    assert.equal(persisted.token_endpoint, "https://as.example/token");
    assert.equal(persisted.client_id, "client-1");
  } finally {
    cleanup();
  }
});

test("getAccessToken: refresh rejected by the server → null, store untouched", async () => {
  const { env, cleanup } = tempStore();
  try {
    const stale = validStore({ expires_at: Date.now() - HOUR });
    writeStore(stale, { env });
    const { impl } = fetchMock([{ status: 400, body: { error: "invalid_grant" } }]);
    assert.equal(await getAccessToken({ env, fetchImpl: impl }), null);
    assert.deepEqual(readStore({ env }), stale);
  } finally {
    cleanup();
  }
});

test("getAccessToken: refresh network failure → null (never throws)", async () => {
  const { env, cleanup } = tempStore();
  try {
    writeStore(validStore({ expires_at: Date.now() - HOUR }), { env });
    const { impl } = fetchMock([new Error("ECONNREFUSED")]);
    assert.equal(await getAccessToken({ env, fetchImpl: impl }), null);
  } finally {
    cleanup();
  }
});

test("getAccessToken: refresh response without access_token → null", async () => {
  const { env, cleanup } = tempStore();
  try {
    writeStore(validStore({ expires_at: Date.now() - HOUR }), { env });
    const { impl } = fetchMock([{ status: 200, body: { token_type: "Bearer" } }]);
    assert.equal(await getAccessToken({ env, fetchImpl: impl }), null);
  } finally {
    cleanup();
  }
});

test("getAccessToken: expired with no refresh_token → null, no network", async () => {
  const { env, cleanup } = tempStore();
  try {
    writeStore(validStore({ expires_at: Date.now() - HOUR, refresh_token: "" }), { env });
    assert.equal(await getAccessToken({ env, fetchImpl: noFetch }), null);
  } finally {
    cleanup();
  }
});

// ── C2: refuse to refresh over an insecure/mismatched endpoint ────────────────

test("getAccessToken: refuses to refresh when the persisted token_endpoint is http (C2)", async () => {
  const { env, cleanup } = tempStore();
  try {
    writeStore(validStore({ expires_at: Date.now() - 1_000, token_endpoint: "http://evil.example/token" }), { env });
    // fetch must never be called — the insecure endpoint is rejected before the POST.
    assert.equal(await getAccessToken({ env, fetchImpl: noFetch }), null);
  } finally {
    cleanup();
  }
});

// ── C4: single-flight the refresh across concurrent callers ───────────────────

test("getAccessToken: concurrent refreshes issue ONE token POST (single-flight, C4)", async () => {
  const { env, cleanup } = tempStore();
  try {
    writeStore(validStore({ expires_at: Date.now() - 1_000 }), { env });
    let posts = 0;
    const fetchImpl = async () => {
      posts += 1;
      await new Promise((r) => setTimeout(r, 40)); // hold the lock so the sibling must wait
      return { ok: true, status: 200, json: async () => ({ access_token: "tok-refreshed", refresh_token: "refresh-2", expires_in: 3600 }) };
    };
    const [a, b] = await Promise.all([getAccessToken({ env, fetchImpl }), getAccessToken({ env, fetchImpl })]);
    assert.equal(a, "tok-refreshed");
    assert.equal(b, "tok-refreshed"); // the waiter picked up the freshly-written token
    assert.equal(posts, 1); // the SAME refresh token was POSTed exactly once
    assert.equal(readStore({ env }).refresh_token, "refresh-2"); // rotation persisted
  } finally {
    cleanup();
  }
});
