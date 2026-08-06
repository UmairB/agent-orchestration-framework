// src/board-worker-stream.mjs — the board's view of a mesh item AS THE WORKER SEES IT
// (VERIFICATION, live two-machine soak 2026-07-25).
//
// THE DEFECT: the board lists the CONTROL node's own checkout, so an item a worker is
// building on another machine showed its pre-run scaffold — "not started · 0 stories" over
// a milestone the agent had already broken into seven stories.
//
// WHERE THE TRUTH COMES FROM — the WORKER, over the fabric, and nothing else. The worker
// streams the work-state of the WORKTREE it is actually working in (mesh-launcher's
// pushActiveWorktreeState → sendDelta → control's applyDeltaFrame → the global
// projection's work_items), continuously, while it works. This module reads THAT.
//
// EXPLICITLY NOT THE GIT BRANCH. A branch only exists once a run has committed and pushed,
// so branch-reading cannot show work in flight and makes committing a precondition for
// visibility — the board would still be blind for the entire duration of a run, which is
// exactly the window an operator is watching. The worker is the authority on its own work;
// the projection is how that authority reaches this node.
import {
  openGlobalWorkProjectionStore,
  readWorkspaceItems,
  readWorkspaceItemProvenance,
  readWorkItemDoc,
  readWorkItemDocMembers,
  readWorkItemRuns,
} from "./global-work-store.mjs";
// m43 / story 04 (ADR-006) — the ONE storage→wire mapping (`node_id`/`updated_at` →
// `reportedBy`/`syncedAt`), applied IDENTICALLY to the rows below and to every artifact
// beside them. Nothing in this module spells either wire name by hand.
import { toWireProvenance } from "./cache-provenance.mjs";
// m43 / ADR-007 — the manifest's own member spelling, so the TASKS read below asks for
// exactly the keys the worker streamed.
import { artifactDocKeyMember, canonicalArtifactDocKey } from "./work-artifacts.mjs";
import { resolveWorkspaceId } from "./workspace-identity.mjs";
import { globalMeshPaths } from "./workspace.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

// resolveStreamWorkspaceId(workspace, options) — the ONE id derivation all three
// readers in this module share (the same precedence readWorkerItems always used):
// an explicit option, else the workspace's pinned mesh id, else the path-derived id.
function resolveStreamWorkspaceId(workspace, options = {}) {
  // m42 item 4: the ONE precedence (workspace-identity.mjs) — no local fallback.
  return resolveWorkspaceId(workspace, { override: options.workspaceId });
}

// withProjectionStore(workspace, options, read) — open the projection, hand
// (store, workspaceId) to `read`, always close. Any fault → null: the board's
// worker-view reads DEGRADE to "no worker view" (the local-first default), exactly
// like readWorkerItems' empty-map contract below.
async function withProjectionStore(workspace, options, read) {
  const storeOptions = options.globalWorkStoreOptions ?? {};
  const openStore = options.openStore ?? openGlobalWorkProjectionStore;
  let store = null;
  try {
    const workspaceId = resolveStreamWorkspaceId(workspace, options);
    if (workspaceId == null) return null;
    store = await openStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
    return await read(store, workspaceId);
  } catch {
    return null;
  } finally {
    try { store?.close?.(); } catch (error) { /* already closed */
      reportDegrade("board-worker-stream", error); }
  }
}

