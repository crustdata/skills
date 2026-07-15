import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { writeStore } from "../core/credential-store.mjs";

const HELPER = fileURLToPath(new URL("../bin/crustdata-headers.mjs", import.meta.url));

/** Run the helper as Claude Code would, against an isolated credential store. */
function runHelper(dir, extraEnv = {}) {
  const env = { ...process.env, CRUSTDATA_CONFIG_DIR: dir, ...extraEnv };
  delete env.CRUSTDATA_API_KEY; // never inherit a key from the invoking shell
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [HELPER], { env, encoding: "utf8", timeout: 15_000 });
}

test("headersHelper: valid token in the store → Authorization header on stdout, exit 0", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-headers-"));
  try {
    writeStore(
      { access_token: "tok-1234", refresh_token: "r", expires_at: Date.now() + 3_600_000, token_type: "Bearer" },
      { env: { CRUSTDATA_CONFIG_DIR: dir } },
    );
    const res = runHelper(dir);
    assert.equal(res.status, 0);
    assert.deepEqual(JSON.parse(res.stdout), { Authorization: "Bearer tok-1234" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("headersHelper: no credentials → {} on stdout, login hint on stderr, exit 0", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-headers-"));
  try {
    const res = runHelper(dir);
    assert.equal(res.status, 0);
    assert.deepEqual(JSON.parse(res.stdout), {});
    assert.match(res.stderr, /crustdata-login\.mjs/);
    assert.doesNotMatch(res.stdout, /Bearer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("headersHelper: CRUSTDATA_API_KEY env overrides the store", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-headers-"));
  try {
    writeStore(
      { access_token: "store-token", refresh_token: "r", expires_at: Date.now() + 3_600_000, token_type: "Bearer" },
      { env: { CRUSTDATA_CONFIG_DIR: dir } },
    );
    const res = runHelper(dir, { CRUSTDATA_API_KEY: "env-key" });
    assert.equal(res.status, 0);
    assert.deepEqual(JSON.parse(res.stdout), { Authorization: "Bearer env-key" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("headersHelper: expired token with no reachable refresh → {} and exit 0 (never breaks the client)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-headers-"));
  try {
    writeStore(
      {
        access_token: "tok-stale",
        refresh_token: "r",
        expires_at: Date.now() - 1000,
        token_type: "Bearer",
        // Unroutable loopback port → refresh fails fast without touching the network.
        token_endpoint: "http://127.0.0.1:9/token",
      },
      { env: { CRUSTDATA_CONFIG_DIR: dir } },
    );
    const res = runHelper(dir);
    assert.equal(res.status, 0);
    assert.deepEqual(JSON.parse(res.stdout), {});
    assert.doesNotMatch(res.stdout + res.stderr, /tok-stale/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
