// Traceability wiring for milestone 12 / story 01, task 00 —
// tasks/00_provision-command.feature.
//
// Covers every @executable scenario against the REAL in-process code:
// src/commands/project-provision.mjs (the project:provision command — its frozen
// { id, input, run, cli } shape) registered into src/command-core.mjs's COMMANDS,
// and the `aof project provision` CLI dispatch (the --json single-pass envelope
// in src/cli.mjs). One test object per @executable scenario (Scenario-Outline
// rows folded into one entry), each name tracing to feature + scenario. The
// @manual live-install row (a real `uv venv` install) is DEFERRED — not wired.
//
// HERMETIC: every CLI assertion is over a DRY-RUN plan (--dry-run), so no uv/npx
// binary is ever spawned. AOF_GLOBAL_HOME is set to a per-run temp dir in the
// child env so the store geometry is deterministic and isolated; the expected
// store paths are DERIVED via toolStoreRoot/toolVersionDir with that SAME temp
// AOF_GLOBAL_HOME, never hardcoded.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCommand, listCommands } from "../src/command-core.mjs";
import { toolStoreRoot, toolVersionDir } from "../src/paths.mjs";
import { GRAPHIFY_DESCRIPTOR } from "../src/tool-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// The pinned graphify version — read from the frozen descriptor (story 00) so
// this suite tracks a pin bump instead of failing on a stale hardcode. The
// upgrade scenario provisions a DIFFERENT version into a NEW dir.
const GRAPHIFY_VERSION = GRAPHIFY_DESCRIPTOR.version;

// Spawn the CLI with AOF_GLOBAL_HOME pointed at a temp dir so the store root is
// deterministic + isolated. cwd is the temp dir too (the --json face relativises
// storePath to cwd; we re-derive the expected relative path the same way).
function runCli(args, { globalHome, cwd }) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: cwd ?? globalHome,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", AOF_GLOBAL_HOME: globalHome },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function makeTempHome() {
  return mkdtemp(path.join(os.tmpdir(), "aof-provision-"));
}