// sharedProjectionStore(options) — ONE store open shared by a BATCH of the reads above,
// for a caller that makes several of them back to back.
//
// WHY IT EXISTS, and it is a measurement rather than a tidy-up (m43 / ADR-016/G7). Every
// reader in this file opens the projection through `withProjectionStore` and closes it again,
// which is right for a single read and wrong for a loop: the launcher's presence tick calls
// `listItemsCacheFirst` per workspace and `readCachedActiveRunIds` per workspace, so the tick
// cost went from one disk scan to 2N SQLite opens. Measured on the daemon's hot loop, with a
// ONE-workspace, EMPTY-store fixture, that alone pushed the presence refresh from ~13ms to
// ~22ms and turned `mesh-coordination-launcher/03` red against its 25ms budget. THE STORE IS
// ONE FILE FOR EVERY WORKSPACE (`withProjectionStore` keys on `globalMeshPaths(options)`), so
// a batch that opens it more than once is paying N times for the same handle.
//
// The handle handed to each read has a NO-OP `close()` — the BATCH owns the lifetime, and
// `withProjectionStore`'s always-close `finally` must not tear down a store its siblings are
// still using. The open is LAZY (a tick that resolves no workspace opens nothing) and
// memoised on the PROMISE, so a failed open is a single failure the whole batch degrades
// through rather than N retries; each read then sees `withProjectionStore`'s ordinary
// degrade-to-null, exactly as it would have on its own.
//
// This is TECH_DEBT item 12's ratchet paying out: the right answer was to reuse this file's
// one opener rather than add a twentieth, and reuse is what made the batch visible.
export function sharedProjectionStore(options = {}) {
  const baseOpen = typeof options.openStore === "function" ? options.openStore : openGlobalWorkProjectionStore;
  let real = null;
  let opening = null;
  const openStore = (storeOptions) => {
    if (opening == null) {
      opening = (async () => {
        const store = await baseOpen(storeOptions);
        real = store;
        return { ...store, close() { /* the batch closes it, once */ } };
      })();
      // A rejection is delivered to every awaiting read (each catches it into its own null);
      // this keeps it from ALSO surfacing as an unhandled rejection when no read follows.
      opening.catch(() => {});
    }
    return opening;
  };
  return {
    openStore,
    close() {
      try { real?.close?.(); } catch (error) { reportDegrade("board-worker-stream", error); }
      real = null;
      opening = null;
    },
  };
}

// readStreamedItemRow(workspace, ref, options) — THE streamed-existence rule (the
// m42 rethink, operator-forced after the third read command shipped with the same
// disease): for a streamed item the LOCAL filesystem is not the truth for ANY
// read. An item EXISTS when the worker's stream says so; every read command that
// misses locally asks THIS before 404ing, and answers absent data as EMPTY for an
// item the board is actively showing — "Could not load X" for a listed item is a
// lie about existence, not a missing file.
export async function readStreamedItemRow(workspace, ref, options = {}) {
  return withProjectionStore(workspace, options, (store, workspaceId) => {
    const row = store.db.prepare(
      "SELECT ref, type, slug, status, title, parent FROM work_items WHERE workspace_id = ? AND ref = ?"
    ).get(workspaceId, ref);
    return row ?? null;
  });
}

// readWorkerDoc(workspace, ref, doc, options) — the drill-down sibling of
// readWorkerItems (schema v5, TECH_DEBT item 6): a record-doc BODY as the worker
// streamed it, for a ref the local checkout cannot resolve (the streamed story) or a
// doc it does not hold. Null when nothing was streamed — the caller keeps its local
// behaviour.
export async function readWorkerDoc(workspace, ref, doc, options = {}) {
  return withProjectionStore(workspace, options, (store, workspaceId) => {
    const row = readWorkItemDoc(store, workspaceId, ref, doc);
    // m43 / story 04 — the artifact's OWN provenance, through the SAME mapper the rows go
    // through: `reportedBy` + `syncedAt`, never a second spelling. The `updatedAt` this
    // used to emit was the STORAGE name on a WIRE face — two names for one fact, which is
    // exactly what ADR-006's one-mapper rule exists to stop.
    return row == null ? null : { ref, doc: row.doc, body: row.body, ...toWireProvenance(row) };
  });
}

// readWorkerDocMembers(workspace, ref, name, options) — the DIR-kind sibling of
// readWorkerDoc (m43 / ADR-007): every member of one manifest entry (`TASKS`) that the
// worker streamed for a ref, so `work:tasks` can answer on the control node from the
// worker's own worktree — closing `commands/tasks.mjs:15`'s "the features live in the
// worker's worktree and are not streamed yet". Null when nothing was streamed, so the
// caller keeps its local behaviour.
export async function readWorkerDocMembers(workspace, ref, name, options = {}) {
  return withProjectionStore(workspace, options, (store, workspaceId) => {
    const rows = readWorkItemDocMembers(store, workspaceId, ref, name);
    if (rows.length === 0) return null;
    return {
      ref,
      members: rows.map((row) => ({
        member: artifactDocKeyMember(row.doc),
        body: row.body,
        // Each member is its own ARTIFACT and carries its own provenance — one member may
        // legitimately be older than its siblings.
        ...toWireProvenance(row),
      })),
      // The entry-level attribution answers "whose view is this SET" — the first member
      // that names a node. Deliberately NO set-level `syncedAt`: a set has no single
      // instant, and the members' own instants (above) are the precise fact. Asserting one
      // would be the same fabrication the mapper refuses at the other end.
      reportedBy: toWireProvenance(rows.find((row) => row.nodeId != null) ?? {}).reportedBy,
    };
  });
}

