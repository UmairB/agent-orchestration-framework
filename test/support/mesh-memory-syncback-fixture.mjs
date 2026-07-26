// test/support/mesh-memory-syncback-fixture.mjs — shared REAL-git fixture for
// milestone 38 / story 08 (worker-verified-memory-syncback, ADR-016) tasks 00/01. A
// temp project checkout whose `wiki/work/<milestone>` folder carries a BASE
// RETROSPECTIVE.md/ARCHITECTURE.md on the checked-out branch, plus a SEPARATE real git
// branch ("worker-verified") that additionally carries a worker-authored RETROSPECTIVE
// `R<n>` lesson + `ADR-NNN` block — so a caller drives the REAL git mechanics (a real
// `git merge`, the local analog of "as after a `git pull`" — no network hop is needed
// to exercise the merge itself) rather than hand-building a record fixture (the
// milestone's own recurring F1/F4 failure class: a fixture shaped to the consumer's
// convenience, never its actual producer).
//
// Mirrors test/support/mesh-worker-exec-fixture.mjs's git-fixture-repo idiom, but NEVER
// `shell: true` (test/support/mesh-worker-push-fixture.mjs's own documented reason: a
// spaced temp-dir path is silently re-tokenized by cmd.exe under `shell: true`).
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSyncHardened } from "./cli-spawn.mjs";

function git(cwd, args) {
  return spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
}

function requireOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`fixture: ${label} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

// FIVE baseline lessons (R1..R5) — not one. `rankRecords`' type-boost tiebreaker
// (05/ADR-006) ranks every `lesson` record above a content-score of 0 with NO
// relevance floor, so a corpus of only ONE baseline lesson would let a genuinely
// off-topic query still surface the worker's single appended lesson within the
// default `--limit 5` window (a tie, broken by insertion order alone). FIVE
// baseline lessons — a realistic shape (an established project already carries
// prior lessons) — fill that default window BEFORE the worker's lesson's tied
// position is ever reached, so an off-topic query's default-limit recall
// genuinely, relevantly excludes it (never an artificial --limit trick).
const BASE_RETROSPECTIVE = `# RETROSPECTIVE

## R1 · Baseline lesson unrelated to the syncback fixture
- **Kind:** near-miss · **Area:** testing · **Stage:** build · **Owner:** qa
- **What happened:** A baseline lesson exists before any worker branch merges.
- **Why:** It anchors the "before merge" recall so the corpus is never empty.
- **Lesson:** Baseline content stays present regardless of the worker branch state.

## R2 · A second baseline lesson unrelated to the syncback fixture
- **Kind:** near-miss · **Area:** testing · **Stage:** build · **Owner:** qa
- **What happened:** A second baseline lesson exists before any worker branch merges.
- **Why:** It widens the baseline corpus past the default recall limit.
- **Lesson:** A wider baseline corpus is a more realistic fixture shape.

## R3 · A third baseline lesson unrelated to the syncback fixture
- **Kind:** near-miss · **Area:** testing · **Stage:** build · **Owner:** qa
- **What happened:** A third baseline lesson exists before any worker branch merges.
- **Why:** It widens the baseline corpus past the default recall limit.
- **Lesson:** A wider baseline corpus is a more realistic fixture shape.

## R4 · A fourth baseline lesson unrelated to the syncback fixture
- **Kind:** near-miss · **Area:** testing · **Stage:** build · **Owner:** qa
- **What happened:** A fourth baseline lesson exists before any worker branch merges.
- **Why:** It widens the baseline corpus past the default recall limit.
- **Lesson:** A wider baseline corpus is a more realistic fixture shape.

## R5 · A fifth baseline lesson unrelated to the syncback fixture
- **Kind:** near-miss · **Area:** testing · **Stage:** build · **Owner:** qa
- **What happened:** A fifth baseline lesson exists before any worker branch merges.
- **Why:** It widens the baseline corpus past the default recall limit.
- **Lesson:** A wider baseline corpus is a more realistic fixture shape.
`;

const BASE_ARCHITECTURE = `# ARCHITECTURE

## ADR-100: Baseline decision unrelated to the syncback fixture

**Status:** Accepted
**Context:** A baseline decision exists before any worker branch merges.
**Decision:** Keep a baseline ADR present regardless of the worker branch state.
`;

// The default worker-authored RETROSPECTIVE `R<n>` lesson block (appended on the
// "worker-verified" branch only) — carries a distinctive canary keyword so recall can
// unambiguously prove absent-before / present-after.
export function workerLessonBlock({ id = "R9", keyword = "zephyrlesson", area = "memory" } = {}) {
  return `
