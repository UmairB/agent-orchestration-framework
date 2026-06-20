// Traceability wiring for milestone 06 / story 02 — headroom-wrap-routing. The
// @executable SERVER scenarios across the three task features, driven END-TO-END
// through the REAL handleConnection (src/terminal-ws.mjs) with an INJECTED stub
// spawn + stub PATH lookup — no real node-pty, no real PATH. This proves the seam
// carries resolveHeadroomLaunch's verdict (ADR-003) to the real spawn; the pure
// branch table itself is unit-tested by acd-headroom-honest-degrade.
//
//   00_wrap-spawn-routing.feature        — enabled + routable + headroom present →
//       spawn the headroom binary with args beginning ["wrap", <provider>], no error.
//   01_degrade-spawn-passthrough.feature — enabled but headroom absent → raw provider,
//       no wrap, no error; gemini never wrapped; the missing-PROVIDER gate is unchanged.
//   02_absent-config-unchanged.feature   — no work.headroom / enabled:false → raw
//       provider, no wrap, even when headroom is on PATH (plugin invisible).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveSetupUi } from "../src/setup-ui.mjs";

// --- fixtures ----------------------------------------------------------------

// A repo whose aof.config.json carries an arbitrary work.headroom block (or none).
// `headroom` is the value placed at config.work.headroom; pass undefined to omit
// the key entirely (the absent-block / plugin-invisible case). Other config (name,
// work.dir, a sibling work.ui) is present so the plugin only ever touches its own
// subtree. A resolvable item dir is seeded so the ref → cwd resolution succeeds.
async function makeRepo({ headroom } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-headroom-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const work = { dir: "./wiki/work", ui: { baseUrl: "http://localhost:5173" } };
  if (headroom !== undefined) work.headroom = headroom;
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work }, null, 2),
    "utf8"
  );
  const storyDir = path.join(workDir, "06_milestone_headroom-plugin", "stories", "02_story_headroom-wrap-routing");
  await mkdir(path.join(storyDir, "tasks"), { recursive: true });
  await writeFile(
    path.join(workDir, "06_milestone_headroom-plugin", "SPEC.md"),
    "---\ntype: milestone\nnumber: \"06\"\nslug: headroom-plugin\nstatus: in-progress\ntitle: \"Headroom\"\ncreated: 2026-06-20\nupdated: 2026-06-20\n---\n# 06\n",
    "utf8"
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    "---\ntype: story\nnumber: \"02\"\nslug: headroom-wrap-routing\nstatus: in-progress\ntitle: \"Wrap routing\"\nparent: 6\ncreated: 2026-06-20\nupdated: 2026-06-20\n---\n# 02\n",
    "utf8"
  );
  return { repo, storyDir };
}

// A stub `which`: only the named bins resolve (to a fake absolute path), everything
// else is absent. Mirrors terminal-providers' defaultWhich signature. Used for BOTH
// the provider binary AND "headroom" so each scenario pins both on/off PATH.
function stubWhich(presentBins) {
  const present = new Set(presentBins);
  return (bin) => (present.has(bin) ? `/fake/bin/${bin}` : null);
}

// A stub spawn that records the resolved binary/args (so we assert WHICH launch
// ran) and behaves like a node-pty handle: onData/onExit/write/resize/kill.
function recordingSpawn(calls) {
  return (bin, args, options) => {
    calls.push({ bin, args, options });
    return {
      pid: 1234,
      onData(handler) {
        queueMicrotask(() => handler("ready\r\n"));
        return { dispose() {} };
      },
      onExit() {
        return { dispose() {} };
      },
      write() {},
      resize() {},
      kill() {},
    };
  };
}

// --- ws harness --------------------------------------------------------------

