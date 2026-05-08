import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCli } from "../support/cli-context.mjs";
import {
  assertLastResult,
  escapeRegex,
  fileExists,
  formatResult,
  normalizeFilePath
} from "../support/assertions.mjs";

export async function runSharedCliStep(context, step) {
  if (step === "an empty project") {
    await mkdir(context.projectDir, { recursive: true });
    return;
  }

  if (step === "a project initialized with legacy AOF config") {
    await runSharedCliStep(context, "an empty project");
    await writeFile(path.join(context.projectDir, "aof.config.json"), legacyConfig(), "utf8");
    context.lastResult = null;
    return;
  }

  if (step === "a project initialized with AOF config") {
    await runSharedCliStep(context, "an empty project");
    const result = await runCli(context, "init --items project-context,prime --codex");
    assert.equal(result.status, 0, formatResult(result));
    context.lastResult = result;
    return;
  }

  if (step === "a project with .aof file-backed config") {
    await runSharedCliStep(context, "an empty project");
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

  if (step === "a project with expanded .aof DSL config") {
    await runSharedCliStep(context, "an empty project");
    await writeExpandedAofProject(context);
    return;
  }

  if (step === "a project with adapter warning .aof config") {
    await runSharedCliStep(context, "an empty project");
    await writeAdapterWarningAofProject(context);
    return;
  }

  if (step === "a project with .aof runtime override config") {
    await runSharedCliStep(context, "an empty project");
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
    await runSharedCliStep(context, "an empty project");
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
    await runSharedCliStep(context, "an empty project");
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

  if (step === "a project with .aof multiple codex rules config") {
    await runSharedCliStep(context, "an empty project");
    await writeAofProject(context, [
      {
        kind: "rule",
        id: "zeta",
        description: "Zeta",
        path: "assets/rules/zeta/RULE.md",
        bodyPath: "assets/rules/zeta/RULE.md",
        body: "Zeta guidance"
      },
      {
        kind: "rule",
        id: "alpha",
        description: "Alpha",
        path: "assets/rules/alpha/RULE.md",
        bodyPath: "assets/rules/alpha/RULE.md",
        body: "Alpha guidance"
      }
    ]);
    return;
  }

  if (step === "a project with .aof package config") {
    await runSharedCliStep(context, "an empty project");
    await writeAofProject(context, [{
      kind: "skill",
      id: "file-backed",
      description: "File backed",
      path: "assets/skills/file-backed/SKILL.md",
      bodyPath: "assets/skills/file-backed/SKILL.md",
      body: "File-backed body"
    }], {
      packages: [{ id: "gsd", namespace: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"] }]
    });
    return;
  }

  if (step === "a project with npm git and file package descriptors") {
    await runSharedCliStep(context, "an empty project");
    await writeAofProject(context, [], {
      packages: [
        {
          id: "npm-pack",
          namespace: "vendor",
          source: { type: "npm", package: "@vendor/npm-pack", version: "latest" },
          runtimes: ["codex"]
        },
        {
          id: "git-pack",
          namespace: "vendor",
          source: { type: "git", url: "https://example.test/vendor/git-pack.git", ref: "v1" },
          runtimes: ["codex"]
        },
        {
          id: "file-pack",
          namespace: "vendor",
          source: { type: "file", path: "../packs/file-pack" },
          runtimes: ["codex"],
          dependencies: [{ id: "git-pack", namespace: "vendor" }]
        }
      ]
    });
    return;
  }

  if (step === "a project with multi-runtime .aof package config") {
    await runSharedCliStep(context, "an empty project");
    await writeAofProject(context, [{
      kind: "skill",
      id: "file-backed",
      description: "File backed",
      path: "assets/skills/file-backed/SKILL.md",
      bodyPath: "assets/skills/file-backed/SKILL.md",
      body: "File-backed body"
    }], {
      packages: [{ id: "gsd", namespace: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["claude", "codex"] }]
    });
    return;
  }

  if (step === "a project with package resource collision") {
    await runSharedCliStep(context, "an empty project");
    await writeAofProject(context, [{
      kind: "skill",
      id: "vendor-context",
      description: "Local collision",
      path: "assets/skills/vendor-context/SKILL.md",
      bodyPath: "assets/skills/vendor-context/SKILL.md",
      body: "Local body"
    }], {
      packages: [{
        id: "assistant-pack",
        namespace: "vendor",
        source: "file:../packs/assistant-pack",
        runtimes: ["codex"],
        resources: [
          { kind: "skill", id: "context", body: "Package body" }
        ]
      }]
    });
    return;
  }

  if (step === "a project with .aof package config and stale legacy config") {
    await runSharedCliStep(context, "a project with .aof package config");
    await writeFile(path.join(context.projectDir, "aof.config.json"), "{}\n", "utf8");
    return;
  }

  if (step === "a project with invalid .aof config") {
    await runSharedCliStep(context, "an empty project");
    const workspaceDir = path.join(context.projectDir, ".aof");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      resources: [
        { kind: "skill", id: "bad", path: "missing.md", runtimes: ["other"] }
      ],
      packages: [
        { id: "other", source: "git:example", runtimes: [] }
      ]
    }, null, 2)}\n`, "utf8");
    return;
  }

  if (step === "the .aof config has no resources") {
    await writeFile(path.join(context.projectDir, ".aof", "aof.config.json"), `${JSON.stringify({
      $schema: "../schemas/aof.schema.json",
      name: "empty",
      resources: []
    }, null, 2)}\n`, "utf8");
    return;
  }

  let match = step.match(/^I run `(.+)` with input `([\s\S]*)`$/);
  if (match) {
    const input = match[2].includes("|") ? match[2].split("|").join("\n") : match[2];
    context.lastResult = await runCli(context, match[1], `${input}\n`);
    return;
  }

  match = step.match(/^I run `(.+)` with framework statuses `([\s\S]*)`$/);
  if (match) {
    context.lastResult = await runCli(context, match[1], "", { frameworkStatuses: match[2] });
    return;
  }

  match = step.match(/^I run `(.+)`$/);
  if (match) {
    context.lastResult = await runCli(context, match[1]);
    return;
  }

  match = step.match(/^I replace file `(.+)` with `([\s\S]+)`$/);
  if (match) {
    await writeFile(path.join(context.projectDir, match[1]), `${match[2]}\n`, "utf8");
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

  match = step.match(/^stdout should not contain `([\s\S]+)`$/);
  if (match) {
    assertLastResult(context);
    assert.doesNotMatch(context.lastResult.stdout, escapeRegex(match[1]), formatResult(context.lastResult));
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

  if (step === "a project with referenced global assets") {
    await runSharedCliStep(context, "an empty project");
    await writeGlobalAofResource(context, {
      kind: "skill",
      id: "shared-review",
      description: "Shared reviewer",
      body: "Global review body",
      override: { body: "Codex global override body" }
    });
    await writeGlobalAofResource(context, {
      kind: "rule",
      id: "team-standards",
      description: "Team standards",
      body: "Follow team standards"
    }, { append: true });
    await writeAofProject(context, [], {
      globalRefs: [
        { kind: "skill", id: "shared-review" },
        { kind: "rule", id: "team-standards" }
      ]
    });
    return;
  }

  if (step === "a project with referenced global skill helper files") {
    await runSharedCliStep(context, "an empty project");
    await writeGlobalAofResource(context, {
      kind: "skill",
      id: "research-helper",
      description: "Research helper",
      body: "Use the helper script.",
      files: [
        { path: "scripts/search.py", body: "print('search')\n" }
      ]
    });
    await writeAofProject(context, [], {
      globalRefs: [
        { kind: "skill", id: "research-helper" }
      ]
    });
    return;
  }

  if (step === "a project with unsafe global skill helper files") {
    await runSharedCliStep(context, "an empty project");
    await writeGlobalAofResource(context, {
      kind: "skill",
      id: "unsafe-helper",
      description: "Unsafe helper",
      body: "Unsafe helper.",
      files: [
        { path: "../escape.py", body: "print('escape')\n" }
      ]
    });
    await writeAofProject(context, [], {
      globalRefs: [
        { kind: "skill", id: "unsafe-helper" }
      ]
    });
    return;
  }

  if (step === "a project with a missing global reference") {
    await runSharedCliStep(context, "an empty project");
    await mkdir(context.globalDir, { recursive: true });
    await writeFile(path.join(context.globalDir, "aof.config.json"), `${JSON.stringify({
      $schema: "https://aof.local/schemas/aof.schema.json",
      name: "aof-global",
      resources: []
    }, null, 2)}\n`, "utf8");
    await writeAofProject(context, [], {
      globalRefs: [
        { kind: "skill", id: "missing-shared" }
      ]
    });
    return;
  }

  if (step === "a project with a local and global asset conflict") {
    await runSharedCliStep(context, "an empty project");
    await writeGlobalAofResource(context, {
      kind: "skill",
      id: "shared-review",
      description: "Shared reviewer",
      body: "Global review body"
    });
    await writeAofProject(context, [{
      kind: "skill",
      id: "shared-review",
      description: "Local reviewer",
      path: "assets/skills/shared-review/SKILL.md",
      bodyPath: "assets/skills/shared-review/SKILL.md",
      body: "Local review body"
    }], {
      globalRefs: [
        { kind: "skill", id: "shared-review" }
      ]
    });
    return;
  }

  if (step === "a malformed global AOF config") {
    await runSharedCliStep(context, "an empty project");
    await mkdir(context.globalDir, { recursive: true });
    await writeFile(path.join(context.globalDir, "aof.config.json"), "{ bad\n", "utf8");
    return;
  }

  match = step.match(/^global file `(.+)` should exist$/);
  if (match) {
    assert.equal(await fileExists(path.join(context.globalDir, match[1])), true, `Expected global file to exist: ${match[1]}`);
    return;
  }

  match = step.match(/^global file `(.+)` should contain `([\s\S]+)`$/);
  if (match) {
    const content = await readFile(path.join(context.globalDir, match[1]), "utf8");
    assert.match(content, escapeRegex(match[2]));
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
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      Array.isArray(json.items) && json.items.some((item) => item.id === match[2]),
      `Expected ${match[1]} to contain item ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should not contain item `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      !Array.isArray(json.items) || !json.items.some((item) => item.id === match[2]),
      `Expected ${match[1]} not to contain item ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should contain runtime `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      Array.isArray(json.runtimes) && json.runtimes.includes(match[2]),
      `Expected ${match[1]} to contain runtime ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should contain generated file `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      Array.isArray(json.files) && json.files.some((item) => normalizeFilePath(item.path) === normalizeFilePath(match[2])),
      `Expected ${match[1]} to contain generated file ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should contain global resource `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      Array.isArray(json.files) && json.files.some((item) => item.resource?.scope === "global" && item.resource?.id === match[2]),
      `Expected ${match[1]} to contain global resource ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should not contain generated file `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      !Array.isArray(json.files) || !json.files.some((item) => normalizeFilePath(item.path) === normalizeFilePath(match[2])),
      `Expected ${match[1]} not to contain generated file ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should contain framework `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      Array.isArray(json.frameworks) && json.frameworks.some((item) => item.id === match[2]),
      `Expected ${match[1]} to contain framework ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should contain package `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      Array.isArray(json.packages) && json.packages.some((item) => item.id === match[2]),
      `Expected ${match[1]} to contain package ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` package `(.+)` should record dependency `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    const pkg = Array.isArray(json.packages) ? json.packages.find((item) => item.id === match[2]) : null;
    assert.ok(pkg, `Expected ${match[1]} to contain package ${match[2]}`);
    assert.ok(
      Array.isArray(pkg.dependencies) && pkg.dependencies.some((dependency) => dependency === match[3] || dependency?.id === match[3]),
      `Expected package ${match[2]} to record dependency ${match[3]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` package `(.+)` should have resolution status `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    const pkg = Array.isArray(json.packages) ? json.packages.find((item) => item.id === match[2]) : null;
    assert.ok(pkg, `Expected ${match[1]} to contain package ${match[2]}`);
    assert.equal(pkg.resolution?.status, match[3], `Expected package ${match[2]} resolution status ${match[3]}`);
    return;
  }

  match = step.match(/^JSON file `(.+)` should not contain adapter warning `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.equal(
      JSON.stringify(json).includes(match[2]),
      false,
      `Expected ${match[1]} not to contain adapter warning ${match[2]}`
    );
    return;
  }

  match = step.match(/^JSON file `(.+)` should contain framework install attempt `(.+)` with status `(.+)`$/);
  if (match) {
    const json = JSON.parse(await readFile(path.join(context.projectDir, match[1]), "utf8"));
    assert.ok(
      Array.isArray(json.frameworkInstallAttempts) && json.frameworkInstallAttempts.some((item) => item.runtime === match[2] && item.status === match[3]),
      `Expected ${match[1]} to contain framework install attempt ${match[2]} with status ${match[3]}`
    );
    return;
  }

  match = step.match(/^text `(.+)` should appear before `(.+)` in file `(.+)`$/);
  if (match) {
    const content = await readFile(path.join(context.projectDir, match[3]), "utf8");
    const first = content.indexOf(match[1]);
    const second = content.indexOf(match[2]);
    assert.ok(first >= 0, `Expected ${match[3]} to contain ${match[1]}`);
    assert.ok(second >= 0, `Expected ${match[3]} to contain ${match[2]}`);
    assert.ok(first < second, `Expected ${match[1]} to appear before ${match[2]} in ${match[3]}`);
    return;
  }

  match = step.match(/^text `(.+)` should appear before `(.+)` in stdout$/);
  if (match) {
    assertLastResult(context);
    const first = context.lastResult.stdout.indexOf(match[1]);
    const second = context.lastResult.stdout.indexOf(match[2]);
    assert.ok(first >= 0, `Expected stdout to contain ${match[1]}`);
    assert.ok(second >= 0, `Expected stdout to contain ${match[2]}`);
    assert.ok(first < second, `Expected ${match[1]} to appear before ${match[2]} in stdout`);
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

async function writeAofProject(context, resourceInputs, options = {}) {
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
    resources,
    globalRefs: options.globalRefs ?? [],
    packages: options.packages ?? []
  }, null, 2)}\n`, "utf8");
}

async function writeGlobalAofResource(context, input, options = {}) {
  const plural = input.kind === "skill" ? "skills" : input.kind === "agent" ? "agents" : "rules";
  const bodyFile = input.kind === "skill" ? "SKILL.md" : input.kind === "agent" ? "AGENT.md" : "RULE.md";
  const resourcePath = path.join("assets", plural, input.id, bodyFile).replaceAll(path.sep, "/");
  const resourceDir = path.join(context.globalDir, "assets", plural, input.id);
  await mkdir(resourceDir, { recursive: true });
  await writeFile(path.join(resourceDir, bodyFile), `${input.body}\n`, "utf8");

  const resource = {
    kind: input.kind,
    id: input.id,
    description: input.description,
    path: resourcePath,
    runtimes: ["claude", "codex"]
  };

  if (input.override) {
    const overridePath = path.join("assets", plural, input.id, "overrides", "codex.json").replaceAll(path.sep, "/");
    await mkdir(path.join(resourceDir, "overrides"), { recursive: true });
    await writeFile(path.join(context.globalDir, overridePath), `${JSON.stringify(input.override, null, 2)}\n`, "utf8");
    resource.overrides = { codex: overridePath };
  }
  for (const file of input.files ?? []) {
    const associatedPath = path.join(resourceDir, file.path);
    await mkdir(path.dirname(associatedPath), { recursive: true });
    await writeFile(associatedPath, file.body ?? "", "utf8");
  }
  if (input.files) resource.files = input.files.map((file) => file.path);

  let resources = [];
  if (options.append && await fileExists(path.join(context.globalDir, "aof.config.json"))) {
    resources = JSON.parse(await readFile(path.join(context.globalDir, "aof.config.json"), "utf8")).resources ?? [];
  }
  resources.push(resource);

  await mkdir(context.globalDir, { recursive: true });
  await writeFile(path.join(context.globalDir, "aof.config.json"), `${JSON.stringify({
    $schema: "https://aof.local/schemas/aof.schema.json",
    name: "aof-global",
    resources
  }, null, 2)}\n`, "utf8");
}

async function writeExpandedAofProject(context) {
  const workspaceDir = path.join(context.projectDir, ".aof");
  await mkdir(path.join(workspaceDir, "assets", "docs", "partials"), { recursive: true });
  await writeFile(path.join(workspaceDir, "assets", "docs", "root.md"), "Root guidance\n{{include partials/shared.md}}\n", "utf8");
  await writeFile(path.join(workspaceDir, "assets", "docs", "partials", "shared.md"), "Included guidance\n", "utf8");
  await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
    $schema: "../schemas/aof.schema.json",
    name: "expanded",
    resources: [],
    mcpServers: [
      { id: "docs", transport: "http", url: "https://example.test/mcp" }
    ],
    hooks: [
      { id: "test-after-write", event: "PostToolUse", matcher: "Write", command: "npm test" }
    ],
    projectDocs: [
      { id: "root", path: "assets/docs/root.md", targets: ["AGENTS.md", "CLAUDE.md"] }
    ],
    settings: {
      claude: { permissions: { allow: ["Bash(npm test)"] } },
      codex: { model: "gpt-5.4", approval_policy: "on-request" }
    }
  }, null, 2)}\n`, "utf8");
}

async function writeAdapterWarningAofProject(context) {
  const workspaceDir = path.join(context.projectDir, ".aof");
  await mkdir(path.join(workspaceDir, "assets", "skills", "file-backed"), { recursive: true });
  await writeFile(path.join(workspaceDir, "assets", "skills", "file-backed", "SKILL.md"), "File-backed body\n", "utf8");
  await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
    $schema: "../schemas/aof.schema.json",
    name: "adapter-warning",
    resources: [
      {
        kind: "skill",
        id: "file-backed",
        path: "assets/skills/file-backed/SKILL.md",
        runtimes: ["codex"]
      }
    ],
    hooks: [
      {
        id: "notify",
        event: "PostToolUse",
        command: "npm test",
        timeout: 30,
        runtimes: ["codex"]
      }
    ]
  }, null, 2)}\n`, "utf8");
}
