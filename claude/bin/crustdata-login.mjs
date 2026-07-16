#!/usr/bin/env node
/**
 * Crustdata login launcher — a thin shell over the shared OAuth flow in
 * ../core/oauth-login.mjs (reused by the Claude and Codex plugins).
 *
 *   node "$CLAUDE_PLUGIN_ROOT/bin/crustdata-login.mjs"
 *
 * Exits with runLogin's status; a thrown error is logged (no secrets) → exit 1.
 */

import process from "node:process";

import { runLogin } from "../core/oauth-login.mjs";

let exitCode = 1;
try {
  exitCode = await runLogin();
} catch (err) {
  process.stderr.write(`[crustdata-login] login failed: ${err instanceof Error ? err.message : String(err)}\n`);
}
process.exit(exitCode);
