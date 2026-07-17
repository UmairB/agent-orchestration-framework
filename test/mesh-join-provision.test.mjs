// Traceability wiring for milestone 24 / story 01 — task 02
// (tasks/02_mesh-join-and-provision.feature). aof mesh join <code> presents the code to
// the control node's endpoint, stores the issued credential in config.mesh.credential
// (merge-not-clobber). Repository remotes are deliberately outside mesh membership.
//
// Covers EVERY @executable scenario, driving mesh:join against the SAME in-process
// serveRelay endpoint as task 01 (serveRelay on port 0, the story-00 registry seeded via
// writeRegistry) — no spawned relay. Any legacy repository grant returned by a stale
// control endpoint is ignored; fixture remotes exist only to prove join leaves them alone.
// One test object per scenario.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { serveRelay, sha256Hex } from "../src/mesh-relay.mjs";
import { writeRegistry } from "../src/mesh-registry.mjs";
import { readNodeRecord, publishNodeRecord } from "../src/mesh-store.mjs";
import { globalWorkspacePaths } from "../src/workspace.mjs";
import { meshJoinCommand } from "../src/commands/mesh-join.mjs";
import { spawnCliAsync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const MESH_JOIN_SRC = path.join(repoRoot, "src", "commands", "mesh-join.mjs");

const CONTROL_ID = "control-node-a";
const JOINER_ID = "joiner-node";
const CLOCK = "2026-07-01T10:00:00.000Z";
const GRANT_NAME = "aof-mesh";

// ---- the control side: a seeded registry + the in-process device-flow endpoint ----

function controlConfig(grantUrl) {
  return {
    mesh: {
      nodeId: CONTROL_ID,
      relay: { controlNode: CONTROL_ID },
      enrollment: { gitRemote: { url: grantUrl, name: GRANT_NAME } },
    },
  };
}

function inviteFor(plain) {
  return {
    codeHash: sha256Hex(plain),
    issuedAt: CLOCK,
    expiresAt: new Date(Date.parse(CLOCK) + 300 * 1000).toISOString(),
    consumedAt: null,
  };
}

// Stand the control node: a temp registry workspace + serveRelay with the enrollment
// route wired (injected clock — every invite above is live at CLOCK).
async function standControl({ pending, grantUrl }) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-meshjoin-ctl-"));
  const workspace = {
    workDir: path.join(repo, "wiki", "work"),
    projectRoot: repo,
    globalMeshRoot: path.join(repo, ".global-aof", "mesh"),
  };
  await mkdir(workspace.workDir, { recursive: true });
  const config = controlConfig(grantUrl);
  await writeRegistry(workspace, { roster: [], boards: [], pending, revocations: [] }, config);
  const relay = await serveRelay({ port: 0, config, workspace, now: () => CLOCK });
  return { repo, workspace, config, relay };
}

// ---- the joining side: a workspace fixture with the mesh config seeded ----

async function makeJoiner(relayUrl) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-meshjoin-node-"));
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await mkdir(path.join(root, "wiki", "work"), { recursive: true });
  const mesh = { nodeId: JOINER_ID, salt: "fixture-salt" };
  if (typeof relayUrl === "string" && relayUrl.length > 0) {
    mesh.relay = { url: relayUrl };
  }
  const config = {
    name: "joiner-fixture",
    runtimes: ["codex"],
    work: { dir: "./wiki/work" },
    mesh,
  };
  const configPath = path.join(root, ".aof", "aof.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { root, configPath };
}

