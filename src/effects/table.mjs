// src/effects/table.mjs — THE effects ledger (m42 wave (d) leg d2; PRD-command-spine-
// effects-ledger). One executable table owning every consequence and its
// topology: EFFECTS maps each domain event to its reactors, each tagged with the
// LOCUS of the one store it mutates. This file is the executable replacement for
// the prose coupling registry ("the scan ORCHESTRATES, work.mjs WRITES", "MUST
// NEVER touch", …): adding a consequence is one line HERE, never a re-remembered
// call-site copy. Rule three of TECH_DEBT item 0: one home per fact, one door
// per act, ONE LEDGER PER CONSEQUENCE.
//
// Reactor contract (dispatch enforces the discipline, this file declares it):
//   - `apply(event)` where event = { eventId, name, payload } — the payload is
//     the event's own evidence (never an empty ping that forces a racing
//     re-read); a reactor rebuilds everything it needs from it.
//   - IDEMPOTENT or event-id-deduped: delivery is at-least-once by design
//     (crash between write and drain, redelivery over the bridge in d3).
//   - Mutates exactly ONE store — the one its locus names.
//   - OPTIONAL `applies(payload, ctx)` — the APPLICABILITY PREDICATE (m42 wave
//     (d) leg d4, port 4): a consequence that can NEVER apply to this event's
//     workspace is not owed at all. Evaluated ONCE, by the transition seam at
//     append time (applicableReactors below) — never by the drain, because a
//     step that reached the journal IS owed and stays owed until terminal.
//     Absent ⇒ always applicable. Without this, a locus no process drains
//     (integration:* in a workspace with no such integration configured) would
//     accumulate pending steps owed to nobody, forever.
//
// Loci (where the mutated store's one writer can run):
//   checkout            — the repo folder holding the item (frontmatter, runs/)
//   control-store       — the authoritative mesh SQLite (d3 wires its reactors)
//   local               — this node's own projection/logs
//   integration:<name>  — an external system + credentials (d4 wires Notion)
import { loadWorkspace, rollbackItemStatus, listItems } from "../work.mjs";
import { publishGlobalWorkSnapshot } from "../global-work-publisher.mjs";
import { openGlobalWorkProjectionStore, remapWorkspaceRefs, workspaceIdFor } from "../global-work-store.mjs";
import { setItemBranch } from "../mesh-assignment-directive.mjs";
import { rewriteRunItemRef } from "../run-store.mjs";
import { remapMappingRefs } from "../notion/mapping.mjs";
import { syncMilestoneWork } from "../notion/sync-work.mjs";
import { resolveWorkspaceId } from "../workspace-identity.mjs";
import { reportDegrade } from "../degrade.mjs";

export const KNOWN_LOCI = Object.freeze(["checkout", "control-store", "local"]);

export function isKnownLocus(locus) {
  return KNOWN_LOCI.includes(locus) || String(locus).startsWith("integration:");
}

// ---------------------------------------------------------------- reactors --

// run.completed / rollback-status — 20/ADR-005 made declarative: a run completed
// as FAILED rolls its in-progress item back to not-started so the stream stays
// honest. Rebuilt from the event's own evidence; rollback-not-applicable (item
// not in-progress / no record doc) is the sanctioned no-op, exactly the inline
// behaviour this reactor replaced in commands/run-complete.mjs.
async function rollbackStatusIfFailed(event) {
  const { outcome, ref, itemDir, itemType } = event.payload ?? {};
  if (outcome !== "failed") return { skipped: true, reason: "outcome-not-failed" };
  try {
    await rollbackItemStatus({ ref, dir: itemDir, type: itemType }, "not-started");
    return { rolledBack: true };
  } catch (error) {
    if (error?.code === "rollback-not-applicable") {
      return { skipped: true, reason: "rollback-not-applicable" };
    }
    throw error;
  }
}

