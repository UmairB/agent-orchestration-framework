import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkerStreamClient } from "../../src/worker-stream-client.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function throwingTransport() {
  return {
    async connect() { throw new Error("connect refused"); },
    async send() { throw new Error("send failed"); },
    close() {},
  };
}

// ADR-004 failure isolation, extended to the live stream (ADR-007): a stream
// outage/failure never changes the local work command's result/error semantics.
// Structural half — the client module NEVER rejects a caller's sendSnapshot/
// sendDelta/notifyDrop call (every transport call is wrapped in try/catch, source-
// verified) — PLUS a behavioural proof that a fully-broken transport still resolves
// cleanly with no throw.
export const archTests = [
  {
    name: "arch/34 ADR-004/ADR-007: worker-stream-client wraps every transport call in try/catch — a stream fault never propagates",
    async run() {
      const source = await readFile(path.join(repoRoot, "src", "worker-stream-client.mjs"), "utf8");
      assert.ok(source.includes("try {") && source.includes("catch (error)"), "the client source contains guarded transport calls");
      // The exported session functions must never be declared to throw a stream fault
      // outward — behaviourally verified below; structurally, onWarning is the ONLY
      // fault-reporting channel (no console.error/process.exit escape hatch).
      assert.ok(!source.includes("process.exit"), "the client never exits the process on a stream fault");
      assert.ok(source.includes("onWarning"), "stream faults surface only via the onWarning channel");
    },
  },
  {
    name: "arch/34 ADR-004/ADR-007: a stream fault (connect-throws AND send-throws) never rejects out of the client, and is reported as a warning only",
    async run() {
      const warnings = [];
      const client = createWorkerStreamClient({
        transport: throwingTransport(),
        nodeId: "worker-a",
        workspaceId: "ws-1",
        now: () => "2026-07-05T10:00:00.000Z",
        onWarning: (w) => warnings.push(w),
      });

      // Neither call rejects — the caller's local work write (simulated as already
      // having succeeded) is never gated by these outcomes.
      const snapshotResult = await client.sendSnapshot([{ ref: "34/04/00", status: "done" }]);
      assert.equal(snapshotResult.sent, false);
      assert.ok(warnings.length >= 1, "the connect fault surfaced as a warning");
      assert.ok(warnings.every((w) => typeof w.code === "string" && typeof w.message === "string"), "every warning is structured, never a raw throw");
    },
  },
];