export const toolProvisionCommandTests = [
  // ═══════════════════════ 00_provision-command.feature ══════════════════════

  {
    // @executable: project:provision is registered with the frozen command shape —
    // its id is in listCommands(), and it carries an input schema, an async run,
    // and a cli adapter with argv + render.
    name: "tool-provision/00 project:provision is registered with the frozen command shape",
    run() {
      const ids = listCommands().map((command) => command.id);
      assert.ok(ids.includes("project:provision"), 'the registry exposes "project:provision"');

      const command = getCommand("project:provision");
      assert.ok(command, "getCommand resolves project:provision");
      assert.ok(command.input && typeof command.input === "object", "carries an input schema");
      assert.equal(typeof command.run, "function", "carries a run function");
      assert.equal(command.run.constructor.name, "AsyncFunction", "run is async");
      assert.ok(command.cli && typeof command.cli === "object", "carries a cli adapter");
      assert.equal(typeof command.cli.argv, "function", "cli.argv is a function");
      assert.equal(typeof command.cli.render, "function", "cli.render is a function");
    },
  },

  {
    // @executable Scenario Outline: `aof project provision graphify <flags> --json`
    // in dry-run mode emits the ProvisionResult envelope (no spawn) — the WHOLE
    // stdout parses as JSON in one pass, reporting tool/provider/version/storePath/
    // status/plan. Two rows: the install plan (status installed) and the uninstall
    // plan (status uninstalled).
    name: "tool-provision/00 aof project provision --json emits the ProvisionResult plan envelope (install + uninstall)",
    async run() {
      const globalHome = await makeTempHome();
      try {
        const rows = [
          { flags: [], status: "installed" },
          { flags: ["--uninstall"], status: "uninstalled" },
        ];
        for (const { flags, status } of rows) {
          const { stdout, status: exit } = runCli(
            ["project", "provision", "graphify", ...flags, "--dry-run", "--json"],
            { globalHome }
          );
          assert.equal(exit, 0, `the dry-run --json call exits 0 (flags: ${flags.join(" ") || "(none)"}) — stderr aside`);

          // The ENTIRE stdout parses as JSON in a single pass (the machine-readable
          // contract a face binds to — no log noise mixed in).
          let envelope;
          assert.doesNotThrow(() => {
            envelope = JSON.parse(stdout);
          }, `the entire stdout parses as JSON in one pass (flags: ${flags.join(" ") || "(none)"}) — got: ${stdout}`);

          assert.equal(envelope.tool, "graphify", "the JSON reports the tool graphify");
          assert.equal(envelope.provider, "uv", "the JSON reports the provider (graphify is the uv lane)");
          assert.equal(envelope.version, GRAPHIFY_VERSION, "the JSON reports the pinned version");
          assert.ok(typeof envelope.storePath === "string" && envelope.storePath.length > 0, "the JSON reports the store path");
          assert.equal(envelope.status, status, `the JSON status is "${status}"`);
          assert.ok(envelope.plan != null, "the JSON carries the planned commands");
        }
      } finally {
        await rm(globalHome, { recursive: true, force: true });
      }
    },
  },

  {
    // @executable: `aof project provision graphify --uninstall` (dry-run) targets
    // EXACTLY the pinned graphify version dir under the store root — derived via
    // toolVersionDir with the same temp AOF_GLOBAL_HOME, never hardcoded.
    name: "tool-provision/00 aof project provision --uninstall targets exactly the version dir",
    async run() {
      const globalHome = await makeTempHome();
      try {
        const env = { AOF_GLOBAL_HOME: globalHome };
        const expectedDir = toolVersionDir("graphify", GRAPHIFY_VERSION, env);
        const storeRoot = toolStoreRoot(env);

        // The --json envelope's storePath is relativised to cwd; we run with
        // cwd = globalHome so the relative path resolves back to the absolute dir.
        const { stdout, status } = runCli(
          ["project", "provision", "graphify", "--uninstall", "--dry-run", "--json"],
          { globalHome, cwd: globalHome }
        );
        assert.equal(status, 0, "the uninstall dry-run --json call exits 0");
        const envelope = JSON.parse(stdout);

        // The removal target carried in the plan is exactly the version dir.
        const removeDir = envelope.plan?.removeDir;
        assert.ok(typeof removeDir === "string", "the plan names the removal target dir");
        assert.equal(removeDir, expectedDir, "the removal target is exactly the pinned graphify version dir under the store root");

        // And it is UNDER the store root (not a global/PATH/system path).
        assert.ok(removeDir.startsWith(storeRoot), `the removal target is under the store root (${storeRoot})`);
        assert.ok(removeDir.endsWith(path.join("graphify", GRAPHIFY_VERSION)), "the removal target ends with graphify/<pinned version>");
      } finally {
        await rm(globalHome, { recursive: true, force: true });
      }
    },
  },

  {
    // @executable: provisioning a NEW version plans into the NEW version dir and
    // leaves the old pin (the store is version-keyed — ADR-003). Observable over
    // the dry-run plan: the plan targets the requested 0.9.0 dir, NOT the pinned dir.
    name: "tool-provision/00 provisioning a new version plans into the new version dir, leaving the old pin",
    async run() {
      const globalHome = await makeTempHome();
      try {
        const env = { AOF_GLOBAL_HOME: globalHome };
        const newVersion = "0.9.0";
        const newDir = toolVersionDir("graphify", newVersion, env);
        const oldDir = toolVersionDir("graphify", GRAPHIFY_VERSION, env);

        // The --json face relativises storePath; run with cwd = globalHome so we
        // can re-derive the relative expectation, and also assert the absolute plan.
        const { stdout, status } = runCli(
          ["project", "provision", "graphify", "--version", newVersion, "--dry-run", "--json"],
          { globalHome, cwd: globalHome }
        );
        assert.equal(status, 0, "the upgrade dry-run --json call exits 0");
        const envelope = JSON.parse(stdout);

        assert.equal(envelope.version, newVersion, "the envelope reports the requested new version");

        // The plan (the uv lane's commands) targets the 0.9.0 dir, never the pinned
        // dir. Assert over the PARSED plan structure (the deserialised path strings),
        // not a re-stringified blob — JSON escaping of backslashes would otherwise
        // mask a match on Windows.
        const planPaths = [
          envelope.plan?.versionDir,
          ...(envelope.plan?.commands ?? []).flat(),
        ].filter((value) => typeof value === "string");
        assert.ok(
          planPaths.some((value) => value === newDir),
          `the plan targets the graphify 0.9.0 version dir (${newDir}) — got: ${JSON.stringify(planPaths)}`
        );
        assert.ok(
          !planPaths.some((value) => value === oldDir),
          "the plan does not target or remove the pinned graphify version dir"
        );

        // storePath (relativised to cwd=globalHome) resolves back to the 0.9.0 dir.
        const resolvedStore = path.resolve(globalHome, envelope.storePath);
        assert.equal(resolvedStore, newDir, "storePath resolves to the new 0.9.0 version dir");
      } finally {
        await rm(globalHome, { recursive: true, force: true });
      }
    },
  },
];
