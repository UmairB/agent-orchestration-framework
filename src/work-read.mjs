// src/work-read.mjs — THE CACHE-FIRST READ SEAM (milestone 43 / story 06, ADR-005).
//
// THE DISEASE, in the milestone's own recorded words (43/03's accept note, from a live
// two-node run): "`aof work list` on the control still answers from the control's own disk,
// so it did not show the worker-authored stories during the run." A worker builds an item
// in its own worktree, streams it into the cache, finishes and deletes the worktree — and
// the control node, which never held anything but the pre-run scaffold, goes on answering
// from that scaffold forever. Every control-side read command had the same disease because
// every one of them read the same disk.
//
// THE CURE, and its shape. This module exposes cache-first equivalents of `work.mjs`'s four
// disk readers — `listItems` / `findWork` / `nextWork` / `listStream` — each answering from
// the cache where the cache can answer, falling back to this node's disk where it cannot,
// and stamping EVERY returned row with which side answered it.
//
// THE DEPENDENCY DIRECTION IS FIXED AND IS THE WHOLE BOUNDARY: this module imports
// `work.mjs`; `work.mjs` NEVER imports this one. That is m41/ADR-001's rule reused verbatim
// and for the same reason — `src/work.mjs` is the 37-importer god-node, so a new capability
// lives BESIDE it, consuming its readers, never inside it. `acd-cache-read-surface-boundary`
// holds both halves, and it also holds the OTHER half of the boundary POSITIVELY: the
// worker-side reads and the structural (rename/insert/upgrade/doctor) reads must KEEP
// importing the disk readers. A worker that read the control's opinion of its own checkout
// would close a loop in which the mesh observes nothing; a rename that ran against a set
// that is not the set on disk would renumber folders that are not there.
//
// FOUR RULES THIS MODULE EXISTS TO KEEP, each of which a plausible implementation breaks:
//
//   1. CACHE-FIRST, NEVER CACHE-ONLY. A control node that has never published — a fresh
//      workspace, a torn store, a single-machine install that has no mesh at all — must
//      still answer. A read seam that could refuse to answer would be strictly worse than
//      the disk reader it replaces.
//   2. THE DEGRADE IS REPORTED, NOT SILENT. Falling back is a designed path, and it says so
//      on the durable degrade sink — once per coded class per read, never once per row (a
//      hot read loop must not turn the sink into the noise it exists to replace).
//   3. EVERY ROW SAYS WHICH SIDE ANSWERED IT. `answeredFrom` is "cache" or "disk" on every
//      row this module returns. A cache-answered row also carries `reportedBy` + `syncedAt`
//      (43/04's wire names, through 43/04's one mapper). A disk-answered row carries NEITHER
//      — an unobserved freshness is never fabricated, and "never cache-published" is a
//      different fact from "cache-published, author unknown" (which does carry both keys,
//      explicitly null).
//   4. NO PATH IS EVER FABRICATED. A cache-answered row for a ref this node does not hold
//      carries `dir: null` (ADR-010/R6.4). Every reader that reaches THROUGH a row into its
//      folder must therefore handle null — refuse coded at a WRITE door, skip-and-count at
//      an indexer, mark-and-report at a read door — and never guess a path.
//
// WHAT IT DOES NOT DO: it re-derives none of `work.mjs`'s rules. The query-match rule, the
// depth-first stream order and the whole `nextWork` candidacy walk stay in exactly one
// place; this module builds a merged VIEW in `work.mjs`'s own vocabulary and hands it back
// through the optional `view` seam. "Two definitions of what is next" would be the defect
// this milestone has already been burned by in four other shapes.
import { listItems, findWork, listStream, nextWork } from "./work.mjs";
// The node's read of the shared cache (rows + per-row provenance, already through
// cache-provenance.mjs's ONE storage→wire mapper). Null means the cache cannot answer at
// all, which is a different fact from an empty answer.
import { readCachedItemRows } from "./board-worker-stream.mjs";
// m42 item 3 — "errors are events, not silence". ADR-005's degrade is EXPLICIT, and this is
// the channel that makes it so; `reportDegrade` throttles per code, which is precisely rule 2.
import { reportDegrade } from "./degrade.mjs";
// THE OTHER SIDE OF THE BOUNDARY (see `isMeshWorktree` below). `isUnderMeshWorktreesRoot` is
// the ONE definition of "scoped to the dedicated worktrees root" (m35/ADR-004) and is reused
// rather than re-spelled — the module it comes from is a near-leaf (node builtins plus the
// degrade sink), so nothing heavy is dragged into a read.
import { isUnderMeshWorktreesRoot } from "./mesh-worktree.mjs";
import path from "node:path";

