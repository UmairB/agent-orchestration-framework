// src/item-lock.mjs — THE exclusive item lock (milestone 43 / story 01, ADR-003 +
// ADR-010's R1.1/R1.3/R1.4/R1.5 rulings).
//
// THE RULE, in one sentence: while an assignment is ACTIVE, it owns its item's whole
// EXECUTION SCOPE, and every door onto that scope — a second assignment, a local
// `run-start`, a `run-retry`, a control-side mutation — is refused with one coded,
// loud answer naming the holder, until the next gate settles the assignment.
//
// TWO HOLES THIS CLOSES (measured at HEAD): (1) `findActiveAssignment` matches
// `item_ref` EXACTLY while execution is milestone-scoped, so milestone "42" running on
// one node did not stop "42/03" being assigned to another — although both build in ONE
// worktree on ONE branch; (2) nothing LOCAL honoured the lock at all: `run-start` never
// queried `global_assignments` and `work next` handed a held item straight out.
//
// ONE PREDICATE, TWO RENDERINGS — and the choice is decided HERE, not per call site:
//   • an OPERATOR verb (a mint, a second assignment, a control-side item mutation) is
//     REFUSED, coded, loud — a human asked and gets an answer (`guardItemLock` /
//     `inspectItemLock`);
//   • an AUTOMATIC, DISK-DERIVED publish (the control's tick, ADR-004) SKIPS the scopes
//     it does not own and COUNTS the skips in its result — a coded refusal per held
//     item per tick is log spam, and the tick asked nothing. That rendering lives in
//     `global-work-store.mjs`'s publish path, reading `activeScopeHolders` from the same
//     leaf this module reads (the store cannot import this module — it would be a cycle
//     back through the publisher seam), and ADR-011/A1 scopes it to the DISK-DERIVED
//     caller only: a worker's frame is the holder's own voice and is never filtered.
//   `work next` is the third shape of the SAME read: it skips-and-REPORTS, so an
//   operator is never handed work another node is doing and never quietly told there
//   is nothing to do while a worker is mid-phase (`readHeldScopes`).
//
// ADMITTED BY IDENTITY, NEVER BY EXEMPTION (ADR-003, mirroring
// `guardAssignmentTransition`): a mint made UNDER an assignment passes that
// assignment's id (`brief.assignmentId`, already present at both worker mint sites) and
// is admitted because that assignment ACTIVELY covers this scope. A mint that names a
// DIFFERENT, a STALE (settled) or an UNKNOWN-but-recorded assignment is refused — a
// settled dispatch replayed must not re-open the lock. There is no "worker is exempt"
// branch and no operator override flag: the worker's own two mint sites pass the very
// assignment that holds the lock, and that is the whole of their admission.
//
// FAILS CLOSED, with a bounded blast radius (ADR-010/R1.4). Three cases, and they are
// not the same case:
//   • mesh not configured for this workspace ⇒ there is no assignment and there cannot
//     be one ⇒ MINT FREELY. That is the correct answer, not a fail-open;
//     `meshGlobalPropagationDecision` is the door (the ONE propagation predicate).
//   • store present and readable ⇒ the predicate answers. The normal path.
//   • store configured but unopenable/torn ⇒ a holder cannot be ruled out ⇒ REFUSE,
//     with the DISTINCT code `item-lock-undeterminable` (never
//     `item-locked-by-assignment`: the operator's remedy is to repair or remove the
//     store, not to wait for a holder).
// And a missing lock CONTEXT where mesh IS configured fails loud
// (`item-lock-context-missing`) rather than silently skipping — "three of the four mint
// sites silently had none" (m42 leg d4) is exactly what an absent-means-skip default
// reproduces.
import { globalMeshPaths } from "./workspace.mjs";
import { openGlobalWorkProjectionStore } from "./global-work-store.mjs";
import { meshGlobalPropagationDecision } from "./global-work-publisher.mjs";
import { resolveWorkspaceId } from "./workspace-identity.mjs";
import {
  activeScopeHolders,
  executionScopeRef,
  findActiveAssignmentForScope,
  isActiveAssignmentState,
  readAssignment,
} from "./assignment-record.mjs";

