// src/work-content-read.mjs — the WORKER-side content read (schema v5, TECH_DEBT
// item 6), widened to the ADR-007 artifact manifest by milestone 43 / story 03.
//
// WHY IT IS ITS OWN MODULE. It lived in `global-work-store.mjs` until this story.
// ADR-012/B4 put a line ceiling on that module precisely so the NEXT block lands in a
// module of its own and is CALLED from the store rather than added to it — this is
// that ruling applied to the first block that arrived after it. The move is
// structural only: the function's signature, its row shapes and its absent/error
// discipline are byte-unchanged, and its one caller (`global-work-publisher.mjs`,
// which re-exports it for the launcher) now imports it from here.
//
// ADR-005 category (b): a WORKER reading its own materialized worktree is the
// intended behaviour and must never be migrated onto the control's cache — that would
// make a worker read someone else's opinion of its own checkout. It therefore keeps
// importing `work.mjs`'s disk readers, deliberately.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { listItems } from "./work.mjs";
import { readRuns } from "./run-store.mjs";
import { WORK_ITEM_ARTIFACTS, hashArtifactBody, isArtifactMember } from "./work-artifacts.mjs";

// readWorkspaceContentRecords(workspace, { itemRef }) — for every item in the
// workspace that belongs to `itemRef`'s subtree (the item, its milestone, the
// milestone's children — the SAME scoping rule the worktree delta rows use), collect
// the requestable artifact bodies (the ADR-007 MANIFEST: 8 exact filenames plus every
// `.feature` member of `tasks/`) and the item's run records (run-store's own reader,
// so a streamed record is byte-identical to a local read). Each artifact carries its
// own CONTENT hash, which is what lets the tick send only what actually moved
// (ADR-007/AC8). A missing file is absent-not-error (skipped); any OTHER read fault
// lands in `errors` for the caller to report — never swallowed, never fatal to the
// rest of the read.
// `items` is an OPTIONAL already-enumerated item list (ADR-013's health finding: the
// tick walked `listItems` twice per worktree per tick — once for the drain's path
// attribution and again in here). Absent, the read enumerates for itself, so every
// existing caller is byte-unchanged.
export async function readWorkspaceContentRecords(workspace, { itemRef, items } = {}) {
  const docs = [];
  const runs = [];
  const errors = [];
  const milestone = typeof itemRef === "string" && itemRef.length > 0 ? itemRef.split("/")[0] : null;
  for (const item of items ?? await listItems(workspace.workDir)) {
    if (milestone != null
      && item.ref !== itemRef
      && item.ref !== milestone
      && String(item.parent ?? "") !== milestone) continue;
    for (const [doc, relPath] of await itemArtifactFiles(item.dir, errors)) {
      const filePath = path.join(item.dir, ...relPath.split("/"));
      try {
        const body = await readFile(filePath, "utf8");
        docs.push({ ref: item.ref, doc, body, hash: hashArtifactBody(body) });
      } catch (error) {
        if (error?.code !== "ENOENT") {
          errors.push({ sourcePath: normalizeSourcePath(filePath), message: error.message, code: error.code ?? "content-read-failed" });
        }
      }
    }
    try {
      for (const record of await readRuns(item)) {
        if (typeof record?.runId === "string" && record.runId.length > 0) {
          runs.push({ ref: item.ref, runId: record.runId, record });
        }
      }
    } catch (error) {
      errors.push({ sourcePath: normalizeSourcePath(path.join(item.dir, "runs")), message: error.message, code: error.code ?? "content-read-failed" });
    }
  }
  return { docs, runs, errors };
}

// itemArtifactFiles(itemDir, errors) → [[docKey, relPath]] — the manifest expanded
// against ONE item's directory. A `file` entry is itself; a `dir` entry lists its
// directory ONCE and keeps only the members the manifest admits (the membership rule
// lives in work-artifacts.mjs, so the streamed set cannot disagree with the
// requestable one). An absent `tasks/` dir is absent-not-error; any other listing
// fault is reported.
async function itemArtifactFiles(itemDir, errors) {
  const out = [];
  for (const entry of WORK_ITEM_ARTIFACTS) {
    if (entry.file != null) {
      out.push([entry.name, entry.file]);
      continue;
    }
    const dirPath = path.join(itemDir, entry.dir);
    try {
      for (const name of (await readdir(dirPath)).sort()) {
        if (isArtifactMember(entry, name)) out.push([`${entry.name}/${name}`, `${entry.dir}/${name}`]);
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") {
        errors.push({ sourcePath: normalizeSourcePath(dirPath), message: error.message, code: error.code ?? "content-read-failed" });
      }
    }
  }
  return out;
}

// The error-path spelling `global-work-store.mjs` uses, carried with the function so
// a reported `sourcePath` is byte-identical to what it always was.
function normalizeSourcePath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}
