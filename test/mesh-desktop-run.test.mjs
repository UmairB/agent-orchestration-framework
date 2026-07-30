// Traceability wiring for milestone 36 / story 03, task 02_run-launch.feature —
// `aof mesh desktop run` discovers the installed app and launches it detached,
// refusing calmly when it is not installed.
//
// Exercises discoverDesktopApp/launchDesktopApp directly (src/commands/mesh-
// desktop.mjs) over a FIXTURE install root with an injected $HOME. The detached
// spawn is asserted on SHAPE via an injected spawnFn (mirrors src/mesh-fabric.mjs's
// injected-exec-closure idiom) — no real Tauri app is started, no window opens
// (the story's RESOLVED developer-amigo note).
import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  discoverDesktopApp,
  launchDesktopApp,
  DESKTOP_APP_EXE,
} from "../src/commands/mesh-desktop.mjs";
// m42 wave (d) leg d1 (wave-3 tail) — the CLI face is the registered
// mesh:desktop-run command through the ONE generic face. The success envelope is
// asserted at the core+adapter level (invoke with an injected spawnFn — the face
// cannot inject a fake spawn, and a face-level success would launch a REAL
// process); the refusal path drives runCommandFace whole (it refuses before any
// spawn).
import { getCommand, invoke } from "../src/command-core.mjs";
import { runCommandFace } from "../src/spine/face.mjs";
import { withMeshDesktopFixture, seedInstalledApp } from "./support/mesh-desktop-fixture.mjs";

async function captureConsole(run) {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origError = console.error;
  const origExitCode = process.exitCode;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await run();
  } finally {
    console.log = origLog;
    console.error = origError;
    // The CLI face sets process.exitCode on a refusal — restore the test
    // runner's OWN process.exitCode so exercising a refusal path here never
    // leaks a non-zero exit code onto the node:test process itself.
    process.exitCode = origExitCode;
  }
  return { logs, errors };
}

// A fixture spawn recording exactly how it was called, standing in for the real
// Tauri .exe spawn — asserts the SHAPE (detached, argv, resolved absolute path),
// never actually starting a process.
function makeFixtureSpawn() {
  const calls = [];
  const spawnFn = (command, args, options) => {
    const child = {
      pid: 4242,
      unrefCalled: false,
      on(event) { /* the real code registers an 'error' handler; a no-op here */ },
      unref() { child.unrefCalled = true; },
    };
    calls.push({ command, args, options, child });
    return child;
  };
  return { spawnFn, calls };
}

