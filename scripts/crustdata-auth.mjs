#!/usr/bin/env node
/** The one credential touchpoint: everything else shells out here, so Claude never sees a token. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getAccessToken } from "../hooks/lib/credential-store.mjs";
import { resolveSyncEnv } from "../hooks/lib/sync-env.mjs";
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
      // Refuse a client NAMED as another, never the absence of CLAUDE_PLUGIN_ROOT: a command's
      // environment carries none, so that test refused every Claude user. The sync hook refuses
      // the same clients, so a credential stored here would be read by nothing.
      if ((await resolveSyncEnv()).client === "other") {
        process.stdout.write(
          "Sign-in is available in Claude only. This client reads the bundled skills from the package.\n",
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
