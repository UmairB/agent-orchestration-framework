// Security fitness function: acd-worktree-path-scoped (F4, T4/T3b) — "the
// materialised worktree path is under the dedicated mesh worktree root, and the
// assigned ref cannot escape it."
//
// F4 is TWO parts (SECURITY.md): (a) behavioural — a valid ref's resolved worktree
// path, normalised, is a prefix-child of the dedicated root; a traversal ref
// resolution yields no item, never an escape. (b) source-analysis — the worktree/ref-
// resolution module builds no `path.join(<root>, <directiveRef>)` from raw directive
// text.
//
// Part (a)'s "materialised worktree path is under the dedicated root" is the SAME
// invariant ARCHITECTURE's #8 (acd-assignment-worktree-path-scoped) already proves —
// this file does NOT duplicate that assertion body; it enumerates/references that
// sibling file's registration (the repo's "enumerate the re-armed X" house style,
// e.g. acd-fleet-reclaim-guarded's re-arm of acd-run-reclaim-stale-only) and adds the
// GENUINELY NEW half: the ref-resolution "never path.join(root, directiveRef)" source
// guard, plus the behavioural "a traversal ref yields no item, never escapes" proof
// (which #8 does not itself assert — #8 is scoped to the worktree ADD path, not ref
// resolution INSIDE the worktree).
//
// Self-check (m03 non-vacuous): a planted `path.join(worktreeRoot, directive.itemRef)`
// trips the detector; the real enumerate-then-filter form (resolveRefInWorktree ->
// findWork) does not.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { addWorktree, removeWorktree } from "../../src/mesh-worktree.mjs";
import { resolveRefInWorktree } from "../../src/mesh-worker-execution.mjs";
import { withMeshWorkerExecFixture } from "../support/mesh-worker-exec-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const executionSourcePath = path.join(repoRoot, "src", "mesh-worker-execution.mjs");
const testSuitePath = path.join(repoRoot, "scripts", "test.mjs");

function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

// The T3b guard: no `path.join(<something>, <ref/directive-derived identifier>)` call
// exists in the ref-resolution module. `resolveRefInWorktree` must reach the item ONLY
// via `findWork(...)` (enumerate-then-filter), never by joining the ref/itemRef text
// onto a root path.
function assertNoPathJoinFromRef(code) {
  const problems = [];
  if (!/findWork\s*\(\s*rootedWorkDir\s*,\s*itemRef\s*\)/.test(code)) {
    problems.push("resolveRefInWorktree does not resolve via findWork(rootedWorkDir, itemRef) (enumerate-then-filter)");
  }
  // A violation shape: path.join(<root-ish>, itemRef) or path.join(<root-ish>, ref) —
  // joining the raw ref/itemRef identifier directly onto a path.
  if (/path\.join\([^)]*,\s*(itemRef|ref|directive\.itemRef|directive\.ref)\s*\)/.test(code)) {
    problems.push("a path.join(...) call joins the raw ref/itemRef identifier onto a path");
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/35 SECURITY F4 (acd-worktree-path-scoped): the ARCHITECTURE #8 sibling (acd-assignment-worktree-path-scoped) is registered — re-armed, not duplicated",
    run: async () => {
      const suite = await readFile(testSuitePath, "utf8");
      assert.ok(
        suite.includes("test/arch/acd-assignment-worktree-path-scoped.test.mjs"),
        "acd-assignment-worktree-path-scoped is imported into the registered suite (the worktree-materialization-path-scoped half F4(a) shares with ARCHITECTURE #8)",
      );
    },
  },
  {
    name: "arch/35 SECURITY F4 / T3b (acd-worktree-path-scoped): the ref-resolution module builds no path.join(root, directiveRef) — resolution is enumerate-then-filter via findWork (structural)",
    run: async () => {
      const source = stripCommentsAndStrings(await readFile(executionSourcePath, "utf8"));
      const problems = assertNoPathJoinFromRef(source);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/35 SECURITY F4 / T3b (acd-worktree-path-scoped): a traversal ref resolves to no item inside a REAL worktree — never an escape (behavioural)",
    run: async () => withMeshWorkerExecFixture(async ({ root, headSha }) => {
      const assignmentId = "arch-f4-traversal";
      const worktreePath = await addWorktree(root, assignmentId, headSha);
      const ws = await loadWorkspace(root);
      try {
        for (const traversalRef of ["../../etc", "/abs/outside", "00/../../.."]) {
          const item = await resolveRefInWorktree(root, ws.workDir, worktreePath, traversalRef);
          assert.equal(item, null, `[ref=${traversalRef}] yields no item, never escapes the worktree checkout`);
        }
      } finally {
        await removeWorktree(root, assignmentId, { force: true });
      }
    }),
  },
  {
    name: "arch/35 SECURITY F4 / T3b (acd-worktree-path-scoped): self-check — a planted path.join(root, directive.ref) trips the detector; the real enumerate-then-filter form does not",
    run: async () => {
      const source = stripCommentsAndStrings(await readFile(executionSourcePath, "utf8"));
      assert.deepEqual(assertNoPathJoinFromRef(source), [], "the real source is clean");

      const planted = `${source}\nfunction plantedResolve(root, directive) { return path.join(root, directive.ref); }\n`;
      assert.ok(assertNoPathJoinFromRef(planted).length > 0, "a planted path.join(root, directive.ref) trips the detector");

      const plantedItemRef = `${source}\nfunction plantedResolve2(root, itemRef) { return path.join(root, itemRef); }\n`;
      assert.ok(assertNoPathJoinFromRef(plantedItemRef).length > 0, "a planted path.join(root, itemRef) also trips the detector");
    },
  },
];
