// Fitness function: acd-no-git-bus-return (milestone 35 / ADR-003, fitness #1) —
// "The rebuild uses no git-bus. No `src/` module imports or creates the retired
//  git-bus lease/issuance/sync machinery (mesh-lease.mjs / mesh-issuance.mjs /
//  mesh-sync.mjs / commands/mesh-issue.mjs / a leaseClaimPath function)."
//
// Proofs:
//  1. Structural — over every `src/**/*.mjs` (comments stripped), assert NO
//     `import … from "./mesh-lease.mjs"`, `"./mesh-issuance.mjs"`, `"./mesh-sync.mjs"`,
//     or `"./commands/mesh-issue.mjs"` (any relative depth), and no definition/
//     reference of a `leaseClaimPath` function.
//  2. Self-check (m03 non-vacuous planted-violation): a synthetic source string
//     containing a planted `import … "./mesh-lease.mjs"` trips the SAME detector the
//     real-tree pass uses — proving the assertion is not vacuously green.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");

const FORBIDDEN_IMPORT_RE = /from\s+["'][^"']*\/(mesh-lease|mesh-issuance|mesh-sync|commands\/mesh-issue)\.mjs["']/;
const LEASE_CLAIM_PATH_RE = /\bleaseClaimPath\b/;

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function detect(source) {
  const stripped = stripComments(source);
  const violations = [];
  if (FORBIDDEN_IMPORT_RE.test(stripped)) violations.push("forbidden git-bus import");
  if (LEASE_CLAIM_PATH_RE.test(stripped)) violations.push("leaseClaimPath reference");
  return violations;
}

async function collectMjsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectMjsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

export const archTests = [
  {
    name: "arch/35 ADR-003 (acd-no-git-bus-return): no src/ module imports or creates the retired git-bus lease/issuance/sync machinery",
    run: async () => {
      const files = await collectMjsFiles(srcDir);
      assert.ok(files.length > 20, "the src tree was actually scanned (non-vacuous file count)");
      const offenders = [];
      for (const file of files) {
        const source = await readFile(file, "utf8");
        const violations = detect(source);
        if (violations.length > 0) offenders.push({ file: path.relative(repoRoot, file), violations });
      }
      assert.deepEqual(offenders, [], `no src/ file imports/creates git-bus machinery, got: ${JSON.stringify(offenders)}`);

      // Also assert no bare mesh-lease.mjs/mesh-issuance.mjs/mesh-sync.mjs/mesh-issue.mjs
      // file exists on disk at all — the tree is clean of the retired modules themselves.
      const names = files.map((f) => path.basename(f));
      for (const forbidden of ["mesh-lease.mjs", "mesh-issuance.mjs", "mesh-sync.mjs", "mesh-issue.mjs"]) {
        assert.ok(!names.includes(forbidden), `${forbidden} does not exist in src/`);
      }
    },
  },
  {
    name: "arch/35 ADR-003 (acd-no-git-bus-return): self-check — a planted git-bus import trips the SAME detector (non-vacuous)",
    run: async () => {
      const clean = 'import { readAssignment } from "./assignment-record.mjs";\n';
      assert.deepEqual(detect(clean), [], "the clean form is not flagged");

      const plantedImport = 'import { claim } from "./mesh-lease.mjs";\n';
      assert.deepEqual(detect(plantedImport), ["forbidden git-bus import"], "a planted mesh-lease.mjs import trips the detector");

      const plantedNested = 'import { issue } from "../commands/mesh-issue.mjs";\n';
      assert.deepEqual(detect(plantedNested), ["forbidden git-bus import"], "a planted nested commands/mesh-issue.mjs import trips the detector");

      const plantedLeaseFn = 'function leaseClaimPath(nodeId) { return `/mesh/leases/${nodeId}.json`; }\n';
      assert.deepEqual(detect(plantedLeaseFn), ["leaseClaimPath reference"], "a planted leaseClaimPath definition trips the detector");
    },
  },
];
