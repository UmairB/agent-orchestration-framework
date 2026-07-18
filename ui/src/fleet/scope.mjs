// The pure fleet SCOPE helpers (milestone 34 / story 03; ARCHITECTURE ADR-006;
// DESIGN.md's Global/Local checklist). One framework-free ESM module Fleet.tsx
// imports and node:test exercises headlessly — no React, no DOM, no IO, no clock
// of its own — mirroring the house pattern (ui/src/board/runs.mjs, action.mjs):
// render-logic node:test must exercise belongs in a plain .mjs helper the .tsx
// wires up, never inline JSX-only logic.
//
// Covers task 02 (fleet-ui-scope-rendering) and task 03
// (empty-error-and-health-states)'s @executable render-decision surface: which
// scope is active, which region/state the page shows for a given status payload,
// local-filtering a global-shaped payload client-side, the URL scope round-trip,
// and the credential-field guard (ADR-005 — descriptors never render secrets).
//
// finding F9 (aof:verify 38) — also carries `nodeCurrentWork`, the ONE
// current-work-line derivation the ACTUALLY-rendered global node panel calls
// (mesh-ui-serve.mjs serves both scopes from queryGlobalMeshStatus, so the
// global-shaped panel is what production always mounts). A thin wrapper over
// ./runs.mjs's fleetCurrentWorkLines, kept here (not inline in the .tsx) so
// node:test can exercise it directly, mirroring this file's own pattern.
import { fleetCurrentWorkLines } from "./runs.mjs";

// ----------------------------------------------------- scope + URL -----------

export const VALID_SCOPES = ["global", "local"];

// The scope label the scope control renders as ACTIVE — "Global" or "Local"
// (DESIGN: "shows Global as the active scope" / "shows Local as active"). Falls
// back to "Global" for an absent/unrecognized scope (the safer, more-visible
// default — never silently render neither as active).
export function scopeLabel(scope) {
  return scope === "local" ? "Local" : "Global";
}

// Whether a scope string is one of the two recognised scopes.
export function isValidScope(scope) {
  return VALID_SCOPES.includes(scope);
}

// Build the URL scope-param string for a scope switch (task 02: "switching scope
// updates the URL"). PURE — the caller wires this into history.pushState/
// replaceState; this module touches no `window`/`location` itself (headless-testable).
export function withScopeParam(search, scope) {
  const params = new URLSearchParams(search ?? "");
  params.set("scope", scope);
  return `?${params.toString()}`;
}

// Read the scope param out of a location.search-shaped string, defaulting to
// "global" when absent/invalid (mirrors the server's own default — task 01).
export function scopeFromSearch(search) {
  const params = new URLSearchParams(search ?? "");
  const raw = params.get("scope");
  return isValidScope(raw) ? raw : "global";
}

// ------------------------------------------------- region/state selection -----

// The four required page states (DESIGN.md "Required states": Empty / Loading /
// Error / Populated). PURE over the load outcome — no React state machine here;
// Fleet.tsx's own loading/error/status booleans map onto this one selector so the
// state names are shared between the render code and the tests.
//
//   ctx = { loading, error, status } — status is the parsed MeshStatus payload
//   (or null/undefined before the first successful load).
export function pageState(ctx) {
  if (ctx.loading) return "loading";
  if (ctx.error) return "error";
  if (isEmptyStatus(ctx.status)) return "empty";
  return "populated";
}

// errorPathFor(error, status) — review fix P0.5: the ERROR-STATE path the page
// renders (task 03 scenario 2's "the error state includes the global mesh path").
// Prefers the THROWN error's own `path` (api.ts's safeError attaches it from the
// coded 503 body — the ONLY source on a first-load failure, since `status` is still
// null then); falls back to a path already carried on a stale `status` payload
// (e.g. a silent re-poll failure after a prior successful load). Never throws on a
// null/shapeless input; absent either way ⇒ null (no path row rendered).
export function errorPathFor(error, status) {
  const fromError = error && typeof error === "object" ? error.path : null;
  if (typeof fromError === "string" && fromError.length > 0) return fromError;
  const fromStatus = status && typeof status === "object" ? status.path : null;
  return typeof fromStatus === "string" && fromStatus.length > 0 ? fromStatus : null;
}

