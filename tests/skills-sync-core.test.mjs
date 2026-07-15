import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";

import {
  extractSkillFiles,
  installSkillAtomically,
  isSafeRelPath,
  isSafeSlug,
  isSecureBaseUrl,
  isValidMarker,
  MARKER_FILENAME,
  parseMarker,
  planSync,
  readZipEntries,
  removeSkillDir,
  runSync,
  writeSkillTree,
} from "../hooks/skills-sync-core.mjs";

// ── a minimal zip builder (store or deflate), enough to craft hostile inputs ──

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// entry: { name, data?, externalAttrs?, method?(0|8), madeBy?, declaredUncompressed? }
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "", "utf8");
    const method = e.method ?? 0;
    const stored = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const uncompressed = e.declaredUncompressed ?? data.length;
    const madeBy = e.madeBy ?? 0x0314; // unix, v20
    const extAttrs = e.externalAttrs ?? ((0x8000 | 0o644) >>> 0) * 0x10000;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(madeBy, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(extAttrs >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + stored.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const SYMLINK_ATTRS = ((0xa000 | 0o777) >>> 0) * 0x10000;
const skillZip = (extra = []) => buildZip([{ name: "SKILL.md", data: "---\nname: x\n---\n" }, ...extra]);
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "cd-skills-test-"));

// ── path / slug validation ────────────────────────────────────────────────────

test("isSafeSlug: accepts real slugs, rejects traversal/separators/empties", () => {
  for (const ok of ["a", "my-skill", "a.b_c-1"]) assert.equal(isSafeSlug(ok), true, ok);
  for (const bad of ["", "-lead", "../x", "a/b", ".hidden", "A B", null, undefined, "x".repeat(200)]) {
    assert.equal(isSafeSlug(bad), false, String(bad));
  }
});

test("isSafeRelPath: blocks traversal, absolute, drive, backslash, NUL, dot segments", () => {
  for (const ok of ["a.md", "refs/deep/x.txt"]) assert.equal(isSafeRelPath(ok), true, ok);
  for (const bad of ["../evil", "/abs", "C:/x", "a\\b", "a/../b", "./x", "a//b", "a\0b", ""]) {
    assert.equal(isSafeRelPath(bad), false, bad);
  }
});

test("isSafeRelPath: reserves the marker name CASE-INSENSITIVELY (C12)", () => {
  assert.equal(isSafeRelPath(".crustdata-lock"), false);
  assert.equal(isSafeRelPath(".Crustdata-Lock"), false); // would collide on a case-insensitive FS
  assert.equal(isSafeRelPath(".CRUSTDATA-LOCK"), false);
  assert.equal(isSafeRelPath("sub/.crustdata-lock"), true); // nested is harmless (C16 — only top-level is read)
});

test("parseMarker/isValidMarker: only a well-formed crustdata marker whose slug matches the dir is trusted", () => {
  const good = parseMarker(JSON.stringify({ slug: "s", version: "1.0.0", managed_by: "crustdata" }));
  assert.ok(good);
  assert.equal(isValidMarker(good, "s"), true);
  assert.equal(isValidMarker(good, "other"), false); // copied/renamed folder → not ours
  assert.equal(parseMarker("{ not json"), null);
  assert.equal(parseMarker(JSON.stringify({ slug: "s", version: "1", managed_by: "someone" })), null);
  assert.equal(parseMarker(JSON.stringify({ version: "1", managed_by: "crustdata" })), null);
});

// ── zip reader / extraction ─────────────────────────────────────────────────

test("extractSkillFiles: reads a valid zip (stored + deflated)", () => {
  const zip = skillZip([{ name: "refs/a.md", data: "hi" }, { name: "b.js", data: "x".repeat(5000), method: 8 }]);
  const r = extractSkillFiles(zip);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => f.path).sort(), ["SKILL.md", "b.js", "refs/a.md"]);
});

test("extractSkillFiles: refuses a symlink entry", () => {
  const r = extractSkillFiles(skillZip([{ name: "link", data: "/etc/passwd", externalAttrs: SYMLINK_ATTRS }]));
  assert.equal(r.ok, false);
  assert.match(r.error, /symlink/);
});

test("extractSkillFiles: refuses a traversal entry path", () => {
  const r = extractSkillFiles(skillZip([{ name: "../escape.md", data: "boo" }]));
  assert.equal(r.ok, false);
  assert.match(r.error, /unsafe entry path/);
});

