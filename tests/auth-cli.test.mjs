import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { writeStore } from "../hooks/lib/credential-store.mjs";

const CLI = fileURLToPath(new URL("../bin/crustdata-auth.mjs", import.meta.url));

/** Run the CLI with a controlled env; returns {code, stdout, stderr}. */
function run(cmd, env) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, cmd], {
      env: { ...process.env, CRUSTDATA_API_KEY: "", CRUSTDATA_CONFIG_DIR: "", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** A store dir holding a non-expiring token (far-future expiry → no refresh attempt). */
function storeDirWith(token) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-auth-"));
  const prev = process.env.CRUSTDATA_CONFIG_DIR;
  process.env.CRUSTDATA_CONFIG_DIR = dir;
  try {
    assert.equal(writeStore({ access_token: token, refresh_token: "r", expires_at: Date.now() + 86_400_000, token_type: "Bearer" }), true);
  } finally {
    if (prev === undefined) delete process.env.CRUSTDATA_CONFIG_DIR;
    else process.env.CRUSTDATA_CONFIG_DIR = prev;
  }
  return dir;
}

test("check: no credential anywhere → exit 2 with the /crustdata:login hint", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-auth-empty-"));
  const r = run("check", { CRUSTDATA_CONFIG_DIR: dir });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /\/crustdata:login/);
  assert.equal(r.stdout, "");
  rmSync(dir, { recursive: true, force: true });
});

test("check: CRUSTDATA_API_KEY satisfies the gate silently", () => {
  const r = run("check", { CRUSTDATA_API_KEY: "cd_test_key" });
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "", ""]);
});

test("check: a valid stored token satisfies the gate silently", () => {
  const dir = storeDirWith("cd_stored_token");
  const r = run("check", { CRUSTDATA_CONFIG_DIR: dir });
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "", ""]);
  rmSync(dir, { recursive: true, force: true });
});

test("token: prints the stored token; env key wins over the store", () => {
  const dir = storeDirWith("cd_stored_token");
  assert.equal(run("token", { CRUSTDATA_CONFIG_DIR: dir }).stdout.trim(), "cd_stored_token");
  assert.equal(run("token", { CRUSTDATA_CONFIG_DIR: dir, CRUSTDATA_API_KEY: "cd_env_key" }).stdout.trim(), "cd_env_key");
  rmSync(dir, { recursive: true, force: true });
});

test("token: nothing available → exit 2, NOTHING on stdout (a script must never get garbage)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-auth-empty-"));
  const r = run("token", { CRUSTDATA_CONFIG_DIR: dir });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  rmSync(dir, { recursive: true, force: true });
});

test("refresh: no store → still exit 0 and silent (no nagging at session start)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "crustdata-auth-empty-"));
  const r = run("refresh", { CRUSTDATA_CONFIG_DIR: dir });
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, "", ""]);
  rmSync(dir, { recursive: true, force: true });
});

test("unknown subcommand → usage on stderr, exit 2", () => {
  const r = run("bogus", {});
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: crustdata-auth/);
});