// The two coded degrade classes, named here so a reader of the sink meets one vocabulary.
// They are genuinely different operator situations:
//   · UNAVAILABLE — this node has no usable cache for this workspace at all (never
//     published, torn, no identity). EVERY row degraded; the mesh is not answering here.
//   · MISS — the cache is answering, but it holds no row for some of the refs in this read.
//     Ordinary on a healthy mesh (a local item nobody has published yet), and worth one
//     line rather than none, because a read that quietly half-degrades is how a stale answer
//     gets mistaken for an authoritative one.
export const DEGRADE_CACHE_UNAVAILABLE = "work-read-cache-unavailable";
export const DEGRADE_CACHE_MISS = "work-read-cache-miss";
// …and the third, which is not about the cache but about the REACH-THROUGH: a leaf that
// needs real files under a row's `dir` stepped over a row that has none. Reported rather
// than swallowed, because "this node indexed/swept fewer items than the stream contains" is
// a fact an operator can act on, and because several of these leaves return a frozen record
// shape with nowhere to carry it.
export const DEGRADE_NO_LOCAL_CHECKOUT = "work-read-no-local-checkout";

// How many refs a MISS line names before it summarises. The point of the line is to be
// actionable, not exhaustive — the row set itself is the exhaustive record.
const MISS_SAMPLE = 8;

// ------------------------------------------------------------ the boundary ----

// isMeshWorktree(projectRoot) — is THIS workspace a materialised mesh worktree?
//
// THE ECHO CHAMBER, CLOSED AT ITS ONE REMAINING DOOR (ADR-005's worker-side clause). The
// worker's EXECUTION reads go through `work.mjs` directly and are pinned there by
// `acd-cache-read-surface-boundary` — but a control-side COMMAND run inside a worktree
// (`aof work find`, `aof work list`) reaches this seam, and a per-assignment worktree reports
// under the SAME workspace id as the control. Without this check, `aof work find` inside a
// worker's own checkout answered with ANOTHER NODE'S OPINION of the work that checkout is
// currently authoring — precisely the closed loop the boundary exists to prevent, arriving
// through the command layer instead of the execution layer. MEASURED, not theorised: with the
// worktree's workspace id pinned as production pins it, the seam returned the cache's
// `in-progress` over the worktree's own freshly-authored `done`.
//
// The shape is the signal and it is a LOCAL one: a materialised worktree lives at
// `<origin>/.aof/mesh/worktrees/<assignmentId>` (m35/ADR-004, the ONE seam). Four levels up
// from the candidate is the origin root that root is built from, so the existing predicate
// answers the question without a second spelling of the path convention.
//
// A worktree therefore reads its OWN disk, always, and every row it returns says `disk`. That
// is not a degrade — nothing failed — so nothing is written to the degrade sink; the honest
// report is the per-row stamp itself.
//
// EXPORTED, and that is the ruling rather than a convenience (m43 / ADR-016/G4, MEASURED).
// This started as a module-private helper, which made "is this workspace a materialised mesh
// worktree?" a property of THIS READER instead of a fact about the workspace — so it closed
// the seam's door and left every OTHER cache-read door open. `src/commands/doctor.mjs` calls
// `readCachedWorkFacts` directly, and inside a worker's own worktree that produced
// `cache-status-divergence` on every item whose disk had moved past the last stream tick (the
// normal mid-phase state), plus a knock-on `started-story-no-tasks` off the overlaid status.
// The general rule this pays for: A GUARD THAT ANSWERS A QUESTION ABOUT THE WORKSPACE BELONGS
// WHERE EVERY CONSUMER OF THAT WORKSPACE CAN REACH IT. One home for the predicate; each door
// applies it where its own read happens.
export function isMeshWorktree(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return false;
  return isUnderMeshWorktreesRoot(path.resolve(projectRoot, "..", "..", "..", ".."), projectRoot);
}

