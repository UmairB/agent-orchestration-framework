// test/support/gate-propagation-fixture.mjs — the shared REAL-GIT fixture family for
// milestone 43 / story 05 (gate-time propagation, ADR-008). Wraps the existing
// `withMeshWorkerExecFixture` / `withMeshWorkerPushFixture` real-local-repo builders and
// adds the ONE thing this story needs that no earlier milestone did: a real ITEM LINE with
// a shape — an item branch cut from an earlier control HEAD and carrying the worker's own
// commits, while the control's HEAD has moved on to a commit carrying a gate edit.
//
// Every shape here is built with a REAL `git` binary against a disposable temp repo (no
// mocked git, no network, no real forge — the milestone's own discipline). The three
// relationships the advance must distinguish are built explicitly rather than implied:
//
//   ALREADY-CURRENT — the item branch is cut from C2 and carries W1/W2, so the pinned base
//                     is already an ancestor of the tip (`cutFrom: "C2"`).
//   BEHIND          — the item branch is cut from C1 and carries NO worker commit, so the
//                     tip is strictly an ancestor of the pinned base (`workerCommits: 0`).
//   DIVERGED        — the item branch is cut from C1 and carries W1/W2 while C2 lands on
//                     the control's own line: neither tip is an ancestor of the other. This
//                     is the COMMON case and the one SPEC/STATE's word "fast-forward"
//                     mis-describes (ADR-008).
//
// `git(cwd, args)` here deliberately never passes `shell: true` (the
// mesh-worker-push-fixture.mjs rationale): on Windows a shell wrapper re-tokenizes each
// argv element on whitespace, silently corrupting any spaced value.
import { existsSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSyncHardened } from "./cli-spawn.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { createMeshWorkerExecutionHandler } from "../../src/mesh-worker-execution.mjs";
import { meshItemBranchName } from "../../src/mesh-worktree.mjs";
import {
  withMeshWorkerExecFixture,
  markRepoPublished,
  seedNodeWorkspaceMembership,
  createStatusRecorder,
  scriptedSpawnRuntime,
  scriptedPushExec,
} from "./mesh-worker-exec-fixture.mjs";
import { withMeshWorkerPushFixture } from "./mesh-worker-push-fixture.mjs";

export const NODE_ID = "worker-a";
// The gate edit itself: a file that exists in C2 and in NO worker commit, so "the control's
// edit arrived" is a single `git cat-file -e <branch>:<path>` away.
export const GATE_EDITED_PATH = "gate-edit.md";
// The two conflict shapes: the same line of the same file (W1 vs C2), and a delete/modify
// pair (W1 deletes it, C2 modifies it).
export const CONTESTED_PATH = "contested.md";
export const DOOMED_PATH = "doomed.md";

const ITEM_FIXTURE = { milestoneNumber: "43", storySlug: "gate-propagation", storyNumber: "05" };

export function git(cwd, args) {
  return spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
}

