import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const integrationDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(integrationDir, "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const featureFile = path.join(integrationDir, "cli.feature");
const useInProcessCli = process.env.AOF_IN_PROCESS_INTEGRATION === "1";

let failures = 0;
const feature = await parseFeature(featureFile);

for (const scenario of feature.scenarios) {
  const scenarioName = `${feature.name}: ${scenario.name}`;
  try {
    await runScenario(scenario);
    console.log(`ok - ${scenarioName}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${scenarioName}`);
    console.error(error.stack ?? error.message);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}

async function parseFeature(filePath) {
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const feature = { name: path.basename(filePath), scenarios: [] };
  let currentScenario = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("Feature:")) {
      feature.name = line.slice("Feature:".length).trim();
      continue;
    }

    if (line.startsWith("Scenario:")) {
      currentScenario = { name: line.slice("Scenario:".length).trim(), steps: [] };
      feature.scenarios.push(currentScenario);
      continue;
    }

    if (/^(Given|When|Then|And)\b/.test(line)) {
      if (!currentScenario) throw new Error(`Step appears before scenario in ${filePath}: ${line}`);
      currentScenario.steps.push(line.replace(/^(Given|When|Then|And)\s+/, ""));
    }
  }

  return feature;
}

async function runScenario(scenario) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-bdd-"));
  const context = {
    projectDir: path.join(root, "project"),
    dataDir: path.join(root, "data"),
    lastResult: null
  };

  try {
    for (const step of scenario.steps) {
      await runStep(context, step);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runStep(context, step) {
  if (step === "an empty project") {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(context.projectDir, { recursive: true }));
    return;
  }

  if (step === "a project initialized with legacy AOF config") {
    await runStep(context, "an empty project");
    const configPath = path.join(context.projectDir, "aof.config.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(configPath, legacyConfig(), "utf8"));
    context.lastResult = null;
    return;
  }

  if (step === "a project initialized with AOF config") {
    await runStep(context, "an empty project");
    const result = await runCli(context, "init --items project-context,prime --codex");
    assert.equal(result.status, 0, formatResult(result));
    context.lastResult = result;
    return;
  }

  if (step === "a project with .aof file-backed config") {
    await runStep(context, "an empty project");
    await writeAofProject(context, [{
      kind: "skill",
      id: "file-backed",
      description: "File backed",
      path: "assets/skills/file-backed/SKILL.md",
      bodyPath: "assets/skills/file-backed/SKILL.md",
      body: "File-backed body"
    }]);
    return;
  }

  if (step === "a project with .aof runtime override config") {
    await runStep(context, "an empty project");
    await writeAofProject(context, [{
      kind: "skill",
      id: "overridden",
      description: "Shared",
      path: "assets/skills/overridden/SKILL.md",
      bodyPath: "assets/skills/overridden/SKILL.md",
      body: "Shared body",
      overridePath: "assets/skills/overridden/overrides/codex.json",
      override: { body: "Codex override body" }
    }]);
    return;
  }

  if (step === "a project with .aof invalid identity override config") {
    await runStep(context, "an empty project");
    await writeAofProject(context, [{
      kind: "skill",
      id: "bad-override",
      description: "Shared",
      path: "assets/skills/bad-override/SKILL.md",
      bodyPath: "assets/skills/bad-override/SKILL.md",
      body: "Shared body",
      overridePath: "assets/skills/bad-override/overrides/codex.json",
      override: { id: "changed" }
    }]);
    return;
  }

  if (step === "a project with .aof rule config") {
    await runStep(context, "an empty project");
    await writeAofProject(context, [{
      kind: "rule",
      id: "project-rule",
      description: "Rule",
      paths: ["src"],
      path: "assets/rules/project-rule/RULE.md",
      bodyPath: "assets/rules/project-rule/RULE.md",
      body: "Use scoped guidance"
    }]);
    return;
  }

  let match = step.match(/^I run `(.+)` with input `([\s\S]*)`$/);
  if (match) {
    context.lastResult = await runCli(context, match[1], `${match[2]}\n`);
    return;
  }

  match = step.match(/^I run `(.+)`$/);
  if (match) {
    context.lastResult = await runCli(context, match[1]);
    return;
  }

  if (step === "the command should succeed") {
    assertLastResult(context);
    assert.equal(context.lastResult.status, 0, formatResult(context.lastResult));
    return;
  }

  if (step === "the command should fail") {
    assertLastResult(context);
    assert.notEqual(context.lastResult.status, 0, formatResult(context.lastResult));
    return;
  }

  match = step.match(/^stdout should contain `([\s\S]+)`$/);
  if (match) {
    assertLastResult(context);
    assert.match(context.lastResult.stdout, escapeRegex(match[1]), formatResult(context.lastResult));
    return;
  }

  match = step.match(/^stderr should contain `([\s\S]+)`$/);
  if (match) {
    assertLastResult(context);
    assert.match(context.lastResult.stderr, escapeRegex(match[1]), formatResult(context.lastResult));
    return;
  }

  match = step.match(/^file `(.+)` should exist$/);
  if (match) {
    assert.equal(await fileExists(path.join(context.projectDir, match[1])), true, `Expected file to exist: ${match[1]}`);
    return;
  }

  match = step.match(/^data file `(.+)` should exist$/);
  if (match) {
    assert.equal(await fileExists(path.join(context.dataDir, match[1])), true, `Expected data file to exist: ${match[1]}`);
    return;
  }

  match = step.match(/^file `(.+)` should not exist$/);
  if (match) {
    assert.equal(await fileExists(path.join(context.projectDir, match[1])), false, `Expected file not to exist: ${match[1]}`);
    return;
  }

  match = step.match(/^file `(.+)` should contain `([\s\S]+)`$/);
  if (match) {
    const content = await readFile(path.join(context.projectDir, match[1]), "utf8");
    assert.match(content, escapeRegex(match[2]));
    return;
  }

  match = step.match(/^JSON file `(.+)` should contain item `(.+)`$/);
  if (match) {
    const content = await readFile(path.join(context.projectDir, match[1]), "utf8");
    const json = JSON.parse(content);
    assert.ok(
      Array.isArray(json.items) && json.items.some((item) => item.id === match[2]),
      `Expected ${match[1]} to contain item ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should not contain item `(.+)`$/);
  if (match) {
    const content = await readFile(path.join(context.projectDir, match[1]), "utf8");
    const json = JSON.parse(content);
    assert.ok(
      !Array.isArray(json.items) || !json.items.some((item) => item.id === match[2]),
      `Expected ${match[1]} not to contain item ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should contain runtime `(.+)`$/);
  if (match) {
    const content = await readFile(path.join(context.projectDir, match[1]), "utf8");
    const json = JSON.parse(content);
    assert.ok(
      Array.isArray(json.runtimes) && json.runtimes.includes(match[2]),
      `Expected ${match[1]} to contain runtime ${match[2]}`
    );
    return;
  }

  throw new Error(`Unsupported BDD step: ${step}`);
}

function legacyConfig() {
  return `${JSON.stringify({
    name: "legacy",
    resources: [
      { kind: "skill", id: "project-context", description: "Context", body: "Use project context." },
      { kind: "command", id: "prime", description: "Prime", body: "Map repository." },
      { kind: "agent", id: "code-reviewer", description: "Review", body: "Review diff." }
    ]
  }, null, 2)}\n`;
}

async function writeAofProject(context, resourceInputs) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const workspaceDir = path.join(context.projectDir, ".aof");
  const resources = [];
  await mkdir(workspaceDir, { recursive: true });

  for (const input of resourceInputs) {
    const bodyPath = path.join(workspaceDir, input.bodyPath);
    await mkdir(path.dirname(bodyPath), { recursive: true });
    await writeFile(bodyPath, `${input.body}\n`, "utf8");

    if (input.overridePath) {
      const overridePath = path.join(workspaceDir, input.overridePath);
      await mkdir(path.dirname(overridePath), { recursive: true });
      await writeFile(overridePath, `${JSON.stringify(input.override, null, 2)}\n`, "utf8");
    }

    const resource = {
      kind: input.kind,
      id: input.id,
      description: input.description,
      path: input.path,
      runtimes: input.runtimes ?? ["claude", "codex"]
    };
    if (input.paths) resource.paths = input.paths;
    resources.push(resource);
  }

  await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
    $schema: "../schemas/aof.schema.json",
    name: "file-backed",
    resources
  }, null, 2)}\n`, "utf8");
}

function runCli(context, command, input = "") {
  if (useInProcessCli) {
    return runCliInProcess(context, command, input);
  }

  const args = splitCommand(command);
  const result = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], {
    cwd: context.projectDir,
    env: {
      ...process.env,
      AOF_DATA_DIR: context.dataDir,
      NODE_NO_WARNINGS: "1"
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

async function runCliInProcess(context, command, input = "") {
  const { run } = await import("../../src/cli.mjs");
  const previousCwd = process.cwd();
  const previousDataDir = process.env.AOF_DATA_DIR;
  const previousNoWarnings = process.env.NODE_NO_WARNINGS;
  const previousSelectionInput = process.env.AOF_TEST_SELECTION_INPUT;
  const previousLog = console.log;
  const previousError = console.error;
  const stdout = [];
  const stderr = [];

  console.log = (...args) => stdout.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));
  process.env.AOF_DATA_DIR = context.dataDir;
  process.env.NODE_NO_WARNINGS = "1";
  if (input) process.env.AOF_TEST_SELECTION_INPUT = input.trim();
  process.chdir(context.projectDir);

  try {
    await run(splitCommand(command));
    return { status: 0, stdout: stdout.join("\n"), stderr: stderr.join("\n"), error: null };
  } catch (error) {
    stderr.push(error.message);
    return { status: 1, stdout: stdout.join("\n"), stderr: stderr.join("\n"), error };
  } finally {
    process.chdir(previousCwd);
    console.log = previousLog;
    console.error = previousError;

    if (previousDataDir === undefined) {
      delete process.env.AOF_DATA_DIR;
    } else {
      process.env.AOF_DATA_DIR = previousDataDir;
    }

    if (previousNoWarnings === undefined) {
      delete process.env.NODE_NO_WARNINGS;
    } else {
      process.env.NODE_NO_WARNINGS = previousNoWarnings;
    }

    if (previousSelectionInput === undefined) {
      delete process.env.AOF_TEST_SELECTION_INPUT;
    } else {
      process.env.AOF_TEST_SELECTION_INPUT = previousSelectionInput;
    }
  }
}

function splitCommand(command) {
  return command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) ?? [];
}

async function fileExists(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function assertLastResult(context) {
  assert.ok(context.lastResult, "No command has been run in this scenario.");
}

function escapeRegex(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function formatResult(result) {
  return [
    `status: ${result.status}`,
    result.error ? `error: ${result.error.message}` : null,
    "stdout:",
    result.stdout,
    "stderr:",
    result.stderr
  ].filter((part) => part !== null).join("\n");
}