// ------------------------------------------------------------------- the view ----

// cacheOnlyItem(row) — a `listItems`-shaped item for a ref the cache knows and this node's
// disk does not. `dir` and `name` are NULL, not invented: both are facts about a FOLDER,
// and there is no folder here (rule 4). Everything else is the cache's own row.
function cacheOnlyItem(row) {
  const parent = row.parent == null ? null : String(row.parent);
  return {
    number: String(row.ref).includes("/") ? String(row.ref).split("/")[1] : String(row.ref),
    type: row.type,
    slug: row.slug ?? "",
    name: null,
    dir: null,
    ref: row.ref,
    parent,
  };
}

// The facts a cache row overlays onto an item's own frontmatter. STATE only — never
// identity, never `depends`. Two reasons, both measured elsewhere in this milestone:
//   · identity (type/slug/parent/dir) belongs to the folder that is actually here, and
//     43/02's renumber regression is exactly what a cache row parked at an old ref looks
//     like — letting it re-name a local folder's item would propagate that fault into
//     every read instead of leaving it visible as a status disagreement;
//   · `depends` is a gate this node can read perfectly well from its own disk, and losing
//     it to a status overlay would make a migrated `next` stop honouring gates.
// This is `mergeWorkerItems`' rule ("the worker's status/title win; the row keeps its local
// dir"), applied one layer down so every reader inherits it rather than the board alone.
function stateOverlay(row) {
  const overlay = {};
  if (row.status !== undefined) overlay.status = row.status ?? null;
  if (row.title !== undefined) overlay.title = row.title ?? null;
  return overlay;
}

// buildStreamView(workspace, options) — the merge, and the one place it happens.
//
// Returns { view, answeredFrom, provenance }:
//   view        — `{ items, meta }` in work.mjs's own vocabulary (its optional `view` seam)
//   answeredFrom— Map<ref, "cache" | "disk">, the per-row fact rule 3 requires
//   provenance  — Map<ref, { reportedBy, syncedAt }> for the cache-answered refs
//
// The DEGRADE is reported HERE, once per read, because this is the one place that knows
// both what was asked for and what the cache could answer.
async function buildStreamView(workspace, options = {}) {
  const diskItems = await listItems(workspace.workDir);
  // THE BOUNDARY, checked before the cache is opened at all: a materialised worktree answers
  // from the checkout it is working in, whatever the mesh believes about it.
  const worktree = isMeshWorktree(workspace.projectRoot);
  const cache = worktree
    ? { rows: new Map(), provenance: new Map() }
    : await readCachedItemRows(workspace, {
      globalWorkStoreOptions: options.globalWorkStoreOptions ?? {},
      ...(options.openStore ? { openStore: options.openStore } : {}),
    });

  const rows = cache?.rows ?? new Map();
  const provenance = cache?.provenance ?? new Map();
  // "The cache cannot answer" covers BOTH the hard fault (null — unopenable, torn, no
  // workspace identity) and the workspace the cache simply holds nothing for. They are one
  // operator situation — every row on this read came off the local disk — and they are one
  // coded class, with the message carrying which of the two it was.
  const unavailable = cache == null || rows.size === 0;

  const items = [...diskItems];
  const answeredFrom = new Map();
  const meta = new Map();
  const missed = [];

  for (const item of diskItems) {
    const row = rows.get(item.ref);
    if (row == null) {
      answeredFrom.set(item.ref, "disk");
      missed.push(item.ref);
      continue;
    }
    answeredFrom.set(item.ref, "cache");
    meta.set(item.ref, stateOverlay(row));
  }
  for (const [ref, row] of rows) {
    if (answeredFrom.has(ref)) continue;
    items.push(cacheOnlyItem(row));
    answeredFrom.set(ref, "cache");
    meta.set(ref, stateOverlay(row));
  }

  // A worktree's disk-only answer is the boundary working, not a fallback from a failure —
  // labelling it a degrade would put correct behaviour in the sink that exists for faults.
  if (worktree) {
    // nothing to report; the per-row `answeredFrom: "disk"` is the honest statement
  } else if (unavailable) {
    reportDegrade(
      DEGRADE_CACHE_UNAVAILABLE,
      cache == null
        ? "the work cache could not be read on this node — every row answered from local disk"
        : "the work cache holds no rows for this workspace — every row answered from local disk",
    );
  } else if (missed.length > 0) {
    // ONE line for the whole read, naming the refs it degraded on (rule 2). The refs matter:
    // "some rows came off the disk" is not actionable, "43/06 and 43/07 came off the disk" is.
    const sample = missed.slice(0, MISS_SAMPLE).join(", ");
    reportDegrade(
      DEGRADE_CACHE_MISS,
      `the work cache holds no row for ${missed.length} ref(s) — answered from local disk: ${sample}${missed.length > MISS_SAMPLE ? ", …" : ""}`,
    );
  }

  return { view: { items, meta }, answeredFrom, provenance };
}

