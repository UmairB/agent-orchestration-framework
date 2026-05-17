import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const integrationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(integrationDir, "..", "..");
export const cliPath = path.join(repoRoot, "bin", "aof.mjs");
export const useInProcessCli = process.env.AOF_IN_PROCESS_INTEGRATION === "1";

export async function createCliContext() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-bdd-"));
  return {
    root,
    projectDir: path.join(root, "project"),
    dataDir: path.join(root, "data"),
    globalDir: path.join(root, "global-aof"),
    lastResult: null
  };
}

export async function cleanupCliContext(context) {
  await rm(context.root, { recursive: true, force: true });
}

export function runCli(context, command, input = "", options = {}) {
  if (useInProcessCli) {
    return runCliInProcess(context, command, input, options);
  }

  const args = splitCommand(command);
  const promptEnv = promptInputEnv(input);
  const result = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], {
    cwd: context.projectDir,
    env: {
      ...process.env,
      AOF_DATA_DIR: context.dataDir,
      AOF_GLOBAL_HOME: context.globalDir,
      NODE_NO_WARNINGS: "1",
      ...promptEnv,
      ...(options.resourceInput ? { AOF_TEST_RESOURCE_INPUT: options.resourceInput } : {}),
      ...(options.frameworkStatuses ? { AOF_TEST_FRAMEWORK_INSTALL_STATUS: options.frameworkStatuses } : {}),
      ...(options.gsdRuntimeStatus ? { AOF_TEST_GSD_RUNTIME_STATUS: options.gsdRuntimeStatus } : {}),
      ...(options.gsdRuntimeOutput ? { AOF_TEST_GSD_RUNTIME_STDOUT: options.gsdRuntimeOutput } : {}),
      ...(context.gsdSdkFixtureName ? { AOF_TEST_GSD_SDK_FIXTURE: context.gsdSdkFixtureName } : {}),
      ...(context.gsdSdkFixture ? { AOF_TEST_GSD_SDK_FIXTURE_JSON: JSON.stringify(context.gsdSdkFixture) } : {}),
      ...(context.gsdPhaseResult ? { AOF_TEST_GSD_PHASE_RESULT_JSON: JSON.stringify(context.gsdPhaseResult) } : {}),
      ...(context.gsdToolsVersion ? { AOF_TEST_GSD_TOOLS_VERSION: context.gsdToolsVersion } : {})
    },
    input,
    encoding: "utf8"
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error
  };
}

