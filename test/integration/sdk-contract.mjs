import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeGsdRoadmap,
  assertGsdSdkSurface,
  loadGsdState,
  resetGsdSdkSurfaceProbeForTests
} from "../../src/gsd-sdk-adapter.mjs";
import { MockGSDTools } from "../support/mock-gsd-tools.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "aof-sdk-contract-"));

try {
  await mkdir(path.join(root, ".planning"), { recursive: true });
  await writeFile(path.join(root, ".planning", "ROADMAP.md"), "# Roadmap\n", "utf8");

  resetGsdSdkSurfaceProbeForTests();
  assert.doesNotThrow(() => assertGsdSdkSurface());
  resetGsdSdkSurfaceProbeForTests();
  assert.doesNotThrow(() => assertGsdSdkSurface(MockGSDTools));

  const tools = new MockGSDTools({
    projectDir: root,
    scenario: "v17-active",
    overrides: {
      milestone: "v1.7",
      stateRaw: "current_milestone=v1.7\n",
      phases: [{ number: "33", name: "SDK Adapter Foundation", goal: "Typed adapter contract." }]
    }
  });

  const state = await loadGsdState(root, { tools });
  assert.equal(state.milestoneId, "v1.7");
  assert.equal(state.roadmapPresent, true);

  const roadmap = await analyzeGsdRoadmap(root, { tools });
  assert.equal(roadmap.milestones[0].version, "v1.7");
  assert.equal(roadmap.phases[0].number, "33");

  console.log("ok - SDK adapter contract fixture");
} finally {
  resetGsdSdkSurfaceProbeForTests();
  await rm(root, { recursive: true, force: true });
}
