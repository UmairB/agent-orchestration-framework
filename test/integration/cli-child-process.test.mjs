import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

const root = await mkdtemp(path.join(os.tmpdir(), "aof-smoke-"));
const projectDir = path.join(root, "project");
const dataDir = path.join(root, "data");

try {
  await mkdir(projectDir, { recursive: true });

  const help = run(["--help"]);
  assert.equal(help.status, 0, format(help));
  assert.match(help.stdout, /aof - Assistant Ops Framework/);

  const init = run(["init", "--items", "project-context,prime", "--codex"]);
  assert.equal(init.status, 0, format(init));
  assert.match(init.stdout, /Created/);

  const show = run(["config", "show"]);
  assert.equal(show.status, 0, format(show));
  assert.match(show.stdout, /config:/);
  assert.match(show.stdout, /resources:/);

  const dryRun = run(["apply", "--dry-run", "--codex"]);
  assert.equal(dryRun.status, 0, format(dryRun));
  assert.match(dryRun.stdout, /lock-preview:/);

  const config = JSON.parse(await readFile(path.join(projectDir, ".aof", "aof.config.json"), "utf8"));
  assert.equal(config.runtimes.includes("codex"), true);
  console.log("ok - child-process smoke");
} catch (error) {
  console.error("not ok - child-process smoke");
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}

function run(args) {
  return spawnSync(process.execPath, ["--no-warnings", cliPath, ...args], {
    cwd: projectDir,
    env: {
      ...process.env,
      AOF_DATA_DIR: dataDir,
      NODE_NO_WARNINGS: "1"
    },
    encoding: "utf8"
  });
}

function format(result) {
  return [
    `status: ${result.status}`,
    result.error ? `error: ${result.error.message}` : null,
    "stdout:",
    result.stdout,
    "stderr:",
    result.stderr
  ].filter(Boolean).join("\n");
}
