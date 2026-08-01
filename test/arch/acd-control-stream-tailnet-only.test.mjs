import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTailnetPeer } from "../../src/control-stream-server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ============================ AMENDED 2026-07-27 (the `direct` fabric cutover) =======
// ADR-007 / 33-ADR-002 originally read: "the control-node stream server admits ONLY
// tailnet peers — the FABRIC is the admission boundary, no token/device-code gate
// resurrected from mesh-registry.mjs."
//
// That premise does not survive a fabric with no overlay. On `direct` (mesh-fabric.mjs)
// there IS no peer table to be a member of, so "is this address a fabric peer" cannot
// answer "who is this connection". Identity moves to the ENROLLMENT CREDENTIAL — which
// is strictly stronger per-node than an address (an IP is spoofable on a shared LAN; a
// per-node issued secret verified in constant time against the live revocation list is
// not), and which enrollment already issues on EVERY fabric.
//
// What SURVIVES unchanged, and is still asserted below, is the MODULE BOUNDARY: the
// credential/roster/enrollment surface is heavier than the server's gate warrants, so
// control-stream-server.mjs still must not import it. The resolver is built by
// mesh-launcher.mjs (which already owns config + the workspace handle) and handed down
// through the server's pre-existing injectable `resolveOrigin` seam. The server stays
// generic about WHERE identity comes from; that is why this cutover needed no new seam.
//
// Redaction (ADR-005) is untouched: it still runs BEFORE any streamed field enters the
// global store.
export const archTests = [
  {
    name: "arch/34 ADR-007 (amended): control-stream-server stays generic — it never imports the credential/enrollment surface itself",
    async run() {
      const raw = await readFile(path.join(repoRoot, "src", "control-stream-server.mjs"), "utf8");
      const codeOnly = raw.replace(/\/\/[^\n]*/g, "");
      assert.ok(!/from\s+["']\.\/mesh-registry\.mjs["']/.test(codeOnly), "control-stream-server.mjs does not import the credential/enrollment registry — the resolver is INJECTED, not imported");
      assert.ok(!/\bverifyCredential\s*\(/.test(codeOnly), "the server never verifies a credential itself — it consumes an already-resolved origin");
      assert.ok(!/\brelayAuth\b/.test(codeOnly), "the relay-auth credential concept stays out of this module");
      assert.ok(raw.includes("isTailnetPeer"), "the address-join gate remains for the tailscale fabric");
      assert.ok(raw.includes("authoritative"), "the resolveOrigin contract carries the `authoritative` discriminator a credential resolver sets");
    },
  },
  {
    name: "arch/34 ADR-007 (amended): the credential resolver is wired at the PRODUCTION call site, not only through a test seam",
    async run() {
      const launcher = await readFile(path.join(repoRoot, "src", "mesh-launcher.mjs"), "utf8");
      // The F12/F-38.05 discipline: a provider reachable ONLY through the
      // controlStreamServerOptions test spread would be production-dead. The literal
      // key must appear, and must precede that spread.
      const literalAt = launcher.indexOf("resolveOrigin: createCredentialOriginResolver");
      assert.ok(literalAt > -1, "mesh-launcher.mjs wires resolveOrigin as a LITERAL key at the production startServer call");
      const spreadAt = launcher.indexOf("...(options?.controlStreamServerOptions");
      if (spreadAt > -1) {
        assert.ok(literalAt < spreadAt, "the literal resolveOrigin precedes the test-injection spread, so a test may still override it but production can never be credential-less");
      }
      // …and the worker must actually present one, or admission could never succeed.
      const worker = await readFile(path.join(repoRoot, "src", "worker-stream-client.mjs"), "utf8");
      assert.ok(/Authorization/.test(worker), "the worker transport presents its credential on the ws upgrade");
    },
  },
  {
    name: "arch/34 ADR-007 (amended): a credential-resolved origin is fail-closed — a failed verification is a REFUSAL, never a fall-through to the address join",
    async run() {
      const raw = await readFile(path.join(repoRoot, "src", "control-stream-server.mjs"), "utf8");
      // An authoritative resolver returning a null nodeId must be refused. If the gate
      // ever fell back to isTailnetPeer on a failed credential, an un-credentialed peer
      // could be admitted purely by virtue of its IP — the hole this cutover closes.
      const gate = raw.slice(raw.indexOf('server.on("upgrade"'), raw.indexOf("wss.handleUpgrade"));
      assert.ok(/authoritative\s*===\s*true/.test(gate), "the gate branches on the authoritative discriminator");
      assert.ok(/nodeId\s*===\s*["']string["']/.test(gate) || /typeof\s+origin\.nodeId/.test(gate), "an authoritative origin is admitted only when it carries a non-empty nodeId");
      assert.ok(/socket\.destroy\(\)/.test(gate), "a refused connection is destroyed at the gate, before any ws is emitted");
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
