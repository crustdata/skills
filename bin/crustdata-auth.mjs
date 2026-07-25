#!/usr/bin/env node
/**
 * The ONE credential touchpoint for the Crustdata plugin. Server (headersHelper), hooks,
 * the /crustdata:login command, and skill scripts all shell out to this CLI — nothing else
 * reads or writes tokens, and Claude never sees one.
 *
 *   crustdata-auth login     browser OAuth (code + PKCE, loopback). Blocking; on success
 *                            prints ONE stdout line ("Logged in …") for the caller to relay.
 *   crustdata-auth refresh   rotate the access token if it's near expiry. Always exits 0,
 *                            prints nothing — safe as a silent SessionStart step.
 *   crustdata-auth check     gate: exit 0 when a usable credential exists (env key or a
 *                            valid/refreshable stored token); else exit 2 with a one-line
 *                            stderr pointing at /crustdata:login. For the PreToolUse hook.
 *   crustdata-auth token     print a valid bearer to stdout for skill scripts; exit 2 and
 *                            print nothing when there is none.
 *
 * CRUSTDATA_API_KEY, when set, satisfies check/token and skips refresh — the store is
 * bypassed entirely. Store: ${CRUSTDATA_CONFIG_DIR:-~/.crustdata}/credentials.json (0600),
 * silent refresh handled by the credential-store module.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getAccessToken } from "../hooks/lib/credential-store.mjs";
import { runLogin } from "./crustdata-login.mjs";

const LOGIN_HINT = "Not logged in — run /crustdata:login to connect Crustdata.";

function envKey() {
  return (process.env.CRUSTDATA_API_KEY ?? "").trim();
}

/** Mask a secret for display: never more than a 4-char tail. */
function maskTail(secret) {
  return typeof secret === "string" && secret.length > 0 ? `…${secret.slice(-4)}` : "(none)";
}

async function main(cmd) {
  switch (cmd) {
    case "login": {
      const code = await runLogin();
      if (code === 0) {
        const token = await getAccessToken();
        process.stdout.write(`Logged in to Crustdata (token ${maskTail(token ?? "")}) — MCP tools and skill sync are connected.\n`);
        return 0;
      }
      process.stdout.write("Crustdata login did not complete — try /crustdata:login again, or set CRUSTDATA_API_KEY.\n");
      return 1;
    }
    case "refresh": {
      // getAccessToken silently refreshes when the stored token is near expiry; absence is
      // fine (spec: no nagging at session start).
      if (envKey() === "") await getAccessToken();
      return 0;
    }
    case "check": {
      if (envKey() !== "") return 0;
      if (((await getAccessToken()) ?? "") !== "") return 0;
      process.stderr.write(`${LOGIN_HINT}\n`);
      return 2;
    }
    case "token": {
      const key = envKey();
      const token = key !== "" ? key : ((await getAccessToken()) ?? "");
      if (token === "") {
        process.stderr.write(`${LOGIN_HINT}\n`);
        return 2;
      }
      process.stdout.write(token + "\n");
      return 0;
    }
    default:
      process.stderr.write("usage: crustdata-auth <login|refresh|check|token>\n");
      return 2;
  }
}

const invokedAs = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedAs !== "" && fileURLToPath(import.meta.url) === invokedAs) {
  let code = 1;
  try {
    code = await main(process.argv[2] ?? "");
  } catch (err) {
    process.stderr.write(`crustdata-auth: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exit(code);
}
