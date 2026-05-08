import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { doctorConfig, inspectConfig, inspectGlobalConfig, validateConfig, validateGlobalConfig } from "../src/config-inspect.mjs";

export const configInspectTests = [
  {
    name: "inspects valid config with resources and packages",
    run: inspectsValidConfig
  },
  {
    name: "validates multiple semantic config errors",
    run: validatesSemanticErrors
  },
  {
    name: "doctor reports stale legacy config and package intent",
    run: doctorReportsHealth
  },
  {
    name: "reports malformed config JSON as structured diagnostic",
    run: reportsMalformedConfigJson
  },
  {
    name: "reports malformed runtime override JSON as structured diagnostic",
    run: reportsMalformedOverrideJson
  },
  {
    name: "tolerates extension fields while validating core fields",
    run: toleratesExtensionFields
  },
  {
    name: "inspection and doctor expose adapter warnings",
    run: exposesAdapterWarnings
  },
  {
    name: "validates global config from AOF_GLOBAL_HOME",
    run: validatesGlobalConfig
  },
  {
    name: "project validation does not scan unrelated malformed global drafts",
    run: projectValidationIgnoresUnreferencedGlobalDrafts
  },
  {
    name: "validates referenced global resources",
    run: validatesReferencedGlobalResources
  },
  {
    name: "reports missing and conflicting global references",
    run: reportsMissingAndConflictingGlobalReferences
  }
];

async function inspectsValidConfig() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    await writeProject(targetDir);
    const report = await inspectConfig(targetDir);
    assert.equal(report.name, "demo");
    assert.equal(report.resources[0].id, "context");
    assert.equal(report.packages[0].id, "gsd");
    assert.deepEqual(report.diagnostics, []);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function validatesSemanticErrors() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    await mkdir(path.join(targetDir, ".aof"), { recursive: true });
    await writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
      resources: [
        { kind: "unknown", id: "bad", path: "missing.md", runtimes: ["other"], overrides: { other: {} } }
      ],
      packages: [
        { id: "other", source: "git:example", runtimes: [] }
      ]
    }, null, 2)}\n`, "utf8");
    const diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.length >= 5);
    assert.ok(diagnostics.some((item) => item.path === "resources[0].kind"));
    assert.ok(diagnostics.some((item) => item.code === "missing-file"));
    assert.ok(diagnostics.some((item) => item.path === "packages[0].namespace"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function doctorReportsHealth() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    await writeProject(targetDir);
    await writeFile(path.join(targetDir, "aof.config.json"), "{}\n", "utf8");
    const report = await doctorConfig(targetDir, { runtimes: ["codex"] });
    assert.equal(report.legacyConfigIsStale, true);
    assert.ok(report.checks.some((item) => item.id === "legacy-config" && item.severity === "warning"));
    assert.ok(report.checks.some((item) => item.id === "package-intent" && item.severity === "info"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function reportsMalformedConfigJson() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    await mkdir(path.join(targetDir, ".aof"), { recursive: true });
    await writeFile(path.join(targetDir, ".aof", "aof.config.json"), "{ not json\n", "utf8");
    const diagnostics = await validateConfig(targetDir);
    assert.equal(diagnostics[0].path, "config");
    assert.equal(diagnostics[0].code, "malformed-json");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function reportsMalformedOverrideJson() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const workspaceDir = path.join(targetDir, ".aof");
    await mkdir(path.join(workspaceDir, "assets", "skills", "context", "overrides"), { recursive: true });
    await writeFile(path.join(workspaceDir, "assets", "skills", "context", "SKILL.md"), "Body\n", "utf8");
    await writeFile(path.join(workspaceDir, "assets", "skills", "context", "overrides", "codex.json"), "{ bad\n", "utf8");
    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        {
          kind: "skill",
          id: "context",
          path: "assets/skills/context/SKILL.md",
          overrides: { codex: "assets/skills/context/overrides/codex.json" }
        }
      ],
      packages: []
    }, null, 2)}\n`, "utf8");
    const diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.path === "resources[0].overrides.codex" && item.code === "malformed-json"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function toleratesExtensionFields() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const workspaceDir = path.join(targetDir, ".aof");
    await mkdir(path.join(workspaceDir, "assets", "skills", "context"), { recursive: true });
    await writeFile(path.join(workspaceDir, "assets", "skills", "context", "SKILL.md"), "Body\n", "utf8");
    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      "x-project": true,
      resources: [
        {
          kind: "skill",
          id: "context",
          path: "assets/skills/context/SKILL.md",
          "x-resource": { keep: true },
          overrides: {
            codex: { body: "Codex", "x-override": true }
          }
        }
      ],
      packages: [
        { id: "gsd", namespace: "gsd", source: "npm:get-shit-done-cc@latest", "x-package": true }
      ]
    }, null, 2)}\n`, "utf8");
    assert.deepEqual(await validateConfig(targetDir), []);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function exposesAdapterWarnings() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const workspaceDir = path.join(targetDir, ".aof");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [],
      hooks: [
        { id: "notify", event: "PostToolUse", command: "npm test", timeout: 30 }
      ]
    }, null, 2)}\n`, "utf8");

    const inspection = await inspectConfig(targetDir, { runtimes: ["codex"] });
    assert.equal(inspection.adapterWarnings.length, 1);
    assert.equal(inspection.adapterWarnings[0].code, "adapter.skipped-runtime-output");

    const report = await doctorConfig(targetDir, { runtimes: ["codex"] });
    assert.ok(report.checks.some((item) => item.id === "adapter-degradation" && item.severity === "warning"));
    assert.equal(report.adapterWarnings.length, 1);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function validatesGlobalConfig() {
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  try {
    process.env.AOF_GLOBAL_HOME = globalDir;
    await mkdir(path.join(globalDir, "assets", "skills", "context"), { recursive: true });
    await writeFile(path.join(globalDir, "assets", "skills", "context", "SKILL.md"), "Global body\n", "utf8");
    await writeFile(path.join(globalDir, "aof.config.json"), `${JSON.stringify({
      name: "aof-global",
      resources: [
        { kind: "skill", id: "context", path: "assets/skills/context/SKILL.md", runtimes: ["codex"] }
      ]
    }, null, 2)}\n`, "utf8");

    assert.deepEqual(await validateGlobalConfig(), []);
    const inspection = await inspectGlobalConfig();
    assert.equal(inspection.resources[0].id, "context");
  } finally {
    restoreEnv("AOF_GLOBAL_HOME", previousGlobalHome);
    await rm(globalDir, { recursive: true, force: true });
  }
}

