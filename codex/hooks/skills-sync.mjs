#!/usr/bin/env node
/**
 * Crustdata Codex SessionStart hook — syncs gated per-account skills into the
 * plugin skills dir, reusing the shared client-agnostic engine in ../../core.
 * The Claude twin (hooks/skills-sync.mjs) is identical except for the env var
 * (PLUGIN_ROOT vs CLAUDE_PLUGIN_ROOT) and the session-start signal shape.
 *
 * Zero dependencies (Node built-ins + global fetch), no install step. A crash
 * must never break the session: every path exits 0; stdout carries ONLY the
 * Codex hook JSON, all diagnostics go to stderr, the token is never logged.
 *
 * Auth: the bearer comes from the shared credential store written by
 * `bin/crustdata-login.mjs` (silently refreshed) — the SAME `~/.crustdata`
 * store the Claude plugin uses. Codex's own MCP OAuth (`codex mcp login`) is a
 * SEPARATE credential for the MCP tools; a hook cannot read it, so gated sync
 * needs this login too. Absent/empty → graceful no-op (bundled skills unaffected).
 *
 * Environment:
 *   PLUGIN_ROOT               — provided by Codex; skills are written under
 *                               ${PLUGIN_ROOT}/skills/<slug>/.
 *   CRUSTDATA_API_KEY         — optional override; wins over the credential store.
 *   CRUSTDATA_SKILLS_BASE_URL — backend origin override (default below).
 */

import process from "node:process";

import { getAccessToken } from "../../core/credential-store.mjs";
import { runSync } from "../../core/skill-sync.mjs";

const DEFAULT_BASE_URL = "https://skills.crustdata.com";

function logLine(message) {
  process.stderr.write(`[crustdata-skills] ${message}\n`);
}

/**
 * Codex SessionStart signal: JSON with `additionalContext` (injected as context
 * for this turn). Freshly-written SKILL.md folders register at the NEXT Codex
 * start (discovery is at startup), so this note tells the agent they landed.
 */
function hookOutput(changed) {
  if (!changed) return null;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        "Crustdata gated skills were synced into this plugin; they become selectable on the next Codex session.",
    },
  });
}

async function main() {
  const pluginRoot = (process.env.PLUGIN_ROOT ?? "").trim();
  const envKey = (process.env.CRUSTDATA_API_KEY ?? "").trim();
  const baseUrl = (process.env.CRUSTDATA_SKILLS_BASE_URL ?? "").trim() || DEFAULT_BASE_URL;

  if (pluginRoot === "") {
    logLine("PLUGIN_ROOT not set — not running inside a Codex plugin; skipping");
    return;
  }
  if (typeof globalThis.fetch !== "function") {
    logLine("global fetch unavailable (Node < 18?) — skipping gated skill sync");
    return;
  }
  const apiKey = envKey !== "" ? envKey : ((await getAccessToken()) ?? undefined);
  if (apiKey === undefined) {
    logLine(`not signed in — to enable gated skills, run: node "${pluginRoot}/bin/crustdata-login.mjs"`);
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

try {
  await main();
} catch (err) {
  // Fail closed but soft: bundled skills unaffected, session start never blocked.
  logLine(`sync failed: ${err instanceof Error ? err.message : String(err)}`);
}
process.exit(0);
