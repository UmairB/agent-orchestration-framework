// Fitness function for milestone 15 / ADR-002 (the --strict exit policy).
// "Advisory by default; --strict gates — FACE-level, mirroring config doctor:
//   (a) no findings → exit 0;
//   (b) warn-only, no --strict → exit 0;
//   (c) warn-only, --strict → exit non-zero;
//   (d) any error finding → exit non-zero REGARDLESS of --strict.
// run's findings are identical across all four (the gate is the face, not run) —
// the --json findings set is unchanged by --strict."
//
// Proof: CLI spawn `aof work doctor [--strict]` against the four fixtures and
// assert the exit code per the matrix, and that the --json `findings` are byte-
// identical with/without --strict. The warn fixture uses the seeded `orphan-folder`
// group; the error fixture uses the seeded `duplicate-driver-number` group.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

async function baseRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-doctor-strict-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

// A `not-started`, story-less milestone with its SPEC.md mtime pinned to `updated`.
// not-started + no stories keeps the lifecycle/coherence groups silent, and pinning
// the mtime keeps the freshness group's mtime-ahead-of-updated silent — so this is a
// genuinely CLEAN driver under the FULL check registry (the four cross-cutting groups
// plus story 01/02's groups), making (a) clean → 0 hold under --strict.
const FIXTURE_DATE = "2026-06-19";
async function milestone(workDir, number, slug, status = "not-started") {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  const spec = path.join(dir, "SPEC.md");
  await writeFile(
    spec,
    frontmatter({ type: "milestone", number, slug, status, title: `"${slug}"`, created: FIXTURE_DATE, updated: FIXTURE_DATE }),
    "utf8"
  );
  const mtime = new Date(Date.parse(FIXTURE_DATE + "T00:00:00Z"));
  await utimes(spec, mtime, mtime);
  return dir;
}

// (a) clean: one well-formed, story-less, not-started milestone — no orphan, no
// duplicate, and clean under every registered group.
async function cleanFixture() {
  const { repo, workDir } = await baseRepo();
  await milestone(workDir, "07", "alpha");
  return repo;
}

// (b)/(c) warn-only: an orphan story folder (a warn, no error).
async function warnFixture() {
  const { repo, workDir } = await baseRepo();
  await milestone(workDir, "07", "alpha");
  await mkdir(path.join(workDir, "07_milestone_alpha", "stories", "orphan-typo"), { recursive: true });
  return repo;
}

// (d) error-bearing: two top-level drivers share number 07 (an error).
async function errorFixture() {
  const { repo, workDir } = await baseRepo();
  await milestone(workDir, "07", "alpha");
  await milestone(workDir, "07", "beta");
  return repo;
}

function runCli(root, args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const archTests = [
  {
    name: "arch/15 ADR-002: the --strict exit matrix (clean→0, warn→0, warn+strict→nonzero, error→nonzero)",
    run: async () => {
      // (a) clean → 0 (with and without --strict)
      const clean = await cleanFixture();
      try {
        assert.equal(runCli(clean, ["work", "doctor"]).status, 0, "(a) clean → exit 0");
        assert.equal(runCli(clean, ["work", "doctor", "--strict"]).status, 0, "(a) clean --strict → exit 0");
      } finally {
        await rm(clean, { recursive: true, force: true });
      }

      // (b) warn-only, no --strict → 0 ; (c) warn-only, --strict → non-zero
      const warn = await warnFixture();
      try {
        assert.equal(runCli(warn, ["work", "doctor"]).status, 0, "(b) warn-only default → exit 0");
        assert.notEqual(runCli(warn, ["work", "doctor", "--strict"]).status, 0, "(c) warn-only --strict → exit non-zero");
      } finally {
        await rm(warn, { recursive: true, force: true });
      }

      // (d) any error → non-zero REGARDLESS of --strict
      const err = await errorFixture();
      try {
        assert.notEqual(runCli(err, ["work", "doctor"]).status, 0, "(d) error → exit non-zero (no --strict)");
        assert.notEqual(runCli(err, ["work", "doctor", "--strict"]).status, 0, "(d) error --strict → exit non-zero");
      } finally {
        await rm(err, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/15 ADR-002: the --json findings set is unchanged by --strict (the gate is the face, not run)",
    run: async () => {
      const warn = await warnFixture();
      try {
        const without = JSON.parse(runCli(warn, ["work", "doctor", "--json"]).stdout);
        const withStrict = JSON.parse(runCli(warn, ["work", "doctor", "--strict", "--json"]).stdout);
        assert.deepEqual(withStrict.findings, without.findings, "the findings array is identical with/without --strict");
        // only the gate framing differs
        assert.equal(without.strict, false);
        assert.equal(withStrict.strict, true);
        assert.equal(without.healthy, true, "warn-only is healthy by default");
        assert.equal(withStrict.healthy, false, "warn-only is unhealthy under --strict");
      } finally {
        await rm(warn, { recursive: true, force: true });
      }
    },
  },
];
