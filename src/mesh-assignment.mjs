// src/mesh-assignment.mjs — the ASSIGN/WITHDRAW cores (milestone 35 / story 00,
// ADR-001/003), below the command layer.
//
// They live here rather than in commands/mesh-assign.mjs (m42 wave (d) leg d1)
// because the fleet UI server calls `assignWork` directly and a src-root module
// reaching UP into commands/ was one of the four upward imports the layer gate now
// forbids — and routing that server through the registry instead would have made
// mesh-ui-serve.mjs and commands/mesh-ui.mjs a NEW cycle. The command keeps the
// verb (its face, its refusal matrix, its thrown coded errors); this module keeps
// the behaviour. Moved verbatim — no behaviour change.
//
// It resolves the ref EXACTLY (`findWork`, work.mjs), mints a first-class
// `assigned` record in `global_assignments` (ADR-001), enforces the store-
// uniqueness single-runner invariant (ADR-003 — at most one ACTIVE assignment per
// (workspaceId, itemRef)), and checks the control-side repo-availability gate (this
// node's target must actually HOLD the workspace's published repo, resolved via
// `global_node_workspaces` + `mesh.repo.published`, mirroring mesh-repo-marker.mjs's
// own read of that marker).
//
// Arbitration is a plain store query — no lease/issuance/sync module, no git read
// (ADR-003 / acd-assignment-arbitration-store-not-git). Every miss is a CODED, loud
// refusal (34/ADR-008) that mints nothing; nothing here silently returns.
import { openGlobalWorkProjectionStore } from "./global-work-store.mjs";
import { resolveWorkspaceId } from "./workspace-identity.mjs";
// m43 / story 06 (ADR-005) — a STAGE-2 LEAF. Assignment is the mesh's own door and it must
// be able to name an item the mesh knows about: before this migration a control node could
// not assign a ref its own disk had never held, which is precisely the item another node
// authored. The resolution stays EXACT (`matches.length !== 1` below is unchanged) — the
// cache widens the SET the exact rule is applied to, never the rule.
import { findWorkCacheFirst } from "./work-read.mjs";
import {
  assembleAssignmentRecord,
  findActiveAssignment,
  insertAssignment,
  isActiveAssignmentState,
  listAssignmentsForItem,
} from "./assignment-record.mjs";
// VERIFICATION (UI phase selection, 2026-07-25) — the operator-chosen lifecycle phase
// (refine/continue/verify) rides an additive side-table keyed by assignmentId; it cannot
// live on the FROZEN assignment record. Written here right after the mint, within the
// SAME open store.
import { isAssignmentPhase, setAssignmentPhase, DEFAULT_ASSIGNMENT_PHASE } from "./mesh-assignment-directive.mjs";
// m42 wave (d) leg d3 — the SHARED assignment transition. Withdraw used to call
// the guard-free store writer directly and re-derive a weaker version of the
// terminal rule inline; the rule now lives in front of every write.
import { transitionAssignmentState } from "./effects/assignment-transitions.mjs";
// m43 / ADR-003 — the SCOPE lock, the second assign gate. It sits AFTER the exact-ref
// uniqueness gate, which keeps its own pinned `assignment-already-active` code
// (ADR-010/R1.1): the two answer different questions — "this exact item already has an
// assignment" vs "this item's execution SCOPE is held" — and the first is an
// HTTP-409-mapped wire contract an m38 feature asserts twice.
import { inspectItemLock, itemLockMessage, openLockableStore, ITEM_LOCKED_CODE } from "./item-lock.mjs";

// The store open routes through the LOCK's coded opener (m43/ADR-010 R1.4): this verb
// reads the store for its own gates before the lock is ever consulted, so a torn or
// unopenable store here would otherwise escape as a raw ERR_SQLITE_ERROR — the one door
// in the set answering an uncoded exception to exactly the condition R1.4 rules on
// ("store configured but unopenable ⇒ refuse `item-lock-undeterminable`, and the
// message names the remedy"). Every door now says the same thing about the same fault.
async function openStore(ctx) {
  return openLockableStore({
    storeOptions: ctx.globalWorkStoreOptions ?? {},
    openStore: ctx.openGlobalWorkProjectionStore ?? openGlobalWorkProjectionStore,
  });
}

