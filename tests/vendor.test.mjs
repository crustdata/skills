import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Both plugins are self-contained — Claude Code and Codex each cache only the
// plugin root on install — so claude/{core,skills} and codex/{core,skills} are
// VENDORED copies of the single-source core/ and skills/. This guards drift: if
// it fails, re-run `node scripts/build-plugins.mjs` after editing core/ or skills/.

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Recursively list files under `dir`, as sorted paths relative to `base`. */
function walk(dir, base = dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out.sort();
}

for (const plugin of ["claude", "codex"]) {
  for (const dir of ["core", "skills"]) {
    test(`${plugin}/${dir} is an exact vendored copy of ${dir} (run scripts/build-plugins.mjs)`, () => {
      const src = path.join(repo, dir);
      const vendored = path.join(repo, plugin, dir);
      assert.deepEqual(walk(vendored), walk(src), `${plugin}/${dir}: file-list drift`);
      for (const rel of walk(src)) {
        assert.deepEqual(
          readFileSync(path.join(vendored, rel)),
          readFileSync(path.join(src, rel)),
          `${plugin}/${dir}/${rel}: content drift`,
        );
      }
    });
  }
}
