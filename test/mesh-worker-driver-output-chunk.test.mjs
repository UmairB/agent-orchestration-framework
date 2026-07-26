// test/mesh-worker-driver-output-chunk.test.mjs — traceability for milestone 38 /
// story 06 (ADR-014 AMENDMENT 2026-07-19). The FIRST producer link of the
// cross-machine terminal stream: the REAL interactive driver's
// `term.onData -> options.onOutputChunk(chunk, capturedSessionId)` seam
// (mesh-worker-execution.mjs:1002-1017), which the launcher wires to
// `client.sendTerminalFrame`. Previously asserted only STRUCTURALLY
// (acd-terminal-stream-transport-wired names the literal key); this drives the SHIPPED
// producer end-to-end from a REAL PTY output stream.
//
// PRODUCER-FED + broad-blast-safe (the milestone's hard rules): driven over the REAL
// driveInteractiveClaudeSession against a scripted node-pty double (createScriptedPty)
// and a stubbed `which` — NEVER a real `claude`/node-pty/PTY (a real `claude` on PATH
// would hang forever). The transcript-dir watch is an INJECTED gate a test resolves on
// demand, so the "an early chunk carries a null session, a later chunk carries the
// captured id" mid-stream-capture behaviour (ADR-013 amendment / ADR-014 invariant 4:
// an unresolvable frame is dropped downstream, never delivered to the wrong card) is
// exercised deterministically.
import assert from "node:assert/strict";
import { driveInteractiveClaudeSession } from "../src/mesh-worker-execution.mjs";
import { createFakeWhich, createScriptedPty } from "./support/mesh-worker-terminal-fixture.mjs";

const sleep = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(predicate, { timeoutMs = 1500, label = "condition" } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = predicate(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`waitFor(${label}) timeout`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

export const meshWorkerDriverOutputChunkTests = [
  {
    name: "38-06/ADR-014 the REAL driver forwards EACH term.onData chunk to onOutputChunk(chunk, capturedSessionId) — an early pre-capture chunk carries a NULL session, a later chunk carries the watch-resolved id, byte-for-byte from the PTY",
    async run() {
      const chunks = [];
      const which = createFakeWhich(["claude"]);

      // Capture the scripted PTY's emit-control the first time the driver types its
      // command into the PTY (createScriptedPty calls onWrite synchronously inside
      // term.write), so this test can emit OUTPUT bytes at will, decoupled from the
      // driver's own internal awaits.
      let emit = null;
      const ptySpawn = async () => createScriptedPty({ onWrite: (ctrl) => { emit = ctrl; } });

      // The transcript-dir watch is an INJECTED gate — it stays UNRESOLVED until this
      // test resolves it, so an early chunk observes capturedSessionId === null and a
      // later chunk (after resolution) observes the captured id.
      let resolveWatch;
      const watchGate = new Promise((res) => { resolveWatch = res; });

      const driverPromise = driveInteractiveClaudeSession(
        { itemRef: "38/06", worktreeCwd: "/tmp/wt-output-chunk", task: "demo", command: "/aof:refine 38/06 --autonomous" },
        {
          ptySpawn,
          which,
          watchTranscriptSessionId: () => watchGate,
          onOutputChunk: (chunk, sessionId) => chunks.push({ chunk, sessionId }),
        },
      );

      try {
        // The driver has registered onData/onExit and typed its command — emit is captured.
        await waitFor(() => emit != null, { label: "the driver types its command (emit captured)" });

        // (1) A PRE-CAPTURE chunk: the watch has not resolved, so capturedSessionId is null.
        emit.emitData("early output before the session id is known\n");
        await waitFor(() => chunks.length >= 1, { label: "the first chunk reaches onOutputChunk" });
        assert.deepEqual(
          chunks[0],
          { chunk: "early output before the session id is known\n", sessionId: null },
          "the FIRST chunk is forwarded byte-for-byte with a NULL session (pre-capture — dropped downstream, never routed to the wrong card, ADR-014 inv.4)",
        );

        // Now the transcript watch resolves the session id (mid-stream capture).
        resolveWatch("sess-mid-stream-xyz");
        await sleep(); // let the driver's watch .then set capturedSessionId

        // (2) A POST-CAPTURE chunk: capturedSessionId is now the watch-resolved id.
        emit.emitData("later output after the session id is captured\n");
        await waitFor(() => chunks.length >= 2, { label: "the second chunk reaches onOutputChunk" });
        assert.deepEqual(
          chunks[1],
          { chunk: "later output after the session id is captured\n", sessionId: "sess-mid-stream-xyz" },
          "a LATER chunk carries the watch-resolved session id — the same (chunk, capturedSessionId) shape the launcher wires to client.sendTerminalFrame",
        );

        // The producer fires EXACTLY once per emitted chunk (no dup, no drop).
        assert.equal(chunks.length, 2, "onOutputChunk fired exactly once per emitted PTY chunk");

        // End the session cleanly (exit is not a data chunk — no extra onOutputChunk call).
        emit.emitExit(0);
        const result = await driverPromise;
        assert.equal(result.outcome, "done", "the driven session completes to its terminal outcome");
        assert.equal(result.sessionId, "sess-mid-stream-xyz", "the resolved session id is threaded onto the driver's result");
        assert.equal(chunks.length, 2, "the terminal exit did NOT produce a spurious onOutputChunk call");
      } finally {
        try { emit?.emitExit?.(0); } catch { /* already settled */ }
        await driverPromise.catch(() => {});
      }
    },
  },
];