// gitOk(cwd, args) — a fixture step whose failure must be loud where it happens, never
// three assertions later as a mystifying shape mismatch.
export function gitOk(cwd, args) {
  const result = git(cwd, args);
  if (result.status !== 0) {
    throw new Error(`fixture: git ${args.join(" ")} in ${cwd} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

export function revParse(cwd, rev) {
  return git(cwd, ["rev-parse", rev]).stdout.trim();
}

// isAncestor(cwd, ancestor, descendant) — the litmus every scenario in this story is
// written in: `git merge-base --is-ancestor A B` exits 0 / non-zero.
export function isAncestor(cwd, ancestor, descendant) {
  return git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

// withGatePropagationFixture(fn, { origin }) — a ready worker fixture for item `43/05`:
// repo published, node membership seeded, workspace loaded. `origin: true` adds the REAL
// local BARE repo as `origin` (the push / fetch-once lanes need it); without it the repo
// has NO reachable origin at all, which is exactly what the unavailable-base lane wants.
export async function withGatePropagationFixture(fn, { origin = false } = {}) {
  const build = origin ? withMeshWorkerPushFixture : withMeshWorkerExecFixture;
  return build(async (fx) => {
    await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
    await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
    const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
    return fn({ ...fx, ws, branch: meshItemBranchName(fx.itemRef) });
  }, ITEM_FIXTURE);
}

// buildItemLine(fx, options) — the real git shape. Returns every hash the scenarios name.
//
//   cutFrom       — "C1" (the branch is cut from the earlier control HEAD → diverged /
//                   behind) or "C2" (the branch already contains the gate edit →
//                   already-current).
//   workerCommits — how many real worker commits (W1, W2, …) ride the branch.
//   conflict      — null | "same-line" (W1 and C2 edit the same line of CONTESTED_PATH)
//                   | "delete-modify" (W1 deletes DOOMED_PATH, C2 modifies it).
//   branch        — the branch to build the line on (defaults to the item's derived
//                   branch; the directive-carried `baseBranch` door passes its own name).
//   createBranch  — false leaves the item with NO local branch at all (the CREATE door's
//                   fixture, where the checkout has merely drifted past the pinned commit).
//   withC2        — false stops after the worker's line, leaving the control's new HEAD to
//                   be created elsewhere (the "the clone does not have it yet" lane creates
//                   C2 in a scratch clone of the bare origin instead).
export async function buildItemLine(fx, { cutFrom = "C1", workerCommits = 2, conflict = null, branch = meshItemBranchName(fx.itemRef), createBranch = true, withC2 = true } = {}) {
  const shape = { C0: fx.headSha, branch, workerCommits: [] };

  // ── C1: the earlier control HEAD the item branch is cut from ───────────────────────
  const c1Paths = ["c1.md"];
  await writeFile(path.join(fx.root, "c1.md"), "# c1 — the state the item branch was cut from\n", "utf8");
  if (conflict === "same-line") {
    await writeFile(path.join(fx.root, CONTESTED_PATH), "line-1\nline-2\nline-3-original\nline-4\n", "utf8");
    c1Paths.push(CONTESTED_PATH);
  }
  if (conflict === "delete-modify") {
    await writeFile(path.join(fx.root, DOOMED_PATH), "doomed-original\n", "utf8");
    c1Paths.push(DOOMED_PATH);
  }
  // Explicit pathspecs, never `git add -A` — the fixture repo also carries the mesh
  // worktrees root and any dirt a scenario planted; a fixture commit must stage exactly
  // what it names (m40/R4).
  gitOk(fx.root, ["add", "--", ...c1Paths]);
  gitOk(fx.root, ["commit", "-q", "-m", "c1-earlier-control-head"]);
  shape.C1 = revParse(fx.root, "HEAD");

  // ── C2: the control's NEW head, carrying the gate edit ─────────────────────────────
  const commitC2 = async () => {
    const c2Paths = [GATE_EDITED_PATH];
    await writeFile(path.join(fx.root, GATE_EDITED_PATH), "# the operator's gate edit\n", "utf8");
    if (conflict === "same-line") {
      await writeFile(path.join(fx.root, CONTESTED_PATH), "line-1\nline-2\nline-3-CONTROL\nline-4\n", "utf8");
      c2Paths.push(CONTESTED_PATH);
    }
    if (conflict === "delete-modify") {
      await writeFile(path.join(fx.root, DOOMED_PATH), "doomed-modified-by-control\n", "utf8");
      c2Paths.push(DOOMED_PATH);
    }
    gitOk(fx.root, ["add", "--", ...c2Paths]);
    gitOk(fx.root, ["commit", "-q", "-m", "c2-gate-edit"]);
    return revParse(fx.root, "HEAD");
  };

  if (cutFrom === "C2" && withC2) shape.C2 = await commitC2();
  if (createBranch) gitOk(fx.root, ["branch", branch, cutFrom === "C2" ? shape.C2 : shape.C1]);

  // ── W1…Wn: REAL worker commits on the item branch, made through a scratch worktree
  //    (the branch has no checkout of its own yet) which is released again afterwards.
  if (createBranch && workerCommits > 0) {
    const scratch = path.join(fx.tmp, `worker-line-${branch.replace(/[^A-Za-z0-9]/g, "-")}`);
    gitOk(fx.root, ["worktree", "add", "--quiet", scratch, branch]);
    try {
      for (let n = 1; n <= workerCommits; n += 1) {
        const file = `w${n}.md`;
        await writeFile(path.join(scratch, file), `# worker commit ${n}\n`, "utf8");
        const staged = [file];
        if (n === 1 && conflict === "same-line") {
          await writeFile(path.join(scratch, CONTESTED_PATH), "line-1\nline-2\nline-3-WORKER\nline-4\n", "utf8");
          staged.push(CONTESTED_PATH);
        }
        // `git rm` already stages the deletion, so DOOMED_PATH must NOT join the add list
        // below — it no longer exists as a pathspec.
        if (n === 1 && conflict === "delete-modify") gitOk(scratch, ["rm", "-q", "--", DOOMED_PATH]);
        gitOk(scratch, ["add", "--", ...staged]);
        gitOk(scratch, ["commit", "-q", "-m", `w${n}-worker-commit`]);
        shape.workerCommits.push(revParse(scratch, "HEAD"));
      }
    } finally {
      git(fx.root, ["worktree", "remove", scratch]);
      git(fx.root, ["worktree", "prune"]);
      await rm(scratch, { recursive: true, force: true });
    }
  }
  [shape.W1, shape.W2] = shape.workerCommits;

  if (cutFrom !== "C2" && withC2) shape.C2 = await commitC2();
  shape.tipBefore = createBranch ? revParse(fx.root, branch) : null;
  return shape;
}

