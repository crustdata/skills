#!/usr/bin/env node
/**
 * UserPromptSubmit hook: when the user's WHOLE prompt is "crustdata login" (case/space
 * tolerant), fire the detached browser login and BLOCK the prompt — so there is no model
 * turn and no chatter. Every other prompt passes through untouched (no output).
 *
 * Zero dependencies. Never throws to the caller: a hook error must not eat a real prompt,
 * so on any problem we emit nothing and exit 0 (the prompt proceeds normally).
 *
 * Block contract (UserPromptSubmit): stdout a JSON object with decision "block" and an
 * empty reason, exit 0 — the prompt is discarded before the model sees it. The login runs
 * via `crustdata-login.mjs --detach`, which re-spawns itself detached and returns instantly,
 * so this hook never blocks the UI.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** True only when the entire prompt is the login trigger — strict, so normal prompts that
 *  merely mention "crustdata login" (e.g. "how do I do crustdata login?") never fire it. */
export function isLoginTrigger(prompt) {
  return /^\s*crustdata\s+login\s*$/i.test(typeof prompt === "string" ? prompt : "");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let prompt = "";
  try {
    const parsed = JSON.parse((await readStdin()) || "{}");
    prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
  } catch {
    return; // unreadable input → let the prompt proceed
  }
  if (!isLoginTrigger(prompt)) return; // pass through untouched

  const pluginRoot = (process.env.CLAUDE_PLUGIN_ROOT ?? "").trim();
  if (pluginRoot !== "") {
    try {
      const child = spawn(process.execPath, [path.join(pluginRoot, "bin", "crustdata-login.mjs"), "--detach"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {
      /* if we can't spawn, still block quietly — the user can retry */
    }
  }
  // Stop the prompt from reaching the model as quietly as possible. `decision:"block"` works but
  // prints Claude Code's "blocked by hook" banner; `continue:false` halts through a different path
  // that may not, and `suppressOutput:true` hides our own stdout. (If a banner still shows, the
  // fully-silent alternative is a SessionStart auto-login.)
  process.stdout.write(JSON.stringify({ continue: false, suppressOutput: true }));
}

const invokedAs = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedAs !== "" && fileURLToPath(import.meta.url) === invokedAs) {
  await main();
  process.exit(0);
}
