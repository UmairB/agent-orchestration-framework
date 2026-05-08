import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { capabilitiesPayload, loadEditableConfig, saveEditableResource, saveEditableSections, validateEditableResource } from "../src/config-editor.mjs";

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
    name: "loads and saves expanded editable sections",
    run: loadsAndSavesExpandedSections
  },
  {
    name: "editable config includes adapter warnings",
    run: includesAdapterWarnings
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
    assert.deepEqual(payload.adapterWarnings, []);
    assert.deepEqual(payload.nextCommands, ["aof apply --dry-run", "aof install gsd --dry-run"]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function includesAdapterWarnings() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const save = await saveEditableSections(targetDir, {
      hooks: [
        { id: "notify", event: "PostToolUse", command: "npm test", timeout: 30, runtimes: ["codex"] }
      ]
    });
    assert.equal(save.ok, true);
    assert.equal(save.config.adapterWarnings.length, 1);
    assert.equal(save.config.adapterWarnings[0].code, "adapter.skipped-runtime-output");

    const payload = await loadEditableConfig(targetDir);
    assert.equal(payload.adapterWarnings.length, 1);
    assert.equal(payload.adapterWarnings[0].path, "hooks[0]");
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

async function loadsAndSavesExpandedSections() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const save = await saveEditableSections(targetDir, {
      mcpServers: [
        { id: "docs", transport: "http", url: "https://example.test/mcp", runtimes: ["codex"] }
      ],
      hooks: [
        { id: "test-after-write", event: "PostToolUse", command: "npm test", runtimes: ["codex"] }
      ],
      projectDocs: [
        { id: "root", body: "Guidance", targets: ["AGENTS.md"], runtimes: ["codex"] }
      ],
      settings: {
        codex: { approval_policy: "on-request" }
      }
    });

    assert.equal(save.ok, true);
    const payload = await loadEditableConfig(targetDir);
    assert.equal(payload.mcpServers[0].id, "docs");
    assert.equal(payload.hooks[0].id, "test-after-write");
    assert.equal(payload.projectDocs[0].body, "Guidance");
    assert.equal(payload.settings.codex.approval_policy, "on-request");

    const resourceSave = await saveEditableResource(targetDir, {
      kind: "skill",
      id: "context",
      body: "Body",
      runtimes: ["codex"]
    });
    assert.equal(resourceSave.ok, true);
    const config = JSON.parse(await readFile(path.join(targetDir, ".aof", "aof.config.json"), "utf8"));
    assert.equal(config.mcpServers[0].id, "docs");

    const invalid = await saveEditableSections(targetDir, {
      hooks: [
        { id: "bad", event: "Nope", command: "npm test" }
      ]
    });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.diagnostics.some((item) => item.path === "hooks[0].event"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}
