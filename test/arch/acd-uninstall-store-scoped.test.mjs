// Fitness function for milestone 12 / ADR-005 inv. 5 (uninstall is store-scoped;
// ADR-002 + ADR-003 + ADR-004):
// "Removal targets ONLY toolVersionDir(name, version) (~/.aof/tools/<name>/<version>/)
//  — never a global/system path, never an `rm -rf` of the store root or a PATH dir,
//  never `uv tool uninstall` of the store."
//
// Three proofs:
//   (a) tool-store.uninstall(descriptor, { removeDir }) with an INJECTED removeDir
//       capturing the path → the removed path is EXACTLY toolVersionDir(name,
//       version, env) under toolStoreRoot(env), and is NEITHER the store root NOR a
//       parent of it.
//   (b) the project:provision command's --uninstall path (run dry-run, no fs touched)
//       → the plan's removal target is exactly the graphify version dir under the
//       store root, and is NOT the store root / a PATH / a global / a system path.
//   (c) SOURCE-GREP src/tool-store.mjs + src/commands/project-provision.mjs
//       (comments discounted): the removal target derives from toolVersionDir, and
//       there is no rmSync/rm/rmdir of a store ROOT, a PATH dir, or a
//       `uv tool uninstall`.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uninstall, GRAPHIFY_DESCRIPTOR } from "../../src/tool-store.mjs";
import { toolStoreRoot, toolVersionDir } from "../../src/paths.mjs";
import { projectProvisionCommand } from "../../src/commands/project-provision.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");
const TOOL_STORE = path.join(srcDir, "tool-store.mjs");
const PROJECT_PROVISION = path.join(srcDir, "commands", "project-provision.mjs");

// Strip ONLY comments (keep string literals) — for the toolVersionDir derivation
// grep + the forbidden-removal grep; a forbidden `uv tool uninstall` could be a
// string literal we WANT to catch.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// A hermetic temp home so the store root is deterministic + isolated; the expected
// version dir is DERIVED via toolVersionDir with the SAME env, never hardcoded.
const TEMP_ENV = { AOF_GLOBAL_HOME: path.join(os.tmpdir(), "aof-uninstall-scoped-home") };