// seedOriginOnlyCommit(fx, { onto }) — a commit that exists ONLY in the bare `origin`,
// never in the worker's own clone: pushed there from a THROWAWAY clone, so
// `ensureCommitAvailable`'s one `git fetch origin` is the only thing that can rescue it.
// Returns the hash. Requires the `origin: true` fixture.
export async function seedOriginOnlyCommit(fx, { onto = "control", file = GATE_EDITED_PATH, body = "# the operator's gate edit\n" } = {}) {
  gitOk(fx.root, ["push", "-q", "origin", `HEAD:refs/heads/${onto}`]);
  const scratch = path.join(fx.tmp, `origin-scratch-${onto}`);
  gitOk(fx.tmp, ["clone", "-q", "--branch", onto, fx.bareOrigin, scratch]);
  gitOk(scratch, ["config", "user.email", "fixture@aof.local"]);
  gitOk(scratch, ["config", "user.name", "aof fixture"]);
  gitOk(scratch, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(scratch, file), body, "utf8");
  gitOk(scratch, ["add", "--", file]);
  gitOk(scratch, ["commit", "-q", "-m", "c2-gate-edit-origin-only"]);
  const hash = revParse(scratch, "HEAD");
  gitOk(scratch, ["push", "-q", "origin", `HEAD:refs/heads/${onto}`]);
  await rm(scratch, { recursive: true, force: true });
  return hash;
}

// dirtyWorktree(worktreePath, { mode }) — the uncommitted work the dirty refusal exists to
// protect, in the three shapes task 01's Examples table names separately:
//   "tracked"   — a modification to a tracked file, unstaged;
//   "untracked" — a file the operator left in the tree, never added;
//   "staged"    — a change staged in the index but not committed;
//   "all"       — the first two together (the headline scenario's fixture).
export async function dirtyWorktree(worktreePath, { mode = "all" } = {}) {
  const trackedPath = path.join(worktreePath, "c1.md");
  const untrackedPath = path.join(worktreePath, "operator-scratch.txt");
  if (mode === "tracked" || mode === "staged" || mode === "all") {
    await writeFile(trackedPath, "# c1 — EDITED IN THE WORKTREE, never committed\n", "utf8");
  }
  if (mode === "untracked" || mode === "all") {
    await writeFile(untrackedPath, "the operator left this here\n", "utf8");
  }
  if (mode === "staged") gitOk(worktreePath, ["add", "--", "c1.md"]);
  return { trackedPath, untrackedPath };
}

// captureWorktreeState(worktreePath) — the BEFORE snapshot every "untouched" assertion in
// task 01 is literally compared against: the branch tip, the full porcelain status, the
// staged path list and the bytes of the two files a scenario may touch.
export async function captureWorktreeState(worktreePath) {
  const read = async (file) => {
    const full = path.join(worktreePath, file);
    return existsSync(full) ? await readFile(full, "utf8") : null;
  };
  return {
    tip: revParse(worktreePath, "HEAD"),
    status: git(worktreePath, ["status", "--porcelain"]).stdout,
    staged: git(worktreePath, ["diff", "--cached", "--name-only"]).stdout,
    tracked: await read("c1.md"),
    untracked: await read("operator-scratch.txt"),
    contested: await read(CONTESTED_PATH),
    doomed: await read(DOOMED_PATH),
  };
}