async function projectValidationIgnoresUnreferencedGlobalDrafts() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  try {
    process.env.AOF_GLOBAL_HOME = globalDir;
    await writeProject(targetDir);
    await mkdir(globalDir, { recursive: true });
    await writeFile(path.join(globalDir, "aof.config.json"), "{ bad\n", "utf8");

    assert.deepEqual(await validateConfig(targetDir), []);
    const diagnostics = await validateGlobalConfig();
    assert.ok(diagnostics.some((item) => item.code === "malformed-json"));
  } finally {
    restoreEnv("AOF_GLOBAL_HOME", previousGlobalHome);
    await rm(targetDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
}

async function validatesReferencedGlobalResources() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  try {
    process.env.AOF_GLOBAL_HOME = globalDir;
    await writeGlobalResource(globalDir, { kind: "skill", id: "shared", body: "Global body" });
    await writeProjectWithGlobalRefs(targetDir, [{ kind: "skill", id: "shared" }]);

    assert.deepEqual(await validateConfig(targetDir), []);
    const inspection = await inspectConfig(targetDir, { runtimes: ["codex"] });
    assert.equal(inspection.globalRefs[0].id, "shared");
    assert.ok(inspection.resources.some((resource) => resource.id === "shared" && resource.source === "global"));
  } finally {
    restoreEnv("AOF_GLOBAL_HOME", previousGlobalHome);
    await rm(targetDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
}

async function reportsMissingAndConflictingGlobalReferences() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  try {
    process.env.AOF_GLOBAL_HOME = globalDir;
    await writeGlobalResource(globalDir, { kind: "skill", id: "shared", body: "Global body" });
    await writeProjectWithGlobalRefs(targetDir, [
      { kind: "skill", id: "shared" },
      { kind: "skill", id: "missing" },
      { kind: "skill", id: "missing" }
    ], {
      resources: [
        { kind: "skill", id: "shared", path: "assets/skills/shared/SKILL.md", body: "Local body" }
      ]
    });

    const diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "missing-global-resource"));
    assert.ok(diagnostics.some((item) => item.code === "local-global-conflict"));
    assert.ok(diagnostics.some((item) => item.path === "globalRefs[2].id"));
  } finally {
    restoreEnv("AOF_GLOBAL_HOME", previousGlobalHome);
    await rm(targetDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
}

async function writeProject(targetDir) {
  const workspaceDir = path.join(targetDir, ".aof");
  await mkdir(path.join(workspaceDir, "assets", "skills", "context"), { recursive: true });
  await writeFile(path.join(workspaceDir, "assets", "skills", "context", "SKILL.md"), "Body\n", "utf8");
  await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
    name: "demo",
    resources: [
      { kind: "skill", id: "context", path: "assets/skills/context/SKILL.md", runtimes: ["codex"] }
    ],
    packages: [
      { id: "gsd", namespace: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"] }
    ]
  }, null, 2)}\n`, "utf8");
}

async function writeProjectWithGlobalRefs(targetDir, globalRefs, options = {}) {
  const workspaceDir = path.join(targetDir, ".aof");
  await mkdir(workspaceDir, { recursive: true });
  const resources = [];
  for (const resource of options.resources ?? []) {
    const resourcePath = path.join(workspaceDir, resource.path);
    await mkdir(path.dirname(resourcePath), { recursive: true });
    await writeFile(resourcePath, `${resource.body}\n`, "utf8");
    resources.push({
      kind: resource.kind,
      id: resource.id,
      path: resource.path,
      runtimes: ["codex"]
    });
  }
  await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
    name: "demo",
    resources,
    globalRefs
  }, null, 2)}\n`, "utf8");
}

async function writeGlobalResource(globalDir, input) {
  const plural = input.kind === "skill" ? "skills" : input.kind === "agent" ? "agents" : "rules";
  const bodyFile = input.kind === "skill" ? "SKILL.md" : input.kind === "agent" ? "AGENT.md" : "RULE.md";
  const resourceDir = path.join(globalDir, "assets", plural, input.id);
  await mkdir(resourceDir, { recursive: true });
  await writeFile(path.join(resourceDir, bodyFile), `${input.body}\n`, "utf8");
  await writeFile(path.join(globalDir, "aof.config.json"), `${JSON.stringify({
    name: "aof-global",
    resources: [
      { kind: input.kind, id: input.id, path: `assets/${plural}/${input.id}/${bodyFile}`, runtimes: ["codex"] }
    ]
  }, null, 2)}\n`, "utf8");
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
