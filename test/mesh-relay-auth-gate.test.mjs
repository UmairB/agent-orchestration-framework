// Traceability wiring for milestone 24 / story 02 — task 00 (tasks/00_relay-auth-gate
// .feature). serveRelay's ws upgrade handler CHECKS a connecting node's credential against
// the LIVE roster/revocation before brokering: a valid credential is admitted (joins the
// clients fan-out set + receives brokered frames); an absent / invalid / not-in-roster /
// REVOKED one is destroyed upstream of the broker (socket.destroy(), never joins clients);
// loopback stays the local default (no credential needed); the relay persists NOTHING at
// the gate.
//
// Covers EVERY @executable scenario / Scenario Outline row, driving IN-PROCESS ws clients
// (the m23 join-ack pattern) against the REAL serveRelay (src/mesh-relay.mjs) on an
// ephemeral port (port: 0). The registry roster/revocation is seeded via story 00's
// writeRegistry over a temp fixture. The credential is presented on the upgrade via the
// `ws` client options `new WebSocket(url, { headers: { Authorization } })` (the STORY.md
// carrier decision). Loopback-vs-group is driven by the INJECTED isGroupConnection seam
// (every in-process ws client presents 127.0.0.1, so the branch needs a deterministic
// injectable — the STORY.md build note): the seam reads an `x-conn` header the test sets
// per connection ("group" ⇒ credential required; "loopback" ⇒ the local default). The
// relayAuth token is treated as OPAQUE (its entropy + the constant-time compare are the
// security fitness) — asserted is the observable admit/reject behaviour + the byte-stable
// filesystem. One test object per scenario / row group.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveRelay, sha256Hex } from "../src/mesh-relay.mjs";
import { writeRegistry, appendRevocation, readRegistry } from "../src/mesh-registry.mjs";

const CONTROL_ID = "control-node-a";
const CLOCK = "2026-07-01T10:00:00.000Z";

function controlConfig() {
  return { mesh: { nodeId: CONTROL_ID, relay: { controlNode: CONTROL_ID } } };
}

async function makeWorkspace() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-authgate-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workspace: { workDir } };
}

// A roster entry carrying the VERIFIABLE half of a credential — the hash of the token
// (the token itself is never at rest; the auth-gate hashes a presented token and
// compares against this field). Returns { entry, token } so the test holds the plaintext.
function admittedNode(nodeId, { admittedAt = CLOCK } = {}) {
  const token = `relay-auth-${nodeId}-${Math.random().toString(16).slice(2)}`;
  return {
    entry: { nodeId, admittedAt, boards: [], relayAuthHash: sha256Hex(token) },
    token,
  };
}

// Stand a control-node relay over a seeded registry. isGroupConnection reads an `x-conn`
// header the test sets per connection: "loopback" ⇒ the local default (no credential),
// anything else (incl. "group" / absent) ⇒ a group connection (credential required).
async function standRelay({ roster = [], revocations = [] } = {}) {
  const { repo, workspace } = await makeWorkspace();
  const config = controlConfig();
  await writeRegistry(workspace, { roster, boards: [], pending: [], revocations }, config);
  const relay = await serveRelay({
    port: 0,
    config,
    workspace,
    isGroupConnection: (request) => request?.headers?.["x-conn"] !== "loopback",
  });
  return { relay, workspace, repo, config };
}

// Attempt a ws upgrade, presenting the credential (or not) + the connection-type header.
// Resolves { admitted, ws?, frames } — admitted:true on the server's `joined` ack (the
// deterministic proof the socket joined the clients fan-out set), admitted:false when the
// socket is destroyed at the gate (the `open`/`joined` never fires; the client sees an
// error/close first). The ws (when admitted) is returned live for fan-out assertions.
function attemptUpgrade(url, { token = null, conn = "group", timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const headers = { "x-conn": conn };
    if (token != null) headers.Authorization = token;
    const ws = new WebSocket(url, { headers });
    const frames = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ admitted: false, ws, frames, reason: "timeout" }); }
    }, timeoutMs);
    ws.on("message", (data) => {
      const text = data.toString();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* raw */ }
      if (parsed && parsed.type === "joined" && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ admitted: true, ws, frames });
        return;
      }
      frames.push({ text, parsed });
    });
    // A destroyed upgrade surfaces to the client as an error (ECONNRESET / socket hang up)
    // or a close before `open` — either way the connection was NOT admitted.
    ws.on("error", () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ admitted: false, ws, frames, reason: "error" }); }
    });
    ws.on("close", () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ admitted: false, ws, frames, reason: "close" }); }
    });
  });
}

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

