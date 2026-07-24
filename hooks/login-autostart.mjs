#!/usr/bin/env node
/**
 * SessionStart hook: if there's no valid Crustdata token, fire the browser login once —
 * detached and silent (no model turn, no output). The browser opens; once you're signed in
 * the stored token is valid and this no-ops on later sessions. If CRUSTDATA_API_KEY is set,
 * or a valid (refreshable) token is already stored, it does nothing.
 *
 * Zero dependencies. Never throws to the caller — a hook error must not break the session.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getAccessToken } from "./lib/credential-store.mjs";

async function main() {
  const pluginRoot = (process.env.CLAUDE_PLUGIN_ROOT ?? "").trim();
  if (pluginRoot === "") return; // not running inside the plugin

  if ((process.env.CRUSTDATA_API_KEY ?? "").trim() !== "") return; // explicit key → authenticated
  if (((await getAccessToken()) ?? "") !== "") return; // valid/refreshed stored token → done

  // Not signed in → open the browser login, detached (survives this hook) and silent.
  try {
    const child = spawn(process.execPath, [path.join(pluginRoot, "bin", "crustdata-login.mjs"), "--detach"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    /* best effort — a failed spawn must not break the session */
  }
}

const invokedAs = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedAs !== "" && fileURLToPath(import.meta.url) === invokedAs) {
  try {
    await main();
  } catch {
    /* never break the session on a hook error */
  }
  process.exit(0);
}