async function seedGlobalConfig(env, content) {
  const paths = globalWorkspacePaths({ env });
  await mkdir(path.dirname(paths.configPath), { recursive: true });
  await writeFile(paths.configPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return paths.configPath;
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

function tailscaleExecWithControlPeer({ controlId = "umairs-msi", address = "100.90.249.80" } = {}) {
  const payload = {
    BackendState: "Running",
    Self: { HostName: JOINER_ID, DNSName: `${JOINER_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
    Peer: {
      control: { HostName: controlId, DNSName: `${controlId}.tail1a2b.ts.net.`, TailscaleIPs: [address], Online: true },
    },
  };
  return async () => ({ stdout: JSON.stringify(payload), stderr: "", status: 0 });
}


export const meshJoinProvisionTests = [
  // ══ Scenario: mesh:join command input accepts a Tailscale control name ═══════════
  {
    name: "mesh-join-provision/02 command argv accepts --control <tailscale-name> as the human-facing join target",
    run() {
      assert.deepEqual(
        meshJoinCommand.cli.argv(["123456"], { control: "umairs-msi" }),
        { code: "123456", control: "umairs-msi", relayUrl: undefined },
        "the command input maps --control into the join request"
      );
    },
  },
  {
    name: "mesh-join-provision/02 --control resolves the Tailscale node name to its fabric IP before posting enrollment",
    async run() {
      let joiner = null;
      try {
        joiner = await makeJoiner(null);
        const env = { ...process.env, AOF_GLOBAL_HOME: path.join(joiner.root, ".global-aof") };
        const workspace = await loadWorkspace(joiner.root, undefined, { env });
        let requestedUrl = null;
        const fetchImpl = async (url, options) => {
          requestedUrl = url;
          const body = JSON.parse(options.body);
          assert.equal(body.code, "123456", "the invite code is still presented to enrollment");
          assert.equal(body.nodeId, JOINER_ID, "the joining node identity is presented to enrollment");
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, credential: { relayAuth: "secret", nodeId: JOINER_ID, controlNode: "umairs-msi", gitRemote: null } }),
          };
        };

        const result = await invoke("mesh:join", { code: "123456", control: "umairs-msi" }, {
          workspace,
          env,
          exec: tailscaleExecWithControlPeer(),
          platform: "linux",
          fetch: fetchImpl,
        });

        assert.equal(requestedUrl, "http://100.90.249.80:4182/enroll", "--control posts enrollment to the resolved Tailscale IP, not the raw short name");
        assert.equal(result.relayUrl, "ws://100.90.249.80:4182/ws/relay", "the joined global config records the resolved relay URL");
        assert.doesNotMatch(meshJoinCommand.cli.render(result), /git remote|no git remote/i, "the human join output does not mention git remotes");
        const paths = globalWorkspacePaths({ env });
        const globalConfig = JSON.parse(await readFile(paths.configPath, "utf8"));
        assert.equal(globalConfig.mesh.relay.url, "ws://100.90.249.80:4182/ws/relay", "the global config persists the resolved relay URL");
        assert.equal(globalConfig.mesh.relay.controlNode, "umairs-msi", "the global config keeps the friendly control node identity separately");
      } finally {
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },
  // ══ Scenario: mesh:join on a match stores the credential in the global AOF config
  //    and preserves both local workspace config and existing global keys ══════════
  {
    name: "mesh-join-provision/02 a matched code writes mesh enablement, relay, control node, and credential to the GLOBAL AOF config without rewriting the workspace config",
    async run() {
      const grantUrl = "https://git.example.test/group.git";
      const control = await standControl({ pending: [inviteFor("123456")], grantUrl });
      let joiner = null;
      try {
        joiner = await makeJoiner(null);
        const workspaceBefore = JSON.parse(await readFile(joiner.configPath, "utf8"));
        const env = { ...process.env, AOF_GLOBAL_HOME: path.join(joiner.root, ".global-aof") };
        const globalConfigPath = await seedGlobalConfig(env, { name: "global-fixture", mesh: { existing: "preserved" } });

        const ctx = { workspace: await loadWorkspace(joiner.root, undefined, { env }), env };
        const result = await invoke("mesh:join", { code: "123456", relayUrl: control.relay.url }, ctx);
        assert.equal(result.joined, true, "the join reports the admission");

        const joinedRecord = await readNodeRecord(control.workspace, JOINER_ID);
        assert.ok(joinedRecord, "the control node persisted the joined worker's node record during enrollment");
        assert.equal(joinedRecord.nodeId, JOINER_ID, "the persisted node record names the joining worker");
        assert.deepEqual(joinedRecord.runtimes, ["codex"], "the persisted node record carries the worker descriptor details sent by mesh:join");

        const workspaceAfter = JSON.parse(await readFile(joiner.configPath, "utf8"));
        assert.deepEqual(workspaceAfter, workspaceBefore, "the workspace .aof config is not rewritten by mesh:join");

        const globalAfter = JSON.parse(await readFile(globalConfigPath, "utf8"));
        assert.equal(globalAfter.mesh.enabled, true, "global mesh config is enabled after join");
        assert.equal(globalAfter.mesh.fabric, "tailscale", "global mesh config declares the tailscale fabric after join");
        assert.equal(globalAfter.mesh.relay.url, control.relay.url, "global mesh config stores the relay URL used for enrollment");
        assert.equal(globalAfter.mesh.relay.controlNode, CONTROL_ID, "global mesh config stores the control node identity returned by enrollment");
        assert.equal(typeof globalAfter.mesh.credential.relayAuth, "string", "global config mesh.credential carries relayAuth");
        assert.ok(globalAfter.mesh.credential.relayAuth.length > 0, "relayAuth is non-empty");
        assert.equal(globalAfter.mesh.credential.nodeId, JOINER_ID, "global config mesh.credential carries the stream identity");
        assert.equal("gitRemote" in globalAfter.mesh.credential, false, "global config mesh.credential carries no git-remote grant; mesh sync is websocket-only");
        assert.equal(globalAfter.mesh.existing, "preserved", "existing global mesh keys survive the merge");
        assert.equal(globalAfter.name, "global-fixture", "existing top-level global config keys survive the merge");
      } finally {
        await control.relay.stop();
        await rm(control.repo, { recursive: true, force: true });
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:join persists the CONTROL NODE'S own descriptor locally, not
  //    just the joiner's own credential — closing the gap where a freshly (or
  //    re-)joined worker's resolvePeers roster-join had nothing to match a live
  //    tailscale peer against, regardless of tailscale connectivity ══════════════
  {
    name: "mesh-join-provision/02 a matched code persists the control node's OWN descriptor into the joiner's local nodes/ directory",
    async run() {
      const grantUrl = "https://git.example.test/group.git";
      const control = await standControl({ pending: [inviteFor("777888")], grantUrl });
      let joiner = null;
      try {
        // The control node publishes itself locally BEFORE serving (exactly as a real
        // control node does via `aof mesh identity`) — this is the record the enroll
        // response now hands back to the joiner.
        await publishNodeRecord(control.workspace, CONTROL_ID, {
          nodeId: CONTROL_ID,
          role: "control",
          controlNode: true,
          host: "control-host",
          os: "linux",
          runtimes: [],
          aofVersion: "1.0.0",
          publishedAt: CLOCK,
        });

        joiner = await makeJoiner(null);
        const env = { ...process.env, AOF_GLOBAL_HOME: path.join(joiner.root, ".global-aof") };
        const joinerWorkspace = await loadWorkspace(joiner.root, undefined, { env });
        const ctx = { workspace: joinerWorkspace, env };
        const result = await invoke("mesh:join", { code: "777888", relayUrl: control.relay.url }, ctx);
        assert.equal(result.joined, true, "the join reports the admission");

        const persisted = await readNodeRecord(joinerWorkspace, CONTROL_ID);
        assert.ok(persisted, "the joiner persisted a local node record for the control node it just joined");
        assert.equal(persisted.nodeId, CONTROL_ID, "the persisted record names the control node");
        assert.equal(persisted.host, "control-host", "the persisted record carries the control node's own descriptor detail");

        const globalConfigPath = globalWorkspacePaths({ env }).configPath;
        const globalAfter = JSON.parse(await readFile(globalConfigPath, "utf8"));
        assert.equal("controlNodeRecord" in globalAfter.mesh.credential, false, "controlNodeRecord is persisted as a node record, not folded into mesh.credential");
      } finally {
        await control.relay.stop();
        await rm(control.repo, { recursive: true, force: true });
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-join-provision/02 a matched code with NO self-published control-node record still admits cleanly (absence-tolerant, pre-fix control node compatibility)",
    async run() {
      const grantUrl = "https://git.example.test/group.git";
      // standControl never publishes a self node-record for CONTROL_ID here — the
      // ORIGINAL "a matched code writes mesh enablement..." scenario's own control
      // fixture, unchanged, exercises exactly this absent-record path already; this
      // test names the guarantee explicitly so it never silently regresses.
      const control = await standControl({ pending: [inviteFor("111222")], grantUrl });
      let joiner = null;
      try {
        joiner = await makeJoiner(null);
        const env = { ...process.env, AOF_GLOBAL_HOME: path.join(joiner.root, ".global-aof") };
        const joinerWorkspace = await loadWorkspace(joiner.root, undefined, { env });
        const ctx = { workspace: joinerWorkspace, env };
        const result = await invoke("mesh:join", { code: "111222", relayUrl: control.relay.url }, ctx);
        assert.equal(result.joined, true, "the join still admits cleanly with no control-node record to hand back");

        const persisted = await readNodeRecord(joinerWorkspace, CONTROL_ID);
        assert.equal(persisted, null, "no local node record is fabricated for a control node that never published itself");
      } finally {
        await control.relay.stop();
        await rm(control.repo, { recursive: true, force: true });
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:join is websocket-only and never provisions git remotes ══════
  {
    name: "mesh-join-provision/02 on a match mesh:join ignores any legacy git grant and configures no git remote",
    async run() {
      const grantUrl = "https://git.example.test/group remotes/fleet.git";
      const control = await standControl({ pending: [inviteFor("654321")], grantUrl });
      let joiner = null;
      try {
        joiner = await makeJoiner(control.relay.url);
        const gitConfigBefore = `[remote "origin"]\n\turl = https://git.example.test/origin.git\n`;
        await seedGitConfig(joiner.root, gitConfigBefore);
        const ctx = { workspace: await loadWorkspace(joiner.root) };
        const result = await invoke("mesh:join", { code: "654321" }, ctx);

        assert.equal(result.joined, true, "the join still admits the worker");
        assert.equal("gitRemote" in result, false, "the join result exposes no git provisioning result");
        assert.equal(await readGitConfig(joiner.root), gitConfigBefore, "repository metadata is byte-unchanged; mesh sync is websocket-only");

        const source = await readFile(MESH_JOIN_SRC, "utf8");
        const noComments = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        assert.ok(!/spawnSync\s*\(\s*"git"/.test(noComments), "mesh-join no longer spawns git at all");
        assert.ok(!/\bexec(?:Sync)?\s*\(/.test(noComments), "mesh-join has no exec shell form either");
      } finally {
        await control.relay.stop();
        await rm(control.repo, { recursive: true, force: true });
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:join on a rejection surfaces a clean error and stores nothing ══
  {
    name: "mesh-join-provision/02 a rejected code surfaces a clean face error, leaves config byte-unchanged (no credential), and adds no git remote",
    async run() {
      const grantUrl = "https://git.example.test/group.git";
      // The endpoint holds an invite for a DIFFERENT code — the presented one rejects.
      const control = await standControl({ pending: [inviteFor("123456")], grantUrl });
      let joiner = null;
      try {
        joiner = await makeJoiner(control.relay.url);
        const priorBytes = await readFile(joiner.configPath, "utf8");
        const priorGitConfig = await readGitConfig(joiner.root);

        const ctx = { workspace: await loadWorkspace(joiner.root) };
        let refused = null;
        await assert.rejects(
          () => invoke("mesh:join", { code: "999999" }, ctx),
          (error) => {
            refused = error;
            return true;
          },
          "a rejected code did not admit"
        );
        assert.equal(refused.code, "no-match", "the clean face error names the structured rejection class");
        assert.match(refused.message, /nothing was stored/i, "the error tells the operator nothing was stored");

        // R4 — config is BYTE-unchanged (no config.mesh.credential written).
        assert.equal(await readFile(joiner.configPath, "utf8"), priorBytes, "config is byte-unchanged after the rejection");
        // And no repository metadata was created on the rejection.
        assert.equal(await readGitConfig(joiner.root), priorGitConfig, "repository metadata is unchanged after the rejected join");
        assert.equal(priorGitConfig, null, "the fixture starts without repository metadata, and join does not create it");
      } finally {
        await control.relay.stop();
        await rm(control.repo, { recursive: true, force: true });
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:join <code> --json runs clean and parseable (rides the existing
  //    bijection gate) ═══════════════════════════════════════════════════════════════
  {
    name: "mesh-join-provision/02 aof mesh join <code> --json against the live in-process endpoint exits cleanly and parses to the join result (admission + stored credential)",
    async run() {
      const grantUrl = "https://git.example.test/group.git";
      const control = await standControl({ pending: [inviteFor("222333")], grantUrl });
      let joiner = null;
      try {
        joiner = await makeJoiner(null);
        const env = { ...process.env, NODE_NO_WARNINGS: "1", AOF_GLOBAL_HOME: path.join(joiner.root, ".global-aof") };
        // ASYNC spawn (spawnCliAsync), NOT the synchronous spawnCliSync: the relay
        // endpoint the CLI presents its code to is stood IN THIS process (standControl
        // above), and spawnSync would BLOCK this process's event loop for the child's
        // whole lifetime — so the in-process relay could never accept the child's
        // request and the join would deadlock (the child's fetch hangs → SIGTERM). An
        // async spawn keeps this loop live to serve the child while it runs.
        const result = await spawnCliAsync(process.execPath, [cliPath, "mesh", "join", "222333", "--url", control.relay.url, "--json"], {
          cwd: joiner.root,
          env,
        });
        assert.equal(result.status, 0, `aof mesh join <code> --json exits cleanly (stderr: ${result.stderr})`);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, "the emitted JSON parses");
        assert.equal(parsed.joined, true, "the JSON reports the admission");
        assert.equal(typeof parsed.credential.relayAuth, "string", "the JSON reports the stored credential");
        // The spawned face really stored it in the global AOF config (the same observable, over the real CLI).
        const paths = globalWorkspacePaths({ env });
        const after = JSON.parse(await readFile(paths.configPath, "utf8"));
        assert.equal(after.mesh.relay.url, control.relay.url, "the relay URL landed in the global config via the real CLI");
        assert.equal(typeof after.mesh.credential.relayAuth, "string", "the credential landed in global config mesh.credential via the real CLI");
      } finally {
        await control.relay.stop();
        await rm(control.repo, { recursive: true, force: true });
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },
];