// publish-projection — publish-on-mutate as a LOCAL-locus reactor. This ONE
// function is now the whole of publish-on-mutate for the command layer (m42 wave
// (d) leg d4, port 1): `withGlobalWorkPropagation` — the per-command import
// decision that let each mutation verb choose whether its workspace propagated —
// is DELETED, and the three events below declare the consequence instead. A verb
// can no longer forget to publish, and a new mutation opts in by adding a row to
// EFFECTS rather than by remembering an import.
//
// Naturally idempotent — the snapshot publish upserts the workspace's current
// truth, so an at-least-once redelivery is a re-publish of the same facts. A
// publish warning is DATA, not a throw (the publisher degrades loudly internally
// and never rejects), so the step completes `done` carrying the warning in its
// detail; the transition's caller threads it back onto the command result
// (global-work-publisher.mjs's threadPropagationWarnings — the ONE home for that
// threading, so `propagationWarnings` reaches renders/--json exactly as it did
// before this port).
//
// ctx.publisherOptions is the command's own ctx passed through by the transition
// seam — the publisher's established injection seam (globalPublisher,
// globalWorkStoreOptions, now, fabricPeers…), which is what the retired wrapper
// forwarded. A crash-recovery drain supplies none and the reactor opens its own,
// exactly as the reactor contract requires.
async function publishItemProjection(event, ctx = {}) {
  const { workspaceRoot } = event.payload ?? {};
  if (!workspaceRoot) return { skipped: true, reason: "no-workspace-root" };
  const workspace = await loadWorkspace(workspaceRoot);
  const publish = await publishGlobalWorkSnapshot(workspace, ctx.publisherOptions ?? {});
  if (publish.warning) return { published: false, warning: publish.warning };
  if (publish.skipped) return { published: false, skipped: true, code: publish.code };
  return { published: publish.published === true };
}

// run.completed / notion-status-sync — the Notion status sync as a LEDGERED
// consequence (m42 wave (d) leg d4, port 4). Today's defect: forgetting to run
// `aof work integrations notion sync-work` is INVISIBLE — nothing records that a
// completed run's status never reached the board. Now a completion in a
// Notion-configured workspace owes a durable `integration:notion` step. Who pays
// it is the port's recorded operator decision (2026-07-31): with
// `work.integrations.notion.autoSync: true` the completion's own drain reaches
// the integration locus (dispatch.reachableLoci) and the sync happens in place;
// WITHOUT autoSync the step stays deferred until the sync-work verb — the
// operator's "do Notion egress now" door — drains it.
//
// IDEMPOTENT BY THE SIDECAR, not event-id-deduped: the core re-projects from
// local facts and the sidecar's lastStatus/lastContentHash decide noop for an
// already-covered item, so an at-least-once redelivery issues ZERO egress. The
// sync scope is the completed item's MILESTONE (the sync-work unit — a story's
// status ride shares the board write with its milestone's routing).
//
// ctx.publisherOptions is the command's own ctx passed through by the transition
// seam (the table's established injection convention) — its `notionSpawn` is the
// same spy seam the verb honours, so a test drives the reactor without egress. A
// crash-recovery drain supplies none and the core builds the real
// provisioned-CLI spawn from the workspace's own config.
async function syncNotionStatus(event, ctx = {}) {
  const { workspaceRoot, ref } = event.payload ?? {};
  if (!workspaceRoot) return { skipped: true, reason: "no-workspace-root" };
  const milestone = typeof ref === "string" && ref.length > 0 ? ref.split("/")[0] : null;
  if (!milestone) return { skipped: true, reason: "no-milestone-ref" };
  const workspace = await loadWorkspace(workspaceRoot);
  try {
    const result = await syncMilestoneWork(workspace, {
      milestone,
      notionSpawn: ctx.publisherOptions?.notionSpawn ?? null,
    });
    // Config removed between append and drain: the consequence can no longer
    // apply, and ending the step honestly beats retrying it forever (the d3
    // "a DECIDED refusal ends the step" rule).
    if (!result.configured) return { skipped: true, reason: "not-configured" };
    return {
      synced: true,
      milestone,
      items: result.items.map(({ ref: itemRef, action }) => ({ ref: itemRef, action })),
    };
  } catch (error) {
    // An item outside any milestone (adhoc) has no board home — nothing owed.
    if (error?.code === "milestone-not-found") return { skipped: true, reason: "milestone-not-found" };
    throw error;
  }
}

// The applicability predicate: a workspace with NO `work.integrations.notion`
// block can never sync, so its completions owe no step (the port-4 leak fix —
// without this, every completion in every unconfigured workspace would append a
// step no process ever drains). The worker's no-workspace mint/settle sites
// (payload workspaceRoot null) are not applicable by the same reading.
async function notionSyncApplies(payload, ctx = {}) {
  const root = payload?.workspaceRoot;
  if (!root) return false;
  const config =
    ctx.workspace?.projectRoot === root ? ctx.workspace.config : (await loadWorkspace(root)).config;
  return config?.work?.integrations?.notion != null;
}

