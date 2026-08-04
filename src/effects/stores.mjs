// src/effects/stores.mjs — the STORE CLASSIFICATION (m42 wave (d) leg d5;
// PRD-command-spine-effects-ledger "fact-projection-split"). The epistemology
// made explicit and EXECUTABLE: every table in the shared per-node SQLite (and
// every file store the ledger touches) is declared FACT, PROJECTION, or META —
// replacing the "MUST NEVER touch" warning comments that used to be the only
// thing standing between the wholesale row publisher and a dispatch fact.
//
//   fact        — authored or observed state whose truth lives HERE (or arrived
//                 here as a durable report). Losing it loses truth: no local
//                 rebuild reconstructs it. Written ONLY by its declared writer
//                 module(s), one row at a time — never wholesale.
//   projection  — derived from facts that live elsewhere (this workspace's disk,
//                 a descriptor file, a peer's publish). Safe to delete + rebuild;
//                 healing one is a re-publish/reconcile, never a patch (the port-3
//                 rule). `work_items` was the example here until m43/ADR-004 made it
//                 a FACT: it is neither remapped nor rebuilt now — a renumber is
//                 RE-REPORTED, row by row, by the node that authored each row.
//   meta        — the store's own bookkeeping (schema versions, watermarks,
//                 event-dedup stamps). Neither truth nor derivation.
//
// This registry is DATA ONLY (no imports from the stores it classifies — it is
// imported BY them, and by the gates/doctor that render it). Consumers:
//   - global-work-store.mjs: wholesale deletes are guarded by class (a DELETE
//     that sweeps a fact table throws before it runs), and the insert/reindex
//     ref-remap derives its table lists — split by locus — from here.
//   - test/arch/acd-fact-projection-split: totality (every CREATE TABLE in src/
//     is classified, every classified table exists — a two-way ratchet), the
//     writer isolation per fact table, and the wholesale-delete guard.
//   - work:doctor --explain: renders a store's class beside its cascade.