export const archTests = [
  {
    name: "arch/ADR-005 inv.5: tool-store.uninstall removes EXACTLY toolVersionDir(name, version) under the store root (injected removeDir), never the store root itself",
    run: () => {
      const env = TEMP_ENV;
      const expectedDir = toolVersionDir(GRAPHIFY_DESCRIPTOR.name, GRAPHIFY_DESCRIPTOR.version, env);
      const storeRoot = toolStoreRoot(env);

      // Inject removeDir so NO real fs removal happens — we only capture the target.
      const removed = [];
      const returned = uninstall(GRAPHIFY_DESCRIPTOR, { env, removeDir: (dir) => removed.push(dir) });

      assert.equal(removed.length, 1, "uninstall removes exactly ONE directory");
      assert.equal(removed[0], expectedDir, "the removed path is exactly the graphify version dir");
      assert.equal(returned, expectedDir, "uninstall returns the removed version dir (for the caller to report)");

      // It is UNDER the store root, and is NOT the store root, the home, or any
      // ancestor (so it can never widen into an `rm -rf` of the store).
      assert.ok(removed[0].startsWith(storeRoot + path.sep), "the removal target is strictly UNDER the store root");
      assert.notEqual(removed[0], storeRoot, "the removal target is NOT the store root itself");
      assert.notEqual(removed[0], env.AOF_GLOBAL_HOME, "the removal target is NOT the global home");
      assert.ok(removed[0].endsWith(path.join(GRAPHIFY_DESCRIPTOR.name, GRAPHIFY_DESCRIPTOR.version)), "the removal target ends with <name>/<version>");
      // The store root is a PROPER PREFIX of the target (target is deeper), never
      // the reverse (which would mean removing an ancestor of the store).
      assert.ok(!storeRoot.startsWith(removed[0] + path.sep), "the store root is not under the removal target (no ancestor removal)");
    },
  },
  {
    name: "arch/ADR-005 inv.5: project:provision --uninstall (dry-run) plans removal of EXACTLY the graphify version dir under the store root, not a global/PATH/store-root/system path",
    run: async () => {
      const env = TEMP_ENV;
      const expectedDir = toolVersionDir("graphify", GRAPHIFY_DESCRIPTOR.version, env);
      const storeRoot = toolStoreRoot(env);

      // Dry-run uninstall — the command COMPUTES the target but removes nothing (no
      // fs touched). env flows through ctx so the store geometry uses the temp home.
      const result = await projectProvisionCommand.run(
        { tool: "graphify", uninstall: true, dryRun: true },
        { env }
      );

      assert.equal(result.status, "uninstalled", "the dry-run reports the uninstall disposition");
      assert.equal(result.plan?.action, "uninstall", "the plan is an uninstall plan");

      const removeDir = result.plan?.removeDir;
      assert.equal(typeof removeDir, "string", "the plan names the removal target dir");
      assert.equal(removeDir, expectedDir, "the removal target is exactly the graphify version dir under the store root");
      // storePath (the basis-neutral version dir) agrees with the plan target.
      assert.equal(result.storePath, expectedDir, "storePath agrees with the plan's removal target");

      // It is UNDER the store root and is NOT the store root / global / PATH / a
      // system path.
      assert.ok(removeDir.startsWith(storeRoot + path.sep), "the removal target is strictly UNDER the store root");
      assert.notEqual(removeDir, storeRoot, "the removal target is NOT the store root");
      assert.notEqual(removeDir, env.AOF_GLOBAL_HOME, "the removal target is NOT the global home");
      assert.ok(removeDir.endsWith(path.join("graphify", GRAPHIFY_DESCRIPTOR.version)), "the removal target ends with graphify/<version>");

      // It is not any obvious global/PATH/system root (a sanity belt — the derived
      // path is under a temp AOF_GLOBAL_HOME, so none of these can match).
      for (const forbidden of ["/usr", "/bin", "/usr/local/bin", "C:\\Windows", "C:\\Program Files"]) {
        assert.notEqual(removeDir, forbidden, `the removal target is not the system path ${forbidden}`);
      }
    },
  },
  {
    name: "arch/ADR-005 inv.5: the removal target derives from toolVersionDir in both src files; no rmSync/rm/rmdir of a store ROOT / PATH dir, no `uv tool uninstall`",
    run: async () => {
      const storeText = stripComments(await readFile(TOOL_STORE, "utf8"));
      const provisionText = stripComments(await readFile(PROJECT_PROVISION, "utf8"));

      // The removal target derives from toolVersionDir (the version-keyed dir),
      // NOT toolStoreRoot. In tool-store.mjs, uninstall() computes the target via
      // toolVersionDir; in project-provision.mjs, the uninstall plan's target is
      // toolVersionDir(name, version, env).
      assert.ok(/toolVersionDir\s*\(/.test(storeText), "tool-store.mjs derives the removal target from toolVersionDir");
      assert.ok(/toolVersionDir\s*\(/.test(provisionText), "project-provision.mjs derives the removal target from toolVersionDir");

      // No `uv tool uninstall` anywhere in either file — the store is never removed
      // via uv's package-keyed uninstaller (ADR-002).
      for (const [label, text] of [["tool-store.mjs", storeText], ["project-provision.mjs", provisionText]]) {
        assert.ok(!/uv\s+tool\s+uninstall/.test(text), `${label} contains no \`uv tool uninstall\``);
      }

      // No removal call (rmSync/rm/rmdir/rimraf) is fed toolStoreRoot( — a removal
      // of the store ROOT would be the widening this forbids. (uninstall feeds
      // toolVersionDir; the only rmSync in tool-store.mjs is the default removeDir
      // applied to the version dir.)
      const removalFedStoreRoot =
        /\b(rmSync|rmdirSync|rm|rmdir|rimraf)\s*\(\s*toolStoreRoot\s*\(/.test(storeText) ||
        /\b(rmSync|rmdirSync|rm|rmdir|rimraf)\s*\(\s*toolStoreRoot\s*\(/.test(provisionText);
      assert.ok(!removalFedStoreRoot, "no removal call targets toolStoreRoot (the store root is never rm-rf'd)");

      // And no removal call is fed a process.env.PATH / a bare PATH dir.
      const removalFedPath =
        /\b(rmSync|rmdirSync|rm|rmdir|rimraf)\s*\([^)]*\bPATH\b/.test(storeText) ||
        /\b(rmSync|rmdirSync|rm|rmdir|rimraf)\s*\([^)]*\bPATH\b/.test(provisionText);
      assert.ok(!removalFedPath, "no removal call targets a PATH dir");
    },
  },
  {
    // The teeth of inv. 5: "the removed path equals toolVersionDir(name, version)"
    // is tautologically true even for an ESCAPING version (a bare path.join lets
    // `..` walk out of the store). This case proves the runtime guard actually
    // REFUSES a traversal/separator/absolute version — at BOTH the tool-store
    // removal site (containment + segment guard) and the command boundary — so an
    // untrusted/typo `--version` can never rmSync outside the store root.
    name: "arch/ADR-005 inv.5: uninstall REFUSES a traversal/separator/absolute version (no removal escapes the store root)",
    run: async () => {
      const env = TEMP_ENV;
      const removed = [];
      const unsafeVersions = ["../../../../evil", "..", "/abs/evil", "a/b", "a\\b", "."];
      for (const version of unsafeVersions) {
        assert.throws(
          () => uninstall({ name: "graphify", version }, { env, removeDir: (dir) => removed.push(dir) }),
          (err) => err && (err.code === "invalid-segment" || err.code === "unsafe-removal"),
          `tool-store.uninstall must refuse the unsafe version "${version}"`
        );
      }
      assert.equal(removed.length, 0, "NO removal happened for any unsafe version (the rmSync never escapes the store)");

      // The command boundary rejects the same input BEFORE planning or removing.
      for (const version of ["../../../../evil", ".."]) {
        await assert.rejects(
          projectProvisionCommand.run({ tool: "graphify", version, uninstall: true }, { env }),
          (err) => err && err.code === "invalid-segment",
          `project:provision must refuse --version "${version}" at the boundary`
        );
      }
    },
  },
];
