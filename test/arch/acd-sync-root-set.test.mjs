// Fitness function: acd-sync-root-set (milestone 26 / story 00 / ADR-002 /
// fitness #5) — "The sync engine: root-set by argument, content-agnostic always."
//
//   "syncMesh's staged roots default to [meshDir(workspace)] (every m22/m23 call
//    site unchanged); every stage/diff/commit pathspec — and the pulled-names diff —
//    iterates the injected set; the runs-pathspec resolver (runsPathspec) has ONE
//    home beside the engine; the EXISTING acd-mesh-sync-record-neutral gate re-arms
//    GREEN over the modified engine (enumerated here, not duplicated)."
//
// Source-discipline grep over comment-stripped src/mesh-sync.mjs (the
// record-neutral reader idiom), with the m03 non-vacuous self-checks. The re-armed
// record-neutral gate is ENUMERATED by importing and RUNNING its archTests — the
// engine edit and the gate extension land together or not at all.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");
const MESH_SYNC = path.join(SRC, "mesh-sync.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function srcFiles(dir = SRC) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await srcFiles(full)));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

// The default-literal form ADR-002 freezes: `roots ?? [meshDir(workspace)]`.
const DEFAULT_ROOT_SET = /roots\s*\?\?\s*\[\s*meshDir\s*\(\s*workspace\s*\)\s*\]/;

export const archTests = [
  {
    name: "arch/sync-root-set: syncMesh takes a { roots } argument defaulting [meshDir(workspace)] — every m22/m23 call site is unchanged byte-for-byte",
    run: async () => {
      const code = stripComments(await readFile(MESH_SYNC, "utf8"));
      assert.ok(
        /function\s+syncMesh\s*\(\s*workspace\s*,\s*\{\s*roots\s*\}\s*=\s*\{\s*\}\s*\)/.test(code),
        "syncMesh's signature is syncMesh(workspace, { roots } = {}) — the root set is an optional argument"
      );
      assert.ok(
        DEFAULT_ROOT_SET.test(code),
        "the staged roots default to [meshDir(workspace)] (the literal ADR-002 freezes — today's behaviour for every existing caller)"
      );
      // Self-check (non-vacuous): the matcher would FAIL on the old fixed-root form.
      assert.ok(!DEFAULT_ROOT_SET.test("const root = meshDir(workspace);"), "the matcher rejects the old fixed single-root form");
      assert.ok(DEFAULT_ROOT_SET.test("const rootSet = roots ?? [meshDir(workspace)];"), "the matcher accepts the frozen default literal");
    },
  },
  {
    name: "arch/sync-root-set: every stage/diff/commit pathspec AND the pulled-names diff iterate the injected set (per-root add, per-root staged diff, staged-roots commit, root-set pulled report)",
    run: async () => {
      const code = stripComments(await readFile(MESH_SYNC, "utf8"));
      // The per-root stage loop: `git add -- <spec>` inside a for-of over the set.
      assert.ok(
        /for\s*\(\s*const\s+spec\s+of\s+rootSpecs\s*\)\s*\{[^}]*\[\s*["']add["']\s*,\s*["']--["']\s*,\s*spec\s*\]/.test(code),
        "the stage half adds per root — one `git add -- <root>` per entry of the injected set"
      );
      // The per-root staged-names diff (which also feeds the commit's root subset).
      assert.ok(
        /\[\s*["']diff["']\s*,\s*["']--cached["']\s*,\s*["']--name-only["']\s*,\s*["']--["']\s*,\s*spec\s*\]/.test(code),
        "the staged-names diff iterates the set (`git diff --cached --name-only -- <root>` per root)"
      );
      // The commit spreads ONLY the roots that had staged paths.
      assert.ok(
        /\[\s*["']commit["'][^\]]*["']--["']\s*,\s*\.\.\.commitRoots\s*\]/.test(code),
        "the commit pathspec spreads the staged roots of the set (`-- ...commitRoots` — an unmatched pathspec can never abort the tick)"
      );
      // The pulled-names diff reports against the whole set.
      assert.ok(
        /\[\s*["']diff["']\s*,\s*["']--name-only["'][^\]]*["']--["']\s*,\s*\.\.\.rootSpecs\s*\]/.test(code),
        "the pulled-names diff iterates the set (`-- ...rootSpecs` — the envelope reports exactly the scope it was given)"
      );
    },
  },
  {
    name: "arch/sync-root-set: the runs-pathspec resolver has ONE home — runsPathspec is exported from mesh-sync.mjs and the runs glob literal is defined nowhere else in src/",
    run: async () => {
      const code = stripComments(await readFile(MESH_SYNC, "utf8"));
      assert.ok(
        /export\s+function\s+runsPathspec\s*\(\s*workspace\s*\)/.test(code),
        "runsPathspec(workspace) is exported beside the engine (the ONE home of the glob literal)"
      );
      assert.ok(
        /join\s*\(\s*workspace\.workDir\s*,\s*["']\*\*["']\s*,\s*["']runs["']\s*,\s*["']\*\*["']\s*\)/.test(code),
        "runsPathspec builds the <workDir>/**/runs/** glob"
      );
      // ONE home: no other src module defines runsPathspec or re-builds the glob.
      const offenders = [];
      for (const file of await srcFiles()) {
        if (path.basename(file) === "mesh-sync.mjs") continue;
        const other = stripComments(await readFile(file, "utf8"));
        if (/function\s+runsPathspec\s*\(/.test(other)) offenders.push(`${path.relative(repoRoot, file)} defines runsPathspec`);
        if (/["']\*\*["']\s*,\s*["']runs["']\s*,\s*["']\*\*["']/.test(other)) offenders.push(`${path.relative(repoRoot, file)} re-builds the runs glob literal`);
      }
      assert.deepEqual(offenders, [], `the runs glob literal has ONE home (mesh-sync.mjs) — found: ${offenders.join("; ")}`);
    },
  },
  {
    name: "arch/sync-root-set: the EXISTING acd-mesh-sync-record-neutral gate re-arms GREEN over the modified engine (enumerated and RUN here — content-agnostic always, scope by argument)",
    run: async () => {
      // ENUMERATE, don't duplicate: import the existing gate and run every one of
      // its proofs over the root-set engine. Import-neutral, no parse-then-rewrite,
      // one-shot transport, thin-timer loop, and the (extended) scoped-commit argv —
      // all must hold over the modified source or this fitness fails with it.
      const { archTests: recordNeutral } = await import("./acd-mesh-sync-record-neutral.test.mjs");
      assert.ok(recordNeutral.length >= 5, `the record-neutral gate enumerates its five proofs (got ${recordNeutral.length})`);
      for (const { name, run } of recordNeutral) {
        await run(); // any failure propagates with the inner assertion's message
        assert.ok(name.startsWith("arch/mesh-sync-record-neutral"), `re-armed: ${name}`);
      }
    },
  },
];