// The coded refusal vocabulary — ONE code for the lock itself, because it is one rule
// (it joins `assignment-status-not-holder` / `assignment-base-commit-unavailable`), and
// two DISTINCT codes for the two ways the answer is unavailable rather than "held".
//
// NOT superseded here (ADR-010/R1.1): the EXACT-REF duplicate-assign gate keeps its own
// `assignment-already-active` — "this exact item already has an assignment" and "this
// item's execution SCOPE is held" answer different questions, and the first is a pinned
// HTTP-409-mapped contract with an m38 feature asserting it twice.
export const ITEM_LOCKED_CODE = "item-locked-by-assignment";
export const ITEM_LOCK_UNDETERMINABLE_CODE = "item-lock-undeterminable";
export const ITEM_LOCK_CONTEXT_MISSING_CODE = "item-lock-context-missing";

// itemLockPayload(itemRef, holder) — the FIVE keys every rendering of this rule
// carries, so a face can say "42 is held by aof-wsl — refused" without parsing prose:
//   itemRef     — the ref the operator asked for, NOT the scope;
//   scopeRef    — the execution scope that is actually held;
//   assignmentId / holderNode / state — who holds it, and how far along they are.
// `work next`'s skipped[] entries are the SAME five facts rendered as a list rather
// than as an error (ADR-010/R1.5) — one vocabulary, two shapes.
export function itemLockPayload(itemRef, holder, fallbackAssignmentId = null) {
  return {
    itemRef,
    scopeRef: executionScopeRef(itemRef),
    assignmentId: holder?.assignmentId ?? fallbackAssignmentId,
    holderNode: holder?.targetNodeId ?? null,
    state: holder?.state ?? null,
  };
}

// The human sentence — it names BOTH the item and the holder, because the non-`--json`
// face is read by a person who needs to know who to ask.
export function itemLockMessage(payload) {
  const scope = payload.scopeRef !== payload.itemRef ? ` (execution scope "${payload.scopeRef}")` : "";
  if (payload.holderNode == null) {
    // No holder: the refusal is about the IDENTITY the mint presented, which is not an
    // active assignment covering this scope. Saying "held by another node" here would
    // send the operator to wait for a phase that is not running.
    return `The mint for "${payload.itemRef}"${scope} named assignment ${payload.assignmentId ?? "(unknown)"}, which is not an active assignment covering that execution scope — refused. A settled or unrelated assignment id can never open the lock.`;
  }
  return `"${payload.itemRef}"${scope} is held by the active assignment ${payload.assignmentId ?? "(unknown)"} on "${payload.holderNode}"${payload.state ? ` (state "${payload.state}")` : ""} — refused until that phase reaches its gate.`;
}

function lockError(message, code, status, detail = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  // `detail` is the structured half the faces surface verbatim — the CLI's one JSON
  // error envelope spreads it, so a script reads the holder without parsing English.
  if (detail) {
    error.detail = detail;
    Object.assign(error, detail);
  }
  return error;
}

export function itemLockedError(payload) {
  return lockError(itemLockMessage(payload), ITEM_LOCKED_CODE, 409, payload);
}

