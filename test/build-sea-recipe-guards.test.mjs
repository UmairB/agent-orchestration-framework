// Craft-review hardening for milestone 28 / story 00's SEA build recipe
// (scripts/build-sea.mjs) — two build-script UNIT tests, neither requiring a
// real build/exec:
//
//   F14 — assertSafeOutDir refuses a --out that resolves to the repo root, the
//   cwd, or a directory carrying package.json/src (a workspace marker), so
//   `--out .` (or an alias of the repo root) can never rmSync the working tree.
//
//   F8 — planMacCodesignSteps returns the ordered codesign --remove-signature
//   (before postject) / codesign --sign - (after postject) step list ONLY on
//   darwin; it is a pure planner (no execFileSync call), so its OUTPUT is
//   assertable on this (non-darwin) box without invoking the real codesign
//   binary. The mac EXECUTION of these steps is an @manual CI/verify row.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeOutDir, planMacCodesignSteps } from "../scripts/build-sea.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const buildSeaRecipeGuardsTests = [
  // ===== F14: assertSafeOutDir =====
  {
    name: "build-sea-recipe-guards/F14 refuses an --out that resolves to the repo root",
    async run() {
      assert.throws(
        () => assertSafeOutDir(repoRoot, { repoRoot, cwd: repoRoot }),
        /Refusing to build into the repo root/,
        "the repo root itself is refused"
      );
      // The `--out .` alias the finding calls out explicitly, resolved against
      // a cwd equal to the repo root (the real invocation shape).
      assert.throws(
        () => assertSafeOutDir(".", { repoRoot, cwd: repoRoot }),
        /Refusing to build into the (repo root|current working directory)/,
        "`--out .` from the repo root is refused"
      );
    },
  },
  {
    name: "build-sea-recipe-guards/F14 refuses an --out that resolves to the current working directory",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-sea-guard-cwd-"));
      try {
        assert.throws(
          () => assertSafeOutDir(tmp, { repoRoot, cwd: tmp }),
          /Refusing to build into the current working directory/,
          "an --out equal to cwd (even outside the repo) is refused"
        );
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "build-sea-recipe-guards/F14 refuses an --out directory that looks like a SOURCE workspace (.git + package.json, or bin/aof.mjs + package.json)",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-sea-guard-ws-"));
      try {
        const fakeGitRepo = path.join(tmp, "looks-like-a-git-repo");
        await mkdir(path.join(fakeGitRepo, ".git"), { recursive: true });
        await writeFile(path.join(fakeGitRepo, "package.json"), "{}", "utf8");
        assert.throws(
          () => assertSafeOutDir(fakeGitRepo, { repoRoot, cwd: os.tmpdir() }),
          /looks like a SOURCE workspace/,
          "a dir carrying .git + package.json is refused even when it is neither repoRoot nor cwd"
        );

        const fakeAofRepo = path.join(tmp, "looks-like-an-aof-repo");
        await mkdir(path.join(fakeAofRepo, "bin"), { recursive: true });
        await writeFile(path.join(fakeAofRepo, "bin", "aof.mjs"), "// fake entry\n", "utf8");
        await writeFile(path.join(fakeAofRepo, "package.json"), "{}", "utf8");
        assert.throws(
          () => assertSafeOutDir(fakeAofRepo, { repoRoot, cwd: os.tmpdir() }),
          /looks like a SOURCE workspace/,
          "a dir carrying bin/aof.mjs + package.json (this repo's own entry shape) is refused"
        );
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "build-sea-recipe-guards/F14 accepts a dedicated, empty --out directory (the normal dist-sea/ case)",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-sea-guard-ok-"));
      try {
        const outDir = path.join(tmp, "dist-sea");
        const resolved = assertSafeOutDir(outDir, { repoRoot, cwd: os.tmpdir() });
        assert.equal(resolved, path.resolve(outDir), "a dedicated non-workspace directory resolves and does not throw");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "build-sea-recipe-guards/F14 accepts a RE-RUN into the build's own prior --out (package.json + bundle/ present, but no .git and no bin/aof.mjs)",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-sea-guard-rerun-"));
      try {
        const outDir = path.join(tmp, "dist-sea");
        // Mirror build-sea.mjs's own output shape from a PRIOR run: a trimmed
        // package.json + a bundle/ sidecar copy — neither a .git dir nor
        // bin/aof.mjs, so this must NOT be mistaken for a source workspace
        // (the guard would otherwise make the tool unable to re-run into its
        // own default dist-sea/ output, which is the normal expected case).
        await mkdir(path.join(outDir, "bundle"), { recursive: true });
        await writeFile(path.join(outDir, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
        const resolved = assertSafeOutDir(outDir, { repoRoot, cwd: os.tmpdir() });
        assert.equal(resolved, path.resolve(outDir), "a prior build's own --out directory (package.json + bundle/, no .git/bin) is accepted for a re-run");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },

  // ===== F8: planMacCodesignSteps =====
  {
    name: "build-sea-recipe-guards/F8 plans no codesign steps on non-darwin platforms (win32/linux)",
    async run() {
      for (const platform of ["win32", "linux"]) {
        const steps = planMacCodesignSteps("/fake/out/aof", { platform });
        assert.deepEqual(steps, [], `${platform} plans zero codesign steps — codesign is never invoked off-darwin`);
      }
    },
  },
  {
    name: "build-sea-recipe-guards/F8 plans codesign --remove-signature BEFORE postject and an ad-hoc codesign --sign - AFTER, on darwin",
    async run() {
      const exePath = "/fake/out/aof";
      const steps = planMacCodesignSteps(exePath, { platform: "darwin" });
      assert.equal(steps.length, 2, "exactly two codesign steps are planned on darwin");

      const before = steps.find((step) => step.when === "before-postject");
      const after = steps.find((step) => step.when === "after-postject");
      assert.ok(before, "a before-postject step is planned");
      assert.ok(after, "an after-postject step is planned");

      assert.equal(before.cmd, "codesign");
      assert.deepEqual(before.args, ["--remove-signature", exePath], "the before step strips the stale Apple signature");

      assert.equal(after.cmd, "codesign");
      assert.deepEqual(after.args, ["--sign", "-", exePath], "the after step ad-hoc re-signs (superseded by Story 01's --force real-cert sign)");

      // Ordering: remove-signature is planned strictly before the ad-hoc
      // re-sign in the returned array (the caller runs them by `when`, but the
      // array itself should also read in the natural before->after order).
      assert.ok(steps.indexOf(before) < steps.indexOf(after), "remove-signature is listed before the ad-hoc re-sign");
    },
  },
  {
    name: "build-sea-recipe-guards/F8 the darwin codesign steps are skippable via the skip option (a CI leg whose own signing pipeline follows)",
    async run() {
      const steps = planMacCodesignSteps("/fake/out/aof", { platform: "darwin", skip: true });
      assert.deepEqual(steps, [], "skip:true plans zero codesign steps even on darwin");
    },
  },
];
