#!/usr/bin/env node
/**
 * Crustdata SessionStart hook: syncs your account's skills into the plugin skills dir.
 * The environment it reads is the skills-registry contract, §4.
 *
 * Runs on the CLIENT, so it must stay on Node built-ins and global fetch: no install step
 * and no dependency may be added here.
 *
 * The token `/crustdata:login` stores IS a Crustdata API key, because the client's own MCP
 * OAuth token is unreachable from a hook subprocess.
 *
 * A hook crash must never break the session: every path exits 0, and stdout carries ONLY
 * the hook JSON, with diagnostics on stderr and the key always masked.
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

  if (client === "other") {
    logLine("skill sync is Claude only; this client reads the bundled skills from the package — skipping");
    return;
  }
  if (pluginRoot === "") {
    logLine("no plugin root in the environment — not running outside a plugin; skipping");
    return;
  }
  if (typeof globalThis.fetch !== "function") {
    logLine("global fetch unavailable (Node 22+ required) — skipping skill sync");
    return;
  }
  // An empty key is not an error: runSync no-ops, so an unconfigured install keeps its
  // bundled skills and stays quiet.
  const { changed, results } = await runSync({
    apiKey,
    baseUrl,
    pluginRoot,
    fetchImpl: globalThis.fetch,
    log: logLine,
    // Nothing relays this one, and a bounded slug would hide the publish bug it exists to show.
    quote: (value) => JSON.stringify(String(value ?? "")).slice(0, 200),
  });
  const out = hookOutput(changed, results);
  if (out !== null) process.stdout.write(out + "\n");
}

// Run only when executed directly; tests import this module without side effects.
//
// Compare REAL paths: Node's ESM loader realpaths import.meta.url while path.resolve does not
// follow symlinks, so ANY symlinked component silently disables the hook. realpath throws on a
// path that has since gone, hence the fallback.
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
