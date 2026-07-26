// Fitness function: acd-terminal-stream-transport-wired (milestone 38 / story 06;
// ARCHITECTURE ADR-014 AMENDMENT 2026-07-19 — closing BLOCKER F-38.06; SECURITY T14).
//
// THE COMPANION to acd-fleet-terminal-mirror-read-only. That fitness pins the
// READ-ONLY + STATELESS half of ADR-014; this one pins that the terminal bridge's
// PRODUCER is actually WIRED into a live cross-machine transport — which is exactly
// how story 06 shipped INERT (F-38.06).
//
// THE HYBRID TRANSPORT (ADR-014 AMENDMENT 2026-07-19). An option-(a) draft (start
// the mesh-relay broker and push the worker's frames to it) was FALSIFIED at source:
// `serveRelay` binds LOOPBACK ONLY (mesh-relay.mjs:622 `server.listen(port,
// "127.0.0.1", …)`), so a worker on another machine cannot reach it. The live
// fabric transport (control-stream-server.mjs:749) binds the FABRIC address on
// purpose. So the transport is a HYBRID, each leg on the transport its bind fits:
//   - CROSS-MACHINE leg (worker → control): the FABRIC. The worker sends a NEW
//     opaque `terminal-frame` kind UP its worker-stream-client → control-stream-
//     server connection (the only off-host-reachable transport).
//     control-stream-server BRANCHES terminal-frame BEFORE applyStreamFrame into an
//     `onTerminalFrame` sink — never store-applied, never persisted (inv.3).
//   - SAME-MACHINE leg (control → the SEPARATE `aof mesh ui` process): a LOOPBACK
//     relay. The control launcher runs serveRelay on the KNOWN port named in
//     config.mesh.relay.url; onTerminalFrame pushes each fabric-received frame into
//     it; the fleet-UI process subscribes over loopback via
//     createTerminalMirrorSubscriberTransport (UNCHANGED).
//
// THREE real-source gates (invariants 5/6/7 of the amendment):
//   5. WORKER PRODUCER SENDS OVER THE FABRIC — mesh-launcher.mjs supplies
//      `onOutputChunk` as a LITERAL key at the production createHandler({...}) call
//      site (never reachable only through the workerExecutionOptions test spread —
//      the F12 discipline) wired to `client.sendTerminalFrame` (the FABRIC send, NOT
//      the loopback-only serveRelay push), and worker-stream-client.mjs EXPOSES
//      `sendTerminalFrame`.
//   6. CONTROL BRIDGES FABRIC→LOOPBACK WITHOUT PERSISTING, ON A KNOWN PORT —
//      control-stream-server.mjs branches terminal-frame to an `onTerminalFrame`
//      sink; applyStreamFrame carries NO terminal-frame kind (never persisted); the
//      launcher passes `onTerminalFrame` at the startServer({...}) call site, starts
//      a serveRelay()/relayMode() broker, and binds it to a KNOWN port — never an
//      ephemeral `?? 0` (test isolation is via options.relay===false, not a random
//      production bind).
//   7. FLEET CONSUMER SUBSCRIBES OVER LOOPBACK — cli.mjs's `aof mesh ui` production
//      serveMeshUi({...}) call site supplies `startTerminalRelaySubscriber` as a
//      LITERAL key and the CLI references createTerminalMirrorSubscriberTransport.
//
// RED-UNTIL-WIRED BY DESIGN. The fabric-send (inv.5) and control-bridge (inv.6)
// real-source gates FAIL on the inert option-(a) tree the F-38.06 draft shipped, and
// go GREEN only when the developer reworks to the hybrid. The fleet-consumer gate
// (inv.7) already passes — that leg survives the rework unchanged. The SELF-CHECK
// (synthesized, non-vacuous, CRLF-safe) proves the detectors correct REGARDLESS of
// tree state.
//
// Every plant is a HAND-WRITTEN synthesized snippet (never a string-replace on a
// real file — the acd-clone-credential-pull-not-pushed convention), built with
// explicit "\n" joins (the tree is CRLF), and each asserts it LANDED
// (`assert.notEqual(planted, clean)`) before asserting the detector trips.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LAUNCHER = path.join(repoRoot, "src", "mesh-launcher.mjs");
const CLI = path.join(repoRoot, "src", "cli.mjs");
const CONTROL = path.join(repoRoot, "src", "control-stream-server.mjs");
const WSCLIENT = path.join(repoRoot, "src", "worker-stream-client.mjs");
const BRIDGE = path.join(repoRoot, "src", "mesh-terminal-relay-bridge.mjs");
const MIRROR = path.join(repoRoot, "src", "mesh-terminal-mirror.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// lf(source) — normalise CRLF -> LF before every probe (the repo's tree is CRLF; an
// "\n"-only needle would silently no-op — the milestone's own lesson, F1/F4/F6/F7/F8).
function lf(source) {
  return source.replace(/\r\n/g, "\n");
}

// normalise — the ONE comment-stripped + LF-normalised view every detector reads.
function normalise(source) {
  return stripComments(lf(source));
}

// sliceBalanced(code, openIndex) — the substring INSIDE the object/body whose opening
// brace is at `openIndex`, brace-depth-balanced (a nested arrow body does not truncate
// the slice early). Mirrors acd-clone-credential-pull-not-pushed.
function sliceBalanced(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(openIndex + 1, i);
    }
  }
  return null;
}

