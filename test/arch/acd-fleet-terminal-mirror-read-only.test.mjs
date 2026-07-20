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
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
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
