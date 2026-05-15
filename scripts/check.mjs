import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

run("supply-chain audit", path.join(repoRoot, "scripts", "supply-chain-audit.mjs"));
run("tests", path.join(repoRoot, "scripts", "test.mjs"));
run("child-process smoke", path.join(repoRoot, "test", "integration", "cli-child-process.test.mjs"));
run("UI build", path.join(repoRoot, "scripts", "ui-build.mjs"));

function run(label, scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(`${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? 1}.`);
    process.exit(result.status ?? 1);
  }
}
