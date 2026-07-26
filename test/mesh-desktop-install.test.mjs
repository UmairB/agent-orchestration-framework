// Traceability wiring for milestone 36 / story 03, task
// 01_install-placement.feature — `aof mesh desktop install` places the app +
// WebView2 bootstrapper at $HOME/.aof/bin idempotently, refusing failures calmly.
//
// Exercises the core placement logic directly (installDesktopApp,
// src/commands/mesh-desktop.mjs) over a FIXTURE install root with an injected
// $HOME (test/support/mesh-desktop-fixture.mjs) — never the real machine, never a
// live signed artifact (the story's Build notes / RESOLVED block).
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  installDesktopApp,
  DESKTOP_APP_EXE,
  WEBVIEW2_BOOTSTRAPPER,
} from "../src/commands/mesh-desktop.mjs";
import { meshDesktopCommand } from "../src/commands/mesh-desktop.mjs";
import { withMeshDesktopFixture, seedInstalledApp } from "./support/mesh-desktop-fixture.mjs";

// Capture console.log/console.error output around a call (the CLI-face --json
// envelope tests need the printed line, not just the return value).
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

export const meshDesktopInstallTests = [
  // Scenario: install places the app executable(s) into $HOME/.aof/bin alongside
  // the aof binary.
  {
    name: "mesh-desktop-install/01 install places the app executable(s) into $HOME/.aof/bin, leaving the m28 aof binary untouched beside them",
    async run() {
      await withMeshDesktopFixture(async ({ installDir, appArtifactPath, bootstrapperArtifactPath }) => {
        const result = await installDesktopApp({ installDir, appArtifactPath, bootstrapperArtifactPath });
        assert.equal(result.ok, true, "install reports ok:true");
        assert.equal(result.installDir, installDir, "reports the resolved install dir");

        const entries = await readdir(installDir);
        assert.ok(entries.includes(DESKTOP_APP_EXE), `the app executable is written under $HOME/.aof/bin (entries: ${entries})`);
        assert.ok(entries.includes("aof.exe"), "the m28 aof binary is left untouched beside it");
        const aofBytes = await readFile(path.join(installDir, "aof.exe"), "utf8");
        assert.equal(aofBytes, "fixture-aof-binary-v1", "the aof binary's bytes are unchanged");

        // The 00<->03 contract: the co-located pair resolves by absolute path in
        // the SAME dir (no PATH search) — both files share one parent dir.
        assert.equal(path.dirname(result.appPath), installDir, "the app's resolved path is co-located with aof.exe in the same install dir");
      });
    },
  },
  // Scenario: a re-install updates the app in place without duplicating or
  // leaving a stale copy.
  {
    name: "mesh-desktop-install/01 a re-install updates the app in place — no duplicate, no stale prior-version file",
    async run() {
      await withMeshDesktopFixture(async ({ installDir, appArtifactPath, bootstrapperArtifactPath, artifactsDir }) => {
        await seedInstalledApp(installDir, { appBytes: "prior-version-bytes" });
        const before = await readdir(installDir);
        assert.equal(before.length, 3, `sanity: aof.exe + prior app + prior bootstrapper only (got ${JSON.stringify(before)})`);

        const result = await installDesktopApp({ installDir, appArtifactPath, bootstrapperArtifactPath });
        assert.equal(result.ok, true);

        const after = await readdir(installDir);
        assert.equal(after.length, 3, `no duplicate/extra file accrues (got ${JSON.stringify(after)})`);
        assert.ok(after.includes(DESKTOP_APP_EXE) && after.includes(WEBVIEW2_BOOTSTRAPPER) && after.includes("aof.exe"));

        const newBytes = await readFile(path.join(installDir, DESKTOP_APP_EXE), "utf8");
        assert.equal(newBytes, "fixture-app-bytes-v1", "the app is replaced in place with the new artifact's bytes, not layered on the stale prior version");
      });
    },
  },
  // Scenario: install bundles the WebView2 Evergreen Bootstrapper so a missing
  // runtime can self-install on first run.
  {
    name: "mesh-desktop-install/01 install places/records the WebView2 Evergreen Bootstrapper as a discoverable placed file",
    async run() {
      await withMeshDesktopFixture(async ({ installDir, appArtifactPath, bootstrapperArtifactPath }) => {
        const result = await installDesktopApp({ installDir, appArtifactPath, bootstrapperArtifactPath });
        assert.equal(result.ok, true);
        assert.equal(path.basename(result.bootstrapperPath), WEBVIEW2_BOOTSTRAPPER, "the bootstrapper's placed filename is reported");

        const bootstrapperStat = await stat(result.bootstrapperPath);
        assert.ok(bootstrapperStat.isFile(), "the bootstrapper is a real placed file under the install dir — discoverable by the run verb");
      });
    },
  },
  // Scenario Outline: an install failure is a calm friendly refusal.
  {
    name: "mesh-desktop-install/01 friendly-refusal matrix: unwritable dir / missing app artifact / missing bootstrapper artifact — one calm sentence, never a stack trace, no partial install",
    async run() {
      // Row 1: $HOME/.aof/bin is not writable. Simulated via the injected
      // isWritableDirFn fault seam (mirrors mesh-fabric.mjs's injected exec) —
      // a real filesystem chmod does not reliably deny an owner write access to
      // their OWN directory on every OS/filesystem (notably Windows), so the
      // fault is injected deterministically rather than attempted on-disk.
      await withMeshDesktopFixture(async ({ installDir, appArtifactPath, bootstrapperArtifactPath }) => {
        await assert.rejects(
          () => installDesktopApp({ installDir, appArtifactPath, bootstrapperArtifactPath, isWritableDirFn: async () => false }),
          (error) => {
            assert.equal(error.code, "install-dir-not-writable", "coded refusal names the unwritable dir");
            assert.match(error.message, /not writable/i, "one friendly sentence carrying a permissions hint");
            assert.doesNotMatch(error.stack ?? "", /^\s*$/, "an Error always has SOME stack internally, but the MESSAGE itself (asserted above) is the one-sentence surface — never rendered raw to the operator");
            return true;
          },
        );
        const entries = await readdir(installDir);
        assert.deepEqual(entries.sort(), ["aof.exe"], "no partial install is left behind — only the prior aof.exe remains");
      });

      // Row 2: the packaged app artifact is missing.
      await withMeshDesktopFixture(async ({ installDir, bootstrapperArtifactPath }) => {
        await assert.rejects(
          () => installDesktopApp({ installDir, appArtifactPath: path.join(installDir, "does-not-exist.exe"), bootstrapperArtifactPath }),
          (error) => {
            assert.equal(error.code, "app-artifact-missing");
            assert.match(error.message, /artifact is missing/i, "names the missing artifact with a re-download/re-build hint");
            return true;
          },
        );
        const entries = await readdir(installDir);
        assert.deepEqual(entries.sort(), ["aof.exe"], "no partial install is left behind");
      }, { seedArtifacts: false });

      // Row 3: the WebView2 bootstrapper artifact is missing.
      await withMeshDesktopFixture(async ({ installDir, appArtifactPath }) => {
        await assert.rejects(
          () => installDesktopApp({ installDir, appArtifactPath, bootstrapperArtifactPath: path.join(installDir, "does-not-exist-bootstrapper.exe") }),
          (error) => {
            assert.equal(error.code, "bootstrapper-artifact-missing");
            assert.match(error.message, /bootstrapper.*is missing/i, "names the missing bootstrapper from the bundle");
            return true;
          },
        );
        const entries = await readdir(installDir);
        assert.deepEqual(entries.sort(), ["aof.exe"], "no partial install is left behind");
      });
    },
  },
  // Scenario: a failed install leaves $HOME/.aof/bin holding only its prior
  // contents (no partial placement) — the mid-install unwritable case.
  {
    name: "mesh-desktop-install/01 a failed install (dir becomes unwritable mid-install) rolls back any partial placement — $HOME/.aof/bin holds exactly its prior contents",
    async run() {
      await withMeshDesktopFixture(async ({ installDir, appArtifactPath, bootstrapperArtifactPath }) => {
        // Pre-seed a prior install (so "prior contents" is non-trivial). The
        // dir "becomes unwritable MID-install" is simulated via an injected
        // isWritableDirFn that answers true the FIRST call (the initial
        // pre-check, which passes — staging into the temp dir proceeds) and
        // false the SECOND call (the re-check right before the swap into
        // installDir) — a real chmod does not reliably deny an owner write
        // access on every OS/filesystem (notably Windows), so the fault is
        // injected deterministically instead.
        await seedInstalledApp(installDir, { appBytes: "prior-stable-bytes" });
        let calls = 0;
        const isWritableDirFn = async () => {
          calls += 1;
          return calls === 1;
        };
        await assert.rejects(() => installDesktopApp({ installDir, appArtifactPath, bootstrapperArtifactPath, isWritableDirFn }));
        assert.ok(calls >= 2, "the writability check ran again mid-install (the window the fault lands in)");
        const appBytes = await readFile(path.join(installDir, DESKTOP_APP_EXE), "utf8");
        assert.equal(appBytes, "prior-stable-bytes", "the prior app install is completely untouched — no partial overwrite");
        const entries = await readdir(installDir);
        assert.deepEqual(entries.sort(), ["aof-mesh-desktop.exe", "aof.exe", "MicrosoftEdgeWebview2Setup.exe"].sort(), "$HOME/.aof/bin holds exactly its prior contents");
      });
    },
  },
  // CLI-face envelope proof: `aof mesh desktop install --json` refusal shape
  // (the { ok:false, error, code } single envelope, install's own coded refusal
  // reaching the CLI face, not just the core function).
  {
    name: "mesh-desktop-install/01 the CLI face (meshDesktopCommand) renders install's refusal as a single { ok:false, error, code } --json envelope, and a plain-text one-sentence refusal otherwise",
    async run() {
      await withMeshDesktopFixture(async ({ installDir }) => {
        const { logs } = await captureConsole(() =>
          meshDesktopCommand(["install", "--json"], { installDir, appArtifactPath: undefined, bootstrapperArtifactPath: undefined }),
        );
        assert.equal(logs.length, 1, "exactly one line printed under --json");
        const parsed = JSON.parse(logs[0]);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.code, "app-artifact-missing");
        assert.equal(typeof parsed.error, "string");

        const { errors } = await captureConsole(() =>
          meshDesktopCommand(["install"], { installDir, appArtifactPath: undefined, bootstrapperArtifactPath: undefined }),
        );
        assert.equal(errors.length, 1, "exactly one calm sentence on stderr, never a stack trace");
        assert.doesNotMatch(errors[0], /at\s+\S+\s+\(.*:\d+:\d+\)/, "no stack trace frame in the printed refusal");
      }, { seedArtifacts: false });
    },
  },
  // CLI-face success proof: install succeeds end-to-end through the CLI face.
  {
    name: "mesh-desktop-install/01 the CLI face (meshDesktopCommand) installs successfully end-to-end and reports ok:true under --json",
    async run() {
      await withMeshDesktopFixture(async ({ installDir, appArtifactPath, bootstrapperArtifactPath }) => {
        const { logs } = await captureConsole(() =>
          meshDesktopCommand(["install", "--json"], { installDir, appArtifactPath, bootstrapperArtifactPath }),
        );
        assert.equal(logs.length, 1);
        const parsed = JSON.parse(logs[0]);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.installDir, installDir);
        assert.equal(typeof parsed.message, "undefined", "the message/help text is never part of the JSON body — only ok + the verb's result fields");

        const entries = await readdir(installDir);
        assert.ok(entries.includes(DESKTOP_APP_EXE) && entries.includes(WEBVIEW2_BOOTSTRAPPER));
      });
    },
  },
];
