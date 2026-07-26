// Traceability wiring for milestone 24 / story 02 — task 01 (tasks/01_mesh-revoke
// .feature). aof mesh revoke <node> (control-node-guarded) removes the node from the
// registry roster, appends an explicit-deny revocation { nodeId, revokedAt, reason } via
// story 00's writeRegistry (ONE atomic write); after it, the relay
// auth-gate (task 00) rejects that node's credential on its next connect.
//
// Covers EVERY @executable scenario, white-box over mesh:revoke + the registry seam:
// invoke the registered command with an INJECTED config.mesh.relay.controlNode /
// config.mesh.nodeId pair (matching → the control node admits the revoke; mismatched →
// the non-authority refusal) over a workspace fixture, with an INJECTED revokedAt (a
// value, never wall-clock — the 22/R2 discipline). The "auth-gate now rejects" observable
// REUSES task 00's in-process serveRelay. The --json
// face is exercised via the real CLI (spawnCliSync — mesh:revoke touches only the local
// registry/clone, no in-process server, so the synchronous spawn is safe). One test object
// per scenario.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { serveRelay, sha256Hex } from "../src/mesh-relay.mjs";
import { writeRegistry, readRegistry } from "../src/mesh-registry.mjs";
import { meshDir } from "../src/mesh-store.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

const CONTROL_ID = "control-node-a";
const CLOCK = "2026-07-01T10:00:00.000Z";
const REVOKED_AT = "2026-07-02T12:00:00.000Z";

// A control-node project fixture with the .aof config seeded so the workspace loads
// config.mesh (control node) + the roster is writable. Returns { root, configPath, workspace }.
async function makeControlProject({ roster = [], revocations = [], controlNode = CONTROL_ID, nodeId = CONTROL_ID } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-revoke-ctl-"));
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await mkdir(path.join(root, "wiki", "work"), { recursive: true });
  const config = {
    name: "control-fixture",
    work: { dir: "./wiki/work" },
    mesh: { nodeId, relay: { controlNode } },
  };
  const configPath = path.join(root, ".aof", "aof.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const workspace = await loadWorkspace(root);
  await writeRegistry(workspace, { roster, boards: [], pending: [], revocations }, config);
  return { root, configPath, workspace };
}

// A roster entry carrying the verifiable relayAuthHash half (+ the plaintext token held
// by the test) — the admission shape story 01 writes.
function admittedNode(nodeId, { admittedAt = CLOCK } = {}) {
  const token = `relay-auth-${nodeId}-${Math.random().toString(16).slice(2)}`;
  return {
    entry: { nodeId, admittedAt, boards: [], relayAuthHash: sha256Hex(token) },
    token,
  };
}

async function seedGitConfig(root, text) {
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, ".git", "config"), text, "utf8");
}

async function readGitConfig(root) {
  return readFile(path.join(root, ".git", "config"), "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
}
// The task-00 in-process relay auth-gate harness (isGroupConnection forced to group so an
// in-process 127.0.0.1 client is treated as a group connection — the injectable seam).
async function standRelay(workspace, config) {
  return serveRelay({
    port: 0,
    config,
    workspace,
    isGroupConnection: () => true,
  });
}

function attemptUpgrade(url, token, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const headers = {};
    if (token != null) headers.Authorization = token;
    const ws = new WebSocket(url, { headers });
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ admitted: false, ws }); } }, timeoutMs);
    ws.on("message", (data) => {
      let parsed = null;
      try { parsed = JSON.parse(data.toString()); } catch { /* raw */ }
      if (parsed && parsed.type === "joined" && !settled) { settled = true; clearTimeout(timer); resolve({ admitted: true, ws }); }
    });
    ws.on("error", () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ admitted: false, ws }); } });
    ws.on("close", () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ admitted: false, ws }); } });
  });
}

