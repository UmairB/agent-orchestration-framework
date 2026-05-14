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
    name: "validates runtime capability contract for commands",
    run: validatesRuntimeCapabilityContractForCommands
  },
  {
    name: "validates simple asset argument markers",
    run: validatesSimpleAssetArgumentMarkers
  },
  {
    name: "validates workflow declarations",
    run: validatesWorkflowDeclarations
  },
  {
    name: "validates workflow backed resources",
    run: validatesWorkflowBackedResources
  },
  {
    name: "validates asset reference placeholders",
    run: validatesAssetReferencePlaceholders
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
    name: "validates referenced global workflows",
    run: validatesReferencedGlobalWorkflows
  },
  {
    name: "reports missing and conflicting global references",
    run: reportsMissingAndConflictingGlobalReferences
  },
  {
    name: "validates associated files on referenced global skills",
    run: validatesAssociatedFilesOnReferencedGlobalSkills
  },
  {
    name: "validates associated file runtime references",
    run: validatesAssociatedFileRuntimeReferences
  },
  {
    name: "reports unsafe associated file declarations",
    run: reportsUnsafeAssociatedFileDeclarations
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

async function validatesRuntimeCapabilityContractForCommands() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    await mkdir(path.join(targetDir, ".aof", "assets", "commands", "ci"), { recursive: true });
    await mkdir(path.join(targetDir, ".aof", "assets", "skills", "ci"), { recursive: true });
    await writeFile(path.join(targetDir, ".aof", "assets", "commands", "ci", "COMMAND.md"), "Run CI\n", "utf8");
    await writeFile(path.join(targetDir, ".aof", "assets", "skills", "ci", "SKILL.md"), "Run CI\n", "utf8");

    await writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        { kind: "command", id: "ci", path: "assets/commands/ci/COMMAND.md", runtimes: ["codex"] }
      ]
    }, null, 2)}\n`, "utf8");
    let diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "unsupported-runtime-capability" && item.message.includes("Command assets are not supported for Codex")));

    await writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        { kind: "command", id: "ci", path: "assets/commands/ci/COMMAND.md" }
      ]
    }, null, 2)}\n`, "utf8");
    diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "unsupported-runtime-capability"));

    await writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        { kind: "command", id: "ci", path: "assets/commands/ci/COMMAND.md", runtimes: ["claude"] },
        { kind: "skill", id: "ci", path: "assets/skills/ci/SKILL.md", runtimes: ["codex"] }
      ]
    }, null, 2)}\n`, "utf8");
    assert.deepEqual(await validateConfig(targetDir), []);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function validatesSimpleAssetArgumentMarkers() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const workspaceDir = path.join(targetDir, ".aof");
    await mkdir(path.join(workspaceDir, "assets", "skills", "args", "overrides"), { recursive: true });
    await writeFile(path.join(workspaceDir, "assets", "skills", "args", "SKILL.md"), "Use $ARGUMENTS here.\n", "utf8");
    await writeFile(path.join(workspaceDir, "assets", "skills", "args", "overrides", "codex.json"), `${JSON.stringify({ body: "Use {{args.phase}} here." })}\n`, "utf8");
    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        {
          kind: "skill",
          id: "args",
          path: "assets/skills/args/SKILL.md",
          runtimes: ["codex"],
          arguments: [{ name: "phase" }],
          overrides: { codex: "assets/skills/args/overrides/codex.json" }
        },
        {
          kind: "agent",
          id: "inline",
          body: "Use {{GSD_ARGS}} here.",
          runtimes: ["codex"]
        }
      ]
    }, null, 2)}\n`, "utf8");

    const diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.path === "resources[0].arguments" && item.code === "simple-asset-arguments"));
    assert.ok(diagnostics.some((item) => item.path === "resources[0].path" && item.code === "simple-asset-arguments"));
    assert.ok(diagnostics.some((item) => item.path === "resources[0].overrides.codex" && item.code === "simple-asset-arguments"));
    assert.ok(diagnostics.some((item) => item.path === "resources[1].body" && item.code === "simple-asset-arguments"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function validatesWorkflowDeclarations() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const workspaceDir = path.join(targetDir, ".aof");
    await mkdir(path.join(workspaceDir, "assets", "workflows", "audit"), { recursive: true });
    await writeFile(path.join(workspaceDir, "assets", "workflows", "audit", "WORKFLOW.md"), "Workflow body\n", "utf8");

    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      workflows: [
        {
          id: "audit",
          path: "assets/workflows/audit/WORKFLOW.md",
          argumentHint: "<milestone>",
          arguments: [{ name: "milestone", description: "Milestone number", required: true }]
        }
      ],
      resources: [
        { kind: "skill", id: "audit", workflow: "audit", runtimes: ["codex"] }
      ]
    }, null, 2)}\n`, "utf8");

    assert.deepEqual(await validateConfig(targetDir), []);
    const inspection = await inspectConfig(targetDir, { runtimes: ["codex"] });
    assert.equal(inspection.workflows[0].id, "audit");

    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      workflows: [
        { id: "audit", path: "assets/workflows/audit/missing.md" },
        { id: "audit", body: "Duplicate", arguments: [{ name: "bad name" }] }
      ],
      resources: []
    }, null, 2)}\n`, "utf8");
    const diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "missing-workflow-file"));
    assert.ok(diagnostics.some((item) => item.path === "workflows[1].arguments[0].name" && item.code === "invalid-workflow-argument"));
    assert.ok(diagnostics.some((item) => item.path === "workflows[1].id" && item.message.includes("Duplicate workflows id")));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function validatesWorkflowBackedResources() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const workspaceDir = path.join(targetDir, ".aof");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      workflows: [
        {
          id: "audit",
          body: "Workflow body",
          runtimes: ["codex"],
          arguments: [{ name: "milestone" }]
        }
      ],
      resources: [
        { kind: "skill", id: "good", workflow: "audit", runtimes: ["codex"], argumentOverrides: { milestone: { description: "Milestone id" } } },
        { kind: "skill", id: "missing", workflow: "missing", runtimes: ["codex"] },
        { kind: "command", id: "wrong-runtime", workflow: "audit", runtimes: ["claude"] },
        { kind: "skill", id: "bad-arg", workflow: "audit", runtimes: ["codex"], argumentOverrides: { phase: { description: "Phase" } } },
        { kind: "skill", id: "simple-override", body: "Body", runtimes: ["codex"], argumentOverrides: { phase: {} } }
      ]
    }, null, 2)}\n`, "utf8");

    const diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.path === "resources[1].workflow" && item.code === "missing-workflow"));
    assert.ok(diagnostics.some((item) => item.path === "resources[2].workflow" && item.code === "workflow-runtime-mismatch"));
    assert.ok(diagnostics.some((item) => item.path === "resources[3].argumentOverrides.phase" && item.code === "invalid-workflow-argument"));
    assert.ok(diagnostics.some((item) => item.path === "resources[4].argumentOverrides" && item.code === "invalid-workflow-argument"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function validatesAssetReferencePlaceholders() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  try {
    process.env.AOF_GLOBAL_HOME = globalDir;
    const workspaceDir = path.join(targetDir, ".aof");
    await mkdir(workspaceDir, { recursive: true });

    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      workflows: [
        { id: "audit", body: "Audit with {{skills.ci}}.", runtimes: ["codex"] }
      ],
      resources: [
        { kind: "skill", id: "ci", body: "Run CI.", runtimes: ["codex"] },
        { kind: "skill", id: "review", body: "Use {{skills.ci}} and {{ workflows.audit }}.", runtimes: ["codex"] }
      ]
    }, null, 2)}\n`, "utf8");
    assert.deepEqual(await validateConfig(targetDir), []);

    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        { kind: "skill", id: "review", body: "Use {{commands.ci}}, {{skill.ci}}, and {{skills.missing}}.", runtimes: ["codex"] }
      ]
    }, null, 2)}\n`, "utf8");
    let diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "invalid-asset-reference" && item.message.includes("commands")));
    assert.ok(diagnostics.some((item) => item.code === "invalid-asset-reference" && item.message.includes("skill")));
    assert.ok(diagnostics.some((item) => item.code === "missing-asset-reference" && item.message.includes("{{skills.missing}}")));

    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        { kind: "skill", id: "ci", body: "Run CI.", runtimes: ["claude"] },
        { kind: "skill", id: "review", body: "Use {{skills.ci}}.", runtimes: ["codex"] }
      ]
    }, null, 2)}\n`, "utf8");
    diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "asset-reference-runtime-mismatch" && item.message.includes("codex")));

    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        { kind: "skill", id: "ci", body: "Run CI.", runtimes: ["codex"] },
        {
          kind: "skill",
          id: "review",
          body: "Shared body.",
          runtimes: ["claude", "codex"],
          overrides: { codex: { body: "Use {{skills.ci}}." } }
        }
      ]
    }, null, 2)}\n`, "utf8");
    assert.deepEqual(await validateConfig(targetDir), []);

    await writeGlobalResource(globalDir, {
      kind: "skill",
      id: "shared",
      body: "Global uses {{skills.local-ci}} and {{workflows.local-audit}}.",
      runtimes: ["codex"]
    });
    await writeProjectWithGlobalRefs(targetDir, [{ kind: "skill", id: "shared" }], {
      resources: [
        { kind: "skill", id: "local-ci", path: "assets/skills/local-ci/SKILL.md", body: "Local CI" }
      ],
      workflows: [
        { id: "local-audit", body: "Local audit", runtimes: ["codex"] }
      ]
    });
    assert.deepEqual(await validateConfig(targetDir), []);
  } finally {
    restoreEnv("AOF_GLOBAL_HOME", previousGlobalHome);
    await rm(targetDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
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

async function validatesReferencedGlobalWorkflows() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  try {
    process.env.AOF_GLOBAL_HOME = globalDir;
    await writeGlobalWorkflow(globalDir, { id: "audit", body: "Global workflow", runtimes: ["codex"] });
    await writeProjectWithGlobalRefs(targetDir, [{ kind: "workflow", id: "audit" }], {
      resources: [
        { kind: "skill", id: "audit", path: "assets/skills/audit/SKILL.md", body: "Local body" }
      ]
    });
    let diagnostics = await validateConfig(targetDir);
    assert.deepEqual(diagnostics, []);

    const inspection = await inspectConfig(targetDir, { runtimes: ["codex"] });
    assert.ok(inspection.workflows.some((workflow) => workflow.id === "audit" && workflow.source === "global"));

    await writeProjectWithGlobalRefs(targetDir, [{ kind: "workflow", id: "missing" }]);
    diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "missing-global-workflow"));

    await writeProjectWithGlobalRefs(targetDir, [{ kind: "workflow", id: "audit" }], {
      workflows: [{ id: "audit", body: "Local workflow" }]
    });
    diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "local-global-conflict"));
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

async function validatesAssociatedFilesOnReferencedGlobalSkills() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  try {
    process.env.AOF_GLOBAL_HOME = globalDir;
    await writeGlobalResource(globalDir, {
      kind: "skill",
      id: "shared",
      body: "Global body",
      files: [{ path: "search.py", body: "print('search')\n" }]
    });
    await writeProjectWithGlobalRefs(targetDir, [{ kind: "skill", id: "shared" }]);

    assert.deepEqual(await validateConfig(targetDir), []);
    assert.deepEqual(await validateGlobalConfig(), []);
  } finally {
    restoreEnv("AOF_GLOBAL_HOME", previousGlobalHome);
    await rm(targetDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }
}

async function validatesAssociatedFileRuntimeReferences() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const commandDir = path.join(targetDir, ".aof", "assets", "commands", "convert-files");
    const skillDir = path.join(targetDir, ".aof", "assets", "skills", "research");
    await mkdir(path.join(commandDir, "files"), { recursive: true });
    await mkdir(path.join(skillDir, "files"), { recursive: true });
    await writeFile(path.join(commandDir, "files", "run.ps1"), "Write-Output convert\n", "utf8");
    await writeFile(path.join(commandDir, "files", "run.sh"), "echo convert\n", "utf8");
    await writeFile(path.join(skillDir, "files", "search.py"), "print('search')\n", "utf8");
    await writeFile(path.join(commandDir, "COMMAND.md"), [
      "On Windows:",
      "pwsh -File .claude/commands/run.ps1",
      ""
    ].join("\n"), "utf8");
    await writeFile(path.join(skillDir, "SKILL.md"), [
      "Use `.codex/skills/research/search.py` for local searches.",
      ""
    ].join("\n"), "utf8");
    await writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [
        {
          kind: "command",
          id: "convert-files",
          path: "assets/commands/convert-files/COMMAND.md",
          files: ["run.ps1", "run.sh"],
          runtimes: ["claude"]
        },
        {
          kind: "skill",
          id: "research",
          path: "assets/skills/research/SKILL.md",
          files: ["search.py"],
          runtimes: ["codex"]
        }
      ]
    }, null, 2)}\n`, "utf8");

    assert.deepEqual(await validateConfig(targetDir), []);

    await writeFile(path.join(commandDir, "COMMAND.md"), "Run {{files.scripts/run.py}}\n", "utf8");
    let diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "invalid-associated-file-reference" && item.message.includes("not a nested path")));

    await writeFile(path.join(commandDir, "COMMAND.md"), "pwsh -File .claude/commands/missing.ps1\n", "utf8");
    await writeFile(path.join(skillDir, "SKILL.md"), "Use `.codex/skills/research/missing.py`.\n", "utf8");
    diagnostics = await validateConfig(targetDir);
    assert.equal(diagnostics.filter((item) => item.code === "invalid-associated-file-reference").length, 2);
    assert.ok(diagnostics.some((item) => item.message.includes(".claude/commands/missing.ps1")));
    assert.ok(diagnostics.some((item) => item.message.includes(".codex/skills/research/missing.py")));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function reportsUnsafeAssociatedFileDeclarations() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  const globalDir = await mkdtemp(path.join(os.tmpdir(), "aof-global-"));
  const previousGlobalHome = process.env.AOF_GLOBAL_HOME;
  try {
    process.env.AOF_GLOBAL_HOME = globalDir;
    await writeProjectWithGlobalRefs(targetDir, [{ kind: "skill", id: "unsafe" }]);
    await writeGlobalResource(globalDir, {
      kind: "skill",
      id: "unsafe",
      body: "Global body",
      files: [
        { path: "../escape.py", body: "print('escape')\n" },
        { path: "missing.py" },
        { path: "dir", directory: true },
        { path: "SKILL.md" }
      ]
    });

    const diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.code === "associated-file-escape"));
    assert.ok(diagnostics.some((item) => item.code === "missing-associated-file"));
    assert.ok(diagnostics.some((item) => item.code === "associated-file-not-file"));
    assert.ok(diagnostics.some((item) => item.code === "associated-file-body"));

    await writeGlobalResource(globalDir, {
      kind: "command",
      id: "command-helper",
      body: "Command body",
      files: [{ path: "helper.py", body: "print('command')\n" }],
      runtimes: ["claude"]
    });
    assert.deepEqual(await validateGlobalConfig(), []);

    await writeGlobalResource(globalDir, {
      kind: "agent",
      id: "agent-helper",
      body: "Agent body",
      files: [{ path: "helper.py", body: "print('agent')\n" }]
    });
    const kindDiagnostics = await validateGlobalConfig();
    assert.ok(kindDiagnostics.some((item) => item.code === "unsupported-associated-files"));

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
  const workflows = [];
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
  for (const workflow of options.workflows ?? []) {
    workflows.push({
      id: workflow.id,
      body: workflow.body,
      runtimes: workflow.runtimes ?? ["codex"]
    });
  }
  await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
    name: "demo",
    resources,
    workflows,
    globalRefs
  }, null, 2)}\n`, "utf8");
}

async function writeGlobalResource(globalDir, input) {
  const plural = input.kind === "skill" ? "skills" : input.kind === "command" ? "commands" : input.kind === "agent" ? "agents" : "rules";
  const bodyFile = input.kind === "skill" ? "SKILL.md" : input.kind === "command" ? "COMMAND.md" : input.kind === "agent" ? "AGENT.md" : "RULE.md";
  const resourceDir = path.join(globalDir, "assets", plural, input.id);
  await mkdir(resourceDir, { recursive: true });
  await writeFile(path.join(resourceDir, bodyFile), `${input.body}\n`, "utf8");
  for (const file of input.files ?? []) {
    const filePath = path.join(resourceDir, "files", file.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    if (file.directory) {
      await mkdir(filePath, { recursive: true });
    } else if (file.body !== undefined) {
      await writeFile(filePath, file.body, "utf8");
    }
  }
  await writeFile(path.join(globalDir, "aof.config.json"), `${JSON.stringify({
    name: "aof-global",
    resources: [
      {
        kind: input.kind,
        id: input.id,
        path: `assets/${plural}/${input.id}/${bodyFile}`,
        files: (input.files ?? []).map((file) => file.path),
        runtimes: input.runtimes ?? ["codex"]
      }
    ]
  }, null, 2)}\n`, "utf8");
}

async function writeGlobalWorkflow(globalDir, input) {
  const workflowDir = path.join(globalDir, "assets", "workflows", input.id);
  await mkdir(workflowDir, { recursive: true });
  await writeFile(path.join(workflowDir, "WORKFLOW.md"), `${input.body}\n`, "utf8");
  await writeFile(path.join(globalDir, "aof.config.json"), `${JSON.stringify({
    name: "aof-global",
    workflows: [
      {
        id: input.id,
        path: `assets/workflows/${input.id}/WORKFLOW.md`,
        runtimes: input.runtimes ?? ["codex"]
      }
    ],
    resources: []
  }, null, 2)}\n`, "utf8");
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
