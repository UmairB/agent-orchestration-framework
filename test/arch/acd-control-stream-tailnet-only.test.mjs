import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTailnetPeer } from "../../src/control-stream-server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ADR-007 / 33-ADR-002: the control-node stream server admits ONLY tailnet peers
// (the fabric IS the admission boundary — no token/device-code gate resurrected from
// mesh-registry.mjs), and redaction (ADR-005) runs BEFORE any streamed field enters
// the global store.
export const archTests = [
  {
    name: "arch/34 ADR-007/33-ADR-002: control-stream-server never imports the credential/enrollment gate",
    async run() {
      const raw = await readFile(path.join(repoRoot, "src", "control-stream-server.mjs"), "utf8");
      const codeOnly = raw.replace(/\/\/[^\n]*/g, "");
      assert.ok(!/from\s+["']\.\/mesh-registry\.mjs["']/.test(codeOnly), "control-stream-server.mjs does not import the parked credential/enrollment registry");
      assert.ok(!/\bverifyCredential\s*\(/.test(codeOnly), "no token/device-code verification is resurrected here");
      assert.ok(!/\brelayAuth\b/.test(codeOnly), "no relay-auth credential concept is reintroduced");
      assert.ok(raw.includes("isTailnetPeer"), "admission routes through the tailnet-peer predicate");
    },
  },
  {
    name: "arch/34 ADR-005: control-stream-server redacts BEFORE any store-apply call, on both the snapshot and delta paths",
    async run() {
      const source = await readFile(path.join(repoRoot, "src", "control-stream-server.mjs"), "utf8");
      assert.ok(source.includes("redactDescriptor"), "control-stream-server.mjs imports the shared redaction seam (global-node-registry.mjs)");
      assert.ok(source.includes("global-node-registry.mjs"), "redaction is the ONE shared seam, not a re-implementation");

      // Structural ordering check: within applySnapshotFrame/applyDeltaFrame, the
      // redactDescriptor() call must textually precede the publishWorkspaceSnapshot()
      // call that writes to the store.
      const snapshotFn = source.slice(source.indexOf("export async function applySnapshotFrame"), source.indexOf("export async function applyDeltaFrame"));
      assert.ok(snapshotFn.indexOf("redactDescriptor") < snapshotFn.indexOf("publishWorkspaceSnapshot"), "applySnapshotFrame redacts before the store write");

      const deltaFn = source.slice(source.indexOf("export async function applyDeltaFrame"), source.indexOf("export async function applyStreamFrame"));
      assert.ok(deltaFn.indexOf("redactDescriptor") < deltaFn.indexOf("publishWorkspaceSnapshot"), "applyDeltaFrame redacts before the store write");
    },
  },
  {
    name: "arch/34 ADR-007: isTailnetPeer is fail-closed — an unresolved origin is never admitted",
    run() {
      assert.equal(isTailnetPeer({ nodeId: null }, { peerNodeIds: new Set(["worker-a"]) }), false);
      assert.equal(isTailnetPeer(undefined, { peerNodeIds: new Set(["worker-a"]) }), false);
      assert.equal(isTailnetPeer({ nodeId: "worker-a" }, { peerNodeIds: new Set() }), false, "an empty roster admits no one");
    },
  },
  {
    name: "arch/34 ADR-005: a secret-shaped field is stripped by the apply path's redaction (behavioural cross-check)",
    async run() {
      // The full DB round trip (an applied frame's secret field never landing in the
      // store) is covered functionally by control-stream-server.test.mjs; this unit
      // cross-checks the redaction primitive itself against a representative
      // secret-shaped item, the same seam applySnapshotFrame/applyDeltaFrame call.
      const { redactDescriptor } = await import("../../src/global-node-registry.mjs");
      const redacted = redactDescriptor([{ ref: "34/04/00", relayAuthToken: "top-secret" }]);
      assert.equal("relayAuthToken" in redacted[0], false);
    },
  },
];
