#!/usr/bin/env node
/**
 * UserPromptSubmit hook: typing exactly "crustdata login" fires the detached browser
 * login on demand (re-auth, account switch, or a skipped first-session sign-in) and
 * stops the prompt from reaching the model.
 *
 * Output contract: {"continue": false, "stopReason": <one line>} — a stopped prompt
 * ALWAYS renders exactly one line (verified across decision:block, continue:false and
 * exit-2; zero is impossible for a typed trigger), so we make that line a branded
 * confirmation instead of the default "Operation stopped by hook". No model turn.
 * Every other prompt passes through untouched (exit 0, no output).
 *
 * Zero dependencies; a hook problem must never eat a real prompt — any failure on the
 * non-trigger path exits 0 silently so the prompt proceeds.
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
  let opened = false;
  if (pluginRoot !== "") {
    try {
      const child = spawn(process.execPath, [path.join(pluginRoot, "bin", "crustdata-login.mjs"), "--detach"], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {});
      child.unref();
      opened = true;
    } catch {
      /* fall through to the failure line */
    }
  }
  process.stdout.write(
    JSON.stringify({
      continue: false,
      stopReason: opened
        ? "Crustdata sign-in opened in your browser — finish there."
        : "Couldn't start the Crustdata sign-in — set CRUSTDATA_API_KEY instead.",
      suppressOutput: true,
    }),
  );
}

const invokedAs = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedAs !== "" && fileURLToPath(import.meta.url) === invokedAs) {
  try {
    await main();
  } catch {
    /* never eat a real prompt on a hook bug */
  }
  process.exit(0);
}
