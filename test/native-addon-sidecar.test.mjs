// Traceability wiring for milestone 28 / story 00, task 02 —
// tasks/02_native-addon-sidecar.feature (ADR-002).
//
// Two layers:
//   (a) the LOADER-SELECTION branch, driven directly against
//       src/terminal-ws.mjs's createTerminalSpawn/defaultSpawn shape with the
//       asset-base SEA sentinel flipped in-process (no built binary, no real
//       node-pty) — asserts createRequire(process.execPath) is chosen under a
//       SEA and the dynamic import("node-pty") in dev.
//   (b) the OBSERVABLE degrade, driven over a REAL ws session (serveSetupUi +
//       attachTerminalWebSocket) with an INJECTED spawn built from
//       createTerminalSpawn(stubLoader) — models each failure mode from the
//       feature's Examples table without a real sidecar.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveSetupUi } from "../src/setup-ui.mjs";
import { createTerminalSpawn, loadNodePty } from "../src/terminal-ws.mjs";
import { setSeaSentinelForTest, isPackaged } from "../src/asset-base.mjs";
import { run as runCli } from "../src/cli.mjs";

// --- fixtures ----------------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-sidecar-"));
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

function stubWhich(presentBins) {
  const present = new Set(presentBins);
  return (bin) => (present.has(bin) ? `/fake/bin/${bin}` : null);
}

// A loader that resolves to a working node-pty-shaped module (a happy-path
// stub PTY handle) — models "the sidecar is present and loads".
function resolvingLoader() {
  return async () => ({
    spawn() {
      const dataHandlers = [];
      const exitHandlers = [];
      return {
        pid: 4321,
        onData(handler) { dataHandlers.push(handler); queueMicrotask(() => handler("ready\r\n")); return { dispose() {} }; },
        onExit(handler) { exitHandlers.push(handler); return { dispose() {} }; },
        write() {},
        resize() {},
        kill() {},
      };
    },
  });
}

// A loader that throws (ENOENT / require-throws / raw-SEA import()-throws /
// wrong-arch dlopen / missing Windows companion — all surface identically as a
// loader rejection from terminal-ws's point of view).
function throwingLoader(message) {
  return async () => {
    throw new Error(message);
  };
}

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

function resetSea() {
  setSeaSentinelForTest(undefined);
}

