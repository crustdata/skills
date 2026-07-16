#!/usr/bin/env node
/**
 * Vendor the shared `core/` and `skills/` into the self-contained Codex plugin
 * (`codex/core/`, `codex/skills/`).
 *
 * Codex installs a plugin by COPYING only its plugin root into
 * `~/.codex/plugins/cache/...` — it cannot reference `../core` or follow a
 * `../skills` symlink (docs: "all shared code must be vendored inside the plugin
 * directory"). So the plugin must carry real copies.
 *
 * `core/` and `skills/` at the repo root stay the single source of truth. Re-run
 * this after editing either (`tests/codex-vendor.test.mjs` fails if the vendored
 * copies drift):  node scripts/build-codex-plugin.mjs
 */

import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const dir of ["core", "skills"]) {
  const src = path.join(repo, dir);
  const dest = path.join(repo, "codex", dir);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  process.stdout.write(`vendored ${dir}/ -> codex/${dir}/\n`);
}