// assignment.settled / record-item-branch — the cascade that lived inline in
// `applyAssignmentStatusFrame` (m42 wave (d) leg d3): a `done` means the worker's
// push SUCCEEDED (it sends done only after pushing), so the branch it reported
// becomes this item's active branch and the next continue/verify reuses it.
// Keyed by the assignment ROW's OWN workspace/item — never a self-reported id
// (the same T6 discipline the transition's holder guard keeps). Absent branch (a
// pre-upgrade worker, or any non-done edge) is the sanctioned no-op.
//
// control-store locus: it writes the authoritative mesh SQLite. It takes the
// open store from ctx when the caller has one (the transition and the control
// tick both do) and opens its own otherwise, so a crash-recovery drain from any
// control-node process behaves identically.
async function recordItemBranch(event, ctx = {}) {
  const { state, branch, workspaceId, itemRef } = event.payload ?? {};
  if (state !== "done") return { skipped: true, reason: "state-not-done" };
  if (!branch || !workspaceId || !itemRef) return { skipped: true, reason: "no-branch-reported" };
  const store = ctx.store ?? (await openGlobalWorkProjectionStore(ctx.globalWorkStoreOptions ?? {}));
  try {
    setItemBranch(store, workspaceId, itemRef, branch, { now: ctx.now });
    return { branch, itemRef };
  } finally {
    if (!ctx.store) store.close?.();
  }
}

// assignment.reported / settle-assignment — the WORKER->CONTROL fact (m42 wave
// (d) leg d3). A worker that has finished with an assignment must settle its row
// on the CONTROL node's store, which is why this reactor's locus is
// `control-store`: on a control-node process it runs in place; on a WORKER it is
// unreachable, so it stays a pending step and travels by outbox (outbox.mjs) —
// delivered at-least-once, acked by (eventId, reactorKey), redelivered after a
// dropped connection. That is the structural cure for the measured fire-once
// defect (a stranded worktree's `failed` report dying on a dead socket while the
// control row read `running` for 35+ minutes).
//
// It settles through the SAME transition every other writer uses, so the holder
// guard (this connection's authenticated node, via ctx.byNode) and the
// terminal-never-regresses rule apply to a bridged fact exactly as they do to a
// status frame — a worker cannot use this door to write something the other door
// would refuse. Non-terminal states are refused here rather than silently
// forwarded: posture (accepted/running/needs-input) is best-effort by design and
// belongs on the status frame, not in a durable, redelivered fact.
async function settleAssignment(event, ctx = {}) {
  const { assignmentId, state, runId, branch, sessionId } = event.payload ?? {};
  if (!assignmentId) return { skipped: true, reason: "no-assignment" };
  if (state !== "done" && state !== "failed") return { skipped: true, reason: `state-not-terminal:${state}` };
  // DYNAMIC IMPORT, deliberately: the transition seam resolves its own reactors
  // through this table, so a static import here would close a module-init cycle.
  // Deferring past init is exactly what the layering gate documents as the
  // sanctioned escape hatch, and this is the one place that needs it.
  const { transitionAssignmentState } = await import("./assignment-transitions.mjs");
  const store = ctx.store ?? (await openGlobalWorkProjectionStore(ctx.globalWorkStoreOptions ?? {}));
  try {
    const result = await transitionAssignmentState(
      store,
      assignmentId,
      state,
      { byNode: ctx.byNode ?? null, now: ctx.now, runId, sessionId, branch },
      { journalOptions: ctx.journalOptions ?? {} },
    );
    if (!result.applied) return { settled: false, code: result.code };
    return { settled: true, state };
  } finally {
    if (!ctx.store) store.close?.();
  }
}

// stream.reindexed — THE CASCADE AN INSERT NEVER HAD (m42 wave (d) leg d4, port 3).
// `aof work insert-*` renumbers folders and rewrites depends/parent, and stops
// there. But a REF is the join key of six stores, and the renumber told none of
// them: run records keep saying `03` while the item is now `04`; the Notion sidecar
// keeps `03 -> <pageId>`, so the next sync PATCHes that page with a DIFFERENT item's
// content (the visible symptom, and the reason this port is in the arc); the
// streamed doc/run rows, assignment rows and item branches all key on the old ref.
//
// The event carries the OLD → NEW list itself, in the collision-free order the
// engine computed it (descending by the number that moved), because after the
// renames the old refs exist nowhere to be re-derived from — the PRD's "never an
// empty ping that forces reactors to re-read racing state" in its sharpest form.
//
// DELIBERATELY ABSENT: publish-projection. `work_items` is a pure projection that
// any publish DELETES and rebuilds from disk, and it carries `parent` and
// `source_path` beside `ref` — so remapping one column would leave the row
// self-inconsistent, while publishing HERE would publish an intermediate stream (the
// slot is open but the new item is not scaffolded until the caller's next step).
// It keeps the eventual-consistency it already had; reconciling a projection rather
// than patching it is exactly what leg d5 is for.

