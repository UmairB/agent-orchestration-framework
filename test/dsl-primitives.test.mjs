import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateConfig } from "../src/config-inspect.mjs";
import { loadConfig, resolveConfig } from "../src/dsl.mjs";

export const dslPrimitiveTests = [
  {
    name: "normalizes expanded DSL primitive sections",
    run: normalizesExpandedPrimitives
  },
  {
    name: "keeps v1 resources compatible while adding expanded sections",
    run: preservesV1ResourceCompatibility
  },
  {
    name: "validates expanded DSL primitive diagnostics",
    run: validatesExpandedPrimitiveDiagnostics
  }
];

async function normalizesExpandedPrimitives() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-dsl-"));
  try {
    const workspaceDir = path.join(targetDir, ".aof");
    await mkdir(path.join(workspaceDir, "assets", "docs"), { recursive: true });
    await writeFile(path.join(workspaceDir, "assets", "docs", "root.md"), "Project guidance\n", "utf8");
    await writeFile(path.join(workspaceDir, "aof.config.json"), `${JSON.stringify({
      name: "demo",
      resources: [],
      mcpServers: [
        { id: "docs", url: "https://example.test/mcp", headers: { Authorization: "Bearer ${TOKEN}" } }
      ],
      hooks: [
        { id: "test-after-write", event: "PostToolUse", command: "npm test", runtimes: ["codex"] }
      ],
      projectDocs: [
        { id: "root", path: "assets/docs/root.md", targets: ["AGENTS.md"] }
      ],
      settings: {
        model: "gpt-5.4",
        trust: "workspace",
        codex: { approval_policy: "on-request" }
      }
    }, null, 2)}\n`, "utf8");

    const config = await loadConfig(path.join(workspaceDir, "aof.config.json"));
    assert.equal(config.mcpServers[0].id, "docs");
    assert.equal(config.mcpServers[0].transport, "http");
    assert.deepEqual(config.mcpServers[0].runtimes, ["claude", "codex"]);
    assert.equal(config.hooks[0].type, "command");
    assert.deepEqual(config.hooks[0].runtimes, ["codex"]);
    assert.equal(config.projectDocs[0].body, "Project guidance\n");
    assert.deepEqual(config.projectDocs[0].targets, ["AGENTS.md"]);
    assert.equal(config.settings.codex.approval_policy, "on-request");
    assert.deepEqual(await validateConfig(targetDir), []);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function preservesV1ResourceCompatibility() {
  const config = await resolveConfig({
    name: "demo",
    resources: [
      { kind: "skill", id: "context", body: "Body", runtimes: ["codex"] }
    ],
    packages: [
      { id: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["codex"] }
    ]
  });

  assert.equal(config.resources[0].kind, "skill");
  assert.equal(config.resources[0].body, "Body");
  assert.equal(config.packages[0].id, "gsd");
  assert.deepEqual(config.mcpServers, []);
  assert.deepEqual(config.hooks, []);
  assert.deepEqual(config.projectDocs, []);
  assert.deepEqual(config.settings, {});
}

async function validatesExpandedPrimitiveDiagnostics() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-dsl-"));
  try {
    await mkdir(path.join(targetDir, ".aof"), { recursive: true });
    await writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
      resources: [],
      mcpServers: [
        { id: "bad", transport: "pipe", runtimes: ["other"] },
        { id: "bad", transport: "stdio" }
      ],
      hooks: [
        { id: "h", event: "Nope", type: "command" }
      ],
      projectDocs: [
        { id: "doc", path: "../outside.md", targets: ["README.md"] }
      ],
      settings: {
        trust: "maybe",
        autoCompact: "yes",
        codex: "bad"
      }
    }, null, 2)}\n`, "utf8");

    const diagnostics = await validateConfig(targetDir);
    assert.ok(diagnostics.some((item) => item.path === "mcpServers[0].transport"));
    assert.ok(diagnostics.some((item) => item.path === "mcpServers[0].runtimes"));
    assert.ok(diagnostics.some((item) => item.path === "mcpServers[1].id"));
    assert.ok(diagnostics.some((item) => item.path === "hooks[0].event"));
    assert.ok(diagnostics.some((item) => item.path === "hooks[0].command"));
    assert.ok(diagnostics.some((item) => item.path === "projectDocs[0].path"));
    assert.ok(diagnostics.some((item) => item.path === "projectDocs[0].targets"));
    assert.ok(diagnostics.some((item) => item.path === "settings.trust"));
    assert.ok(diagnostics.some((item) => item.path === "settings.autoCompact"));
    assert.ok(diagnostics.some((item) => item.path === "settings.codex"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}
