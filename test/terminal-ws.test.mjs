// Traceability wiring for milestone 03 / story 02 — the @executable SERVER
// scenarios across the two task features. Drives the REAL upgrade handshake by
// standing up serveSetupUi (which attaches /ws/terminal on the same server) with
// an INJECTED stub spawn + stub PATH lookup — no real node-pty, no real PATH.
//
//   01_provider-picker-and-missing.feature
//     @executable Scenario Outline: the selected provider is the CLI that gets run
//     @executable Scenario Outline: a chosen provider with no binary shows the
//         dock error state and the server stays up
//     @executable Scenario Outline: a missing provider never fakes success and
//         never crashes the server
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveSetupUi } from "../src/setup-ui.mjs";

// --- fixtures ----------------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-termws-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  const storyDir = path.join(workDir, "03_milestone_board", "stories", "02_story_agent-terminal");
  await mkdir(path.join(storyDir, "tasks"), { recursive: true });
  await writeFile(
    path.join(workDir, "03_milestone_board", "SPEC.md"),
    "---\ntype: milestone\nnumber: \"03\"\nslug: board\nstatus: in-progress\ntitle: \"Board\"\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n# 03\n",
    "utf8"
  );
  await writeFile(
    path.join(storyDir, "STORY.md"),
    "---\ntype: story\nnumber: \"02\"\nslug: agent-terminal\nstatus: in-progress\ntitle: \"Agent terminal\"\nparent: 3\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n# 02\n",
    "utf8"
  );
  return { repo, storyDir };
}

// A stub `which`: only the named providers resolve (to a fake absolute path),
// everything else is absent. Mirrors terminal-providers' defaultWhich signature.
function stubWhich(presentBins) {
  const present = new Set(presentBins);
  return (bin) => (present.has(bin) ? `/fake/bin/${bin}` : null);
}

// A stub spawn that records the resolved binary/args (so we can assert WHICH CLI
// ran) and behaves like a node-pty handle: onData/onExit/write/resize/kill.
function recordingSpawn(calls) {
  return (bin, args, options) => {
    const record = { bin, args, options };
    calls.push(record);
    const dataHandlers = [];
    const exitHandlers = [];
    return {
      pid: 1234,
      onData(handler) {
        dataHandlers.push(handler);
        // Emit one byte so the dock would reach "running" (the happy path).
        queueMicrotask(() => handler("ready\r\n"));
        return { dispose() {} };
      },
      onExit(handler) {
        exitHandlers.push(handler);
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
  const address = server.address();
  const wsBase = `ws://127.0.0.1:${address.port}`;
  try {
    return await body({ url, wsBase, server });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Open a /ws/terminal connection and collect the frames the server sends until
// the socket closes (or a timeout). Returns { frames, controls, closed }.
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

export const terminalWsTests = [
  // ===== the selected provider is the CLI that gets run =====
  ...["claude", "codex", "gemini"].map((provider) => ({
    name: `terminal-ws/01 the selected provider "${provider}" is the CLI that gets run`,
    async run() {
      const { repo, storyDir } = await makeRepo();
      const calls = [];
      try {
        await withServer(
          repo,
          { spawn: recordingSpawn(calls), which: stubWhich(["claude", "codex", "gemini"]) },
          async ({ wsBase }) => {
            // Given the provider is selected and its binary is present; when Run
            // agent is invoked for the selected item (a WS connect with that provider).
            await connectTerminal(wsBase, "03/02", provider);
          }
        );
        // Then the CLI that is run is the "<provider>" CLI, and no other.
        assert.equal(calls.length, 1, "exactly one CLI was spawned");
        assert.equal(calls[0].bin, `/fake/bin/${provider}`, `the spawned binary is the ${provider} CLI`);
        // And it ran bound to the item's directory (cwd = item dir).
        assert.equal(calls[0].options.cwd, storyDir, "the CLI runs with the item's directory as cwd");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  })),

  // ===== a chosen provider with no binary → dock error state, server stays up =====
  ...["claude", "codex", "gemini"].map((provider) => ({
    name: `terminal-ws/01 a chosen provider "${provider}" with no binary shows the error state and the server stays up`,
    async run() {
      const { repo } = await makeRepo();
      const calls = [];
      try {
        await withServer(
          repo,
          { spawn: recordingSpawn(calls), which: stubWhich([]) /* every provider absent */ },
          async ({ wsBase, url }) => {
            const first = await connectTerminal(wsBase, "03/02", provider);
            // Then the dock shows the error state naming the missing provider.
            const error = first.controls.find((c) => c.type === "error");
            assert.ok(error, "an error control-frame was sent");
            assert.ok(
              error.message.includes(provider),
              `the error names the missing provider (${provider})`
            );
            // And no session is reported as running (no spawn happened, no bytes).
            assert.equal(calls.length, 0, "no PTY session was spawned for an absent binary");
            assert.ok(!first.frames.some((f) => f && !f.startsWith("{")), "no raw PTY output was streamed");
            // And the dock is NOT reported as exited with code 0 (no faked success).
            assert.ok(
              !first.controls.some((c) => c.type === "exit" && c.exitCode === 0),
              "no exit(0) control-frame fakes a clean success"
            );

            // And the server is still serving other connections afterwards:
            // a second WS to a PRESENT provider on the SAME server still spawns.
            // (Re-point which via a fresh server would change state; instead
            // assert the SAME server still completes the upgrade + an HTTP call.)
            const second = await connectTerminal(wsBase, "03/02", provider);
            assert.ok(second.controls.some((c) => c.type === "error"), "the server still handles a second connection");
            const res = await fetch(new URL("/api/work/list", url));
            assert.equal(res.status, 200, "the server still serves the HTTP API after a missing-provider connection");
          }
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  })),

  // ===== a missing provider never fakes success and never crashes the server =====
  ...["claude", "codex", "gemini"].map((provider) => ({
    name: `terminal-ws/01 a missing provider "${provider}" never fakes success and never crashes the server`,
    async run() {
      const { repo } = await makeRepo();
      const calls = [];
      try {
        await withServer(
          repo,
          { spawn: recordingSpawn(calls), which: stubWhich([]) },
          async ({ wsBase, url, server }) => {
            const result = await connectTerminal(wsBase, "03/02", provider);
            // Then the outcome is the error state, not a success.
            assert.ok(result.controls.some((c) => c.type === "error"), "the outcome is the error state");
            assert.ok(!result.controls.some((c) => c.type === "exit"), "no exit frame masquerades as a finished run");
            assert.equal(calls.length, 0, "no CLI was spawned for the absent binary");
            // And the server process does not crash — it is still listening and
            // serving (the HTTP API answers on the same server).
            assert.equal(server.listening, true, "the server is still listening (did not crash)");
            const res = await fetch(new URL("/api/work/list", url));
            assert.equal(res.status, 200, "the server still serves requests");
          }
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  })),
];
