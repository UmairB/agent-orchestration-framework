import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

export async function fileExists(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

export function assertLastResult(context) {
  assert.ok(context.lastResult, "No command has been run in this scenario.");
}

export function escapeRegex(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

export function formatResult(result) {
  return [
    `status: ${result.status}`,
    result.error ? `error: ${result.error.message}` : null,
    "stdout:",
    result.stdout,
    "stderr:",
    result.stderr
  ].filter((part) => part !== null).join("\n");
}

export function normalizeFilePath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
