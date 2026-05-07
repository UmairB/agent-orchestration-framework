import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCleanPlan, executeCleanPlan } from "../src/clean.mjs";
import { hashContent, writeLock } from "../src/lock.mjs";

export const cleanTests = [
  {
    name: "plans clean actions and removes matching lock entries",
    run: plansCleanActions
  },
  {
    name: "preserves drifted generated files and framework lock data",
    run: preservesDriftedFiles
  }
];

async function plansCleanActions() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-clean-"));
  try {
    const generatedPath = ".codex/skills/context/SKILL.md";
    const absolutePath = path.join(targetDir, generatedPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "Body\n", "utf8");
    await writeLock(path.join(targetDir, ".aof", "aof.lock.json"), {
      version: 2,
      files: [{ path: generatedPath, hash: hashContent("Body\n"), runtime: "codex", resource: { kind: "skill", id: "context" } }],
      frameworks: [{ id: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"] }],
      frameworkInstallAttempts: []
    });

    const plan = await createCleanPlan(targetDir);
    assert.equal(plan.actions[0].action, "delete");
    assert.equal(plan.removedCount, 1);
    await executeCleanPlan(plan);

    const lock = JSON.parse(await readFile(path.join(targetDir, ".aof", "aof.lock.json"), "utf8"));
    assert.deepEqual(lock.files, []);
    assert.equal(lock.frameworks[0].id, "gsd");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function preservesDriftedFiles() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-clean-"));
  try {
    const generatedPath = ".codex/skills/context/SKILL.md";
    const absolutePath = path.join(targetDir, generatedPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "Manual edit\n", "utf8");
    await writeLock(path.join(targetDir, ".aof", "aof.lock.json"), {
      version: 2,
      files: [{ path: generatedPath, hash: hashContent("Original\n"), runtime: "codex", resource: { kind: "skill", id: "context" } }],
      frameworks: [{ id: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"] }],
      frameworkInstallAttempts: [{ framework: "gsd", runtime: "codex", status: "success" }]
    });

    const plan = await createCleanPlan(targetDir);
    assert.equal(plan.actions[0].action, "drift-warning");
    assert.equal(plan.removedCount, 0);
    await executeCleanPlan(plan);

    assert.equal(await readFile(absolutePath, "utf8"), "Manual edit\n");
    const lock = JSON.parse(await readFile(path.join(targetDir, ".aof", "aof.lock.json"), "utf8"));
    assert.equal(lock.files.length, 1);
    assert.equal(lock.frameworkInstallAttempts[0].status, "success");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}
