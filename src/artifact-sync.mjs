// src/artifact-sync.mjs — the write-triggered artifact sync's DRAIN half
// (milestone 43 / ADR-001).
//
// The producer is `.claude/hooks/aof/artifact-sync-enqueue.mjs`, a PostToolUse hook
// that derives nothing and appends one NDJSON line per artifact write. THIS module is
// the consumer: the worker daemon drains that queue on its EXISTING stream tick
// (`pushActiveWorktreeState`, mesh-launcher.mjs), de-duplicates by path, and hands the
// tick a batch. No new timer, no new transport, no new listening surface.
//
// LOSS-AVERSION IS THE CONTRACT, the mechanism is rename-then-read. A drain moves the
// queue aside to a BATCH file and leaves it there; only a confirmed send discards it.
// An interruption at ANY point therefore RE-SENDS rather than loses — a duplicate send
// is harmless (the content tables are upserted per (ref, doc)), so re-send is always
// the safe side to fail to.
//
// WHAT THE HOOK BUYS, STATED HONESTLY. The tick still runs the reconciliation
// backstop STATE mandates keeping — a full read of the item subtree's manifest
// artifacts — because a `Bash`-written file is deliberately outside the hook's matcher
// and must still converge on the very next tick. So the hook does NOT remove the local
// read; what it removes is the WIRE cost and the silence:
//   - the per-artifact CONTENT hash means an unchanged artifact is never re-sent, so
//     a steady-state tick carries no bodies at all (ADR-007/AC8);
//   - the queue NAMES what the agent touched, which is how a named-but-now-missing
//     artifact becomes a coded degrade instead of a silent nothing;
//   - an `unresolved-path` line reaches an operator instead of dying in the hook.
// This is recorded rather than glossed: ADR-001's "O(changed)" is realised on the
// wire, not on the local read, for as long as the one-tick backstop is required.
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { artifactForRelativePath, canonicalArtifactDocKey, hashArtifactBody, normalizeArtifactPath } from "./work-artifacts.mjs";

// THE ONE HOME for both stamped paths. The hook's argv is stamped from here at
// install time (claude-settings.mjs) and the drain resolves the same two paths for a
// worktree — a second spelling anywhere is how the producer and the consumer would
// end up talking about different files.
export const ARTIFACT_SYNC_QUEUE_RELPATH = ".aof/artifact-sync-queue.ndjson";
export const ARTIFACT_SYNC_SCRIPT_RELPATH = ".claude/hooks/aof/artifact-sync-enqueue.mjs";

// …and the ONE spelling of the argv element the ENTRY carries. `${CLAUDE_PROJECT_DIR}`
// is a token the harness substitutes into `command` and every `args` element at spawn
// time — it is NOT a shell variable (exec form runs no shell) and is NOT read by the
// script, so the committed entry stays correct in every checkout and every worktree
// without an install-time absolute path ever entering the tracked file.
//
// A BARE relative path here does NOT work: hooks are spawned with the session's
// PERSISTED SHELL CWD, not the project directory, so after any `cd` the path missed and
// node exited MODULE_NOT_FOUND — a non-blocking hook error, i.e. a silent no-op.
export const ARTIFACT_SYNC_SCRIPT_ARGV = `\${CLAUDE_PROJECT_DIR}/${ARTIFACT_SYNC_SCRIPT_RELPATH}`;
const BATCH_SUFFIX = ".batch";

export function artifactSyncQueuePath(root) {
  return path.join(root, ...ARTIFACT_SYNC_QUEUE_RELPATH.split("/"));
}

export function artifactSyncScriptPath(root) {
  return path.join(root, ...ARTIFACT_SYNC_SCRIPT_RELPATH.split("/"));
}

export function artifactSyncBatchPath(root) {
  return `${artifactSyncQueuePath(root)}${BATCH_SUFFIX}`;
}

// drainArtifactQueue(root) — CONSUME the queue by rename-then-read.
//
// A batch left over from a previous drain (the process died before the send was
// confirmed) is carried FIRST and re-sent; the current queue is folded into it, so a
// crash costs a duplicate, never a loss. Returns every whole line parsed, plus the
// count of torn ones — a torn final line (the hook was mid-append) is REPORTED by the
// caller, never silently dropped.
export async function drainArtifactQueue(root) {
  const queuePath = artifactSyncQueuePath(root);
  const batchPath = artifactSyncBatchPath(root);
  const carried = await readTextIfPresent(batchPath);
  if (carried == null) {
    // Nothing carried: the atomic move IS the consume — the hook's next append
    // creates a fresh queue file, so no line can be lost between the two.
    if (!(await renameIfPresent(queuePath, batchPath))) {
      return { batchPath, entries: [], lines: 0, torn: 0, carried: false };
    }
  } else {
    // A carry exists. Fold the current queue into it (append, then remove the
    // queue) so the batch stays the ONE thing a send has to confirm.
    const pending = await readTextIfPresent(queuePath);
    if (pending != null) {
      await writeFile(batchPath, `${endWithNewline(carried)}${pending}`, "utf8");
      await rm(queuePath, { force: true });
    }
  }
  const text = (await readTextIfPresent(batchPath)) ?? "";
  return { ...parseQueueText(text), batchPath, carried: carried != null };
}

