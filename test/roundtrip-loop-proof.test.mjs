// Traceability wiring for milestone 04 / story 02 (loop-proof) — the two
// @executable tasks ONLY. The @uat sign-off task (02_roundtrip-signoff.feature)
// is a human gate proven later at aof:verify; it is NOT wired here.
//
// Covers EVERY @executable scenario AND every Scenario-Outline Examples row in:
//   tasks/00_validate-gates.feature — `aof work validate` accepts a clean seeded
//        stream (exit 0, no findings) and reports each defect CLASS the shipped
//        validateWork emits with a non-zero exit (folder↔frontmatter, the closed
//        tag vocabulary, the depends graph).
//   tasks/01_next-orders.feature    — `aof work next` returns the right { state,
//        ref } as the seeded stream advances: the four "ready" walks, the BLOCKED
//        edge (a held driver on an unmet depends), and the DONE edge (span out).
//
// Drives the FROZEN round-trip harness (ADR-005) — never a private copy. Each
// scenario takes a FRESH repo (createRoundTripRepo → seedSampleMilestone),
// applies ONE fixture perturbation as a file edit, then asserts the outcome via
// the re-exported shipped verbs (validateWork / nextWork) and/or the real CLI
// (`aof work validate --json`) for exit-code fidelity. Black-box: the result is a
// function of files-on-disk, not validator/traversal internals.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRoundTripRepo, seedSampleMilestone, validateWork, nextWork } from "./support/roundtrip-harness.mjs";

const cliPath = fileURLToPath(new URL("../bin/aof.mjs", import.meta.url));

// --------------------------------------------------------------- helpers ----

// The seeded sample's on-disk geometry (mirrors the harness fixture). Tests
// reach for these to author a single fixture edit; the *refs* always come back
// from the shipped verbs via seedSampleMilestone — never hand-computed.
const MILESTONE_DIR = "00_milestone_sample";
const STORY_DIRS = ["00_story_first", "01_story_second"];
const STORY_SLUGS = ["first", "second"];

const workDirOf = (repo) => path.join(repo.dir, "wiki", "work");
const milestoneSpecPath = (repo) => path.join(workDirOf(repo), MILESTONE_DIR, "SPEC.md");
const storyDirPath = (repo, i) => path.join(workDirOf(repo), MILESTONE_DIR, "stories", STORY_DIRS[i]);
const storyDocPath = (repo, i) => path.join(storyDirPath(repo, i), "STORY.md");
const storyFeaturePath = (repo, i) => path.join(storyDirPath(repo, i), "tasks", `00_${STORY_SLUGS[i]}.feature`);

// Set (or, if absent, the function asserts) a single frontmatter `key: value`
// line in a record doc — an inline edit on the seeded sample.
async function setFrontmatterField(docPath, key, value) {
  const text = await readFile(docPath, "utf8");
  const re = new RegExp(`^(${key}):.*$`, "m");
  assert.ok(re.test(text), `expected a "${key}:" line in ${docPath} to perturb`);
  await writeFile(docPath, text.replace(re, `${key}: ${value}`), "utf8");
}

// Replace the FIRST tag line in a seeded .feature (the line before "Feature:").
async function setFeatureTagLine(featurePath, tagLine) {
  const lines = (await readFile(featurePath, "utf8")).split(/\r?\n/);
  const idx = lines.findIndex((line) => line.trim().startsWith("@"));
  assert.ok(idx >= 0, `expected a tag line in ${featurePath} to perturb`);
  lines[idx] = tagLine;
  await writeFile(featurePath, lines.join("\n"), "utf8");
}

// Remove the seeded feature's only tag line entirely → the scenario inherits NO
// verification lane (0 verification tags).
async function removeFeatureTagLine(featurePath) {
  const lines = (await readFile(featurePath, "utf8")).split(/\r?\n/);
  const idx = lines.findIndex((line) => line.trim().startsWith("@"));
  assert.ok(idx >= 0, `expected a tag line in ${featurePath} to remove`);
  lines.splice(idx, 1);
  await writeFile(featurePath, lines.join("\n"), "utf8");
}

