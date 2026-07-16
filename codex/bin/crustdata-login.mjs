#!/usr/bin/env node
/**
 * Crustdata login launcher for Codex — a thin shell over the OAuth flow in
 * ./core/oauth-login.mjs (vendored from the repo's shared core/, the same flow
 * the Claude plugin ships). Writes the token to the shared `~/.crustdata` store
 * the SessionStart hook reads.
 *
 *   node "$PLUGIN_ROOT/bin/crustdata-login.mjs"
 *
 * (This is only for the gated-skill hook's credential; the Crustdata MCP tools
 * authenticate via Codex's own `codex mcp login crustdata`.)
 */

import process from "node:process";

import { runLogin } from "../core/oauth-login.mjs";

// DCR consent-screen label for this client (cosmetic; overrides the core default).
if (!(process.env.CRUSTDATA_CLIENT_NAME ?? "").trim()) {
  process.env.CRUSTDATA_CLIENT_NAME = "Crustdata Codex plugin";
}

let exitCode = 1;
try {
  exitCode = await runLogin();
} catch (err) {
  process.stderr.write(`[crustdata-login] login failed: ${err instanceof Error ? err.message : String(err)}\n`);
}
process.exit(exitCode);
