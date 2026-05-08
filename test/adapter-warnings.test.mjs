import assert from "node:assert/strict";
import { resolveConfig } from "../src/dsl.mjs";
import { createLockManifest, createRenderPlan, planApplyActions } from "../src/render-plan.mjs";
import {
  ADAPTER_WARNING_CODES,
  collectAdapterWarnings,
  hasUnsupportedCommonHookFields
} from "../src/adapter-warnings.mjs";

export const adapterWarningTests = [
  {
    name: "collects adapter warnings with stable shared shape",
    run: collectsStableWarningShape
  },
  {
    name: "warns and classifies unsupported common hook fields",
    run: warnsForUnsupportedHookFields
  },
  {
    name: "warns when project doc targets skip a requested runtime",
    run: warnsForProjectDocRuntimeTargetMismatch
  },
  {
    name: "warns for vendor-neutral settings without direct runtime mapping",
    run: warnsForNeutralSettingGaps
  },
  {
    name: "warns for lossy codex agent model fallback",
    run: warnsForLossyCodexAgentModel
  },
  {
    name: "ignores non-matching runtime extension objects",
    run: ignoresNonMatchingRuntimeExtensions
  },
  {
    name: "does not warn for intentional codex rule guidance mapping",
    run: doesNotWarnForCodexRuleGuidance
  },
  {
    name: "keeps adapter warnings out of lock manifests",
    run: keepsWarningsOutOfLockManifest
  }
];

async function collectsStableWarningShape() {
  const config = await resolveConfig({
    resources: [],
    settings: { model: "gpt-5.4" }
  });
  const [warning] = collectAdapterWarnings(config, { runtimes: ["codex"] });

  assert.deepEqual(Object.keys(warning), [
    "code",
    "severity",
    "path",
    "kind",
    "id",
    "runtime",
    "generatedPath",
    "reason",
    "remediation"
  ]);
  assert.equal(warning.code, ADAPTER_WARNING_CODES.unsupportedRuntimeFeature);
  assert.equal(warning.severity, "warning");
  assert.equal(warning.path, "settings.model");
  assert.equal(warning.kind, "settings");
  assert.equal(warning.id, "model");
  assert.equal(warning.runtime, "codex");
  assert.equal(warning.generatedPath, ".codex/config.toml");
  assert.match(warning.reason, /no safe direct codex mapping/);
  assert.match(warning.remediation, /settings\.codex/);
}

async function warnsForUnsupportedHookFields() {
  const config = await resolveConfig({
    resources: [],
    hooks: [
      { id: "notify", event: "PostToolUse", command: "npm test", timeout: 30 }
    ]
  });
  const warnings = collectAdapterWarnings(config);

  assert.equal(hasUnsupportedCommonHookFields(config.hooks[0]), true);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((item) => item.code === ADAPTER_WARNING_CODES.skippedRuntimeOutput));
  assert.ok(warnings.some((item) => item.runtime === "claude" && item.generatedPath === ".claude/settings.json"));
  assert.ok(warnings.some((item) => item.runtime === "codex" && item.generatedPath === ".codex/config.toml"));
  assert.match(warnings[0].reason, /"timeout"/);
}

async function warnsForProjectDocRuntimeTargetMismatch() {
  const config = await resolveConfig({
    resources: [],
    projectDocs: [
      { id: "claude-only", targets: ["CLAUDE.md"], body: "Claude guidance" }
    ]
  });
  const warnings = collectAdapterWarnings(config, { runtimes: ["codex"] });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, ADAPTER_WARNING_CODES.skippedRuntimeOutput);
  assert.equal(warnings[0].path, "projectDocs[0].targets");
  assert.equal(warnings[0].kind, "project-doc");
  assert.equal(warnings[0].runtime, "codex");
  assert.equal(warnings[0].generatedPath, "AGENTS.md");
}

async function warnsForNeutralSettingGaps() {
  const config = await resolveConfig({
    resources: [],
    settings: {
      model: "gpt-5.4",
      trust: "workspace",
      codex: { model: "gpt-5.4" }
    }
  });
  const warnings = collectAdapterWarnings(config, { runtimes: ["codex"] });

  assert.deepEqual(warnings.map((item) => item.path), ["settings.model", "settings.trust"]);
  assert.ok(warnings.every((item) => item.code === ADAPTER_WARNING_CODES.unsupportedRuntimeFeature));
}

async function warnsForLossyCodexAgentModel() {
  const config = await resolveConfig({
    resources: [
      { kind: "agent", id: "reviewer", model: "gpt-5.4", instructions: "Review changes." }
    ]
  });
  const warnings = collectAdapterWarnings(config, { runtimes: ["codex"] });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, ADAPTER_WARNING_CODES.lossyRuntimeMapping);
  assert.equal(warnings[0].kind, "agent");
  assert.equal(warnings[0].generatedPath, ".codex/agents/reviewer.md");
  assert.match(warnings[0].reason, /frontmatter metadata/);
}

async function ignoresNonMatchingRuntimeExtensions() {
  const config = await resolveConfig({
    resources: [],
    mcpServers: [
      { id: "docs", url: "https://example.test/mcp", codex: { default_tools_approval_mode: "always" } }
    ],
    hooks: [
      { id: "notify", event: "PostToolUse", command: "npm test", codex: { extra: true } }
    ],
    settings: {
      codex: { model: "gpt-5.4" }
    }
  });

  assert.deepEqual(collectAdapterWarnings(config, { runtimes: ["claude"] }), []);
}

async function doesNotWarnForCodexRuleGuidance() {
  const config = await resolveConfig({
    resources: [
      { kind: "rule", id: "project-rule", paths: ["src"], body: "Use project patterns." }
    ]
  });

  assert.deepEqual(collectAdapterWarnings(config, { runtimes: ["codex"] }), []);
}

async function keepsWarningsOutOfLockManifest() {
  const config = await resolveConfig({
    resources: [],
    settings: { model: "gpt-5.4" }
  });
  const warnings = collectAdapterWarnings(config, { runtimes: ["codex"] });
  const desiredOutputs = await createRenderPlan(config, { targetDir: process.cwd(), runtimes: ["codex"] });
  const actions = await planApplyActions(desiredOutputs, null, { targetDir: process.cwd() });
  const manifest = createLockManifest({ actions, desiredOutputs, config, runtimes: ["codex"] });

  assert.equal(warnings.length, 1);
  assert.equal(Object.hasOwn(manifest, "adapterWarnings"), false);
}
