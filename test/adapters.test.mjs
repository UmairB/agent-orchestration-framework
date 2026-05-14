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
  },
  {
    name: "renders workflow files into runtime workflow folders",
    run: rendersWorkflowFiles
  },
  {
    name: "renders workflow backed wrapper defaults",
    run: rendersWorkflowBackedWrapperDefaults
  },
  {
    name: "renders asset reference placeholders",
    run: rendersAssetReferencePlaceholders
  }
];

async function rendersPortableResources() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [
        { kind: "skill", id: "context", description: "Context", body: "Use project context." },
        { kind: "command", id: "prime", description: "Prime", prompt: "Map the repository.", runtimes: ["claude"] },
        { kind: "agent", id: "reviewer", description: "Review", instructions: "Review the diff." }
      ]
    });

    const writes = await applyConfig(config, { targetDir });
    assert.equal(writes.length, 7);

    const claudeCommand = await readFile(path.join(targetDir, ".claude", "commands", "prime.md"), "utf8");
    const codexGitignore = await readFile(path.join(targetDir, ".codex", ".gitignore"), "utf8");

    assert.match(claudeCommand, /aof-generated: true/);
    assert.match(claudeCommand, /aof-invocation: \/prime/);
    assert.match(codexGitignore, /!\.gitignore/);
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
    assert.equal(writes.length, 4);

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
          runtimes: ["claude"],
          overrides: { claude: { prompt: "Claude command.", description: "Claude prime" } }
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
    assert.match(await readFile(path.join(targetDir, ".claude", "commands", "prime.md"), "utf8"), /Claude command/);
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
    assert.equal(writes.length, 2);
    assert.equal(path.relative(targetDir, writes[0].path), path.join(".codex", "skills", "codex-only", "SKILL.md"));
    assert.equal(path.relative(targetDir, writes[1].path), path.join(".codex", ".gitignore"));
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
    assert.equal(writes.length, 7);

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

async function rendersWorkflowFiles() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      resources: [],
      workflows: [
        {
          id: "audit",
          body: "Run the shared audit workflow.",
          runtimes: ["claude", "codex"]
        }
      ]
    });

    const writes = await applyConfig(config, { targetDir });
    assert.equal(writes.length, 4);

    const claudeWorkflow = await readFile(path.join(targetDir, ".claude", "aof", "workflows", "audit.md"), "utf8");
    const codexWorkflow = await readFile(path.join(targetDir, ".codex", "aof", "workflows", "audit.md"), "utf8");
    assert.match(claudeWorkflow, /Generated by AOF/);
    assert.match(claudeWorkflow, /Run the shared audit workflow/);
    assert.match(codexWorkflow, /Run the shared audit workflow/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rendersWorkflowBackedWrapperDefaults() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      workflows: [
        {
          id: "audit",
          body: "Run the shared audit workflow.",
          argumentHint: "<milestone>",
          arguments: [
            { name: "milestone", description: "Milestone number", required: true }
          ]
        }
      ],
      resources: [
        {
          kind: "command",
          id: "audit",
          description: "Audit milestone",
          workflow: "audit",
          runtimes: ["claude"],
          argumentOverrides: {
            milestone: { description: "Claude milestone id" }
          }
        },
        {
          kind: "skill",
          id: "audit",
          description: "Audit milestone",
          workflow: "audit",
          runtimes: ["codex"]
        }
      ]
    });

    const writes = await applyConfig(config, { targetDir });
    assert.equal(writes.length, 6);

    const claudeCommand = await readFile(path.join(targetDir, ".claude", "commands", "audit.md"), "utf8");
    const codexSkill = await readFile(path.join(targetDir, ".codex", "skills", "audit", "SKILL.md"), "utf8");
    assert.match(claudeCommand, /\.claude\/aof\/workflows\/audit\.md/);
    assert.match(claudeCommand, /Argument hint: `<milestone>`/);
    assert.match(claudeCommand, /`milestone` \(required\): Claude milestone id/);
    assert.match(codexSkill, /\.codex\/aof\/workflows\/audit\.md/);
    assert.match(codexSkill, /`milestone` \(required\): Milestone number/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rendersAssetReferencePlaceholders() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-"));
  try {
    const config = await resolveConfig({
      name: "demo",
      workflows: [
        {
          id: "audit",
          body: "Run the shared audit and call {{skills.ci}}.",
          runtimes: ["claude", "codex"]
        }
      ],
      resources: [
        {
          kind: "skill",
          id: "ci",
          body: "Run CI.",
          runtimes: ["claude", "codex"]
        },
        {
          kind: "skill",
          id: "review",
          body: "Use {{ skills.ci }} and {{workflows.audit}}.",
          runtimes: ["claude", "codex"],
          overrides: {
            codex: { body: "Codex uses {{skills.ci}} plus {{ workflows.audit }}." }
          }
        }
      ]
    });

    await applyConfig(config, { targetDir });

    const claudeReview = await readFile(path.join(targetDir, ".claude", "skills", "review", "SKILL.md"), "utf8");
    const codexReview = await readFile(path.join(targetDir, ".codex", "skills", "review", "SKILL.md"), "utf8");
    const codexWorkflow = await readFile(path.join(targetDir, ".codex", "aof", "workflows", "audit.md"), "utf8");

    assert.match(claudeReview, /\.claude\/skills\/ci\/SKILL\.md/);
    assert.match(claudeReview, /\.claude\/aof\/workflows\/audit\.md/);
    assert.match(codexReview, /\.codex\/skills\/ci\/SKILL\.md/);
    assert.match(codexReview, /\.codex\/aof\/workflows\/audit\.md/);
    assert.match(codexWorkflow, /\.codex\/skills\/ci\/SKILL\.md/);
    assert.doesNotMatch(codexReview, /\{\{/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}