// topLevelKeys(objectBody) — the DEPTH-0 named keys of an object literal, depth-aware
// across {}, [] and () so `startTerminalRelaySubscriber: (mirror) => f({ … })` is read
// as the KEY, and a genuine top-level `...(options?.x ?? {})` is a SPREAD, not a key.
function topLevelKeys(objectBody) {
  const keys = [];
  let depth = 0;
  let segment = "";
  const flush = () => {
    const trimmed = segment.trim();
    segment = "";
    if (trimmed.length === 0 || trimmed.startsWith("...")) return;
    const named = /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(trimmed);
    if (named) keys.push(named[1]);
  };
  for (const ch of objectBody) {
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      flush();
      continue;
    }
    segment += ch;
  }
  flush();
  return keys;
}

// callSiteKeys(code, callee) — the LITERAL top-level keys the FIRST `callee({...})`
// call in `code` passes. `code` MUST be comment-stripped + LF-normalised. The import
// `import { serveMeshUi, … }` never matches `serveMeshUi(` (comma, not paren), so this
// resolves the CALL — the productionHandlerCallEntries shape the F12 guard uses.
function callSiteKeys(code, callee) {
  const anchor = code.indexOf(`${callee}(`);
  if (anchor === -1) return null;
  const open = code.indexOf("{", anchor);
  if (open === -1) return null;
  const body = sliceBalanced(code, open);
  return body == null ? null : topLevelKeys(body);
}