// readWorkerRuns(workspace, ref, options) — the RUNS-tab sibling: the run records
// the worker streamed for a ref whose local runs/ dir is absent or empty. Null when
// nothing was streamed.
export async function readWorkerRuns(workspace, ref, options = {}) {
  return withProjectionStore(workspace, options, (store, workspaceId) => {
    const rows = readWorkItemRuns(store, workspaceId, ref);
    if (rows.length === 0) return null;
    return {
      ref,
      runs: rows.map((row) => row.record),
      // Same rule as the doc-member set: attribution for the set, no fabricated set-level
      // instant. Each run record carries its own timestamps inside itself.
      reportedBy: toWireProvenance(rows.find((row) => row.nodeId != null) ?? {}).reportedBy,
    };
  });
}

// readWorkerItems(workspace, options) → Map<ref, row> — the worker-reported rows for this
// workspace, narrowed to the mesh items the caller cares about (`refs` — the items with an
// execution record) and their children. Returns an EMPTY map on any fault, which the merge
// below treats as "no worker view", leaving the local rows untouched.
export async function readWorkerItems(workspace, options = {}) {
  const refs = Array.isArray(options.refs) ? options.refs.filter((r) => typeof r === "string" && r.length > 0) : [];
  if (refs.length === 0) return new Map();

  const result = await withProjectionStore(workspace, options, (store, workspaceId) => {
    // The milestone numbers the caller asked about — a worker's rows for an item include
    // that item AND the stories beneath it (the breakdown is the thing the local checkout
    // is missing), so children are matched by parent.
    const out = new Map();
    const wanted = new Set(refs);
    const milestones = new Set(refs.map((ref) => String(ref).split("/")[0]));
    for (const row of readWorkspaceItems(store, workspaceId)) {
      if (wanted.has(row.ref) || milestones.has(row.ref) || (row.parent != null && milestones.has(String(row.parent)))) {
        out.set(row.ref, row);
      }
    }
    return out;
  });
  return result ?? new Map();
}

// readCachedProvenance(workspace, options) → Map<ref, { reportedBy, syncedAt }> — every
// row the CACHE holds for this workspace, mapped to the wire names (m43 / story 04,
// ADR-006). Empty map on any fault, which is the same "no cache view" degrade every other
// reader here takes.
//
// DELIBERATELY UNNARROWED, unlike readWorkerItems below. That reader is scoped to the items
// with an execution record because it REPLACES row content and must not let a stale cache
// speak for an item nobody is working on. Provenance is the opposite kind of fact: it never
// changes what a row says, only who said it and when — and DESIGN requires it on EVERY
// cache-published item, "not only executing ones", with the control's own rows reading as
// this node's. A narrowed provenance read would attribute exactly the rows a worker is
// touching and leave the operator inferring the rest, which is the state this story exists
// to end.
export async function readCachedProvenance(workspace, options = {}) {
  const result = await withProjectionStore(workspace, options, (store, workspaceId) =>
    new Map([...readWorkspaceItemProvenance(store, workspaceId)].map(([ref, record]) => [ref, toWireProvenance(record)])));
  return result ?? new Map();
}

