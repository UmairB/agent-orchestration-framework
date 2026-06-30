import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCliSync } from "../support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

const root = await mkdtemp(path.join(os.tmpdir(), "aof-smoke-"));
const projectDir = path.join(root, "project");
const dataDir = path.join(root, "data");

try {
  await mkdir(projectDir, { recursive: true });

  const help = run(["--help"]);
  assert.equal(help.status, 0, format(help));
  assert.match(help.stdout, /aof - Agent Orchestration Framework/);

  const init = run(["init", "--codex"]);
  assert.equal(init.status, 0, format(init));
  assert.match(init.stdout, /Created/);

  const add = run(["assets", "add", "skill", "smoke", "--codex", "--description", "Smoke"]);
  assert.equal(add.status, 0, format(add));
  assert.match(add.stdout, /Created/);

  const show = run(["project", "show"]);
  assert.equal(show.status, 0, format(show));
  assert.match(show.stdout, /config:/);
  assert.match(show.stdout, /resources:/);

  const validate = run(["project", "validate"]);
  assert.equal(validate.status, 0, format(validate));
  assert.match(validate.stdout, /valid: config passed validation/);

  const doctor = run(["project", "doctor"]);
  assert.equal(doctor.status, 0, format(doctor));
  assert.match(doctor.stdout, /doctor:/);

  const dryRun = run(["assets", "apply", "--dry-run", "--codex"]);
  assert.equal(dryRun.status, 0, format(dryRun));
  assert.match(dryRun.stdout, /Would create/);
  assert.match(dryRun.stdout, /Would update \.aof\/aof\.lock\.json/);

  const packageAdd = run(["packages", "add", "gsd", "--codex"]);
  assert.equal(packageAdd.status, 0, format(packageAdd));
  assert.match(packageAdd.stdout, /Updated/);

  const packageShow = run(["packages", "show", "gsd"]);
  assert.equal(packageShow.status, 0, format(packageShow));
  assert.match(packageShow.stdout, /package: gsd/);

  const packageValidate = run(["packages", "validate"]);
  assert.equal(packageValidate.status, 0, format(packageValidate));
  assert.match(packageValidate.stdout, /valid: packages passed validation/);

  const packageInstallDryRun = run(["packages", "install", "gsd", "--dry-run"]);
  assert.equal(packageInstallDryRun.status, 0, format(packageInstallDryRun));
  assert.match(packageInstallDryRun.stdout, /dry-run: no network/);

  const removedConfig = run(["config", "show"]);
  assert.notEqual(removedConfig.status, 0, format(removedConfig));
  assert.match(removedConfig.stderr, /Removed command "config"/);
  assert.doesNotMatch(removedConfig.stderr, /SQLite/);

  const removedCatalog = run(["catalog", "list"]);
  assert.notEqual(removedCatalog.status, 0, format(removedCatalog));
  assert.match(removedCatalog.stderr, /Catalog is not currently supported/);
  assert.doesNotMatch(removedCatalog.stderr, /SQLite/);

  const config = JSON.parse(await readFile(path.join(projectDir, ".aof", "aof.config.json"), "utf8"));
  assert.equal(config.runtimes.includes("codex"), true);
  assert.equal(config.packages.some((pkg) => pkg.id === "gsd"), true);
  console.log("ok - child-process smoke");
} catch (error) {
  console.error("not ok - child-process smoke");
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}

function run(args) {
  return spawnCliSync(process.execPath, ["--no-warnings", cliPath, ...args], {
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