// A stable snapshot of the workspace file tree: relative path → { size, mtimeMs, bytes }.
// Used to prove the auth-gate persists NOTHING (byte-unchanged across upgrades).
async function snapshotTree(root) {
  const snap = new Map();
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      const info = await stat(full);
      const bytes = await readFile(full);
      snap.set(path.relative(root, full), { size: info.size, mtimeMs: info.mtimeMs, bytes: bytes.toString("base64") });
    }
  }
  await walk(root);
  return snap;
}

function treesEqual(before, after) {
  if (before.size !== after.size) return false;
  for (const [rel, b] of before) {
    const a = after.get(rel);
    if (a == null) return false;
    if (a.size !== b.size || a.bytes !== b.bytes) return false;
  }
  return true;
}

export const meshRelayAuthGateTests = [
  // ══ Scenario: a valid credential is admitted and receives brokered frames ══════════
  {
    name: "mesh-relay-auth-gate/00 a valid credential (nodeId in the roster, not revoked) presented on a group upgrade is admitted, joins the clients fan-out set, and receives a peer's brokered signal frame",
    async run() {
      const ok = admittedNode("node-ok");
      const peer = admittedNode("node-peer");
      const stand = await standRelay({ roster: [ok.entry, peer.entry] });
      let admittedConn = null;
      let peerConn = null;
      try {
        admittedConn = await attemptUpgrade(stand.relay.url, { token: ok.token, conn: "group" });
        assert.equal(admittedConn.admitted, true, "the valid credential is admitted (the socket joined the clients fan-out set — the joined ack fired)");

        // Another admitted peer publishes a signal frame — node-ok receives it (proving it
        // is in the fan-out set, the receive-side of story 01's issuance).
        peerConn = await attemptUpgrade(stand.relay.url, { token: peer.token, conn: "group" });
        assert.equal(peerConn.admitted, true, "the second valid peer is admitted");
        const frame = JSON.stringify({ kind: "presence", nodeId: "node-peer", signal: { at: CLOCK } });
        peerConn.ws.send(frame);
        await waitFor(() => admittedConn.frames.some((f) => f.text === frame), { label: "node-ok received the broadcast" });
        assert.ok(admittedConn.frames.some((f) => f.text === frame), "node-ok received the peer's fanned-out signal frame (it is in the clients set)");
      } finally {
        try { admittedConn?.ws?.close(); } catch { /* noop */ }
        try { peerConn?.ws?.close(); } catch { /* noop */ }
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: the reject matrix — absent / invalid / not-in-roster / revoked
  //    is destroyed, only a valid credential is admitted ════════════════════════════
  {
    name: "mesh-relay-auth-gate/00 the reject matrix — a valid token is admitted; an absent / invalid / not-in-roster / revoked credential is destroyed (never joins the clients fan-out set)",
    async run() {
      const ok = admittedNode("node-ok");
      const revoked = admittedNode("node-revoked");
      // A token for a node NOT in the roster (its hash is unknown to the registry).
      const stranger = admittedNode("node-stranger");
      const rows = [
        { label: "a valid token (in roster, not revoked)", token: () => ok.token, expect: true },
        { label: "no credential (absent)", token: () => null, expect: false },
        { label: "an invalid / unrecognised token", token: () => "totally-bogus-token", expect: false },
        { label: "a token whose nodeId is not in the roster", token: () => stranger.token, expect: false },
        { label: "a token whose nodeId is in the revocation list", token: () => revoked.token, expect: false },
      ];
      // Seed: node-ok + node-revoked admitted; node-revoked ALSO in the revocation list
      // (a lingering roster entry + an explicit deny — the T6 shape). node-stranger is
      // NOT admitted (no roster entry), so its token matches nothing.
      const stand = await standRelay({
        roster: [ok.entry, revoked.entry],
        revocations: [{ nodeId: "node-revoked", revokedAt: CLOCK, reason: "compromised" }],
      });
      try {
        for (const row of rows) {
          const result = await attemptUpgrade(stand.relay.url, { token: row.token(), conn: "group" });
          assert.equal(result.admitted, row.expect, `[${row.label}] admitted=${row.expect}`);
          if (!row.expect) {
            // A rejected upgrade never joined the clients fan-out set — it received no
            // `joined` ack (never brokered to), and it was destroyed at the gate.
            assert.ok(!result.frames.some((f) => f.parsed?.type === "joined"), `[${row.label}] the rejected socket never received a joined ack (never joined the clients set)`);
            // The reject is a PROMPT socket.destroy() (an error/close), NOT a hung socket
            // that only resolves at the 3000ms timeout — a hang-instead-of-destroy
            // regression must fail loudly, not pass slowly (aof-qa hygiene finding).
            assert.notEqual(result.reason, "timeout", `[${row.label}] the socket was destroyed promptly at the gate (error/close), not left to hang until the timeout`);
          }
          try { result.ws?.close(); } catch { /* noop */ }
        }
        // Nothing about the reject matrix wrote to the registry.
        const after = await readRegistry(stand.workspace);
        assert.equal(after.roster.length, 2, "the roster is unchanged by the reject matrix (the gate is a READ)");
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the gate reads the LIVE roster + revocation — a node revoked after
  //    issuance is rejected on its next connect ═══════════════════════════════════════
  {
    name: "mesh-relay-auth-gate/00 the gate reads the LIVE revocation at upgrade time — a node admitted, then revoked via writeRegistry, is rejected on its NEXT connect while the still-admitted peer is still admitted",
    async run() {
      const live = admittedNode("node-live");
      const other = admittedNode("node-ok");
      const stand = await standRelay({ roster: [live.entry, other.entry] });
      let first = null;
      try {
        // The same token is admitted BEFORE the revocation.
        first = await attemptUpgrade(stand.relay.url, { token: live.token, conn: "group" });
        assert.equal(first.admitted, true, "node-live is admitted before the revocation (a valid live credential)");
        try { first.ws?.close(); } catch { /* noop */ }

        // Append a revocation AFTER that first connect (a live registry mutation, not a
        // serve-restart) — story 00's writeRegistry over the same workspace.
        const registry = await readRegistry(stand.workspace);
        const revoked = appendRevocation(registry, { nodeId: "node-live", revokedAt: CLOCK, reason: "rotated out" });
        await writeRegistry(stand.workspace, revoked, stand.config);

        // The SAME token now reconnects — the gate re-reads the live revocation list and
        // rejects it (not a serve-start snapshot).
        const reconnect = await attemptUpgrade(stand.relay.url, { token: live.token, conn: "group" });
        assert.equal(reconnect.admitted, false, "node-live's reconnect is rejected (the gate re-read the LIVE revocation list)");
        try { reconnect.ws?.close(); } catch { /* noop */ }

        // The still-admitted peer connecting with its valid token is still admitted (the
        // gate rejects only the revoked nodeId).
        const peer = await attemptUpgrade(stand.relay.url, { token: other.token, conn: "group" });
        assert.equal(peer.admitted, true, "the still-admitted peer node-ok is still admitted (only the revoked nodeId is rejected)");
        try { peer.ws?.close(); } catch { /* noop */ }
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: loopback stays the local default (no credential) while a group
  //    connection with no credential is rejected ════════════════════════════════════
  {
    name: "mesh-relay-auth-gate/00 a loopback (same-host) connection with NO credential is admitted (the m23 local default) while a group connection with NO credential is rejected",
    async run() {
      // An empty roster — loopback needs no credential either way; a group connection
      // with no credential is rejected regardless of the roster.
      const stand = await standRelay({ roster: [] });
      let loopbackConn = null;
      try {
        // Loopback: no credential, admitted (the m23 local default — the gate is additive).
        loopbackConn = await attemptUpgrade(stand.relay.url, { token: null, conn: "loopback" });
        assert.equal(loopbackConn.admitted, true, "the loopback connection with no credential is admitted (loopback stays the m23 local default)");
        try { loopbackConn.ws?.close(); } catch { /* noop */ }

        // Group: no credential, rejected (a group connection requires a valid credential).
        const groupConn = await attemptUpgrade(stand.relay.url, { token: null, conn: "group" });
        assert.equal(groupConn.admitted, false, "the group connection with no credential is rejected (a group connection requires a valid credential)");
        try { groupConn.ws?.close(); } catch { /* noop */ }
      } finally {
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: an uncredentialed connection never reaches clients.add and never
  //    receives a fanned-out frame (the gate is upstream of the broker) ══════════════
  {
    name: "mesh-relay-auth-gate/00 an uncredentialed group connection never joins the clients fan-out set — a valid peer's publish reaches the OTHER admitted peers but NOT the rejected socket",
    async run() {
      const ok = admittedNode("node-ok");
      const witness = admittedNode("node-witness");
      const stand = await standRelay({ roster: [ok.entry, witness.entry] });
      let okConn = null;
      let witnessConn = null;
      try {
        // A valid admitted peer + a valid witness peer, plus an uncredentialed group
        // connection that is rejected at the gate.
        okConn = await attemptUpgrade(stand.relay.url, { token: ok.token, conn: "group" });
        assert.equal(okConn.admitted, true, "node-ok is admitted");
        const rejected = await attemptUpgrade(stand.relay.url, { token: null, conn: "group" });
        assert.equal(rejected.admitted, false, "the uncredentialed group connection is rejected at the gate");
        witnessConn = await attemptUpgrade(stand.relay.url, { token: witness.token, conn: "group" });
        assert.equal(witnessConn.admitted, true, "the witness peer is admitted");

        // node-ok publishes a signal frame.
        const frame = JSON.stringify({ kind: "presence", nodeId: "node-ok", signal: { at: CLOCK } });
        okConn.ws.send(frame);

        // The witness (an admitted peer) receives it — proving the broker DID fan out.
        await waitFor(() => witnessConn.frames.some((f) => f.text === frame), { label: "witness received the fan-out" });
        assert.ok(witnessConn.frames.some((f) => f.text === frame), "the admitted witness peer received the fanned-out frame (the broker fanned out)");

        // The rejected connection received NO frame — it never joined the clients set.
        assert.ok(!rejected.frames.some((f) => f.text === frame), "the rejected connection received no fanned-out frame (it never joined the clients fan-out set — the gate is upstream of clients.add)");
        assert.ok(!rejected.frames.some((f) => f.parsed?.type === "joined"), "the rejected connection never received a joined ack (never reached clients.add)");
      } finally {
        try { okConn?.ws?.close(); } catch { /* noop */ }
        try { witnessConn?.ws?.close(); } catch { /* noop */ }
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the auth-gate persists nothing — the filesystem is byte-unchanged
  //    across a rejected AND an accepted upgrade ═════════════════════════════════════
  {
    name: "mesh-relay-auth-gate/00 the auth-gate persists nothing — the workspace filesystem is byte-unchanged across BOTH a rejected (no-credential) group upgrade and an accepted (valid-credential) group upgrade (acd-relay-stateless stays GREEN)",
    async run() {
      const ok = admittedNode("node-ok");
      const stand = await standRelay({ roster: [ok.entry] });
      let accepted = null;
      try {
        // Record the filesystem state under the workspace before both upgrades.
        const before = await snapshotTree(stand.repo);

        // A group upgrade with no credential is rejected.
        const rejected = await attemptUpgrade(stand.relay.url, { token: null, conn: "group" });
        assert.equal(rejected.admitted, false, "the no-credential group upgrade was rejected");
        try { rejected.ws?.close(); } catch { /* noop */ }

        // A group upgrade with a valid credential is admitted.
        accepted = await attemptUpgrade(stand.relay.url, { token: ok.token, conn: "group" });
        assert.equal(accepted.admitted, true, "the valid-credential group upgrade was admitted");

        // No file was created / modified / deleted for EITHER upgrade — the gate is a READ
        // + a decision, never a durable write (no relay log, no .mesh/ record by the gate).
        const after = await snapshotTree(stand.repo);
        assert.ok(treesEqual(before, after), "the workspace filesystem is byte-unchanged across both upgrades (the auth-gate persists nothing — acd-relay-stateless stays GREEN)");
      } finally {
        try { accepted?.ws?.close(); } catch { /* noop */ }
        await stand.relay.stop();
        await rm(stand.repo, { recursive: true, force: true });
      }
    },
  },
];