// A status payload is EMPTY when it carries no workspaces, no work items, and no
// nodes — the global "no mesh-enabled workspaces have published yet" state (task
// 03) is a DIFFERENT state from an error; this predicate is scope-agnostic (it
// reads workspaces/items/nodes on the global shape, or nodes/boards on the local
// mesh:status shape — either way, all-empty renders the same calm empty state).
export function isEmptyStatus(status) {
  if (status == null) return true;
  const workspaces = status.workspaces ?? [];
  const items = status.items ?? [];
  const nodes = status.nodes ?? [];
  const boards = status.boards ?? [];
  return workspaces.length === 0 && items.length === 0 && nodes.length === 0 && boards.length === 0;
}

// The empty-state copy (task 03: "explain the next action without implying
// failure" / "does not call the mesh broken or failed"). Scope-aware: the global
// empty state names publishing; the local empty state keeps the pre-existing
// enrol-a-node guidance (unchanged product copy).
export function emptyStateCopy(scope) {
  if (scope === "local") {
    return "No nodes in the group yet. Enrol a machine to bring it onto the mesh.";
  }
  return "No mesh-enabled workspaces have published yet. Enable mesh on a workspace (config.mesh.enabled) and it will appear here.";
}

// ------------------------------------------------------- milestone list -------

// The global mesh read model intentionally carries the COMPLETE work stream
// (milestones, stories, tasks). The fleet UI's top-level global list is a
// milestone list, so it projects that complete payload down to milestone rows at
// render time instead of asking the store to forget lower-level items.
export function milestoneListItems(items) {
  return (items ?? []).filter((item) => item?.type === "milestone");
}

function sameMilestoneParent(parent, milestoneRef) {
  if (parent == null) return false;
  if (parent === milestoneRef) return true;
  const a = Number.parseInt(parent, 10);
  const b = Number.parseInt(milestoneRef, 10);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

export function milestoneCardModels(items) {
  const all = items ?? [];
  return milestoneListItems(all).map((item) => {
    const stories = all.filter(
      (candidate) =>
        candidate?.type === "story" &&
        candidate.workspaceId === item.workspaceId &&
        sameMilestoneParent(candidate.parent, item.ref)
    );
    const tally = (status) => stories.filter((story) => story.status === status).length;
    return {
      item,
      num: item.ref,
      stories,
      total: stories.length,
      done: tally("done"),
      inReview: tally("in-review"),
      inProgress: tally("in-progress"),
      blocked: tally("blocked"),
      notStarted: tally("not-started"),
    };
  });
}

// ------------------------------------------------------- local filtering ------

// Client-side filter of a GLOBAL-shaped status payload down to one workspace id —
// the pure counterpart to the server's own `?scope=local` narrowing (task 02:
// "no workspace or work item from beta is rendered"; task 01's deep-link
// semantics). Used when the UI already holds a global payload and the operator
// flips the scope control without a full remount/re-fetch having landed yet, and
// exercised directly by node:test for the filtering CONTRACT independent of the
// network. Non-mutating; absent workspaceId ⇒ the payload is returned unchanged.
export function filterToWorkspace(status, workspaceId) {
  if (status == null || workspaceId == null) return status;
  return {
    ...status,
    workspaces: (status.workspaces ?? []).filter((w) => w.workspaceId === workspaceId),
    items: (status.items ?? []).filter((item) => item.workspaceId === workspaceId),
    nodes: (status.nodes ?? []).filter((node) => (node.workspaceIds ?? []).includes(workspaceId)),
  };
}

// ---------------------------------------------------- the credential guard ----

// The field-name pattern that must NEVER reach a rendered node/workspace panel
// (ADR-005 — "sensitive credentials are never copied into the global
// descriptor"; task 02's "the UI does not expose credential-like descriptor
// fields"). Mirrors global-node-registry.mjs's own SECRET_KEY_PATTERN so the UI
// guard and the descriptor redaction agree on one vocabulary — belt AND braces:
// the descriptor is already redacted server-side, and the UI never renders a
// field matching this pattern even if one slipped through.
const CREDENTIAL_FIELD_PATTERN = /(token|secret|credential|auth|invite|hash|relayAuth)/i;

// Strip any credential-shaped key from a plain object (shallow — descriptor
// fields are flat by construction; a nested object, if ever present, is dropped
// wholesale rather than risking a partial redaction). Non-mutating.
export function withoutCredentialFields(record) {
  if (record == null || typeof record !== "object") return record;
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (CREDENTIAL_FIELD_PATTERN.test(key)) continue;
    out[key] = value;
  }
  return out;
}

