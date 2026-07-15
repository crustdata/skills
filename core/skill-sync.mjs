/**
 * Core logic of the Crustdata SessionStart skill-sync hook.
 *
 * This file runs on the CLIENT (Claude Code CLI / Claude Desktop) with zero
 * runtime dependencies — Node built-ins only, no install step, no build step.
 * It is plain JavaScript on purpose; the sibling `.d.mts` carries the types so
 * the repo's TypeScript tests can import it without `allowJs`.
 *
 * The entry point (`skills-sync.mjs`) stays a thin shell around `runSync` so
 * everything here is testable with an injected `fetchImpl` and a temp dir —
 * no network, no real backend.
 *
 * Wire contract (docs/skills-registry-contract.md §2/§4):
 *   GET  /skills/sync                → the granted set, resolved to versions
 *   GET  /skills/:slug/content      → 302 to a presigned zip download (or the
 *                                      raw zip on the FS store); the hook
 *                                      downloads and unzips it itself
 */

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

// CRC-32 (IEEE 802.3, poly 0xEDB88320) — the zip entry checksum. Hand-rolled so
// the hook keeps its Node >=18 floor: node:zlib's `crc32` export only exists on
// Node >=20.15/22.2, and this hook ships to client machines that may run 18.
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Per-skill marker proving a folder is Crustdata-managed (contract §4). */
export const MARKER_FILENAME = ".crustdata-lock";
/** Staging dirs for the atomic install swap; always safe to delete. */
export const TEMP_PREFIX = ".crustdata-tmp-";
/** Displaced previous versions mid-swap; always safe to delete. */
export const OLD_PREFIX = ".crustdata-old-";

// Download/extraction budget — mirrors the server's publish-time caps
// (src/skills/zip/validate.ts): 50MB zip, 200MB uncompressed total, 50MB per
// file. A served artifact within publish limits always fits; anything larger
// is refused client-side before it can balloon memory or disk.
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// ── small pure helpers ───────────────────────────────────────────────────────

/** Mask an API key for logs: never more than a 4-char tail. */
export function maskKey(key) {
  if (typeof key !== "string" || key.length === 0) return "(none)";
  return `…${key.slice(-4)}`;
}

/**
 * The backend origin must be https (loopback-http allowed for the local e2e
 * harness) before we attach the live store bearer to a request — a hostile
 * CRUSTDATA_SKILLS_BASE_URL must not be able to forward the key to any origin (C3).
 */
export function isSecureBaseUrl(s) {
  let u;
  try {
    u = new URL(String(s));
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1" || u.hostname === "[::1]");
}

// Aggregate wall-clock budget for one sync pass, kept safely under the hook's
// 60s SessionStart timeout (hooks/hooks.json). N granted skills download
// sequentially; without an aggregate cap a slow/large set would freeze session
// start (C7). Skills past the budget are deferred to the next session.
export const RUN_BUDGET_MS = 45_000;

/**
 * A slug is used verbatim as a directory name under the plugin skills root, so
 * it must be a single safe path segment: alphanumeric start, then [a-z0-9._-].
 * Anything else from the server is refused client-side (defense in depth — the
 * backend validates slugs at publish too).
 */
export function isSafeSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(slug);
}

/**
 * Zip entry paths are written relative to the skill folder. Reject anything
 * that could escape it: absolute paths, drive letters, backslashes, `.`/`..`
 * segments, empty segments, NUL. The top-level marker filename is reserved so
 * served content can never impersonate our lock.
 */
export function isSafeRelPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 1024) return false;
  if (p.includes("\0") || p.includes("\\") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  const segments = p.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return false;
  }
  // Reserve the marker name CASE-INSENSITIVELY: on a case-insensitive FS
  // (APFS/NTFS) a served `.Crustdata-Lock` would otherwise land on top of our
  // `.crustdata-lock` and impersonate the trust marker.
  if (segments[0].toLowerCase() === MARKER_FILENAME.toLowerCase()) return false;
  return true;
}

/**
 * Parse + shape-validate a marker document. Returns the marker object or null;
 * never throws. A marker is only trusted when `managed_by === "crustdata"` and
 * the identifying fields are non-empty strings — anything less and the folder
 * is treated as NOT ours (contract §4: never touch unmanaged folders).
 */
