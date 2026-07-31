import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import {
  meshGlobalPropagationDecision,
  publishGlobalWorkSnapshot,
  renderWithPropagationWarnings,
  threadPropagationWarnings,
} from "../src/global-work-publisher.mjs";
import { startLauncher } from "../src/mesh-launcher.mjs";

const NOW = "2026-07-05T10:00:00.000Z";
const NODE_ID = "node-a";

function frontmatter(fields) {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n`;
}

async function makeWorkRepo({ mesh = {} } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-global-propagation-"));
  const workDir = path.join(repo, "wiki", "work");
  const milestoneDir = path.join(workDir, "34_milestone_global-mesh");
  const storyDir = path.join(milestoneDir, "stories", "01_story_propagation");
  await mkdir(storyDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "34", slug: "global-mesh", status: "in-progress" }),
    "utf8",
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    frontmatter({ type: "story", number: "01", slug: "propagation", parent: "34", status: "in-progress" }),
    "utf8",
  );
  await writeFile(path.join(storyDir, "STATE.md"), "## Feedback (for retro)\n\n", "utf8");
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh }, null, 2)}\n`,
    "utf8",
  );
  return repo;
}


function manualTicker() {
  const handles = [];
  return {
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
    fire(handle) { handle.onTick(); },
    handles,
  };
}