// resolveTarget(store, workspaceId, nodeId) — the control-side repo-availability gate
// (ADR-001 / 34-ADR-008 / SECURITY T3), joining the two named store facts:
//   (a) is `nodeId` a REAL, known node at all — a row in `global_nodes` (never a
//       self-declared/opaque miss: an unknown nodeId is refused BEFORE the repo check).
//   (b) does `nodeId` actually HOLD this workspace's repo — a row in
//       `global_node_workspaces` for (nodeId, workspaceId) (`global-node-registry.mjs
//       :141-143`'s join: a node is linked to a workspace only when it is a live
//       member of that workspace's mesh roster at snapshot time) AND the workspace's
//       repo has actually been PUBLISHED into the mesh at all — `workspaces
//       .last_published_at IS NOT NULL` (the store-side durable echo of the LOCAL
//       `mesh.repo.published` marker `mesh-repo-marker.mjs` writes: the control
//       node cannot read a remote worker's on-disk config directly, so the marker's
//       existence must be evidenced by SOME publish having reached this workspace row).
// Returns { ok:true } or { ok:false, code, message }, never throws — the caller decides
// how to surface it.
function resolveTarget(store, workspaceId, nodeId) {
  const node = store.db.prepare("SELECT * FROM global_nodes WHERE node_id = ?").get(nodeId);
  if (!node) {
    return {
      ok: false,
      code: "assignment-target-unknown",
      message: `"${nodeId}" is not a known node in this mesh — it has never appeared in the global registry.`,
    };
  }

  const membership = store.db.prepare(
    "SELECT 1 FROM global_node_workspaces WHERE node_id = ? AND workspace_id = ?",
  ).get(nodeId, workspaceId);
  const workspaceRow = store.db.prepare(
    "SELECT last_published_at FROM workspaces WHERE workspace_id = ?",
  ).get(workspaceId);
  const published = Boolean(workspaceRow?.last_published_at);

  if (!membership || !published) {
    return {
      ok: false,
      code: "assignment-repo-unavailable",
      message: `Node "${nodeId}" does not hold a published repo for this workspace — the directive would fail on arrival.`,
    };
  }

  return { ok: true };
}

// resolveWorkspaceId(workspace, workDir, ref) — resolves the item + its canonical
// workspaceId together. Exact resolution only (findWork's ref-based match, work.mjs);
// an unresolvable/typo'd ref refuses coded `ref-not-found`, minting nothing.
async function resolveItem(workspace) {
  const workspaceId = resolveWorkspaceId(workspace);
  return { workspaceId };
}

// assignWork(workspace, ref, nodeId, ctx) — the assign core. Resolves the ref exactly,
// enforces the ADR-003 uniqueness invariant, runs the repo-availability gate, then
// mints an `assigned` record. On ANY miss, mints nothing and returns a structured
// { ok:false, error, code, ...extra } result — never throws for an expected refusal
// (a genuine fault, e.g. the store failing to open, still throws).
export async function assignWork(workspace, ref, nodeId, ctx = {}) {
  const store = await openStore(ctx);
  try {
    const matches = await findWorkCacheFirst(workspace, ref, { globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {} });
    if (matches.length !== 1) {
      return {
        ok: false,
        error: `No work item resolves for ref "${ref}".`,
        code: "ref-not-found",
      };
    }
    const item = matches[0];
    const { workspaceId } = await resolveItem(workspace);

    const active = findActiveAssignment(store, workspaceId, item.ref);
    if (active) {
      return {
        ok: false,
        error: `Item "${item.ref}" already has an active assignment held by "${active.targetNodeId}" (state "${active.state}").`,
        code: "assignment-already-active",
        holder: active.targetNodeId,
      };
    }

    const gate = resolveTarget(store, workspaceId, nodeId);
    if (!gate.ok) {
      return { ok: false, error: gate.message, code: gate.code, target: nodeId };
    }

    // THE SCOPE LOCK (m43/ADR-003), the LAST gate: a milestone running on one node
    // holds every story under it, and a story running on one node holds its milestone —
    // both directions, because both execute in ONE worktree on ONE branch. A second
    // assignment anywhere in a held scope mints nothing and is refused, coded, naming
    // the holder.
    //
    // It runs BEHIND this verb's pre-existing gates on purpose. Each of those refusals
    // is a pinned wire contract with an m38 feature asserting it (the exact-ref
    // duplicate above keeps `assignment-already-active` per ADR-010/R1.1; the two
    // target gates are asserted over a CHILD of an already-assigned milestone), and the
    // new lock must not steal an earlier gate's answer — the same discipline the
    // milestone's own task 02 pins for `ref-not-found`.
    const locked = inspectItemLock(store, workspaceId, item.ref);
    if (locked) {
      return { ok: false, error: itemLockMessage(locked), code: ITEM_LOCKED_CODE, holder: locked.holderNode, detail: locked };
    }

    const issuer = ctx.issuer ?? workspace.config?.mesh?.nodeId ?? null;
    const now = ctx.now ?? new Date().toISOString();
    const record = assembleAssignmentRecord({
      itemRef: item.ref,
      workspaceId,
      targetNodeId: nodeId,
      issuer,
      now,
      assignmentId: ctx.assignmentId,
    });
    insertAssignment(store, record);
    // VERIFICATION (UI phase selection) — record the operator-chosen lifecycle phase for
    // this assignment so the dispatch tick runs `/aof:continue`/`/aof:verify` instead of
    // the refine default. Written only for an explicit NON-default phase: a CLI assign
    // (no phase) or an explicit `refine` writes NO row, so the dispatch tick's own refine
    // fallback applies and legacy behaviour is byte-identical. The phase can NEVER live on
    // the frozen record — it rides the additive side-table (mesh-assignment-directive.mjs).
    const phase = isAssignmentPhase(ctx.phase) ? ctx.phase : DEFAULT_ASSIGNMENT_PHASE;
    if (phase !== DEFAULT_ASSIGNMENT_PHASE) {
      setAssignmentPhase(store, record.assignmentId, phase, { now });
    }
    return { ok: true, phase, ...record };
  } finally {
    store.close?.();
  }
}

