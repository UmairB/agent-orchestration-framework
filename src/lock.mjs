import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJson } from "./fs.mjs";

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
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  const tempPath = path.join(path.dirname(lockPath), `.tmp-${path.basename(lockPath)}-${process.pid}-${Date.now()}-${randomUUID()}`);
  await writeFile(tempPath, content, "utf8");
  await renameWithRetry(tempPath, lockPath);
}

async function renameWithRetry(source, target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!["EACCES", "EPERM"].includes(error.code) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

export function mergeFrameworkInstallAttempts(lock, attempts, generatedAt = new Date().toISOString()) {
  return {
    version: lock?.version ?? LOCK_VERSION,
    generatedAt: lock?.generatedAt ?? generatedAt,
    runtimes: lock?.runtimes ?? [],
    files: lock?.files ?? [],
    packages: lock?.packages ?? [],
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