test("extractSkillFiles: rejects a lying CRC (integrity)", () => {
  const zip = buildZip([{ name: "SKILL.md", data: "real" }]);
  // Corrupt one data byte AFTER the local header (offset 30 + nameLen).
  zip[30 + "SKILL.md".length] ^= 0xff;
  const r = extractSkillFiles(zip);
  assert.equal(r.ok, false);
  assert.match(r.error, /CRC/);
});

test("extractSkillFiles: rejects an entry whose declared size exceeds the per-file cap", () => {
  const r = extractSkillFiles(skillZip([{ name: "big.bin", data: "x", declaredUncompressed: 60 * 1024 * 1024 }]));
  assert.equal(r.ok, false);
});

test("readZipEntries: rejects encrypted / zip64 / bad central directory", () => {
  assert.throws(() => readZipEntries(Buffer.from("not a zip at all!!"), 1000), /not a zip|end-of-central/);
});

// ── plan ─────────────────────────────────────────────────────────────────────

test("planSync: install / update / up_to_date / collision / postinstall / remove / invalid", () => {
  const remote = [
    { slug: "fresh", version: "1.0.0" }, // install (no local)
    { slug: "bumped", version: "2.0.0" }, // update (local marker older)
    { slug: "same", version: "1.0.0" }, // up_to_date
    { slug: "unmanaged", version: "1.0.0" }, // collision (folder, no marker)
    { slug: "gated", version: "1.0.0", has_postinstall: true }, // postinstall_gated
    { slug: "../evil", version: "1.0.0" }, // invalid_entry
  ];
  const mk = (slug, version) => ({ slug, version, managed_by: "crustdata" });
  const locals = [
    { dirName: "bumped", marker: mk("bumped", "1.0.0") },
    { dirName: "same", marker: mk("same", "1.0.0") },
    { dirName: "unmanaged", marker: null },
    { dirName: "gone", marker: mk("gone", "1.0.0") }, // no longer granted → remove
  ];
  const byType = {};
  for (const a of planSync(remote, locals)) (byType[a.type] ??= []).push(a.slug ?? a.skill.slug);
  assert.deepEqual(byType.install, ["fresh"]);
  assert.deepEqual(byType.update, ["bumped"]);
  assert.deepEqual(byType.up_to_date, ["same"]);
  assert.deepEqual(byType.collision, ["unmanaged"]);
  assert.deepEqual(byType.postinstall_gated, ["gated"]);
  assert.deepEqual(byType.invalid_entry, ["../evil"]);
  assert.deepEqual(byType.remove, ["gone"]);
});

test("planSync: a malformed entry never triggers removal of the same-slug local copy", () => {
  const actions = planSync([{ slug: "keep", version: "" }], [{ dirName: "keep", marker: { slug: "keep", version: "1", managed_by: "crustdata" } }]);
  assert.ok(actions.some((a) => a.type === "invalid_entry"));
  assert.ok(!actions.some((a) => a.type === "remove")); // held by `keep`
});

// ── write / install / remove ──────────────────────────────────────────────────

test("writeSkillTree: every file is 0o644 — the exec bit is never honored (C6)", () => {
  const dir = tmp();
  writeSkillTree(dir, [{ path: "run.sh", data: Buffer.from("#!/bin/sh"), executable: true }]);
  assert.equal(statSync(path.join(dir, "run.sh")).mode & 0o777, 0o644);
  rmSync(dir, { recursive: true, force: true });
});

test("installSkillAtomically: fresh install then in-place update via atomic swap", () => {
  const root = tmp();
  const marker = { slug: "s", version: "1.0.0", managed_by: "crustdata" };
  installSkillAtomically({ skillsRoot: root, slug: "s", files: [{ path: "SKILL.md", data: Buffer.from("v1") }], marker });
  assert.equal(readFileSync(path.join(root, "s", "SKILL.md"), "utf8"), "v1");
  installSkillAtomically({ skillsRoot: root, slug: "s", files: [{ path: "SKILL.md", data: Buffer.from("v2") }], marker: { ...marker, version: "2.0.0" } });
  assert.equal(readFileSync(path.join(root, "s", "SKILL.md"), "utf8"), "v2");
  assert.ok(parseMarker(readFileSync(path.join(root, "s", MARKER_FILENAME), "utf8")));
  rmSync(root, { recursive: true, force: true });
});

