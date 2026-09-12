#!/usr/bin/env node
/** The one credential touchpoint: everything else shells out here, so Claude never sees a token. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getAccessToken } from "../hooks/lib/credential-store.mjs";
import { runLogin } from "./crustdata-login.mjs";

const LOGIN_HINT = "Not logged in — run /crustdata:login to connect Crustdata.";

function envKey() {
  return (process.env.CRUSTDATA_API_KEY ?? "").trim();
}

function maskTail(secret) {
  return typeof secret === "string" && secret.length > 0 ? `…${secret.slice(-4)}` : "(none)";
}

async function main(cmd) {
  switch (cmd) {
    case "login": {
      // Refuse on a client NAMED as another, never on the absence of Claude's own variable: a
      // command's environment has no CLAUDE_PLUGIN_ROOT, so that test refused every Claude user.
      // Elsewhere the sync hook ignores the store, so this would write a credential nothing reads.
      if ((process.env.GROK_PLUGIN_ROOT ?? "").trim() !== "") {
        process.stdout.write(
          "Sign-in is available in Claude only. On this client, set CRUSTDATA_API_KEY in your environment to sync your skills.\n",
        );
        return 0;
      }
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
      // Absence is fine: no nagging at session start.
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
