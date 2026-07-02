// Spawn-level coverage for the `aof mesh ui` CLI verb (meshUiCommand, src/cli.mjs) —
// milestone 25 / story 02 (QA F1/F2). The in-process serveMeshUi tests
// (mesh-ui-serve.test.mjs) exercise the SERVER; this file exercises the VERB FACE the
// module tests can't reach: the human announce line, the documented default-port
// (4181) bind, the --port override, and the exact EADDRINUSE friendly refusal + exit 1
// (the cli.mjs:957 literal). It drives the REAL CLI (bin/aof.mjs mesh ui).
//
// Mirrors work-ui-verb-rename.test.mjs's launch/teardown idiom: `aof mesh ui` BLOCKS on
// the fleet server until SIGINT/SIGTERM, so the blocking launches spawn directly and
// read stdout until the "running locally" line, hit the announced origin to confirm the
// bind, then SIGTERM the child (the meshUiCommand server.close shutdown). The busy-port
// refusal is a non-blocking exit read through spawnCliAsync (the child exits 1 on its own).
// serveMeshUi resolves ui/dist against the REAL aof repo root (the built bundle), so the
// fixture only supplies the mesh stream (a config + a minimal .mesh so the aggregate is
// non-empty). node:assert/strict.
//
// NOTE on ui-build-missing (cli.mjs:951-954): NOT asserted at the verb level. meshUiCommand
// calls serveMeshUi({ projectDir, port }) WITHOUT repoRoot, so the guard keys on the REAL
// repo's ui/dist (present after `npm --prefix ui run build`), NOT on the fixture / --target.
// It is not cleanly triggerable here without an artificial hack, so it stays covered at the
// module boundary in mesh-ui-serve.test.mjs ("a missing ui/dist build is a friendly
// ui-build-missing refusal").
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCliAsync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// A temp repo whose .aof/aof.config.json points work.dir at wiki/work, with a minimal
// planted .mesh (one live node + registered board) so the mesh:status aggregate is
// non-empty (mirrors mesh-ui-serve.test.mjs's makeRepo — the fleet server reads this on
// the /api/mesh/status route the launched verb serves).
async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-cli-"));
  const workDir = path.join(root, "wiki", "work");
  const meshDir = path.join(workDir, ".mesh");
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await mkdir(path.join(meshDir, "nodes"), { recursive: true });
  await mkdir(path.join(meshDir, "presence"), { recursive: true });
  await mkdir(path.join(meshDir, "registry"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", runtimes: ["claude"], work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "nodes", "mac-studio.json"),
    JSON.stringify(
      { nodeId: "mac-studio", host: "mac-studio", os: "darwin", runtimes: ["claude"], skills: ["a"], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "presence", "mac-studio.json"),
    JSON.stringify({ nodeId: "mac-studio", heartbeatAt: new Date().toISOString(), activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "registry", "group.json"),
    JSON.stringify(
      { roster: [{ nodeId: "mac-studio", admittedAt: "2026-07-01T00:00:00.000Z", boards: ["let-shield"] }], boards: ["let-shield"], pending: [], revocations: [] },
      null,
      2
    ),
    "utf8"
  );
  return { root };
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

// Launch `aof mesh ui …` and wait until it prints the "running locally" line (or exits /
// times out). Returns a handle whose stdout/stderr accumulate; the caller asserts, then
// stop()s it (SIGTERM → the meshUiCommand server.close shutdown). Mirrors the work-ui
// launcher: spawn directly so we can watch stdout for readiness and keep the process alive.
function launchFleet(root, args, { readyRe = /Open this URL in your browser:\s*\S+/, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
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
        reject(new Error(`fleet launch timed out; stdout=<${stdout}> stderr=<${stderr}>`));
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
        reject(new Error(`fleet exited before readiness; stdout=<${stdout}> stderr=<${stderr}>`));
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

// Confirm a 127.0.0.1:<port> fleet server is answering (the fleet page 200s on the origin).
async function isServing(url) {
  try {
    // The announced URL carries ?mode=fleet; fetch the origin root so a plain 200 proves
    // the bind regardless of the query.
    const origin = new URL(url);
    const response = await fetch(`${origin.protocol}//${origin.host}/`);
    return response.status === 200;
  } catch {
    return false;
  }
}

export const meshUiCliFaceTests = [
  // Scenario: aof mesh ui launches the fleet server on the documented default 127.0.0.1:4181,
  // prints the human announce line, and answers on the announced origin.
  {
    name: "mesh-ui-cli-face/02 aof mesh ui launches the fleet on the default 127.0.0.1:4181 with the human announce line",
    async run() {
      const { root } = await makeFixture();
      // Default 4181 may be held by a stray fleet on a dev box; only assert the default
      // bind when 4181 is actually free (otherwise the launch would emit the busy-port
      // refusal — a DIFFERENT scenario). Keeps the default assertion honest, not flaky.
      let handle;
      try {
        const free4181 = await bindBusyPort(4181).then(
          (s) => { closeListener(s); return true; },
          () => false
        );
        if (!free4181) return; // 4181 in use on this host — the busy-port scenario covers refusal.
        handle = await launchFleet(root, ["mesh", "ui"]);
        const out = handle.stdout;
        assert.ok(
          out.includes("AOF mesh ui is running locally."),
          `the human announce line reads exactly "AOF mesh ui is running locally." (got: ${JSON.stringify(out)})`
        );
        const url = announcedUrl(out);
        assert.ok(url, "the launch announces a fleet URL");
        assert.ok(url.includes("mode=fleet"), `the announced URL carries the ?mode=fleet selector (got: ${url})`);
        assert.ok(
          url.includes("127.0.0.1:4181"),
          `the fleet binds 127.0.0.1 on the documented default port 4181 (got: ${url})`
        );
        assert.equal(await isServing(url), true, "the fleet server is answering on the announced origin");
      } finally {
        if (handle) await handle.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof mesh ui --port binds the chosen free port on 127.0.0.1.
  {
    name: "mesh-ui-cli-face/02 aof mesh ui --port binds the chosen free port on 127.0.0.1",
    async run() {
      const { root } = await makeFixture();
      let handle;
      try {
        const port = await reserveFreePort();
        handle = await launchFleet(root, ["mesh", "ui", "--port", String(port)]);
        const url = announcedUrl(handle.stdout);
        assert.ok(url, "the launch announces a fleet URL");
        assert.ok(
          url.includes(`127.0.0.1:${port}`),
          `the fleet binds 127.0.0.1 on the chosen port ${port} (got: ${url})`
        );
        assert.equal(await isServing(url), true, "the fleet answers on the chosen port");
      } finally {
        if (handle) await handle.stop();
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // Scenario: aof mesh ui on a busy port refuses with the exact frozen guidance (the
  // cli.mjs:957 literal) and exits 1 — no server started.
  {
    name: "mesh-ui-cli-face/02 aof mesh ui on a busy port refuses with the exact frozen guidance and exits 1",
    async run() {
      const { root } = await makeFixture();
      const port = await reserveFreePort();
      const listener = await bindBusyPort(port);
      try {
        const r = await spawnCliAsync(process.execPath, [cliPath, "mesh", "ui", "--port", String(port)], {
          cwd: root,
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        assert.equal(r.status, 1, `a busy port refuses with exit 1 (stderr: ${r.stderr})`);
        assert.equal(
          r.stderr.trim(),
          `Port ${port} is already in use. Pass --port <n> to pick another.`,
          "the refusal is the exact frozen EADDRINUSE guidance line (cli.mjs:957)"
        );
        assert.ok(!/is running locally\./.test(r.stdout), "no fleet server is started");
      } finally {
        await closeListener(listener);
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
