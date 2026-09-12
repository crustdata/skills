#!/usr/bin/env node
// The mid-session sync: Claude Desktop has no built-in /reload-skills.
// One line, always exit 0: a failure must say why, not hand back a stack trace.

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveSyncEnv } from "../hooks/lib/sync-env.mjs";
import { runSync } from "../hooks/skills-sync-core.mjs";

/** A command gets no CLAUDE_PLUGIN_ROOT: the harness substitutes it into the command string. */
const OWN_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Ordered worst-first: the line leads with whatever most needs the person's attention. */
const REPORTED = [
  ["failed", (n) => `${n} failed`],
  ["needs_permission", (n) => `${n} needs permission`],
  ["installed", (n) => `${n} installed`],
  ["updated", (n) => `${n} updated`],
  ["removed", (n) => `${n} removed`],
  ["deferred", (n) => `${n} deferred to the next session`],
];

/** Someone else's prose, bounded to one line. */
function clean(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Allowlisted, not scrubbed: stripping control characters leaves the prose that followed them. */
const VERSION_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
function cleanVersion(value) {
  const v = String(value);
  return VERSION_SHAPE.test(v) ? v : "(unreadable version)";
}

export function summarize({ results, changed }) {
  const counts = new Map();
  for (const r of results) counts.set(r.state, (counts.get(r.state) ?? 0) + 1);

  const parts = REPORTED.filter(([state]) => counts.has(state)).map(([state, render]) => render(counts.get(state)));
  // An unknown state must be visible: "up to date" would be a lie rather than an omission.
  const known = new Set(REPORTED.map(([state]) => state).concat("up_to_date"));
  const unknown = [...counts].filter(([state]) => !known.has(state)).reduce((n, [, c]) => n + c, 0);
  if (unknown > 0) parts.push(`${unknown} in an unrecognised state`);

  if (parts.length === 0) {
    // `changed` with nothing to report is itself worth saying, rather than claiming calm.
    return changed
      ? `Skills changed, but nothing was reported. Start a new session if they do not show up.`
      : `Skills are up to date (${results.length} granted).`;
  }
  const named = results
    .filter((r) => r.state === "installed" || r.state === "updated")
    .map((r) => `${r.slug} ${cleanVersion(r.version)}`);
  // Capped: an uncapped list ran past the pipe buffer and cut off the restart hint below.
  const shown = named.slice(0, 5);
  const more = named.length > shown.length ? ` and ${named.length - shown.length} more` : "";
  const detail = shown.length > 0 ? ` — ${shown.join(", ")}${more}` : "";
  // Whether the client picks the files up without a restart is the client's call, not ours.
  const restart = changed ? " If they do not show up, start a new session." : "";
  return `${parts.join(", ")}${detail}.${restart}`;
}

async function main() {
  // commands/*.md is a Claude and Cowork surface; Grok does not run them.
  const { client, pluginRoot: envRoot, apiKey, baseUrl } = await resolveSyncEnv(process.env, { assumeClient: "claude" });
  // The env var wins where there is one; our own location answers where there is not.
  const pluginRoot = envRoot !== "" ? envRoot : OWN_ROOT;
  if (typeof globalThis.fetch !== "function") {
    process.stdout.write("This Node build has no global fetch (Node 22+ required), so skills cannot sync.\n");
    return;
  }
  if (apiKey === "") {
    process.stdout.write(
      client === "claude"
        ? "Not signed in, so only the bundled skills are available. Run /crustdata:login first.\n"
        : "No CRUSTDATA_API_KEY in the environment, so only the bundled skills are available.\n",
    );
    return;
  }

  const notes = [];
  const { changed, results } = await runSync({
    apiKey,
    baseUrl,
    pluginRoot,
    fetchImpl: globalThis.fetch,
    log: (message) => notes.push(message),
  });

  // Reached nothing and found nothing granted share one empty shape; only the log parts them.
  if (results.length === 0 && notes.length > 0) {
    // Never the key: maskKey covers what the core renders, not an error it quotes verbatim.
    const note = clean(notes[notes.length - 1].split(apiKey).join("…")).slice(0, 200);
    process.stdout.write(`Could not sync: ${note}\n`);
    return;
  }
  process.stdout.write(summarize({ results, changed }) + "\n");
}

/** The ESM loader realpaths import.meta.url and argv[1] is not, so a plain compare never ran. */
function realOrResolved(p) {
  const resolved = path.resolve(p);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

const invokedAs = process.argv[1] === undefined ? "" : realOrResolved(process.argv[1]);
if (invokedAs !== "" && realOrResolved(fileURLToPath(import.meta.url)) === invokedAs) {
  try {
    await main();
  } catch (err) {
    process.stdout.write(`Could not sync: ${clean(err instanceof Error ? err.message : String(err))}\n`);
  }
  // Not process.exit(): it races the async flush and truncates the line we just wrote.
  process.exitCode = 0;
}
