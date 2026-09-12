#!/usr/bin/env node
/**
 * Crustdata SessionStart hook — syncs your account's skills into the plugin skills dir.
 *
 * Runs on the CLIENT with zero dependencies (Node built-ins + global fetch),
 * no install step, no interactive stdin. All real logic lives in
 * `skills-sync-core.mjs`; this shell only reads the environment, runs one sync
 * pass, and emits the SessionStart JSON signal.
 *
 * Auth: CRUSTDATA_API_KEY, else the token `/crustdata:login` stored, which IS a Crustdata API key (mcp2 issues the key as the access_token, ADR-0004) because the client's own MCP OAuth token is unreachable from a hook subprocess.
 *
 * Environment (see the skills-registry contract, §4):
 *   CRUSTDATA_API_KEY         — the bearer on every client; overrides a stored token, and the only source on Grok.
 *   CRUSTDATA_SKILLS_BASE_URL — backend origin override (default
 *                               https://skills.crustdata.com); used by the
 *                               local e2e harness to point at a local backend.
 *   GROK_PLUGIN_ROOT,         — the installed plugin dir; skills are written ONLY under
 *   CLAUDE_PLUGIN_ROOT          <plugin root>/skills/<slug>/. Each client is read under
 *                               its own name first, then the Claude one.
 *
 * A hook crash must never break the session: every path exits 0, and stdout
 * carries ONLY the hook JSON (all diagnostics go to stderr, key always masked).
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveSyncEnv } from "./lib/sync-env.mjs";
import { hookOutput, runSync } from "./skills-sync-core.mjs";

function logLine(message) {
  process.stderr.write(`[crustdata-skills] ${message}\n`);
}

export async function main() {
  const { client, pluginRoot, apiKey, baseUrl } = await resolveSyncEnv();

  if (pluginRoot === "") {
    logLine("no plugin root in the environment — not running outside a plugin; skipping");
    return;
  }
  if (typeof globalThis.fetch !== "function") {
    logLine("global fetch unavailable (Node 22+ required) — skipping skill sync");
    return;
  }
  // No key → runSync no-ops (it treats an empty string exactly like the historical
  // no-key path), so an unconfigured install keeps its bundled skills and stays quiet.
  const { changed, results } = await runSync({
    apiKey,
    baseUrl,
    pluginRoot,
    fetchImpl: globalThis.fetch,
    log: logLine,
    // Nothing relays this one, and a bounded slug would hide the publish bug it exists to show.
    quote: (value) => JSON.stringify(String(value ?? "")).slice(0, 200),
  });
  // The JSON carries reloadSkills and, when something was installed, updated or removed,
  // the one line Claude passes on to the user.
  const out = hookOutput(changed, results);
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
