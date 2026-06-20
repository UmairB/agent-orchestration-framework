import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export async function writeText(filePath, content, { dryRun = false } = {}) {
  if (dryRun) {
    return { path: filePath, action: "write" };
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}-${randomUUID()}`);
  await writeFile(tempPath, content, "utf8");
  await renameWithRetry(tempPath, filePath);
  return { path: filePath, action: "write" };
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

export function normalizeId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-_.]*$/i.test(id)) {
    throw new Error(`Invalid id "${id}". Use letters, numbers, dots, underscores, or hyphens.`);
  }

  return id;
}
