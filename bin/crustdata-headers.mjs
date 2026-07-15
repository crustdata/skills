#!/usr/bin/env node
/**
 * MCP headersHelper for the Crustdata plugin (referenced from .mcp.json).
 *
 * Prints a JSON object of HTTP headers for the `crustdata` MCP server to
 * STDOUT and nothing else there:
 *   - logged in (or CRUSTDATA_API_KEY set) → {"Authorization":"Bearer <token>"}
 *   - otherwise → {} plus a stderr hint pointing at the login CLI
 *
 * The token comes from the shared credential store written by
 * bin/crustdata-login.mjs (silently refreshed here when expired). The
 * CRUSTDATA_API_KEY environment variable, when set, overrides the store —
 * the pre-OAuth configuration keeps working unchanged.
 *
 * ALWAYS exits 0: a missing login must degrade to an unauthenticated request
 * (the server answers 401 with its OAuth challenge), never break the client.
 * Tokens are never logged.
 */

import process from "node:process";

import { getAccessToken } from "../core/credential-store.mjs";

const envKey = (process.env.CRUSTDATA_API_KEY ?? "").trim();
const token = envKey !== "" ? envKey : await getAccessToken();

if (typeof token === "string" && token !== "") {
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }) + "\n");
} else {
  process.stdout.write("{}\n");
  process.stderr.write('[crustdata] not signed in — run: node "$CLAUDE_PLUGIN_ROOT/bin/crustdata-login.mjs"\n');
}
process.exit(0);
