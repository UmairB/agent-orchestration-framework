import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  await writeFile(filePath, content, "utf8");
  return { path: filePath, action: "write" };
}

export function normalizeId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-_.]*$/i.test(id)) {
    throw new Error(`Invalid id "${id}". Use letters, numbers, dots, underscores, or hyphens.`);
  }

  return id;
}
