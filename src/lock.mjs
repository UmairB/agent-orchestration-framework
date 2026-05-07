import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readJson, writeText } from "./fs.mjs";

export const LOCK_VERSION = 2;

export function hashContent(content) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export async function readLock(lockPath) {
  try {
    return await readJson(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeLock(lockPath, manifest) {
  await writeText(lockPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function mergeFrameworkInstallAttempts(lock, attempts, generatedAt = new Date().toISOString()) {
  return {
    version: lock?.version ?? LOCK_VERSION,
    generatedAt: lock?.generatedAt ?? generatedAt,
    runtimes: lock?.runtimes ?? [],
    files: lock?.files ?? [],
    frameworks: lock?.frameworks ?? [],
    frameworkInstallAttempts: [
      ...(Array.isArray(lock?.frameworkInstallAttempts) ? lock.frameworkInstallAttempts : []),
      ...attempts
    ]
  };
}

export async function hashFileIfExists(filePath) {
  try {
    return hashContent(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
