// Security fitness: acd-revoked-issuer-directive-never-executes (milestone 35 /
// SECURITY T2, F2) — "A directive whose `issuer` is in the live registry
// `revocations` never routes to execution."
//
// Proofs (clone of acd-issuance-revoked-issuer-filtered):
//  1. Structural — the dispatch consumer that routes a directive MUST couple an
//     isRevoked(...) / revocation-list read to the directive `issuer`, called PER
//     DECISION (never a serve-start snapshot — the accessor is invoked fresh, not
//     cached at server-start).
//  2. Behavioural — a revoked issuer's directive never routes (over the injected
//     bidirectional fake channel + an injected live registry); a non-revoked
//     issuer's does; the filter fails safe (absent/empty registry never blocks).
//  3. Self-check (m03 non-vacuous) — the detector FIRES on a revocation-blind
//     dispatch consumer and stays quiet on the checking form; a definition-only
//     substrate (isRevoked merely imported, never called) is not a "consumer".
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchDirectiveOverTargets, buildDirectiveFrame } from "../../src/control-stream-server.mjs";
import { createDirectiveChannelFixture } from "../support/mesh-directive-channel-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");
const NOW = "2026-07-09T10:00:00.000Z";

// detectRevocationCoupledDispatch(source) — the dispatch consumer function must (a)
// call an isRevoked-shaped predicate somewhere in its body — either the imported
// mesh-registry.mjs `isRevoked` OR a local re-implementation of it (this codebase's
// actual shape: control-stream-server.mjs deliberately does NOT import
// mesh-registry.mjs at all, 34/ADR-007's "no credential/enrollment gate" boundary —
// see acd-control-stream-tailnet-only — so it carries a local `isRevokedLocal`
// predicate of the SAME two-line shape instead), coupled to (b) the directive's
// issuer field. A definition/import alone (the predicate never actually CALLED
// inside the dispatch function) does not satisfy this.
function extractFunctionBody(source, name) {
  const anchor = source.indexOf(`function ${name}(`);
  if (anchor < 0) return null;
  // Scan PAST the parameter list (brace-and-paren balanced — a destructured
  // default param can itself contain `{ }` and `( )`, e.g.
  // `{ getMeshRegistry = () => null } = {}`) to find the function BODY's own
  // opening brace, not a brace nested inside the parameter list.
  const paramListStart = source.indexOf("(", anchor);
  let parenDepth = 0;
  let paramListEnd = paramListStart;
  for (let i = paramListStart; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    if (source[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { paramListEnd = i; break; }
    }
  }
  const braceStart = source.indexOf("{", paramListEnd);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(anchor, i + 1);
    }
  }
  return null;
}