export async function runCliInProcess(context, command, input = "", options = {}) {
  const { run } = await import("../../../src/cli.mjs");
  const previousCwd = process.cwd();
  const previousDataDir = process.env.AOF_DATA_DIR;
  const previousNoWarnings = process.env.NODE_NO_WARNINGS;
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  const previousSelectionInput = process.env.AOF_TEST_SELECTION_INPUT;
  const previousRuntimeInput = process.env.AOF_TEST_RUNTIMES_INPUT;
  const previousConfirmInput = process.env.AOF_TEST_CONFIRM_INPUT;
  const previousResourceInput = process.env.AOF_TEST_RESOURCE_INPUT;
  const previousFrameworkStatus = process.env.AOF_TEST_FRAMEWORK_INSTALL_STATUS;
  const previousGsdRuntimeStatus = process.env.AOF_TEST_GSD_RUNTIME_STATUS;
  const previousGsdRuntimeStdout = process.env.AOF_TEST_GSD_RUNTIME_STDOUT;
  const previousGsdSdkFixtureName = process.env.AOF_TEST_GSD_SDK_FIXTURE;
  const previousGsdSdkFixture = process.env.AOF_TEST_GSD_SDK_FIXTURE_JSON;
  const previousGsdPhaseResult = process.env.AOF_TEST_GSD_PHASE_RESULT_JSON;
  const previousGsdToolsVersion = process.env.AOF_TEST_GSD_TOOLS_VERSION;
  const previousExitCode = process.exitCode;
  const previousLog = console.log;
  const previousError = console.error;
  const stdout = [];
  const stderr = [];

  console.log = (...args) => stdout.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));
  process.env.AOF_DATA_DIR = context.dataDir;
  process.env.AOF_GLOBAL_HOME = context.globalDir;
  process.env.NODE_NO_WARNINGS = "1";
  process.exitCode = undefined;
  for (const [name, value] of Object.entries(promptInputEnv(input))) {
    process.env[name] = value;
  }
  if (options.resourceInput) process.env.AOF_TEST_RESOURCE_INPUT = options.resourceInput;
  if (options.frameworkStatuses) process.env.AOF_TEST_FRAMEWORK_INSTALL_STATUS = options.frameworkStatuses;
  if (options.gsdRuntimeStatus) process.env.AOF_TEST_GSD_RUNTIME_STATUS = options.gsdRuntimeStatus;
  if (options.gsdRuntimeOutput) process.env.AOF_TEST_GSD_RUNTIME_STDOUT = options.gsdRuntimeOutput;
  if (context.gsdSdkFixtureName) process.env.AOF_TEST_GSD_SDK_FIXTURE = context.gsdSdkFixtureName;
  if (context.gsdSdkFixture) process.env.AOF_TEST_GSD_SDK_FIXTURE_JSON = JSON.stringify(context.gsdSdkFixture);
  if (context.gsdPhaseResult) process.env.AOF_TEST_GSD_PHASE_RESULT_JSON = JSON.stringify(context.gsdPhaseResult);
  if (context.gsdToolsVersion) process.env.AOF_TEST_GSD_TOOLS_VERSION = context.gsdToolsVersion;
  process.chdir(context.projectDir);

  try {
    await run(splitCommand(command));
    return { status: process.exitCode ?? 0, stdout: stdout.join("\n"), stderr: stderr.join("\n"), error: null };
  } catch (error) {
    stderr.push(error.message);
    return { status: 1, stdout: stdout.join("\n"), stderr: stderr.join("\n"), error };
  } finally {
    process.chdir(previousCwd);
    console.log = previousLog;
    console.error = previousError;
    restoreEnv("AOF_DATA_DIR", previousDataDir);
    restoreEnv("AOF_GLOBAL_HOME", previousGlobalHome);
    restoreEnv("NODE_NO_WARNINGS", previousNoWarnings);
    restoreEnv("AOF_TEST_SELECTION_INPUT", previousSelectionInput);
    restoreEnv("AOF_TEST_RUNTIMES_INPUT", previousRuntimeInput);
    restoreEnv("AOF_TEST_CONFIRM_INPUT", previousConfirmInput);
    restoreEnv("AOF_TEST_RESOURCE_INPUT", previousResourceInput);
    restoreEnv("AOF_TEST_FRAMEWORK_INSTALL_STATUS", previousFrameworkStatus);
    restoreEnv("AOF_TEST_GSD_RUNTIME_STATUS", previousGsdRuntimeStatus);
    restoreEnv("AOF_TEST_GSD_RUNTIME_STDOUT", previousGsdRuntimeStdout);
    restoreEnv("AOF_TEST_GSD_SDK_FIXTURE", previousGsdSdkFixtureName);
    restoreEnv("AOF_TEST_GSD_SDK_FIXTURE_JSON", previousGsdSdkFixture);
    restoreEnv("AOF_TEST_GSD_PHASE_RESULT_JSON", previousGsdPhaseResult);
    restoreEnv("AOF_TEST_GSD_TOOLS_VERSION", previousGsdToolsVersion);
    process.exitCode = previousExitCode;
  }
}

export function splitCommand(command) {
  return command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
}

function promptInputEnv(input) {
  if (!input) return {};
  const [selectionInput, runtimeInput, ...confirmations] = input.trim().split(/\r?\n/);
  return {
    AOF_TEST_SELECTION_INPUT: selectionInput ?? "",
    ...(runtimeInput !== undefined ? { AOF_TEST_RUNTIMES_INPUT: runtimeInput } : {}),
    ...(confirmations.length > 0 ? { AOF_TEST_CONFIRM_INPUT: confirmations.join(",") } : {})
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