export function parseMarker(text) {
  let doc;
  try {
    doc = JSON.parse(String(text));
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const { slug, version, managed_by } = doc;
  if (managed_by !== "crustdata") return null;
  if (typeof slug !== "string" || slug === "") return null;
  if (typeof version !== "string" || version === "") return null;
  return doc;
}

/**
 * A marker is only valid FOR A GIVEN FOLDER when its slug matches the folder
 * name — a copied/renamed folder keeps its marker file but stops being managed,
 * so we neither update nor delete it.
 */
export function isValidMarker(marker, dirName) {
  return marker !== null && marker !== undefined && marker.slug === dirName;
}

// ── zip reader (ported from src/skills/zip/reader.ts) ───────────────────────
// Minimal, dependency-free zip reader driven by the central directory. Scope is
// deliberately narrow — the publish pipeline produces plain deterministic zips —
// and everything outside that scope is REJECTED, not tolerated: encryption,
// zip64, multi-disk archives, and compression methods other than stored/deflate.
// Decompression is bounded via inflateRawSync's maxOutputLength, so a lying
// size field can't balloon memory.

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_EOCD_SCAN = 65_557 + 22; // max comment length + fixed EOCD size

export class ZipFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipFormatError";
  }
}

export function readZipEntries(zip, maxEntryBytes) {
  const eocd = findEocd(zip);
  const totalEntries = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt16LE(eocd + 4) !== 0 || zip.readUInt16LE(eocd + 6) !== 0) {
    throw new ZipFormatError("multi-disk archives are not supported");
  }
  if (cdOffset + cdSize > zip.length) throw new ZipFormatError("central directory out of bounds");

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== CD_SIG) {
      throw new ZipFormatError("malformed central directory");
    }
    const versionMadeBy = zip.readUInt16LE(p + 4);
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const uncompressedSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const externalAttrs = zip.readUInt32LE(p + 38);
    const localOffset = zip.readUInt32LE(p + 42);
    const crc = zip.readUInt32LE(p + 16);

    if ((flags & 0x0001) !== 0) throw new ZipFormatError("encrypted entries are not supported");
    if (method !== 0 && method !== 8) throw new ZipFormatError(`unsupported compression method ${method}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipFormatError("zip64 archives are not supported");
    }
    if (p + 46 + nameLen > zip.length) throw new ZipFormatError("malformed central directory");
    const nameBytes = zip.subarray(p + 46, p + 46 + nameLen);
    if (nameBytes.includes(0)) throw new ZipFormatError("entry name contains NUL");
    const name = nameBytes.toString("utf8");

    // Unix external attrs carry the file mode in the high 16 bits; 0xA000 = symlink.
    const isUnix = versionMadeBy >>> 8 === 3;
    const unixMode = externalAttrs >>> 16;
    const isSymlink = isUnix && (unixMode & 0xf000) === 0xa000;
    const executable = isUnix && (unixMode & 0o100) !== 0; // owner-execute
    const isDirectory = name.endsWith("/");

    entries.push({
      name,
      isDirectory,
      isSymlink,
      executable,
      compressedSize,
      uncompressedSize,
      read: () => readEntryData(zip, name, localOffset, method, compressedSize, uncompressedSize, crc, maxEntryBytes),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEocd(zip) {
  if (zip.length < 22) throw new ZipFormatError("not a zip file");
  const stop = Math.max(0, zip.length - MAX_EOCD_SCAN);
  for (let i = zip.length - 22; i >= stop; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipFormatError("end-of-central-directory record not found");
}

function readEntryData(zip, name, localOffset, method, compressedSize, uncompressedSize, crc, maxEntryBytes) {
  if (uncompressedSize > maxEntryBytes) {
    throw new ZipFormatError(`entry ${name} exceeds per-file size limit`);
  }
  if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new ZipFormatError(`malformed local header for ${name}`);
  }
  const nameLen = zip.readUInt16LE(localOffset + 26);
  const extraLen = zip.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  if (dataStart + compressedSize > zip.length) {
    throw new ZipFormatError(`entry data out of bounds for ${name}`);
  }
  const raw = zip.subarray(dataStart, dataStart + compressedSize);

  let data;
  if (method === 0) {
    data = Buffer.from(raw);
  } else {
    try {
      data = inflateRawSync(raw, { maxOutputLength: maxEntryBytes });
    } catch {
      throw new ZipFormatError(`entry ${name} failed to decompress within limits`);
    }
  }
  if (data.length !== uncompressedSize) {
    throw new ZipFormatError(`entry ${name} size mismatch (declared ${uncompressedSize}, actual ${data.length})`);
  }
  if ((crc32(data) >>> 0) !== crc) {
    throw new ZipFormatError(`entry ${name} failed CRC check`);
  }
  return data;
}

// ── local state scan ─────────────────────────────────────────────────────────

/**
 * Scan the skills root for candidate skill folders. Dot-directories (including
 * our own temp/old staging dirs) are skipped; symlinks are NOT followed — a
 * symlinked entry reports `marker: null`, so it can never be updated or removed.
 * Returns [] when the root doesn't exist yet.
 */
export function readLocalSkills(skillsRoot) {
  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const locals = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    let marker = null;
    try {
      const raw = readFileSync(path.join(skillsRoot, ent.name, MARKER_FILENAME), "utf8");
      const parsed = parseMarker(raw);
      if (isValidMarker(parsed, ent.name)) marker = parsed;
    } catch {
      /* unreadable/absent marker → not ours */
    }
    locals.push({ dirName: ent.name, marker });
  }
  return locals;
}

// ── reconcile plan (pure) ────────────────────────────────────────────────────

/**
 * Compute the reconcile plan from the sync response and the local scan.
 * Pure: no I/O, fully unit-testable.
 *
 * Per remote skill (in response order):
 *   - malformed entry            → invalid_entry (skipped; suppresses removal)
 *   - folder present, no marker  → collision (needs_permission, never overwrite)
 *   - marker matches version     → up_to_date (no writes, no report)
 *   - has_postinstall            → postinstall_gated (needs_permission, no install)
 *   - no folder                  → install
 *   - marker version differs     → update
 * Then: every locally-managed folder not in the response → remove.
 *
 * Change-detection is by version string: a published (slug, version) is
 * immutable server-side, so a differing version is the only "update" signal.
 */
export function planSync(remoteSkills, locals) {
  const actions = [];
  const seen = new Set();
  /** Slugs that must never be removed this run, even if not actionable. */
  const keep = new Set();
  const byDir = new Map(locals.map((l) => [l.dirName, l]));

  for (const skill of Array.isArray(remoteSkills) ? remoteSkills : []) {
    const slug = skill === null || typeof skill !== "object" ? undefined : skill.slug;
    const wellFormed =
      isSafeSlug(slug) &&
      typeof skill.version === "string" && skill.version !== "";
    if (!wellFormed) {
      // A malformed entry must not cascade into deleting the local copy it
      // failed to describe — hold the slug (when it is at least a string).
      if (typeof slug === "string") keep.add(slug);
      actions.push({ type: "invalid_entry", slug: typeof slug === "string" ? slug : "(unknown)" });
      continue;
    }
    if (seen.has(slug)) continue; // duplicate entries: first one wins
    seen.add(slug);

    const local = byDir.get(slug);
    if (local !== undefined && local.marker === null) {
      actions.push({ type: "collision", skill });
      continue;
    }
    const marker = local?.marker ?? null;
    if (marker !== null && marker.version === skill.version) {
      actions.push({ type: "up_to_date", skill });
      continue;
    }
    if (skill.has_postinstall === true) {
      // Gated skills never auto-run a postinstall; we also never half-install
      // a skill whose setup step didn't run (contract: needs_permission).
      actions.push({ type: "postinstall_gated", skill });
      continue;
    }
    actions.push(marker !== null ? { type: "update", skill } : { type: "install", skill });
  }

  for (const local of locals) {
    if (local.marker === null) continue; // not ours — never touch
    if (seen.has(local.dirName) || keep.has(local.dirName)) continue;
    actions.push({ type: "remove", slug: local.dirName, marker: local.marker });
  }
  return actions;
}

// ── zip extraction (path-validated) ──────────────────────────────────────────

/**
 * Turn a downloaded skill zip into the verified file list the install machinery
 * writes. Every check failing aborts THIS skill only. Integrity here is
 * structural: each entry path must be safe to write under the skill folder,
 * symlinks are refused, and the publish-time size budget is re-enforced. There
 * is no server-provided hash to compare against — at-rest integrity is the
 * object store's checksum, in-flight is HTTPS, and this path validation is what
 * stands between served bytes and the local disk.
 */
export function extractSkillFiles(zip) {
  let entries;
  try {
    entries = readZipEntries(zip, MAX_FILE_BYTES);
  } catch (err) {
    return { ok: false, error: `unreadable zip: ${err instanceof Error ? err.message : String(err)}` };
  }
  const files = [];
  let total = 0;
  for (const entry of entries) {
    if (entry.isSymlink) return { ok: false, error: `symlink entry refused: ${entry.name}` };
    if (entry.isDirectory) continue; // files carry their own paths
    if (!isSafeRelPath(entry.name)) return { ok: false, error: `unsafe entry path: ${entry.name}` };
    total += entry.uncompressedSize;
    if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      return { ok: false, error: `uncompressed total exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes` };
    }
    let data;
    try {
      data = entry.read();
    } catch (err) {
      return { ok: false, error: `unreadable zip entry ${entry.name}: ${err instanceof Error ? err.message : String(err)}` };
    }
    files.push({ path: entry.name, data, executable: entry.executable === true });
  }
  if (files.length === 0) return { ok: false, error: "zip has no files" };
  return { ok: true, files };
}

// ── filesystem: write, swap, remove ──────────────────────────────────────────

/**
 * Write verified files under destDir. Every file is written 0o644 — the zip's
 * executable bit is deliberately NOT honored: a Claude skill is data (SKILL.md +
 * references), no bundled skill needs +x, and a served zip must not be able to
 * plant executable files in the plugin tree (least-privilege; C6/C18). destDir
 * must be a fresh staging dir.
 */
export function writeSkillTree(destDir, files) {
  for (const file of files) {
    const full = path.join(destDir, file.path);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, file.data, { mode: 0o644 });
  }
}

/**
 * Stage-then-swap install. Files land in a sibling temp dir first (same
 * filesystem, so `rename` is atomic); the live folder is only ever replaced by
 * a COMPLETE, verified tree. Any failure cleans the staging dir and — for
 * updates — rolls the previous version back into place, so a partial write can
 * never leave a half-installed skill (contract §4).
 */
export function installSkillAtomically({ skillsRoot, slug, files, marker }) {
  mkdirSync(skillsRoot, { recursive: true });
  const nonce = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const tmp = path.join(skillsRoot, `${TEMP_PREFIX}${slug}-${nonce}`);
  const target = path.join(skillsRoot, slug);
  try {
    writeSkillTree(tmp, files);
    writeFileSync(path.join(tmp, MARKER_FILENAME), JSON.stringify(marker, null, 2) + "\n", { mode: 0o644 });
    if (existsSync(target)) {
      // Re-validate the live folder's marker at WRITE time — the plan is up to a
      // few seconds stale, and "never touch an unmanaged folder" (contract §4)
      // must hold against a folder that stopped being ours between scan and now.
      let liveMarker = null;
      try {
        liveMarker = parseMarker(readFileSync(path.join(target, MARKER_FILENAME), "utf8"));
      } catch {
        /* unreadable/absent → not ours */
      }
      if (!isValidMarker(liveMarker, slug)) {
        rmSync(tmp, { recursive: true, force: true });
        throw new Error(`refusing to overwrite skills/${slug}: it is no longer a Crustdata-managed folder`);
      }
      const old = path.join(skillsRoot, `${OLD_PREFIX}${slug}-${nonce}`);
      renameSync(target, old);
      try {
        renameSync(tmp, target);
      } catch (err) {
        renameSync(old, target); // roll the previous version back
        throw err;
      }
      rmSync(old, { recursive: true, force: true });
    } else {
      renameSync(tmp, target);
    }
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Remove a managed skill folder. The marker is re-validated at delete time so
 * we never `rm -rf` a folder that stopped being ours between scan and action.
 * Returns true when the folder was removed.
 */
export function removeSkillDir(skillsRoot, slug) {
  if (!isSafeSlug(slug)) return false;
  const target = path.join(skillsRoot, slug);
  let marker;
  try {
    marker = parseMarker(readFileSync(path.join(target, MARKER_FILENAME), "utf8"));
  } catch {
    return false;
  }
  if (!isValidMarker(marker, slug)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

/** Best-effort sweep of staging leftovers from an interrupted previous run. */
export function cleanupStaleDirs(skillsRoot) {
  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(TEMP_PREFIX) || ent.name.startsWith(OLD_PREFIX)) {
      try {
        rmSync(path.join(skillsRoot, ent.name), { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}

// ── orchestrator ─────────────────────────────────────────────────────────────

async function fetchJson(fetchImpl, url, apiKey, timeoutMs, init = {}) {
  const res = await fetchImpl(url, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/**
 * Download one skill zip from /content. The Bearer key authorizes the request;
 * `redirect: "follow"` is explicit because the deployed flow DEPENDS on it —
 * the backend answers with a 302 to a short-lived presigned S3 URL, and undici
 * strips the Authorization header on that cross-origin hop (verified), so S3
 * sees only the presigned query auth. The FS/dev backend answers 200 with the
 * zip same-origin instead. Returns the zip bytes or an error string; the 50MB
 * budget is enforced both from the declared content-length and the actual body.
 */
async function fetchZip(fetchImpl, url, apiKey, timeoutMs) {
  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${apiKey}` },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status !== 200) return { ok: false, error: `content download failed (status ${res.status})` };
  const declared = Number(res.headers?.get?.("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_ZIP_BYTES) {
    return { ok: false, error: `zip download exceeds ${MAX_ZIP_BYTES} bytes` };
  }
  // Stream with a HARD running cap: content-length is advisory, so a backend
  // that omits or lies about it must not be able to force an unbounded buffer
  // (bandwidth × the request timeout) on every session start (C5). Abort the
  // read the moment the accumulated body crosses the limit.
  const body = res.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_ZIP_BYTES) {
          await reader.cancel().catch(() => {});
          return { ok: false, error: `zip download exceeds ${MAX_ZIP_BYTES} bytes` };
        }
        chunks.push(Buffer.from(value));
      }
    } catch (err) {
      return { ok: false, error: `zip download failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { ok: true, zip: Buffer.concat(chunks, total) };
  }
  // Non-streaming response (e.g. a test fake) — buffer, then re-check the size.
  const zip = Buffer.from(await res.arrayBuffer());
  if (zip.length > MAX_ZIP_BYTES) {
    return { ok: false, error: `zip download exceeds ${MAX_ZIP_BYTES} bytes` };
  }
  return { ok: true, zip };
}

/**
 * One full sync pass. Fail-closed and fail-soft: any error confines itself to
 * the affected skill (or to this run), never corrupts local state, and never
 * throws for per-skill problems. Only truly unexpected faults propagate — the
 * entry point catches those and still exits 0.
 *
 * Returns { changed, results }: `changed` is true iff a mutation (install /
 * update / remove) SUCCEEDED — the caller emits the reloadSkills signal from it.
 */
export async function runSync({ apiKey, baseUrl, pluginRoot, fetchImpl, log = () => {}, now = () => new Date(), timeoutMs = 10_000, runBudgetMs = RUN_BUDGET_MS, clock = () => Date.now() }) {
  // No key → no identity → gated sync is skipped entirely. Bundled base skills
  // are untouched and previously-fetched skills stay as-is (contract §6).
  if (typeof apiKey !== "string" || apiKey === "") {
    log("no CRUSTDATA_API_KEY in the environment — skipping gated skill sync");
    return { changed: false, results: [] };
  }
  // Never attach the live bearer to an insecure/hostile origin (C3).
  if (!isSecureBaseUrl(baseUrl)) {
    log(`refusing to sync against a non-https base URL (${baseUrl}) — the API key would leak`);
    return { changed: false, results: [] };
  }
  const runDeadline = clock() + runBudgetMs;
  const base = String(baseUrl).replace(/\/+$/, "");
  const skillsRoot = path.join(pluginRoot, "skills");
  cleanupStaleDirs(skillsRoot);

  let sync;
  try {
    sync = await fetchJson(fetchImpl, `${base}/skills/sync`, apiKey, timeoutMs);
  } catch (err) {
    log(`sync request failed (key ${maskKey(apiKey)}): ${err instanceof Error ? err.message : String(err)}`);
    return { changed: false, results: [] };
  }
  if (sync.status !== 200 || sync.body === null || !Array.isArray(sync.body.skills)) {
    // 401 (bad key), 5xx, HTML error page … all take the same exit: log, change
    // nothing (removals included — without a trusted set we cannot know what
    // should go).
    const detail = sync.body?.error?.type ?? "unexpected response";
    log(`sync did not return a usable skill set (status ${sync.status}, ${detail}) — leaving local skills untouched`);
    return { changed: false, results: [] };
  }

  // Accepted risk (C13): an authoritative empty `{"skills":[]}` legitimately
  // removes every managed skill (a full de-grant), so a backend that can forge
  // this response could wipe the managed set. That backend is pinned to https +
  // the trusted origin (isSecureBaseUrl above) and the delete only ever touches
  // folders carrying our own validated marker — bundled/unmanaged skills are
  // never removed — so the blast radius is "re-sync to restore," not data loss.
  const locals = readLocalSkills(skillsRoot);
  const actions = planSync(sync.body.skills, locals);
  const results = [];
  let changed = false;

  for (const action of actions) {
    if (action.type === "invalid_entry") {
      log(`skipping malformed sync entry for "${action.slug}"`);
      continue;
    }
    if (action.type === "up_to_date") {
      results.push({ slug: action.skill.slug, version: action.skill.version, state: "up_to_date" });
      continue;
    }
    if (action.type === "collision") {
      const { slug, version } = action.skill;
      log(`skills/${slug} exists but is not Crustdata-managed — not overwriting`);
      results.push({ slug, version, state: "needs_permission", error: `local folder "skills/${slug}" exists without a Crustdata marker; refusing to overwrite` });
      continue;
    }
    if (action.type === "postinstall_gated") {
      const { slug, version } = action.skill;
      log(`skills/${slug}@${version} declares a postinstall step — not installing without permission`);
      results.push({ slug, version, state: "needs_permission", error: "version has a postinstall step; automatic install is disabled" });
      continue;
    }
    if (action.type === "remove") {
      try {
        if (removeSkillDir(skillsRoot, action.slug)) {
          changed = true;
          log(`removed skills/${action.slug} (no longer granted)`);
          results.push({ slug: action.slug, version: action.marker.version, state: "removed" });
        }
      } catch (err) {
        results.push({ slug: action.slug, version: action.marker.version, state: "failed", error: `remove failed: ${err instanceof Error ? err.message : String(err)}` });
      }
      continue;
    }

    // install | update — download the zip, extract with path validation, swap.
    const { slug, version } = action.skill;
    // Stop starting new downloads once the aggregate budget is spent — the
    // remaining skills sync on the next session start rather than risk freezing
    // this one past the hook timeout (C7).
    if (clock() >= runDeadline) {
      log(`time budget (${runBudgetMs}ms) reached — deferring skills/${slug} to the next session`);
      results.push({ slug, version, state: "deferred" });
      continue;
    }
    const state = action.type === "update" ? "updated" : "installed";
    try {
      const download = await fetchZip(fetchImpl, `${base}/skills/${encodeURIComponent(slug)}/content`, apiKey, timeoutMs);
      if (!download.ok) {
        results.push({ slug, version, state: "failed", error: download.error });
        continue;
      }
      const extracted = extractSkillFiles(download.zip);
      if (!extracted.ok) {
        results.push({ slug, version, state: "failed", error: extracted.error });
        continue;
      }
      installSkillAtomically({
        skillsRoot,
        slug,
        files: extracted.files,
        marker: { slug, version, managed_by: "crustdata", last_synced: now().toISOString() },
      });
      changed = true;
      log(`${state} skills/${slug}@${version}`);
      results.push({ slug, version, state });
    } catch (err) {
      results.push({ slug, version, state: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { changed, results };
}
