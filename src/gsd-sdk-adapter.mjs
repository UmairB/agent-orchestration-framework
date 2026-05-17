import { appendFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GSDTools, GSDToolsError } from "@gsd-build/sdk";
import { readJson } from "./fs.mjs";
import { readLock } from "./lock.mjs";
import { workspacePaths } from "./workspace.mjs";

const READ_TIMEOUT_MS = 10_000;
const REQUIRED_GSD_TOOLS_METHODS = [
  "exec",
  "execRaw",
  "stateLoad",
  "roadmapAnalyze",
  "configGet",
  "configSet",
  "phasePlanIndex",
  "initPhaseOp",
  "phaseComplete",
  "commit"
];

let surfaceProbeError = null;
let surfaceProbeComplete = false;

export class GsdSdkError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GsdSdkError";
    this.code = code;
    this.expected = details.expected;
    this.actual = details.actual;
    this.next = details.next;
    this.cause = details.cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.expected !== undefined ? { expected: this.expected } : {}),
      ...(this.actual !== undefined ? { actual: this.actual } : {}),
      ...(this.next !== undefined ? { next: this.next } : {})
    };
  }
}

export async function loadGsdState(projectDir, options = {}) {
  const { tools, projectRoot, gsdToolsPath } = await createTools(projectDir, options);
  const raw = await callTools(projectRoot, tools, "state", ["load"], { raw: true });
  const parsed = parseMaybeJson(raw);
  return {
    milestoneId: currentMilestoneId(parsed, raw),
    statePresent: Boolean(raw),
    roadmapPresent: await fileExists(path.join(projectRoot, ".planning", "ROADMAP.md")),
    configPresent: await fileExists(path.join(projectRoot, ".planning", "config.json")),
    gsdToolsPath,
    raw
  };
}

export async function analyzeGsdRoadmap(projectDir, options = {}) {
  const { tools, projectRoot } = await createTools(projectDir, options);
  return await callTools(projectRoot, tools, "roadmap", ["analyze"]);
}

export async function assertMilestone(projectDir, milestoneId, options = {}) {
  const expected = normalizeMilestoneId(milestoneId);
  if (!expected) {
    return { ok: false, expected: milestoneId, actual: null, code: "MILESTONE_MISSING_ARG" };
  }

  const [state, roadmap] = await Promise.all([
    loadGsdState(projectDir, options),
    analyzeGsdRoadmap(projectDir, options)
  ]);
  const knownMilestones = Array.isArray(roadmap?.milestones) ? roadmap.milestones.map((item) => item.version).filter(Boolean) : [];
  const actual = state.milestoneId ?? (knownMilestones.length === 1 ? knownMilestones[0] : null);

  if (knownMilestones.length > 0 && !knownMilestones.includes(expected)) {
    return { ok: false, expected, actual, code: "MILESTONE_NOT_IN_STATE" };
  }
  if (actual && actual !== expected) {
    return { ok: false, expected, actual, code: "MILESTONE_ID_MISMATCH" };
  }

  return { ok: true, expected, actual: actual ?? expected, code: null };
}

export async function listMilestonePhases(projectDir, milestoneId, options = {}) {
  const result = await assertMilestone(projectDir, milestoneId, options);
  if (!result.ok) return [];

  const roadmap = await analyzeGsdRoadmap(projectDir, options);
  return Array.isArray(roadmap?.phases) ? roadmap.phases : [];
}

