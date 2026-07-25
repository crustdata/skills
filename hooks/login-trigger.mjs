#!/usr/bin/env node
/**
 * UserPromptSubmit hook: typing exactly "crustdata login" fires the detached browser
 * login and rejects the prompt via EXIT CODE 2 with EMPTY stderr.
 *
 * Why exit 2: it is the documented UserPromptSubmit block path whose only user-visible
 * surface is the stderr text ("rejects and erases the prompt; stderr is shown") — so an
 * empty stderr renders NOTHING: no model turn, no "blocked/stopped by hook" banner (those
 * belong to the JSON decision/continue paths), no chatter. The browser opening is the
 * feedback. Every other prompt passes through untouched (exit 0, no output).
 *
 * Zero dependencies; never breaks a real prompt — any problem on the non-trigger path
 * exits 0 silently so the prompt proceeds.
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
    return 0; // unreadable input → let the prompt proceed
  }
  if (!isLoginTrigger(prompt)) return 0; // pass through untouched

  const pluginRoot = (process.env.CLAUDE_PLUGIN_ROOT ?? "").trim();
  if (pluginRoot !== "") {
    try {
      const child = spawn(process.execPath, [path.join(pluginRoot, "bin", "crustdata-login.mjs"), "--detach"], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {});
      child.unref();
    } catch {
      /* even if the spawn fails, still swallow the trigger quietly — the user just retries */
    }
  }
  return 2; // block the prompt; empty stderr → nothing rendered, no model turn
}

const invokedAs = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedAs !== "" && fileURLToPath(import.meta.url) === invokedAs) {
  let code = 0;
  try {
    code = await main();
  } catch {
    code = 0; // a hook bug must never eat a real prompt
  }
  process.exit(code);
}
