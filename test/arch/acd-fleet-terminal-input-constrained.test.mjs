// Fitness function: acd-fleet-terminal-input-constrained (m42 "interactive worker
// terminals" — the DELIBERATE rewrite of acd-fleet-terminal-mirror-read-only).
//
// HISTORY: milestone 38 / story 06 (ADR-014; SECURITY T14) shipped the fleet
// terminal view READ-ONLY — no mesh->PTY input path anywhere — and this gate's
// predecessor pinned that ABSENCE. On 2026-07-27 the operator overrode that
// decision ("Next step is to make the terminal interactable. Rather than
// continuing on worker"): a needs-input session could only be answered by
// resuming at the worker. The input path now EXISTS — so this gate pins its
// CONSTRAINED SHAPE instead of its absence:
//
//   1. TUPLE-BOUND ENTRY — input enters the mesh at EXACTLY ONE seam: the
//      terminal-view socket's message handler, which wraps the bytes with THE
//      SOCKET'S OWN (nodeId, sessionId) (closed over from the upgrade query).
//      The message content contributes ONLY opaque bytes: the handler is
//      CONTENT-BLIND (no JSON.parse, no parse-then-branch — a smuggled tuple in
//      the payload is just bytes), BOUNDED (MAX_TERMINAL_INPUT_BYTES), and
//      CLEAN-DEGRADING (no configured push -> output-only route, exactly as
//      before the feature).
//   2. SESSION-EXACT DELIVERY — the worker's input handler resolves its write
//      EXCLUSIVELY through the liveSessionInputs registry by the frame's OWN
//      sessionId. No direct term.write/pty.write, no "first live PTY" fallback,
//      no iteration — an unmatched session id is a drop, never a redirect.
//   3. THE MIRROR/BRIDGE STAY PURE — in-memory, no durable write, no
//      write-seam import (ADR-014 inv.3, unchanged), and the OUTPUT signal is
//      still sourced ONLY from term.onData with no credential material (T14's
//      surviving half, unchanged).
//   4. THE FLEET PAGE STAYS A MONITOR — the interactive surface is the BOARD
//      DOCK (the one terminal surface, m42 item 6); ui/src/fleet still wires no
//      input source and sends nothing on any socket (unchanged detectors).
//
// STRUCTURAL half: source-analysis over the REAL src/mesh-terminal-relay-bridge.mjs,
// src/mesh-terminal-mirror.mjs, src/mesh-worker-execution.mjs, the terminal-VIEW
// upgrade block of src/mesh-ui-serve.mjs, and the board dock + fleet UI surfaces
// (comments discounted, CRLF-normalised — the repo's tree is CRLF; an "\n"-only
// needle would silently no-op, the failure class m38 was repeatedly burned by).
// BEHAVIOURAL half: the REAL serveMeshUi proves (a) a keystroke arrives as a
// tuple-bound envelope carrying the SOCKET's tuple even when the payload smuggles
// a different one, and (b) an UNCONFIGURED route stays output-only (no echo, no
// crash, stream intact).
//
// Every plant is a HAND-WRITTEN synthesized snippet (never a string-replace on a
// real file) — each asserts it LANDED (`assert.notEqual(planted, clean)`) before
// asserting the detector trips on it and stays quiet on the clean baseline.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";
import { createTerminalMirror } from "../../src/mesh-terminal-mirror.mjs";
import { buildTerminalFrameEnvelope, TERMINAL_INPUT_KIND } from "../../src/mesh-terminal-relay-bridge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRIDGE = path.join(repoRoot, "src", "mesh-terminal-relay-bridge.mjs");
const MIRROR = path.join(repoRoot, "src", "mesh-terminal-mirror.mjs");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");
const WORKER_EXECUTION = path.join(repoRoot, "src", "mesh-worker-execution.mjs");
// The BROWSER surfaces: the fleet page (still a monitor) and the board dock (the
// ONE interactive terminal surface — local pty AND remote worker session).
const FLEET_UI_DIR = path.join(repoRoot, "ui", "src", "fleet");
const BOARD_TERMINAL_DOCK = path.join(repoRoot, "ui", "src", "board", "TerminalDock.tsx");
// The worker's own local /ws/terminal (scanned, never modified): its
// bidirectional input direction predates and outlives this feature.
const TERMINAL_WS = path.join(repoRoot, "src", "terminal-ws.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF -> LF before every regex probe (the repo's tree is
// checked out CRLF; an "\n"-only needle would silently no-op — m38's own
// hard-earned lesson, F1/F4/F6/F7/F8).
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

// extractUpgradeBlock(source) — the terminal-VIEW's server.on("upgrade", ...)
// handler block, brace-balanced from its opening `{`.
function extractUpgradeBlock(source) {
  const anchor = /server\.on\(\s*["']upgrade["']\s*,\s*\([^)]*\)\s*=>\s*\{/.exec(source);
  if (!anchor) return null;
  const braceOpen = source.indexOf("{", anchor.index);
  return sliceBalanced(source, braceOpen);
}

// extractMessageHandler(upgradeBlock) — the ws.on("message", ...) handler INSIDE
// the terminal-view upgrade block, brace-balanced from the arrow's `{` (the LAST
// character of the anchor match — an indexOf would find a `{}` inside the params).
function extractMessageHandler(upgradeBlock) {
  if (upgradeBlock == null) return null;
  const anchor = /ws\.on\(\s*["']message["']\s*,\s*\([^)]*\)\s*=>\s*\{/.exec(upgradeBlock);
  if (!anchor) return null;
  return sliceBalanced(upgradeBlock, anchor.index + anchor[0].length - 1);
}

// extractFunction(source, name) — a named function's brace-balanced body, sliced
// from the anchor match's OWN closing `{` (a default-parameter `{}` would defeat
// a naive indexOf).
function extractFunction(source, name) {
  const anchor = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  if (!anchor) return null;
  return sliceBalanced(source, anchor.index + anchor[0].length - 1);
}

const PTY_WRITE = /\b(?:term|pty)\.write\s*\(/;

// --- detector #1 — the TUPLE-BOUND, CONTENT-BLIND route entry ---
//
// The message handler must EXIST (positive — the feature is real), must build its
// envelope from the SOCKET's own closure tuple via the sanctioned builder, must
// keep the null-push degrade and the size ceiling, and must NEVER parse or
// branch on the message content (content-blind: a smuggled tuple is just bytes)
// nor touch a PTY itself.
function routeEntryProblems({ bridgeSource, mirrorSource, upgradeBlock }) {
  const problems = [];
  if (PTY_WRITE.test(bridgeSource)) problems.push("mesh-terminal-relay-bridge.mjs calls term.write/pty.write — the bridge builds envelopes, it never touches a PTY");
  if (PTY_WRITE.test(mirrorSource)) problems.push("mesh-terminal-mirror.mjs calls term.write/pty.write — the mirror is a projection, it never touches a PTY");
  if (upgradeBlock == null) {
    problems.push("could not locate the terminal-VIEW upgrade block in mesh-ui-serve.mjs");
    return problems;
  }
  const messageHandler = extractMessageHandler(upgradeBlock);
  if (messageHandler == null) {
    problems.push('the terminal-VIEW upgrade block has NO ws.on("message", ...) handler — the interactive input seam is missing (its ABSENCE is the old read-only shape; the operator overrode it)');
    return problems;
  }
  // POSITIVE — tuple-bound: the envelope is built by the sanctioned builder from
  // EXACTLY the closure identifiers the upgrade query resolved.
  if (!/buildTerminalInputEnvelope\(\s*nodeId\s*,\s*sessionId\s*,/.test(messageHandler)) {
    problems.push("the message handler does not build its envelope via buildTerminalInputEnvelope(nodeId, sessionId, ...) — the SOCKET's own tuple must be the ONLY routing source");
  }
  // POSITIVE — clean degrade: no configured push -> output-only route.
  if (!/terminalInputPush\s*==\s*null/.test(messageHandler)) {
    problems.push("the message handler does not guard terminalInputPush == null — an unconfigured relay must degrade the route to output-only, not crash");
  }
  // POSITIVE — bounded: the input ceiling is enforced in the handler.
  if (!/MAX_TERMINAL_INPUT_BYTES/.test(messageHandler)) {
    problems.push("the message handler does not enforce MAX_TERMINAL_INPUT_BYTES — the input lane must be bounded");
  }
  // NEGATIVE — content-blind: no parse, no branch on message content. A JSON.parse
  // here is the exact shape a smuggled {nodeId, sessionId} would enter through.
  if (/JSON\.parse/.test(messageHandler)) {
    problems.push("the message handler JSON.parses the browser message — the input lane must be CONTENT-BLIND (a smuggled tuple in the payload must stay opaque bytes)");
  }
  if (/data\s*\.\s*(?:nodeId|sessionId)|\bparsed\b/.test(messageHandler)) {
    problems.push("the message handler reads routing facts off the message content — the socket's own tuple is the ONLY routing source");
  }
  // NEGATIVE — the route never touches a PTY itself.
  if (PTY_WRITE.test(messageHandler) || PTY_WRITE.test(upgradeBlock)) {
    problems.push("the terminal-VIEW route calls term.write/pty.write directly — delivery belongs to the worker's session-exact registry, never the fleet face");
  }
  return problems;
}

// --- detector #2 — SESSION-EXACT delivery at the worker ---
//
// The worker's input handler resolves its write EXCLUSIVELY through the
// liveSessionInputs registry by the frame's own sessionId: no direct PTY write,
// no iteration/fallback that could redirect input to "some other" live session.
function workerDeliveryProblems(handlerSource) {
  const problems = [];
  if (handlerSource == null) {
    problems.push("createMeshWorkerTerminalInputHandler is missing from mesh-worker-execution.mjs — the worker has no constrained input seam");
    return problems;
  }
  if (!/liveSessionInputs\.get\(\s*sessionId\s*\)/.test(handlerSource)) {
    problems.push("the worker input handler does not resolve its write via liveSessionInputs.get(sessionId) — session-exact delivery is the invariant");
  }
  if (PTY_WRITE.test(handlerSource)) {
    problems.push("the worker input handler calls term.write/pty.write directly — the registry-resolved write is the ONLY sanctioned delivery");
  }
  if (/liveSessionInputs\s*\.\s*(?:values|entries|keys)\s*\(|for\s*\(\s*const\b[^)]*of\s+liveSessionInputs/.test(handlerSource)) {
    problems.push("the worker input handler iterates liveSessionInputs — a 'first/any live PTY' fallback is a cross-session injection, exactly what session-exact delivery forbids");
  }
  if (/livePtyKills|livePtyWrites\s*\.\s*get/.test(handlerSource)) {
    problems.push("the worker input handler resolves by assignment registries — the frame's join key is the SESSION id, never an assignment guess");
  }
  return problems;
}

// --- detector #3 — the mirror/bridge stay PURE (unchanged from the predecessor) ---

const DURABLE_WRITE = /\b(?:writeText|writeFile|writeFileSync|appendFile|appendFileSync|outputFile)\s*\(/;

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

function importsWriteSeam(specs) {
  return specs.some(
    (s) =>
      /^node:fs(\/promises)?$/.test(s) ||
      /(^|\/)fs\.mjs$/.test(s) ||
      /(^|\/)mesh-presence\.mjs$/.test(s) ||
      /(^|\/)mesh-store\.mjs$/.test(s),
  );
}

function durabilityProblems({ bridgeSource, mirrorSource }) {
  const problems = [];
  for (const [label, source] of [["mesh-terminal-relay-bridge.mjs", bridgeSource], ["mesh-terminal-mirror.mjs", mirrorSource]]) {
    if (DURABLE_WRITE.test(source)) problems.push(`${label} calls a durable write (writeText/writeFile/appendFile/...) — the mirror/bridge must stay in-memory only`);
    const specs = importSpecifiers(source);
    if (importsWriteSeam(specs)) problems.push(`${label} imports a write/persist seam (node:fs / node:fs/promises / fs.mjs / mesh-presence.mjs / mesh-store.mjs): ${specs.join(", ")}`);
    if (/\bpublishPresenceRecord\b/.test(source)) problems.push(`${label} references publishPresenceRecord — the durable git-write function`);
    if (/\bpresenceRecordPath\b/.test(source)) problems.push(`${label} references presenceRecordPath — the git-tracked write target`);
  }
  return problems;
}

// --- detector #4 — the OUTPUT signal is still sourced ONLY from term.onData —
// no credential material (SECURITY T14's surviving half, unchanged) ---

const CREDENTIAL_NEEDLE = /\b(?:process\.env|askpass|credential|mint(?:CloneCredential|WriteCredential)?|GIT_ASKPASS|apiKey|privateKey|appPrivateKey)\b/i;

function credentialSourceProblems(bridgeSource) {
  const problems = [];
  if (CREDENTIAL_NEEDLE.test(bridgeSource)) {
    problems.push("mesh-terminal-relay-bridge.mjs references credential/env/askpass/mint material — the signal must be sourced EXCLUSIVELY from term.onData");
  }
  if (!/String\s*\(\s*chunk\s*\)/.test(bridgeSource)) {
    problems.push("wireTerminalBridge does not build its signal from String(chunk) — the onData callback's own parameter");
  }
  return problems;
}

// --- detector #5 — the FLEET PAGE stays a MONITOR (unchanged): the interactive
// surface is the board dock; ui/src/fleet wires no input source and sends
// nothing on any socket ---

const SOCKET_NAMED = /\bWebSocket\b/;
const ANY_SEND_CALL = /\.\s*send\s*\(/;
const TERMINAL_INPUT_SOURCE = /\.\s*(?:onData|onKey|onBinary)\s*\(|\battachCustomKeyEventHandler\s*\(/;

function browserSocketSend(source) {
  return SOCKET_NAMED.test(source) && ANY_SEND_CALL.test(source);
}

// listSourceFiles(dir) — every .ts/.tsx/.mjs file under a UI directory, recursively.
async function listSourceFiles(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listSourceFiles(full)));
    else if (/\.(?:tsx?|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.mts")) found.push(full);
  }
  return found;
}

export const archTests = [
  // ══ invariant #1 — the tuple-bound, content-blind, bounded route entry ══
  {
    name: "arch/42 terminal-input: the terminal-VIEW route's input seam EXISTS and is tuple-bound (socket's own nodeId/sessionId), content-blind (no JSON.parse/branch), bounded, and clean-degrading",
    async run() {
      const bridgeSource = await realSource(BRIDGE);
      const mirrorSource = await realSource(MIRROR);
      const uiSource = await realSource(MESH_UI_SERVE);
      const upgradeBlock = extractUpgradeBlock(uiSource);
      assert.ok(upgradeBlock != null, "the terminal-VIEW upgrade block is found in the real mesh-ui-serve.mjs source");
      assert.deepEqual(
        routeEntryProblems({ bridgeSource, mirrorSource, upgradeBlock }),
        [],
        "the real route entry is tuple-bound, content-blind, bounded, clean-degrading, and touches no PTY",
      );

      // A clean SYNTHESIZED baseline carrying every sanctioned marker — plants
      // below are hand-written mutations of THIS shape.
      const clean = stripComments(`
        server.on("upgrade", (request, socket, head) => {
          terminalViewWss.handleUpgrade(request, socket, head, (ws) => {
            const unsubscribe = mirror.subscribe(nodeId, sessionId, (bytes) => { ws.send(bytes); });
            ws.on("close", unsubscribe);
            ws.on("message", (data) => {
              if (terminalInputPush == null) return;
              const bytes = String(data);
              if (Buffer.byteLength(bytes) > MAX_TERMINAL_INPUT_BYTES) return;
              terminalInputPush.push(buildTerminalInputEnvelope(nodeId, sessionId, bytes));
            });
          });
        });
      `);
      assert.deepEqual(
        routeEntryProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(clean) }),
        [],
        "the clean synthesized route shape stays quiet",
      );

      // PLANT — the OLD read-only shape (no message handler at all): the feature
      // regressing to absence must now FAIL CI (the positive half).
      const plantedAbsent = stripComments(`
        server.on("upgrade", (request, socket, head) => {
          terminalViewWss.handleUpgrade(request, socket, head, (ws) => {
            const unsubscribe = mirror.subscribe(nodeId, sessionId, (bytes) => { ws.send(bytes); });
            ws.on("close", unsubscribe);
          });
        });
      `);
      assert.notEqual(plantedAbsent, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        routeEntryProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(plantedAbsent) }).length > 0,
        "self-check: the input seam's ABSENCE trips — the gate pins the constrained shape, not the old read-only one",
      );

      // PLANT — a content-routed handler: JSON.parse the payload and route by ITS
      // tuple. The exact cross-session injection the tuple-binding forbids.
      const plantedContentRouted = clean.replace(
        "terminalInputPush.push(buildTerminalInputEnvelope(nodeId, sessionId, bytes));",
        "const parsed = JSON.parse(bytes); terminalInputPush.push(buildTerminalInputEnvelope(parsed.nodeId, parsed.sessionId, parsed.bytes));",
      );
      assert.notEqual(plantedContentRouted, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        routeEntryProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(plantedContentRouted) }).length > 0,
        "self-check: a JSON.parse/content-routed handler trips — the socket's own tuple is the ONLY routing source",
      );

      // PLANT — the size ceiling removed.
      const plantedUnbounded = clean.replace(/\s*if \(Buffer\.byteLength\(bytes\) > MAX_TERMINAL_INPUT_BYTES\) return;/, "");
      assert.notEqual(plantedUnbounded, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        routeEntryProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(plantedUnbounded) }).length > 0,
        "self-check: dropping the MAX_TERMINAL_INPUT_BYTES ceiling trips",
      );

      // PLANT — the null-push degrade removed.
      const plantedNoDegrade = clean.replace(/\s*if \(terminalInputPush == null\) return;/, "");
      assert.notEqual(plantedNoDegrade, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        routeEntryProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(plantedNoDegrade) }).length > 0,
        "self-check: dropping the terminalInputPush == null degrade trips",
      );

      // PLANT — a direct PTY write in the route.
      const plantedDirectWrite = clean.replace(
        "terminalInputPush.push(buildTerminalInputEnvelope(nodeId, sessionId, bytes));",
        "term.write(bytes);",
      );
      assert.notEqual(plantedDirectWrite, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        routeEntryProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(plantedDirectWrite) }).length > 0,
        "self-check: a direct term.write in the route trips — delivery belongs to the worker's registry",
      );
    },
  },

  // ══ invariant #2 — session-exact delivery at the worker ══
  {
    name: "arch/42 terminal-input: the worker's input handler delivers EXCLUSIVELY via liveSessionInputs.get(sessionId) — no direct PTY write, no first-live-PTY fallback, no assignment-keyed guess",
    async run() {
      const workerSource = await realSource(WORKER_EXECUTION);
      const handler = extractFunction(workerSource, "createMeshWorkerTerminalInputHandler");
      assert.deepEqual(workerDeliveryProblems(handler), [], "the real worker input handler is session-exact");

      const clean = stripComments(`
        function createMeshWorkerTerminalInputHandler(options = {}) {
          return function handleTerminalInput(frame) {
            const sessionId = typeof frame?.sessionId === "string" ? frame.sessionId : null;
            const bytes = typeof frame?.bytes === "string" ? frame.bytes : null;
            if (sessionId == null || bytes == null) return;
            const write = liveSessionInputs.get(sessionId);
            if (write == null) return;
            write(bytes);
          };
        }
      `);
      assert.deepEqual(workerDeliveryProblems(extractFunction(clean, "createMeshWorkerTerminalInputHandler")), [], "the clean synthesized handler stays quiet");

      // PLANT — the "any live PTY" fallback: an unmatched session falls through to
      // the first registered write. THE cross-session injection.
      const plantedFallback = clean.replace(
        "if (write == null) return;",
        "const fallback = liveSessionInputs.values().next().value; if (write == null && fallback == null) return;",
      );
      assert.notEqual(plantedFallback, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        workerDeliveryProblems(extractFunction(plantedFallback, "createMeshWorkerTerminalInputHandler")).length > 0,
        "self-check: a first-live-PTY fallback trips — an unmatched session is a DROP, never a redirect",
      );

      // PLANT — a direct term.write beside the registry.
      const plantedDirect = clean.replace("write(bytes);", "term.write(bytes);");
      assert.notEqual(plantedDirect, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        workerDeliveryProblems(extractFunction(plantedDirect, "createMeshWorkerTerminalInputHandler")).length > 0,
        "self-check: a direct term.write in the handler trips",
      );

      // PLANT — assignment-keyed delivery (livePtyWrites.get by a guessed id).
      const plantedAssignmentKeyed = clean.replace(
        "const write = liveSessionInputs.get(sessionId);",
        "const write = livePtyWrites.get(frame.assignmentId) ?? liveSessionInputs.get(sessionId);",
      );
      assert.notEqual(plantedAssignmentKeyed, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        workerDeliveryProblems(extractFunction(plantedAssignmentKeyed, "createMeshWorkerTerminalInputHandler")).length > 0,
        "self-check: assignment-keyed resolution trips — the session id is the ONLY join key",
      );

      // …and the registry lifecycle is real: the bracket clears every per-PTY
      // registry at settle (input can never outlive its bracket), and the session
      // binding is created at session-id capture.
      assert.ok(
        /function\s+clearLivePtyRegistries\s*\(/.test(workerSource),
        "clearLivePtyRegistries exists — the one settle-side sweep for kill + write + session binding",
      );
      assert.ok(
        /clearLivePtyRegistries\(\s*assignmentId\s*\)/.test(workerSource),
        "the bracket calls clearLivePtyRegistries(assignmentId) at settle",
      );
      assert.ok(
        /liveSessionInputs\.set\(\s*sessionId\s*,/.test(workerSource),
        "the session binding is created at session-id capture (liveSessionInputs.set(sessionId, ...))",
      );
    },
  },

  // ══ invariant #3 — the bridge + mirror stay in-memory / never a record ══
  {
    name: "arch/42 terminal-input (ADR-014 inv.3 unchanged): the bridge + mirror write NO durable record — no writeText/writeFile, no write/persist-seam import, no presenceRecordPath/publishPresenceRecord reference",
    async run() {
      const bridgeSource = await realSource(BRIDGE);
      const mirrorSource = await realSource(MIRROR);
      assert.deepEqual(durabilityProblems({ bridgeSource, mirrorSource }), [], "the real bridge + mirror modules are durable-write-free");

      const clean = 'export function createTerminalMirror() { const listenersByKey = new Map(); return { apply(envelope) { return true; } }; }';
      const plantedDurableWrite = 'import { writeText } from "./fs.mjs";\nexport function createTerminalMirror() { return { apply(envelope) { writeText("./transcript.log", envelope.signal.bytes); return true; } }; }';
      assert.notEqual(plantedDurableWrite, clean, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(durabilityProblems({ bridgeSource: clean, mirrorSource: clean }), [], "the clean synthesized shape stays quiet");
      assert.ok(
        durabilityProblems({ bridgeSource: clean, mirrorSource: plantedDurableWrite }).length > 0,
        "self-check: a planted durable write (writeText) of streamed bytes trips the detector",
      );

      const plantedPersistImport = 'import { presenceRecordPath } from "./mesh-store.mjs";\nexport function createTerminalMirror() { return { apply(envelope) { return true; } }; }';
      assert.notEqual(plantedPersistImport, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        durabilityProblems({ bridgeSource: clean, mirrorSource: plantedPersistImport }).length > 0,
        "self-check: a planted mesh-store.mjs / presenceRecordPath import trips the detector",
      );
    },
  },

  // ══ invariant #4 — the OUTPUT signal is sourced ONLY from term.onData ══
  {
    name: "arch/42 terminal-input (SECURITY T14's surviving half): the bridge's streamed signal is sourced ONLY from term.onData — no credential env / askpass / mint reply ever enters it",
    async run() {
      const bridgeSource = await realSource(BRIDGE);
      assert.deepEqual(credentialSourceProblems(bridgeSource), [], "the real bridge references no credential/env/askpass/mint material and builds its signal from String(chunk)");

      const clean = 'const sub = term.onData((chunk) => { push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk))); });';
      const plantedEnvRead = 'const sub = term.onData((chunk) => { const token = process.env.AOF_MESH_CLONE_TOKEN; push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk) + token)); });';
      assert.notEqual(plantedEnvRead, clean, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(credentialSourceProblems(clean), [], "the clean synthesized shape stays quiet");
      assert.ok(credentialSourceProblems(plantedEnvRead).length > 0, "self-check: a planted process.env credential read trips the detector");

      const plantedAskpassRead = 'const sub = term.onData((chunk) => { const askpass = loadOneShotSecretFile(); push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk) + askpass)); });';
      assert.notEqual(plantedAskpassRead, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(credentialSourceProblems(plantedAskpassRead).length > 0, "self-check: a planted askpass-file read trips the detector");
    },
  },

  // ══ invariant #5 — the fleet page stays a MONITOR; the board dock is the ONE
  // interactive surface, and its remote lane is real ══
  {
    name: "arch/42 terminal-input: ui/src/fleet still wires NO input source and sends on NO socket (the monitor posture); the board dock's remote lane EXISTS (onData -> socket.send, the remote badge, the terminal-view dial)",
    async run() {
      const files = await listSourceFiles(FLEET_UI_DIR);
      assert.ok(files.length > 0, "the fleet UI surface is found");

      const offenders = [];
      const routeConsumers = [];
      for (const file of files) {
        const source = await realSource(file);
        const relative = path.relative(repoRoot, file);
        if (TERMINAL_INPUT_SOURCE.test(source)) offenders.push(`${relative} wires a terminal input source (onData/onKey/onBinary/attachCustomKeyEventHandler)`);
        if (browserSocketSend(source)) offenders.push(`${relative} sends on a socket — the fleet page originates no frame`);
        if (/terminalViewSocketUrl|\/ws\/terminal-view|TERMINAL_VIEW_PATH/.test(source)) routeConsumers.push(relative);
      }
      assert.deepEqual(offenders, [], "the fleet page remains a monitor — the interactive surface is the BOARD DOCK, deliberately (one terminal surface, m42 item 6)");

      // The fleet's read-only consumer still exists and is mounted (its absence is
      // how F-38.06c once hid).
      assert.ok(routeConsumers.length > 0, "the fleet surface still HAS its read-only /ws/terminal-view consumer");
      const fleetPage = await realSource(path.join(FLEET_UI_DIR, "Fleet.tsx"));
      assert.ok(/FleetTerminalView/.test(fleetPage), "the fleet page still MOUNTS the terminal view");

      // The DOCK's interactive lanes are REAL (non-vacuity + the positive half of
      // the operator's override): input wiring, the remote badge, and the
      // tuple-carrying terminal-view dial all exist.
      const dockSource = await realSource(BOARD_TERMINAL_DOCK);
      // RAW (comment-unstripped) for the dial check ONLY: the dock builds its URL
      // in a template literal whose `ws://` reads as a line comment to the
      // stripper, truncating the very line the detector needs.
      const dockRaw = lf(await readFile(BOARD_TERMINAL_DOCK, "utf8"));
      assert.ok(TERMINAL_INPUT_SOURCE.test(dockSource), "the dock wires term.onData — the input direction is real");
      assert.ok(browserSocketSend(dockSource), "the dock sends on its socket — keystrokes genuinely travel");
      assert.ok(/\/ws\/terminal-view/.test(dockRaw), "the dock's remote lane dials the tuple-bound /ws/terminal-view route");
      assert.ok(/remote\s*·/.test(dockSource), "the dock's remote badge exists — a remote session SAYS it is remote (never colour alone)");
      assert.ok(
        !/disableStdin:\s*true/.test(dockSource),
        "the dock no longer constructs a read-only xterm — the read-only posture was operator-overridden; a half-disabled widget would swallow keystrokes silently",
      );

      // And the worker's own local /ws/terminal is untouched by this feature.
      const terminalWsSource = await realSource(TERMINAL_WS);
      assert.ok(/term\.write\s*\(/.test(terminalWsSource), "terminal-ws.mjs (the board's local /ws/terminal) still writes its own PTY — unchanged");
    },
  },

  // ══ behavioural — the REAL route: tuple-bound push, smuggle-proof, clean degrade ══
  {
    name: "arch/42 terminal-input (behavioural): a keystroke arrives as a terminal-input envelope carrying the SOCKET's tuple — a payload-smuggled tuple stays opaque bytes; an unconfigured route stays output-only and the mirror stream survives",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-terminal-input-fitness-"));
      const root = path.join(tmp, "repo");
      const distRoot = path.join(tmp, "dist");
      const home = path.join(tmp, "home");
      let server;
      let bareServer;
      try {
        await mkdir(path.join(root, ".aof"), { recursive: true });
        await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" } }, null, 2)}\n`, "utf8");
        await mkdir(path.join(meshUiDist(distRoot), "assets"), { recursive: true });
        await writeFile(path.join(meshUiDist(distRoot), "index.html"), "<!doctype html><html><body></body></html>\n", "utf8");
        await writeFile(path.join(meshUiDist(distRoot), "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");

        // ── the CONFIGURED route: keystrokes become tuple-bound envelopes ──
        const pushed = [];
        const mirror = createTerminalMirror();
        ({ server } = await serveMeshUi({
          projectDir: root, port: 0, repoRoot: distRoot,
          globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          terminalMirror: mirror,
          terminalInputPush: { push: (envelope) => { pushed.push(envelope); } },
        }));
        const port = server.address().port;
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal-view?nodeId=node-a&sessionId=sess-1`);
        await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });

        ws.send("an operator answer\r");
        // The SMUGGLE: a JSON payload naming a DIFFERENT tuple — it must arrive as
        // opaque BYTES under the socket's own tuple, never as routing.
        ws.send('{"nodeId":"victim-node","sessionId":"stolen-sess","bytes":"evil"}');
        await new Promise((resolve, reject) => {
          const start = Date.now();
          const tick = () => {
            if (pushed.length >= 2) return resolve();
            if (Date.now() - start > 1500) return reject(new Error("timeout waiting for the pushed input envelopes"));
            setTimeout(tick, 5);
          };
          tick();
        });
        assert.equal(pushed[0].kind, TERMINAL_INPUT_KIND);
        assert.equal(pushed[0].nodeId, "node-a", "the envelope carries the SOCKET's nodeId");
        assert.equal(pushed[0].signal.sessionId, "sess-1", "the envelope carries the SOCKET's sessionId");
        assert.equal(pushed[0].signal.bytes, "an operator answer\r", "the bytes ride verbatim");
        assert.equal(pushed[1].nodeId, "node-a", "a smuggled tuple does NOT reroute the envelope");
        assert.equal(pushed[1].signal.sessionId, "sess-1", "a smuggled tuple does NOT reroute the envelope");
        assert.equal(pushed[1].signal.bytes, '{"nodeId":"victim-node","sessionId":"stolen-sess","bytes":"evil"}', "the smuggle arrives as opaque BYTES — content-blind");
        ws.close();

        // ── the UNCONFIGURED route: output-only, no echo, stream intact ──
        const bareMirror = createTerminalMirror();
        ({ server: bareServer } = await serveMeshUi({
          projectDir: root, port: 0, repoRoot: distRoot,
          globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          terminalMirror: bareMirror,
        }));
        const barePort = bareServer.address().port;
        const bareWs = new WebSocket(`ws://127.0.0.1:${barePort}/ws/terminal-view?nodeId=node-a&sessionId=sess-1`);
        const received = [];
        await new Promise((resolve, reject) => { bareWs.on("open", resolve); bareWs.on("error", reject); });
        bareWs.on("message", (data) => received.push(data.toString()));
        bareWs.send("a keystroke with no input lane configured\r");
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(bareWs.readyState, WebSocket.OPEN, "the connection survives a client-sent keystroke (no crash)");
        assert.equal(received.length, 0, "the client received NOTHING back — no echo, no sink");
        bareMirror.apply(buildTerminalFrameEnvelope("node-a", "sess-1", "still streaming after the keystroke\n"));
        await new Promise((resolve, reject) => {
          const start = Date.now();
          const tick = () => {
            if (received.length >= 1) return resolve();
            if (Date.now() - start > 1500) return reject(new Error("timeout waiting for the post-keystroke frame"));
            setTimeout(tick, 5);
          };
          tick();
        });
        assert.equal(received[0], "still streaming after the keystroke\n");
        bareWs.close();
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        if (bareServer) await new Promise((resolve) => bareServer.close(resolve));
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
];
