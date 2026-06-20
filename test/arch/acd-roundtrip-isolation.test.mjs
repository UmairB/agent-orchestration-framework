// Fitness function for milestone 04 / ADR-001:
// "The round-trip harness creates each repo with `mkdtemp` under the OS temp root
//  + `git init`, drives every `aof` call with that dir as `targetDir`/`cwd`, and
//  writes NOTHING outside it — it never targets bare `process.cwd()`, never writes
//  under this dev repo's tree, and never references the global workspace
//  (`globalWorkspacePaths` / `defaultGlobalWorkspaceDir` / `~/.aof`)."
//
// WHY this is structural, not behavioural: a proof that runs `aof work init` writes
// files; if it forgets `targetDir` it renders the bundle INTO this repo (clobbering
// the authored src/bundle/ source of truth) or into a global ~/.aof. Isolation is a
// load-bearing property of the proof harness, owned in ONE place (ADR-005).
//
// EXPECTED RED until the round-trip harness exists: the proof is built downstream
// (the harness story creates test/support/roundtrip-harness.mjs). Today there is no
// harness, so both proofs fail with "harness not found yet" — that red is correct;
// it goes green when the harness is authored to the frozen contract (ADR-005) with
// mkdtemp + git init isolation. The test FILE still imports cleanly (only node:
// builtins + existing src/ modules at top level) so `node --test` reports a real
// assertion red, not an import/syntax error — the harness is resolved lazily inside
// each run() via import(), so a missing module is a clean, intended failure.
//
// Two proofs:
//  1. Source — read the harness module source: it names `mkdtemp` and `git init`,
//     passes an explicit `targetDir`/`cwd`, and never names the global-workspace
//     helpers nor defaults the install target to a bare `process.cwd()`.
//  2. Behavioural — run the harness from a SENTINEL cwd; assert the created repo
//     path is under os.tmpdir(), this dev repo's tree is untouched, and the sentinel
//     cwd gained no `.aof/` / `.claude/` render.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, readdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
// The frozen harness location (ADR-005): test-only support code, single module.
const harnessPath = path.join(repoRoot, "test", "support", "roundtrip-harness.mjs");
const harnessUrl = new URL("../support/roundtrip-harness.mjs", import.meta.url).href;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Resolve the harness lazily so a missing module is a clean assertion red (the
// proof is built downstream), not a module-load crash of the whole test file.
async function loadHarness() {
  if (!(await exists(harnessPath))) {
    assert.fail("round-trip harness not found yet at test/support/roundtrip-harness.mjs — EXPECTED RED until the harness story builds it (ADR-005)");
  }
  return import(harnessUrl);
}

export const archTests = [
  {
    name: "arch/ADR-001: the harness source isolates via mkdtemp + git init and never targets cwd / dev-repo / the global workspace",
    run: async () => {
      if (!(await exists(harnessPath))) {
        assert.fail("round-trip harness not found yet — EXPECTED RED until the harness story builds it (ADR-001/005)");
      }
      const code = stripComments(await readFile(harnessPath, "utf8"));

      // Hermetic temp repo: mkdtemp under the OS temp root + a real git init.
      assert.ok(/mkdtemp/.test(code), "harness creates the repo with mkdtemp");
      assert.ok(/os\.tmpdir\(\)|tmpdir\(\)/.test(code), "harness roots the temp repo under os.tmpdir()");
      assert.ok(/git\b[^\n]*\binit\b/.test(code), "harness `git init`s the isolated repo");

      // It must NOT reach for the shared global workspace.
      assert.ok(!/globalWorkspacePaths/.test(code), "harness never references globalWorkspacePaths");
      assert.ok(!/defaultGlobalWorkspaceDir/.test(code), "harness never references defaultGlobalWorkspaceDir");

      // It must pass an explicit target, not silently install into the CLI's cwd.
      assert.ok(/targetDir/.test(code), "harness passes an explicit targetDir to the real install");
    }
  },
  {
    name: "arch/ADR-001: running the harness writes only under os.tmpdir() — the dev repo and the caller's cwd are untouched",
    run: async () => {
      const harness = await loadHarness();

      // A sentinel cwd unrelated to the repo: if the install ever defaulted to
      // process.cwd(), this dir would gain a `.aof/`/`.claude/` render.
      const sentinelCwd = await mkdtemp(path.join(os.tmpdir(), "aof-arch-rt-sentinel-"));
      const originalCwd = process.cwd();
      let repo;
      try {
        process.chdir(sentinelCwd);

        const created = await harness.createRoundTripRepo();
        repo = created;
        assert.ok(created && typeof created.dir === "string", "createRoundTripRepo returns { dir }");

        // The repo lives under the OS temp root, not under the dev repo. Compare
        // realpath both sides — os.tmpdir() may be a symlink (e.g. /var → /private
        // on macOS, short vs long names on Windows).
        const { realpath } = await import("node:fs/promises");
        const tmpReal = await realpath(os.tmpdir());
        const repoReal = await realpath(created.dir);
        assert.ok(repoReal.startsWith(tmpReal), `repo ${repoReal} is under os.tmpdir() (${tmpReal})`);
        assert.ok(!repoReal.startsWith(await realpath(repoRoot)), "repo is NOT under this dev repo's tree");

        // Drive the real install into the isolated repo.
        await harness.installBundle(created.dir, { runtimes: ["claude"] });

        // The sentinel cwd gained no aof/claude render — nothing leaked to cwd.
        const sentinelEntries = await readdir(sentinelCwd);
        assert.ok(!sentinelEntries.includes(".aof"), "the caller's cwd gained no .aof render");
        assert.ok(!sentinelEntries.includes(".claude"), "the caller's cwd gained no .claude render");

        // The isolated repo DID get the render (the install really ran there).
        assert.ok(await exists(path.join(created.dir, ".aof", "aof.lock.json")), "the isolated repo carries the work lock");
      } finally {
        process.chdir(originalCwd);
        if (repo && typeof repo.cleanup === "function") await repo.cleanup();
        await rm(sentinelCwd, { recursive: true, force: true });
      }
    }
  }
];
