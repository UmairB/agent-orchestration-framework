// Fitness function: acd-fleet-terminal-mirror-read-only (milestone 38 / story 06;
// ARCHITECTURE ADR-014; SECURITY T14).
//
// "No source consuming a relay terminal-frame (or a fleet terminal-VIEW message)
//  calls `term.write` / feeds a worker PTY stdin (no mesh->PTY input path); the
//  relay envelope is untouched (terminal bytes ride the opaque `signal` as a new
//  `kind`, no JSON-parse-then-branch on terminal content); the fleet mirror
//  writes no durable record (the mesh-presence-subscriber in-memory discipline);
//  the signal is sourced ONLY from term.onData — no credential material."
//
// Arms ADR-014's FOUR structural invariants:
//   1. NO mesh->PTY input path — no source that consumes a relay terminal-frame
//      or a fleet terminal-VIEW message calls term.write / feeds a worker PTY's
//      stdin; the terminal-VIEW route is send-to-browser only.
//   2. The relay envelope is untouched — mesh-relay.mjs is UNMODIFIED by this
//      story (re-armed structurally: the bridge/mirror never reach into the
//      relay's own parseEnvelope/fan-out).
//   3. The fleet mirror is in-memory + never a system of record.
//   4. Routing is by (nodeId, sessionId) — arms via the wiring modules only
//      naming the sanctioned bridge/mirror seam (covered by tasks 00/01's own
//      producer-fed tests; this fitness focuses on the READ-ONLY + STATELESS
//      structural half, its OWN name).
//
// STRUCTURAL half: source-analysis over the REAL src/mesh-terminal-relay-
// bridge.mjs, src/mesh-terminal-mirror.mjs, and the terminal-VIEW upgrade block
// of src/mesh-ui-serve.mjs (comments discounted, CRLF-normalised — the repo's
// tree is CRLF; an "\n"-only needle would silently no-op against the checked-out
// file, the exact failure class this milestone was repeatedly burned by).
// BEHAVIOURAL half: the REAL serveMeshUi server proves a fleet keystroke reaches
// no sink (task 02 scenario 2).
//
// Every plant is a HAND-WRITTEN synthesized snippet (never a string-replace on a
// real file, the acd-clone-credential-pull-not-pushed / acd-fleet-face-single-
// mutation-route convention) — each plant asserts it LANDED
// (`assert.notEqual(planted, clean)`) before asserting the detector trips on it
// and stays quiet on the clean baseline.
//
// EXTENDED at milestone 38 / story 06 / task 04 (BLOCKER F-38.06c) — the invariant
// now has a BROWSER CONSUMER to police. Until this task the fleet had NO
// terminal-view surface at all (`terminal-view` matched 0 files under `ui/`), so
// the structural "no mesh->PTY input path" gate could only ever look at the server
// side. It now also polices `ui/src/fleet/` — the ONE surface a browser-originated
// frame could enter from — with BOTH halves R5(m03) demands: the NEGATIVE
// (no input path exists anywhere on the fleet surface) AND the POSITIVE (the
// read-only consumer + its explicit read-only LABEL genuinely EXIST — the absence
// of a violation in an absent component is not evidence, which is precisely how
// F-38.06c hid).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";
import { createTerminalMirror } from "../../src/mesh-terminal-mirror.mjs";
import { buildTerminalFrameEnvelope } from "../../src/mesh-terminal-relay-bridge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRIDGE = path.join(repoRoot, "src", "mesh-terminal-relay-bridge.mjs");
const MIRROR = path.join(repoRoot, "src", "mesh-terminal-mirror.mjs");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");
// The BROWSER half of the invariant (task 04): the whole fleet UI surface, and the
// read-only terminal-VIEW component that lives on it.
const FLEET_UI_DIR = path.join(repoRoot, "ui", "src", "fleet");
const FLEET_TERMINAL_VIEW = path.join(FLEET_UI_DIR, "terminal-view", "FleetTerminalView.tsx");
// The board dock — scanned, never modified: it is the surface that legitimately
// DOES wire browser->PTY input (a human logged into their OWN machine's board),
// so it proves the detectors below are non-vacuous against a real, shipped,
// input-forwarding terminal.
const BOARD_TERMINAL_DOCK = path.join(repoRoot, "ui", "src", "board", "TerminalDock.tsx");
// task 02 scenario 2's OTHER half — "the worker's OWN local /ws/terminal stays
// bidirectional ... this invariant governs the MESH/fleet path only". Scanned
// (never modified) to prove this story's read-only additions did NOT regress
// the pre-existing local terminal's input direction.
const TERMINAL_WS = path.join(repoRoot, "src", "terminal-ws.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF -> LF before every regex probe (the repo's tree is
// checked out CRLF; a "\n"-only needle would silently no-op — the milestone's own
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

// --- detector #1 — NO mesh->PTY input path: no term.write/pty.write anywhere in
// the bridge/mirror modules, and NO ws.on("message", ...) inside the fleet's
// terminal-VIEW upgrade block (send-to-browser only — there is no sink) ---

const PTY_WRITE = /\b(?:term|pty)\.write\s*\(/;

function inputPathProblems({ bridgeSource, mirrorSource, upgradeBlock }) {
  const problems = [];
  if (PTY_WRITE.test(bridgeSource)) problems.push("mesh-terminal-relay-bridge.mjs calls term.write/pty.write — a mesh->PTY input path exists");
  if (PTY_WRITE.test(mirrorSource)) problems.push("mesh-terminal-mirror.mjs calls term.write/pty.write — a mesh->PTY input path exists");
  if (upgradeBlock == null) {
    problems.push("could not locate the terminal-VIEW upgrade block in mesh-ui-serve.mjs");
    return problems;
  }
  if (/ws\.on\(\s*["']message["']/.test(upgradeBlock)) {
    problems.push('the terminal-VIEW upgrade block registers a ws.on("message", ...) handler — the route must be send-to-browser only');
  }
  if (PTY_WRITE.test(upgradeBlock)) {
    problems.push("the terminal-VIEW upgrade block calls term.write/pty.write directly");
  }
  return problems;
}

// --- detector #2 — the fleet mirror writes NO durable record (the
// mesh-presence-subscriber in-memory discipline, m23/ADR-004, applied to the
// terminal mirror + bridge) ---

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

// --- detector #3 — the streamed signal is sourced ONLY from term.onData —
// credential material never rides the bridge's signal (SECURITY T14) ---

const CREDENTIAL_NEEDLE = /\b(?:process\.env|askpass|credential|mint(?:CloneCredential|WriteCredential)?|GIT_ASKPASS|apiKey|privateKey|appPrivateKey)\b/i;

function credentialSourceProblems(bridgeSource) {
  const problems = [];
  if (CREDENTIAL_NEEDLE.test(bridgeSource)) {
    problems.push("mesh-terminal-relay-bridge.mjs references credential/env/askpass/mint material — the signal must be sourced EXCLUSIVELY from term.onData");
  }
  // The bridge's per-chunk envelope build must read its bytes from EXACTLY the
  // onData callback's own parameter (String(chunk)) — never a second data
  // source spliced in beside it.
  if (!/String\s*\(\s*chunk\s*\)/.test(bridgeSource)) {
    problems.push("wireTerminalBridge does not build its signal from String(chunk) — the onData callback's own parameter");
  }
  return problems;
}

// --- detector #4 (task 04) — the fleet's BROWSER terminal-VIEW is a MONITOR ---
//
// The two halves, per R5(m03) ("a fitness asserts the presence of what SHOULD
// exist, not merely the absence of what shouldn't"):
//
//   NEGATIVE — no browser-originated frame can travel UP the terminal-view socket,
//   and no terminal INPUT SOURCE is wired: no `.send(` on the socket, no
//   `onData`->socket path (the direction the board dock DOES wire), no text input /
//   textarea / contenteditable / send-labelled control. The input row a read-write
//   terminal would spend is ABSENT, not disabled (DESIGN §Surface 3 V2/V5).
//
//   POSITIVE — the read-only consumer genuinely EXISTS and is read-only IN LOOK:
//   it dials the sanctioned `/ws/terminal-view` seam, constructs its xterm with
//   `disableStdin: true` (read-only IN FACT at the widget, not merely un-wired),
//   carries an explicit read-only LABEL (never colour alone, V2/V6), and reuses the
//   board's `@xterm/xterm` idiom rather than inventing a fleet-local terminal (V3).
//
// NOTE on `terminal.write(...)` in the browser: that is the RENDER direction —
// server-sent bytes painted into an xterm SCREEN. There is no PTY, no child
// process and no stdin on the browser side, so ADR-014 invariant 1's `term.write`
// clause (which governs a source feeding a WORKER's PTY stdin — the bridge, the
// mirror, the route, all covered by detector #1 above) cannot bind here. What binds
// on this surface is the browser->socket direction, which is what this detector
// polices.

// WIDENED at the architect's structural review (S2, 2026-07-23) — both detectors
// were NARROWER than the failure messages they print, measured by exhaustive probe.
//
//   `BROWSER_SOCKET_SEND` used to be an alternation of RECEIVER NAMES
//   (socket|ws|websocket|conn|connection|channel). It caught `socket.send` /
//   `ws.send` / `view.socket.send` but EVADED `socketRef.current.send`,
//   `wsRef.current.send` (the React-ref shape this very component would use if it
//   ever held its socket in a ref), `mirrorSocket.send`, and `this.sock.send`. A
//   detector that a rename defeats is not an invariant. It is now RECEIVER-AGNOSTIC
//   — ANY `.send(` — qualified by the file NAMING a `WebSocket`, which is what makes
//   it a socket-send rather than a mail/analytics/postMessage send. (Comments are
//   stripped before these run, so a file that merely MENTIONS WebSocket in prose —
//   e.g. fleet/Fleet.tsx's "the client opens no WebSocket" — is not armed by it.)
//
//   `TERMINAL_INPUT_SOURCE` used to be `.onData(` alone — the ONE xterm input event
//   the board dock happens to use. xterm exposes three more ways to read the
//   keyboard (`onKey`, `onBinary`, and `attachCustomKeyEventHandler`), each of which
//   would carry a keystroke off the widget just as effectively, and each of which
//   the old regex waved through.
const SOCKET_NAMED = /\bWebSocket\b/;
const ANY_SEND_CALL = /\.\s*send\s*\(/;
const TERMINAL_INPUT_SOURCE = /\.\s*(?:onData|onKey|onBinary)\s*\(|\battachCustomKeyEventHandler\s*\(/;
const TEXT_INPUT_AFFORDANCE = /<\s*(?:input|textarea)\b|contentEditable|role\s*=\s*["']textbox["']/i;
const SEND_CONTROL_AFFORDANCE = /(?:aria-label|title|placeholder)\s*=\s*["'][^"']*\bsend\b/i;

// browserSocketSend(source) — "this file holds a WebSocket AND calls .send() on
// something". The two halves together are what make it a browser->server frame; a
// file with neither, or with only one, is quiet.
function browserSocketSend(source) {
  return SOCKET_NAMED.test(source) && ANY_SEND_CALL.test(source);
}

function fleetTerminalViewProblems(source) {
  const problems = [];
  // ── the NEGATIVE half ──
  if (browserSocketSend(source)) {
    problems.push("the fleet terminal-view sends on its socket — a browser-originated frame up the terminal-view socket (the route is server->browser ONLY)");
  }
  if (TERMINAL_INPUT_SOURCE.test(source)) {
    problems.push("the fleet terminal-view wires a terminal input source (onData/onKey/onBinary/attachCustomKeyEventHandler) — the direction the board dock forwards to its PTY");
  }
  if (TEXT_INPUT_AFFORDANCE.test(source)) {
    problems.push("the fleet terminal-view renders a text input / textarea / contenteditable — the input row must be ABSENT, not disabled");
  }
  if (SEND_CONTROL_AFFORDANCE.test(source)) {
    problems.push("the fleet terminal-view renders a send/submit control");
  }
  // ── the POSITIVE half ──
  if (!/terminalViewSocketUrl|\/ws\/terminal-view/.test(source)) {
    problems.push("the fleet terminal-view does not resolve the sanctioned read-only /ws/terminal-view seam");
  }
  if (/["'`]\/ws\/terminal["'`]|\/ws\/terminal\?/.test(source)) {
    problems.push("the fleet terminal-view dials the board's BIDIRECTIONAL /ws/terminal route — the fleet face serves only the read-only mirror");
  }
  if (!/resolveTerminalStream/.test(source)) {
    problems.push("the fleet terminal-view does not resolve its tuple through the sanctioned resolver — a card must never assemble a (nodeId, sessionId) itself (ADR-014 inv.4: no guessed, defaulted or sibling session)");
  }
  if (!/disableStdin:\s*true/.test(source)) {
    problems.push("the fleet terminal-view's xterm is not constructed read-only (disableStdin: true) — read-only must hold IN FACT, not merely by omission");
  }
  if (!/readOnlyLabel|read-only/.test(source)) {
    problems.push("the fleet terminal-view carries no explicit read-only LABEL — the posture may not rest on colour or the absence of an input box alone");
  }
  if (!/@xterm\/xterm/.test(source)) {
    problems.push("the fleet terminal-view does not reuse the board dock's xterm rendering idiom");
  }
  return problems;
}

// listSourceFiles(dir) — every .ts/.tsx/.mjs file under a UI directory, recursively.
// The WHOLE-SURFACE scope R5(m03) calls for: "no input path exists outside the
// sanctioned seam" is only an invariant if it is asked of the entire surface, not
// of the one file we happen to remember to scan.
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
  // ══ invariant #1 — NO mesh->PTY input path ══
  {
    name: "arch/38 ADR-014 inv.1: no source consuming a relay terminal-frame or a fleet terminal-VIEW message calls term.write — the terminal-VIEW route is send-to-browser ONLY",
    async run() {
      const bridgeSource = await realSource(BRIDGE);
      const mirrorSource = await realSource(MIRROR);
      const uiSource = await realSource(MESH_UI_SERVE);
      const upgradeBlock = extractUpgradeBlock(uiSource);
      assert.ok(upgradeBlock != null, "the terminal-VIEW upgrade block is found in the real mesh-ui-serve.mjs source");
      assert.deepEqual(
        inputPathProblems({ bridgeSource, mirrorSource, upgradeBlock }),
        [],
        "the real bridge/mirror/fleet-route source has NO mesh->PTY input path",
      );

      // PLANT — a synthesized input-forwarding path: a terminal-VIEW message
      // routed into term.write. Must trip the detector — "ADDING such a path
      // FAILS CI".
      const cleanBlock = stripComments(`
        server.on("upgrade", (request, socket, head) => {
          terminalViewWss.handleUpgrade(request, socket, head, (ws) => {
            const unsubscribe = mirror.subscribe(nodeId, sessionId, (bytes) => { ws.send(bytes); });
            ws.on("close", unsubscribe);
          });
        });
      `);
      const plantedInputForward = stripComments(`
        server.on("upgrade", (request, socket, head) => {
          terminalViewWss.handleUpgrade(request, socket, head, (ws) => {
            const unsubscribe = mirror.subscribe(nodeId, sessionId, (bytes) => { ws.send(bytes); });
            ws.on("message", (data) => { term.write(data); });
            ws.on("close", unsubscribe);
          });
        });
      `);
      assert.notEqual(plantedInputForward, cleanBlock, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(
        inputPathProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(cleanBlock) ?? cleanBlock }),
        [],
        "the clean synthesized upgrade block stays quiet",
      );
      const plantedProblems = inputPathProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(plantedInputForward) ?? plantedInputForward });
      assert.ok(plantedProblems.length > 0, "self-check: a planted terminal-VIEW message->term.write forwarding path trips the detector");

      // PLANT — a message handler that forwards toward the relay (a DIFFERENT
      // input-forwarding shape — still trips, since ANY ws.on("message", ...) on
      // this route is forbidden).
      const plantedRelayForward = stripComments(`
        server.on("upgrade", (request, socket, head) => {
          terminalViewWss.handleUpgrade(request, socket, head, (ws) => {
            ws.on("message", (data) => { relayClient.push(buildTerminalFrameEnvelope(nodeId, sessionId, data)); });
          });
        });
      `);
      assert.notEqual(plantedRelayForward, cleanBlock, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        inputPathProblems({ bridgeSource: "", mirrorSource: "", upgradeBlock: extractUpgradeBlock(plantedRelayForward) ?? plantedRelayForward }).length > 0,
        "self-check: a planted terminal-VIEW message->relay-push forwarding path trips the detector too",
      );

      // PLANT — a direct term.write/pty.write in the bridge module.
      const cleanBridgeLine = "const sub = term.onData((chunk) => { push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk))); });";
      const plantedBridgeWrite = "const sub = term.onData((chunk) => { term.write(chunk); push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk))); });";
      assert.notEqual(plantedBridgeWrite, cleanBridgeLine, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(inputPathProblems({ bridgeSource: cleanBridgeLine, mirrorSource: "", upgradeBlock: cleanBlock }), [], "the clean bridge line stays quiet");
      assert.ok(
        inputPathProblems({ bridgeSource: plantedBridgeWrite, mirrorSource: "", upgradeBlock: cleanBlock }).length > 0,
        "self-check: a planted term.write( inside the bridge trips the detector",
      );
    },
  },

  // ══ invariant #3 — the fleet mirror is in-memory + never a system of record ══
  {
    name: "arch/38 ADR-014 inv.3: the bridge + mirror write NO durable record — no writeText/writeFile, no write/persist-seam import, no presenceRecordPath/publishPresenceRecord reference",
    async run() {
      const bridgeSource = await realSource(BRIDGE);
      const mirrorSource = await realSource(MIRROR);
      assert.deepEqual(durabilityProblems({ bridgeSource, mirrorSource }), [], "the real bridge + mirror modules are durable-write-free");

      // PLANT — a durable write in the mirror (a persisted transcript).
      const clean = 'export function createTerminalMirror() { const listenersByKey = new Map(); return { apply(envelope) { return true; } }; }';
      const plantedDurableWrite = 'import { writeText } from "./fs.mjs";\nexport function createTerminalMirror() { return { apply(envelope) { writeText("./transcript.log", envelope.signal.bytes); return true; } }; }';
      assert.notEqual(plantedDurableWrite, clean, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(durabilityProblems({ bridgeSource: clean, mirrorSource: clean }), [], "the clean synthesized shape stays quiet");
      assert.ok(
        durabilityProblems({ bridgeSource: clean, mirrorSource: plantedDurableWrite }).length > 0,
        "self-check: a planted durable write (writeText) of streamed bytes trips the detector",
      );

      // PLANT — a persist-seam import (mesh-store.mjs) with no direct write call.
      const plantedPersistImport = 'import { presenceRecordPath } from "./mesh-store.mjs";\nexport function createTerminalMirror() { return { apply(envelope) { return true; } }; }';
      assert.notEqual(plantedPersistImport, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        durabilityProblems({ bridgeSource: clean, mirrorSource: plantedPersistImport }).length > 0,
        "self-check: a planted mesh-store.mjs / presenceRecordPath import trips the detector",
      );
    },
  },

  // ══ the signal is sourced ONLY from term.onData — no credential material ══
  {
    name: "arch/38 SECURITY T14: the bridge's streamed signal is sourced ONLY from term.onData — no credential env / askpass / mint reply ever enters it",
    async run() {
      const bridgeSource = await realSource(BRIDGE);
      assert.deepEqual(credentialSourceProblems(bridgeSource), [], "the real bridge references no credential/env/askpass/mint material and builds its signal from String(chunk)");

      // PLANT — the bridge reaches into process.env for a token and folds it
      // into the signal.
      const clean = 'const sub = term.onData((chunk) => { push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk))); });';
      const plantedEnvRead = 'const sub = term.onData((chunk) => { const token = process.env.AOF_MESH_CLONE_TOKEN; push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk) + token)); });';
      assert.notEqual(plantedEnvRead, clean, "the plant actually differs from the clean synthesized shape");
      assert.deepEqual(credentialSourceProblems(clean), [], "the clean synthesized shape stays quiet");
      assert.ok(credentialSourceProblems(plantedEnvRead).length > 0, "self-check: a planted process.env credential read trips the detector");

      // PLANT — an askpass-file read folded into the signal.
      const plantedAskpassRead = 'const sub = term.onData((chunk) => { const askpass = loadOneShotSecretFile(); push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk) + askpass)); });';
      assert.notEqual(plantedAskpassRead, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(credentialSourceProblems(plantedAskpassRead).length > 0, "self-check: a planted askpass-file read trips the detector");
    },
  },

  // ══ invariant #1, BROWSER half (task 04 / F-38.06c) — the fleet's terminal-VIEW
  // component is a MONITOR: no input affordance exists in it ══
  {
    name: "arch/38 ADR-014 inv.1 + T14 (task 04): the fleet terminal-VIEW component opens its socket read-only — no browser-originated frame, no onData input source, no input affordance — and SAYS it is read-only",
    async run() {
      const viewSource = await realSource(FLEET_TERMINAL_VIEW);
      assert.deepEqual(
        fleetTerminalViewProblems(viewSource),
        [],
        "the REAL fleet terminal-view component is clean: read-only in fact (no send, no onData, no input affordance, disableStdin) AND read-only in look (an explicit label)",
      );

      // A clean SYNTHESIZED baseline carrying every sanctioned marker — each plant
      // below is a hand-written mutation of THIS shape (never a string-replace on
      // the real file), and asserts it LANDED before asserting the detector trips.
      const clean = stripComments(`
        import { Terminal } from "@xterm/xterm";
        import { resolveTerminalStream, terminalViewSocketUrl } from "./stream.mjs";
        export function FleetTerminalView({ assignment }) {
          const stream = resolveTerminalStream(assignment);
          const terminal = new Terminal({ disableStdin: true, cursorBlink: false });
          const socket = new WebSocket(terminalViewSocketUrl(stream, location));
          socket.onmessage = (event) => { terminal.write(event.data); };
          return (<section><header>{header.label} <span>{header.readOnlyLabel}</span></header><div ref={viewportRef} /></section>);
        }
      `);
      assert.deepEqual(fleetTerminalViewProblems(clean), [], "the clean synthesized fleet-view shape stays quiet");

      // PLANT — a browser-originated frame pushed up the terminal-view socket.
      const plantedSocketSend = clean.replace(
        "socket.onmessage = (event) => { terminal.write(event.data); };",
        "socket.onmessage = (event) => { terminal.write(event.data); };\n          socket.send(pendingInput);",
      );
      assert.notEqual(plantedSocketSend, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        fleetTerminalViewProblems(plantedSocketSend).length > 0,
        "self-check: a planted browser->socket send trips the detector — ADDING one FAILS CI",
      );

      // PLANT — the board dock's OWN input direction (onData -> socket), moved onto
      // the fleet view. This is the exact regression the read-only carve-out forbids.
      const plantedOnData = clean.replace(
        "socket.onmessage",
        "terminal.onData((input) => { socket.send(input); });\n          socket.onmessage",
      );
      assert.notEqual(plantedOnData, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        fleetTerminalViewProblems(plantedOnData).length > 0,
        "self-check: a planted onData->socket input path trips the detector",
      );

      // PLANT — a text input row (the "looks attachable, silently swallows
      // keystrokes" lie V2/V5 exist to prevent), and its disabled twin (a greyed
      // input falsely promising "coming soon" is ALSO forbidden — absent, not
      // disabled).
      const plantedInputRow = clean.replace("<div ref={viewportRef} />", '<div ref={viewportRef} /><input type="text" />');
      assert.notEqual(plantedInputRow, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(fleetTerminalViewProblems(plantedInputRow).length > 0, "self-check: a planted text input row trips the detector");

      const plantedDisabledInputRow = clean.replace("<div ref={viewportRef} />", '<div ref={viewportRef} /><input disabled type="text" />');
      assert.notEqual(plantedDisabledInputRow, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(fleetTerminalViewProblems(plantedDisabledInputRow).length > 0, "self-check: even a DISABLED input row trips — the row must be absent, not greyed");

      // PLANT — a send control.
      const plantedSendControl = clean.replace("<div ref={viewportRef} />", '<div ref={viewportRef} /><button aria-label="Send to worker">↵</button>');
      assert.notEqual(plantedSendControl, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(fleetTerminalViewProblems(plantedSendControl).length > 0, "self-check: a planted send control trips the detector");

      // PLANT (the POSITIVE half, R5/m03) — the read-only LABEL removed: a view
      // that is read-only in fact but says nothing reads as an attachable shell.
      const plantedNoLabel = clean.replace("<span>{header.readOnlyLabel}</span>", "<span />");
      assert.notEqual(plantedNoLabel, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(fleetTerminalViewProblems(plantedNoLabel).length > 0, "self-check: dropping the explicit read-only label trips the detector");

      // PLANT (the POSITIVE half) — the xterm widget made keystroke-accepting.
      const plantedStdinEnabled = clean.replace("disableStdin: true", "cursorBlink: true");
      assert.notEqual(plantedStdinEnabled, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(fleetTerminalViewProblems(plantedStdinEnabled).length > 0, "self-check: an xterm constructed WITHOUT disableStdin trips the detector");

      // PLANT (the POSITIVE half) — the component quietly re-pointed at the board's
      // BIDIRECTIONAL /ws/terminal route instead of the read-only mirror.
      const plantedWrongRoute = clean
        .split("terminalViewSocketUrl")
        .join("boardTerminalUrl")
        .replace("boardTerminalUrl(stream, location)", 'boardTerminalUrl("/ws/terminal")');
      assert.notEqual(plantedWrongRoute, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(fleetTerminalViewProblems(plantedWrongRoute).length > 0, "self-check: dialling anything but the sanctioned read-only seam trips the detector");

      // PLANT (the POSITIVE half) — the tuple hand-assembled from raw row fields
      // instead of resolved: the shape in which a "helpful" default or a sibling
      // session leaks in (ADR-014 inv.4).
      const plantedHandAssembledTuple = clean
        .split("resolveTerminalStream")
        .join("guessStream")
        .replace(
          "terminalViewSocketUrl(stream, location)",
          "`ws://${location.host}/ws/terminal-view?nodeId=${assignment.targetNodeId}&sessionId=${assignment.sessionId ?? lastKnownSession}`",
        );
      assert.notEqual(plantedHandAssembledTuple, clean, "the plant actually differs from the clean synthesized shape");
      assert.ok(
        fleetTerminalViewProblems(plantedHandAssembledTuple).length > 0,
        "self-check: hand-assembling the (nodeId, sessionId) tuple (the shape a defaulted/sibling session leaks through) trips the detector",
      );

      // ── S2 (architect's structural review, 2026-07-23) — the detectors are WIDER
      // than the one shape the board dock happens to use. Every send below EVADED
      // the previous receiver-name alternation, and every input event below evaded
      // the previous `.onData(`-only regex; each is a hand-written synthesized
      // snippet (never a mutation written into a real file). ──
      for (const send of [
        "socketRef.current.send(pendingInput);",
        "wsRef.current.send(pendingInput);",
        "mirrorSocket.send(pendingInput);",
        "this.sock.send(pendingInput);",
        "sendRef.current?.send(pendingInput);",
      ]) {
        const planted = clean.replace(
          "socket.onmessage = (event) => { terminal.write(event.data); };",
          `socket.onmessage = (event) => { terminal.write(event.data); };\n          ${send}`,
        );
        assert.notEqual(planted, clean, `the plant (${send}) actually differs from the clean synthesized shape`);
        assert.ok(
          fleetTerminalViewProblems(planted).length > 0,
          `self-check: a browser->socket send written as \`${send}\` trips — the detector is receiver-AGNOSTIC, so a rename cannot defeat it`,
        );
      }
      for (const input of [
        "terminal.onKey(({ key }) => { socketRef.current.send(key); });",
        "terminal.onBinary((data) => { socketRef.current.send(data); });",
        "terminal.attachCustomKeyEventHandler((event) => { socketRef.current.send(event.key); return false; });",
      ]) {
        const planted = clean.replace("socket.onmessage", `${input}\n          socket.onmessage`);
        assert.notEqual(planted, clean, `the plant (${input}) actually differs from the clean synthesized shape`);
        assert.ok(
          fleetTerminalViewProblems(planted).length > 0,
          `self-check: the xterm input event \`${input.slice(0, 28)}…\` trips — onData is not the only way to read the keyboard`,
        );
      }

      // …and the WebSocket qualifier still discriminates: a `.send(` on a file that
      // holds no socket at all (a mail/analytics/postMessage send) is NOT a
      // browser->server terminal frame and must stay quiet, or the detector would
      // be noise rather than an invariant.
      assert.equal(
        browserSocketSend(stripComments("export function report(beacon) { beacon.send({ event: 'card-opened' }); }")),
        false,
        "self-check: a .send( on a file that names no WebSocket is not a socket send — the qualifier keeps the detector honest",
      );
      assert.equal(
        browserSocketSend(stripComments("const socket = new WebSocket(url); socket.onmessage = (e) => paint(e.data);")),
        false,
        "self-check: holding a WebSocket without ever sending on it is exactly the read-only shape — quiet",
      );
    },
  },

  // ══ invariant #1, WHOLE-SURFACE half (task 04 / F-38.06c) — the mesh->PTY input
  // path exists NOWHERE on the fleet browser surface, and the read-only consumer
  // that surface is supposed to HAVE genuinely exists ══
  {
    name: "arch/38 ADR-014 inv.1 (task 04, whole-surface): NO file under ui/src/fleet wires a terminal input source or sends on a socket — and the read-only terminal-VIEW consumer EXISTS and is mounted",
    async run() {
      const files = await listSourceFiles(FLEET_UI_DIR);
      assert.ok(files.length > 0, "the fleet UI surface is found");

      // ── NEGATIVE: whole-surface scope, not just the file we remembered to scan ──
      const offenders = [];
      const routeConsumers = [];
      for (const file of files) {
        const source = await realSource(file);
        const relative = path.relative(repoRoot, file);
        if (TERMINAL_INPUT_SOURCE.test(source)) offenders.push(`${relative} wires a terminal input source (onData/onKey/onBinary/attachCustomKeyEventHandler)`);
        if (browserSocketSend(source)) offenders.push(`${relative} sends on a socket — the fleet face originates no frame`);
        if (/terminalViewSocketUrl|\/ws\/terminal-view|TERMINAL_VIEW_PATH/.test(source)) routeConsumers.push(relative);
      }
      assert.deepEqual(offenders, [], "no mesh->PTY input path exists ANYWHERE on the fleet browser surface");

      // ── NON-VACUITY, against a REAL shipped file (no plant needed): the SAME two
      // detectors DO fire on the board dock, which legitimately wires
      // onData -> socket.send for a human typing into their OWN machine's PTY. A
      // detector that stays quiet on the fleet surface only because it is quiet
      // everywhere would be worthless — this proves it is not. ──
      const dockSource = await realSource(BOARD_TERMINAL_DOCK);
      assert.ok(TERMINAL_INPUT_SOURCE.test(dockSource), "non-vacuous: the board dock's REAL onData input source is detected");
      assert.ok(browserSocketSend(dockSource), "non-vacuous: the board dock's REAL socket.send is detected");

      // ── POSITIVE (R5/m03): what SHOULD exist does. F-38.06c was not a violation
      // in the code — it was the ABSENCE of the code, which a purely negative
      // invariant scores as a pass. So pin the consumer's existence, its home, and
      // its mount. ──
      assert.ok(
        routeConsumers.length > 0,
        "the fleet surface HAS a /ws/terminal-view consumer (its absence is exactly how F-38.06c passed a read-only-only gate)",
      );
      assert.deepEqual(
        routeConsumers.map((relative) => relative.split(path.sep).join("/")).sort(),
        ["ui/src/fleet/terminal-view/FleetTerminalView.tsx", "ui/src/fleet/terminal-view/stream.mjs"],
        "the terminal-view seam lives in EXACTLY the sanctioned module pair — the .mjs helper holding the logic and the thin .tsx consumer",
      );
      const fleetPage = await realSource(path.join(FLEET_UI_DIR, "Fleet.tsx"));
      assert.ok(/FleetTerminalView/.test(fleetPage), "the fleet page MOUNTS the terminal view — an unmounted component is the same hole one layer in");

      // And the read-only route is the ONLY terminal route the fleet surface names:
      // the board's bidirectional /ws/terminal must never appear here.
      for (const file of files) {
        const source = await realSource(file);
        assert.ok(
          !/["'`]\/ws\/terminal["'`]|\/ws\/terminal\?/.test(source),
          `${path.relative(repoRoot, file)} must not dial the board's BIDIRECTIONAL /ws/terminal route`,
        );
      }
    },
  },

  // ══ behavioural — at runtime the mirror is server->browser only; a fleet
  // keystroke reaches no worker PTY ══
  {
    name: "arch/38 ADR-014 (behavioural): the REAL fleet terminal-VIEW is server->browser only — a fake client's keystroke reaches no sink, the connection survives, and the SAME stream keeps working afterward",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-terminal-mirror-fitness-"));
      const root = path.join(tmp, "repo");
      const distRoot = path.join(tmp, "dist");
      const home = path.join(tmp, "home");
      let server;
      try {
        await mkdir(path.join(root, ".aof"), { recursive: true });
        await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" } }, null, 2)}\n`, "utf8");
        await mkdir(path.join(meshUiDist(distRoot), "assets"), { recursive: true });
        await writeFile(path.join(meshUiDist(distRoot), "index.html"), "<!doctype html><html><body></body></html>\n", "utf8");
        await writeFile(path.join(meshUiDist(distRoot), "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");

        const mirror = createTerminalMirror();
        ({ server } = await serveMeshUi({ projectDir: root, port: 0, repoRoot: distRoot, globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } }, terminalMirror: mirror }));
        const address = server.address();
        const baseUrl = `ws://127.0.0.1:${address.port}`;

        const ws = new WebSocket(`${baseUrl}/ws/terminal-view?nodeId=node-a&sessionId=sess-1`);
        const received = [];
        await new Promise((resolve, reject) => {
          ws.on("open", resolve);
          ws.on("error", reject);
        });
        ws.on("message", (data) => received.push(data.toString()));

        // When the fake client sends a keystroke / input frame up its socket.
        ws.send("a fleet-typed keystroke\n");
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Then the mirror forwards it onto NO relay terminal-input frame and
        // reaches NO worker PTY — there is no such sink. Observably: the
        // connection is still OPEN (no crash/close from the send), and the
        // client received NOTHING as a result of what it sent (no echo — the
        // route is send-to-browser only).
        assert.equal(ws.readyState, WebSocket.OPEN, "the connection survives a client-sent keystroke (no crash)");
        assert.equal(received.length, 0, "the client received NOTHING in response to its own sent keystroke — no echo, no sink");

        // And the worker's OWN local /ws/terminal stays bidirectional — this
        // invariant governs the MESH/fleet path ONLY (a human logged INTO the
        // worker still types locally). terminal-ws.mjs is scanned, never
        // modified, by this story: its own term.write input direction (the
        // client->server branch wireSession's ws.on("message") drives) is intact.
        const terminalWsSource = await realSource(TERMINAL_WS);
        assert.ok(
          /term\.write\s*\(/.test(terminalWsSource),
          "terminal-ws.mjs (the worker's own local /ws/terminal) still calls term.write — its bidirectional input path is UNCHANGED by this story's read-only mesh additions",
        );

        // And the SAME (node-a, sess-1) stream still genuinely works afterward —
        // the injected input did not corrupt or tear down the mirror/subscription.
        mirror.apply(buildTerminalFrameEnvelope("node-a", "sess-1", "still streaming after the keystroke\n"));
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

        ws.close();
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
];
