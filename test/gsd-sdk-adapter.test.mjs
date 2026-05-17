import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GsdSdkError,
  analyzeGsdRoadmap,
  assertGsdSdkSurface,
  assertGsdRunnerSurface,
  assertMilestone,
  gsdSdkVersion,
  inspectGsdToolchain,
  listMilestonePhases,
  loadGsdState,
  resetGsdSdkSurfaceProbeForTests,
  runGsdPhase
} from "../src/gsd-sdk-adapter.mjs";
import { MockGSDTools } from "./support/mock-gsd-tools.mjs";

export const gsdSdkAdapterTests = [
  {
    name: "loads GSD state and roadmap through injected tools",
    run: loadsStateAndRoadmap
  },
  {
    name: "returns structured milestone assertion results",
    run: returnsMilestoneAssertion
  },
  {
    name: "wraps GSD tool failures and logs dispatch attempts",
    run: wrapsFailuresAndLogs
  },
  {
    name: "loads named GSD SDK fixtures from env",
    run: loadsNamedEnvFixture
  },
  {
    name: "fails strictly on uncaptured mock SDK calls",
    run: failsStrictlyOnUnknownMockCalls
  },
  {
    name: "runs GSD phases through injected SDK runner",
    run: runsPhaseThroughInjectedRunner
  },
  {
    name: "surfaces failed GSD phase plan subtype",
    run: surfacesFailedPhaseSubtype
  },
  {
    name: "detects SDK runner surface mismatch",
    run: detectsRunnerSurfaceMismatch
  },
  {
    name: "detects SDK surface mismatch",
    run: detectsSurfaceMismatch
  },
  {
    name: "reports installed SDK version",
    run: reportsSdkVersion
  },
  {
    name: "reports GSD toolchain version drift",
    run: reportsToolchainVersionDrift
  },
  {
    name: "reports missing GSD tools",
    run: reportsMissingGsdTools
  }
];

async function loadsStateAndRoadmap() {
  const projectDir = await tempProject();
  const tools = new MockGSDTools({
    scenario: "v17-active",
    overrides: {
      milestone: "v1.7",
      stateRaw: "current_milestone=v1.7\n",
      phases: [{ number: "33", phase_name: "SDK Adapter Foundation", disk_status: "discussed", roadmap_complete: false }]
    }
  });

  const state = await loadGsdState(projectDir, { tools, skipSurfaceProbe: true });
  assert.equal(state.milestoneId, "v1.7");
  assert.equal(state.statePresent, true);

  const roadmap = await analyzeGsdRoadmap(projectDir, { tools, skipSurfaceProbe: true });
  assert.equal(roadmap.phases[0].number, "33");

  const log = await readFile(path.join(projectDir, ".aof", "cache", "boards", "dispatch.log.jsonl"), "utf8");
  assert.match(log, /"command":"state"/);
  assert.match(log, /"command":"roadmap"/);
}

async function returnsMilestoneAssertion() {
  const projectDir = await tempProject();
  const tools = new MockGSDTools({
    overrides: {
      milestone: "v1.7",
      stateRaw: "current_milestone=v1.7\n",
      phases: [{ number: "33", phase_name: "SDK Adapter Foundation" }]
    }
  });

  assert.deepEqual(await assertMilestone(projectDir, "v1.7", { tools, skipSurfaceProbe: true }), {
    ok: true,
    expected: "v1.7",
    actual: "v1.7",
    code: null
  });
  assert.deepEqual(await assertMilestone(projectDir, "v9", { tools, skipSurfaceProbe: true }), {
    ok: false,
    expected: "v9",
    actual: "v1.7",
    code: "MILESTONE_NOT_IN_STATE"
  });

  const phases = await listMilestonePhases(projectDir, "v1.7", { tools, skipSurfaceProbe: true });
  assert.equal(phases.length, 1);
}

async function wrapsFailuresAndLogs() {
  const projectDir = await tempProject();
  const tools = {
    async exec() {
      const error = new Error("gsd-tools exited with code 1: roadmap analyze");
      error.name = "GSDToolsError";
      error.exitCode = 1;
      throw error;
    }
  };

  await assert.rejects(
    () => analyzeGsdRoadmap(projectDir, { tools, skipSurfaceProbe: true }),
    (error) => error instanceof GsdSdkError && error.code === "GSD_TOOLS_FAILED"
  );

  const log = await readFile(path.join(projectDir, ".aof", "cache", "boards", "dispatch.log.jsonl"), "utf8");
  assert.match(log, /"ok":false/);
}