export function gsdSdkVersion() {
  const entrypoint = fileURLToPath(import.meta.resolve("@gsd-build/sdk"));
  const pkgPath = path.resolve(path.dirname(entrypoint), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return {
    installed: pkg.version,
    cliBundled: null,
    drift: false,
    driftReason: null
  };
}

export function assertGsdSdkSurface(ToolsClass = GSDTools) {
  if (surfaceProbeComplete) return;
  if (surfaceProbeError) throw surfaceProbeError;

  const missing = REQUIRED_GSD_TOOLS_METHODS.filter((method) => typeof ToolsClass.prototype?.[method] !== "function");
  if (missing.length > 0) {
    surfaceProbeError = new GsdSdkError(
      "GSD_SDK_SURFACE_MISMATCH",
      `@gsd-build/sdk is missing required GSDTools method(s): ${missing.join(", ")}.`,
      {
        expected: REQUIRED_GSD_TOOLS_METHODS,
        actual: Object.getOwnPropertyNames(ToolsClass.prototype ?? {}),
        next: "Reinstall AOF dependencies with the pinned @gsd-build/sdk@0.1.0 version."
      }
    );
    throw surfaceProbeError;
  }

  surfaceProbeComplete = true;
}

export function resetGsdSdkSurfaceProbeForTests() {
  surfaceProbeError = null;
  surfaceProbeComplete = false;
}

async function createTools(projectDir, options = {}) {
  const projectRoot = path.resolve(projectDir);
  const ToolsClass = options.ToolsClass ?? GSDTools;
  if (!options.skipSurfaceProbe) assertGsdSdkSurface(ToolsClass);

  const gsdToolsPath = options.gsdToolsPath ?? await resolveGsdToolsPath(projectRoot);
  const tools = options.tools ?? testFixtureToolsFromEnv() ?? new ToolsClass({
    projectDir: projectRoot,
    ...(gsdToolsPath ? { gsdToolsPath } : {}),
    timeoutMs: options.timeoutMs ?? READ_TIMEOUT_MS
  });

  return { tools, projectRoot, gsdToolsPath };
}

function testFixtureToolsFromEnv() {
  const raw = process.env.AOF_TEST_GSD_SDK_FIXTURE_JSON;
  if (!raw) return null;
  const fixture = JSON.parse(raw);
  return {
    async exec(command, args) {
      if (command === "roadmap" && args[0] === "analyze") {
        return {
          milestones: fixture.milestones ?? [{ version: fixture.milestone ?? "v1.7" }],
          phases: fixture.phases ?? []
        };
      }
      throw new Error(`Unexpected test SDK exec ${command} ${args.join(" ")}`);
    },
    async execRaw(command, args) {
      if (command === "state" && args[0] === "load") return `current_milestone=${fixture.milestone ?? "v1.7"}\n`;
      throw new Error(`Unexpected test SDK execRaw ${command} ${args.join(" ")}`);
    }
  };
}

async function callTools(projectRoot, tools, command, args = [], options = {}) {
  const startedAt = Date.now();
  try {
    const value = options.raw
      ? await tools.execRaw(command, args)
      : await tools.exec(command, args);
    await appendDispatchLog(projectRoot, { command, args, latencyMs: Date.now() - startedAt, ok: true });
    return value;
  } catch (error) {
    await appendDispatchLog(projectRoot, { command, args, latencyMs: Date.now() - startedAt, ok: false });
    throw wrapGsdError(error);
  }
}

function wrapGsdError(error) {
  if (error instanceof GsdSdkError) return error;
  if (error instanceof GSDToolsError || error?.name === "GSDToolsError") {
    const code = error.exitCode === null ? "GSD_TOOLS_MISSING" : "GSD_TOOLS_FAILED";
    return new GsdSdkError(code, userSafeGsdMessage(error), {
      actual: { exitCode: error.exitCode ?? null },
      next: "Verify GSD is installed for this project with `aof packages install gsd`.",
      cause: error
    });
  }
  return new GsdSdkError("GSD_SDK_CALL_FAILED", error?.message ?? String(error), { cause: error });
}

function userSafeGsdMessage(error) {
  if (error.exitCode === null) return "Unable to execute the configured GSD tools binary.";
  return "GSD tools returned a non-zero result.";
}

async function resolveGsdToolsPath(projectRoot) {
  const lock = await readLock(workspacePaths(projectRoot).lockPath);
  return firstPathCandidate([
    lock?.gsd?.toolsPath,
    lock?.gsd?.gsdToolsPath,
    ...(Array.isArray(lock?.frameworks) ? lock.frameworks : [])
      .filter((item) => item?.id === "gsd" || item?.framework === "gsd")
      .flatMap((item) => [item.resolvedToolsPath, item.gsdToolsPath]),
    ...(Array.isArray(lock?.frameworkInstallAttempts) ? lock.frameworkInstallAttempts : [])
      .filter((item) => item?.framework === "gsd" && item?.status === "success")
      .flatMap((item) => [item.resolvedToolsPath, item.gsdToolsPath])
  ]);
}

function firstPathCandidate(candidates) {
  for (const candidate of candidates.flat()) {
    if (typeof candidate === "string" && candidate.trim()) return path.resolve(candidate);
  }
  return null;
}

async function appendDispatchLog(projectRoot, entry) {
  const logPath = path.join(projectRoot, ".aof", "cache", "boards", "dispatch.log.jsonl");
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, line, "utf8");
  } catch (error) {
    console.warn(`warning: failed to write GSD dispatch log: ${error.message}`);
  }
}

async function fileExists(filePath) {
  try {
    await readJson(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    return true;
  }
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function currentMilestoneId(parsed, raw) {
  if (parsed && typeof parsed === "object") {
    return parsed.current_milestone ?? parsed.currentMilestone ?? parsed.milestone ?? parsed.milestoneId ?? null;
  }
  if (typeof raw !== "string") return null;
  const match = raw.match(/(?:current_milestone|milestone|milestone_id)=([^\r\n]+)/i);
  return match ? match[1].trim() : null;
}

function normalizeMilestoneId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
