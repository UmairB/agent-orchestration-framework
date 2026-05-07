import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(repoRoot, "ui");

run("TypeScript", path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"), ["-b"]);
run("Vite", path.join(repoRoot, "node_modules", "vite", "bin", "vite.js"), ["build"]);

function run(label, scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: uiDir,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(`${label} build failed to start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${label} build failed with exit code ${result.status ?? 1}.`);
    process.exit(result.status ?? 1);
  }
}