// stream.reindexed / remap-run-refs — the checkout half: each renumbered item's own
// run records. Resolved by the item's NEW ref against the CURRENT stream, so a
// redelivery finds records that already say `to` and rewrites nothing.
async function remapRunRecordRefs(event) {
  const { workspaceRoot, remap } = event.payload ?? {};
  if (!workspaceRoot) return { skipped: true, reason: "no-workspace-root" };
  if (!Array.isArray(remap) || remap.length === 0) return { skipped: true, reason: "empty-remap" };
  const workspace = await loadWorkspace(workspaceRoot);
  const items = await listItems(workspace.workDir);
  const byRef = new Map(items.map((item) => [item.ref, item]));
  let rewritten = 0;
  for (const { from, to } of remap) {
    const item = byRef.get(to);
    if (!item) continue; // the item moved again, or was removed — nothing owed here
    rewritten += (await rewriteRunItemRef(item, { from, to })).rewritten;
  }
  return { rewritten };
}

// stream.reindexed / remap-notion-map — the sidecar's ref-keyed bindings. CHECKOUT
// locus, deliberately NOT integration:notion: the sidecar is a plain JSON file in
// this workspace's own `.aof/`, needing no credentials and reaching no external
// system. Declaring it integration:notion would leave the step permanently deferred
// on every ordinary CLI process (which reaches checkout + local only) and the
// mis-binding would survive the very port that exists to kill it. Talking TO Notion
// is the integration locus; rewriting our own map of it is not.
async function remapNotionSidecar(event) {
  const { workspaceRoot, remap } = event.payload ?? {};
  if (!workspaceRoot) return { skipped: true, reason: "no-workspace-root" };
  return await remapMappingRefs(workspaceRoot, remap, { eventId: event.eventId });
}

// stream.reindexed / remap-projection — this node's own ref-keyed rows (streamed doc
// + run projections, assignment rows, item branches). `work_items` is NOT among them
// by design: it is rebuilt wholesale by the publish reactor declared below on the
// same event, which is also what finally makes an insert propagate at all.
async function remapProjectionRefs(event, ctx = {}) {
  const { workspaceRoot, remap } = event.payload ?? {};
  if (!workspaceRoot) return { skipped: true, reason: "no-workspace-root" };
  if (!Array.isArray(remap) || remap.length === 0) return { skipped: true, reason: "empty-remap" };
  const workspace = await loadWorkspace(workspaceRoot);
  const workspaceId = resolveWorkspaceId(workspace);
  if (!workspaceId) return { skipped: true, reason: "workspace-unidentified" };
  const store = ctx.store ?? (await openGlobalWorkProjectionStore(ctx.globalWorkStoreOptions ?? {}));
  try {
    return remapWorkspaceRefs(store, workspaceId, remap, { eventId: event.eventId, now: ctx.now });
  } finally {
    if (!ctx.store) store.close?.();
  }
}

// ------------------------------------------------------------- the ledger --

