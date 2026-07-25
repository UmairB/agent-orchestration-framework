// Fitness function: acd-fleet-assign-targets-item-workspace (milestone 38 /
// story 04; ARCHITECTURE ADR-012 AMENDMENT 2026-07-24, invariants 5 + 6;
// BLOCKER F21).
//
// "The fleet assign route targets the ITEM's own workspace, never the daemon's.
//  `workspaceId` is REQUIRED on the wire (blank => coded invalid-workspace, never
//  a fallback); it resolves to a projectRoot through the sanctioned
//  queryGlobalMeshStatus -> status.workspaces[] seam; a project root absent on
//  this machine is a loud workspace-not-local refusal; and BEFORE the mint the
//  route asserts the loaded workspace's OWN derived id equals the requested one,
//  refusing workspace-id-mismatch otherwise — so minting against a workspace
//  other than the one the operator clicked is structurally impossible."
//
// A COMPANION to acd-fleet-face-single-mutation-route (ADR-012 inv.1-4), which is
// left byte-untouched and green: this file arms ONLY the two NEW invariants, so
// the red it carries names exactly one thing.
//
// WHY IT EXISTS. Measured live at the 2026-07-24 two-machine soak: the operator
// clicked "Homedata Live Property Data" (ref 18, let-shield-portal, workspace
// 1f164bd03ea535da); the route returned 200 ok and minted ref 18 in the CONTROL's
// OWN aof workspace (9db1fd84f5895e38) — a different milestone entirely. Story
// 04's tasks 00-03 never caught it because they drive the route against the
// server's OWN workspace, the only workspace a single-workspace fixture has: a
// seam exercised only in the configuration where it cannot fail. Hence the
// behavioural half below stands up TWO published workspaces.
//
// STRUCTURAL half: source-analysis over the REAL src/mesh-ui-serve.mjs (comments
// discounted, CRLF-normalised — the tree is CRLF; an "\n"-only needle would
// silently no-op and leave the self-check vacuous). The detector extracts the
// POST /api/mesh/assign BRANCH BODY by brace-balancing and ASSERTS THE
// EXTRACTION LANDED (substantial + contains `assignWork(`) before probing it —
// the STATE.md lesson that a source-scanning detector which grabs a param-list
// `options = {}` self-passes vacuously. Every plant is a HAND-WRITTEN synthesized
// snippet (never a string-replace on the real file) and asserts it LANDED
// (`notEqual(planted, clean)`) before asserting the trip.
//
// BEHAVIOURAL half: the REAL serveMeshUi over an isolated AOF_GLOBAL_HOME v3
// store with TWO published workspaces, BOTH carrying an item at the SAME ref
// "18" and BOTH with an eligible target node — so a mis-target returns a
// plausible 200 and mints, exactly as it did live.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../../src/global-work-store.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { seedTargetNode, readAssignmentRows } from "../support/mesh-assign-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");
const FLEET_TSX = path.join(repoRoot, "ui", "src", "fleet", "Fleet.tsx");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF -> LF before every probe (core.autocrlf=true on
// this platform): a detector written against "\n" boundaries would silently
// no-op on a raw CRLF read, which is the exact vacuity this milestone keeps
// getting burned by.
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

function normalise(source) {
  return lf(stripComments(source));
}

function sliceBalanced(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

// --- region extraction (the non-vacuity foundation) -------------------------

// assignBranch(source) — the BODY of `if (pathname === "/api/mesh/assign") { … }`,
// brace-balanced. NOT a param-list default `{}` (STATE.md's recorded lesson: a
// detector that grabs `options = {}` matches nothing and self-passes), which is
// why extractionProblems() below asserts the extracted region is substantial and
// actually contains the mint.
function assignBranch(source) {
  const guard = /if\s*\(\s*pathname\s*===\s*["']\/api\/mesh\/assign["']\s*\)\s*\{/.exec(source);
  if (!guard) return null;
  const braceOpen = source.indexOf("{", guard.index);
  if (braceOpen < 0) return null;
  return sliceBalanced(source, braceOpen);
}

function extractionProblems(block) {
  const problems = [];
  if (block == null) {
    problems.push('no `if (pathname === "/api/mesh/assign") { … }` branch found — the detector extracted nothing (a vacuous pass)');
    return problems;
  }
  if (block.length < 400) {
    problems.push(`the extracted assign branch is only ${block.length} chars — the extraction did not land on the route body (a vacuous pass)`);
  }
  if (!/\bassignWork\s*\(/.test(block)) {
    problems.push("the extracted assign branch contains no assignWork( — it is not the mint branch (a vacuous pass)");
  }
  return problems;
}

// preMintRegion(block) — everything BEFORE the assignWork( call. Every guard the
// amendment requires must live here: a check made AFTER the mint is a
// mis-dispatch already committed.
function preMintRegion(block) {
  const at = block.search(/\bassignWork\s*\(/);
  return at < 0 ? "" : block.slice(0, at);
}

// codedRefusalProblems(region, code, status) — the coded refusal exists in this
// region AND carries the pinned HTTP number (the ADR-012 AMENDMENT mapping
// table). Window-scoped: the code literal is the 4th argument of the
// sendApiError( call that must precede it.
function codedRefusalProblems(region, code, status, why) {
  const problems = [];
  const at = region.search(new RegExp(`["']${code}["']`));
  if (at < 0) {
    problems.push(`no "${code}" refusal before the mint — ${why}`);
    return problems;
  }
  const window = region.slice(Math.max(0, at - 400), at);
  if (!new RegExp(`sendApiError\\s*\\(\\s*response\\s*,\\s*${status}\\b`).test(window)) {
    problems.push(`the "${code}" refusal is not sent as sendApiError(response, ${status}, …) — the pinned HTTP mapping`);
  }
  return problems;
}

// --- the detector -----------------------------------------------------------

// Exported so the developer can run the detector against a candidate fix
// directly (and so the non-vacuity demonstration can be reproduced): it returns
// the list of violations, empty when the source conforms.
export function targetResolutionProblems(rawSource) {
  const source = normalise(rawSource);
  const block = assignBranch(source);
  const problems = extractionProblems(block);
  if (problems.length > 0) return problems;

  // inv.5 (negative clause) — the daemon's OWN launch project dir is not a value
  // the assign branch may read, under any condition. This is F21's literal shape:
  // loadWorkspace(resolvedProjectDir, …) then assignWork(assignWorkspace, …).
  for (const own of ["resolvedProjectDir", "projectDir"]) {
    if (new RegExp(`\\b${own}\\b`).test(block)) {
      problems.push(`the assign branch reads \`${own}\` — the server's OWN project dir must never reach the workspace assignWork is handed (ADR-012 AMENDMENT inv.5)`);
    }
  }

  const pre = preMintRegion(block);

  // inv.5 — workspaceId is lifted off the body and REQUIRED. Either spelling of
  // the lift counts (a property read or a destructure) — the invariant is that
  // the ITEM's workspace is on the wire, not how it is unpacked.
  const liftsWorkspaceId = /body\s*\??\.\s*workspaceId/.test(pre)
    || /\{[^}]*\bworkspaceId\b[^}]*\}\s*=\s*(await\s+)?[a-zA-Z_$][\w$]*\s*(\?\?|\|\|)?/.test(pre) && /\bbody\b/.test(pre);
  if (!liftsWorkspaceId) {
    problems.push("the assign branch never lifts `workspaceId` off the request body — the item's workspace is not on the wire (ADR-012 AMENDMENT ruling 1)");
  }
  problems.push(...codedRefusalProblems(pre, "invalid-workspace", 400, "a blank/absent workspaceId must be a coded refusal, NEVER a fallback to the server's own workspace"));

  // inv.5 — resolution runs through the sanctioned query surface, and only it.
  if (!/queryGlobalMeshStatus\s*\(/.test(pre)) {
    problems.push("the assign branch does not resolve the workspaceId through queryGlobalMeshStatus — the sanctioned seam (ADR-012 AMENDMENT ruling 2)");
  }
  if (!/workspaces[\s\S]{0,160}?(\.find\s*\(|\.filter\s*\(|\[\s*0\s*\])/.test(pre)) {
    problems.push("the assign branch does not look the workspaceId up in status.workspaces[] — the row that carries projectRoot");
  }
  problems.push(...codedRefusalProblems(pre, "workspace-not-found", 404, "a workspaceId absent from the mesh projection must refuse"));

  // inv.5 — a row published by ANOTHER machine (project_root not on this disk)
  // is a LOUD coded refusal, never a fallback and never a misleading
  // `ref-not-found` from a degraded loadWorkspace.
  if (!/\b(existsSync|statSync|lstatSync|stat|lstat|access)\s*\(/.test(pre)) {
    problems.push("the assign branch never probes whether the resolved projectRoot exists on THIS machine (ADR-012 AMENDMENT: the reachability caveat)");
  }
  problems.push(...codedRefusalProblems(pre, "workspace-not-local", 409, "a resolved projectRoot that is not on this machine must name its own cause"));

  // inv.6 — the mint's target is ASSERTED, with the VERB-IDENTICAL derivation.
  if (!/config\s*\??\.\s*mesh\s*\??\.\s*workspaceId/.test(pre) || !/workspaceIdForProjectRoot\s*\(/.test(pre)) {
    problems.push("the assign branch does not derive the loaded workspace's own id the way the verb's resolveItem does (`config?.mesh?.workspaceId ?? workspaceIdForProjectRoot(projectRoot)`) — it would assert a lookalike, not the value the mint stamps (ADR-012 AMENDMENT inv.6)");
  }
  const mismatchAt = pre.search(/["']workspace-id-mismatch["']/);
  if (mismatchAt < 0) {
    problems.push('no "workspace-id-mismatch" assertion before the mint — the route does not prove the resolved workspace IS the requested one (ADR-012 AMENDMENT inv.6)');
  } else {
    const window = pre.slice(Math.max(0, mismatchAt - 600), mismatchAt);
    if (!/!==/.test(window)) {
      problems.push('the "workspace-id-mismatch" refusal is not guarded by a `!==` identity comparison');
    }
    if (!/sendApiError\s*\(\s*response\s*,\s*409\b/.test(window)) {
      problems.push('the "workspace-id-mismatch" refusal is not sent as sendApiError(response, 409, …) — the pinned HTTP mapping');
    }
  }

  return problems;
}

// --- the THIRD structural clause: one cadence, one hold, no second copy ------
//
// REVIEW FIX F-D (architect, 2026-07-24). This assertion used to live in
// test/fleet-assign-acknowledgment.test.mjs (task 06's story acceptance),
// driven from a Gherkin scenario. It is a STRUCTURAL assertion about the
// component's shape — "POLL_MS is ONE value and the component schedules from it,
// never from a literal of its own" — so in story acceptance it ages with the
// story instead of standing as a milestone invariant. It is green today, so
// moving it adds no red; it simply now fails for the whole milestone if the
// affordance ever grows a second copy of the number or stops delegating.
//
// It belongs beside the workspace-target invariants because it is the same
// property one axis over: the fleet face's assign row must have exactly ONE
// source for each fact it renders and sends (the workspace it targets, the node
// it names, the window it holds). Two copies of a fact can disagree; one cannot.

// assignAffordanceBody(source) — the AssignAffordance function body, brace-
// balanced from its declaration. Like assignBranch above, the extraction is
// ASSERTED to have landed before anything is read off it (the recorded lesson
// that a source-scanning detector which grabs a param-list `{}` self-passes).
function assignAffordanceBody(source) {
  const at = source.search(/function\s+AssignAffordance\s*\(/);
  if (at < 0) return null;
  const bodyStart = source.indexOf("{", source.indexOf(")", at));
  if (bodyStart < 0) return null;
  return sliceBalanced(source, bodyStart);
}

// Exported for the same reason targetResolutionProblems is: a developer can run
// the detector against a candidate shape directly.
export function affordanceCadenceProblems(rawSource) {
  const source = normalise(rawSource);
  const problems = [];

  // ONE number: imported from the helper that owns the hold beside it, and never
  // re-declared here.
  if (!/import\s*\{[^}]*\bPOLL_MS\b[^}]*\}\s*from\s*["']\.\/assign-affordance\.mjs["']/.test(source)) {
    problems.push("Fleet.tsx does not import POLL_MS from ./assign-affordance.mjs — the poll cadence and the `Sent` hold must be ONE number that cannot drift");
  }
  if (/const\s+POLL_MS\s*=/.test(source)) {
    problems.push("Fleet.tsx declares a POLL_MS of its own — a second copy of the number the hold is sized from");
  }
  // …and the SCHEDULING site consumes it: an unpinned `setInterval(…, 4000)`
  // breaks "the hold is one poll interval" while every unit lane stays green.
  if (!/setInterval\s*\([\s\S]{0,160}?,\s*POLL_MS\s*\)/.test(source)) {
    problems.push("the fleet poll is not scheduled from POLL_MS — the cadence is a literal of the component's own");
  }
  if (!/const\s+onAssigned\s*=\s*useCallback\s*\(\s*\(\s*\)\s*=>\s*void\s+load\s*\(\s*scope\s*,\s*\{\s*silent:\s*true\s*\}\s*\)/.test(source)) {
    problems.push("the re-load handed to the affordance is not load(scope, { silent: true }) — a non-silent load unmounts the populated board");
  }

  const body = assignAffordanceBody(source);
  if (body == null) {
    problems.push("no AssignAffordance function body found — the detector extracted nothing (a vacuous pass)");
    return problems;
  }
  if (body.length < 400) {
    problems.push(`the extracted AssignAffordance body is only ${body.length} chars — the extraction did not land (a vacuous pass)`);
    return problems;
  }

  // The component DELEGATES: every rendered fact comes from the helper's view,
  // the click is the helper's orchestrator, and the decay is scheduled from the
  // view's own holdMs. This is the half a pure-helper test cannot see (F-38.06e).
  if (!/assignAffordanceView\s*\(/.test(body)) problems.push("AssignAffordance does not derive what it renders from assignAffordanceView — it re-implements the state machine");
  if (!/runAssign\s*\(/.test(body)) problems.push("the click is not the helper's orchestrator (runAssign) — the transition logic is re-implemented in the component");
  if (!/setTimeout\s*\(\s*\(\s*\)\s*=>\s*setAck\s*\(\s*assignAckExpired\s*\)\s*,\s*holdMs\s*\)/.test(body)) {
    problems.push("the decay is not scheduled from the view's own holdMs — the hold is remembered rather than structural");
  }
  if (!/onAssigned/.test(body)) problems.push("the one silent re-load callback is not threaded into the orchestrator");
  if (/["'`]Sent["'`]/.test(body)) problems.push("the `Sent` label is hard-coded in the component — a second copy of the helper's own label");
  if (/["'`]Assigning…["'`]/.test(body)) problems.push("the in-flight label is hard-coded in the component");
  if (/\b\d{3,}\b/.test(body)) problems.push("a millisecond-scale literal lives in the component — the hold may only come from the shared constant");

  return problems;
}

// --- synthesized shapes for the self-check ----------------------------------

// The CORRECTED shape (hand-written, never a string-replace on the real file) —
// the detector must stay quiet on it REGARDLESS of the tree's state, which is
// what proves the arming red is a finding about the TREE and not a broken
// detector.
const CLEAN = [
  'if (pathname === "/api/mesh/assign") {',
  '  if (request.method !== "POST") { sendMethodNotAllowed(response, "POST"); return; }',
  '  const ref = typeof body?.ref === "string" ? body.ref.trim() : "";',
  '  const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : "";',
  '  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId.trim() : "";',
  '  if (!ref || !nodeId) { sendApiError(response, 400, "Both ref and nodeId are required.", "invalid-body"); return; }',
  '  if (!workspaceId) { sendApiError(response, 400, "workspaceId is required.", "invalid-workspace"); return; }',
  '  try {',
  '    const status = await queryGlobalMeshStatus({ ...globalStoreOptions, workspaceId });',
  '    const row = (status.workspaces ?? []).find((candidate) => candidate.workspaceId === workspaceId);',
  '    if (!row) { sendApiError(response, 404, "Workspace is not in the mesh projection.", "workspace-not-found"); return; }',
  '    if (!row.projectRoot || !existsSync(row.projectRoot)) { sendApiError(response, 409, "That workspace is not checked out on this machine.", "workspace-not-local"); return; }',
  '    const assignWorkspace = await loadWorkspace(row.projectRoot, undefined, { env: globalStoreOptions?.env });',
  '    const ownWorkspaceId = assignWorkspace.config?.mesh?.workspaceId ?? workspaceIdForProjectRoot(assignWorkspace.projectRoot);',
  '    if (ownWorkspaceId !== workspaceId) { sendApiError(response, 409, "The resolved workspace is not the requested one.", "workspace-id-mismatch"); return; }',
  '    const result = await assignWork(assignWorkspace, ref, nodeId, { globalWorkStoreOptions: globalStoreOptions ?? {} });',
  '    if (!result.ok) { const { ok: _ok, error: message, code, ...extra } = result; sendApiError(response, assignGateStatus(code), message, code, extra); return; }',
  '    sendJson(response, 200, result);',
  '  } catch (error) {',
  '    sendApiError(response, error.status ?? 500, error.message, error.code ?? "assign-failed", { path: error.path ?? null });',
  '  }',
  '  return;',
  '}',
].join("\n");

// PLANT 1 — the F21 defect VERBATIM: only { ref, nodeId } off the body, then the
// daemon's own project dir into loadWorkspace.
const PLANT_F21 = [
  'if (pathname === "/api/mesh/assign") {',
  '  const ref = typeof body?.ref === "string" ? body.ref.trim() : "";',
  '  const nodeId = typeof body?.nodeId === "string" ? body.nodeId.trim() : "";',
  '  if (!ref || !nodeId) { sendApiError(response, 400, "Both ref and nodeId are required.", "invalid-body"); return; }',
  '  try {',
  '    const assignWorkspace = await loadWorkspace(resolvedProjectDir, undefined, { env: globalStoreOptions?.env });',
  '    const result = await assignWork(assignWorkspace, ref, nodeId, { globalWorkStoreOptions: globalStoreOptions ?? {} });',
  '    if (!result.ok) { const { ok: _ok, error: message, code, ...extra } = result; sendApiError(response, assignGateStatus(code), message, code, extra); return; }',
  '    sendJson(response, 200, result);',
  '  } catch (error) {',
  '    sendApiError(response, error.status ?? 500, error.message, error.code ?? "assign-failed", { path: error.path ?? null });',
  '  }',
  '  return;',
  '}',
].join("\n");

// PLANT 2 — workspaceId IS on the wire, but an absent/unresolvable one silently
// falls back to the server's own workspace: the "intuitive default" the
// amendment removes by construction (F-38.06b's footgun lesson).
const PLANT_FALLBACK = CLEAN
  .replace(
    '  if (!workspaceId) { sendApiError(response, 400, "workspaceId is required.", "invalid-workspace"); return; }',
    '  // an absent workspaceId just uses the daemon\'s own workspace',
  )
  .replace(
    '    const assignWorkspace = await loadWorkspace(row.projectRoot, undefined, { env: globalStoreOptions?.env });',
    '    const assignWorkspace = await loadWorkspace(row?.projectRoot ?? resolvedProjectDir, undefined, { env: globalStoreOptions?.env });',
  );

// PLANT 3 — resolution is careful, but the minted target is never ASSERTED: the
// loaded workspace's own config could carry a different mesh.workspaceId, and
// the mint would stamp THAT (inv.6).
const PLANT_NO_ASSERTION = CLEAN
  .replace(
    '    const ownWorkspaceId = assignWorkspace.config?.mesh?.workspaceId ?? workspaceIdForProjectRoot(assignWorkspace.projectRoot);',
    '',
  )
  .replace(
    '    if (ownWorkspaceId !== workspaceId) { sendApiError(response, 409, "The resolved workspace is not the requested one.", "workspace-id-mismatch"); return; }',
    '',
  );

// PLANT 4 — the assertion exists but runs AFTER the mint: a mis-dispatch already
// committed, "detected" too late.
const PLANT_ASSERT_AFTER_MINT = CLEAN
  .replace(
    '    const ownWorkspaceId = assignWorkspace.config?.mesh?.workspaceId ?? workspaceIdForProjectRoot(assignWorkspace.projectRoot);',
    '',
  )
  .replace(
    '    if (ownWorkspaceId !== workspaceId) { sendApiError(response, 409, "The resolved workspace is not the requested one.", "workspace-id-mismatch"); return; }',
    '',
  )
  .replace(
    '    sendJson(response, 200, result);',
    [
      '    const ownWorkspaceId = assignWorkspace.config?.mesh?.workspaceId ?? workspaceIdForProjectRoot(assignWorkspace.projectRoot);',
      '    if (ownWorkspaceId !== workspaceId) { sendApiError(response, 409, "The resolved workspace is not the requested one.", "workspace-id-mismatch"); return; }',
      '    sendJson(response, 200, result);',
    ].join("\n"),
  );

// PLANT 5 — a row published by ANOTHER machine resolves to a path that is not on
// this disk, and the route walks straight into loadWorkspace: the operator gets
// `ref-not-found`, a refusal that names the wrong cause.
const PLANT_NO_LOCALITY_CHECK = CLEAN.replace(
  '    if (!row.projectRoot || !existsSync(row.projectRoot)) { sendApiError(response, 409, "That workspace is not checked out on this machine.", "workspace-not-local"); return; }',
  '',
);

// The CORRECTED component shape (hand-written, never a string-replace on the
// real file): the detector must stay quiet on it regardless of the tree's state.
const CLEAN_AFFORDANCE = [
  'import { POLL_MS, assignAtRest, assignAckExpired, assignAffordanceView, runAssign } from "./assign-affordance.mjs";',
  'export function Fleet() {',
  '  const load = useCallback(async (targetScope, { silent = false } = {}) => { setStatus(await fleetApi.status(targetScope)); }, []);',
  '  useEffect(() => {',
  '    const poll = setInterval(() => void load(scope, { silent: true }), POLL_MS);',
  '    return () => clearInterval(poll);',
  '  }, [load, scope]);',
  '  const onAssigned = useCallback(() => void load(scope, { silent: true }), [load, scope]);',
  '  return <GlobalScopeView status={status} onAssigned={onAssigned} />;',
  '}',
  'function AssignAffordance({ ref, workspaceId, nodes, onAssigned }) {',
  '  const options = assignableNodeOptions(nodes);',
  '  const [selected, setSelected] = useState(options[0] ?? "");',
  '  const [ack, setAck] = useState(assignAtRest);',
  '  const target = options.includes(selected) ? selected : (options[0] ?? "");',
  '  const view = assignAffordanceView({ phase: ack.phase, error: ack.error, hasOptions: options.length > 0, selected: target });',
  '  const holdMs = view.holdMs;',
  '  useEffect(() => {',
  '    if (holdMs == null) return;',
  '    const timer = setTimeout(() => setAck(assignAckExpired), holdMs);',
  '    return () => clearTimeout(timer);',
  '  }, [holdMs, ack.phase]);',
  '  const onAssign = useCallback(async (event) => {',
  '    event.stopPropagation();',
  '    if (!target) return;',
  '    await runAssign({ assign: fleetApi.assign.bind(fleetApi), onAssigned, onState: setAck }, { ref, nodeId: target, workspaceId });',
  '  }, [ref, workspaceId, target, onAssigned]);',
  '  return (',
  '    <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs">',
  '      <select aria-label={`Assign ${ref} to a worker node`} value={target} disabled={view.pickerDisabled} onChange={(event) => setSelected(event.target.value)}>',
  '        {view.pickerPlaceholder ? <option value="">{view.pickerPlaceholder}</option> : options.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}',
  '      </select>',
  '      <button type="button" disabled={view.actionDisabled} onClick={onAssign}>{view.actionLabel}</button>',
  '      {view.message ? <span className="text-destructive">{view.message}</span> : null}',
  '    </div>',
  '  );',
  '}',
].join("\n");

// PLANT A — the decay is scheduled from a millisecond literal of the component's
// own: the hold and the cadence become two numbers that can drift apart.
const PLANT_LITERAL_HOLD = CLEAN_AFFORDANCE.replace(
  "    const timer = setTimeout(() => setAck(assignAckExpired), holdMs);",
  "    const timer = setTimeout(() => setAck(assignAckExpired), 5000);",
);

// PLANT B — a SECOND copy of the poll cadence declared in the component.
const PLANT_SECOND_POLL_CONST = CLEAN_AFFORDANCE.replace(
  "export function Fleet() {",
  "const POLL_MS = 5000;\nexport function Fleet() {",
);

// PLANT C — QA-c's exact drift: the scheduled poll is an unpinned literal, so
// "the hold is one poll interval" silently stops being true.
const PLANT_LITERAL_CADENCE = CLEAN_AFFORDANCE.replace(
  "    const poll = setInterval(() => void load(scope, { silent: true }), POLL_MS);",
  "    const poll = setInterval(() => void load(scope, { silent: true }), 4000);",
);

// PLANT D — the component hard-codes the acknowledgment's label instead of
// rendering the helper's: a second vocabulary, one copy away from diverging.
const PLANT_HARDCODED_LABEL = CLEAN_AFFORDANCE.replace(
  "      <button type=\"button\" disabled={view.actionDisabled} onClick={onAssign}>{view.actionLabel}</button>",
  "      <button type=\"button\" disabled={view.actionDisabled} onClick={onAssign}>{ack.phase === \"sent\" ? \"Sent\" : view.actionLabel}</button>",
);

// PLANT E — the success re-load is the NON-silent one: it flips the page into
// its loading state and unmounts the populated board.
const PLANT_NON_SILENT_RELOAD = CLEAN_AFFORDANCE.replace(
  "  const onAssigned = useCallback(() => void load(scope, { silent: true }), [load, scope]);",
  "  const onAssigned = useCallback(() => void load(scope), [load, scope]);",
);

// PLANT F — the component re-derives the row's state itself instead of
// delegating (F-38.06e's shape: a helper that production never calls).
const PLANT_REIMPLEMENTED_VIEW = CLEAN_AFFORDANCE.replace(
  "  const view = assignAffordanceView({ phase: ack.phase, error: ack.error, hasOptions: options.length > 0, selected: target });",
  "  const view = { pickerDisabled: options.length === 0, pickerPlaceholder: null, actionLabel: ack.phase, actionDisabled: false, message: ack.error, holdMs: null };",
);

// --- the behavioural fixture: TWO published workspaces ----------------------

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    '<!doctype html><html><head><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>\n',
    "utf8",
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
}

// A repo carrying milestone "18" — the SAME ref in every workspace, which is the
// collision that made F21 silent rather than merely broken.
//
// REVIEW FIX F-B — `nodeId` is per-repo, and the foreign workspace B declares a
// DIFFERENT one from the daemon's own A. `issuer` is a MACHINE-scoped fact that
// assignWork derives from the workspace OBJECT it is handed
// (`ctx.issuer ?? workspace.config?.mesh?.nodeId`), and after the AMENDMENT that
// object is the CLICKED CARD's workspace — so with one nodeId in every fixture
// repo, "the minted row's issuer is the control node's own nodeId" was true only
// by coincidence. Here the two values differ, so the assertion has teeth.
// `nodeId: null` writes a `mesh` block with NO identity at all — the machine
// that has never run `aof mesh identity`.
async function writeRepo(root, { name, slug, title, nodeId = "control-a" }) {
  const milestoneDir = path.join(root, "wiki", "work", `18_milestone_${slug}`);
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    milestoneDir + path.sep + "SPEC.md",
    `---\ntype: milestone\nnumber: 18\nslug: ${slug}\nstatus: in-progress\ntitle: ${title}\n---\n`,
    "utf8",
  );
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh: nodeId == null ? {} : { nodeId } }, null, 2)}\n`,
    "utf8",
  );
}

// The two identities the F-B clause turns on: the CONTROL machine (workspace A,
// this daemon's launch dir) and the id the FOREIGN workspace B's own checkout
// declares for itself.
const NODE_IDS = Object.freeze({ control: "control-a", foreign: "portal-legacy-node" });

// withTwoWorkspaceFleetFace(fn) — the REAL serveMeshUi bound to workspace A (the
// daemon's own launch dir), with workspace B (a DIFFERENT repo on the same
// machine) and workspace GONE (published, then deleted — the shape of a row
// another machine published into a synced projection) both live in the SAME
// global projection the face reads. Both A and B carry ref "18" and both have an
// eligible `worker-a`, so a mis-target mints a plausible 200 instead of erroring.
async function withTwoWorkspaceFleetFace(fn, { controlNodeId = NODE_IDS.control } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-fleet-assign-target-"));
  const home = path.join(tmp, "home");
  const rootA = path.join(tmp, "control-repo");
  const rootB = path.join(tmp, "foreign-repo");
  const rootGone = path.join(tmp, "vanished-repo");
  const distRoot = path.join(tmp, "dist");
  try {
    await writeRepo(rootA, { name: "control", slug: "integration-descriptor", title: "Per-folder integration descriptor", nodeId: controlNodeId });
    // B's checkout carries its OWN node identity — the legacy per-workspace
    // shape work.mjs still reads back (F-B).
    await writeRepo(rootB, { name: "portal", slug: "homedata-live", title: "Homedata Live Property Data", nodeId: NODE_IDS.foreign });
    await writeRepo(rootGone, { name: "elsewhere", slug: "published-by-another-machine", title: "Published Elsewhere" });
    await writeDist(meshUiDist(distRoot));

    const env = { AOF_GLOBAL_HOME: home };
    const globalStoreOptions = { env };
    const store = await openGlobalWorkProjectionStore(globalStoreOptions);
    try {
      for (const root of [rootA, rootB, rootGone]) {
        const workspace = await loadWorkspace(root, undefined, { env });
        await store.publishWorkspaceSnapshot(workspace, { now: "2026-07-24T12:00:00.000Z" });
      }
    } finally {
      store.close();
    }

    const workspaceIdA = workspaceIdFor(rootA);
    const workspaceIdB = workspaceIdFor(rootB);
    const workspaceIdGone = workspaceIdFor(rootGone);

    // `worker-a` is eligible for BOTH A and B — so a mis-targeted assign is NOT
    // caught incidentally by the repo-availability gate; it succeeds, which is
    // precisely what made F21 a silent wrong-work dispatch.
    await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId: workspaceIdA, member: true, published: true });
    await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId: workspaceIdB, member: true, published: true });

    // The vanished workspace's row survives its checkout (the synced-projection
    // shape); the path does not.
    await rm(rootGone, { recursive: true, force: true });

    const { server, url } = await serveMeshUi({ projectDir: rootA, port: 0, repoRoot: distRoot, scope: "global", globalStoreOptions });
    try {
      return await fn({ url, home, workspaceIdA, workspaceIdB, workspaceIdGone });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// A REAL same-origin application/json POST — the exact envelope a same-origin
// browser fetch sends (the route's SECURITY T13 admission guard).
function postAssign(url, payload) {
  return fetch(new URL("/api/mesh/assign", url), {
    method: "POST",
    headers: { origin: new URL(url).origin, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export const archTests = [
  // ══ the synthesized self-check — proves the detector, independent of the tree ══
  {
    name: "arch/38 ADR-012 AMENDMENT (self-check): the workspace-target detector is quiet on the corrected shape and trips on every F21-class plant",
    async run() {
      assert.deepEqual(
        targetResolutionProblems(CLEAN),
        [],
        "the hand-written CORRECTED assign branch (required workspaceId, queryGlobalMeshStatus resolution, locality check, pre-mint identity assertion) stays quiet",
      );

      const plants = [
        ["the F21 defect verbatim ({ ref, nodeId } only, loadWorkspace(resolvedProjectDir))", PLANT_F21],
        ["an absent workspaceId silently falling back to the daemon's own workspace", PLANT_FALLBACK],
        ["a route that resolves carefully but never ASSERTS the mint's target", PLANT_NO_ASSERTION],
        ["an identity assertion made AFTER the mint (a mis-dispatch already committed)", PLANT_ASSERT_AFTER_MINT],
        ["no locality check — a foreign machine's project_root walks into loadWorkspace", PLANT_NO_LOCALITY_CHECK],
      ];
      for (const [label, planted] of plants) {
        assert.notEqual(planted, CLEAN, `the plant (${label}) actually differs from the clean synthesized shape`);
        // the plant must still be an EXTRACTABLE assign branch — otherwise it
        // would "trip" only because the detector found nothing (a vacuous trip).
        assert.deepEqual(extractionProblems(assignBranch(normalise(planted))), [], `the plant (${label}) is still a real, extractable assign branch`);
        assert.ok(targetResolutionProblems(planted).length > 0, `self-check: ${label} trips the detector`);
      }
    },
  },

  // ══ inv.5 + inv.6 — the REAL source ══
  {
    name: "arch/38 ADR-012 AMENDMENT inv.5/6: mesh-ui-serve.mjs's assign branch resolves the ITEM's own workspace — required workspaceId, sanctioned seam, locality + identity refusals, never the server's own project dir",
    async run() {
      const source = await readFile(MESH_UI_SERVE, "utf8");
      const problems = targetResolutionProblems(source);
      assert.deepEqual(
        problems,
        [],
        `POST /api/mesh/assign must target the item's OWN workspace (ADR-012 AMENDMENT 2026-07-24, BLOCKER F21):\n  - ${problems.join("\n  - ")}`,
      );
    },
  },

  // ══ the THIRD structural clause (F-D) — one cadence, one hold, one source ══
  {
    name: "arch/38 (self-check): the affordance-cadence detector is quiet on the corrected component shape and trips on every drift-class plant",
    async run() {
      assert.deepEqual(
        affordanceCadenceProblems(CLEAN_AFFORDANCE),
        [],
        "the hand-written CORRECTED component (POLL_MS imported once, the poll scheduled from it, the decay scheduled from the view's holdMs, every label the helper's) stays quiet",
      );

      const plants = [
        ["the decay scheduled from a millisecond literal of the component's own", PLANT_LITERAL_HOLD],
        ["a SECOND POLL_MS declared in the component", PLANT_SECOND_POLL_CONST],
        ["the poll cadence unpinned — a literal in place of POLL_MS", PLANT_LITERAL_CADENCE],
        ["the acknowledgment's label hard-coded in the component", PLANT_HARDCODED_LABEL],
        ["the success re-load switched to the page-unmounting non-silent load", PLANT_NON_SILENT_RELOAD],
        ["the component re-deriving the row's state instead of delegating to the helper", PLANT_REIMPLEMENTED_VIEW],
      ];
      for (const [label, planted] of plants) {
        assert.notEqual(planted, CLEAN_AFFORDANCE, `the plant (${label}) actually differs from the clean synthesized shape`);
        const problems = affordanceCadenceProblems(planted);
        assert.ok(problems.length > 0, `self-check: ${label} trips the detector`);
        // …and it trips for a REASON, not because the extraction failed.
        assert.deepEqual(
          problems.filter((problem) => problem.includes("vacuous pass")),
          [],
          `the plant (${label}) is still an extractable AssignAffordance — it must trip on the defect, never on a failed extraction`,
        );
      }
    },
  },

  {
    name: "arch/38 F22 structural: Fleet.tsx's assign affordance keeps ONE source for every fact it renders — POLL_MS is one number the poll AND the hold are scheduled from, and the component delegates to the helper rather than re-deriving the states",
    async run() {
      const source = await readFile(FLEET_TSX, "utf8");
      const problems = affordanceCadenceProblems(source);
      assert.deepEqual(
        problems,
        [],
        `the fleet assign affordance must keep one source per rendered fact (F22; REVIEW FIX F-D — moved here from story-04 task 06 acceptance):\n  - ${problems.join("\n  - ")}`,
      );
    },
  },

  // ══ behavioural (F-B) — the issuer is the CONTROL's, not the target's ══
  {
    name: "arch/38 ADR-012 AMENDMENT (behavioural, F-B): the minted `issuer` is the CONTROL node's own machine identity — never the TARGET workspace's, even when that workspace's config names a different node",
    async run() {
      await withTwoWorkspaceFleetFace(async ({ url, home, workspaceIdB }) => {
        const response = await postAssign(url, { ref: "18", nodeId: "worker-a", workspaceId: workspaceIdB });
        const body = await response.json();
        assert.equal(response.status, 200, `assigning the FOREIGN workspace's card succeeds — got ${response.status} ${JSON.stringify(body)}`);

        const rows = await readAssignmentRows({ home }, workspaceIdB, "18");
        assert.equal(rows.length, 1, "exactly one record minted");
        assert.equal(
          rows[0].issuer,
          NODE_IDS.control,
          "the directive is issued BY this control node — the machine that actually ran the verb",
        );
        assert.notEqual(
          rows[0].issuer,
          NODE_IDS.foreign,
          "…and NEVER the target workspace's own configured node id: `issuer` is a MACHINE-scoped fact, but after the AMENDMENT the workspace object handed to the verb is the CLICKED CARD's, so an issuer left to fall out of it stamps the wrong machine on a load-bearing field (a directive whose issuer is revoked never routes)",
        );
      });
    },
  },

  {
    name: "arch/38 ADR-012 AMENDMENT (behavioural, F-B): a control node with NO mesh identity refuses BY NAME — control-identity-unknown, never an uncoded 500 out of a NOT NULL column",
    async run() {
      await withTwoWorkspaceFleetFace(async ({ url, home, workspaceIdA, workspaceIdB }) => {
        const response = await postAssign(url, { ref: "18", nodeId: "worker-a", workspaceId: workspaceIdB });
        const body = await response.json();
        assert.notEqual(
          response.status,
          500,
          `a legitimately-clickable card must not produce an uncoded 500 — every other failure on this path names its own cause. Got ${JSON.stringify(body)}`,
        );
        assert.equal(response.status, 409, `an identity-less control refuses 409 — got ${response.status} ${JSON.stringify(body)}`);
        assert.equal(body.code, "control-identity-unknown");
        assert.equal((await readAssignmentRows({ home }, workspaceIdB, "18")).length, 0, "the refusal mints nothing");
        assert.equal((await readAssignmentRows({ home }, workspaceIdA, "18")).length, 0, "…and nothing in the daemon's own workspace either");
      }, { controlNodeId: null });
    },
  },

  // ══ behavioural — the F21 regression, in the two-workspace configuration ══
  {
    name: "arch/38 ADR-012 AMENDMENT (behavioural): the REAL fleet face mints against the ITEM's workspace — a card from a NON-server workspace never mints in the server's own",
    async run() {
      await withTwoWorkspaceFleetFace(async ({ url, home, workspaceIdA, workspaceIdB }) => {
        const response = await postAssign(url, { ref: "18", nodeId: "worker-a", workspaceId: workspaceIdB });
        const body = await response.json();
        assert.equal(response.status, 200, `assigning ref 18 in the FOREIGN workspace must succeed — got ${response.status} ${JSON.stringify(body)}`);

        const inB = await readAssignmentRows({ home }, workspaceIdB, "18");
        const inA = await readAssignmentRows({ home }, workspaceIdA, "18");
        assert.equal(inB.length, 1, "the assignment is minted in the workspace the operator clicked");
        assert.equal(
          inA.length,
          0,
          "F21: nothing may be minted in the SERVER's own workspace — a colliding ref there is a completely different milestone, dispatched off a correct-looking 200",
        );
        assert.equal(body.workspaceId, workspaceIdB, "the minted record carries the REQUESTED workspaceId");
      });
    },
  },

  {
    name: "arch/38 ADR-012 AMENDMENT (behavioural): a POST with NO workspaceId is a coded 400 refusal that mints NOWHERE — never a fallback to the server's own workspace",
    async run() {
      await withTwoWorkspaceFleetFace(async ({ url, home, workspaceIdA, workspaceIdB }) => {
        const response = await postAssign(url, { ref: "18", nodeId: "worker-a" });
        assert.notEqual(response.status, 200, "an assign with no workspaceId is never a 200");
        const body = await response.json();
        assert.equal(response.status, 400, `a missing workspaceId is a 400 — got ${response.status} ${JSON.stringify(body)}`);
        assert.equal(body.code, "invalid-workspace");
        assert.notEqual(body.ok, true);

        assert.equal((await readAssignmentRows({ home }, workspaceIdA, "18")).length, 0, "a workspaceId-less assign mints nothing in the server's own workspace (the fallback IS the defect)");
        assert.equal((await readAssignmentRows({ home }, workspaceIdB, "18")).length, 0, "a workspaceId-less assign mints nothing anywhere");
      });
    },
  },

  {
    name: "arch/38 ADR-012 AMENDMENT (behavioural): an unknown workspaceId is workspace-not-found; one whose project root is absent on THIS machine is workspace-not-local — each loud, each minting nothing",
    async run() {
      await withTwoWorkspaceFleetFace(async ({ url, home, workspaceIdA, workspaceIdGone }) => {
        const unknown = await postAssign(url, { ref: "18", nodeId: "worker-a", workspaceId: "0000000000000000" });
        const unknownBody = await unknown.json();
        assert.equal(unknown.status, 404, `an unknown workspaceId is a 404 — got ${unknown.status} ${JSON.stringify(unknownBody)}`);
        assert.equal(unknownBody.code, "workspace-not-found");

        const gone = await postAssign(url, { ref: "18", nodeId: "worker-a", workspaceId: workspaceIdGone });
        const goneBody = await gone.json();
        assert.notEqual(
          goneBody.code,
          "ref-not-found",
          "a project root that is not on THIS machine must name its OWN cause — not a degraded loadWorkspace's misleading ref-not-found",
        );
        assert.equal(gone.status, 409, `a project root absent on this machine is a 409 — got ${gone.status} ${JSON.stringify(goneBody)}`);
        assert.equal(goneBody.code, "workspace-not-local");

        assert.equal((await readAssignmentRows({ home }, workspaceIdA, "18")).length, 0, "neither refusal mints in the server's own workspace");
      });
    },
  },
];