// recordingGitExec(calls, { afterWorktreeAdd }) — the injected exec seam (the SAME
// `(args, { cwd }) => Promise<{ stdout, stderr, status }>` contract mesh-worktree.mjs
// spawns through), wrapping a REAL `git` spawn with a call-order recorder — never a mocked
// git. `afterWorktreeAdd` is the ONE hook a dispatch-altitude dirty-tree lane needs: the
// dispatch path always materializes a FRESH worktree, so the only faithful way to reach the
// guard from the outside is to plant the uncommitted work at the instant the worktree
// exists, which is exactly the moment an operator's leftovers would already be there.
export function recordingGitExec(calls, { afterWorktreeAdd = null } = {}) {
  return async (args, options = {}) => {
    const entry = { args: [...args], cwd: options.cwd, kind: args[0] === "worktree" ? `worktree-${args[1]}` : args.join(" ") };
    calls.push(entry);
    const result = await new Promise((resolve, reject) => {
      const done = git(options.cwd, args);
      if (done.error && (done.error.code === "ENOENT" || done.signal)) {
        reject(done.error);
        return;
      }
      resolve({ stdout: String(done.stdout ?? ""), stderr: String(done.stderr ?? ""), status: done.status ?? 1 });
    });
    entry.status = result.status;
    if (afterWorktreeAdd != null && args[0] === "worktree" && args[1] === "add" && result.status === 0) {
      await afterWorktreeAdd(args);
    }
    return result;
  };
}

// createGateDispatch(fx) — drives the REAL `createMeshWorkerExecutionHandler` for this
// fixture's item, with the pin (`commit`) and the cache-resolved door (`baseBranch`) riding
// the directive VERBATIM. Returns the recorded status/effect frames AND every `onLog` entry
// the worker emitted — the same seam `worker-worktree-base` is emitted through, so channel
// identity is itself observable.
export function createGateDispatch(fx, ws) {
  return async function dispatch(assignmentId, {
    commit,
    baseBranch,
    exec,
    pushExec,
    spawnRuntime,
    outcome = "failed",
    onLog,
    now = "2026-08-04T09:00:00.000Z",
    requestWriteCredential,
    command,
  } = {}) {
    const recorder = createStatusRecorder();
    const logs = [];
    const handler = createMeshWorkerExecutionHandler({
      loadWs: () => Promise.resolve(ws),
      nodeId: NODE_ID,
      sendAssignmentStatus: recorder.sendAssignmentStatus,
      sendEffectStep: recorder.sendEffectStep,
      spawnRuntime: spawnRuntime ?? scriptedSpawnRuntime(outcome),
      pushExec: pushExec ?? scriptedPushExec(),
      now: () => now,
      globalWorkStoreOptions: { env: fx.env },
      exec,
      // Record first, THEN hand to the caller's sink — a faulting sink lane still gets to
      // see that the entry was attempted, and the throw still reaches the handler's own
      // degrade wrapper.
      onLog: (entry) => { logs.push(entry); onLog?.(entry); },
      requestWriteCredential,
    });
    await handler({
      kind: "directive",
      to: NODE_ID,
      assignmentId,
      itemRef: fx.itemRef,
      workspaceId: fx.workspaceId,
      at: now,
      ...(command != null ? { command } : {}),
      ...(commit != null ? { commit } : {}),
      ...(baseBranch != null ? { baseBranch } : {}),
    });
    return { recorder, logs, frames: recorder.frames };
  };
}

// advanceEntry(logs) — the ONE advance line the worker emits per dispatch, on the same sink
// as `worker-worktree-base`.
export function advanceEntry(logs) {
  return logs.filter((entry) => entry.code === "worker-gate-propagation");
}

// parseAdvance(entry) — the machine-readable half of that line: the reported outcome (or
// refusal code) and BOTH commits.
export function parseAdvance(entry) {
  const message = String(entry?.message ?? "");
  const reported = /gate-propagation ([a-z-]+) on (\S+)/.exec(message);
  const commits = /base ([0-9a-f]{40}), tip ([0-9a-f]{40})/.exec(message);
  return {
    reported: reported?.[1] ?? null,
    branch: reported?.[2] ?? null,
    base: commits?.[1] ?? null,
    tip: commits?.[2] ?? null,
    level: entry?.level ?? null,
  };
}

// settledFrame(frames, assignmentId, state) — the settled terminal report for an
// assignment, read off the recorder's combined channel view.
export function settledFrame(frames, assignmentId, state) {
  return frames.find((frame) => frame.assignmentId === assignmentId && frame.state === state) ?? null;
}