// Whether a field NAME looks credential-shaped (the guard NodeCard/renderers call
// before printing an arbitrary descriptor key — never render a key this matches).
export function isCredentialField(key) {
  return CREDENTIAL_FIELD_PATTERN.test(String(key ?? ""));
}

// ------------------------------------------------------- node panel facts -----

// The node panel's rendered facts for one node record, spanning BOTH the local
// mesh:status shape (nodeId/host/os/runtimes/skills/presence) and the global
// registry shape (nodeId/role/host/fabric.address/lastSeenAt/runtimes/skills) —
// DESIGN "node panel: shows control and worker nodes, last seen, roles/
// capabilities, and fabric address when known". PURE projection; never mutates
// the input, and never carries a credential-shaped field through (belt-and-braces
// with withoutCredentialFields above).
export function nodePanelFacts(node) {
  const safe = withoutCredentialFields(node ?? {});
  return {
    nodeId: safe.nodeId ?? null,
    role: safe.role ?? (safe.local ? "this node" : null),
    host: safe.host ?? null,
    lastSeenAt: safe.lastSeenAt ?? safe.presence?.heartbeatAt ?? null,
    capabilities: [...(safe.runtimes ?? []), ...(safe.skills ?? [])],
    fabricAddress: safe.fabric?.address ?? null,
    freshness: safe.freshness ?? (safe.presence ? (safe.stale ? "stale" : "live") : "unknown"),
  };
}

// ------------------------------------------------- current-work line (F9) -----

// nodeCurrentWork(node) — the row-3 current-work-line derivation (DESIGN
// §Surface 1: `idle` / `running N runs` / `working · <repo>[, <repo>…]
// (session)`), a thin pass-through to fleetCurrentWorkLines (./runs.mjs) over
// `node.presence` — no forked/duplicated collapse rule, and no liveness or
// run/session subsumption re-derived here (both are already-applied facts on
// the presence record by the time it reaches this projection, upstream at the
// publisher). Absent presence (a never-beat node) degrades to `{}`, which
// fleetCurrentWorkLines already renders as the single `idle` line — never a
// thrown error. Spans BOTH node shapes (global registry / local mesh:status)
// exactly as nodePanelFacts does, since both carry `presence` the same way.
export function nodeCurrentWork(node) {
  return fleetCurrentWorkLines(node?.presence ?? {});
}

// ---------------------------------------------- assign-to-node affordance -----

// assignableNodeOptions(nodes) — milestone 38 / story 04 (ARCHITECTURE ADR-012;
// ADR-008's producer-fed conformance) — the worker-node picker's options,
// derived from the REAL GET /api/mesh/status roster (task 03's Outline: empty /
// one / live+stale). PURE pass-through: every node the roster carries becomes
// an option — no invented placeholder, no liveness/eligibility filter (a
// stale-but-known node stays an option; the verb's node-known gate keys on a
// global_nodes row, NOT on liveness, so the picker must not drop a target the
// verb would accept). Repo-eligibility (membership + publish) is enforced by
// the verb AT ASSIGN TIME (task 01) — a coded refusal on the response, never a
// hidden picker filter here. Non-mutating; an absent/empty roster yields [].
export function assignableNodeOptions(nodes) {
  return (nodes ?? [])
    .map((node) => node?.nodeId)
    .filter((nodeId) => typeof nodeId === "string" && nodeId.length > 0);
}

// --------------------------------------------------------- diagnostics --------

// The health/diagnostics region's rendered summary (DESIGN "shows projection
// freshness, disabled/non-propagating workspaces, and store errors"; task 03
// "health diagnostics expose projection freshness and skipped workspace
// counts"). PURE over the global payload's `diagnostics` block (absent on the
// local shape ⇒ every count reads 0 / null, never throws).
export function diagnosticsSummary(status) {
  const diagnostics = status?.diagnostics ?? {};
  return {
    projectedAt: diagnostics.projectedAt ?? null,
    skippedWorkspaceCount: (diagnostics.skippedWorkspaces ?? []).length,
    descriptorErrorCount: (diagnostics.descriptorErrors ?? []).length,
    projectionErrorCount: (diagnostics.projectionErrors ?? []).length,
  };
}