export const meshRevokeTests = [
  // ══ Scenario: mesh:revoke removes the node from the roster and appends a revocation
  //    in one authority act ══════════════════════════════════════════════════════════
  {
    name: "mesh-revoke/01 mesh:revoke removes exactly the target node from the roster AND appends exactly one revocation { nodeId, revokedAt, reason } in one authority act — the untargeted node stays",
    async run() {
      const x = admittedNode("node-x");
      const y = admittedNode("node-y");
      const ctl = await makeControlProject({ roster: [x.entry, y.entry] });
      try {
        const ctx = { workspace: ctl.workspace };
        const result = await invoke("mesh:revoke", { node: "node-x", reason: "compromised", revokedAt: REVOKED_AT }, ctx);
        assert.equal(result.revoked, true, "the revoke reports success");

        const after = await readRegistry(ctl.workspace);
        // The roster no longer contains node-x; node-y is untouched.
        assert.ok(!after.roster.some((e) => e.nodeId === "node-x"), "the roster no longer contains node-x");
        assert.ok(after.roster.some((e) => e.nodeId === "node-y"), "the roster still contains node-y (the removal targets only node-x)");
        // Exactly one revocation for node-x, carrying { nodeId, revokedAt, reason }.
        const revs = after.revocations.filter((r) => r.nodeId === "node-x");
        assert.equal(revs.length, 1, "the revocation list contains exactly one record for node-x");
        assert.deepEqual(revs[0], { nodeId: "node-x", revokedAt: REVOKED_AT, reason: "compromised" }, "the revocation carries { nodeId, revokedAt, reason }");
      } finally {
        await rm(ctl.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:revoke leaves git remotes untouched; mesh sync is WebSocket-only ═
  {
    name: "mesh-revoke/01 mesh:revoke does not de-provision or otherwise touch git remotes",
    async run() {
      const x = admittedNode("node-x");
      const ctl = await makeControlProject({ roster: [x.entry] });
      try {
        const before = `[remote "node-x-remote"]\n\turl = https://git.example.test/group remotes/node-x.git\n[remote "origin"]\n\turl = https://git.example.test/origin.git\n`;
        await seedGitConfig(ctl.root, before);

        const result = await invoke("mesh:revoke", { node: "node-x", revokedAt: REVOKED_AT }, { workspace: ctl.workspace });
        assert.equal(result.revoked, true, "the revoke still succeeds");
        assert.equal("gitRemote" in result, false, "the revoke result exposes no git de-provisioning result");
        assert.equal(await readGitConfig(ctl.root), before, "repository metadata is byte-unchanged; revocation is registry-only");
      } finally {
        await rm(ctl.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: after mesh:revoke the auth-gate rejects the revoked node's credential ═
  {
    name: "mesh-revoke/01 after mesh:revoke the task-00 auth-gate rejects the revoked node's credential on its next connect (the live revocation list — T6), while a still-admitted peer is still admitted",
    async run() {
      const x = admittedNode("node-x");
      const y = admittedNode("node-y");
      const ctl = await makeControlProject({ roster: [x.entry, y.entry] });
      let relay = null;
      let firstConn = null;
      try {
        relay = await standRelay(ctl.workspace, ctl.workspace.config);
        // node-x is admitted and connects with a valid token BEFORE the revoke.
        firstConn = await attemptUpgrade(relay.url, x.token);
        assert.equal(firstConn.admitted, true, "node-x is admitted before the revoke");
        try { firstConn.ws?.close(); } catch { /* noop */ }

        // Revoke node-x on the control node.
        await invoke("mesh:revoke", { node: "node-x", revokedAt: REVOKED_AT }, { workspace: ctl.workspace });

        // node-x reconnects with the SAME token — rejected at the auth-gate (the live
        // revocation list, T6 revocation completeness).
        const reconnect = await attemptUpgrade(relay.url, x.token);
        assert.equal(reconnect.admitted, false, "node-x's reconnect is rejected at the auth-gate (the live revocation list — T6)");
        try { reconnect.ws?.close(); } catch { /* noop */ }

        // A still-admitted peer node-y is still admitted.
        const peer = await attemptUpgrade(relay.url, y.token);
        assert.equal(peer.admitted, true, "the still-admitted peer node-y is still admitted");
        try { peer.ws?.close(); } catch { /* noop */ }
      } finally {
        if (relay) await relay.stop();
        await rm(ctl.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:revoke on a non-control node refuses and leaves the registry
  //    byte-unchanged ════════════════════════════════════════════════════════════════
  {
    name: "mesh-revoke/01 mesh:revoke on a non-control node (controlNode !== nodeId) refuses and leaves the registry file byte-unchanged (no roster removal, no revocation append)",
    async run() {
      const x = admittedNode("node-x");
      // A control-node fixture writes the registry first (roster seeded)...
      const ctl = await makeControlProject({ roster: [x.entry] });
      try {
        // ...then flip the config to a NON-control node (controlNode !== nodeId).
        const nonControlConfig = { ...ctl.workspace.config, mesh: { nodeId: "other-node", relay: { controlNode: CONTROL_ID } } };
        const nonControlWorkspace = { ...ctl.workspace, config: nonControlConfig };

        // Record the registry bytes on disk before the refused invocation.
        const registryPath = path.join(meshDir(ctl.workspace), "registry", "group.json");
        const before = await readFile(registryPath, "utf8");

        let refused = null;
        await assert.rejects(
          () => invoke("mesh:revoke", { node: "node-x", revokedAt: REVOKED_AT }, { workspace: nonControlWorkspace }),
          (error) => { refused = error; return true; },
          "a non-control revoke refuses"
        );
        assert.equal(refused.code, "not-control-node", "the refusal names the control-node guard (revocation is an authority decision)");

        // The registry file is byte-unchanged — no roster removal, no revocation append.
        const after = await readFile(registryPath, "utf8");
        assert.equal(after, before, "the registry file is byte-unchanged after the refused non-control revoke");
      } finally {
        await rm(ctl.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:revoke --json emits a clean, parseable result ═══════════════════
  {
    name: "mesh-revoke/01 aof mesh revoke <node> --json emits clean, parseable JSON reporting the revoked nodeId and the recorded revokedAt",
    async run() {
      const x = admittedNode("node-x");
      const ctl = await makeControlProject({ roster: [x.entry] });
      try {
        // mesh:revoke touches only the local registry — no in-process server is
        // stood here, so the synchronous spawn is safe (no deadlock risk).
        const result = spawnCliSync(process.execPath, [cliPath, "mesh", "revoke", "node-x", "--json"], {
          cwd: ctl.root,
          encoding: "utf8",
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        assert.equal(result.status, 0, `aof mesh revoke <node> --json exits cleanly (stderr: ${result.stderr})`);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `the emitted JSON parses (stdout: ${result.stdout.slice(0, 200)})`);
        assert.equal(parsed.revoked, true, "the JSON reports the revoke succeeded");
        assert.equal(parsed.nodeId, "node-x", "the JSON reports the revoked nodeId");
        assert.equal(typeof parsed.revokedAt, "string", "the JSON reports the recorded revokedAt");
        assert.ok(!Number.isNaN(Date.parse(parsed.revokedAt)), "the reported revokedAt is a parseable instant");

        // The real CLI actually recorded it (the same observable, over the real face).
        const after = await readRegistry(ctl.workspace);
        assert.ok(!after.roster.some((e) => e.nodeId === "node-x"), "the real CLI removed node-x from the roster");
        assert.ok(after.revocations.some((r) => r.nodeId === "node-x"), "the real CLI appended the node-x revocation");
      } finally {
        await rm(ctl.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: revoking one node leaves other roster entries and other revocations
  //    untouched (add-only revocation, targeted removal) ════════════════════════════
  {
    name: "mesh-revoke/01 revoking node-x leaves the pre-existing node-w revocation byte-identical and the node-y / node-z roster entries byte-identical — add-only append, targeted removal",
    async run() {
      const x = admittedNode("node-x");
      const y = admittedNode("node-y");
      const z = admittedNode("node-z");
      const priorRevocation = { nodeId: "node-w", revokedAt: "2026-06-30T00:00:00.000Z", reason: "retired" };
      const ctl = await makeControlProject({ roster: [x.entry, y.entry, z.entry], revocations: [priorRevocation] });
      try {
        // Record the bytes of the node-w revocation and the node-y / node-z roster entries.
        const before = await readRegistry(ctl.workspace);
        const beforeW = JSON.stringify(before.revocations.find((r) => r.nodeId === "node-w"));
        const beforeY = JSON.stringify(before.roster.find((e) => e.nodeId === "node-y"));
        const beforeZ = JSON.stringify(before.roster.find((e) => e.nodeId === "node-z"));

        await invoke("mesh:revoke", { node: "node-x", reason: "compromised", revokedAt: REVOKED_AT }, { workspace: ctl.workspace });

        const after = await readRegistry(ctl.workspace);
        // The pre-existing node-w revocation is byte-identical (the append did not rewrite it).
        assert.equal(JSON.stringify(after.revocations.find((r) => r.nodeId === "node-w")), beforeW, "the node-w revocation is byte-identical (the append did not rewrite it)");
        // The node-y / node-z roster entries are byte-identical (the removal targeted node-x).
        assert.equal(JSON.stringify(after.roster.find((e) => e.nodeId === "node-y")), beforeY, "the node-y roster entry is byte-identical");
        assert.equal(JSON.stringify(after.roster.find((e) => e.nodeId === "node-z")), beforeZ, "the node-z roster entry is byte-identical");
        // The revocation list now holds BOTH node-w and node-x (add-only, not a rewrite).
        const revoked = after.revocations.map((r) => r.nodeId).sort();
        assert.deepEqual(revoked, ["node-w", "node-x"], "the revocation list holds both node-w and node-x (add-only, not a rewrite)");
      } finally {
        await rm(ctl.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: revocation does not require a git repository ═══════════════════════
  {
    name: "mesh-revoke/01 mesh:revoke succeeds without a git repository because revocation is registry-only",
    async run() {
      const x = admittedNode("node-x");
      const ctl = await makeControlProject({ roster: [x.entry] });
      try {
        assert.equal(await readGitConfig(ctl.root), null, "precondition: the fixture has no repository metadata");
        const result = await invoke("mesh:revoke", { node: "node-x", revokedAt: REVOKED_AT }, { workspace: ctl.workspace });
        assert.equal(result.revoked, true, "the revoke still succeeds without a git repo");
        assert.equal("gitRemote" in result, false, "the result has no git de-provisioning branch");
        const after = await readRegistry(ctl.workspace);
        assert.ok(!after.roster.some((e) => e.nodeId === "node-x"), "node-x is removed from the roster");
        assert.ok(after.revocations.some((r) => r.nodeId === "node-x"), "the node-x revocation is appended");
      } finally {
        await rm(ctl.root, { recursive: true, force: true });
      }
    },
  },
];
