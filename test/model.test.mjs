import assert from "node:assert/strict";
import { CAPABILITIES, CAPABILITY_STATUS, RESOURCE_KINDS, mergeRuntimeOverride } from "../src/model.mjs";

export const modelTests = [
  {
    name: "model includes core resource kinds and rule",
    run() {
      assert.equal(RESOURCE_KINDS.skill.defaultBodyFile, "SKILL.md");
      assert.equal(RESOURCE_KINDS.command.defaultBodyFile, "COMMAND.md");
      assert.equal(RESOURCE_KINDS.agent.defaultBodyFile, "AGENT.md");
      assert.equal(RESOURCE_KINDS.rule.defaultBodyFile, "RULE.md");
    }
  },
  {
    name: "capabilities distinguish codex guidance from execution policy rules",
    run() {
      assert.equal(CAPABILITIES.rule.codex, CAPABILITY_STATUS.mapped);
      assert.equal(CAPABILITIES.codexExecutionPolicyRule.codex, CAPABILITY_STATUS.future);
      assert.equal(CAPABILITIES.codexExecutionPolicyRule.claude, CAPABILITY_STATUS.unsupportedFail);
    }
  },
  {
    name: "runtime overrides shallow merge allowed metadata",
    run() {
      const resource = {
        kind: "agent",
        id: "reviewer",
        description: "Shared",
        runtimes: ["codex"],
        body: "Shared body",
        overrides: {
          codex: {
            description: "Codex",
            body: "Codex body",
            tools: ["shell"]
          }
        }
      };
      assert.deepEqual(mergeRuntimeOverride(resource, "codex"), {
        ...resource,
        description: "Codex",
        body: "Codex body",
        tools: ["shell"]
      });
    }
  },
  {
    name: "runtime overrides cannot change identity fields",
    run() {
      assert.throws(() => mergeRuntimeOverride({
        kind: "skill",
        id: "context",
        runtimes: ["codex"],
        overrides: { codex: { id: "other" } }
      }, "codex"), /cannot change identity field "id"/);
    }
  }
];
