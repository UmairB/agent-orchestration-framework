// Traceability wiring for milestone 24 / story 01 — task 02
// (tasks/02_mesh-join-and-provision.feature). aof mesh join <code> presents the code to
// the control node's endpoint, stores the issued credential in config.mesh.credential
// (merge-not-clobber), and provisions git-remote via the shell-less git-argv idiom.
//
// Covers EVERY @executable scenario, driving mesh:join against the SAME in-process
// serveRelay endpoint as task 01 (serveRelay on port 0, the story-00 registry seeded via
// writeRegistry) — no spawned relay. The git-remote provision runs against a LOCAL
// fixture clone (a real `git init` repo the test controls), with a granted url carrying
// a SPACE to prove the argv form does not word-split it (the 13/ADR-002 Windows hazard).
// Whether a real PUSH works is the @manual half (task 03) — here the remote is asserted
// configured in the fixture repo's own config. One test object per scenario.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { serveRelay, sha256Hex } from "../src/mesh-relay.mjs";
import { writeRegistry } from "../src/mesh-registry.mjs";
import { readNodeRecord } from "../src/mesh-store.mjs";
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

// ---- the joining side: a real git fixture clone with the mesh config seeded ----

async function makeJoiner(relayUrl, { gitInit = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-meshjoin-node-"));
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await mkdir(path.join(root, "wiki", "work"), { recursive: true });
  const config = {
    name: "joiner-fixture",
    runtimes: ["codex"],
    work: { dir: "./wiki/work" },
    mesh: { nodeId: JOINER_ID, salt: "fixture-salt", relay: { url: relayUrl } },
  };
  const configPath = path.join(root, ".aof", "aof.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  if (gitInit) {
    const init = spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
    assert.equal(init.status, 0, `git init the joining fixture clone (stderr: ${init.stderr})`);
  }
  return { root, configPath };
}

function gitRemotes(cwd) {
  const result = spawnSync("git", ["remote"], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
}

function gitRemoteUrl(cwd, name) {
  const result = spawnSync("git", ["remote", "get-url", name], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export const meshJoinProvisionTests = [
  // ══ Scenario: mesh:join on a match stores the credential in config.mesh.credential
  //    and preserves the other mesh keys ════════════════════════════════════════════
  {
    name: "mesh-join-provision/02 a matched code stores { relayAuth, nodeId, gitRemote } at config.mesh.credential and PRESERVES every other config key (read-merge-write, not a clobber)",
    async run() {
      const grantUrl = "https://git.example.test/group.git";
      const control = await standControl({ pending: [inviteFor("123456")], grantUrl });
      let joiner = null;
      try {
        joiner = await makeJoiner(control.relay.url);
        const before = JSON.parse(await readFile(joiner.configPath, "utf8"));

        const ctx = { workspace: await loadWorkspace(joiner.root) };
        const result = await invoke("mesh:join", { code: "123456" }, ctx);
        assert.equal(result.joined, true, "the join reports the admission");

        const joinedRecord = await readNodeRecord(control.workspace, JOINER_ID);
        assert.ok(joinedRecord, "the control node persisted the joined worker's node record during enrollment");
        assert.equal(joinedRecord.nodeId, JOINER_ID, "the persisted node record names the joining worker");
        assert.deepEqual(joinedRecord.runtimes, ["codex"], "the persisted node record carries the worker descriptor details sent by mesh:join");

        const after = JSON.parse(await readFile(joiner.configPath, "utf8"));
        // The credential is stored carrying { relayAuth, nodeId, gitRemote }.
        assert.equal(typeof after.mesh.credential.relayAuth, "string", "config.mesh.credential carries relayAuth");
        assert.ok(after.mesh.credential.relayAuth.length > 0, "relayAuth is non-empty");
        assert.equal(after.mesh.credential.nodeId, JOINER_ID, "config.mesh.credential carries the stream identity");
        assert.deepEqual(after.mesh.credential.gitRemote, { url: grantUrl, name: GRANT_NAME }, "config.mesh.credential carries the git-remote grant");
        // The merge PRESERVED the other mesh keys — byte-unchanged values, no clobber.
        assert.equal(after.mesh.nodeId, before.mesh.nodeId, "config.mesh.nodeId is unchanged by the merge");
        assert.deepEqual(after.mesh.relay, before.mesh.relay, "config.mesh.relay.url is unchanged by the merge");
        assert.equal(after.mesh.salt, before.mesh.salt, "config.mesh.salt survived the merge");
        // No other config key was dropped (read-merge-write, not overwrite).
        for (const key of Object.keys(before)) {
          assert.ok(key in after, `the top-level config key "${key}" survived the write`);
        }
        for (const key of Object.keys(before.mesh)) {
          assert.ok(key in after.mesh, `the mesh key "${key}" survived the write`);
        }
        assert.deepEqual(after.name, before.name, "the non-mesh top level is untouched");
        assert.deepEqual(after.work, before.work, "the work block is untouched");
      } finally {
        await control.relay.stop();
        await rm(control.repo, { recursive: true, force: true });
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: on a match git-remote access is provisioned via the shell-less
  //    git-argv form on the joining node's own clone ════════════════════════════════
  {
    name: "mesh-join-provision/02 on a match the granted remote is configured on the joining node's OWN clone via the spawnSync argv form — a url containing a SPACE is not word-split, and no foreign git write verb exists",
    async run() {
      // The load-bearing grant: a url carrying a SPACE (a shell string would word-split
      // it into two argv tokens — the 13/ADR-002 Windows hazard).
      const grantUrl = "https://git.example.test/group remotes/fleet.git";
      const control = await standControl({ pending: [inviteFor("654321")], grantUrl });
      let joiner = null;
      try {
        joiner = await makeJoiner(control.relay.url);
        const ctx = { workspace: await loadWorkspace(joiner.root) };
        const result = await invoke("mesh:join", { code: "654321" }, ctx);

        // The remote was provisioned on the joining node's OWN clone.
        assert.equal(result.gitRemote.provisioned, true, "the join provisioned the granted remote");
        assert.deepEqual(gitRemotes(joiner.root), [GRANT_NAME], "the named remote is configured in the joining clone");
        // The EXACT granted url survives — the space was NOT word-split.
        assert.equal(gitRemoteUrl(joiner.root, GRANT_NAME), grantUrl, "the remote carries the exact granted url — the space was not word-split (argv form, not a shell string)");

        // The structural half of the observable: the spawn IS the argv form.
        const source = await readFile(MESH_JOIN_SRC, "utf8");
        const noComments = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        assert.ok(
          /spawnSync\s*\(\s*"git"\s*,\s*\[\s*"remote"\s*,\s*"add"/.test(noComments),
          'git remote add is invoked as spawnSync("git", ["remote","add",name,url]) — the argv form'
        );
        assert.ok(!/\bexec(?:Sync)?\s*\(/.test(noComments), "no exec(/execSync( shell form exists in mesh-join");
        // No git WRITE verb against any foreign source tree: the only argv verbs are the
        // remote-configuration verbs on the node's own clone.
        const verbs = [];
        for (const m of noComments.matchAll(/spawnSync\s*\(\s*"git"\s*,\s*\[([^\]]*)\]/g)) {
          for (const lit of m[1].matchAll(/"([^"]+)"/g)) verbs.push(lit[1]);
        }
        assert.ok(verbs.length > 0, "the argv extractor reads the git verbs (an unreadable spawn would be a shell form)");
        for (const verb of verbs) {
          assert.ok(["remote", "get-url", "add"].includes(verb), `the git verb "${verb}" only configures the node's own clone (no commit/push/clone against a foreign tree)`);
        }
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
        const priorRemotes = gitRemotes(joiner.root);

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
        // And no git remote was added on the rejection.
        assert.deepEqual(gitRemotes(joiner.root), priorRemotes, "no git remote was added to the joining clone");
        assert.deepEqual(priorRemotes, [], "the clone had no remotes before, and still has none");
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
        joiner = await makeJoiner(control.relay.url);
        // ASYNC spawn (spawnCliAsync), NOT the synchronous spawnCliSync: the relay
        // endpoint the CLI presents its code to is stood IN THIS process (standControl
        // above), and spawnSync would BLOCK this process's event loop for the child's
        // whole lifetime — so the in-process relay could never accept the child's
        // request and the join would deadlock (the child's fetch hangs → SIGTERM). An
        // async spawn keeps this loop live to serve the child while it runs.
        const result = await spawnCliAsync(process.execPath, [cliPath, "mesh", "join", "222333", "--json"], {
          cwd: joiner.root,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        assert.equal(result.status, 0, `aof mesh join <code> --json exits cleanly (stderr: ${result.stderr})`);
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, "the emitted JSON parses");
        assert.equal(parsed.joined, true, "the JSON reports the admission");
        assert.equal(typeof parsed.credential.relayAuth, "string", "the JSON reports the stored credential");
        // The spawned face really stored it (the same observable, over the real CLI).
        const after = JSON.parse(await readFile(joiner.configPath, "utf8"));
        assert.equal(typeof after.mesh.credential.relayAuth, "string", "the credential landed in config.mesh.credential via the real CLI");
      } finally {
        await control.relay.stop();
        await rm(control.repo, { recursive: true, force: true });
        if (joiner) await rm(joiner.root, { recursive: true, force: true });
      }
    },
  },
];
