import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "../src/dsl.mjs";
import { hashContent, readLock, writeLock } from "../src/lock.mjs";
import { createLockManifest, createRenderPlan, executeApplyActions, planApplyActions } from "../src/render-plan.mjs";

export const renderPlanTests = [
  {
    name: "hashes content and roundtrips lock manifests",
    run: hashesContentAndRoundtripsLock
  },
  {
    name: "plans create update delete and drift actions",
    run: plansCreateUpdateDeleteAndDrift
  },
  {
    name: "merges codex rules targeting the same AGENTS file deterministically",
    run: mergesCodexRulesDeterministically
  },
  {
    name: "creates lock manifest with generated files and framework intent",
    run: createsLockManifest
  },
  {
    name: "preserves drifted lock entries in lock manifest",
    run: preservesDriftedLockEntries
  },
  {
    name: "overwrites drifted generated files when force is enabled",
    run: forceOverwritesDrift
  },
  {
    name: "renders selective golden outputs for codex agents and claude rules",
    run: rendersSelectiveGoldenOutputs
  },
  {
    name: "tracks expanded DSL root outputs through lock drift protection",
    run: tracksExpandedDslRootOutputDrift
  },
  {
    name: "renders package resources with namespace ownership",
    run: rendersPackageResourcesWithNamespace
  },
  {
    name: "fails package and local output path conflicts before writes",
    run: failsPackageLocalOutputConflicts
  },
  {
    name: "renders associated skill files with lock ownership",
    run: rendersAssociatedSkillFiles
  },
  {
    name: "protects drifted associated skill files",
    run: protectsDriftedAssociatedSkillFiles
  }
];