// ---------------------------------------------------------------- the context ----
//
// resolveLockContext(lock, workspace) — WHERE the guard gets its two facts.
//
// `lock` is a NEW, distinctly-named opt (`opts.lock = { workspaceId, byAssignment }`)
// and deliberately NOT `opts.workspace`: reusing the latter would set the run event
// payload's `workspaceRoot` and flip `run-retry` into publishing as a side effect, a
// behaviour change smuggled in behind a lock check (ADR-010/R1.3). `workspaceId` is
// supplied by the CALLER from its already-resolved workspace and is NEVER derived from
// `item.dir` — cwd-derived identity is TECH_DEBT item 4, the defect that silently
// discarded 100% of the worker→control frames for days.
//
//   lock supplied            ⇒ honour it. `workspaceId == null` means the caller has
//                              already decided this workspace is unmeshed ⇒ free.
//   lock absent, no workspace⇒ a context-free call (a direct seam call in a test, a
//                              single-node install) ⇒ free.
//   lock absent, workspace   ⇒ the caller HAD the context. Mesh off ⇒ free (the correct
//     that is mesh-enabled     answer); mesh ON ⇒ LOUD: `item-lock-context-missing`.
function resolveLockContext(lock, workspace) {
  if (lock !== undefined && lock !== null) {
    const workspaceId = typeof lock.workspaceId === "string" && lock.workspaceId.length > 0 ? lock.workspaceId : null;
    if (workspaceId == null) return { checked: false };
    return {
      checked: true,
      workspaceId,
      byAssignment: typeof lock.byAssignment === "string" && lock.byAssignment.length > 0 ? lock.byAssignment : null,
      storeOptions: lock.globalWorkStoreOptions ?? {},
      openStore: lock.openStore ?? openGlobalWorkProjectionStore,
    };
  }
  if (workspace == null) return { checked: false };
  if (!meshGlobalPropagationDecision(workspace).enabled) return { checked: false };
  throw lockError(
    "The mint seam was reached without an item-lock context in a mesh-configured workspace — pass opts.lock = { workspaceId, byAssignment }. Refusing rather than minting past a lock that could not be evaluated.",
    ITEM_LOCK_CONTEXT_MISSING_CODE,
    500,
  );
}

// lockContextFor(workspace, ctx, { byAssignment }) — the ONE way a COMMAND builds the
// context it hands the seam, so no call site spells the mesh gate or the identity
// precedence itself. A workspace that is not mesh-configured resolves `workspaceId:
// null`, which is the explicit "there is no lock to evaluate here" answer — never an
// omitted opt, which is the silent-skip shape the seam refuses.
export function lockContextFor(workspace, ctx = {}, { byAssignment = null } = {}) {
  const enabled = meshGlobalPropagationDecision(workspace).enabled;
  return {
    workspaceId: enabled ? resolveWorkspaceId(workspace) : null,
    byAssignment,
    globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {},
  };
}

// openLockableStore({ storeOptions, openStore }) — the ONE coded store open for every
// door the lock guards. Exported because the assign door opens the store for its own
// gates BEFORE the lock is consulted, and a torn store there would otherwise escape as
// a raw `ERR_SQLITE_ERROR` — the one door in the set answering an uncoded exception to
// exactly the condition R1.4 rules on.
export async function openLockableStore({ storeOptions = {}, openStore = openGlobalWorkProjectionStore } = {}) {
  try {
    return await openStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
  } catch (error) {
    // FAIL CLOSED. An unreadable store is precisely the condition under which a
    // double-write cannot be ruled out; the refusal is loud, coded, remediable and
    // destroys nothing, and it can never reach a non-mesh workspace (that case never
    // gets here).
    throw lockError(
      `The item lock could not be evaluated: the global mesh store could not be opened (${error?.message ?? error}). Repair or remove the store, then retry — nothing was minted.`,
      ITEM_LOCK_UNDETERMINABLE_CODE,
      503,
    );
  }
}