// withdrawWork(workspace, ref, ctx) — the withdraw core (ADR-001/003). Flips the
// LATEST assignment for the item to `withdrawn` IN PLACE (a state write, never a row
// delete) — but ONLY when that latest row is the ACTIVE assignment (state IN
// assigned/accepted/running — matches the feature's "flips the ACTIVE assignment"
// wording, QA advisory A3): idempotent-safe on an already-`withdrawn` row (re-writing
// withdrawn→withdrawn is a no-op-shaped success, never an error); and a benign
// `{ ok:true, assignment:null }` (fabricates/rewrites NOTHING) both when no assignment
// has ever existed for the ref AND when the latest row is already terminal but NOT
// `withdrawn` (done/failed/reclaimed) — withdraw never resurrects or reclassifies a
// run-store-owned terminal outcome.
export async function withdrawWork(workspace, ref, ctx = {}) {
  const store = await openStore(ctx);
  try {
    const matches = await findWorkCacheFirst(workspace, ref, { globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {} });
    if (matches.length !== 1) {
      return {
        ok: false,
        error: `No work item resolves for ref "${ref}".`,
        code: "ref-not-found",
      };
    }
    const item = matches[0];
    const { workspaceId } = await resolveItem(workspace);

    const rows = listAssignmentsForItem(store, workspaceId, item.ref);
    if (rows.length === 0) {
      return { ok: true, assignment: null };
    }

    const latest = rows[0];
    if (!isActiveAssignmentState(latest.state) && latest.state !== "withdrawn") {
      // The latest row is terminal-but-not-withdrawn (done/failed/reclaimed) —
      // benign null, fabricates/rewrites nothing.
      return { ok: true, assignment: null };
    }
    if (latest.state === "withdrawn") {
      // Already withdrawn: the no-op-shaped SUCCESS this verb has always
      // promised, now honestly a no-op. m42 wave (d) leg d3 moved the
      // terminal-never-regresses rule in front of every assignment write
      // (effects/assignment-transitions.mjs), and a settled row re-asserted at
      // its own state is exactly what that rule refuses — so withdraw answers
      // the repeat by RETURNING the settled row instead of asking for a write
      // it does not need. (The only observable difference from the pre-d3 path:
      // `updatedAt` no longer restamps on a repeat withdraw, which is the truth
      // — nothing changed.)
      return { ok: true, assignment: latest };
    }

    const now = ctx.now ?? new Date().toISOString();
    // THE SHARED TRANSITION — no `byNode`: control is the ISSUER here, not the
    // holder, so the holder guard does not apply to an operator withdrawal. The
    // terminal guard does, and this call site no longer re-derives it.
    const result = await transitionAssignmentState(
      store,
      latest.assignmentId,
      "withdrawn",
      { now },
      { journalOptions: ctx.globalWorkStoreOptions ?? {} },
    );
    if (!result.applied) {
      return { ok: false, error: `The assignment for "${item.ref}" could not be withdrawn.`, code: result.code };
    }
    return { ok: true, assignment: result.assignment };
  } finally {
    store.close?.();
  }
}
