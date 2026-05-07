import path from "node:path";
import { rm } from "node:fs/promises";
import { hashFileIfExists, readLock, writeLock } from "./lock.mjs";
import { workspacePaths } from "./workspace.mjs";

export async function createCleanPlan(projectDir = process.cwd()) {
  const paths = workspacePaths(projectDir);
  const lock = await readLock(paths.lockPath);
  const files = Array.isArray(lock?.files) ? lock.files : [];
  const actions = [];

  for (const entry of files) {
    const absolutePath = path.resolve(projectDir, entry.path);
    const currentHash = await hashFileIfExists(absolutePath);
    if (!currentHash) {
      actions.push(cleanAction("skip", entry, absolutePath, "previously generated file is already absent"));
      continue;
    }
    if (currentHash !== entry.hash) {
      actions.push(cleanAction("drift-warning", entry, absolutePath, "generated file was modified; not deleting"));
      continue;
    }
    actions.push(cleanAction("delete", entry, absolutePath, "lock-owned generated file matches recorded hash"));
  }

  const removed = new Set(actions
    .filter((action) => action.action === "delete" || action.action === "skip")
    .map((action) => normalizePath(action.path)));
  const nextLock = lock ? {
    ...lock,
    files: files.filter((entry) => !removed.has(normalizePath(entry.path)))
  } : null;

  return {
    lockPath: paths.lockPath,
    lock,
    nextLock,
    actions,
    removedCount: removed.size
  };
}

export async function executeCleanPlan(plan) {
  for (const action of plan.actions) {
    if (action.action === "delete") {
      await rm(action.absolutePath, { force: true });
    }
  }

  if (plan.nextLock) {
    await writeLock(plan.lockPath, plan.nextLock);
  }
}

function cleanAction(name, entry, absolutePath, reason) {
  return {
    action: name,
    path: entry.path,
    absolutePath,
    runtime: entry.runtime,
    resource: entry.resource ?? null,
    reason
  };
}

function normalizePath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}