// --------------------------------------------------------------- the predicate ----
//
// inspectItemLock(store, workspaceId, itemRef, { byAssignment }) — the PURE store-level
// decision: null when this ref's execution scope is free (or is held by the very
// assignment the caller is acting under), else the five-key refusal payload. Callers
// that answer structurally (`assignWork`) read it directly; callers that answer by
// throwing go through `guardItemLock`.
export function inspectItemLock(store, workspaceId, itemRef, { byAssignment = null } = {}) {
  const holder = findActiveAssignmentForScope(store, workspaceId, itemRef);

  if (byAssignment != null) {
    const presented = readAssignment(store, byAssignment);
    // ADMISSION, in full: the named assignment must exist in THIS workspace, still be
    // ACTIVE, and actually cover this ref's execution scope. Anything less is not the
    // holder — a settled dispatch replayed under its own (genuine) id must not re-open
    // the lock.
    const admitted =
      presented != null &&
      presented.workspaceId === workspaceId &&
      isActiveAssignmentState(presented.state) &&
      executionScopeRef(presented.itemRef) === executionScopeRef(itemRef);
    if (admitted) return null;
    // A ref nobody holds AND an identity this store has never heard of is the
    // CROSS-MACHINE case, not a fault: `global_assignments` is control-only, so a
    // worker legitimately mints under an id its own store has no row for (recorded
    // honestly — ADR-003's identity claim is vacuous cross-machine, and task 06's soak
    // is where it is really proven). A ref nobody holds and an identity the store DOES
    // know as settled/foreign is a stale claim, and is refused.
    if (holder == null && presented == null) return null;
    // THE PAYLOAD NEVER NAMES A HOLDER THAT DOES NOT HOLD THE SCOPE. When a real
    // holder exists, it is named. When one does not — a stale or foreign identity
    // presented against a FREE ref — the payload carries the id that was presented and
    // NOTHING else: reporting the presented row's own node/state would assert that
    // somebody holds a scope nobody holds, and (for a settled id) would put a terminal
    // state in a `state` field whose whole meaning is "how far the holder has got".
    // The DECISION is unchanged; only the story it tells about itself is true now.
    return holder != null ? itemLockPayload(itemRef, holder) : itemLockPayload(itemRef, null, byAssignment);
  }

  if (holder == null) return null;
  return itemLockPayload(itemRef, holder);
}

// guardItemLock(itemRef, { lock, workspace }) — THE door, awaited in front of the fact.
// Resolves (returns null) when the mint may proceed; THROWS the coded refusal otherwise.
// One ref or many: an insert renumbers a whole set, and every ref in it must be free.
export async function guardItemLock(itemRefs, { lock, workspace } = {}) {
  const refs = (Array.isArray(itemRefs) ? itemRefs : [itemRefs]).filter((ref) => typeof ref === "string" && ref.length > 0);
  if (refs.length === 0) return null;

  const context = resolveLockContext(lock, workspace);
  if (!context.checked) return null;

  const store = await openLockableStore(context);
  try {
    for (const ref of refs) {
      const refusal = inspectItemLock(store, context.workspaceId, ref, { byAssignment: context.byAssignment });
      if (refusal) throw itemLockedError(refusal);
    }
    return null;
  } finally {
    store.close?.();
  }
}

// -------------------------------------------------------- the skip-and-report read --
//
// readHeldScopes(workspace, options) → Map<scopeRef, payload> — the lock's OTHER
// rendering, for a caller holding a workspace rather than a store: `work next`'s
// skip-and-report. Every held execution scope in this workspace, keyed by the scope
// ref, in the SAME five-key vocabulary the refusal uses. It obeys the same three-case
// rule as the mint door (unmeshed ⇒ empty; readable ⇒ the answer; unopenable ⇒ the
// coded `item-lock-undeterminable` refusal), because a `next` that silently reported
// nothing held over a torn store would be the invisible-item failure with a friendly
// face.
//
// The control's publish tick does NOT come through here: it already holds an open
// store and reads `activeScopeHolders` from the leaf directly (the store module cannot
// import this one — that would be a cycle back through the publisher seam).
export async function readHeldScopes(workspace, options = {}) {
  if (!meshGlobalPropagationDecision(workspace).enabled) return new Map();
  const workspaceId = options.workspaceId ?? resolveWorkspaceId(workspace);
  if (workspaceId == null) return new Map();
  const store = await openLockableStore({
    storeOptions: options.globalWorkStoreOptions ?? {},
    openStore: options.openStore ?? openGlobalWorkProjectionStore,
  });
  try {
    const held = new Map();
    for (const [scope, row] of activeScopeHolders(store, workspaceId)) held.set(scope, itemLockPayload(scope, row));
    return held;
  } finally {
    store.close?.();
  }
}