// The shared per-node SQLite (projection.sqlite — one file, BOTH classes, which
// is exactly why the split must be schema-level and not a comment). `writers`
// names the module(s) whose SQL may INSERT/UPDATE/DELETE rows of a fact table
// (repo-relative). `refRemap` marks the ref-keyed tables an insert/reindex must
// follow, with the LOCUS whose drain may rewrite them: the streamed mirrors are
// this node's own rows (`local`); the dispatch facts belong to the authoritative
// mesh store's writer (`control-store`) — the split port 3 deferred to this leg.
export const TABLE_CLASSIFICATION = Object.freeze({
  aof_schema: Object.freeze({ class: "meta" }),
  projection_metadata: Object.freeze({ class: "meta" }),

  workspaces: Object.freeze({ class: "projection", rebuiltBy: "publishWorkspaceSnapshot" }),
  // m43 / ADR-004 — THE AUTHORITY CUT. `work_items` was a projection "rebuilt by
  // publishWorkspaceSnapshot": every publish tick wholesale-DELETEd the workspace's
  // rows and re-INSERTed the CALLING node's own disk slice. That is only sound while
  // one node authors every row; it is not, and has not been since a worker started
  // streaming its worktree. The measured consequence: after a worker settled and
  // stopped ticking, the control's stale disk republished over live truth forever.
  //
  // It is now a FACT: rows arrive here as durable REPORTS from whichever node
  // authored them (`node_id`, schema v8), are written ONE ROW AT A TIME through the
  // single upsert seam below, and are removed only by their own author's retraction
  // or by the explicitly named workspace-removal path. No local rebuild reconstructs
  // another node's report — which is the definition of a fact in this registry.
  //
  // THE RECLASSIFICATION IS THE ENFORCEMENT: `wholesaleDelete` throws before it runs
  // for any table not classified "projection", so the delete-and-rebuild cannot come
  // back even by accident (`acd-work-items-single-writer` arms on this line).
  work_items: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/global-work-store.mjs"]),
  }),
  projection_errors: Object.freeze({ class: "projection", rebuiltBy: "publishWorkspaceSnapshot" }),
  global_nodes: Object.freeze({ class: "projection", rebuiltBy: "node descriptor publish" }),
  global_workspace_descriptors: Object.freeze({ class: "projection", rebuiltBy: "workspace descriptor publish" }),
  global_node_workspaces: Object.freeze({ class: "projection", rebuiltBy: "membership publish" }),

  global_assignments: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/assignment-record.mjs", "src/global-work-store.mjs"]),
    refRemap: Object.freeze({ column: "item_ref", locus: "control-store" }),
  }),
  global_assignment_directives: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/mesh-assignment-directive.mjs"]),
  }),
  global_item_branches: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/mesh-assignment-directive.mjs", "src/global-work-store.mjs"]),
    refRemap: Object.freeze({ column: "item_ref", locus: "control-store" }),
  }),
  global_recovery_pushes: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/mesh-recovery-push.mjs"]),
  }),
  // m43 / story 04 (ADR-010/R4.2) — the RESYNC request row, the recovery-push table's exact
  // sibling and classified the same way for the same reason: it is OPERATOR-CREATED state
  // (someone clicked Resync / ran `aof work resync`), never a projection of any doc, so no
  // publish tick may ever sweep it. Lazily created by its own module, which is why it needs
  // no schema bump — but it is still a real table this repo creates, so it is classified
  // here, where the two-way ratchet can see it.
  global_resync_requests: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/mesh-resync.mjs"]),
  }),
  // The worker-STREAMED mirrors (schema v5/v6): facts that ARRIVED here durably —
  // a peer's worktree truth surviving that worktree's cleanup, a worker's log
  // events. No local rebuild reconstructs them (the "MUST NEVER touch" comments
  // this registry supersedes), so they are facts of this store even though their
  // origin is remote. Their ref-remap is this node's own row rewrite (`local`).
  work_item_docs: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/global-work-store.mjs"]),
    refRemap: Object.freeze({ column: "ref", locus: "local" }),
  }),
  work_item_runs: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/global-work-store.mjs"]),
    refRemap: Object.freeze({ column: "ref", locus: "local" }),
  }),
  node_logs: Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/global-work-store.mjs"]),
  }),

  // The effects journal (journal.sqlite, beside the projection): the ledger
  // itself. Its rows ARE facts (past-tense events + the steps they owe).
  events: Object.freeze({ class: "fact", writers: Object.freeze(["src/effects/journal.mjs"]) }),
  effect_steps: Object.freeze({ class: "fact", writers: Object.freeze(["src/effects/journal.mjs"]) }),
});

// The FILE stores the ledger's seams write (declared for the same reason — the
// classification is total over the stores the cascade arc touches, not only the
// SQLite tables). `reconcile` names how a fact-without-its-event heals: the
// write-then-append crash window is real for every file store (run-transitions'
// documented discipline), and the run store is the one with a unique join key
// (runId) that makes re-deriving the missing event honest — effects/reconcile.mjs
// (this leg). Record-doc bullets carry no unique key, so their missed event is
// acknowledged as unreconcilable (the cost is one missed publish, healed by the
// next); the reindex remap's window is acknowledged in port 3 (the old refs
// exist nowhere post-rename).
export const FILE_STORE_CLASSIFICATION = Object.freeze({
  "run-records": Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/run-store.mjs"]),
    reconcile: "effects/reconcile.mjs (reconcileRunRecords — d5)",
  }),
  "record-docs": Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/work.mjs", "src/effects/doc-transitions.mjs"]),
    reconcile: null,
  }),
  "notion-sidecar": Object.freeze({
    class: "fact",
    writers: Object.freeze(["src/notion/mapping.mjs"]),
    reconcile: null,
  }),
});

export function tableClass(table) {
  return TABLE_CLASSIFICATION[table]?.class ?? null;
}

// The ref-keyed tables at one locus — the derivation global-work-store's two
// remap halves read, so the split lives HERE and nowhere re-spells it.
export function refRemapTables(locus) {
  return Object.entries(TABLE_CLASSIFICATION)
    .filter(([, entry]) => entry.refRemap?.locus === locus)
    .map(([table, entry]) => ({ table, column: entry.refRemap.column }));
}
