import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export class MockGSDTools {
  constructor(options = {}) {
    this.projectDir = options.projectDir;
    this.scenario = options.scenario ?? "v17-active";
    this.overrides = options.overrides ?? {};
  }

  async exec(command, args = []) {
    if (this.overrides.execError) throw toolError(this.overrides.execError);
    if (command === "roadmap" && args[0] === "analyze" && args.length === 1) {
      const roadmap = await loadRoadmapFixture(this.scenario);
      return applyRoadmapOverrides(roadmap, this.overrides);
    }
    throw new Error(`Unexpected test SDK exec ${command} ${args.join(" ")}`);
  }

  async execRaw(command, args = []) {
    if (this.overrides.execRawError) throw toolError(this.overrides.execRawError);
    if (command === "state" && args[0] === "load" && args.length === 1) {
      return this.overrides.stateRaw ?? await loadStateFixture(this.scenario);
    }
    throw new Error(`Unexpected test SDK execRaw ${command} ${args.join(" ")}`);
  }

  async stateLoad() {}
  async roadmapAnalyze() {}
  async configGet() {}
  async configSet() {}
  async phasePlanIndex() {}
  async initPhaseOp() {}
  async phaseComplete() {}
  async commit() {}
}

export async function loadRoadmapFixture(scenario) {
  const text = await readFile(fixturePath(scenario, "roadmap-analyze.stdout.json"), "utf8");
  return JSON.parse(text);
}

export async function loadStateFixture(scenario) {
  return await readFile(fixturePath(scenario, "state-load.stdout.txt"), "utf8");
}

export function applyRoadmapOverrides(roadmap, overrides = {}) {
  const next = structuredClone(roadmap);
  if (overrides.milestones !== undefined) next.milestones = overrides.milestones;
  if (overrides.milestone !== undefined && overrides.milestones === undefined) {
    next.milestones = [{ version: overrides.milestone }];
  }
  if (overrides.phases !== undefined) {
    next.phases = overrides.phases;
    next.phase_count = overrides.phases.length;
  }
  return next;
}

function fixturePath(scenario, fileName) {
  const safeScenario = String(scenario ?? "").trim();
  if (!safeScenario || safeScenario.includes("..") || /[\\/]/u.test(safeScenario)) {
    throw new Error(`Invalid GSD SDK fixture scenario: ${scenario}`);
  }
  return path.join(repoRoot, "test", "fixtures", "gsd-sdk", safeScenario, fileName);
}

function toolError(input) {
  if (input instanceof Error) return input;
  const error = new Error(input.message ?? String(input));
  if (input.name) error.name = input.name;
  if ("exitCode" in input) error.exitCode = input.exitCode;
  return error;
}