async function withServer(repo, serverOptions, body) {
  const { server, url } = await serveSetupUi(null, { projectDir: repo, port: 0, ...serverOptions });
  const wsBase = `ws://127.0.0.1:${server.address().port}`;
  try {
    return await body({ url, wsBase, server });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Open a /ws/terminal connection and collect the frames the server sends until the
// socket closes (or a timeout). Returns { frames, controls, closed }.
function connectTerminal(wsBase, ref, provider, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ ref, provider });
    const ws = new WebSocket(`${wsBase}/ws/terminal?${params.toString()}`);
    const frames = [];
    const controls = [];
    let settled = false;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      resolve({ frames, controls, closed });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    ws.on("message", (data, isBinary) => {
      const text = isBinary ? null : data.toString();
      frames.push(text);
      if (text && text.startsWith("{")) {
        try { controls.push(JSON.parse(text)); } catch { /* not control */ }
      }
    });
    ws.on("close", () => finish(true));
    ws.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

const REF = "06/02";

// Open one session and return the recorded spawn calls + the control frames.
async function openSession({ headroom, present, provider }) {
  const { repo } = await makeRepo({ headroom });
  const calls = [];
  try {
    const result = await withServer(
      repo,
      { spawn: recordingSpawn(calls), which: stubWhich(present) },
      async ({ wsBase }) => connectTerminal(wsBase, REF, provider)
    );
    return { calls, controls: result.controls };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

const hasErrorFrame = (controls) => controls.some((c) => c.type === "error");
const enabledBlock = { enabled: true, providers: ["claude", "codex"] };

// --- tests -------------------------------------------------------------------

export const headroomWrapRoutingTests = [
  // ===== 00_wrap-spawn-routing.feature =======================================

  // Scenario: an enabled routable claude session spawns headroom wrap claude
  // Scenario: an enabled routable codex session spawns headroom wrap codex
  // Scenario Outline: an enabled routable <provider> session spawns headroom wrap <provider>
  //   (the two named scenarios and the outline rows are the SAME observable case
  //    over {claude, codex}; one parametrised test per provider traces all three).
  ...["claude", "codex"].map((provider) => ({
    name: `headroom-wrap-routing/00 an enabled routable ${provider} session spawns headroom wrap ${provider}`,
    async run() {
      // Given the plugin is enabled + routable, the provider AND headroom on PATH.
      const { calls, controls } = await openSession({
        headroom: enabledBlock,
        present: [provider, "headroom"],
        provider,
      });
      // Then spawn is invoked with the resolved headroom binary.
      assert.equal(calls.length, 1, "exactly one launch was spawned");
      assert.equal(calls[0].bin, "/fake/bin/headroom", "the spawned binary is the resolved headroom path");
      // And spawn's args begin with ["wrap", "<provider>"].
      assert.deepEqual(calls[0].args.slice(0, 2), ["wrap", provider], `args begin ["wrap", "${provider}"]`);
      // And no error control-frame is emitted.
      assert.equal(hasErrorFrame(controls), false, "no error control-frame is emitted");
    },
  })),

  // ===== 01_degrade-spawn-passthrough.feature ================================

  // Scenario: enabled but headroom absent degrades to the raw provider with no error frame
  {
    name: "headroom-wrap-routing/01 enabled but headroom absent degrades to the raw provider with no error frame",
    async run() {
      // Given enabled, the claude binary on PATH, but headroom NOT on PATH.
      const { calls, controls } = await openSession({
        headroom: enabledBlock,
        present: ["claude"],
        provider: "claude",
      });
      // Then spawn is invoked with the raw "claude" provider binary.
      assert.equal(calls.length, 1, "exactly one launch was spawned");
      assert.equal(calls[0].bin, "/fake/bin/claude", "the spawned binary is the raw claude provider");
      // And spawn's args do not begin with "wrap".
      assert.notEqual(calls[0].args[0], "wrap", "args do not begin with wrap");
      // And no error control-frame is emitted.
      assert.equal(hasErrorFrame(controls), false, "no error control-frame is emitted (degrade, not break)");
    },
  },

  // Scenario: gemini is never wrapped even when headroom is on PATH
  {
    name: "headroom-wrap-routing/01 gemini is never wrapped even when headroom is on PATH",
    async run() {
      // Given enabled, gemini AND headroom on PATH (gemini is never routable).
      const { calls, controls } = await openSession({
        headroom: enabledBlock,
        present: ["gemini", "headroom"],
        provider: "gemini",
      });
      // Then spawn is invoked with the raw "gemini" provider binary.
      assert.equal(calls.length, 1, "exactly one launch was spawned");
      assert.equal(calls[0].bin, "/fake/bin/gemini", "the spawned binary is the raw gemini provider");
      // And spawn's args do not begin with "wrap".
      assert.notEqual(calls[0].args[0], "wrap", "gemini args do not begin with wrap");
      // And no error control-frame is emitted.
      assert.equal(hasErrorFrame(controls), false, "no error control-frame is emitted");
    },
  },

  // Scenario: a missing PROVIDER binary still fires the existing error control-frame (not the degrade path)
  {
    name: "headroom-wrap-routing/01 a missing PROVIDER binary still fires the existing error control-frame (not the degrade path)",
    async run() {
      // Given the PROVIDER binary itself is absent, headroom present.
      const { calls, controls } = await openSession({
        headroom: enabledBlock,
        present: ["headroom"],
        provider: "claude",
      });
      // Then an error control-frame is emitted naming the missing provider.
      const error = controls.find((c) => c.type === "error");
      assert.ok(error, "an error control-frame is emitted");
      assert.ok(error.message.includes("claude"), "the error names the missing provider (claude)");
      // And spawn is never invoked (the resolver is never reached).
      assert.equal(calls.length, 0, "spawn is never invoked for an absent provider");
    },
  },

  // Scenario Outline: the enabled launch matrix routes, degrades, or errors per the missing-binary distinction
  ...[
    // routable provider present + headroom present -> wrapped, no error
    { provider: "claude", providerOnPath: "present", headroomOnPath: "yes", spawnBin: "headroom", wrapArgs: "yes", errorFrame: "no" },
    { provider: "codex", providerOnPath: "present", headroomOnPath: "yes", spawnBin: "headroom", wrapArgs: "yes", errorFrame: "no" },
    // routable provider present + headroom absent -> honest degrade to raw, no error
    { provider: "claude", providerOnPath: "present", headroomOnPath: "no", spawnBin: "raw claude", wrapArgs: "no", errorFrame: "no" },
    { provider: "codex", providerOnPath: "present", headroomOnPath: "no", spawnBin: "raw codex", wrapArgs: "no", errorFrame: "no" },
    // gemini present (never routable) -> raw, no error, regardless of headroom
    { provider: "gemini", providerOnPath: "present", headroomOnPath: "yes", spawnBin: "raw gemini", wrapArgs: "no", errorFrame: "no" },
    { provider: "gemini", providerOnPath: "present", headroomOnPath: "no", spawnBin: "raw gemini", wrapArgs: "no", errorFrame: "no" },
    // provider ABSENT -> the unchanged missing-provider gate, spawn never reached
    { provider: "claude", providerOnPath: "absent", headroomOnPath: "yes", spawnBin: "(none)", wrapArgs: "no", errorFrame: "yes" },
    { provider: "claude", providerOnPath: "absent", headroomOnPath: "no", spawnBin: "(none)", wrapArgs: "no", errorFrame: "yes" },
  ].map((row) => ({
    name: `headroom-wrap-routing/01 launch matrix [provider=${row.provider} providerOnPath=${row.providerOnPath} headroomOnPath=${row.headroomOnPath}] -> spawnBin=${row.spawnBin} wrapArgs=${row.wrapArgs} errorFrame=${row.errorFrame}`,
    async run() {
      const present = [];
      if (row.providerOnPath === "present") present.push(row.provider);
      if (row.headroomOnPath === "yes") present.push("headroom");
      const { calls, controls } = await openSession({
        headroom: enabledBlock,
        present,
        provider: row.provider,
      });

      if (row.spawnBin === "(none)") {
        assert.equal(calls.length, 0, "spawn is never reached (missing-provider gate)");
      } else {
        assert.equal(calls.length, 1, "exactly one launch was spawned");
        const expectedBin = row.spawnBin === "headroom"
          ? "/fake/bin/headroom"
          : `/fake/bin/${row.provider}`; // "raw <provider>"
        assert.equal(calls[0].bin, expectedBin, `spawn binary is ${row.spawnBin}`);
        const beginsWithWrap = calls[0].args[0] === "wrap";
        assert.equal(beginsWithWrap, row.wrapArgs === "yes", `wrap-prefix on args is ${row.wrapArgs}`);
      }
      assert.equal(hasErrorFrame(controls), row.errorFrame === "yes", `error-frame emitted is ${row.errorFrame}`);
    },
  })),

  // ===== 02_absent-config-unchanged.feature ==================================

  // Scenario: no work.headroom config spawns the raw provider even when headroom is on PATH
  {
    name: "headroom-wrap-routing/02 no work.headroom config spawns the raw provider even when headroom is on PATH",
    async run() {
      // Given no work.headroom key, claude AND headroom on PATH.
      const { calls, controls } = await openSession({
        headroom: undefined,
        present: ["claude", "headroom"],
        provider: "claude",
      });
      assert.equal(calls.length, 1, "exactly one launch was spawned");
      assert.equal(calls[0].bin, "/fake/bin/claude", "the spawned binary is the raw claude provider");
      assert.notEqual(calls[0].args[0], "wrap", "args do not begin with wrap");
      assert.equal(hasErrorFrame(controls), false, "no error control-frame is emitted");
    },
  },

  // Scenario: work.headroom.enabled:false spawns the raw provider even when headroom is on PATH
  {
    name: "headroom-wrap-routing/02 work.headroom.enabled:false spawns the raw provider even when headroom is on PATH",
    async run() {
      // Given enabled:false, claude AND headroom on PATH.
      const { calls, controls } = await openSession({
        headroom: { enabled: false, providers: ["claude"] },
        present: ["claude", "headroom"],
        provider: "claude",
      });
      assert.equal(calls.length, 1, "exactly one launch was spawned");
      assert.equal(calls[0].bin, "/fake/bin/claude", "the spawned binary is the raw claude provider");
      assert.notEqual(calls[0].args[0], "wrap", "args do not begin with wrap");
      assert.equal(hasErrorFrame(controls), false, "no error control-frame is emitted");
    },
  },

  // Scenario: an off plugin contributes nothing to the spawn binary or args
  //   The off-plugin launch must equal a launch where the plugin code is absent
  //   entirely. We model "plugin code absent entirely" as the raw provider seam's
  //   own resolution: bin = the provider's resolved path, args = buildArgs() ([]).
  {
    name: "headroom-wrap-routing/02 an off plugin contributes nothing to the spawn binary or args",
    async run() {
      const { calls } = await openSession({
        headroom: undefined,
        present: ["claude", "headroom"],
        provider: "claude",
      });
      assert.equal(calls.length, 1, "exactly one launch was spawned");
      // The launch with the plugin off is byte-for-byte the raw provider launch
      // (the binary and args a session resolves with no plugin in play).
      assert.deepEqual(
        { bin: calls[0].bin, args: calls[0].args },
        { bin: "/fake/bin/claude", args: [] },
        "the off-plugin launch is identical to a plugin-absent raw provider launch"
      );
    },
  },

  // Scenario Outline: an off plugin (<headroomConfig>) spawns the raw provider unwrapped
  ...[
    { label: 'has no "work.headroom" key', headroom: undefined, wrapped: "no" },
    { label: 'is \'{ "work": { "headroom": { "enabled": false } } }\'', headroom: { enabled: false }, wrapped: "no" },
  ].map((row) => ({
    name: `headroom-wrap-routing/02 an off plugin (${row.label}) spawns the raw provider unwrapped`,
    async run() {
      const { calls } = await openSession({
        headroom: row.headroom,
        present: ["claude", "headroom"],
        provider: "claude",
      });
      assert.equal(calls.length, 1, "exactly one launch was spawned");
      assert.equal(calls[0].bin, "/fake/bin/claude", "the spawned binary is the raw claude provider");
      const beginsWithWrap = calls[0].args[0] === "wrap";
      assert.equal(beginsWithWrap, row.wrapped === "yes", `wrap-prefix on args is ${row.wrapped}`);
    },
  })),
];
