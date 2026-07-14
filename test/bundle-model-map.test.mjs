// Story 30 · task 01 — the ACD bundle ships a default model per agent role.
//
// Traceability for tasks/01_bundle-ships-default-model-map.feature. Every
// Scenario and every Scenario-Outline Examples row is asserted against the REAL
// loader + renderer (loadBundle + renderBundleOutputs from src/work-bundle.mjs)
// — no render logic re-implemented here. The Thens read the RENDERED Claude Code
// agent file's `model` frontmatter (the copy the runtime honours), NOT the
// bundle source, matching the feature's "distinct surfaces" note.
import assert from "node:assert/strict";
import { loadBundle, renderBundleOutputs } from "../src/work-bundle.mjs";

// The locked default map (STORY.md "Locked intent"): opus for the roles that
// decide "what's correct" (author / gate / review), sonnet for the roles that
// execute or gather against a locked target. Fable is deliberately NOT a shipped
// default (it is expensive) — it is opt-in per role via `work.agents.models` and
// as an orchestrator (main-session) choice.
const DEFAULT_MODEL_BY_ROLE = {
  "aof-architect": "opus",
  "aof-security": "opus",
  "aof-compliance": "opus",
  "aof-product-owner": "opus",
  "aof-qa": "opus",
  "aof-designer": "opus",
  "aof-developer": "sonnet",
  "aof-researcher": "sonnet"
};

// Render the bundle for the Claude runtime and index the generated agent files
// by their project-relative ".claude/agents/<role>.md" path (separators
// normalised — renderConfigOutputs emits OS-native separators).
function renderedClaudeAgents() {
  const outputs = renderBundleOutputs(loadBundle(), { runtimes: ["claude"] });
  const byPath = new Map();
  for (const output of outputs) {
    if (output.resource?.kind !== "agent") continue;
    byPath.set(String(output.path).replaceAll("\\", "/"), output);
  }
  return byPath;
}

// The single-line `model:` frontmatter value from a rendered agent file, or null
// when absent. Reads only the leading `---`…`---` block so a body mention can't
// false-match.
function renderedModelValue(content) {
  const end = content.indexOf("\n---", 3);
  const block = end === -1 ? content : content.slice(0, end);
  const match = /^model:[ \t]?(.*)$/m.exec(block);
  return match ? match[1] : null;
}

function claudeAgentContent(byPath, role) {
  const output = byPath.get(`.claude/agents/${role}.md`);
  assert.ok(output, `rendered .claude/agents/${role}.md exists`);
  return output.content;
}

export const bundleModelMapTests = [
  // ====================================================================
  // Scenario Outline: each ACD role's shipped default renders into its
  // generated agent file (6 opus, 2 sonnet).
  // ====================================================================
  {
    name: "bundle-model-map: each ACD role's shipped default renders into its generated .claude/agents file (6 opus, 2 sonnet)",
    run: async () => {
      const byPath = renderedClaudeAgents();
      for (const [role, model] of Object.entries(DEFAULT_MODEL_BY_ROLE)) {
        const value = renderedModelValue(claudeAgentContent(byPath, role));
        assert.equal(value, model, `${role} renders "${model}" as its model frontmatter`);
      }
      // The two tiers split exactly 6 opus / 2 sonnet across the 8 frozen roles.
      const rendered = Object.keys(DEFAULT_MODEL_BY_ROLE).map((role) =>
        renderedModelValue(claudeAgentContent(byPath, role))
      );
      assert.equal(rendered.filter((m) => m === "opus").length, 6, "6 roles default to opus");
      assert.equal(rendered.filter((m) => m === "sonnet").length, 2, "2 roles default to sonnet");
    }
  },

  // ====================================================================
  // Scenario: the shipped default is a moving family alias, rendered verbatim.
  //   - the value is the family alias exactly ("opus" / "sonnet")
  //   - no value is a re-cased variant ("Opus" / "OPUS")
  //   - no value contains a version-dated id ("claude-opus-4-8")
  // ====================================================================
  {
    name: "bundle-model-map: the shipped default is a moving family alias, rendered verbatim (no re-case, no dated id)",
    run: async () => {
      const byPath = renderedClaudeAgents();
      for (const role of Object.keys(DEFAULT_MODEL_BY_ROLE)) {
        const value = renderedModelValue(claudeAgentContent(byPath, role));
        assert.ok(value !== null, `${role} declares a model value`);

        // Exactly the lowercase family alias — one of the two moving aliases.
        assert.ok(["opus", "sonnet"].includes(value), `${role} model "${value}" is a family alias`);

        // Not a re-cased variant: the rendered literal is byte-identical to its
        // own lowercase form (rules out "Opus" / "OPUS").
        assert.equal(value, value.toLowerCase(), `${role} model "${value}" is not re-cased`);

        // Not a version-dated / fully-pinned id (rules out "claude-opus-4-8").
        assert.ok(!/\d/.test(value), `${role} model "${value}" carries no version-dated id`);
        assert.ok(!value.includes("-"), `${role} model "${value}" is a bare alias, not a hyphenated id`);
      }
    }
  }
];
