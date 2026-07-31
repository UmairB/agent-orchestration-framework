// Fitness function: acd-terminal-view-live-observable
// (milestone 38 / story 06; ARCHITECTURE ADR-013 invariant 7 + ADR-014 invariant 8;
//  DESIGN §Surface 3 V7/V9; SECURITY T14).
//
// "The fleet terminal-VIEW is observable ACROSS THE WHOLE LIFE OF A RUN: the
//  (nodeId, sessionId) join key reaches the control node WHILE the run is still
//  live (not only when it ends), and the stream's END is PRODUCED by the worker
//  (not inferred, not timed out, not read off the assignment's state)."
//
// WHY THIS EXISTS — the milestone's defining class, twice more.
//   clause (a) / ADR-013 inv.7 (raised at the task-04 structural review, 2026-07-23).
//     `capturedSessionId` is populated MID-RUN (mesh-worker-execution.mjs, the
//     transcript-watch resolution) and rides every terminal frame from that instant.
//     But the ONLY session-id-carrying assignment-status frames are the terminal ones
//     (`done`/`failed`) plus `needs-input`; the `running` frame that OPENS the run is
//     sent BEFORE the driver spawns and carries `{ runId }` only, and no further
//     status frame is sent for the rest of the run. So on an ordinary run
//     `global_assignments.session_id` stays NULL until the run is OVER — the card
//     resolves `no-session` and opens no socket for exactly the interval an operator
//     wants to watch.
//   clause (b) / ADR-014 inv.8 (BLOCKER F-38.06e, raised at QA, 2026-07-23).
//     The terminal-frame protocol has NO end-of-stream marker at all, and the fleet
//     route unsubscribes only on the BROWSER's own close. Nothing ever tells a
//     watching browser that the session ended, so `TERMINAL_VIEW_STATES.ENDED` is
//     unreachable from a real session end and an open view sits on
//     `streaming`/`live:true`/`motion:"pulse"` forever — V9's exact forbidden state.
//
// ARMED **RED-UNTIL-FIXED, BY DESIGN** (the F17 / acd-fleet-terminal-frame-connection-
// identity precedent this milestone already set: a fitness that pins an open finding
// RED is how a known-inert seam is stopped from reading green). The REAL-SOURCE lanes
// below FAIL on today's tree and go GREEN the moment the producers land — and RED
// again if either is ever reverted. The SYNTHESIZED self-check lanes pass REGARDLESS
// of tree state, proving the detectors are correct rather than merely red.
//
// Every plant is a HAND-WRITTEN synthesized snippet (never a string-replace on a real
// file, and never a write into one — the house convention), each asserting it LANDED
// before asserting the detector trips. Comments discounted, CRLF-normalised: the
// repo's tree is mixed CRLF/LF and an "\n"-only needle would silently no-op — the
// exact failure class this milestone was repeatedly burned by.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKER_EXECUTION = path.join(repoRoot, "src", "mesh-worker-execution.mjs");
const LAUNCHER = path.join(repoRoot, "src", "mesh-launcher.mjs");
const BRIDGE = path.join(repoRoot, "src", "mesh-terminal-relay-bridge.mjs");
const STREAM_CLIENT = path.join(repoRoot, "src", "worker-stream-client.mjs");
const MIRROR = path.join(repoRoot, "src", "mesh-terminal-mirror.mjs");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");
const CONTROL = path.join(repoRoot, "src", "control-stream-server.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}
async function realSource(file) {
  return lf(stripComments(await readFile(file, "utf8")));
}
function sliceBalanced(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}
// The brace-balanced body of `const finish = (result) => { … }` — the driver's ONE
// settle point, which covers done/failed (via onExit) AND needs-input (via the
// sentinel branch, which kills the PTY first). ADR-014 inv.8 pins the end emission
// HERE, not on one of the three outcome paths separately.
function finishBody(workerSource) {
  const anchor = /const\s+finish\s*=\s*\([^)]*\)\s*=>\s*\{/.exec(workerSource);
  if (!anchor) return null;
  return sliceBalanced(workerSource, workerSource.indexOf("{", anchor.index));
}
// The transcript-watch resolution chain — where `capturedSessionId` first becomes
// non-null mid-run. ADR-013 inv.7 pins the live report HERE.
function watchChain(workerSource) {
  return /const\s+watchPromise[\s\S]*?\.catch\([\s\S]*?\);/.exec(workerSource)?.[0] ?? null;
}
// The brace-balanced object literal at the PRODUCTION `createHandler({ … })` call
// site in mesh-launcher.mjs — a LITERAL key here (never only the test-injection
// spread) is the F12 discipline that keeps a producer from shipping test-only.
function createHandlerCallSite(launcherSource) {
  const anchor = /createHandler\(\s*\{/.exec(launcherSource);
  if (!anchor) return null;
  return sliceBalanced(launcherSource, launcherSource.indexOf("{", anchor.index));
}

// ADR-013 inv.7 / ADR-014 inv.8 both permit a RANGE of seam names — the ADRs pin the
// STRUCTURE (where it is emitted, that it is wired as a literal key), never one
// identifier. These alternations are the sanctioned vocabulary; widening them is a
// documentation change, not a weakening.
const LIVE_REPORT_SEAM = /onSessionIdCaptured|onSessionCaptured|onSessionIdResolved|reportSessionId|sendSessionIdUpdate/;
const END_SEAM = /onSessionEnd|onStreamEnd|onTerminalEnd/;

// --- clause (a) — ADR-013 inv.7: the join key is reported WHILE THE RUN IS LIVE ---
function liveSessionIdReportProblems({ workerSource, launcherSource }) {
  const problems = [];
  const chain = watchChain(workerSource);
  if (chain == null) {
    problems.push("the transcript-watch resolution chain could not be located in the worker driver — the anchor ADR-013 inv.7 pins has moved");
  } else if (!LIVE_REPORT_SEAM.test(chain)) {
    problems.push("the transcript-watch resolution assigns capturedSessionId but REPORTS it to no one — the control node cannot learn the join key until the run reaches a terminal state, so the fleet card resolves no-session for the whole live run (ADR-013 inv.7)");
  }
  const callSite = createHandlerCallSite(launcherSource);
  if (callSite == null) {
    problems.push("the production createHandler({ … }) call site could not be located in mesh-launcher.mjs");
  } else if (!LIVE_REPORT_SEAM.test(callSite)) {
    problems.push("the live session-id report seam is not supplied as a LITERAL key at the production createHandler({ … }) call site — an unwired hook is a producer that never fires (the F12 discipline)");
  }
  // REGRESSION GUARD: the fix must ADD a live report, never remove the terminal-state
  // reports that already carry the id.
  // m42 wave (d) leg d3 — the terminal `done` report moved to the durable path
  // (`reportSettled` → journal → outbox → ack), so the guard accepts either
  // emitter. What it pins is unchanged and is the point: whatever carries the
  // terminal report must still carry the session id, so the live report is
  // ADDITIVE to it rather than a replacement.
  if (!/(?:sendAssignmentStatus\?\.|reportSettled)\([^)]*"done"[\s\S]{0,120}?sessionId/.test(workerSource)) {
    problems.push("the `done` status frame no longer carries sessionId — the live report must be ADDITIVE to the terminal reports, never a replacement");
  }
  return problems;
}

// --- clause (b) — ADR-014 inv.8: the stream's END is PRODUCED, not inferred ---
function endOfStreamProblems({ bridgeSource, clientSource, workerSource, launcherSource, mirrorSource, meshUiSource, controlSource }) {
  const problems = [];

  // b1 — the end marker rides INSIDE the opaque `signal` on the EXISTING kind.
  const builder = /export\s+function\s+buildTerminalEndEnvelope\s*\([^)]*\)\s*\{/.exec(bridgeSource);
  if (!builder) {
    problems.push("mesh-terminal-relay-bridge.mjs exports no buildTerminalEndEnvelope — the terminal-frame protocol has NO end-of-stream marker, so a session end can never reach a watching browser (ADR-014 inv.8 / F-38.06e)");
  } else {
    const body = sliceBalanced(bridgeSource, bridgeSource.indexOf("{", builder.index));
    if (body == null || !/TERMINAL_FRAME_KIND/.test(body)) {
      problems.push("buildTerminalEndEnvelope does not reuse the EXISTING TERMINAL_FRAME_KIND — a SECOND kind would need a new branch at all three kind-switching hops (inv.8 forbids it)");
    }
    if (body != null && !/signal:\s*\{[^}]*\bend\b/.test(body)) {
      problems.push("the end marker does not ride INSIDE the opaque `signal` — inv.2 freezes { kind, nodeId, signal }, so a fourth top-level key is forbidden");
    }
    // inv.2, positively: the returned envelope's TOP LEVEL is exactly the frozen
    // three keys. Computed by removing the nested `signal: { … }` object first, so a
    // key inside `signal` is never mistaken for a top-level one.
    if (body != null) {
      const returned = sliceBalanced(body, body.indexOf("{", body.indexOf("return")));
      if (returned == null) {
        problems.push("buildTerminalEndEnvelope does not return an object literal");
      } else {
        const topLevel = returned.replace(/signal:\s*\{[^{}]*\}/, "signal: {}");
        const keys = [...topLevel.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]);
        const stray = keys.filter((key) => !["kind", "nodeId", "signal"].includes(key));
        if (stray.length > 0) {
          problems.push(`buildTerminalEndEnvelope adds top-level envelope key(s) ${stray.join(", ")} — inv.2 freezes { kind, nodeId, signal }`);
        }
      }
    }
  }

  // b2 — the worker's fabric send exposes it.
  if (!/sendTerminalEnd/.test(clientSource)) {
    problems.push("worker-stream-client.mjs exposes no sendTerminalEnd — there is no fabric leg for the end frame (the cross-machine leg is the only one reachable off-host)");
  }

  // b3 — emitted from the ONE settle point, which covers done/failed AND needs-input.
  const body = finishBody(workerSource);
  if (body == null) {
    problems.push("the driver's finish() settle point could not be located — the anchor ADR-014 inv.8 pins has moved");
  } else if (!END_SEAM.test(body)) {
    problems.push("the driver's finish() does not emit an end-of-stream — after the PTY exits (or the needs-input sentinel kills it) an open fleet view sits on `streaming`/live forever, DESIGN V9's exact forbidden state");
  }

  // b4 — the end hook is DISTINCT from the byte hook. Smuggling an end marker through
  // onOutputChunk would put a control message in the byte stream (see b7).
  if (body != null && /onOutputChunk\?\.\([^)]*\bend\b/.test(body)) {
    problems.push("the end is smuggled through onOutputChunk — the end hook must be DISTINCT from the byte hook (inv.8)");
  }

  // b5 — wired as a LITERAL key at the production call site (F12).
  const callSite = createHandlerCallSite(launcherSource);
  if (callSite == null) {
    problems.push("the production createHandler({ … }) call site could not be located in mesh-launcher.mjs");
  } else {
    if (!END_SEAM.test(callSite)) {
      problems.push("the end hook is not supplied as a LITERAL key at the production createHandler({ … }) call site — an unwired end producer is exactly the inert seam inv.5/6/7 exist to prevent");
    } else if (!/sendTerminalEnd/.test(callSite)) {
      problems.push("the end hook at the production call site is not wired to client.sendTerminalEnd (the FABRIC send)");
    }
  }

  // b6 — the mirror delivers the end DISTINCTLY to that tuple's subscribers.
  if (!/\bend\b/.test(mirrorSource) || !/listener\(\s*signal\.bytes\s*,/.test(mirrorSource)) {
    problems.push("mesh-terminal-mirror.mjs does not deliver the end distinctly to a stream's subscribers — it still calls listener(signal.bytes) only, so the route cannot tell an end from a byte");
  }

  // b7 — the fleet route CLOSES the browser socket; it never injects an in-band
  // control message into the byte stream (a worker's PTY output could forge one).
  const subscribeCall = /mirror\.subscribe\([\s\S]*?\n\s*\}\);/.exec(meshUiSource)?.[0] ?? "";
  if (!/ws\.close\s*\(/.test(subscribeCall)) {
    problems.push("the /ws/terminal-view route never closes the browser socket on a stream end — socket.onclose is what makes the already-correct terminalViewOnClose reducer reachable (inv.8)");
  }
  if (/ws\.send\s*\(\s*["'`]/.test(subscribeCall)) {
    problems.push("the /ws/terminal-view route sends a LITERAL control message down the byte stream — the browser must stay a dumb painter, and an in-band marker would let a worker's own PTY output FORGE a stream end (T14)");
  }

  // b8 — NEGATIVE, must stay true: the end frame creates NO new control-path branch
  // and is NEVER persisted (inv.3 unchanged).
  const kindComparisons = (controlSource.match(/frame\?\.kind\s*===\s*TERMINAL_FRAME_KIND/g) ?? []).length;
  if (kindComparisons !== 1) {
    problems.push(`control-stream-server.mjs branches TERMINAL_FRAME_KIND ${kindComparisons} times — the end frame must ride the EXISTING single branch, adding none (inv.8)`);
  }
  if (/applyStreamFrame[\s\S]{0,600}?TERMINAL_FRAME_KIND/.test(controlSource) && /if\s*\(frame\?\.kind\s*===\s*TERMINAL_FRAME_KIND\)\s*return/.test(controlSource)) {
    problems.push("applyStreamFrame gained a terminal-frame branch — a terminal frame (or an end frame) must NEVER be store-applied (inv.3)");
  }
  return problems;
}

export const archTests = [
  // ══ clause (a) — REAL SOURCE. RED until the live report lands. ══
  {
    name: "arch/38 ADR-013 inv.7 (acd-terminal-view-live-observable/a): the worker REPORTS its captured session id WHILE the run is live — the fleet card can resolve a stream before the run is over",
    async run() {
      const workerSource = await realSource(WORKER_EXECUTION);
      const launcherSource = await realSource(LAUNCHER);
      assert.deepEqual(
        liveSessionIdReportProblems({ workerSource, launcherSource }),
        [],
        "the ADR-013 join key must reach the control node mid-run. FIX: call a live-report seam (e.g. `options.onSessionIdCaptured?.(resolved)`) from the transcript-watch resolution in mesh-worker-execution.mjs, and wire it as a LITERAL key at the production createHandler({ … }) call site in mesh-launcher.mjs to `sendAssignmentStatus(assignmentId, \"running\", { runId, sessionId })`. The control writer already accepts it idempotently (absent-is-not-a-clear).",
      );
    },
  },

  // ══ clause (b) — REAL SOURCE. RED until the end-of-stream producer lands (F-38.06e). ══
  {
    name: "arch/38 ADR-014 inv.8 (acd-terminal-view-live-observable/b): the stream's END is PRODUCED — an end marker inside the opaque signal, emitted from finish(), closing the browser socket (F-38.06e)",
    async run() {
      const problems = endOfStreamProblems({
        bridgeSource: await realSource(BRIDGE),
        clientSource: await realSource(STREAM_CLIENT),
        workerSource: await realSource(WORKER_EXECUTION),
        launcherSource: await realSource(LAUNCHER),
        mirrorSource: await realSource(MIRROR),
        meshUiSource: await realSource(MESH_UI_SERVE),
        controlSource: await realSource(CONTROL),
      });
      assert.deepEqual(
        problems,
        [],
        "DESIGN V9 must be reachable from a REAL session end. FIX: add `buildTerminalEndEnvelope(nodeId, sessionId)` → { kind: TERMINAL_FRAME_KIND, nodeId, signal: { sessionId, end: true } }; expose `sendTerminalEnd` on worker-stream-client; call the end hook from the driver's ONE finish() settle point (covers done/failed AND needs-input); wire it as a LITERAL key at createHandler({ … }); deliver it distinctly from mirror.apply; and CLOSE the browser socket in the /ws/terminal-view listener — never an in-band control message.",
      );
    },
  },

  // ══ SELF-CHECK — synthesized, GREEN regardless of tree state. Proves both detectors
  // are correct (a fixed shape is clean; each reverted shape trips), so the RED above
  // is a finding about the TREE, never a broken detector. ══
  {
    name: "arch/38 acd-terminal-view-live-observable self-check (a): a synthesized LIVE-REPORT shape is clean, and each reverted shape trips",
    run() {
      const workerFixed = stripComments(`
        const watchPromise = Promise.resolve(watchCallResult)
          .then((resolved) => {
            if (typeof resolved === "string" && resolved.length > 0) capturedSessionId = resolved;
            options.onSessionIdCaptured?.(capturedSessionId);
            return resolved ?? null;
          })
          .catch(() => null);
        await sendAssignmentStatus?.(assignmentId, "done", { runId: runRecord.runId, sessionId });
      `);
      const launcherFixed = stripComments(`
        const handler = createHandler({
          onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, String(chunk)),
          onSessionIdCaptured: (sessionId) => client.sendAssignmentStatus(assignmentId, "running", { runId, sessionId }),
        });
      `);
      assert.deepEqual(
        liveSessionIdReportProblems({ workerSource: workerFixed, launcherSource: launcherFixed }),
        [],
        "the synthesized FIXED shape is clean — so the real-source lane's red is about the tree, not the detector",
      );

      // PLANT — the watch resolves the id and tells nobody (TODAY's tree).
      const workerSilent = workerFixed.replace("options.onSessionIdCaptured?.(capturedSessionId);\n", "");
      assert.notEqual(workerSilent, workerFixed, "the plant actually differs from the fixed shape");
      assert.ok(
        liveSessionIdReportProblems({ workerSource: workerSilent, launcherSource: launcherFixed }).length > 0,
        "self-check: a watch resolution that reports to nobody trips — this is exactly today's tree",
      );

      // PLANT — the hook exists but is never wired at the production call site (F12).
      const launcherUnwired = launcherFixed.replace(/\n\s*onSessionIdCaptured:[^\n]*\n/, "\n");
      assert.notEqual(launcherUnwired, launcherFixed, "the plant actually differs from the fixed shape");
      assert.ok(
        liveSessionIdReportProblems({ workerSource: workerFixed, launcherSource: launcherUnwired }).length > 0,
        "self-check: an unwired hook trips — a producer reachable only through a test spread is not a producer",
      );

      // PLANT — the fix "moves" the report instead of adding it, dropping the terminal one.
      const workerRegressed = workerFixed.replace(/await sendAssignmentStatus[^\n]*\n/, "");
      assert.notEqual(workerRegressed, workerFixed, "the plant actually differs from the fixed shape");
      assert.ok(
        liveSessionIdReportProblems({ workerSource: workerRegressed, launcherSource: launcherFixed }).length > 0,
        "self-check: dropping the terminal-state report trips — the live report is ADDITIVE",
      );
    },
  },
  {
    name: "arch/38 acd-terminal-view-live-observable self-check (b): a synthesized END-OF-STREAM shape is clean, and each reverted shape trips",
    run() {
      const fixed = {
        bridgeSource: stripComments(`
          export function buildTerminalEndEnvelope(nodeId, sessionId) {
            return { kind: TERMINAL_FRAME_KIND, nodeId, signal: { sessionId: sessionId ?? null, end: true } };
          }
        `),
        clientSource: stripComments(`return { sendTerminalFrame, sendTerminalEnd };`),
        workerSource: stripComments(`
          const finish = (result) => {
            if (settled) return;
            settled = true;
            cleanupSubs();
            options.onSessionEnd?.(capturedSessionId);
            resolve(result);
          };
        `),
        launcherSource: stripComments(`
          const handler = createHandler({
            onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, String(chunk)),
            onSessionEnd: (sessionId) => client.sendTerminalEnd(sessionId),
          });
        `),
        mirrorSource: stripComments(`listener(signal.bytes, { end: signal.end === true });`),
        meshUiSource: stripComments(`
          const unsubscribe = mirror.subscribe(nodeId, sessionId, (bytes, meta) => {
            if (meta?.end === true) {
              try { ws.close(); } catch { }
              return;
            }
            try { ws.send(bytes); } catch { }
          });
        `),
        controlSource: stripComments(`if (frame?.kind === TERMINAL_FRAME_KIND) { onTerminalFrame(frame, { nodeId }); return; }`),
      };
      assert.deepEqual(
        endOfStreamProblems(fixed),
        [],
        "the synthesized FIXED shape is clean — so the real-source lane's red is about the tree, not the detector",
      );

      // PLANT — no end marker in the protocol at all (TODAY's tree).
      const noBuilder = { ...fixed, bridgeSource: stripComments(`export function buildTerminalFrameEnvelope(nodeId, sessionId, bytes) { return { kind: TERMINAL_FRAME_KIND, nodeId, signal: { sessionId, bytes } }; }`) };
      assert.notEqual(noBuilder.bridgeSource, fixed.bridgeSource, "the plant actually differs from the fixed shape");
      assert.ok(endOfStreamProblems(noBuilder).length > 0, "self-check: a protocol with no end marker trips — this is exactly today's tree");

      // PLANT — the marker smuggled as a FOURTH top-level envelope key (inv.2).
      const fourthKey = { ...fixed, bridgeSource: stripComments(`export function buildTerminalEndEnvelope(nodeId, sessionId) { return { kind: TERMINAL_FRAME_KIND, nodeId, end: true, signal: { sessionId } }; }`) };
      assert.notEqual(fourthKey.bridgeSource, fixed.bridgeSource, "the plant actually differs from the fixed shape");
      assert.ok(endOfStreamProblems(fourthKey).length > 0, "self-check: a fourth top-level envelope key trips — inv.2 freezes { kind, nodeId, signal }");

      // PLANT — emitted from onExit only, so the needs-input path never ends its stream.
      const notAtSettle = { ...fixed, workerSource: stripComments(`const finish = (result) => { if (settled) return; settled = true; cleanupSubs(); resolve(result); };`) };
      assert.notEqual(notAtSettle.workerSource, fixed.workerSource, "the plant actually differs from the fixed shape");
      assert.ok(endOfStreamProblems(notAtSettle).length > 0, "self-check: an end NOT emitted from the single settle point trips");

      // PLANT — the hook exists but is never wired at the production call site (F12).
      const unwired = { ...fixed, launcherSource: stripComments(`const handler = createHandler({ onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, String(chunk)) });`) };
      assert.notEqual(unwired.launcherSource, fixed.launcherSource, "the plant actually differs from the fixed shape");
      assert.ok(endOfStreamProblems(unwired).length > 0, "self-check: an unwired end hook trips — the inert-producer class");

      // PLANT — an IN-BAND control message instead of a socket close (the forgeable shape).
      const inBand = { ...fixed, meshUiSource: stripComments(`const unsubscribe = mirror.subscribe(nodeId, sessionId, (bytes, meta) => { if (meta?.end === true) { try { ws.send("\\u0004AOF_STREAM_END"); } catch { } return; } try { ws.send(bytes); } catch { } });`) };
      assert.notEqual(inBand.meshUiSource, fixed.meshUiSource, "the plant actually differs from the fixed shape");
      assert.ok(endOfStreamProblems(inBand).length > 0, "self-check: an in-band control message trips — a worker's PTY output could forge it (T14)");

      // PLANT — the route left as-is: subscribes, never closes (TODAY's tree).
      const neverCloses = { ...fixed, meshUiSource: stripComments(`const unsubscribe = mirror.subscribe(nodeId, sessionId, (bytes) => { try { ws.send(bytes); } catch { } });`) };
      assert.notEqual(neverCloses.meshUiSource, fixed.meshUiSource, "the plant actually differs from the fixed shape");
      assert.ok(endOfStreamProblems(neverCloses).length > 0, "self-check: a route that never closes the browser socket trips — this is exactly today's tree");

      // PLANT — the end frame given its OWN kind, adding a second control-path branch.
      const secondBranch = { ...fixed, controlSource: stripComments(`if (frame?.kind === TERMINAL_FRAME_KIND) { onTerminalFrame(frame, { nodeId }); return; } if (frame?.kind === TERMINAL_FRAME_KIND) { onTerminalEnd(frame); return; }`) };
      assert.notEqual(secondBranch.controlSource, fixed.controlSource, "the plant actually differs from the fixed shape");
      assert.ok(endOfStreamProblems(secondBranch).length > 0, "self-check: a second control-path branch trips — the end must ride the EXISTING one");

      // PLANT — the mirror still delivers bytes only, so the route cannot tell an end from a byte.
      const bytesOnly = { ...fixed, mirrorSource: stripComments(`listener(signal.bytes);`) };
      assert.notEqual(bytesOnly.mirrorSource, fixed.mirrorSource, "the plant actually differs from the fixed shape");
      assert.ok(endOfStreamProblems(bytesOnly).length > 0, "self-check: a mirror that cannot express an end trips");
    },
  },
];