const STATUS_FIXTURE = {
  BackendState: "Running",
  Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail.ts.net.`, TailscaleIPs: ["100.64.0.1"], Online: true },
  Peer: {},
};

export const globalWorkPropagationTests = [
  {
    name: "global-work-propagation/00 only config.mesh.enabled true enables global propagation",
    async run() {
      const disabled = [
        {},
        { mesh: {} },
        { mesh: { enabled: false } },
        { mesh: { enabled: "true" } },
        { mesh: { nodeId: NODE_ID } },
      ];
      for (const config of disabled) {
        const decision = meshGlobalPropagationDecision(config);
        assert.equal(decision.enabled, false, `${JSON.stringify(config)} is disabled`);
        assert.equal(decision.code, "mesh-global-disabled");
        let calls = 0;
        const result = await publishGlobalWorkSnapshot(
          { config, projectRoot: process.cwd(), workDir: process.cwd() },
          { globalPublisher: async () => { calls += 1; } },
        );
        assert.equal(result.code, "mesh-global-disabled");
        assert.equal(calls, 0, "disabled propagation never opens/calls the publisher");
      }
    },
  },
  {
    // 2026-07-26 (operator-found): the machine-wide mesh.enabled merges into ANY cwd,
    // so a daemon launched from a non-workspace directory (Task Scheduler's default
    // C:\WINDOWS\system32; an installer-dir launch) published that directory as a fleet
    // "workspace". The enable arm alone cannot gate — a real workspace must carry its
    // OWN config on disk.
    name: "global-work-propagation/00 an enabled-but-unconfigured DIRECTORY is refused — a launch cwd is not a workspace",
    async run() {
      const bareDir = await mkdtemp(path.join(os.tmpdir(), "aof-not-a-workspace-"));
      try {
        const ws = { config: { mesh: { enabled: true } }, projectRoot: bareDir, workDir: path.join(bareDir, "wiki", "work") };
        const decision = meshGlobalPropagationDecision(ws);
        assert.equal(decision.enabled, false, "no .aof/aof.config.json on disk -> refused despite the global enable");
        assert.equal(decision.code, "mesh-workspace-unconfigured");

        let calls = 0;
        const result = await publishGlobalWorkSnapshot(ws, { globalPublisher: async () => { calls += 1; } });
        assert.equal(result.code, "mesh-workspace-unconfigured");
        assert.equal(calls, 0, "an unconfigured directory never reaches the publisher");

        // A config-shaped argument (no projectRoot to check) keeps the enable-arm
        // behaviour — the pure-config callers are unaffected.
        assert.equal(meshGlobalPropagationDecision({ mesh: { enabled: true } }).enabled, true);
      } finally {
        await rm(bareDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "global-work-propagation/00 enabled workspaces call the injected publisher once",
    async run() {
      const repo = await makeWorkRepo({ mesh: { enabled: true } });
      try {
        const ws = await loadWorkspace(repo);
        let calls = 0;
        const result = await publishGlobalWorkSnapshot(ws, { globalPublisher: async () => { calls += 1; } });
        assert.equal(result.published, true);
        assert.equal(calls, 1);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // m42 wave (d) leg d4 (port 1): the same contract, now reached the ledgered
    // way. Publishing is a `local`-locus reactor, so a failure arrives as the
    // publish step's DETAIL rather than from a wrapper around the return value —
    // and threadPropagationWarnings is the ONE place that puts it back on the
    // result, so renders and --json see exactly what they saw before.
    name: "global-work-propagation/02 publisher failures are threaded from the effect outcome as propagationWarnings without changing the command result",
    async run() {
      const repo = await makeWorkRepo({ mesh: { enabled: true } });
      try {
        const ws = await loadWorkspace(repo);
        const error = new Error("sqlite unavailable");
        error.code = "sqlite-unavailable";
        // What the drain hands back for a failed publish: the step is `done` (the
        // publisher degrades internally and never throws) carrying the warning.
        const publish = await publishGlobalWorkSnapshot(ws, { globalPublisher: async () => { throw error; } });
        assert.equal(publish.published, false, "the publish did not land");
        const effects = [{ event: "run.started", key: "publish-projection", locus: "local", status: "done", detail: { published: false, warning: publish.warning } }];

        const result = threadPropagationWarnings({ ok: true }, effects);
        assert.equal(result.ok, true, "the original result remains present");
        assert.equal(result.propagationWarnings.length, 1);
        assert.equal(result.propagationWarnings[0].code, "sqlite-unavailable");
        assert.match(result.propagationWarnings[0].path, /projection\.sqlite$/);
        const rendered = renderWithPropagationWarnings("Succeeded.", result);
        assert.match(rendered, /^Succeeded\./);
        assert.match(rendered, /warning: global work propagation sqlite-unavailable/);

        // A clean cascade threads nothing — the result is returned untouched.
        const clean = threadPropagationWarnings({ ok: true }, [
          { key: "publish-projection", status: "done", detail: { published: true } },
        ]);
        assert.equal(clean.propagationWarnings, undefined, "a successful publish adds no warning key");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "global-work-propagation/01 work:feedback publishes once after the local STATE write and skips when mesh is not explicitly enabled",
    async run() {
      for (const row of [
        { mesh: { enabled: true }, expectedCalls: 1 },
        { mesh: { nodeId: NODE_ID }, expectedCalls: 0 },
      ]) {
        const repo = await makeWorkRepo({ mesh: row.mesh });
        try {
          const ws = await loadWorkspace(repo);
          let calls = 0;
          const result = await invoke(
            "work:feedback",
            { ref: "34/01", note: "capture propagation", actor: "qa" },
            { workspace: ws, globalPublisher: async () => { calls += 1; } },
          );
          assert.equal(result.ok, true);
          assert.equal(calls, row.expectedCalls);
          assert.match(await readFile(path.join(repo, "wiki", "work", "34_milestone_global-mesh", "stories", "01_story_propagation", "STATE.md"), "utf8"), /capture propagation/);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: "global-work-propagation/03 launcher publishes an initial snapshot and retries on each propagation tick without stopping the peer loop",
    async run() {
      const repo = await makeWorkRepo({
        mesh: { enabled: true, nodeId: NODE_ID, fabric: "tailscale", relay: { controlNode: NODE_ID } },
      });
      try {
        const ws = await loadWorkspace(repo);
        const peerTicker = manualTicker();
        const propagationTicker = manualTicker();
        let calls = 0;
        const handle = await startLauncher(ws, {
          exec: async () => ({ stdout: JSON.stringify(STATUS_FIXTURE), status: 0 }),
          platform: "linux",
          peerPollTicker: peerTicker,
          propagationTicker,
          globalPublisher: async () => {
            calls += 1;
            if (calls === 1) {
              const error = new Error("first publish failed");
              error.code = "projection-write-failed";
              throw error;
            }
          },
        });

        assert.equal(handle.refused, undefined);
        assert.equal(calls, 1, "initial publish attempted after preflight");
        assert.equal(handle.warnings.length, 1, "initial failure is captured as a launcher warning");
        assert.equal(peerTicker.handles.length, 1, "peer loop still started");
        propagationTicker.fire(propagationTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(calls, 2, "the next propagation tick attempts again");
        handle.stop();
        assert.equal(propagationTicker.handles[0].stopped, true);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
