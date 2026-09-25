#!/usr/bin/env node
// /crustdata:skills [sync | get <slug> | drop <slug>]. One line on stdout, always exit 0.

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveSyncEnv } from "../hooks/lib/sync-env.mjs";
import {
  dropSkill,
  isPulled,
  isSafeSlug,
  isSecureBaseUrl,
  pullSkill,
  readCatalog,
  readLocalSkills,
  runSync,
} from "../hooks/skills-sync-core.mjs";

/** A command gets no CLAUDE_PLUGIN_ROOT: the harness substitutes it into the command string. */
const OWN_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export const USAGE =
  "Usage: /crustdata:skills, /crustdata:skills sync, /crustdata:skills get <slug>, or /crustdata:skills drop <slug>.";
const LIST_CAP = 12;
const RESTART = " If it does not show up, start a new session.";

/** Worst first. */
const REPORTED = [
  ["failed", (n) => `${n} failed`],
  ["needs_permission", (n) => `${n} needs permission`],
  ["installed", (n) => `${n} installed`],
  ["updated", (n) => `${n} updated`],
  ["removed", (n) => `${n} removed`],
  ["deferred", (n) => `${n} deferred to the next session`],
];

function clean(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Allowlisted, not scrubbed: stripping control characters leaves the prose that followed them. */
const VERSION_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
function cleanVersion(value) {
  const v = String(value);
  return VERSION_SHAPE.test(v) ? v : "(unreadable version)";
}

/** $ARGUMENTS arrives as one string. */
export function parseArgs(argv) {
  const words = argv.join(" ").split(/\s+/).filter((w) => w !== "");
  if (words.length === 0 || (words.length === 1 && words[0] === "list")) return { verb: "list" };
  if (words.length === 1 && (words[0] === "sync" || words[0] === "reload")) return { verb: "sync" };
  if ((words[0] === "get" || words[0] === "drop") && words.length === 2) return { verb: words[0], slug: words[1] };
  return { verb: "usage" };
}

export function summarize({ results, changed }) {
  const counts = new Map();
  for (const r of results) counts.set(r.state, (counts.get(r.state) ?? 0) + 1);

  const parts = REPORTED.filter(([state]) => counts.has(state)).map(([state, render]) => render(counts.get(state)));
  // An unknown state must not read as "up to date".
  const known = new Set(REPORTED.map(([state]) => state).concat("up_to_date"));
  const unknown = [...counts].filter(([state]) => !known.has(state)).reduce((n, [, c]) => n + c, 0);
  if (unknown > 0) parts.push(`${unknown} in an unrecognised state`);

  if (parts.length === 0) {
    return changed
      ? `Skills changed, but nothing was reported. Start a new session if they do not show up.`
      : `Skills are up to date (${results.length} synced).`;
  }
  const named = results
    .filter((r) => r.state === "installed" || r.state === "updated")
    .map((r) => `${r.slug} ${cleanVersion(r.version)}`);
  // Capped so the restart hint survives the pipe buffer.
  const shown = named.slice(0, 5);
  const more = named.length > shown.length ? ` and ${named.length - shown.length} more` : "";
  const detail = shown.length > 0 ? ` — ${shown.join(", ")}${more}` : "";
  const restart = changed ? " If they do not show up, start a new session." : "";
  return `${parts.join(", ")}${detail}.${restart}`;
}

function names(list) {
  const shown = list.slice(0, LIST_CAP);
  const more = list.length > shown.length ? ` and ${list.length - shown.length} more` : "";
  return shown.join(", ") + more;
}

/** Slugs only: catalog names and descriptions never reach the relayed line. */
export function renderList({ catalog, locals }) {
  const granted = [];
  const pulled = [];
  const onDisk = new Set();
  for (const l of locals) {
    onDisk.add(l.dirName);
    if (l.marker === null) continue; // bundled
    (isPulled(l.marker) ? pulled : granted).push(l.dirName);
  }
  const available = catalog
    .filter((s) => !onDisk.has(s.slug))
    .map((s) => s.slug)
    .sort();
  const parts = [];
  if (granted.length > 0) parts.push(`granted: ${names(granted.sort())}`);
  if (pulled.length > 0) parts.push(`pulled: ${names(pulled.sort())}`);
  const installed = parts.length > 0 ? `Installed — ${parts.join("; ")}.` : "Nothing installed beyond the bundled skills.";
  const rest =
    available.length > 0
      ? ` Available: ${names(available)}. Get one with /crustdata:skills get <slug>.`
      : " Nothing else is available to this account.";
  const drop = pulled.length > 0 ? " Drop a pulled one with /crustdata:skills drop <slug>." : "";
  return `${installed}${rest}${drop}`;
}

export function renderGet(r, pluginRoot) {
  const v = r.version === undefined ? "" : ` ${cleanVersion(r.version)}`;
  switch (r.state) {
    case "invalid":
      return `That is not a skill name. ${USAGE}`;
    case "bundled":
      return `${r.slug} is bundled with the plugin and already installed.`;
    case "granted":
      return `${r.slug}${v} is granted to your account and kept current by sync.`;
    case "up_to_date":
      return `${r.slug}${v} is already installed.`;
    case "installed":
    case "updated": {
      const setup =
        r.setup === undefined
          ? ""
          : ` It has a setup step the plugin never runs: ${path.join(pluginRoot, "skills", r.slug, r.setup)}.`;
      return `${r.state === "installed" ? "Installed" : "Updated"} ${r.slug}${v}.${setup}${RESTART}`;
    }
    case "unavailable":
      return `${r.slug} is not available to your account.`;
    case "needs_permission":
      return `${r.slug}${v} could not be installed: ${clean(r.error ?? "needs permission")}.`;
    case "deferred":
      return `${r.slug}${v} was deferred to the next session (time budget).`;
    case "failed":
      return `Could not install ${r.slug}: ${clean(r.error ?? "unknown error")}.`;
    default:
      return `${r.slug} ended in an unrecognised state.`;
  }
}

export function renderDrop(r) {
  switch (r.state) {
    case "invalid":
      return `That is not a skill name. ${USAGE}`;
    case "removed":
      return `Removed ${r.slug}. If it still shows up, start a new session.`;
    case "granted":
      return `${r.slug} is granted to your account, so sync would bring it back. Ask on the Crustdata dashboard to revoke the grant.`;
    case "bundled":
      return `${r.slug} is bundled with the plugin and cannot be dropped.`;
    case "absent":
      return `${r.slug} is not installed.`;
    case "failed":
      return `Could not remove ${r.slug}: ${clean(r.error ?? "unknown error")}.`;
    default:
      return `${r.slug} ended in an unrecognised state.`;
  }
}

function out(line) {
  process.stdout.write(line + "\n");
}

async function main() {
  const { verb, slug } = parseArgs(process.argv.slice(2));
  if (verb === "usage") {
    out(USAGE);
    return;
  }
  const { client, pluginRoot: envRoot, apiKey, baseUrl } = await resolveSyncEnv(process.env, { assumeClient: "claude" });
  if (client === "other") {
    out("Skill sync is available in Claude only. This client reads the bundled skills from the package.");
    return;
  }
  const pluginRoot = envRoot !== "" ? envRoot : OWN_ROOT;

  if (verb === "drop") {
    out(renderDrop(dropSkill({ pluginRoot, slug })));
    return;
  }
  if (verb === "get" && !isSafeSlug(slug)) {
    out(renderGet({ state: "invalid", slug: "" }, pluginRoot));
    return;
  }
  if (typeof globalThis.fetch !== "function") {
    out("This Node build has no global fetch (Node 22+ required), so skills cannot sync.");
    return;
  }
  if (apiKey === "") {
    out(
      client === "claude"
        ? "Not signed in, so only the bundled skills are available. Run /crustdata:login first."
        : "No CRUSTDATA_API_KEY in the environment, so only the bundled skills are available.",
    );
    return;
  }
  if (!isSecureBaseUrl(baseUrl)) {
    out("Refusing a non-https CRUSTDATA_SKILLS_BASE_URL: the API key would leak.");
    return;
  }
  // Never the key: an error may quote it verbatim.
  const scrub = (s) => clean(String(s).split(apiKey).join("…"));
  const notes = [];
  const log = (message) => notes.push(message);
  const fetchImpl = globalThis.fetch;

  if (verb === "list") {
    const base = String(baseUrl).replace(/\/+$/, "");
    const catalog = await readCatalog({ fetchImpl, base, apiKey, timeoutMs: 10_000, log });
    if (!catalog.ok) {
      out(`Could not read the catalog: ${scrub(catalog.error)}`);
      return;
    }
    out(renderList({ catalog: catalog.skills, locals: readLocalSkills(path.join(pluginRoot, "skills")) }));
    return;
  }

  if (verb === "sync") {
    const { changed, results } = await runSync({ apiKey, baseUrl, pluginRoot, fetchImpl, log });
    // Reached nothing and nothing granted share one empty shape; only the log parts them.
    if (results.length === 0 && notes.length > 0) {
      out(`Could not sync: ${scrub(notes[notes.length - 1])}`);
      return;
    }
    out(summarize({ results, changed }));
    return;
  }

  // get: sync first (a grant is sync's to install); pulled results are tagged and stay pullSkill's.
  const { results } = await runSync({ apiKey, baseUrl, pluginRoot, fetchImpl, log });
  const synced = results.find((r) => r.slug === slug && r.via !== "pull");
  let result;
  if (synced !== undefined) {
    result = synced.state === "up_to_date" ? { ...synced, state: "granted" } : synced;
  } else {
    result = await pullSkill({ apiKey, baseUrl, pluginRoot, slug, fetchImpl, log });
  }
  if (result.error !== undefined) result = { ...result, error: scrub(result.error) };
  out(renderGet(result, pluginRoot));
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
    process.stdout.write(`Could not finish: ${clean(err instanceof Error ? err.message : String(err))}\n`);
  }
  // Not process.exit(): it races the async flush and truncates the line we just wrote.
  process.exitCode = 0;
}
