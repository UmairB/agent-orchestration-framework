// Traceability wiring for milestone 25 / story 00 / task 00 —
// 00_work-ui-verb-rename.feature (@cli @work @board @executable).
//
// ADR-001: `aof work board` is renamed to `aof work ui` — a CLI-only serve-verb
// rename (cli.mjs surface edit; NOT a registered work:* command). This file covers
// the OBSERVABLE verb surface: the renamed verb launches the board, the retired
// verb falls through to the unknown-subcommand help, the --port override + busy-port
// refusal carry through, and both usage surfaces read "ui" (each with its own
// port-hint shape). The "rename actually happened" structural XOR proof is the
// acd-work-ui-rename-complete arch-test, NOT re-asserted here.
//
// The non-blocking surfaces (usage text, unknown-sub fallthrough) drive the REAL CLI
// through spawnCliSync. The blocking launch surfaces (bind, human line, mode URL,
// --port, busy-port) drive the REAL CLI through spawnCliAsync: `aof work ui` blocks
// on the server until SIGINT, so we read stdout until the "running locally" line, hit
// the announced URL to confirm the bind, then SIGTERM it (the workUiCommand shutdown
// path). serveBoard resolves ui/dist against the aof repo root (the real built
// bundle), so the fixture only supplies the work stream (a config + one milestone).
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCliSync, spawnCliAsync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// A repo whose .aof/aof.config.json points work.dir at wiki/work, with one milestone
// so the board's work stream is non-empty (mirrors board-serve.test.mjs's makeRepo).
async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-work-ui-verb-"));
  const workDir = path.join(root, "wiki", "work");
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  await mkdir(path.join(workDir, "03_milestone_board"), { recursive: true });
  await writeFile(
    path.join(workDir, "03_milestone_board", "SPEC.md"),
    "---\ntype: milestone\nnumber: \"03\"\nslug: board\nstatus: in-progress\ntitle: \"Board\"\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n# 03\n",
    "utf8"
  );
  return { root, workDir };
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Reserve a free TCP port by opening a listener, reading its port, then closing it —
// the port is (very likely) free for the next bind.
function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Bind a listener and hold it — so the port is genuinely busy for a bind attempt.
function bindBusyPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeListener(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Launch `aof work ui …` and wait until it prints the "running locally" line (or
// exits / times out). Returns a handle whose stdout/stderr accumulate; the caller
// asserts, then stop()s it (SIGTERM → the workUiCommand server.close shutdown).
function launchBoard(root, args, { readyRe = /Open this URL in your browser:\s*\S+/, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    // Dynamic import of child_process here would duplicate spawnCliAsync's plumbing;
    // instead we spawn directly so we can watch stdout for the readiness line and
    // keep the process alive (spawnCliAsync only settles on close).
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd: root,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGTERM"); } catch { /* noop */ }
        reject(new Error(`board launch timed out; stdout=<${stdout}> stderr=<${stderr}>`));
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!settled && readyRe.test(stdout)) {
          settled = true;
          clearTimeout(timer);
          resolve({
            child,
            get stdout() { return stdout; },
            get stderr() { return stderr; },
            stop: () =>
              new Promise((res) => {
                child.on("close", () => res());
                try { child.kill("SIGTERM"); } catch { res(); }
              }),
          });
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`board exited before readiness; stdout=<${stdout}> stderr=<${stderr}>`));
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  });
}

// Pull the announced URL out of the launch stdout ("Open this URL in your browser: <url>").
function announcedUrl(stdout) {
  const match = stdout.match(/Open this URL in your browser:\s*(\S+)/);
  return match ? match[1] : null;
}

// Confirm a 127.0.0.1:<port> board is answering (the board page 200s on the origin).
async function isServing(url) {
  try {
    const response = await fetch(new URL("/", url));
    return response.status === 200;
  } catch {
    return false;
  }
}

