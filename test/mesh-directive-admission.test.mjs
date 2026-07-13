// Traceability wiring for milestone 35 / story 01 — task 01
// (tasks/01_directive-admission.feature). Covers every @executable scenario /
// Scenario Outline row:
//   - a directive is honored only over an admitted tailnet-peer connection
//     (Scenario Outline, 2 rows: tailnet peer / non-peer host)
//   - a revoked issuer's directive never routes; a non-revoked issuer's does
//     (Scenario Outline, 3 rows)
//   - a node revoked after issuing is filtered on the next directive it sends
//     (LIVE re-read)
//   - an absent registry leaves an admitted issuer's directive routing normally
//     (fail-safe)
//
// Driven over dispatchDirectiveOverTargets — the composed T5+T2 entry point — with
// the INJECTED bidirectional fake channel (test/support/
// mesh-directive-channel-fixture.mjs) standing in for the targeting map (populated
// ONLY post-admission, exactly as wss.on("connection") does) and an injected
// getMeshRegistry() closure standing in for the LIVE mesh registry (SECURITY T2's
// per-decision re-read, mirroring mesh-registry.mjs's own live re-read discipline).
// No live tailnet — the real non-peer dial being refused is the milestone's @manual
// soak (story 02).
import assert from "node:assert/strict";
import {
  dispatchDirectiveOverTargets,
  buildDirectiveFrame,
} from "../src/control-stream-server.mjs";
import { createDirectiveChannelFixture } from "./support/mesh-directive-channel-fixture.mjs";

const NOW = "2026-07-09T10:00:00.000Z";

function directiveFor(to, issuer) {
  return { ...buildDirectiveFrame(to, { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }), issuer };
}

export const meshDirectiveAdmissionTests = [
  {
    name: "directive-admission/01 a directive is honored only over an admitted tailnet-peer connection — a tailnet peer: accepted",
    run() {
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a"); // ONLY an admitted connection ever populates the targeting map
      const result = dispatchDirectiveOverTargets(channel.targets, directiveFor("worker-a", "control-a"), { getMeshRegistry: () => null });
      assert.equal(result.sent, true, "a directive over an admitted, live tailnet-peer connection is accepted");
    },
  },
  {
    name: "directive-admission/01 a directive is honored only over an admitted tailnet-peer connection — a non-peer host: refused, no dispatch acted on",
    run() {
      const channel = createDirectiveChannelFixture();
      // "worker-b" never connects (never admitted) — its entry in the targeting
      // map simply does not exist, exactly as a non-peer's socket is destroyed
      // before wss.on("connection") ever runs.
      const result = dispatchDirectiveOverTargets(channel.targets, directiveFor("worker-b", "control-a"), { getMeshRegistry: () => null });
      assert.equal(result.sent, false, "a non-peer connection's directive is refused");
      assert.ok(typeof result.code === "string" && result.code.length > 0, "the refusal is coded, never silent");
    },
  },
  {
    name: "directive-admission/01 a revoked issuer's directive never routes; a non-revoked issuer's does — node-a revoked: never routes",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const registry = { revocations: [{ nodeId: "node-a" }] };
      const result = dispatchDirectiveOverTargets(channel.targets, directiveFor("worker-a", "node-a"), { getMeshRegistry: () => registry });
      assert.equal(result.sent, false, "a revoked issuer's directive never routes");
      assert.equal(workerA.frames.length, 0, "no frame reaches the target socket");
    },
  },
  {
    name: "directive-admission/01 a revoked issuer's directive never routes; a non-revoked issuer's does — revocations empty: routes normally",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const registry = { revocations: [] };
      const result = dispatchDirectiveOverTargets(channel.targets, directiveFor("worker-a", "node-a"), { getMeshRegistry: () => registry });
      assert.equal(result.sent, true, "an admitted, non-revoked issuer's directive routes normally");
      assert.equal(workerA.frames.length, 1);
    },
  },
  {
    name: "directive-admission/01 a revoked issuer's directive never routes; a non-revoked issuer's does — node-b revoked, issuer node-a: routes normally",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const registry = { revocations: [{ nodeId: "node-b" }] };
      const result = dispatchDirectiveOverTargets(channel.targets, directiveFor("worker-a", "node-a"), { getMeshRegistry: () => registry });
      assert.equal(result.sent, true, "an admitted, non-revoked issuer (node-a) routes even while a DIFFERENT issuer (node-b) is revoked");
      assert.equal(workerA.frames.length, 1);
    },
  },
  {
    name: "directive-admission/01 a node revoked after issuing is filtered on the next directive it sends (LIVE re-read)",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      let liveRegistry = { revocations: [] };
      const getMeshRegistry = () => liveRegistry; // re-read PER DECISION, never cached

      const first = dispatchDirectiveOverTargets(channel.targets, directiveFor("worker-a", "node-a"), { getMeshRegistry });
      assert.equal(first.sent, true, "node-a's earlier directive routed normally");
      assert.equal(workerA.frames.length, 1);

      // node-a is added to the LIVE registry revocations AFTER it issued.
      liveRegistry = { revocations: [{ nodeId: "node-a" }] };
      const second = dispatchDirectiveOverTargets(channel.targets, directiveFor("worker-a", "node-a"), { getMeshRegistry });
      assert.equal(second.sent, false, "the very next directive from the now-revoked issuer never routes");
      assert.equal(workerA.frames.length, 1, "no NEW frame was written for the filtered directive");
    },
  },
  {
    name: "directive-admission/01 an absent registry leaves an admitted issuer's directive routing normally (fail-safe)",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const result = dispatchDirectiveOverTargets(channel.targets, directiveFor("worker-a", "node-a"), { getMeshRegistry: () => null });
      assert.equal(result.sent, true, "no registry present -> the directive routes exactly as if no revocations existed");
      assert.equal(workerA.frames.length, 1);
    },
  },
];
