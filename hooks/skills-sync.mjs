#!/usr/bin/env node
/**
 * Crustdata SessionStart hook — syncs gated skills into the plugin skills dir.
 *
 * Runs on the CLIENT with zero dependencies (Node built-ins + global fetch),
 * no install step, no interactive stdin. All real logic lives in
 * `skills-sync-core.mjs`; this shell only reads the environment, runs one sync
 * pass, and emits the SessionStart JSON signal.
 *
 * Environment (documented in docs/skills-registry-contract.md §4):
 *   CRUSTDATA_API_KEY         — the caller's API key (same env the plugin's
 *                               .mcp.json references). Absent → graceful no-op:
 *                               gated sync is skipped, bundled skills keep working.
 *   CRUSTDATA_SKILLS_BASE_URL — backend origin override (default
 *                               https://skills.crustdata.com); used by the
 *                               local e2e harness to point at a local backend.
 *   CLAUDE_PLUGIN_ROOT        — provided by Claude Code; skills are written
 *                               ONLY under ${CLAUDE_PLUGIN_ROOT}/skills/<slug>/.
 *
 * A hook crash must never break the session: every path exits 0, and stdout
 * carries ONLY the hook JSON (all diagnostics go to stderr, key always masked).
 */

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
  const apiKey = (process.env.CRUSTDATA_API_KEY ?? "").trim() || undefined;
  const baseUrl = (process.env.CRUSTDATA_SKILLS_BASE_URL ?? "").trim() || DEFAULT_BASE_URL;

  if (pluginRoot === "") {
    logLine("CLAUDE_PLUGIN_ROOT not set — not running outside a plugin; skipping");
    return;
  }
  if (typeof globalThis.fetch !== "function") {
    logLine("global fetch unavailable (Node < 18?) — skipping gated skill sync");
    return;
  }
  const { changed } = await runSync({
    apiKey,
    baseUrl,
    pluginRoot,
    fetchImpl: globalThis.fetch,
    log: logLine,
  });
  const out = hookOutput(changed);
  if (out !== null) process.stdout.write(out + "\n");
}

// Run only when executed directly; tests import this module without side effects.
const invokedAs = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedAs !== "" && fileURLToPath(import.meta.url) === invokedAs) {
  try {
    await main();
  } catch (err) {
    // Fail closed but soft: base skills unaffected, session start never blocked.
    logLine(`sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(0);
}