// discardArtifactBatch(root) — the confirmation half. Called ONLY after the tick has
// sent (or has nothing to send); until then the batch survives every crash.
export async function discardArtifactBatch(root) {
  await rm(artifactSyncBatchPath(root), { force: true });
}

// parseQueueText(text) — every WHOLE line, plus a count of the torn ones. Exported
// for the drain's own tests; the tolerance is the same one run-store applies to a
// torn record on disk (skip the bad line, keep the rest).
export function parseQueueText(text) {
  const entries = [];
  let torn = 0;
  let lines = 0;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    lines += 1;
    try {
      const parsed = JSON.parse(line);
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) entries.push(parsed);
      else torn += 1;
    } catch {
      torn += 1;
    }
  }
  return { entries, lines, torn };
}

// resolveDrainedArtifacts(entries, { workDir, items }) — turn the queue's verbatim
// paths into artifact identities. This is where canonicalisation happens, deliberately:
// the hook carries the payload's path VERBATIM because normalising it there would be a
// cwd derivation (TECH_DEBT item 4), so the drain — which knows the worktree — is the
// only place that can do it.
//
//   named          [{ ref, docKey, path }]  in-manifest, inside a known item
//   unresolved     the coded `unresolved-path` lines (a matched tool whose mapped field
//                  was absent) — a DEGRADE the caller reports, never a silence
//   unattributable a path that NAMES a manifest artifact (`…/STORY.md`, `…/x.feature`)
//                  and could not be attributed to an item: a relative path the hook
//                  carried verbatim, a lower-cased drive letter, a case-different
//                  segment. These are the same file on Windows and different strings
//                  here, and dropping them silently is how an artifact stops being
//                  reported without anyone learning why. A DEGRADE, coded.
//   ignored        everything else — a path outside the manifest and outside every
//                  item. Deliberately NOT reported: an agent writes `src/*.mjs` all day
//                  and a warning per write is the log spam that makes a channel useless.
//                  The discriminator is the manifest, so the report stays bounded.
export function resolveDrainedArtifacts(entries, { items = [] } = {}) {
  const named = new Map();
  const unresolved = [];
  const unattributable = new Map();
  let ignored = 0;
  const dirs = items
    .filter((item) => typeof item?.dir === "string" && item.dir.length > 0)
    .map((item) => ({ ref: item.ref, prefix: `${normalizeArtifactPath(item.dir)}/` }))
    // Longest prefix first: a story's dir lives INSIDE its milestone's dir, so a
    // shortest-first match would attribute every story artifact to the milestone.
    .sort((a, b) => b.prefix.length - a.prefix.length);

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.code === "unresolved-path") {
      unresolved.push({ tool: typeof entry.tool === "string" ? entry.tool : null });
      continue;
    }
    const normalized = normalizeArtifactPath(entry?.path);
    if (normalized == null) {
      ignored += 1;
      continue;
    }
    const owner = dirs.find((candidate) => normalized.startsWith(candidate.prefix));
    if (owner == null) {
      if (looksLikeArtifactPath(normalized)) unattributable.set(normalized, { path: normalized, tool: typeof entry.tool === "string" ? entry.tool : null });
      else ignored += 1;
      continue;
    }
    const artifact = artifactForRelativePath(normalized.slice(owner.prefix.length));
    if (artifact == null) {
      // Attributed to an item, but not to a manifest artifact WITHIN it. Two different
      // cases, and only one is reportable: `<item>/notes.md` and `<item>/tasks/00_A.FEATURE`
      // are deliberate non-members (task 02 bounds the set) and stay silent, while a path
      // whose own last segment names an artifact — `…/STORIES/03_story/STORY.md`, a
      // case-different segment that is the same file on Windows — is a spelling this
      // drain could not follow, and that is exactly the silence F-6 removes.
      if (looksLikeArtifactPath(normalized)) unattributable.set(normalized, { path: normalized, tool: typeof entry.tool === "string" ? entry.tool : null });
      else ignored += 1;
      continue;
    }
    const docKey = canonicalArtifactDocKey(artifact.member == null ? artifact.name : `${artifact.name}/${artifact.member}`);
    // De-duplication by (ref, artifact): five edits of one file in one tick window
    // are ONE body, and `/` vs `\` is the same file. The Map key is what makes both
    // true without a second rule for the separator case.
    named.set(`${owner.ref}::${docKey}`, { ref: owner.ref, docKey, path: normalized });
  }
  return { named: [...named.values()], unresolved, unattributable: [...unattributable.values()], ignored };
}

