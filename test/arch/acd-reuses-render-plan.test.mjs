// Fitness function for milestone 01 / ADR-003:
// "init/update do not implement their own create/update/skip/drift/delete logic —
//  they go through planApplyActions / createLockManifest."
//
// Source-grep the init module: it imports AND calls planApplyActions and
// createLockManifest, and it contains NO second drift-classification block
// (no hand-rolled create/update/skip/drift/delete state machine) and NO
// `--force`-driven hash comparison of its own.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const initSourcePath = path.join(srcDir, "work-init.mjs");
const updateSourcePath = path.join(srcDir, "work-update.mjs");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Both init and update must go THROUGH the shared engine — same assertions, run
// against each command's own source.
function reuseAssertions(label, sourcePath) {
  return [
    {
      name: `arch/ADR-003: ${label} imports planApplyActions and createLockManifest from the shared engine`,
      run: async () => {
        const source = await readFile(sourcePath, "utf8");
        assert.match(source, /import\s*\{[^}]*\}\s*from\s*"\.\/render-plan\.mjs"/, "imports from render-plan.mjs");
        const code = stripComments(source);
        assert.ok(/\bplanApplyActions\b/.test(code), "references planApplyActions");
        assert.ok(/\bcreateLockManifest\b/.test(code), "references createLockManifest");
      }
    },
    {
      name: `arch/ADR-003: ${label} CALLS planApplyActions and createLockManifest (not just imports them)`,
      run: async () => {
        const code = stripComments(await readFile(sourcePath, "utf8"));
        assert.ok(/planApplyActions\s*\(/.test(code), "planApplyActions is invoked");
        assert.ok(/createLockManifest\s*\(/.test(code), "createLockManifest is invoked");
      }
    },
    {
      name: `arch/ADR-003: ${label} contains no second drift-classification / --force comparison block`,
      run: async () => {
        const code = stripComments(await readFile(sourcePath, "utf8"));
        // No hand-rolled classification: the engine owns the action verbs. The
        // source must not assign or push the create/update/skip/drift/delete verbs
        // itself (that is planApplyActions' job).
        assert.ok(!/action:\s*"(create|update|skip|drift-warning|delete)"/.test(code), "no hand-rolled action objects");
        assert.ok(!/push\(\s*action\(/.test(code), "no action() pushes (that is the engine's)");
        // No self-rolled --force hash comparison: the command never compares hashes
        // against options.force to decide overwrite — that lives in planApplyActions.
        assert.ok(!/hashFileIfExists/.test(code), "no on-disk hash comparison of its own");
        assert.ok(!/\bhashContent\s*\(/.test(code), "no content hashing of its own");
        const forceLines = code.split("\n").filter((line) => /force/.test(line) && /hash|===|!==/.test(line));
        assert.equal(forceLines.length, 0, `no --force hash comparison block: ${forceLines.join(" | ")}`);
      }
    }
  ];
}

export const archTests = [
  ...reuseAssertions("init", initSourcePath),
  ...reuseAssertions("update", updateSourcePath),
  {
    name: "arch/ADR-003: update passes the install manifest as previousLock to planApplyActions",
    run: async () => {
      const code = stripComments(await readFile(updateSourcePath, "utf8"));
      // update reads the prior manifest and threads it into planApplyActions as the
      // previousLock — that is what makes it the symmetric twin of init.
      assert.ok(/\breadLock\b/.test(code), "update reads the prior install manifest");
      assert.ok(/planApplyActions\s*\(\s*desiredOutputs\s*,\s*previousLock\b/.test(code), "previousLock = the install manifest is passed to planApplyActions");
    }
  }
];