// readCachedWorkFacts(workspace, { docNames }, options) → { rows, provenance, docs } | null —
// the cache's answer to the THREE facts `work:doctor`'s snapshot overlays per-item
// (m43 / story 06, ADR-005 + ADR-010/R6.1): what each item's STATUS is, which CONVENTION
// DOCS exist for it, and — derivable from the rows' own `parent` — which CHILDREN it has.
//
// ONE store open for the whole snapshot, deliberately: doctor's contract is that it builds
// its snapshot ONCE and hands pure data to pure groups, so a per-item or per-doc cache read
// would reintroduce exactly the per-group source-splitting ADR-005 rejected.
//
// `docs` is Map<ref, Map<docName, { present, nonEmpty }>> in the SAME shape the disk probe
// produces, so the overlay is a substitution rather than a translation. Non-emptiness is
// measured the same way too (non-whitespace content), because `missing-verification` keys on
// an empty stub being a missing deliverable.
export async function readCachedWorkFacts(workspace, { docNames = [] } = {}, options = {}) {
  const names = docNames.filter((name) => typeof name === "string" && name.length > 0);
  return withProjectionStore(workspace, options, (store, workspaceId) => {
    const docs = new Map();
    for (const name of names) {
      const key = canonicalArtifactDocKey(name.replace(/\.md$/i, ""));
      for (const row of store.db.prepare(
        "SELECT ref, body FROM work_item_docs WHERE workspace_id = ? AND doc = ?"
      ).all(workspaceId, key)) {
        if (!docs.has(row.ref)) docs.set(row.ref, new Map());
        docs.get(row.ref).set(name, {
          present: true,
          nonEmpty: typeof row.body === "string" && row.body.trim().length > 0,
        });
      }
    }
    return {
      rows: new Map(readWorkspaceItems(store, workspaceId).map((row) => [row.ref, row])),
      provenance: new Map([...readWorkspaceItemProvenance(store, workspaceId)]
        .map(([ref, record]) => [ref, toWireProvenance(record)])),
      docs,
    };
  });
}

// readCachedActiveRunIds(workspace, refs, options) → string[] — the RUNNING run ids the
// cache holds for the given refs, in one store open rather than one per ref.
//
// WHY IT IS NOT A FABRICATION (m43 / story 06). `readActiveRuns` (mesh-presence.mjs) already
// counts EVERY running run record it finds under an item's `runs/` dir, including records
// authored by other nodes that reached this checkout — the union has always been "the
// running runs visible from here", never "the runs this node owns". A run record that
// reached this node through the CACHE instead of through a checkout is the same fact by a
// different transport, and omitting it is what made the control's activeRuns go blind on
// exactly the items a worker was executing. Bounded to the refs the caller asks about, so a
// leaf that has already filtered its rows cannot widen the union by accident.
export async function readCachedActiveRunIds(workspace, refs = [], options = {}) {
  const wanted = (Array.isArray(refs) ? refs : []).filter((ref) => typeof ref === "string" && ref.length > 0);
  if (wanted.length === 0) return [];
  const result = await withProjectionStore(workspace, options, (store, workspaceId) => {
    const ids = [];
    for (const ref of wanted) {
      for (const row of readWorkItemRuns(store, workspaceId, ref)) {
        if (row?.record?.state === "running" && typeof row.record.runId === "string") ids.push(row.record.runId);
      }
    }
    return ids;
  });
  return result ?? [];
}

// readCachedItemRows(workspace, options) → { rows, provenance } | null — the WHOLE of what
// the cache holds for this workspace: every row it has, plus who reported each and when.
// Null on ANY fault (an unopenable or torn store, a workspace with no resolvable identity),
// which the caller reads as "the cache cannot answer" — distinct from an EMPTY map, which
// is the equally real "the cache is present and holds nothing for this workspace".
//
// This is the read `src/work-read.mjs` (m43 / ADR-005, the cache-first seam) is built on,
// and it lives HERE rather than in a module of its own for one measured reason: this file
// is already one of the store's openers, and TECH_DEBT item 12's count crossed its own
// stated ratchet threshold at 43/04 (17 → 19, ADR-014/E7). A twentieth opener to re-spell
// `withProjectionStore` — the degrade-to-null discipline, the id precedence and the
// always-close `finally` — would be a second way to do the thing this file already does
// four times. The file's HEADER subject widens with it: it is the node's read of the
// shared cache, of which "as the worker sees it" was the first instance.
export async function readCachedItemRows(workspace, options = {}) {
  return withProjectionStore(workspace, options, (store, workspaceId) => ({
    rows: new Map(readWorkspaceItems(store, workspaceId).map((row) => [row.ref, row])),
    // Through the ONE mapper, exactly as readCachedProvenance below — a wire name is never
    // spelled from a storage name outside cache-provenance.mjs (ADR-014/E4).
    provenance: new Map([...readWorkspaceItemProvenance(store, workspaceId)]
      .map(([ref, record]) => [ref, toWireProvenance(record)])),
  }));
}