// looksLikeArtifactPath(normalized) — the bound on the report above: does this path's
// own last segment (or its directory + segment) name something the MANIFEST would
// stream if it were attributable? `…/STORY.md` and `tasks/00_a.feature` do; `src/x.mjs`
// does not. Deliberately not a filesystem probe — the path may not exist as spelled,
// which is precisely the case being reported.
function looksLikeArtifactPath(normalized) {
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return false;
  const last = segments.at(-1);
  const parent = segments.length > 1 ? segments.at(-2) : null;
  return artifactForRelativePath(last) != null || (parent != null && artifactForRelativePath(`${parent}/${last}`) != null);
}

// selectChangedArtifacts(entries, sent) — the CONTENT-hash gate (ADR-007/AC8). An entry
// whose hash is unchanged since the last CONFIRMED send is not re-sent; everything else
// is. The map is updated by `recordSentArtifacts` only after the send, so an
// interruption re-sends (the safe side), and it is pruned of entries this read no longer
// sees so a deleted-then-recreated file is not mistaken for unchanged.
//
// Generic over `{ ref, doc | runId, hash }` because ADR-013/C10 gates RUN RECORDS with
// the same rule: three steady-state ticks used to send three frames of an unchanged run
// record, and with both gated a genuinely idle tick sends no content frame at all —
// which is the end state AC8 describes.
export function selectChangedArtifacts(entries, sent) {
  const changed = [];
  const seen = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = syncKey(entry);
    seen.add(key);
    if (sent.get(key) !== entry.hash) changed.push(entry);
  }
  for (const key of [...sent.keys()]) {
    if (!seen.has(key)) sent.delete(key);
  }
  return changed;
}

export function recordSentArtifacts(entries, sent) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry?.hash === "string") sent.set(syncKey(entry), entry.hash);
  }
}

function syncKey(entry) {
  return `${entry?.ref}::${entry?.doc ?? `run:${entry?.runId}`}`;
}

// hashRunRecords(runs) — the run half of the same gate (ADR-013/C10). The hash is over
// the SERIALIZED record, which is exactly the bytes the frame carries and the store
// writes, so "unchanged" means the same thing on both sides of the wire.
export function hashRunRecords(runs) {
  return (Array.isArray(runs) ? runs : []).map((run) => ({ ...run, hash: hashArtifactBody(JSON.stringify(run.record)) }));
}

// stripSyncHashes(entries) — the hash is the SENDER's bookkeeping. It rides the frame
// for the doc entries (ADR-007: "artifacts travel with a per-artifact content hash"),
// but a run record's frame shape is a pinned contract, so the key is dropped there
// rather than widening a shape 43/04 reads.
export function stripSyncHashes(entries) {
  return (Array.isArray(entries) ? entries : []).map(({ hash, ...rest }) => rest);
}

// missingNamedArtifacts(named, docs) — the artifacts the queue NAMED but the read
// could not produce: the agent deleted (or renamed away) a manifest artifact. Reported
// as a coded degrade rather than sent as an empty body — an empty body would overwrite
// the last good copy on the control with nothing, and never-evict (ADR-006) says the
// last streamed body keeps answering.
export function missingNamedArtifacts(named, docs) {
  const present = new Set((Array.isArray(docs) ? docs : []).map((doc) => `${doc.ref}::${doc.doc}`));
  return (Array.isArray(named) ? named : []).filter((entry) => !present.has(`${entry.ref}::${entry.docKey}`));
}

// ---------------------------------------------------------------- the tick seam --
//
// ADR-013/C7: `mesh-launcher.mjs` is 1,660 lines and 2-in/30-out — the widest out-degree
// in `src/` — and the first draft of this story inlined ~60 lines of ORCHESTRATION into
// `pushActiveWorktreeState` (four warning blocks, the hash-map lifecycle, the
// delivery-confirm sequencing). That is how `mesh-worker-execution.mjs` reached 3,187.
// The two functions below take the tick's inputs and hand back what to send and what to
// report, so the launcher holds a CALL SITE, not a block — which is also the shape
// 43/04 and 43/05 are required to add against.

// createArtifactSyncState() — per-daemon, in memory on purpose. A restart forgets, and
// forgetting means re-sending, which is the side of the choice that cannot lose an
// artifact.
export function createArtifactSyncState() {
  return { hashes: new Map(), reported: new Map() };
}

