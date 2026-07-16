#!/usr/bin/env node
/**
 * Vendor the shared `core/` and `skills/` into each self-contained plugin
 * (`claude/` and `codex/`).
 *
 * Both Claude Code and Codex install a plugin by COPYING only its plugin root
 * into a cache — a plugin cannot reference `../core` or follow a `../skills`
 * symlink, so it must carry real copies. `core/` and `skills/` at the repo root
 * stay the single source of truth; re-run this after editing either
 * (`tests/vendor.test.mjs` fails if a plugin's copy drifts):
 *
 *   node scripts/build-plugins.mjs
 */

import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PLUGINS = ["claude", "codex"];
export const VENDORED = ["core", "skills"];

for (const plugin of PLUGINS) {
  for (const dir of VENDORED) {
    const src = path.join(repo, dir);
    const dest = path.join(repo, plugin, dir);
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
    process.stdout.write(`vendored ${dir}/ -> ${plugin}/${dir}/\n`);
  }
}