// stampRow(row, built) — rule 3, at ONE application point for every reader below. A
// cache-answered row gains `answeredFrom: "cache"` plus its provenance; a disk-answered row
// gains `answeredFrom: "disk"` and NOTHING else (no fabricated instant, no invented author).
function stampRow(row, { answeredFrom, provenance }) {
  if (row == null || typeof row.ref !== "string") return row;
  if (answeredFrom.get(row.ref) !== "cache") return { ...row, answeredFrom: "disk" };
  return { ...row, answeredFrom: "cache", ...(provenance.get(row.ref) ?? {}) };
}

const stampRows = (rows, built) => rows.map((row) => stampRow(row, built));

// ANSWERING_SIDE_KEYS — the complete set of keys rule 3 can add to a row, named ONCE, here,
// beside the stamp that adds them. Anything that has to REMOVE them (a frozen face, below)
// reuses this list rather than re-spelling it, so the strip and the stamp cannot drift apart.
export const ANSWERING_SIDE_KEYS = Object.freeze(["answeredFrom", "reportedBy", "syncedAt"]);

// withoutAnsweringSide(row) — the row as it was BEFORE rule 3 stamped it.
//
// THE ONE FACE THAT NEEDS THIS, and why it is a projection rather than an un-stamping
// (m43 / ADR-016/G1): milestone 03 / ADR-002 froze `aof work list --json`'s element at an
// EXACT seven-key set, and ADR-010/R4.1 has twice ruled that an enrichment on this route
// rides the FACE (the board's HTTP envelope), never the frozen CLI array. The decisive reason
// is measured and is about WIDTH: the stamp is not one key — a disk-answered row carries
// `answeredFrom` alone, a cache-answered row carries all three (`stampRow` above, by design)
// — so amending the frozen contract to admit it would make its key set depend on whether this
// machine has a mesh cache and whether that cache holds the row. A frozen contract whose width
// varies by deployment is not frozen. The command RESULT keeps the stamp; only that one `json`
// adapter strips it.
export function withoutAnsweringSide(row) {
  if (row == null || typeof row !== "object") return row;
  const out = { ...row };
  for (const key of ANSWERING_SIDE_KEYS) delete out[key];
  return out;
}

// reportedElsewhere(row, selfNodeId) — did ANOTHER node put this row's authoritative value in
// the cache? ONE home for the question (m43 / ADR-016/G10, ADR-015/F5: "the same fact asked
// twice must be answered from the same source"), because the answer decides whether a reader
// reaches for the cached body or for this node's own folder.
//
// All three clauses are load-bearing and each was a live branch before this collapsed:
// the row must be CACHE-answered (a disk answer is this node's own by construction), the
// author must be KNOWN (a cache-published row with no author is "cache-published, author
// unknown" — a different fact from a remote one, ADR-005 rule 3), and it must not be us.
//
// `work-doctor-coherence.mjs`'s predicate of the same name is a deliberate SECOND spelling
// over the doctor SNAPSHOT's shape (`statusFrom`, `snapshot.selfNode`) — it cites this one.
export function reportedElsewhere(row, selfNodeId) {
  return row?.answeredFrom === "cache"
    && typeof row.reportedBy === "string" && row.reportedBy.length > 0
    && row.reportedBy !== selfNodeId;
}