// A throwaway second milestone driver (full valid frontmatter), number/slug/
// status as given, with the supplied inline `depends` list.
async function addMilestone(repo, { number, slug, depends }) {
  const padded = String(number).padStart(2, "0");
  const dir = path.join(workDirOf(repo), `${padded}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    `---
type: milestone
number: ${number}
slug: ${slug}
title: "Throwaway ${slug}"
status: not-started
created: 2026-01-01
updated: 2026-01-01
depends: [${depends.join(", ")}]
---
# ${padded} · Throwaway ${slug}

## Objective

A throwaway driver the proof adds to perturb the depends graph.
`,
    "utf8",
  );
}

// Run the REAL CLI `aof work validate --json` against the seeded repo (cwd =
// repo root; the repo has no config, so workDir defaults to <repo>/wiki/work).
function runValidate(repo, args = []) {
  const result = spawnSync(process.execPath, [cliPath, "work", "validate", ...args], {
    cwd: repo.dir,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

// Assert at least one finding's problem matches `re`.
function assertFinding(findings, re) {
  assert.ok(
    findings.some((finding) => re.test(finding.problem)),
    `expected a finding matching ${re} — got ${JSON.stringify(findings)}`,
  );
}

// Boilerplate: fresh seeded repo → run body(repo, seed) → always cleanup.
async function withSeed(body) {
  const repo = await createRoundTripRepo();
  try {
    const seed = await seedSampleMilestone(repo.dir);
    await body(repo, seed, workDirOf(repo));
  } finally {
    await repo.cleanup();
  }
}

// =========================================================================
// 00_validate-gates.feature
// =========================================================================

const validateGatesTests = [
  {
    // Scenario: a clean seeded stream passes validation and exits 0
    name: "validate: a clean seeded stream reports no findings and exits 0",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        const findings = await validateWork(workDir, {}, undefined);
        assert.deepEqual(findings, [], "the clean seed produces zero findings");
        const cli = runValidate(repo, ["--json"]);
        assert.equal(cli.status, 0, `clean stream exits 0 (stderr: ${cli.stderr})`);
        assert.deepEqual(JSON.parse(cli.stdout), [], "clean stream emits an empty findings array");
      }),
  },

  {
    // Scenario: any seeded defect makes the command exit non-zero for CI
    name: "validate: any single seeded defect yields a finding and a non-zero exit",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        // One representative defect: a status the validator rejects.
        await setFrontmatterField(storyDocPath(repo, 0), "status", "bogus");
        const findings = await validateWork(workDir, {}, undefined);
        assert.ok(findings.length > 0, "at least one finding is reported");
        const cli = runValidate(repo, ["--json"]);
        assert.notEqual(cli.status, 0, "the command exits non-zero");
      }),
  },

  // --- Scenario Outline: validate reports each seeded defect class and fails ---
  // Examples: folder ↔ frontmatter

  {
    // a story folder's slug no longer matches its frontmatter → slug ≠ folder
    name: "validate (defect class): slug ≠ folder — story folder renamed, frontmatter slug stale",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        // Rename 00_story_first → 00_story_renamed, leaving frontmatter slug "first".
        await rename(storyDirPath(repo, 0), path.join(workDirOf(repo), MILESTONE_DIR, "stories", "00_story_renamed"));
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /slug .*≠ folder/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  {
    // a record doc's frontmatter type disagrees with its folder → type ≠ folder type
    name: "validate (defect class): type ≠ folder type — STORY.md frontmatter type set to task",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        await setFrontmatterField(storyDocPath(repo, 0), "type", "task");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /type .*≠ folder type/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  {
    // a record doc's frontmatter number disagrees with its folder → number ≠ folder
    name: "validate (defect class): number ≠ folder — STORY.md frontmatter number set to 7",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        await setFrontmatterField(storyDocPath(repo, 0), "number", "7");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /number .*≠ folder/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  {
    // a record doc carries an invalid status value → invalid status
    name: "validate (defect class): invalid status — record doc status set to bogus",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        await setFrontmatterField(milestoneSpecPath(repo), "status", "bogus");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /invalid status/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  {
    // a record doc's frontmatter block is removed entirely → missing or empty record doc
    name: "validate (defect class): missing or empty record doc — STORY.md frontmatter removed",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        // Rewrite with body text only — no frontmatter block → meta is empty.
        await writeFile(storyDocPath(repo, 0), "# Just a body, no frontmatter\n\nNothing parseable here.\n", "utf8");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /missing or empty record doc/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  // Examples: closed tag vocabulary (on a seeded task .feature)

  {
    // a seeded scenario is tagged with a token outside the vocabulary → unknown tag
    name: "validate (defect class): unknown tag — a token outside the closed vocabulary",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        // Keep exactly one verification lane (@executable), add an out-of-vocab token.
        await setFeatureTagLine(storyFeaturePath(repo, 0), "@executable @frobnicate");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /unknown tag/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  {
    // a seeded scenario is tagged "@milestone-04" → milestone membership is structural
    name: "validate (defect class): milestone-as-tag — @milestone-04 is structural, not a tag",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        await setFeatureTagLine(storyFeaturePath(repo, 0), "@executable @milestone-04");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /milestone membership is structural/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  {
    // a seeded scenario's effective tags carry no verification lane → verification tags (need exactly 1)
    name: "validate (defect class): zero verification lanes — the @executable tag line removed",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        await removeFeatureTagLine(storyFeaturePath(repo, 0));
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /verification tags \(need exactly 1\)/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  {
    // a seeded scenario's effective tags carry two verification lanes → verification tags (need exactly 1)
    name: "validate (defect class): two verification lanes — @executable @manual on one scenario",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        await setFeatureTagLine(storyFeaturePath(repo, 0), "@executable @manual");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /verification tags \(need exactly 1\)/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  // Examples: depends graph

  {
    // the milestone's depends list points at a number no item has → does not resolve
    name: "validate (defect class): depends dangling — milestone depends on [99], no such item",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        await setFrontmatterField(milestoneSpecPath(repo), "depends", "[99]");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /does not resolve to a milestone\/uat item/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },

  {
    // two seeded drivers depend on each other (a cycle) → depends cycle
    name: "validate (defect class): depends cycle — two drivers depend on each other",
    run: () =>
      withSeed(async (repo, _seed, workDir) => {
        // Add a throwaway driver 01 that depends on 00, and point 00 at 01.
        await addMilestone(repo, { number: 1, slug: "other", depends: [0] });
        await setFrontmatterField(milestoneSpecPath(repo), "depends", "[1]");
        const findings = await validateWork(workDir, {}, undefined);
        assertFinding(findings, /depends cycle/);
        assert.notEqual(runValidate(repo).status, 0, "exits non-zero");
      }),
  },
];

// =========================================================================
// 01_next-orders.feature
// =========================================================================

const nextOrdersTests = [
  {
    // Scenario: a not-started milestone drills to its first not-done story
    // (== outline row "all items not-started" → ready, first story)
    name: "next: a not-started milestone drills to its first not-done story (ready, 00/00)",
    run: () =>
      withSeed(async (_repo, seed, workDir) => {
        const result = await nextWork(workDir, undefined);
        assert.equal(result.state, "ready", "state is ready");
        assert.equal(result.ref, seed.storyRefs[0], "returns the milestone's first story (00/00)");
      }),
  },

  {
    // Scenario: a held milestone reports blocked with what it waits on
    // (== outline row "the milestone depends on a driver that is not done")
    name: "next: a held milestone reports blocked and names the unmet dependency",
    run: () =>
      withSeed(async (repo, seed, workDir) => {
        // A throwaway not-done driver 01; milestone 00 depends on it. Scope to 00
        // so the unscoped (ready) second driver is out of the span (per contract).
        await addMilestone(repo, { number: 1, slug: "dep", depends: [] });
        await setFrontmatterField(milestoneSpecPath(repo), "depends", "[1]");
        const result = await nextWork(workDir, seed.milestoneRef);
        assert.equal(result.state, "blocked", "state is blocked");
        assert.equal(result.ref, seed.milestoneRef, "the held milestone's own ref");
        assert.ok(Array.isArray(result.waitingOn), "reports what it waits on");
        assert.ok(result.waitingOn.includes("1"), `names the unmet dep — got ${JSON.stringify(result.waitingOn)}`);
      }),
  },

  // --- Scenario Outline: next returns the correct { state, ref } ---

  {
    // | all items not-started | ready | the milestone's first story |
    name: "next (outline): all items not-started → ready, the milestone's first story (00/00)",
    run: () =>
      withSeed(async (_repo, seed, workDir) => {
        const result = await nextWork(workDir, undefined);
        assert.equal(result.state, "ready");
        assert.equal(result.ref, seed.storyRefs[0]);
      }),
  },

  {
    // | the first story is done, the rest not-started | ready | the milestone's second story |
    name: "next (outline): first story done, rest not-started → ready, the second story (00/01)",
    run: () =>
      withSeed(async (repo, seed, workDir) => {
        await setFrontmatterField(storyDocPath(repo, 0), "status", "done");
        const result = await nextWork(workDir, undefined);
        assert.equal(result.state, "ready");
        assert.equal(result.ref, seed.storyRefs[1], "skips to the second story (00/01)");
      }),
  },

  {
    // | every story under the milestone is done | ready | the milestone (to accept) |
    name: "next (outline): every story done → ready, the milestone (to accept) (00)",
    run: () =>
      withSeed(async (repo, seed, workDir) => {
        await setFrontmatterField(storyDocPath(repo, 0), "status", "done");
        await setFrontmatterField(storyDocPath(repo, 1), "status", "done");
        const result = await nextWork(workDir, undefined);
        assert.equal(result.state, "ready");
        assert.equal(result.ref, seed.milestoneRef, "the milestone's own ref (needs accepting)");
      }),
  },

  {
    // | the milestone is not-started and has no stories yet | ready | the milestone (to break down) |
    name: "next (outline): milestone not-started, no stories → ready, the milestone (to break down) (00)",
    run: () =>
      withSeed(async (repo, seed, workDir) => {
        await rm(path.join(workDirOf(repo), MILESTONE_DIR, "stories"), { recursive: true, force: true });
        const result = await nextWork(workDir, undefined);
        assert.equal(result.state, "ready");
        assert.equal(result.ref, seed.milestoneRef, "the milestone's own ref (needs breaking down)");
      }),
  },

  {
    // | the milestone depends on a driver that is not done | blocked | the milestone (held) |
    name: "next (outline): milestone depends on a not-done driver → blocked, the milestone (held)",
    run: () =>
      withSeed(async (repo, seed, workDir) => {
        await addMilestone(repo, { number: 1, slug: "driver", depends: [] });
        await setFrontmatterField(milestoneSpecPath(repo), "depends", "[1]");
        const result = await nextWork(workDir, seed.milestoneRef);
        assert.equal(result.state, "blocked");
        assert.equal(result.ref, seed.milestoneRef, "the held milestone's own ref");
        assert.ok(result.waitingOn.includes("1"), `waits on the unmet driver — got ${JSON.stringify(result.waitingOn)}`);
      }),
  },

  {
    // | the milestone is done and nothing else is in the span | done | nothing (span exhausted) |
    name: "next (outline): milestone done, nothing else in span → done, no ref (span exhausted)",
    run: () =>
      withSeed(async (repo, seed, workDir) => {
        await setFrontmatterField(milestoneSpecPath(repo), "status", "done");
        // Scope to milestone 00 so any other driver is out of the span.
        const result = await nextWork(workDir, seed.milestoneRef);
        assert.equal(result.state, "done", "the scoped span is exhausted");
        assert.ok(result.ref === undefined, "reports no ref");
      }),
  },
];

// --------------------------------------------------------------- exports ----

export const loopProofTests = [...validateGatesTests, ...nextOrdersTests];
