import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyConfig } from "../src/adapters.mjs";
import { resolveConfig } from "../src/dsl.mjs";

export const adapterTests = [
  {
    name: "renders portable resources into claude and codex folders",
    run: rendersPortableResources
  },
  {
    name: "respects resource runtime filters",
    run: respectsResourceRuntimeFilters
  },
  {
    name: "renders rule guidance to claude rules and codex agents",
    run: rendersRuleGuidance
  },
  {
    name: "applies runtime override bodies",
    run: appliesRuntimeOverrideBodies
  },
  {
    name: "applies runtime overrides across resource kinds",
    run: appliesRuntimeOverridesAcrossKinds
  },
  {
    name: "renders expanded DSL primitives into runtime config outputs",
    run: rendersExpandedDslRuntimeOutputs
  }
];

async function rendersPortableResources() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "skill", id: "context", description: "Context", body: "Use project context." },
        { kind: "command", id: "prime", description: "Prime", prompt: "Map the repository." },
        { kind: "agent", id: "reviewer", description: "Review", instructions: "Review the diff." }
      ]
    });

    const writes = await applyConfig(config, { targetDir });
    assert.equal(writes.length, 6);

    const claudeCommand = await readFile(path.join(targetDir, ".claude", "commands", "prime.md"), "utf8");
    const codexCommand = await readFile(path.join(targetDir, ".codex", "commands", "prime.md"), "utf8");

    assert.match(claudeCommand, /aof-generated: true/);
    assert.match(claudeCommand, /aof-invocation: \/prime/);
    assert.match(codexCommand, /aof-invocation: \$prime/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rendersRuleGuidance() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "rule", id: "project-rules", description: "Rules", paths: ["src"], body: "Use scoped patterns." }
      ]
    });

    const writes = await applyConfig(config, { targetDir });
    assert.equal(writes.length, 2);

    const claudeRule = await readFile(path.join(targetDir, ".claude", "rules", "project-rules.md"), "utf8");
    const codexAgents = await readFile(path.join(targetDir, ".codex", "src", "AGENTS.md"), "utf8");

    assert.match(claudeRule, /paths: src/);
    assert.match(claudeRule, /Use scoped patterns/);
    assert.match(codexAgents, /# project-rules/);
    assert.match(codexAgents, /Use scoped patterns/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function appliesRuntimeOverrideBodies() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        {
          kind: "skill",
          id: "context",
          body: "Shared body.",
          overrides: {
            codex: { body: "Codex body." }
          }
        }
      ]
    });

    await applyConfig(config, { targetDir, runtimes: ["codex"] });
    const codexSkill = await readFile(path.join(targetDir, ".codex", "skills", "context", "SKILL.md"), "utf8");

    assert.match(codexSkill, /Codex body/);
    assert.doesNotMatch(codexSkill, /Shared body/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function appliesRuntimeOverridesAcrossKinds() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        {
          kind: "skill",
          id: "context",
          body: "Shared skill.",
          overrides: { claude: { body: "Claude skill." } }
        },
        {
          kind: "command",
          id: "prime",
          prompt: "Shared command.",
          overrides: { codex: { prompt: "Codex command.", description: "Codex prime" } }
        },
        {
          kind: "agent",
          id: "reviewer",
          instructions: "Shared agent.",
          overrides: { claude: { instructions: "Claude agent.", model: "sonnet" } }
        },
        {
          kind: "rule",
          id: "guidance",
          body: "Shared rule.",
          overrides: { codex: { body: "Codex rule.", paths: ["src"] } }
        }
      ]
    });

    await applyConfig(config, { targetDir });
    assert.match(await readFile(path.join(targetDir, ".claude", "skills", "context", "SKILL.md"), "utf8"), /Claude skill/);
    assert.match(await readFile(path.join(targetDir, ".codex", "commands", "prime.md"), "utf8"), /Codex command/);
    assert.match(await readFile(path.join(targetDir, ".claude", "agents", "reviewer.md"), "utf8"), /model: sonnet/);
    assert.match(await readFile(path.join(targetDir, ".codex", "src", "AGENTS.md"), "utf8"), /Codex rule/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function respectsResourceRuntimeFilters() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "skill", id: "codex-only", runtimes: ["codex"], body: "Codex content." }
      ]
    });

    const writes = await applyConfig(config, { targetDir });
    assert.equal(writes.length, 1);
    assert.equal(path.relative(targetDir, writes[0].path), path.join(".codex", "skills", "codex-only", "SKILL.md"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rendersExpandedDslRuntimeOutputs() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [],
      mcpServers: [
        {
          id: "docs",
          transport: "http",
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer ${TOKEN}" }
        },
        {
          id: "local-tools",
          transport: "stdio",
          command: "node",
          args: ["server.mjs"],
          env: { NODE_ENV: "test" },
          runtimes: ["codex"]
        }
      ],
      hooks: [
        { id: "test-after-write", event: "PostToolUse", matcher: "Write", command: "npm test" }
      ],
      projectDocs: [
        { id: "root", targets: ["AGENTS.md", "CLAUDE.md"], body: "Use generated guidance." }
      ],
      settings: {
        claude: { permissions: { allow: ["Bash(npm test)"] } },
        codex: { model: "gpt-5.4", approval_policy: "on-request" }
      }
    });

    const writes = await applyConfig(config, { targetDir });
    assert.equal(writes.length, 5);

    const claudeMcp = await readFile(path.join(targetDir, ".mcp.json"), "utf8");
    const claudeSettings = await readFile(path.join(targetDir, ".claude", "settings.json"), "utf8");
    const codexConfig = await readFile(path.join(targetDir, ".codex", "config.toml"), "utf8");
    const agents = await readFile(path.join(targetDir, "AGENTS.md"), "utf8");
    const claudeDoc = await readFile(path.join(targetDir, "CLAUDE.md"), "utf8");

    assert.match(claudeMcp, /"docs"/);
    assert.match(claudeMcp, /"type": "http"/);
    assert.match(claudeSettings, /"hooks"/);
    assert.match(claudeSettings, /"PostToolUse"/);
    assert.match(codexConfig, /\[mcp_servers\.docs\]/);
    assert.match(codexConfig, /\[\[hooks\.PostToolUse\]\]/);
    assert.match(codexConfig, /approval_policy = "on-request"/);
    assert.match(agents, /Use generated guidance/);
    assert.match(claudeDoc, /Use generated guidance/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}