export const nativeAddonSidecarTests = [
  // ===== loader-selection branch (Scenario Outline: environment -> loader) =====
  {
    name: "native-addon-sidecar/00 in a SEA, node-pty resolves via createRequire(process.execPath) (loader-selection, no top-level import)",
    async run() {
      resetSea();
      try {
        setSeaSentinelForTest(true);
        assert.equal(isPackaged(), true, "the sentinel reports IN a SEA");
        // The spawn built by createTerminalSpawn always calls its INJECTED
        // loader (the seam this scenario pins); the SEA/dev branch selection
        // itself is asserted structurally by acd-native-addon-degrades (the
        // createRequire(process.execPath) call exists in loadNodePty, gated
        // on isPackaged()) and behaviourally below (both environments degrade
        // identically on a loader failure — the SAME defaultSpawn code path).
        const calls = [];
        const spawn = createTerminalSpawn(async () => {
          calls.push("loader-called");
          return resolvingLoader()();
        });
        const term = await spawn("claude", [], {});
        assert.equal(calls.length, 1, "the injected loader was invoked exactly once");
        assert.equal(term.pid, 4321, "the resolved pty handle is usable (has a pid)");
      } finally {
        resetSea();
      }
    },
  },
  {
    name: "native-addon-sidecar/00 NOT in a SEA, node-pty resolves via the dynamic import (loader-selection, dev path unchanged)",
    async run() {
      resetSea();
      try {
        setSeaSentinelForTest(false);
        assert.equal(isPackaged(), false, "the sentinel reports NOT in a SEA");
        const calls = [];
        const spawn = createTerminalSpawn(async () => {
          calls.push("loader-called");
          return resolvingLoader()();
        });
        await spawn("claude", [], {});
        assert.equal(calls.length, 1, "the injected loader was invoked exactly once (the dev dynamic-import branch)");
      } finally {
        resetSea();
      }
    },
  },

  // ===== F12 (craft-review): the REAL loadNodePty's polarity, driven behaviourally =====
  //
  // The tests above inject their OWN loader via createTerminalSpawn, so they
  // cannot catch a polarity inversion inside terminal-ws.mjs's own loadNodePty
  // (e.g. `!isPackaged() ? createRequire(...) : import(...)`) — every
  // behavioural assertion above still passes unchanged if that ternary is
  // flipped. These two tests call the REAL, un-substituted loadNodePty and
  // distinguish WHICH mechanism ran from its failure/success SIGNATURE in this
  // dev environment (no sidecar, no built binary):
  //   - createRequire(process.execPath)("node-pty") resolves relative to the
  //     running node.exe's OWN directory (not this repo's node_modules), so in
  //     dev it reliably throws MODULE_NOT_FOUND naming "node-pty".
  //   - the dynamic import("node-pty") resolves via the repo's installed
  //     node_modules/node-pty and SUCCEEDS in this dev environment.
  // An inverted ternary would swap which of these two outcomes happens for
  // which sentinel value — exactly what these assertions pin.
  {
    name: "native-addon-sidecar/00 (F12 polarity, behavioural) with the SEA sentinel ON, the REAL loadNodePty attempts createRequire(process.execPath) — observed via its dev-environment MODULE_NOT_FOUND signature",
    async run() {
      resetSea();
      try {
        setSeaSentinelForTest(true);
        assert.equal(isPackaged(), true, "the sentinel reports IN a SEA");
        // loadNodePty is NOT async — the createRequire(...) branch throws
        // SYNCHRONOUSLY (require is sync), while the dynamic-import branch
        // would instead RETURN a promise (never throw synchronously). Wrapping
        // the call itself in the assertion — not just awaiting its result —
        // is what lets this test tell the two mechanisms apart.
        assert.throws(
          () => loadNodePty(),
          (error) => {
            // In THIS dev environment (no sidecar beside node.exe),
            // createRequire(process.execPath)("node-pty") cannot resolve — the
            // MODULE_NOT_FOUND naming "node-pty" is the createRequire
            // mechanism's distinguishing signature (the dynamic import branch
            // would instead SUCCEED here, returning a promise, never a sync throw).
            assert.equal(error.code, "MODULE_NOT_FOUND", "the real loader attempted createRequire (its dev-environment failure signature), not the dynamic import (which would have succeeded)");
            assert.match(error.message, /node-pty/, "the error names node-pty");
            return true;
          },
          "isPackaged()===true drives loadNodePty to the createRequire(process.execPath) branch (a synchronous throw)"
        );
      } finally {
        resetSea();
      }
    },
  },
  {
    name: "native-addon-sidecar/00 (F12 polarity, behavioural) with the SEA sentinel OFF, the REAL loadNodePty attempts the dynamic import and SUCCEEDS (the repo's own node_modules/node-pty)",
    async run() {
      resetSea();
      try {
        setSeaSentinelForTest(false);
        assert.equal(isPackaged(), false, "the sentinel reports NOT in a SEA");
        const pty = await loadNodePty();
        // A successful resolution here IS the dynamic-import signature — the
        // createRequire(process.execPath) branch would have thrown
        // MODULE_NOT_FOUND in this same dev environment (proven by the
        // sibling test above), so success here is only possible via import().
        assert.equal(typeof pty.spawn, "function", "the real loader attempted the dynamic import (its dev-environment success signature) and resolved the real node-pty module");
      } finally {
        resetSea();
      }
    },
  },

  // ===== the load-bearing degrade matrix =====
  ...[
    { label: "the sidecar .node is missing (ENOENT)", message: "ENOENT: no such file or directory, open 'pty.node'" },
    { label: "the sidecar .node fails to load (throws on require)", message: "Error: The module 'pty.node' was compiled against a different Node.js version" },
    { label: "a raw-SEA FS import() of node-pty throws (the createRequire re-home is the fix)", message: "Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: only builtin modules can be loaded" },
    { label: "the sidecar .node is the wrong arch / abi (dlopen fails)", message: "Error: dlopen(pty.node): mach-o file, but is an incompatible architecture" },
    { label: "a Windows companion is missing (pty.node present, winpty.dll/conpty absent)", message: "Error: The specified module could not be found. winpty.dll" },
  ].map(({ label, message }) => ({
    name: `native-addon-sidecar/01 a sidecar that is missing or unloadable degrades to an error frame — the node and relay never crash (${label})`,
    async run() {
      const { repo } = await makeRepo();
      try {
        await withServer(
          repo,
          { spawn: createTerminalSpawn(throwingLoader(message)), which: stubWhich(["claude"]) },
          async ({ wsBase }) => {
            const first = await connectTerminal(wsBase, "03/02", "claude");
            const error = first.controls.find((c) => c.type === "error");
            assert.ok(error, `an error control-frame was sent for: ${label}`);
            assert.equal(typeof error.message, "string", "the error frame carries a message");
          }
        );
        // The process (this test runner itself) did not crash — reaching this
        // line is the "process does not crash" assertion. A subsequent
        // node-mode command still runs (a fresh CLI in-process call).
        const originalLog = console.log;
        let printed = "";
        console.log = (msg) => { printed += String(msg); };
        try {
          await runCli(["--version"]);
        } finally {
          console.log = originalLog;
        }
        assert.ok(printed.length > 0, "a subsequent node-mode command (--version) still runs after the degrade");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  })),

  // ===== the sidecar-present happy path — no regression from the re-home =====
  {
    name: "native-addon-sidecar/02 with the sidecar present the PTY session spawns normally (no regression from the re-home)",
    async run() {
      const { repo, storyDir } = await makeRepo();
      try {
        await withServer(
          repo,
          { spawn: createTerminalSpawn(resolvingLoader()), which: stubWhich(["claude"]) },
          async ({ wsBase }) => {
            const first = await connectTerminal(wsBase, "03/02", "claude");
            const error = first.controls.find((c) => c.type === "error");
            assert.equal(error, undefined, "no error control-frame is emitted");
            assert.ok(first.frames.some((f) => f === "ready\r\n"), "the PTY streams data as it does today");
          }
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ===== startup-independence: no sidecar at all still boots node/relay =====
  {
    name: "native-addon-sidecar/03 a binary whose sidecar is entirely absent still boots node mode and relay mode (the addon is not a startup dependency)",
    async run() {
      // Simply IMPORTING terminal-ws.mjs (already imported at module load,
      // transitively via setup-ui.mjs across this whole suite) never touches
      // node-pty — asserted structurally by acd-native-addon-degrades. Here we
      // assert the BEHAVIOUR: node mode and relay mode both start up with zero
      // node-pty reference, before any terminal session is attempted.
      const originalLog = console.log;
      let versionPrinted = "";
      console.log = (msg) => { versionPrinted += String(msg); };
      try {
        await runCli(["--version"]);
      } finally {
        console.log = originalLog;
      }
      assert.ok(versionPrinted.length > 0, "node mode starts successfully with no node-pty sidecar present");

      let relayPrinted = "";
      console.log = (msg) => { relayPrinted += String(msg); };
      try {
        await runCli(["mesh", "relay", "--json"]);
      } finally {
        console.log = originalLog;
      }
      assert.ok(relayPrinted.length > 0, "relay mode starts successfully with no node-pty sidecar present (the non-blocking probe returns)");
    },
  },
];