// The CLOSED event vocabulary, like the tag set: appendEvent refuses a name not
// declared here (run-transitions resolves reactors through effectsFor). Array
// order IS cascade order within a locus pass — rollback lands before the
// projection publishes, so the published snapshot carries the rolled-back
// status (the inline ordering run-complete.mjs relied on, now structural).
export const EFFECTS = Object.freeze({
  // m42 wave (d) leg d4 port 1 — the run MINT, raised by transitionRunStart for
  // every mint site (work:run-start, work:run-retry, the worker's two). It joins
  // the vocabulary now because a real reactor wants it: publish-on-mutate, which
  // work:run-start used to remember as its own `withGlobalWorkPropagation` import.
  // The mint sites that never propagated still don't — they pass no workspace, so
  // the payload's workspaceRoot is null and the reactor skips (the d2 precedent
  // for the worker's completeRun sites, kept verbatim: worker-side publishing is
  // its own decision, not a side effect of this port).
  "run.started": Object.freeze([
    Object.freeze({ key: "publish-projection", locus: "local", apply: publishItemProjection }),
  ]),
  // Array order is cascade order: rollback lands FIRST, so both the published
  // snapshot and the Notion sync (m42 wave (d) leg d4 port 4 — appended only
  // when its applicability predicate says the workspace is Notion-configured)
  // read the rolled-back status, never the pre-rollback lie.
  "run.completed": Object.freeze([
    Object.freeze({ key: "rollback-status", locus: "checkout", apply: rollbackStatusIfFailed }),
    Object.freeze({ key: "publish-projection", locus: "local", apply: publishItemProjection }),
    Object.freeze({
      key: "notion-status-sync",
      locus: "integration:notion",
      apply: syncNotionStatus,
      applies: notionSyncApplies,
    }),
  ]),
  // m42 wave (d) leg d4 port 1 — the record-doc mutation (a bullet under the
  // verbatim `## Feedback (for retro)` heading), raised by the doc transition
  // seam. Its one consequence is the same publish work:feedback used to import
  // for itself. Both faces (CLI + the board's POST /api/work/feedback) inherit
  // it, because both reach the fact through the one seam.
  "feedback.recorded": Object.freeze([
    Object.freeze({ key: "publish-projection", locus: "local", apply: publishItemProjection }),
  ]),
  // m42 wave (d) leg d4 port 3 — the insert/reindex cascade. Array order is
  // cascade order: the two checkout remaps and the projection remap run over the
  // OLD refs the payload names, and the publish LAST, rebuilding work_items from
  // the renamed stream on disk (which is also the first time an insert has ever
  // propagated at all).
  "stream.reindexed": Object.freeze([
    Object.freeze({ key: "remap-run-refs", locus: "checkout", apply: remapRunRecordRefs }),
    Object.freeze({ key: "remap-notion-map", locus: "checkout", apply: remapNotionSidecar }),
    Object.freeze({ key: "remap-projection", locus: "local", apply: remapProjectionRefs }),
  ]),
  // m42 wave (d) leg d3 — every assignment state change flows through
  // effects/assignment-transitions.mjs, which raises this. Its one declared
  // consequence today is the branch record the apply seam used to write inline;
  // the reclaim/publish cascades join it in d4.
  // m42 wave (d) leg d3 — the WORKER'S REPORT that its assignment reached a
  // terminal state. Raised by the worker at the moment it knows the final answer
  // (after the push, for a done), which is why it is its own event rather than a
  // reactor on run.completed: a run can complete `done` and still fail to push,
  // and "a done means the push succeeded" is the contract control depends on.
  // Its one reactor is control-locus, so on a worker the step stays pending and
  // travels by outbox — the fire-once cure.
  "assignment.reported": Object.freeze([
    Object.freeze({ key: "settle-assignment", locus: "control-store", apply: settleAssignment }),
  ]),
  "assignment.settled": Object.freeze([
    Object.freeze({ key: "record-item-branch", locus: "control-store", apply: recordItemBranch }),
  ]),
});

export function effectsFor(name) {
  return EFFECTS[name] ?? null;
}

// applicableReactors(name, payload, ctx) — the append-time resolution every
// transition seam uses (m42 wave (d) leg d4, port 4): the declared reactors,
// minus any whose applicability predicate says this consequence can never apply
// to this event's workspace. Evaluated ONCE, before the append — a step that
// reaches the journal is owed, and the drain never re-litigates it. An
// unanswerable predicate (the config read threw) resolves NOT OWED, loudly: the
// alternative — owing a step in a workspace that may never drain its locus — is
// the permanent-leak class this machinery exists to close, while a wrongly
// skipped optional sync is recoverable by running the verb.
export async function applicableReactors(name, payload, ctx = {}, effects = EFFECTS) {
  const declared = effects[name] ?? [];
  const owed = [];
  for (const reactor of declared) {
    if (typeof reactor.applies !== "function") {
      owed.push(reactor);
      continue;
    }
    try {
      if (await reactor.applies(payload, ctx)) owed.push(reactor);
    } catch (error) {
      reportDegrade("effect-applies", error, { path: `${name}/${reactor.key}` });
    }
  }
  return owed;
}

export function knownEvents() {
  return Object.keys(EFFECTS);
}