export const meshDesktopRunTests = [
  // Scenario: run discovers the installed app in $HOME/.aof/bin and launches it
  // detached.
  {
    name: "mesh-desktop-run/02 run discovers the installed app by absolute co-located path (no PATH search) and launches it as a detached spawn that returns immediately",
    async run() {
      await withMeshDesktopFixture(async ({ installDir }) => {
        await seedInstalledApp(installDir);
        const { spawnFn, calls } = makeFixtureSpawn();

        const result = await launchDesktopApp({ installDir, spawnFn });
        assert.equal(result.ok, true, "ok:true reporting the launch");
        assert.equal(result.appPath, path.join(installDir, DESKTOP_APP_EXE), "discovered by absolute co-located path");

        assert.equal(calls.length, 1, "spawned exactly once");
        const call = calls[0];
        assert.equal(call.command, path.join(installDir, DESKTOP_APP_EXE), "the resolved absolute path is spawned directly — no PATH search / no shell string");
        assert.equal(call.options.detached, true, "launched detached");
        assert.equal(call.options.stdio, "ignore", "stdio ignored (a long-lived app, not piped to the CLI's own streams)");
        assert.equal(call.child.unrefCalled, true, "unref()'d so the CLI can exit/resolve without waiting on the long-lived app");
      });
    },
  },
  // Scenario: run before install is a calm, actionable refusal that names the
  // install verb, never a crash.
  {
    name: "mesh-desktop-run/02 run before install refuses calmly, names `aof mesh desktop install`, launches nothing",
    async run() {
      await withMeshDesktopFixture(async ({ installDir }) => {
        const { spawnFn, calls } = makeFixtureSpawn();
        await assert.rejects(
          () => launchDesktopApp({ installDir, spawnFn }),
          (error) => {
            assert.equal(error.code, "desktop-not-installed");
            assert.match(error.message, /aof mesh desktop install/, "names the install verb");
            return true;
          },
        );
        assert.equal(calls.length, 0, "nothing is launched");
      }, { seedArtifacts: false });
    },
  },
  // Scenario Outline: a present-but-unrunnable install is a coded refusal, never
  // a stack trace.
  {
    name: "mesh-desktop-run/02 discovery-failure matrix: runnable / never-installed / aof-only / not-runnable — each a coded outcome, never a stack trace",
    async run() {
      // Row 1: holds a runnable app executable -> discovers + launches detached.
      await withMeshDesktopFixture(async ({ installDir }) => {
        await seedInstalledApp(installDir);
        const { spawnFn, calls } = makeFixtureSpawn();
        const result = await launchDesktopApp({ installDir, spawnFn });
        assert.equal(result.ok, true);
        assert.equal(calls.length, 1);
      });

      // Row 2: is empty (app never installed) -> refuses, names the install verb.
      await withMeshDesktopFixture(async ({ installDir }) => {
        await assert.rejects(() => discoverDesktopApp({ installDir }), (error) => {
          assert.equal(error.code, "desktop-not-installed");
          assert.match(error.message, /aof mesh desktop install/);
          return true;
        });
      }, { seedAofBinary: false, seedArtifacts: false });

      // Row 3: holds only the aof binary (no desktop app placed yet) -> refuses,
      // names the install verb.
      await withMeshDesktopFixture(async ({ installDir }) => {
        await assert.rejects(() => discoverDesktopApp({ installDir }), (error) => {
          assert.equal(error.code, "desktop-not-installed");
          assert.match(error.message, /aof mesh desktop install/);
          return true;
        });
      }, { seedArtifacts: false });

      // Row 4: holds an app file that is not executable / is corrupt -> refuses
      // with a coded not-runnable error (a re-install hint). (POSIX-only bit
      // check inside discoverDesktopApp; simulate "corrupt" as a directory in
      // the app's place, which is unrunnable on every platform.)
      await withMeshDesktopFixture(async ({ installDir }) => {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path.join(installDir, DESKTOP_APP_EXE), { recursive: true });
        await assert.rejects(() => discoverDesktopApp({ installDir }), (error) => {
          assert.equal(error.code, "desktop-not-runnable");
          assert.match(error.message, /re-run `aof mesh desktop install`/i, "a re-install hint");
          return true;
        });
      });
    },
  },
  // POSIX-specific: a present file with no execute bit is the coded not-runnable
  // refusal (the "is corrupt" branch on a platform where the bit is meaningful).
  {
    name: "mesh-desktop-run/02 POSIX: a present app file with no execute bit is a coded not-runnable refusal, never a crash",
    async run() {
      if (process.platform === "win32") return; // the execute-bit check is POSIX-only (see the module's platform guard)
      await withMeshDesktopFixture(async ({ installDir }) => {
        await seedInstalledApp(installDir);
        await chmod(path.join(installDir, DESKTOP_APP_EXE), 0o644);
        await assert.rejects(() => discoverDesktopApp({ installDir }), (error) => {
          assert.equal(error.code, "desktop-not-runnable");
          return true;
        });
      });
    },
  },
  // Command+adapter proof: mesh:desktop-run's registered run (an injected fake
  // spawn — no real process) returns the launch report, and its cli.json adapter
  // shapes the single { ok:true, ... } envelope the face prints under --json.
  {
    name: "mesh-desktop-run/02 the registered command reports the launch and its --json adapter shapes the single { ok:true, ... } envelope",
    async run() {
      await withMeshDesktopFixture(async ({ installDir }) => {
        await seedInstalledApp(installDir);
        const { spawnFn, calls } = makeFixtureSpawn();
        const command = getCommand("mesh:desktop-run");
        const result = await invoke("mesh:desktop-run", { installDir }, { spawnFn });
        assert.equal(calls.length, 1, "the injected spawn ran exactly once");
        const parsed = command.cli.json(result);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.appPath, path.join(installDir, DESKTOP_APP_EXE));
      });
    },
  },
  // CLI-face refusal proof: `aof mesh desktop run --json` (not installed) is the
  // single { ok:false, error, code } envelope through the REAL routed face —
  // the refusal fires at discovery, before any spawn, so the whole face runs.
  // The plain face contract is the thrown coded error (bin/aof.mjs prints
  // error.message to stderr — one calm sentence, never a stack trace).
  {
    name: "mesh-desktop-run/02 the routed face's not-installed refusal is the single { ok:false, error, code } envelope, and a thrown one-sentence coded error otherwise",
    async run() {
      await withMeshDesktopFixture(async ({ installDir }) => {
        const command = getCommand("mesh:desktop-run");
        const { logs } = await captureConsole(() => runCommandFace(command, ["--install-dir", installDir, "--json"]));
        assert.equal(logs.length, 1);
        const parsed = JSON.parse(logs[0]);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.code, "desktop-not-installed");
        assert.match(parsed.error, /aof mesh desktop install/);

        await assert.rejects(
          () => runCommandFace(command, ["--install-dir", installDir]),
          (error) => {
            assert.equal(error.code, "desktop-not-installed");
            assert.doesNotMatch(error.message, /at\s+\S+\s+\(.*:\d+:\d+\)/, "no stack trace frame in the refusal message");
            return true;
          },
        );
      }, { seedArtifacts: false });
    },
  },
];