// applyStreamFrameHandlesTerminal(controlCode) — true iff applyStreamFrame's OWN body
// dispatches a terminal-frame kind (which would route it into a global-store apply —
// the inv.3 violation). A terminal-frame must be branched BEFORE applyStreamFrame and
// never reach it.
function applyStreamFrameHandlesTerminal(controlCode) {
  const idx = controlCode.indexOf("function applyStreamFrame");
  if (idx === -1) return false;
  // Find the body's opening brace — the `{` AFTER the parameter list closes, never the
  // `{}` inside a `options = {}` default (which would extract an empty body and silently
  // no-op — the exact vacuity this milestone keeps getting burned by).
  const paren = controlCode.indexOf("(", idx);
  if (paren === -1) return false;
  let depth = 0;
  let close = -1;
  for (let i = paren; i < controlCode.length; i += 1) {
    if (controlCode[i] === "(") depth += 1;
    else if (controlCode[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return false;
  const open = controlCode.indexOf("{", close);
  if (open === -1) return false;
  const body = sliceBalanced(controlCode, open);
  if (body == null) return false;
  return /terminal-frame|TERMINAL_FRAME_KIND/.test(body);
}

// functionBody(code, fnName) — the brace-balanced BODY of `function fnName(...) { … }`,
// found AFTER the parameter list closes (so a `(config, { timeoutMs = 3000 } = {})`
// default-param brace is never mistaken for the body brace — the vacuity trap
// applyStreamFrameHandlesTerminal was burned by). Returns null when not found.
function functionBody(code, fnName) {
  const idx = code.indexOf(`function ${fnName}`);
  if (idx === -1) return null;
  const paren = code.indexOf("(", idx);
  if (paren === -1) return null;
  let depth = 0;
  let close = -1;
  for (let i = paren; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;
  const open = code.indexOf("{", close);
  if (open === -1) return null;
  return sliceBalanced(code, open);
}

// A raw `config.mesh.relay.url` / `config?.mesh?.relay?.url` read — the footgun FIX 2
// (F-38.06b) forbids inside the two dial factories (the raw host is overloaded onto
// the fabric control-stream endpoint). `relay.url` (with the `.`/`?.`) matches the raw
// read; the helper NAME `loopbackRelayUrl` (`RelayUrl`, no dot) never does.
const RAW_RELAY_URL = /relay\s*\??\.\s*url/;

// relayBrokerEphemeral(launcherCode) — true iff the broker start binds an EPHEMERAL /
// zero port (`port: … 0`) rather than the KNOWN port named in config.mesh.relay.url. A
// standalone literal 0 (`\b0\b`) matches `?? 0` / `: 0`; a fixed port like 4180 has no
// standalone 0, so it does not false-trip.
function relayBrokerEphemeral(launcherCode) {
  const m = /\b(?:startRelayMode|relayMode|serveRelay)\s*\(/.exec(launcherCode);
  if (!m) return false; // no broker call — the "broker missing" clause handles that
  const region = launcherCode.slice(m.index, m.index + 300);
  return /port\s*:\s*[^,}\n]*\b0\b/.test(region);
}

// --- detector: invariant 5 — worker producer sends over the FABRIC ---
function workerProducerProblems(launcherSource, wsClientSource) {
  const code = normalise(launcherSource);
  const wsCode = normalise(wsClientSource);
  const problems = [];
  const keys = callSiteKeys(code, "createHandler");
  if (keys == null) {
    problems.push("could not locate the production createHandler({...}) call site in mesh-launcher.mjs");
    return problems;
  }
  if (!keys.includes("onOutputChunk")) {
    problems.push("mesh-launcher.mjs does NOT supply `onOutputChunk` as a literal key at the production createHandler({...}) call site — the terminal bridge's worker producer is inert (F-38.06); it must be a literal key (never reachable only through the workerExecutionOptions test spread)");
  }
  if (!/\bsendTerminalFrame\b/.test(code)) {
    problems.push("mesh-launcher.mjs does not reference client.sendTerminalFrame — onOutputChunk must be wired to the FABRIC send (worker-stream-client.sendTerminalFrame), NOT the loopback-only serveRelay push (which a worker cannot reach off-host)");
  }
  if (!/\bsendTerminalFrame\b/.test(wsCode)) {
    problems.push("worker-stream-client.mjs does not expose `sendTerminalFrame` — there is no fabric terminal send for the worker producer to call");
  }
  return problems;
}

// --- detector: invariant 6 — control bridges fabric->loopback without persisting ---
function controlBridgeProblems(controlSource, launcherSource) {
  const control = normalise(controlSource);
  const code = normalise(launcherSource);
  const problems = [];
  if (!/\bonTerminalFrame\b/.test(control)) {
    problems.push("control-stream-server.mjs does not branch terminal-frame to an `onTerminalFrame` sink — the cross-machine fabric leg has no receiver");
  }
  if (applyStreamFrameHandlesTerminal(control)) {
    problems.push("control-stream-server.mjs dispatches terminal-frame THROUGH applyStreamFrame — it would be store-applied / persisted (ADR-014 inv.3: terminal-frame must branch BEFORE applyStreamFrame and never reach the store)");
  }
  const startServerKeys = callSiteKeys(code, "startServer");
  if (startServerKeys == null) {
    problems.push("could not locate the production startServer({...}) (control-stream-server) call site in mesh-launcher.mjs");
  } else if (!startServerKeys.includes("onTerminalFrame")) {
    problems.push("mesh-launcher.mjs does not pass `onTerminalFrame` at the startServer({...}) call site — the fabric terminal bridge is not connected to the loopback broker");
  }
  // The broker must be STARTED (a call), not merely imported — `import { relayMode }`
  // is not a broker. Anchor on the call (paren), the same anchor relayBrokerEphemeral uses.
  if (!/\b(?:startRelayMode|relayMode|serveRelay)\s*\(/.test(code)) {
    problems.push("mesh-launcher.mjs starts no relayMode()/serveRelay() loopback broker — there is no same-machine fan-out for the fleet-UI process to subscribe to");
  } else if (relayBrokerEphemeral(code)) {
    problems.push("mesh-launcher.mjs binds the loopback broker to an EPHEMERAL port (`?? 0` / `port: 0`) — it must bind the KNOWN port named in config.mesh.relay.url so the fleet subscriber's fixed dial matches (test isolation is via options.relay===false, never a random production bind)");
  }
  return problems;
}

// --- detector: invariant 7 — fleet consumer subscribes over loopback ---
function fleetConsumerProblems(cliSource) {
  const code = normalise(cliSource);
  const problems = [];
  const keys = callSiteKeys(code, "serveMeshUi");
  if (keys == null) {
    problems.push("could not locate the production serveMeshUi({...}) call site in cli.mjs");
    return problems;
  }
  if (!keys.includes("startTerminalRelaySubscriber")) {
    problems.push("cli.mjs's `aof mesh ui` production serveMeshUi({...}) call site does NOT supply `startTerminalRelaySubscriber` as a literal key — the fleet mirror is never fed (F-38.06); a revert to serveMeshUi({ projectDir, port, scope }) trips here");
  }
  if (!/\bcreateTerminalMirrorSubscriberTransport\b/.test(code)) {
    problems.push("cli.mjs does not reference createTerminalMirrorSubscriberTransport — the fleet subscriber is not wired to the loopback relay (a no-op consumer)");
  }
  return problems;
}

// --- detector: F-38.06b — the two relay dial factories force LOOPBACK ---
// FIX 2 (the force-loopback ruling): both createTerminalRelayPushTransport and
// createTerminalMirrorSubscriberTransport must dial the forced-loopback helper
// `loopbackRelayUrl(config)` (host pinned to 127.0.0.1, only port+path from
// relay.url) and must NOT read the raw config.mesh.relay.url host — dialing the raw
// host silently points the relay legs at the fabric control-stream endpoint (the
// F-38.06b silent-inertness footgun). The raw read is confined to the loopbackRelayUrl
// helper itself.
function relayDialLoopbackProblems(bridgeSource, mirrorSource) {
  const bridge = normalise(bridgeSource);
  const mirror = normalise(mirrorSource);
  const problems = [];
  for (const [label, code, fn] of [
    ["mesh-terminal-relay-bridge.mjs", bridge, "createTerminalRelayPushTransport"],
    ["mesh-terminal-mirror.mjs", mirror, "createTerminalMirrorSubscriberTransport"],
  ]) {
    const body = functionBody(code, fn);
    if (body == null) {
      problems.push(`could not locate ${fn}'s body in ${label}`);
      continue;
    }
    if (!/\bloopbackRelayUrl\s*\(/.test(body)) {
      problems.push(`${label}: ${fn} does not dial loopbackRelayUrl(config) — the relay dial must FORCE loopback (F-38.06b), not the raw config.mesh.relay.url host`);
    }
    if (RAW_RELAY_URL.test(body)) {
      problems.push(`${label}: ${fn} reads the raw config.mesh.relay.url host — this reintroduces the F-38.06b footgun (the raw read must be confined to the loopbackRelayUrl helper, which pins host 127.0.0.1)`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------
// SELF-CHECK PLANT PLUMBING — SYNTHESIZED sources, never a string-replace on the REAL
// files. Each snippet carries only the anchor text a detector keys on, built with
// explicit "\n" joins (CRLF-immune).

// A launcher WORKER branch — onOutputChunk hook wired to the fabric send / a loopback
// push / absent.
function synthProducerLauncher({ hook = "fabric" } = {}) {
  const lines = ["export async function startLauncher(ws, options = {}) {"];
  if (hook === "loopback") lines.push("  const terminalPush = createTerminalRelayPushTransport(config);");
  lines.push("  const handler = createHandler({");
  lines.push("    loadWs: options?.workerExecutionLoadWs ?? (() => Promise.resolve(ws)),");
  lines.push("    nodeId,");
  lines.push("    sendAssignmentStatus: (...args) => client.sendAssignmentStatus(...args),");
  if (hook === "fabric") lines.push("    onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, String(chunk)),");
  else if (hook === "loopback") lines.push("    onOutputChunk: (chunk, sessionId) => terminalPush?.push(buildTerminalFrameEnvelope(nodeId, sessionId, String(chunk))),");
  lines.push("    now: nowFn,");
  lines.push("    ...(options?.workerExecutionOptions ?? {}),");
  lines.push("  });");
  lines.push("}");
  return lines.join("\n");
}

// A worker-stream-client — exposes sendTerminalFrame or not.
function synthWsClient({ hasSend = true } = {}) {
  const lines = ["export function createWorkerStreamClient(opts) {"];
  if (hasSend) {
    lines.push("  async function sendTerminalFrame(sessionId, bytes) {");
    lines.push("    if (!connected || handle == null) return { sent: false };");
    lines.push("    try { await transport.send(handle, buildTerminalFrameEnvelope(nodeId, sessionId, bytes)); return { sent: true }; } catch { return { sent: false }; }");
    lines.push("  }");
    lines.push("  return { sendAssignmentStatus, sendTerminalFrame };");
  } else {
    lines.push("  return { sendAssignmentStatus };");
  }
  lines.push("}");
  return lines.join("\n");
}

// A control-stream-server — a terminal-frame branch (before applyStreamFrame) present
// or absent; applyStreamFrame with or without a (wrong) terminal-frame persist branch.
function synthControl({ hasOnTerminalFrame = true, persistTerminal = false } = {}) {
  const lines = ['import { TERMINAL_FRAME_KIND } from "./mesh-terminal-relay-bridge.mjs";'];
  lines.push("export async function applyStreamFrame(store, frame, options = {}) {");
  lines.push('  if (frame?.kind === "snapshot") return applySnapshotFrame(store, frame, options);');
  lines.push('  if (frame?.kind === "assignment-status") return applyAssignmentStatusFrame(store, frame, options);');
  if (persistTerminal) lines.push('  if (frame?.kind === "terminal-frame") return applyTerminalFrame(store, frame, options);');
  lines.push('  return { published: false, skipped: true, code: "unknown-frame-kind" };');
  lines.push("}");
  lines.push("export async function startControlStreamServer(options = {}) {");
  lines.push("  wss.on('connection', (ws, meta) => {");
  lines.push("    ws.on('message', (data) => {");
  lines.push("      const frame = JSON.parse(data.toString());");
  if (hasOnTerminalFrame) lines.push("      if (frame?.kind === TERMINAL_FRAME_KIND) { onTerminalFrame(frame, { nodeId: meta.nodeId }); return; }");
  lines.push("      applyStreamFrame(store, frame, { nodeId: meta.nodeId });");
  lines.push("    });");
  lines.push("  });");
  lines.push("}");
  return lines.join("\n");
}

// A launcher CONTROL branch — startServer onTerminalFrame key, broker start, and a
// KNOWN or EPHEMERAL broker port.
function synthControlLauncher({ onTerminalFrameKey = true, broker = true, ephemeral = false } = {}) {
  const lines = ['import { relayMode } from "./mesh-relay.mjs";'];
  lines.push("export async function startLauncher(ws, options = {}) {");
  if (broker) {
    const port = ephemeral ? "options?.relayPort ?? 0" : "relayPortFromUrl(configuredRelayUrl(config))";
    lines.push(`  relayBroker = await relayMode(config, { port: ${port} });`);
    lines.push("  const controlTerminalPush = createTerminalRelayPushTransport(config);");
  }
  lines.push("  streamServer = await startServer({");
  lines.push("    bindAddress, peerNodeIds, peersByAddress,");
  if (onTerminalFrameKey) lines.push("    onTerminalFrame: (frame) => controlTerminalPush?.push(frame),");
  lines.push("    ...(options?.controlStreamServerOptions ?? {}),");
  lines.push("  });");
  lines.push("}");
  return lines.join("\n");
}

// A cli.mjs meshUiCommand — subscriber key + seam present or absent.
function synthCli({ withSubscriberKey = true, withSubscriberSeam = true } = {}) {
  const lines = ['import { serveMeshUi, DEFAULT_MESH_UI_PORT } from "./mesh-ui-serve.mjs";'];
  if (withSubscriberSeam) lines.push('import { createTerminalMirrorSubscriberTransport, startTerminalMirrorSubscriber } from "./mesh-terminal-mirror.mjs";');
  lines.push("async function meshUiCommand(args) {");
  if (withSubscriberKey && withSubscriberSeam) {
    lines.push("  session = await serveMeshUi({");
    lines.push("    projectDir,");
    lines.push("    port,");
    lines.push("    scope,");
    lines.push("    startTerminalRelaySubscriber: (mirror) => startTerminalMirrorSubscriber({ transport: createTerminalMirrorSubscriberTransport(config), mirror }),");
    lines.push("  });");
  } else {
    lines.push("  session = await serveMeshUi({ projectDir, port, scope });");
  }
  lines.push("}");
  return lines.join("\n");
}

// A relay dial factory — dials the forced-loopback helper (`loopback`) or reverts to
// the raw config.mesh.relay.url host (`raw` — the F-38.06b footgun).
function synthDialFactory(fnName, { dial = "loopback" } = {}) {
  const url = dial === "loopback" ? "loopbackRelayUrl(config)" : "config?.mesh?.relay?.url";
  return [
    `export function ${fnName}(config, { timeoutMs = 3000 } = {}) {`,
    `  const url = ${url};`,
    "  if (url == null) return null;",
    "  return { connect() { const ws = new WebSocket(url); return ws; } };",
    "}",
  ].join("\n");
}

export const archTests = [
  // ══ invariant 5 — worker producer sends over the FABRIC (REAL; RED until reworked) ══
  {
    name: "arch/38 ADR-014 AMENDMENT (acd-terminal-stream-transport-wired) inv.5: the worker producer sends over the FABRIC — `onOutputChunk` a literal key at the createHandler call site wired to client.sendTerminalFrame, and worker-stream-client exposes sendTerminalFrame (RED until the F-38.06 hybrid rework lands)",
    run: async () => {
      const [launcherSource, wsClientSource] = await Promise.all([readFile(LAUNCHER, "utf8"), readFile(WSCLIENT, "utf8")]);
      const problems = workerProducerProblems(launcherSource, wsClientSource);
      assert.deepEqual(problems, [], `the worker producer must send over the FABRIC per ADR-014 AMENDMENT (2026-07-19). RED BY DESIGN until the hybrid rework lands (F-38.06):\n${JSON.stringify(problems, null, 2)}`);
    },
  },

  // ══ invariant 6 — control bridges fabric->loopback without persisting (REAL; RED) ══
  {
    name: "arch/38 ADR-014 AMENDMENT (acd-terminal-stream-transport-wired) inv.6: control-stream-server branches terminal-frame to an onTerminalFrame sink (never persisted), and the launcher wires it + starts a loopback broker on a KNOWN (non-ephemeral) port (RED until the F-38.06 hybrid rework lands)",
    run: async () => {
      const [controlSource, launcherSource] = await Promise.all([readFile(CONTROL, "utf8"), readFile(LAUNCHER, "utf8")]);
      const problems = controlBridgeProblems(controlSource, launcherSource);
      assert.deepEqual(problems, [], `control must bridge fabric->loopback without persisting, on a known port, per ADR-014 AMENDMENT. RED BY DESIGN until the hybrid rework lands (F-38.06):\n${JSON.stringify(problems, null, 2)}`);
    },
  },

  // ══ invariant 7 — fleet consumer subscribes over loopback (REAL; the leg that
  //    SURVIVES the rework — already green) ══
  {
    name: "arch/38 ADR-014 AMENDMENT (acd-terminal-stream-transport-wired) inv.7: the `aof mesh ui` production serveMeshUi call site supplies startTerminalRelaySubscriber (the loopback subscribe), fed by createTerminalMirrorSubscriberTransport",
    run: async () => {
      const cliSource = await readFile(CLI, "utf8");
      const problems = fleetConsumerProblems(cliSource);
      assert.deepEqual(problems, [], `the fleet-face loopback consumer must be wired per ADR-014 AMENDMENT:\n${JSON.stringify(problems, null, 2)}`);
    },
  },

  // ══ F-38.06b — the two relay dial factories force LOOPBACK (REAL; the FIX 2
  //    hardening — green against the as-built, RED if reverted to the raw url host) ══
  {
    name: "arch/38 ADR-014 AMENDMENT F-38.06b (acd-terminal-stream-transport-wired) FIX 2: createTerminalRelayPushTransport + createTerminalMirrorSubscriberTransport dial the forced-loopback loopbackRelayUrl(config) and never the raw config.mesh.relay.url host (the footgun)",
    run: async () => {
      const [bridgeSource, mirrorSource] = await Promise.all([readFile(BRIDGE, "utf8"), readFile(MIRROR, "utf8")]);
      const problems = relayDialLoopbackProblems(bridgeSource, mirrorSource);
      assert.deepEqual(problems, [], `both relay dial factories must FORCE loopback per Finding F-38.06b — a revert to dialing the raw config.mesh.relay.url host reintroduces the silent-inertness footgun:\n${JSON.stringify(problems, null, 2)}`);
    },
  },

  // ══ F-38.06b self-check — the loopback-dial detector distinguishes the forced-
  //    loopback dial from a reverted raw-url dial, non-vacuously ══
  {
    name: "arch/38 ADR-014 AMENDMENT F-38.06b (acd-terminal-stream-transport-wired) self-check: the loopbackRelayUrl-dialing factories are clean; a factory reverted to dialing config.mesh.relay.url (either factory) trips the detector — each plant asserts it LANDED first",
    run: async () => {
      const cleanPush = synthDialFactory("createTerminalRelayPushTransport", { dial: "loopback" });
      const cleanSub = synthDialFactory("createTerminalMirrorSubscriberTransport", { dial: "loopback" });
      assert.deepEqual(relayDialLoopbackProblems(cleanPush, cleanSub), [], "sanity: both forced-loopback dial factories are clean");

      const NO_HELPER = "does not dial loopbackRelayUrl(config)";
      const RAW_HOST = "reads the raw config.mesh.relay.url host";

      // PLANT — the push factory reverted to dialing the raw url host (F-38.06b footgun).
      const rawPush = synthDialFactory("createTerminalRelayPushTransport", { dial: "raw" });
      assert.notEqual(rawPush, cleanPush, "the reverted push factory differs from the clean one");
      const rawPushProblems = relayDialLoopbackProblems(rawPush, cleanSub);
      assert.ok(rawPushProblems.some((p) => p.includes(NO_HELPER)) && rawPushProblems.some((p) => p.includes(RAW_HOST)), "self-check: a push factory dialing the raw config.mesh.relay.url trips both loopback-dial detectors");

      // PLANT — the subscriber factory reverted to dialing the raw url host.
      const rawSub = synthDialFactory("createTerminalMirrorSubscriberTransport", { dial: "raw" });
      assert.notEqual(rawSub, cleanSub, "the reverted subscriber factory differs from the clean one");
      assert.ok(relayDialLoopbackProblems(cleanPush, rawSub).some((p) => p.includes(RAW_HOST)), "self-check: a subscriber factory dialing the raw config.mesh.relay.url trips the raw-host detector");

      // NEGATIVE CONTROL — the loopbackRelayUrl HELPER name itself must not false-trip
      // the raw-url needle (RelayUrl has no dot).
      assert.ok(!RAW_RELAY_URL.test("loopbackRelayUrl(config)"), "negative control: the loopbackRelayUrl helper name does not match the raw-url needle");
    },
  },

  // ══ self-check — the detectors distinguish WIRED-hybrid from every inert/wrong-leg
  //    shape, non-vacuously, regardless of the real tree (GREEN throughout) ══
  {
    name: "arch/38 ADR-014 AMENDMENT (acd-terminal-stream-transport-wired) self-check: the wired-hybrid shapes are clean and every inert/wrong-leg shape (no onOutputChunk, a loopback push instead of the fabric send, no onTerminalFrame, a terminal-frame persisted through applyStreamFrame, an ephemeral broker port, no loopback subscriber) trips its detector — each plant asserts it LANDED first",
    run: async () => {
      // --- invariant 5: worker fabric producer ---
      const cleanProducer = synthProducerLauncher({ hook: "fabric" });
      const cleanWsClient = synthWsClient({ hasSend: true });
      assert.deepEqual(workerProducerProblems(cleanProducer, cleanWsClient), [], "sanity: the fabric-wired producer + a client exposing sendTerminalFrame is clean");

      const NO_ONOUTPUTCHUNK = "does NOT supply `onOutputChunk`";
      const NO_FABRIC_SEND = "does not reference client.sendTerminalFrame";
      const NO_WS_SEND = "does not expose `sendTerminalFrame`";

      // PLANT 5a — the INERT F-38.06 shape: no onOutputChunk at all.
      const noHook = synthProducerLauncher({ hook: "none" });
      assert.notEqual(noHook, cleanProducer, "plant 5a differs from the clean producer");
      assert.ok(workerProducerProblems(noHook, cleanWsClient).some((p) => p.includes(NO_ONOUTPUTCHUNK)), "self-check: no onOutputChunk trips the missing-key detector");

      // PLANT 5b — the WRONG LEG: onOutputChunk wired to the loopback serveRelay push,
      // not the fabric send. onOutputChunk is present, but sendTerminalFrame is not.
      const loopbackHook = synthProducerLauncher({ hook: "loopback" });
      assert.notEqual(loopbackHook, cleanProducer, "plant 5b differs from the clean producer");
      const loopbackProblems = workerProducerProblems(loopbackHook, cleanWsClient);
      assert.ok(!loopbackProblems.some((p) => p.includes(NO_ONOUTPUTCHUNK)), "self-check: plant 5b's onOutputChunk IS detected (missing-key silent)");
      assert.ok(loopbackProblems.some((p) => p.includes(NO_FABRIC_SEND)), "self-check: an onOutputChunk wired to the loopback push (no fabric sendTerminalFrame) trips the fabric-send detector");

      // PLANT 5c — the worker-stream-client exposes no sendTerminalFrame.
      const wsNoSend = synthWsClient({ hasSend: false });
      assert.notEqual(wsNoSend, cleanWsClient, "plant 5c differs from the clean client");
      assert.ok(workerProducerProblems(cleanProducer, wsNoSend).some((p) => p.includes(NO_WS_SEND)), "self-check: a client with no sendTerminalFrame trips the expose detector");

      // --- invariant 6: control fabric->loopback bridge ---
      const cleanControl = synthControl({ hasOnTerminalFrame: true, persistTerminal: false });
      const cleanControlLauncher = synthControlLauncher({ onTerminalFrameKey: true, broker: true, ephemeral: false });
      assert.deepEqual(controlBridgeProblems(cleanControl, cleanControlLauncher), [], "sanity: the hybrid control bridge + known-port broker is clean");

      const NO_SINK = "does not branch terminal-frame to an `onTerminalFrame` sink";
      const PERSISTED = "dispatches terminal-frame THROUGH applyStreamFrame";
      const NO_STARTSERVER_KEY = "does not pass `onTerminalFrame` at the startServer";
      const NO_BROKER = "starts no relayMode()/serveRelay() loopback broker";
      const EPHEMERAL = "EPHEMERAL port";

      // PLANT 6a — the INERT F-38.06 shape: control has no onTerminalFrame branch.
      const controlNoSink = synthControl({ hasOnTerminalFrame: false });
      assert.notEqual(controlNoSink, cleanControl, "plant 6a differs from the clean control");
      assert.ok(controlBridgeProblems(controlNoSink, cleanControlLauncher).some((p) => p.includes(NO_SINK)), "self-check: a control server with no onTerminalFrame trips the sink detector");

      // PLANT 6b — inv.3 violation: terminal-frame dispatched through applyStreamFrame
      // (would be store-applied / persisted).
      const controlPersists = synthControl({ hasOnTerminalFrame: true, persistTerminal: true });
      assert.notEqual(controlPersists, cleanControl, "plant 6b differs from the clean control");
      assert.ok(controlBridgeProblems(controlPersists, cleanControlLauncher).some((p) => p.includes(PERSISTED)), "self-check: a terminal-frame branch INSIDE applyStreamFrame trips the persist detector (inv.3)");

      // PLANT 6c — the launcher does not pass onTerminalFrame at the startServer site.
      const launcherNoKey = synthControlLauncher({ onTerminalFrameKey: false });
      assert.notEqual(launcherNoKey, cleanControlLauncher, "plant 6c differs from the clean control launcher");
      assert.ok(controlBridgeProblems(cleanControl, launcherNoKey).some((p) => p.includes(NO_STARTSERVER_KEY)), "self-check: no onTerminalFrame at the startServer call site trips the wiring detector");

      // PLANT 6d — no broker started at all.
      const launcherNoBroker = synthControlLauncher({ broker: false });
      assert.notEqual(launcherNoBroker, cleanControlLauncher, "plant 6d differs from the clean control launcher");
      assert.ok(controlBridgeProblems(cleanControl, launcherNoBroker).some((p) => p.includes(NO_BROKER)), "self-check: no relayMode()/serveRelay() broker trips the broker detector");

      // PLANT 6e — the broker binds an EPHEMERAL port (the second F-38.06 defect).
      const launcherEphemeral = synthControlLauncher({ ephemeral: true });
      assert.notEqual(launcherEphemeral, cleanControlLauncher, "plant 6e differs from the clean control launcher");
      const ephemeralProblems = controlBridgeProblems(cleanControl, launcherEphemeral);
      assert.ok(!ephemeralProblems.some((p) => p.includes(NO_BROKER)), "self-check: plant 6e's broker IS detected (broker-missing silent)");
      assert.ok(ephemeralProblems.some((p) => p.includes(EPHEMERAL)), "self-check: a broker bound to `?? 0` trips the ephemeral-port detector; a known fixed port does not");

      // --- invariant 7: fleet loopback consumer ---
      const cleanCli = synthCli();
      assert.deepEqual(fleetConsumerProblems(cleanCli), [], "sanity: the loopback-subscribing cli is clean");
      const inertCli = synthCli({ withSubscriberKey: false, withSubscriberSeam: false });
      assert.notEqual(inertCli, cleanCli, "plant 7 differs from the clean cli");
      const cliProblems = fleetConsumerProblems(inertCli);
      assert.ok(
        cliProblems.some((p) => p.includes("startTerminalRelaySubscriber")) && cliProblems.some((p) => p.includes("createTerminalMirrorSubscriberTransport")),
        "self-check: serveMeshUi({ projectDir, port, scope }) with no subscriber trips both consumer detectors",
      );
    },
  },
];
