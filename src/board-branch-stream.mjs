// src/board-branch-stream.mjs — reading a mesh item's work stream FROM ITS BRANCH
// (VERIFICATION, live two-machine soak 2026-07-25).
//
// THE DEFECT, second half (operator-reported): with the execution overlay in place the
// board correctly said "last run done on umairs-mac-mini · branch aof/mesh/18-…" — and
// then showed "No stories in this milestone yet · 0 stories". The refine had authored
// SEVEN stories (plus ARCHITECTURE/DESIGN/RESEARCH/STATE and a `status: in-progress`
// SPEC), but ALL of it lives on the mesh BRANCH: the control node's own checkout is on
// `main`, which carries only the milestone's original SPEC.md. So the board listed the
// local truth and the milestone read as an empty, un-started scaffold over a milestone
// that has been fully broken down.
//
// WHY GIT AND NOT A FABRIC ROUND-TRIP. The worker pushes its branch home on every
// completed run (story 07 + the recovery push), so the control node ALREADY has the work
// as an ordinary remote-tracking ref — MEASURED on the live node:
// `origin/aof/mesh/18-73ab17b2-…` resolves locally with no fetch, no credential and no
// network. Reading the branch is therefore strictly simpler AND strictly more available
// than asking the worker over the fabric: it needs no live worker, no surviving worktree,
// and no auth. (A fabric doc-bridge would add all three failure modes to answer the same
// question.) A ref that is NOT present locally is simply "no branch stream" — the caller
// degrades to the local rows rather than reaching for the network.
//
// It is READ-ONLY and never checks anything out: `git ls-tree` + `git show` against the
// ref, never a checkout, a fetch, a merge or a worktree — so it cannot disturb whatever
// the operator has in their working tree.
import { execFile } from "node:child_process";
import path from "node:path";
import { parseFrontmatter } from "./work.mjs";

// The default git exec seam — argv-form, shell-less, output-capturing. Injected in tests.
function defaultExec(args, { cwd } = {}) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        status: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
      });
    });
  });
}

// resolveBranchRef(projectRoot, branch, exec) → the ref that actually resolves for this
// branch, or null. Prefers the REMOTE-tracking ref (`origin/<branch>` — what a worker's
// push lands in on the control node) and falls back to a local branch of the same name
// (the worker's own machine, or a control that has checked it out). Never fetches.
export async function resolveBranchRef(projectRoot, branch, { exec = defaultExec } = {}) {
  if (typeof branch !== "string" || branch.length === 0) return null;
  for (const candidate of [`origin/${branch}`, branch]) {
    const probe = await exec(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], { cwd: projectRoot });
    if (probe.status === 0 && probe.stdout.trim()) return candidate;
  }
  return null;
}

// The record doc that names each item type (the same convention work.mjs uses on disk).
const MILESTONE_RE = /^(\d+)_milestone_([^/]+)\/SPEC\.md$/;
const STORY_RE = /^(\d+)_milestone_[^/]+\/stories\/(\d+)_story_([^/]+)\/STORY\.md$/;

// readBranchItems(projectRoot, branch, options) → rows[] | null — the work-stream rows for
// `itemRef`'s subtree AS THEY EXIST ON THE BRANCH: the milestone itself plus each story
// the branch carries, in the SAME row shape `listStream` emits (ref/type/slug/status/
// title/parent/dir), so the board renders them through its existing model unchanged.
//
// Returns null when the ref does not resolve or the tree read fails — "no branch stream",
// which the caller reads as "keep the local rows" (the overlay's own step 3).
export async function readBranchItems(projectRoot, branch, { workDirRel = "wiki/work", itemRef, exec = defaultExec } = {}) {
  const ref = await resolveBranchRef(projectRoot, branch, { exec });
  if (ref == null) return null;

  const listing = await exec(["ls-tree", "-r", "--name-only", ref, "--", `${workDirRel}/`], { cwd: projectRoot });
  if (listing.status !== 0) return null;

  // Only the record docs, and only inside the requested item's own milestone subtree —
  // a branch may carry the whole work dir, but this answers a question about ONE item.
  const milestoneNumber = String(itemRef ?? "").split("/")[0];
  const rows = [];
  for (const line of listing.stdout.split("\n")) {
    const file = line.trim();
    if (!file.startsWith(`${workDirRel}/`)) continue;
    const rel = file.slice(workDirRel.length + 1);

    const milestone = MILESTONE_RE.exec(rel);
    if (milestone && milestone[1] === milestoneNumber) {
      rows.push({ kind: "milestone", number: milestone[1], slug: milestone[2], file, dir: path.posix.dirname(file) });
      continue;
    }
    const story = STORY_RE.exec(rel);
    if (story && story[1] === milestoneNumber) {
      rows.push({ kind: "story", number: story[2], slug: story[3], parent: story[1], file, dir: path.posix.dirname(file) });
    }
  }
  if (rows.length === 0) return null;

  const out = [];
  for (const row of rows) {
    // `git show <ref>:<path>` — the doc's content AT THE BRANCH, never the working tree.
    const shown = await exec(["show", `${ref}:${row.file}`], { cwd: projectRoot });
    const meta = shown.status === 0 ? safeFrontmatter(shown.stdout) : {};
    out.push({
      ref: row.kind === "milestone" ? row.number : `${row.parent}/${row.number}`,
      type: row.kind,
      slug: row.slug,
      status: meta.status ?? null,
      title: meta.title ?? null,
      parent: row.kind === "milestone" ? null : row.parent,
      // The path the doc WOULD occupy in this checkout. It is reported for continuity with
      // listStream's own row shape; the board's doc route resolves content separately.
      dir: path.posix.join(projectRoot.replaceAll("\\", "/"), row.dir),
      // Provenance: this row was read from a branch, not from this checkout's own files.
      // The surface uses it to say so rather than implying the work is local.
      fromBranch: branch,
    });
  }
  // Milestone first, then stories by number — listStream's own ordering.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "milestone" ? -1 : 1;
    return Number.parseInt(a.ref.split("/").pop(), 10) - Number.parseInt(b.ref.split("/").pop(), 10);
  });
  return out;
}

// parseFrontmatter (work.mjs) returns the attribute object directly, and `{}` for a doc
// with no frontmatter block — so a malformed/absent header is simply "no status/title".
function safeFrontmatter(text) {
  try {
    return parseFrontmatter(text) ?? {};
  } catch {
    return {};
  }
}

// mergeBranchItems(rows, branchRows) → rows — splices a branch-read subtree into the local
// stream: the milestone row is REPLACED in place (so its branch status/title win — the
// whole point: `in-progress` over the local `not-started`), and its stories are inserted
// directly after it. A story that also exists locally is replaced rather than duplicated.
// Rows outside the subtree are untouched and keep their positions.
export function mergeBranchItems(rows, branchRows) {
  if (!Array.isArray(branchRows) || branchRows.length === 0) return rows;
  const milestone = branchRows.find((row) => row.type === "milestone");
  if (milestone == null) return rows;

  const byRef = new Map(branchRows.map((row) => [row.ref, row]));
  const out = [];
  let spliced = false;
  for (const row of rows) {
    // Drop the local rows this branch subtree supersedes; they are re-emitted (from the
    // branch) at the milestone's own position, so ordering is preserved.
    if (byRef.has(row.ref)) {
      if (row.ref !== milestone.ref) continue;
      out.push(...branchRows);
      spliced = true;
      continue;
    }
    // A local story of this milestone that the branch does NOT carry stays as it is.
    out.push(row);
  }
  if (!spliced) out.push(...branchRows);
  return out;
}