test("installSkillAtomically: refuses to overwrite a folder that lost its marker between scan and write (C8)", () => {
  const root = tmp();
  const target = path.join(root, "s");
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "user-data.txt"), "precious"); // present, NO valid marker
  assert.throws(
    () => installSkillAtomically({ skillsRoot: root, slug: "s", files: [{ path: "SKILL.md", data: Buffer.from("x") }], marker: { slug: "s", version: "1", managed_by: "crustdata" } }),
    /no longer a Crustdata-managed folder/,
  );
  assert.equal(readFileSync(path.join(target, "user-data.txt"), "utf8"), "precious"); // untouched
  assert.ok(!existsSync(path.join(root, ".crustdata-tmp-s") + "*")); // staging cleaned
  rmSync(root, { recursive: true, force: true });
});

test("removeSkillDir: removes a managed folder, refuses an unmanaged one", () => {
  const root = tmp();
  const managed = path.join(root, "m");
  mkdirSync(managed, { recursive: true });
  writeFileSync(path.join(managed, MARKER_FILENAME), JSON.stringify({ slug: "m", version: "1", managed_by: "crustdata" }));
  assert.equal(removeSkillDir(root, "m"), true);
  assert.equal(existsSync(managed), false);

  const unmanaged = path.join(root, "u");
  mkdirSync(unmanaged, { recursive: true });
  writeFileSync(path.join(unmanaged, "readme"), "hi"); // no marker
  assert.equal(removeSkillDir(root, "u"), false);
  assert.equal(existsSync(unmanaged), true);
  rmSync(root, { recursive: true, force: true });
});

// ── isSecureBaseUrl + runSync guards ──────────────────────────────────────────

test("isSecureBaseUrl: https ok, loopback-http ok, remote-http rejected", () => {
  assert.equal(isSecureBaseUrl("https://skills.crustdata.com"), true);
  assert.equal(isSecureBaseUrl("http://127.0.0.1:8080"), true);
  assert.equal(isSecureBaseUrl("http://localhost:3000"), true);
  assert.equal(isSecureBaseUrl("http://evil.example"), false);
  assert.equal(isSecureBaseUrl("ftp://x"), false);
  assert.equal(isSecureBaseUrl("not a url"), false);
});

test("runSync: refuses a non-https base — the API key is never sent (C3)", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { status: 200, json: async () => ({ skills: [] }) };
  };
  const r = await runSync({ apiKey: "secret-key", baseUrl: "http://evil.example", pluginRoot: tmp(), fetchImpl });
  assert.equal(r.changed, false);
  assert.equal(called, false); // no request at all
});

test("runSync: no key → no-op, no request", async () => {
  let called = false;
  const r = await runSync({ apiKey: "", baseUrl: "https://skills.crustdata.com", pluginRoot: tmp(), fetchImpl: async () => ((called = true), {}) });
  assert.equal(r.changed, false);
  assert.equal(called, false);
});

test("runSync: honors the aggregate time budget — skills past it are deferred (C7)", async () => {
  const root = tmp();
  const zip = skillZip();
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/skills/sync")) {
      return { status: 200, json: async () => ({ skills: [{ slug: "a", version: "1.0.0" }, { slug: "b", version: "1.0.0" }] }) };
    }
    return { status: 200, headers: { get: () => String(zip.length) }, body: null, arrayBuffer: async () => zip };
  };
  // clock jumps past the budget after the first install → "b" is deferred.
  let t = 0;
  const clock = () => (t += 30_000);
  const r = await runSync({ apiKey: "k", baseUrl: "https://skills.crustdata.com", pluginRoot: root, fetchImpl, runBudgetMs: 40_000, clock });
  const deferred = r.results.filter((x) => x.state === "deferred").map((x) => x.slug);
  assert.deepEqual(deferred, ["b"]);
  rmSync(root, { recursive: true, force: true });
});

test("runSync: a 401 changes nothing (fail-closed, no removals without a trusted set)", async () => {
  const fetchImpl = async () => ({ status: 401, json: async () => ({ error: { type: "auth_failed" } }) });
  const r = await runSync({ apiKey: "bad", baseUrl: "https://skills.crustdata.com", pluginRoot: tmp(), fetchImpl });
  assert.equal(r.changed, false);
  assert.deepEqual(r.results, []);
});