// prepareArtifactSyncBatch({ state, assignmentId, worktreePath, items, docs, runs }) —
// drain, resolve, gate by content hash, and produce the coded degrades. Returns
// `{ docs, runs, warnings }`; nothing here writes to the wire or discards the batch.
//
// DEGRADES ARE REPORTED ONCE PER BATCH, not once per tick (ADR-013 / QA F-5). Measured
// before the fix: one enqueued `unresolved-path` line produced TEN copies over ten ticks
// with the transport down, because an undelivered batch is re-drained every tick. That
// is the failure class this repo has already paid for once — the Mac's remote log ring
// held 259 copies of one code, drowning every other line. The signature set is cleared
// when the batch is confirmed away, so a genuinely new occurrence still reports, and a
// crash (which loses the set with the process) re-reports rather than swallows.
export async function prepareArtifactSyncBatch({ state, assignmentId, worktreePath, items = [], docs = [], runs = [] }) {
  const drained = await drainArtifactQueue(worktreePath);
  const resolved = resolveDrainedArtifacts(drained.entries, { items });
  const warnings = [];
  const reported = state.reported.get(assignmentId) ?? new Set();
  state.reported.set(assignmentId, reported);
  const reportOnce = (signature, warning) => {
    if (reported.has(signature)) return;
    reported.add(signature);
    warnings.push(warning);
  };

  for (const entry of resolved.unresolved) {
    reportOnce(`unresolved:${entry.tool}`, {
      code: "artifact-sync-unresolved-path",
      message: `artifact-sync: an enqueued ${entry.tool ?? "tool"} event carried no path (unresolved-path) — the reconciliation backstop still covers it`,
      path: worktreePath,
    });
  }
  for (const entry of resolved.unattributable) {
    reportOnce(`unattributable:${entry.path}`, {
      code: "artifact-sync-unattributable-path",
      message: `artifact-sync: "${entry.path}" names an artifact but could not be attributed to an item in this worktree (a relative or differently-cased spelling the hook carried verbatim) — it was not streamed`,
      path: entry.path,
    });
  }
  if (drained.torn > 0) {
    reportOnce(`torn:${drained.torn}`, {
      code: "artifact-sync-torn-line",
      message: `artifact-sync: ${drained.torn} torn queue line(s) could not be parsed and were skipped (unresolved-path handling unaffected)`,
      path: drained.batchPath,
    });
  }
  for (const missing of missingNamedArtifacts(resolved.named, docs)) {
    reportOnce(`missing:${missing.ref}::${missing.docKey}`, {
      code: "artifact-sync-artifact-missing",
      message: `artifact-sync: ${missing.ref} ${missing.docKey} was named by the queue but is no longer on disk — the last streamed body keeps answering (never overwritten with an empty one)`,
      path: missing.path,
    });
  }

  const sent = state.hashes.get(assignmentId) ?? new Map();
  state.hashes.set(assignmentId, sent);
  const changed = selectChangedArtifacts([...docs, ...hashRunRecords(runs)], sent);
  return {
    docs: changed.filter((entry) => entry.doc != null),
    runs: stripSyncHashes(changed.filter((entry) => entry.doc == null)),
    pending: changed,
    warnings,
  };
}

// confirmArtifactSyncBatch({ state, assignmentId, worktreePath, pending, delivered }) —
// the CONFIRMATION half. Until it runs, a crash costs a duplicate and never a loss; an
// UNDELIVERED batch is neither discarded nor recorded as sent, so it rides the next tick
// after the transport returns.
export async function confirmArtifactSyncBatch({ state, assignmentId, worktreePath, pending = [], delivered }) {
  if (!delivered) return { discarded: false };
  recordSentArtifacts(pending, state.hashes.get(assignmentId) ?? new Map());
  state.reported.get(assignmentId)?.clear();
  await discardArtifactBatch(worktreePath);
  return { discarded: true };
}

// forgetArtifactSyncAssignment(state, activeIds) — bound the two maps to the worktrees
// this daemon is currently streaming.
export function forgetArtifactSyncAssignment(state, activeIds) {
  for (const map of [state.hashes, state.reported]) {
    for (const key of [...map.keys()]) {
      if (!activeIds.has(key)) map.delete(key);
    }
  }
}

async function readTextIfPresent(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    // A queue destination that is a DIRECTORY (EISDIR) or otherwise unreadable is the
    // hook's degraded case seen from the other end: there is nothing to drain, and the
    // reconciliation backstop still converges. Never fatal to the tick.
    if (error?.code === "EISDIR" || error?.code === "EACCES" || error?.code === "EPERM") return null;
    throw error;
  }
}

async function renameIfPresent(from, to) {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    if (error?.code === "EISDIR" || error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY") return false;
    throw error;
  }
}

function endWithNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}
