// Fitness function: acd-workspace-identity-single-home (milestone 42 wave (b),
// TECH_DEBT item 4).
//
// "A workspace's mesh identity has ONE home (workspace-identity.mjs): the
//  precedence override → pinned config.mesh.workspaceId → path derivation is
//  spelled exactly once. No src file hand-spells the `?? workspaceIdFor(...)`
//  fallback (fourteen sites once did; when two disagreed across machines the
//  worker→control stream silently discarded 100% of its frames for days), and the
//  raw derivation is callable only from the home and the store's compat re-export."
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcRoot = path.join(repoRoot, "src");

// The raw derivation may be REFERENCED only here: its home, and the compat
// re-export (global-work-store.mjs, kept so existing imports/tests stay valid).
const DERIVATION_HOMES = new Set(["workspace-identity.mjs", "global-work-store.mjs"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

export const archTests = [
  {
    name: "arch/m42-item-4: no src file hand-spells the identity fallback — `?? workspaceIdFor(` appears nowhere, and the raw derivation is referenced only in its home + the compat re-export",
    async run() {
      const offenders = [];
      for (const file of walk(srcRoot)) {
        const rel = path.relative(srcRoot, file).split(path.sep).join("/");
        const code = stripComments(await readFile(file, "utf8"));
        if (/\?\?\s*workspaceIdFor\s*\(/.test(code)) {
          offenders.push(`${rel}: hand-spelled \`?? workspaceIdFor(...)\` fallback — use resolveWorkspaceId (the one precedence)`);
        }
        if (!DERIVATION_HOMES.has(rel) && /\bworkspaceIdFor\s*\(/.test(code)) {
          offenders.push(`${rel}: calls the raw derivation workspaceIdFor() — use resolveWorkspaceId (identity handed as data outranks re-derivation)`);
        }
      }
      assert.deepEqual(offenders, [], `identity must have ONE home:\n  ${offenders.join("\n  ")}`);
    },
  },
  {
    name: "arch/m42-item-4: the precedence itself lives once — resolveWorkspaceId is defined only in workspace-identity.mjs (non-vacuous: the home defines it and spells the pinned-config arm)",
    async run() {
      const definers = [];
      for (const file of walk(srcRoot)) {
        const rel = path.relative(srcRoot, file).split(path.sep).join("/");
        const code = stripComments(await readFile(file, "utf8"));
        if (/function\s+resolveWorkspaceId\s*\(/.test(code)) definers.push(rel);
      }
      assert.deepEqual(definers, ["workspace-identity.mjs"], "exactly one definition of the precedence");
      const home = stripComments(await readFile(path.join(srcRoot, "workspace-identity.mjs"), "utf8"));
      assert.ok(/config\?\.mesh\?\.workspaceId/.test(home), "the home spells the pinned-config arm (non-vacuous)");
      assert.ok(/workspaceIdFromPath/.test(home), "the home owns the raw derivation");
    },
  },
];
