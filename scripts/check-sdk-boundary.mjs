import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles } from "./walk-files.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedSdkImport = path.join(repoRoot, "src", "gsd-sdk-adapter.mjs");
const scannedRoots = [
  path.join(repoRoot, "src"),
  path.join(repoRoot, "ui", "src")
];

const violations = [];

for (const root of scannedRoots) {
  for await (const filePath of walkFiles(root, [".mjs", ".js", ".ts", ".tsx"])) {
    const normalized = path.resolve(filePath);
    const text = await readFile(normalized, "utf8");
    const relative = path.relative(repoRoot, normalized).replaceAll("\\", "/");
    if (text.includes("@gsd-build/sdk") && normalized !== allowedSdkImport) {
      violations.push(`${relative}: @gsd-build/sdk may only be imported by src/gsd-sdk-adapter.mjs`);
    }
    if (text.includes("gsd-tools.cjs") && normalized !== allowedSdkImport) {
      violations.push(`${relative}: gsd-tools.cjs may only be referenced by src/gsd-sdk-adapter.mjs`);
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exitCode = 1;
}