// applyCachedProvenance(rows, provenance) → rows — stamp each row the cache knows about
// with `reportedBy` + `syncedAt`. THE one application point for rows, so "who reported this"
// has a single source no matter how the row reached the response — a local row the cache
// also holds, a row MERGED from a worker's view, or a child row the merge INSERTED. That
// last pair is the measured gap this closes: attribution used to be set only on inserted
// children and derived from the ASSIGNMENT overlay (whose target node answers a different
// question), so the row the operator is actually looking at was the one least likely to say
// who reported it.
//
// A row the cache does not hold is left BYTE-IDENTICAL — no keys added. That is honest: it
// was never cache-published, which is a different fact from "cache-published, author
// unknown" (which does carry both keys, explicitly null).
export function applyCachedProvenance(rows, provenance) {
  if (!(provenance instanceof Map) || provenance.size === 0) return rows;
  return rows.map((row) => {
    const stamp = provenance.get(row.ref);
    return stamp == null ? row : { ...row, ...stamp };
  });
}

// mergeWorkerItems(rows, workerRows) → rows — replaces a local row with the worker's own row
// where one exists, and INSERTS the worker's extra children (the stories this checkout has
// never seen) directly after their milestone, so the board renders the breakdown the worker
// actually produced. Rows the worker says nothing about are untouched, which is the
// local-first default for every non-mesh item and every non-mesh workspace.
//
// It takes NO overlay (m43 / story 04, ADR-014/E4). It used to, for one purpose: stamping an
// inserted child's `reportedBy` from the assignment's target node. With attribution moved to
// its one application point, the merge has no business knowing what is assigned where — and
// a seam that cannot reach the assignment overlay cannot reintroduce the confusion between
// "assigned to" and "reported by" in a single line.
export function mergeWorkerItems(rows, workerRows) {
  if (!(workerRows instanceof Map) || workerRows.size === 0) return rows;
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const worker = workerRows.get(row.ref);
    if (worker == null) {
      out.push(row);
      continue;
    }
    seen.add(row.ref);
    // The worker's status/title win; the row keeps its local `dir` (the board resolves
    // docs against it) and whatever execution facts the overlay attached.
    out.push({ ...row, status: worker.status ?? row.status, title: worker.title ?? row.title, fromWorker: true });

    // …then any children the worker reports that this checkout does not have at all.
    const children = [...workerRows.values()]
      .filter((candidate) => candidate.parent != null && String(candidate.parent) === row.ref && !workerRows.has(`__seen_${candidate.ref}`))
      .filter((candidate) => !rows.some((local) => local.ref === candidate.ref))
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
    for (const child of children) {
      if (seen.has(child.ref)) continue;
      seen.add(child.ref);
      out.push({
        ref: child.ref,
        type: child.type ?? "story",
        slug: child.slug,
        status: child.status ?? null,
        title: child.title ?? null,
        parent: child.parent ?? row.ref,
        dir: child.sourcePath ? String(child.sourcePath).replaceAll("\\", "/").replace(/\/[^/]+$/, "") : row.dir,
        fromWorker: true,
        // NO `reportedBy` here, deliberately (m43 / story 04, ADR-014/E4). The merge used to
        // stamp one from the ASSIGNMENT overlay's target node — "which node was this item
        // ASSIGNED to" wearing the wire key that means "which node REPORTED this row". Two
        // different facts under one key, correct only because applyCachedProvenance
        // overwrote it a moment later. Attribution has ONE application point and it is that
        // stamp, so a child row the cache does not hold now says nothing about its author
        // rather than saying something plausible and wrong.
      });
    }
  }
  return out;
}
