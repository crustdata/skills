#!/usr/bin/env node
/**
 * Crustdata SessionStart hook — syncs your account's skills into the plugin skills dir.
 *
 * Runs on the CLIENT with zero dependencies (Node built-ins + global fetch),
 * no install step, no interactive stdin. All real logic lives in
 * `skills-sync-core.mjs`; this shell only reads the environment, runs one sync
 * pass, and emits the SessionStart JSON signal.
 *
 * Auth: the bearer comes from CRUSTDATA_API_KEY, and only from there. The MCP server
 * authenticates separately through the client's own MCP OAuth, and that token stays
 * inside the client — a hook subprocess has no supported way to read it. No key →
 * graceful no-op: the sync is skipped, bundled skills keep working.
 *
 * Environment (see the skills-registry contract, §4):
 *   CRUSTDATA_API_KEY         — the bearer for skill sync. Unset → sync is skipped.
 *   CRUSTDATA_SKILLS_BASE_URL — backend origin override (default
 *                               https://skills.crustdata.com); used by the
 *                               local e2e harness to point at a local backend.
 *   CLAUDE_PLUGIN_ROOT        — provided by Claude Code; skills are written
 *                               ONLY under ${CLAUDE_PLUGIN_ROOT}/skills/<slug>/.
 *
 * A hook crash must never break the session: every path exits 0, and stdout
 * carries ONLY the hook JSON (all diagnostics go to stderr, key always masked).
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { hookOutput, runSync } from "./skills-sync-core.mjs";

const DEFAULT_BASE_URL = "https://skills.crustdata.com";

function logLine(message) {
  process.stderr.write(`[crustdata-skills] ${message}\n`);
}

export async function main() {
  const pluginRoot = (process.env.CLAUDE_PLUGIN_ROOT ?? "").trim();
  const envKey = (process.env.CRUSTDATA_API_KEY ?? "").trim();
  const baseUrl = (process.env.CRUSTDATA_SKILLS_BASE_URL ?? "").trim() || DEFAULT_BASE_URL;

  if (pluginRoot === "") {
    logLine("CLAUDE_PLUGIN_ROOT not set — not running outside a plugin; skipping");
    return;
  }
  if (typeof globalThis.fetch !== "function") {
    logLine("global fetch unavailable (Node 22+ required) — skipping skill sync");
    return;
  }
  // No key → runSync no-ops (it treats an empty string exactly like the historical
  // no-key path), so an unconfigured install keeps its bundled skills and stays quiet.
  const { changed } = await runSync({
    apiKey: envKey,
    baseUrl,
    pluginRoot,
    fetchImpl: globalThis.fetch,
    log: logLine,
  });
  const out = hookOutput(changed);
  if (out !== null) process.stdout.write(out + "\n");
}

// Run only when executed directly; tests import this module without side effects.
//
// Compare REAL paths. path.resolve normalizes but does not follow symlinks, while
// Node's ESM loader realpaths import.meta.url — so a plugin dir reached through any
// symlinked component (a ~/.claude kept in a dotfiles repo, a symlinked $HOME, macOS's
// /tmp) made the two sides disagree and the hook did nothing at all: no output, no
// error, exit 0. realpath can throw on a path that has since gone, so it falls back to
// the resolved form rather than taking the module down.
function realOrResolved(p) {
  const resolved = path.resolve(p);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}
const invokedAs = process.argv[1] === undefined ? "" : realOrResolved(process.argv[1]);
if (invokedAs !== "" && realOrResolved(fileURLToPath(import.meta.url)) === invokedAs) {
  try {
    await main();
  } catch (err) {
    // Fail closed but soft: base skills unaffected, session start never blocked.
    logLine(`sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(0);
}