// --------------------------------------------------------------- the readers ----

// listItemsCacheFirst(workspace, options) — `listItems`' cache-first equivalent: the merged
// item set, each item stamped with the side that answered it. A cache-only item carries
// `dir: null` (rule 4), which every caller that reaches through a `dir` must handle.
export async function listItemsCacheFirst(workspace, options = {}) {
  const built = await buildStreamView(workspace, options);
  return stampRows(await listItems(workspace.workDir, { view: built.view }), built);
}

// findWorkCacheFirst(workspace, query, options) — `findWork`'s cache-first equivalent. The
// MATCH RULE is unchanged and un-copied: a bare number is the top-level item, `NN/SS` a
// story, anything else a slug/name substring — work.mjs's own, applied to the merged view.
export async function findWorkCacheFirst(workspace, query, options = {}) {
  const built = await buildStreamView(workspace, options);
  return stampRows(await findWork(workspace.workDir, query, { view: built.view }), built);
}

// listStreamCacheFirst(workspace, options) — `listStream`'s cache-first equivalent: the whole
// stream in the SAME depth-first preorder, with the worker-authored rows the control's disk
// has never seen taking their place under their milestone. This is the headline read.
export async function listStreamCacheFirst(workspace, options = {}) {
  const built = await buildStreamView(workspace, options);
  return stampRows(await listStream(workspace.workDir, { view: built.view }), built);
}

// nextWorkCacheFirst(workspace, scopeRef, options) — `nextWork`'s cache-first equivalent, and
// the one whose migration changes a DECISION rather than a display: a driver that is `done`
// only in the cache must unblock its dependents, or the operator is told to wait on work
// that is finished. The candidacy walk, the depends gate and the whole lease/routing guard
// are work.mjs's, unchanged; only the STATUS each step reads is now cache-authoritative.
//
// `candidacyView` passes straight through — it is the m26/ADR-005 seam this one is modelled
// on, and the two compose rather than compete.
export async function nextWorkCacheFirst(workspace, scopeRef, options = {}) {
  const built = await buildStreamView(workspace, options);
  const result = await nextWork(workspace.workDir, scopeRef, {
    ...(options.candidacyView ? { candidacyView: options.candidacyView } : {}),
    view: built.view,
  });
  // `{ state: "done" }` carries no ref and gains no stamp — there is no row to attribute.
  return typeof result?.ref === "string" ? stampRow(result, built) : result;
}

// localItemsOnly(rows) — the reach-through filter, shared by every leaf that needs REAL
// FILES under a row's `dir` (ADR-010/R6.4: `memory/local-indexing` and `notion/sync-work`
// "SKIP non-local rows and report the skip count"). Returns `{ items, skipped }` so the
// caller reports the skip rather than swallowing it: an indexer that silently indexed an
// empty body as though it were the item would be a worse lie than the one this story cures.
export function localItemsOnly(rows) {
  const items = [];
  const skipped = [];
  for (const row of rows) {
    if (typeof row?.dir === "string" && row.dir.length > 0) items.push(row);
    else skipped.push(row?.ref ?? null);
  }
  return { items, skipped };
}

// reportReachThroughSkips(surface, skipped) — the companion REPORT for the filter above,
// kept separate so the filter itself stays pure and testable. One coded line naming the
// surface and the refs it stepped over; silent when nothing was skipped, so an ordinary
// single-node read adds nothing to the sink.
export function reportReachThroughSkips(surface, skipped = []) {
  if (!Array.isArray(skipped) || skipped.length === 0) return;
  const sample = skipped.slice(0, MISS_SAMPLE).filter((ref) => ref != null).join(", ");
  reportDegrade(
    DEGRADE_NO_LOCAL_CHECKOUT,
    `${surface} skipped ${skipped.length} cache-known ref(s) with no local checkout: ${sample}${skipped.length > MISS_SAMPLE ? ", …" : ""}`,
  );
}