export const workUiVerbRenameTests = [
  // Scenario: aof work ui launches the per-stream board server (binds 127.0.0.1:4180
  // by default; the human line reads "ui"; the announced URL still carries ?mode=board).
  {
    name: "work-ui-verb-rename/00 aof work ui launches the board on the default 127.0.0.1:4180 with the ui human line and the ?mode=board URL",
    async run() {
      const { root } = await makeFixture();
      // Default port 4180 may be held by a stray board on a dev box; only assert the
      // default-port bind when 4180 is actually free (otherwise the launch would emit
      // the busy-port refusal, which is a DIFFERENT scenario). This keeps the default
      // assertion honest without a flaky failure on a busy machine.
      let handle;
      try {
        const free4180 = await bindBusyPort(4180).then(
          (s) => { closeListener(s); return true; },
          () => false
        );
        if (!free4180) return; // 4180 in use on this host — the busy-port scenario covers refusal.
        handle = await launchBoard(root, ["work", "ui"]);
        const out = handle.stdout;
        assert.ok(
          out.includes("AOF work ui is running locally."),
          `the human line reads "ui", never "board" (got: ${JSON.stringify(out)})`
        );
        assert.ok(!out.includes("AOF work board is running locally."), "the retired human line is gone");
        const url = announcedUrl(out);
        assert.ok(url, "the launch announces a board URL");
        assert.ok(url.includes("?mode=board"), `the announced URL still carries the ?mode=board serve param (got: ${url})`);
        assert.ok(url.includes("127.0.0.1:4180"), `the board binds 127.0.0.1 on the documented default port 4180 (got: ${url})`);
        assert.equal(await isServing(url), true, "the board server is answering on the announced origin");
      } finally {
        if (handle) await handle.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof work board falls through to the unknown-subcommand help — the
  // retired verb is GONE, not aliased. Exit 1, stderr opens `Unknown work command
  // "board".`, the usage lists "ui" not "board", stdout empty.
  {
    name: "work-ui-verb-rename/00 aof work board falls through to the unknown-subcommand help (exit 1, stderr, stdout empty)",
    async run() {
      const { root } = await makeFixture();
      try {
        const r = runCli(root, ["work", "board"]);
        assert.equal(r.status, 1, `the retired verb exits 1 (stderr: ${r.stderr})`);
        assert.equal(r.stdout.trim(), "", "stdout carries no output (no server started)");
        assert.ok(
          r.stderr.startsWith('Unknown work command "board".'),
          `stderr opens with the unknown-subcommand report (got: ${JSON.stringify(r.stderr.slice(0, 80))})`
        );
        // The work usage that follows lists "ui" among the subcommands and not "board".
        assert.ok(r.stderr.includes("aof work ui [--port 4180]"), "the work usage lists the renamed verb");
        assert.ok(!/aof work board\b/.test(r.stderr), "the work usage no longer lists the retired verb");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof work ui --port binds the chosen port (behaviour parity — the
  // --port override carries through the rename).
  {
    name: "work-ui-verb-rename/00 aof work ui --port binds the chosen free port on 127.0.0.1",
    async run() {
      const { root } = await makeFixture();
      let handle;
      try {
        const port = await reserveFreePort();
        handle = await launchBoard(root, ["work", "ui", "--port", String(port)]);
        const url = announcedUrl(handle.stdout);
        assert.ok(url, "the launch announces a board URL");
        assert.ok(url.includes(`127.0.0.1:${port}`), `the board binds 127.0.0.1 on the chosen port ${port} (got: ${url})`);
        assert.equal(await isServing(url), true, "the board answers on the chosen port");
      } finally {
        if (handle) await handle.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof work ui on a busy port refuses with the same guidance as before —
  // no server started, exit 1, the exact EADDRINUSE line (cli.mjs:876).
  {
    name: "work-ui-verb-rename/00 aof work ui on a busy port refuses with the frozen guidance and exits 1",
    async run() {
      const { root } = await makeFixture();
      const port = await reserveFreePort();
      const listener = await bindBusyPort(port);
      try {
        const r = await spawnCliAsync(process.execPath, [cliPath, "work", "ui", "--port", String(port)], {
          cwd: root,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        assert.equal(r.status, 1, `a busy port refuses with exit 1 (stderr: ${r.stderr})`);
        assert.equal(
          r.stderr.trim(),
          `Port ${port} is already in use. Pass --port <n> to pick another.`,
          "the refusal is the exact frozen EADDRINUSE guidance line"
        );
        assert.ok(!/is running locally\./.test(r.stdout), "no board server is started");
      } finally {
        await closeListener(listener);
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario Outline: the usage surfaces read aof work ui and never aof work board.
  // Two surfaces, each with its OWN port-hint shape (faithful rename): `aof help` →
  // stdout / exit 0 / `aof work ui [--port]`; `aof work not-a-subcommand` → stderr /
  // exit 1 / `aof work ui [--port 4180]`.
  {
    name: "work-ui-verb-rename/00 both usage surfaces read aof work ui (each its own shape) and never aof work board",
    async run() {
      const { root } = await makeFixture();
      try {
        const rows = [
          { surface: "top-level aof usage", args: ["help"], channel: "stdout", exit: 0, lists: "aof work ui [--port]" },
          { surface: "work unknown-subcommand", args: ["work", "not-a-subcommand"], channel: "stderr", exit: 1, lists: "aof work ui [--port 4180]" },
        ];
        for (const { surface, args, channel, exit, lists } of rows) {
          const r = runCli(root, args);
          assert.equal(r.status, exit, `${surface} exits ${exit}`);
          const text = channel === "stdout" ? r.stdout : r.stderr;
          const otherChannel = channel === "stdout" ? r.stderr : r.stdout;
          assert.ok(text.includes(lists), `${surface} usage arrives on ${channel} and lists "${lists}" (got: ${JSON.stringify(text.slice(0, 400))})`);
          // The renamed verb must not appear on the OTHER channel (channel is pinned).
          assert.ok(!otherChannel.includes(lists), `${surface} usage does not leak onto the other channel`);
          // It does not mention the retired verb on the asserted channel.
          assert.ok(!/aof work board\b/.test(text), `${surface} does not mention "aof work board"`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