async function loadsNamedEnvFixture() {
  const projectDir = await tempProject();
  await withEnv({
    AOF_TEST_GSD_SDK_FIXTURE: "v17-active",
    AOF_TEST_GSD_SDK_FIXTURE_JSON: JSON.stringify({
      milestone: "v1.7",
      stateRaw: "current_milestone=v1.7\n",
      phases: [{ number: "40", name: "Named Fixture Phase", goal: "Prove named fixtures work." }]
    })
  }, async () => {
    const state = await loadGsdState(projectDir, { skipSurfaceProbe: true });
    assert.equal(state.milestoneId, "v1.7");

    const roadmap = await analyzeGsdRoadmap(projectDir, { skipSurfaceProbe: true });
    assert.equal(roadmap.phases[0].number, "40");
    assert.equal(roadmap.phase_count, 1);
  });
}

async function failsStrictlyOnUnknownMockCalls() {
  const tools = new MockGSDTools();
  await assert.rejects(
    () => tools.exec("phase", ["list"]),
    /Unexpected test SDK exec phase list/
  );
}

async function runsPhaseThroughInjectedRunner() {
  const projectDir = await tempProject();
  const result = await runGsdPhase(projectDir, "37", {
    GsdClass: successfulGsdClass()
  });
  assert.equal(result.phaseNumber, "37");
  assert.equal(result.success, true);
}

async function surfacesFailedPhaseSubtype() {
  const projectDir = await tempProject();
  await assert.rejects(
    () => runGsdPhase(projectDir, "37", { GsdClass: failingGsdClass() }),
    (error) => error instanceof GsdSdkError
      && error.code === "GSD_PHASE_FAILED"
      && error.actual.subtype === "error_max_turns"
  );
}

function detectsSurfaceMismatch() {
  resetGsdSdkSurfaceProbeForTests();
  class BrokenTools {}
  assert.throws(
    () => assertGsdSdkSurface(BrokenTools),
    (error) => error instanceof GsdSdkError && error.code === "GSD_SDK_SURFACE_MISMATCH"
  );
  resetGsdSdkSurfaceProbeForTests();
}

function detectsRunnerSurfaceMismatch() {
  class BrokenGsd {}
  assert.throws(
    () => assertGsdRunnerSurface(BrokenGsd),
    (error) => error instanceof GsdSdkError && error.code === "GSD_SDK_SURFACE_MISMATCH"
  );
}

function reportsSdkVersion() {
  assert.equal(gsdSdkVersion().installed, "0.1.0");
}

async function reportsToolchainVersionDrift() {
  const projectDir = await tempProject();
  const report = await inspectGsdToolchain(projectDir, {
    gsdToolsPath: "C:/tools/gsd-tools.cjs",
    toolsVersion: "1.42.2"
  });
  assert.equal(report.sdkVersion, "0.1.0");
  assert.equal(report.toolsVersion, "1.42.2");
  assert.equal(report.toolsPath, "C:/tools/gsd-tools.cjs");
  assert.equal(report.diagnostics.some((item) => item.code === "SDK_VERSION_DRIFT" && item.status === "warn"), true);
}

async function reportsMissingGsdTools() {
  const projectDir = await tempProject();
  const report = await inspectGsdToolchain(projectDir, {
    toolsVersion: "",
    requireToolsPath: true
  });
  assert.equal(report.diagnostics.some((item) => item.code === "GSD_TOOLS_MISSING" && item.status === "fail"), true);
}

async function tempProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-gsd-sdk-"));
  await writeFile(path.join(dir, ".placeholder"), "", "utf8");
  return dir;
}

function successfulGsdClass() {
  return class FakeGsd {
    async runPhase(phaseNumber) {
      return {
        phaseNumber,
        phaseName: "Runtime Fallback Hardening",
        steps: [],
        success: true,
        totalCostUsd: 0,
        totalDurationMs: 10
      };
    }
  };
}

function failingGsdClass() {
  return class FakeGsd {
    async runPhase(phaseNumber) {
      return {
        phaseNumber,
        phaseName: "Runtime Fallback Hardening",
        steps: [{
          step: "execute",
          success: false,
          durationMs: 5,
          planResults: [{
            success: false,
            sessionId: "session-1",
            totalCostUsd: 0,
            durationMs: 5,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheCreationInputTokens: 0,
              cacheReadInputTokens: 0
            },
            numTurns: 50,
            error: {
              subtype: "error_max_turns",
              messages: ["Reached max turns."]
            }
          }]
        }],
        success: false,
        totalCostUsd: 0,
        totalDurationMs: 5
      };
    }
  };
}

async function withEnv(values, callback) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
  try {
    await callback();
  } finally {
    for (const name of Object.keys(values)) {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    }
  }
}
