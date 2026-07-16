import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The Codex plugin must be self-contained (Codex caches only the plugin root on
// install), so codex/core and codex/skills are VENDORED copies of the
// single-source core/ and skills/. This guards against drift: if it fails,
// re-run `node scripts/build-codex-plugin.mjs` after editing core/ or skills/.

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

for (const dir of ["core", "skills"]) {
  test(`codex/${dir} is an exact vendored copy of ${dir} (run scripts/build-codex-plugin.mjs)`, () => {
    const src = path.join(repo, dir);
    const vendored = path.join(repo, "codex", dir);
    assert.deepEqual(walk(vendored), walk(src), `${dir}: file-list drift`);
    for (const rel of walk(src)) {
      assert.deepEqual(
        readFileSync(path.join(vendored, rel)),
        readFileSync(path.join(src, rel)),
        `${dir}/${rel}: content drift`,
      );
    }
  });
}
