// The round-trip proof harness (milestone 04 / story 00) — the SINGLE frozen
// support contract (ADR-005) the two downstream proof stories bind to. It owns
// exactly three exports and nothing else:
//
//   createRoundTripRepo()      -> { dir, cleanup }
//   installBundle(dir, opts)   -> the structured initWork result, VERBATIM
//   seedSampleMilestone(dir)   -> { milestoneRef, storyRefs }
//
// ADR-001 (isolation): every repo is a hermetic, throwaway git repo created with
//   `mkdtemp` rooted at `os.tmpdir()` + a real `git init`. The harness drives the
//   real install with an EXPLICIT `targetDir` so nothing ever lands in the CLI's
//   `process.cwd()`, this dev repo's tree, or the global workspace. It never names
//   the global-workspace helpers (globalWorkspacePaths / defaultGlobalWorkspaceDir).
//
// ADR-002/003 (reuse, no fake): the harness DELEGATES to the shipped engine. It
//   imports the real entry points — `initWork` (the install), `loadBundle` (the
//   bundle), and the work verbs (`findWork`/`listStream`/`validateWork`/`nextWork`)
//   — and re-exports the verbs so consumers resolve refs through the same code the
//   product ships. It hand-rolls NO install copy-loop, NO render/lock, and carries
//   NO scripted stand-in for the agent-driven refine/continue/verify loop.
import { spawnSyncHardened } from "./cli-spawn.mjs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initWork } from "../../src/work-init.mjs";
import { loadBundle } from "../../src/work-bundle.mjs";
import { findWork, listStream, validateWork, nextWork } from "../../src/work.mjs";

// Re-export the shipped work verbs so the proof stories resolve seeded refs
// through the SAME code the product ships (ADR-002) — never a private copy.
export { findWork, listStream, validateWork, nextWork };

// ---------------------------------------------------------------- repo ----

// Create a hermetic, throwaway repo: `mkdtemp` under the OS temp root + a real
// `git init` (ADR-001). Returns the absolute dir and an idempotent teardown.
export async function createRoundTripRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-roundtrip-"));

  // A REAL git repo — the loop expects one (ADR-001). `git init -q` in the dir.
  const result = spawnSyncHardened("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`git init failed in ${dir}: ${result.stderr ?? ""}`.trim());
  }

  // cleanup() removes the dir; `force: true` makes it safe when the dir is
  // already gone or cleanup runs twice (idempotent — never throws).
  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true });
  };

  return { dir, cleanup };
}

// ------------------------------------------------------------- install ----

// Run the REAL `aof work init` (the shipped `initWork`) into `dir` and return
// its structured result VERBATIM (ADR-002): { actions, manifest, manifestPath,
// guarded, manifestWritten, ... }. A guarded second no-force install is RETURNED
// by initWork (it does not throw) — pass that through unchanged.
export async function installBundle(dir, opts = {}) {
  const runtimes = Array.isArray(opts.runtimes) && opts.runtimes.length > 0 ? opts.runtimes : ["claude"];
  const force = Boolean(opts.force);
  return initWork({ targetDir: dir, runtimes, force });
}

// ---------------------------------------------------------------- seed ----

// A FIXED, byte-identical worked-milestone fixture (ADR-004): one milestone with
// two stories, each story carrying one task `.feature` whose single scenario is
// tagged ONLY `@executable` (a universal tag — the seeded repo has no
// `.aof/aof.config.json`, so any layer/domain tag would be flagged "unknown").
//
// Folder numbering is `00_milestone_sample` / `00_story_*` / `01_story_*`; the
// shipped verbs emit zero-padded refs ("00", "00/00", "00/01"). The returned
// refs MUST match what the verbs report — verified below before returning.
const SLUG = "sample";
const MILESTONE_DIR = "00_milestone_sample";
const STORY_DIRS = ["00_story_first", "01_story_second"];
const STORY_SLUGS = ["first", "second"];
const CREATED = "2026-01-01";
const UPDATED = "2026-01-01";

function milestoneSpec() {
  return `---
type: milestone
number: 0
slug: ${SLUG}
title: "Sample milestone"
status: not-started
created: ${CREATED}
updated: ${UPDATED}
depends: []
schema: 1
---
# 00 · Sample milestone

## Objective

A fixed, self-contained sample milestone the round-trip proof drives the loop over.
`;
}

function storyDoc(number, slug, title) {
  return `---
type: story
number: ${number}
slug: ${slug}
title: "${title}"
parent: 0
status: not-started
created: ${CREATED}
updated: ${UPDATED}
schema: 1
---
# 0${number} · ${title}

## User story

As a proof author,
I want a deterministic seeded story,
so that the round-trip loop has a stable target.
`;
}

function taskFeature(title) {
  return `@executable
Feature: ${title}

  Scenario: the sample behaves
    Given the seeded sample
    When the loop runs
    Then it resolves through the shipped verbs
`;
}

export async function seedSampleMilestone(dir) {
  const workDir = path.join(dir, "wiki", "work");
  const milestoneRoot = path.join(workDir, MILESTONE_DIR);

  await mkdir(milestoneRoot, { recursive: true });
  await writeFile(path.join(milestoneRoot, "SPEC.md"), milestoneSpec(), "utf8");

  for (let i = 0; i < STORY_DIRS.length; i += 1) {
    const storyDir = path.join(milestoneRoot, "stories", STORY_DIRS[i]);
    const tasksDir = path.join(storyDir, "tasks");
    await mkdir(tasksDir, { recursive: true });
    const slug = STORY_SLUGS[i];
    const title = i === 0 ? "First story" : "Second story";
    await writeFile(path.join(storyDir, "STORY.md"), storyDoc(i, slug, title), "utf8");
    await writeFile(path.join(tasksDir, `00_${slug}.feature`), taskFeature(`${title} task`), "utf8");
  }

  // Resolve the refs through the SHIPPED verbs (ADR-002) — never compute them by
  // hand. listStream emits the canonical ref strings; mirror them exactly so a
  // downstream story asserting against the returned refs matches the disk.
  const rows = await listStream(workDir);
  const milestoneRow = rows.find((row) => row.type === "milestone");
  const storyRows = rows.filter((row) => row.type === "story");
  const milestoneRef = milestoneRow.ref;
  const storyRefs = storyRows.map((row) => row.ref);

  // Self-check (ADR-004): the seed is a clean stream and the refs resolve. With
  // no project config the validator's tag vocabulary is empty, so the seeded
  // `@executable`-only scenarios must produce ZERO findings.
  const findings = await validateWork(workDir, {}, undefined);
  if (findings.length !== 0) {
    throw new Error(`seedSampleMilestone produced an unclean stream: ${JSON.stringify(findings)}`);
  }
  const found = await findWork(workDir, milestoneRef);
  if (!found.some((row) => row.ref === milestoneRef && row.type === "milestone")) {
    throw new Error(`seedSampleMilestone milestoneRef ${milestoneRef} did not resolve through findWork`);
  }
  for (const ref of storyRefs) {
    const storyFound = await findWork(workDir, ref);
    if (!storyFound.some((row) => row.ref === ref && row.type === "story")) {
      throw new Error(`seedSampleMilestone storyRef ${ref} did not resolve through findWork`);
    }
  }

  return { milestoneRef, storyRefs };
}