function detectRevocationCoupledDispatch(source) {
  const body = extractFunctionBody(source, "dispatchDirectiveOverTargets");
  if (!body) return false;
  const callsIsRevoked = /isRevoked\w*\s*\(/.test(body); // matches isRevoked(...) or isRevokedLocal(...)
  const readsIssuer = /directive\??\.issuer/.test(body);
  const livePerDecision = /getMeshRegistry\s*\(\s*\)/.test(body); // called fresh, not a captured/cached var
  return callsIsRevoked && readsIssuer && livePerDecision;
}

export const archTests = [
  {
    name: "arch/35 SECURITY T2 (acd-revoked-issuer-directive-never-executes): the dispatch consumer couples a LIVE isRevoked(...) read (called per-decision) to the directive's issuer (structural)",
    run: async () => {
      const source = await readFile(sourcePath, "utf8");
      assert.equal(detectRevocationCoupledDispatch(source), true, "dispatchDirectiveOverTargets calls isRevoked(getMeshRegistry(), directive.issuer) — live, coupled, per-decision");
    },
  },
  {
    name: "arch/35 SECURITY T2 (acd-revoked-issuer-directive-never-executes): a revoked issuer's directive never routes; a non-revoked issuer's does (behavioural)",
    run: async () => {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");

      const revoked = dispatchDirectiveOverTargets(channel.targets, { ...buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }), issuer: "node-a" }, { getMeshRegistry: () => ({ revocations: [{ nodeId: "node-a" }] }) });
      assert.equal(revoked.sent, false, "a revoked issuer's directive never routes");
      assert.equal(workerA.frames.length, 0);

      const clean = dispatchDirectiveOverTargets(channel.targets, { ...buildDirectiveFrame("worker-a", { assignmentId: "asg-2", itemRef: "35/01", workspaceId: "ws-1", at: NOW }), issuer: "node-b" }, { getMeshRegistry: () => ({ revocations: [{ nodeId: "node-a" }] }) });
      assert.equal(clean.sent, true, "a non-revoked issuer's directive routes normally");
      assert.equal(workerA.frames.length, 1);
    },
  },
  {
    name: "arch/35 SECURITY T2 (acd-revoked-issuer-directive-never-executes): fail-safe — an absent/empty registry never blocks routing",
    run: async () => {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const withAbsent = dispatchDirectiveOverTargets(channel.targets, { ...buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }), issuer: "node-a" }, { getMeshRegistry: () => null });
      assert.equal(withAbsent.sent, true, "an absent registry never blocks routing");
      const withEmpty = dispatchDirectiveOverTargets(channel.targets, { ...buildDirectiveFrame("worker-a", { assignmentId: "asg-2", itemRef: "35/01", workspaceId: "ws-1", at: NOW }), issuer: "node-a" }, { getMeshRegistry: () => ({ revocations: [] }) });
      assert.equal(withEmpty.sent, true, "an empty revocations list never blocks routing");
    },
  },
  {
    name: "arch/35 SECURITY T2 (acd-revoked-issuer-directive-never-executes): live re-read — a node revoked AFTER an earlier directive routed is filtered on the very next directive (behavioural)",
    run: async () => {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      let liveRegistry = { revocations: [] };
      const getMeshRegistry = () => liveRegistry;

      const first = dispatchDirectiveOverTargets(channel.targets, { ...buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }), issuer: "node-a" }, { getMeshRegistry });
      assert.equal(first.sent, true);

      liveRegistry = { revocations: [{ nodeId: "node-a" }] };
      const second = dispatchDirectiveOverTargets(channel.targets, { ...buildDirectiveFrame("worker-a", { assignmentId: "asg-2", itemRef: "35/01", workspaceId: "ws-1", at: NOW }), issuer: "node-a" }, { getMeshRegistry });
      assert.equal(second.sent, false, "filtered on the very next directive — never a stale snapshot");
    },
  },
  {
    name: "arch/35 SECURITY T2 (acd-revoked-issuer-directive-never-executes): self-check — the detector FIRES on a revocation-blind dispatch consumer and stays quiet on the checking form; a definition-only substrate is not a consumer",
    run: async () => {
      const blindConsumer = `
export function dispatchDirectiveOverTargets(targets, directive, { getMeshRegistry = () => null } = {}) {
  return sendDirective(targets, directive?.to, directive);
}
`;
      assert.equal(detectRevocationCoupledDispatch(blindConsumer), false, "a revocation-blind dispatch consumer trips the detector (fails the coupling check)");

      const definitionOnly = `
import { isRevoked } from "./mesh-registry.mjs";
export function dispatchDirectiveOverTargets(targets, directive, { getMeshRegistry = () => null } = {}) {
  // isRevoked is imported but never CALLED here — a definition-only substrate.
  return sendDirective(targets, directive?.to, directive);
}
`;
      assert.equal(detectRevocationCoupledDispatch(definitionOnly), false, "a definition-only substrate (isRevoked imported, never called) is not a consumer");

      const checkingForm = `
export function dispatchDirectiveOverTargets(targets, directive, { getMeshRegistry = () => null } = {}) {
  if (directive?.issuer != null && isRevoked(getMeshRegistry(), directive.issuer)) {
    return { sent: false, code: "assignment-issuer-revoked" };
  }
  return sendDirective(targets, directive?.to, directive);
}
`;
      assert.equal(detectRevocationCoupledDispatch(checkingForm), true, "the real checking form (live-read, coupled to issuer) passes");
    },
  },
];
