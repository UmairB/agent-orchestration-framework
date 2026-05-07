import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { capabilitiesPayload, loadEditableConfig, saveEditableResource, validateEditableResource } from "../src/config-editor.mjs";

export const configEditorTests = [
  {
    name: "exposes central capability payload",
    run: exposesCapabilities
  },
  {
    name: "saves file-backed asset and runtime body override",
    run: savesAssetAndOverride
  },
  {
    name: "loads editable config with resolved body",
    run: loadsEditableConfig
  },
  {
    name: "rejects invalid editable resource saves",
    run: rejectsInvalidSave
  }
];

function exposesCapabilities() {
  const payload = capabilitiesPayload();
  assert.equal(payload.runtimes.claude.name, "Claude Code");
  assert.equal(payload.resourceKinds.rule.defaultBodyFile, "RULE.md");
  assert.equal(payload.capabilities.rule.codex, "mapped");
}

async function savesAssetAndOverride() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const result = await saveEditableResource(targetDir, {
      kind: "rule",
      id: "project-rule",
      description: "Shared guidance",
      body: "Shared body",
      paths: ["src"],
      runtimes: ["claude", "codex"],
      overrides: {
        codex: {
          enabled: true,
          body: "Codex body"
        },
        claude: {
          enabled: false,
          body: "Ignored"
        }
      }
    });

    assert.equal(result.ok, true);
    const config = JSON.parse(await readFile(path.join(targetDir, ".aof", "aof.config.json"), "utf8"));
    assert.equal(config.resources[0].kind, "rule");
    assert.equal(config.resources[0].path, "assets/rules/project-rule/RULE.md");
    assert.equal(config.resources[0].overrides.codex, "assets/rules/project-rule/overrides/codex.json");
    assert.equal(config.resources[0].overrides.claude, undefined);
    assert.equal(await readFile(path.join(targetDir, ".aof", "assets", "rules", "project-rule", "RULE.md"), "utf8"), "Shared body\n");
    const override = JSON.parse(await readFile(path.join(targetDir, ".aof", "assets", "rules", "project-rule", "overrides", "codex.json"), "utf8"));
    assert.equal(override.body, "Codex body");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function loadsEditableConfig() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    await mkdir(path.join(targetDir, ".aof", "assets", "commands", "prime"), { recursive: true });
    await import("node:fs/promises").then(({ writeFile }) => Promise.all([
      writeFile(path.join(targetDir, ".aof", "assets", "commands", "prime", "COMMAND.md"), "Prime body\n", "utf8"),
      writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
        name: "demo",
        resources: [
          { kind: "command", id: "prime", path: "assets/commands/prime/COMMAND.md", runtimes: ["codex"] }
        ],
        packages: [{ id: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"] }]
      }, null, 2)}\n`, "utf8")
    ]));

    const payload = await loadEditableConfig(targetDir);
    assert.equal(payload.resources[0].body, "Prime body\n");
    assert.deepEqual(payload.nextCommands, ["aof apply --dry-run", "aof install gsd --dry-run"]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rejectsInvalidSave() {
  const diagnostics = validateEditableResource({
    kind: "skill",
    id: "bad",
    runtimes: ["unknown"]
  });
  assert.ok(diagnostics.some((item) => item.blocking && item.path === "runtimes"));

  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const result = await saveEditableResource(targetDir, { kind: "skill", id: "bad", runtimes: [] });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.blocking));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}