async function hashesContentAndRoundtripsLock() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const lockPath = path.join(targetDir, ".aof", "aof.lock.json");
    assert.equal(hashContent("same"), hashContent("same"));
    assert.equal(await readLock(lockPath), null);

    await writeLock(lockPath, {
      version: 2,
      files: [{ path: ".codex/AGENTS.md", hash: hashContent("body") }],
      frameworks: []
    });

    const lock = await readLock(lockPath);
    assert.equal(lock.version, 2);
    assert.equal(lock.files[0].path, ".codex/AGENTS.md");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function plansCreateUpdateDeleteAndDrift() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "skill", id: "context", body: "New body." }
      ]
    });
    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    let actions = await planApplyActions(desired, null, { targetDir });
    assert.equal(actions[0].action, "create");

    await executeApplyActions(actions);
    const prior = createLockManifest({ actions, desiredOutputs: desired, config, runtimes: ["codex"] });
    actions = await planApplyActions(desired, prior, { targetDir });
    assert.equal(actions[0].action, "skip");

    const changedConfig = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "skill", id: "context", body: "Changed body." }
      ]
    });
    const changedDesired = await createRenderPlan(changedConfig, { targetDir, runtimes: ["codex"] });
    actions = await planApplyActions(changedDesired, prior, { targetDir });
    assert.equal(actions[0].action, "update");

    await writeFile(desired[0].absolutePath, "Manual edit.\n", "utf8");
    actions = await planApplyActions(changedDesired, prior, { targetDir });
    assert.equal(actions[0].action, "drift-warning");

    const removedDesired = [];
    actions = await planApplyActions(removedDesired, prior, { targetDir });
    assert.equal(actions[0].action, "drift-warning");

    await writeFile(desired[0].absolutePath, desired[0].content, "utf8");
    actions = await planApplyActions(removedDesired, prior, { targetDir });
    assert.equal(actions[0].action, "delete");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function mergesCodexRulesDeterministically() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "rule", id: "zeta", body: "Z body." },
        { kind: "rule", id: "alpha", body: "A body." }
      ]
    });

    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    assert.equal(desired.length, 1);
    assert.equal(path.relative(targetDir, desired[0].absolutePath), path.join(".codex", "AGENTS.md"));
    assert.ok(desired[0].content.indexOf("## alpha") < desired[0].content.indexOf("## zeta"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function createsLockManifest() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [{ kind: "skill", id: "context", body: "Body." }],
      packages: [{ id: "gsd", namespace: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"] }]
    });
    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    const actions = await planApplyActions(desired, null, { targetDir });
    const manifest = createLockManifest({ actions, desiredOutputs: desired, config, runtimes: ["codex"] });

    assert.equal(manifest.version, 2);
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].resource.id, "context");
    assert.equal(manifest.packages[0].id, "gsd");
    assert.equal(manifest.packages[0].namespace, "gsd");
    assert.equal(manifest.packages[0].sourceDescriptor.type, "npm");
    assert.equal(manifest.packages[0].resolution.status, "requested");
    assert.equal(manifest.frameworks[0].id, "gsd");
    assert.equal(manifest.frameworks[0].namespace, "gsd");
    assert.deepEqual(manifest.frameworks[0].runtimes, ["codex"]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function preservesDriftedLockEntries() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [{ kind: "skill", id: "context", body: "Body." }]
    });
    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    let actions = await planApplyActions(desired, null, { targetDir });
    await executeApplyActions(actions);
    const prior = createLockManifest({ actions, desiredOutputs: desired, config, runtimes: ["codex"] });
    await writeFile(desired[0].absolutePath, "Manual edit.\n", "utf8");
    actions = await planApplyActions(desired, prior, { targetDir });
    const manifest = createLockManifest({ actions, desiredOutputs: desired, previousLock: prior, config, runtimes: ["codex"] });
    assert.equal(actions[0].action, "drift-warning");
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].hash, prior.files[0].hash);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function forceOverwritesDrift() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [{ kind: "skill", id: "context", body: "Body." }]
    });
    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    let actions = await planApplyActions(desired, null, { targetDir });
    await executeApplyActions(actions);
    const prior = createLockManifest({ actions, desiredOutputs: desired, config, runtimes: ["codex"] });
    await writeFile(desired[0].absolutePath, "Manual edit.\n", "utf8");
    actions = await planApplyActions(desired, prior, { targetDir, force: true });
    assert.equal(actions[0].action, "update");
    assert.match(actions[0].reason, /--force/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rendersSelectiveGoldenOutputs() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "rule", id: "alpha", name: "Alpha", description: "First", body: "Alpha guidance." },
        { kind: "rule", id: "beta", name: "Beta", description: "Second", body: "Beta guidance." }
      ]
    });
    const desired = await createRenderPlan(config, { targetDir, runtimes: ["claude", "codex"] });
    const codexAgents = desired.find((item) => item.path.endsWith("AGENTS.md"));
    assert.ok(codexAgents);
    assert.match(codexAgents.content, /^# AOF Generated Guidance/);
    assert.match(codexAgents.content, /<!-- Generated by AOF/);
    assert.ok(codexAgents.content.indexOf("## Alpha") < codexAgents.content.indexOf("## Beta"));

    const claudeRule = desired.find((item) => item.path.endsWith(path.join(".claude", "rules", "alpha.md")));
    assert.ok(claudeRule);
    assert.match(claudeRule.content, /aof-generated: true/);
    assert.match(claudeRule.content, /aof-runtime: claude/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function tracksExpandedDslRootOutputDrift() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [],
      projectDocs: [
        { id: "root", targets: ["AGENTS.md"], runtimes: ["codex"], body: "Generated root guidance." }
      ]
    });

    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    assert.equal(desired.length, 1);
    assert.equal(desired[0].path, "AGENTS.md");
    assert.equal(desired[0].resource.kind, "project-doc");

    let actions = await planApplyActions(desired, null, { targetDir });
    assert.equal(actions[0].action, "create");
    await executeApplyActions(actions);

    const prior = createLockManifest({ actions, desiredOutputs: desired, config, runtimes: ["codex"] });
    assert.equal(prior.files[0].path, "AGENTS.md");

    await writeFile(path.join(targetDir, "AGENTS.md"), "Manual edit.\n", "utf8");
    actions = await planApplyActions(desired, prior, { targetDir });
    assert.equal(actions[0].action, "drift-warning");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rendersPackageResourcesWithNamespace() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [],
      packages: [
        {
          id: "assistant-pack",
          namespace: "vendor",
          source: "file:../packs/assistant-pack",
          runtimes: ["codex"],
          resources: [
            { kind: "skill", id: "context", body: "Package body." }
          ]
        }
      ]
    });

    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    assert.equal(desired.length, 1);
    assert.equal(desired[0].path, path.join(".codex", "skills", "vendor-context", "SKILL.md"));
    assert.equal(desired[0].resource.package.id, "assistant-pack");
    assert.equal(desired[0].resource.package.namespace, "vendor");
    assert.equal(desired[0].resource.originalId, "context");

    const manifest = createLockManifest({
      actions: await planApplyActions(desired, null, { targetDir }),
      desiredOutputs: desired,
      config,
      runtimes: ["codex"]
    });
    assert.equal(manifest.files[0].resource.package.namespace, "vendor");
    assert.equal(manifest.packages[0].sourceDescriptor.type, "file");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function failsPackageLocalOutputConflicts() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "skill", id: "vendor-context", body: "Local body." }
      ],
      packages: [
        {
          id: "assistant-pack",
          namespace: "vendor",
          source: "file:../packs/assistant-pack",
          runtimes: ["codex"],
          resources: [
            { kind: "skill", id: "context", body: "Package body." }
          ]
        }
      ]
    });

    await assert.rejects(
      () => createRenderPlan(config, { targetDir, runtimes: ["codex"] }),
      /Generated output conflict at .*local:skill:vendor-context.*package:vendor\/assistant-pack:skill:context/
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rendersAssociatedSkillFiles() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const assetDir = path.join(targetDir, ".aof", "assets", "skills", "context");
    await mkdir(path.join(assetDir, "scripts"), { recursive: true });
    await writeFile(path.join(assetDir, "SKILL.md"), "Skill body.\n", "utf8");
    await writeFile(path.join(assetDir, "scripts", "helper.py"), "print('helper')\n", "utf8");

    const config = await resolveConfig({
      name: "demo",
      resources: [
        {
          kind: "skill",
          id: "context",
          path: path.join(".aof", "assets", "skills", "context", "SKILL.md"),
          files: ["scripts/helper.py"],
          runtimes: ["codex"]
        }
      ]
    }, targetDir);

    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    const helper = desired.find((item) => item.path === path.join(".codex", "skills", "context", "scripts", "helper.py"));
    assert.ok(helper);
    assert.equal(helper.content, "print('helper')\n");
    assert.equal(helper.resource.artifact, "associated-file");
    assert.equal(helper.resource.file, "scripts/helper.py");

    const actions = await planApplyActions(desired, null, { targetDir });
    assert.ok(actions.some((item) => item.path === helper.path && item.action === "create"));
    const manifest = createLockManifest({ actions, desiredOutputs: desired, config, runtimes: ["codex"] });
    assert.ok(manifest.files.some((item) => item.path === helper.path && item.resource.artifact === "associated-file"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function protectsDriftedAssociatedSkillFiles() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const assetDir = path.join(targetDir, ".aof", "assets", "skills", "context");
    await mkdir(path.join(assetDir, "scripts"), { recursive: true });
    await writeFile(path.join(assetDir, "SKILL.md"), "Skill body.\n", "utf8");
    await writeFile(path.join(assetDir, "scripts", "helper.py"), "print('helper')\n", "utf8");

    const config = await resolveConfig({
      name: "demo",
      resources: [
        {
          kind: "skill",
          id: "context",
          path: path.join(".aof", "assets", "skills", "context", "SKILL.md"),
          files: ["scripts/helper.py"],
          runtimes: ["codex"]
        }
      ]
    }, targetDir);
    const desired = await createRenderPlan(config, { targetDir, runtimes: ["codex"] });
    const actions = await planApplyActions(desired, null, { targetDir });
    await executeApplyActions(actions);
    const prior = createLockManifest({ actions, desiredOutputs: desired, config, runtimes: ["codex"] });
    const helper = desired.find((item) => item.resource.artifact === "associated-file");
    await writeFile(helper.absolutePath, "manual edit\n", "utf8");

    const nextActions = await planApplyActions(desired, prior, { targetDir });
    assert.ok(nextActions.some((item) => item.path === helper.path && item.action === "drift-warning"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}