## ${id} · Worker-authored lesson carrying the ${keyword} canary keyword
- **Kind:** near-miss · **Area:** ${area} · **Stage:** verify · **Owner:** worker-node-a
- **What happened:** A story was verified on a WORKER node, off the control node.
- **Why:** The durable knowledge needed a documented path back to the control node.
- **Lesson:** ${keyword} proves the worker-authored lesson becomes recallable on the control node once merged + re-ingested.
`;
}

// The default worker-authored `ADR-NNN` block (appended on the "worker-verified"
// branch only) — its own distinct canary keyword.
export function workerAdrBlock({ id = "ADR-902", keyword = "zephyradr" } = {}) {
  return `
## ${id}: Worker-authored decision carrying the ${keyword} canary keyword

**Status:** Accepted
**Context:** A story was verified on a WORKER node, producing a durable architecture decision.
**Decision:** ${keyword} proves the worker-authored ADR becomes recallable on the control node once merged + re-ingested.
`;
}

// withMeshMemorySyncbackFixture(fn, opts) — builds a REAL git repo whose checked-out
// branch (`fx.baseBranch`) holds ONLY the baseline RETROSPECTIVE/ARCHITECTURE, and a
// SEPARATE "worker-verified" branch that additionally carries the worker-authored
// lesson/ADR blocks. Hands the caller { tmp, root, workDir, milestoneDir, baseBranch,
// git(args), mergeWorkerBranch() } — mergeWorkerBranch() runs a REAL `git merge` of the
// worker branch into the checked-out base branch (the state "as after a `git pull`").
// Cleanup removes the whole temp tree unconditionally.
export async function withMeshMemorySyncbackFixture(fn, { milestoneNumber = "97", slug = "syncback-fixture", lesson, adr } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mem-syncback-"));
  const root = path.join(tmp, "repo");
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, `${milestoneNumber}_milestone_${slug}`);
  try {
    await mkdir(milestoneDir, { recursive: true });
    await writeFile(
      path.join(milestoneDir, "SPEC.md"),
      `---\ntype: milestone\nnumber: ${milestoneNumber}\nslug: ${slug}\nstatus: in-progress\ntitle: Syncback fixture\n---\n`,
      "utf8",
    );
    await writeFile(path.join(milestoneDir, "RETROSPECTIVE.md"), BASE_RETROSPECTIVE, "utf8");
    await writeFile(path.join(milestoneDir, "ARCHITECTURE.md"), BASE_ARCHITECTURE, "utf8");
    // The control checkout's OWN gitignore: `.aof/` (the derived record store, F-02)
    // and `graphify-out/` (the derived graph, 10/ADR-005) never travel with the
    // committed markdown — the load-bearing ADR-016 fact task 00 pins.
    await writeFile(path.join(root, ".gitignore"), ".aof/\ngraphify-out/\n", "utf8");

    requireOk(git(root, ["init", "-q"]), "git init");
    requireOk(git(root, ["config", "user.email", "fixture@aof.local"]), "git config user.email");
    requireOk(git(root, ["config", "user.name", "aof fixture"]), "git config user.name");
    requireOk(git(root, ["config", "commit.gpgsign", "false"]), "git config commit.gpgsign");
    requireOk(git(root, ["add", "-A"]), "git add (base)");
    requireOk(git(root, ["commit", "-q", "-m", "control-base"]), "git commit (base)");
    const baseBranch = requireOk(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]), "git rev-parse HEAD").stdout.trim();

    requireOk(git(root, ["checkout", "-q", "-b", "worker-verified"]), "git checkout -b worker-verified");
    const lessonBlock = lesson ?? workerLessonBlock();
    const adrBlock = adr ?? workerAdrBlock();
    await writeFile(path.join(milestoneDir, "RETROSPECTIVE.md"), BASE_RETROSPECTIVE + lessonBlock, "utf8");
    await writeFile(path.join(milestoneDir, "ARCHITECTURE.md"), BASE_ARCHITECTURE + adrBlock, "utf8");
    requireOk(git(root, ["add", "-A"]), "git add (worker)");
    requireOk(git(root, ["commit", "-q", "-m", "worker-verified-story"]), "git commit (worker)");
    requireOk(git(root, ["checkout", "-q", baseBranch]), "git checkout base branch");

    const mergeWorkerBranch = () => requireOk(git(root, ["merge", "-q", "--no-edit", "worker-verified"]), "git merge worker-verified");

    return await fn({ tmp, root, workDir, milestoneDir, baseBranch, git: (args) => git(root, args), mergeWorkerBranch });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
