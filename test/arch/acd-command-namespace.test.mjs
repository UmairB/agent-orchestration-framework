// Fitness function for milestone 01 / ADR-007:
// "Every bundle command member renders to commands/<namespace>/<id>.md under the
//  runtime root and carries aof-invocation: /<namespace>:<id>; agent members
//  remain agents/<id>.md."
//
// Render each declared command member with the REAL renderer; assert its path is
// commands/aof/<id>.md and its aof-invocation frontmatter is /aof:<id>. Assert an
// agent member's path stays agents/<id>.md and carries no namespace.
import assert from "node:assert/strict";
import { loadBundle, renderBundleOutputs } from "../../src/work-bundle.mjs";

function normalize(p) {
  return String(p).replaceAll("\\", "/");
}

function invocationOf(content) {
  const match = /^aof-invocation:\s*(.+)$/m.exec(content);
  return match ? match[1].trim() : null;
}

export const archTests = [
  {
    name: "arch/ADR-007: every command member renders to commands/aof/<id>.md and carries aof-invocation: /aof:<id>",
    run: async () => {
      const bundle = loadBundle();
      const outputs = renderBundleOutputs(bundle, { runtimes: ["claude"] });
      const commandIds = bundle.resources.filter((r) => r.kind === "command").map((r) => r.id);
      assert.equal(commandIds.length, 14, "14 command members");

      const byId = new Map(outputs.filter((o) => o.resource.kind === "command").map((o) => [o.resource.id, o]));
      for (const id of commandIds) {
        const output = byId.get(id);
        assert.ok(output, `rendered output for command ${id}`);
        assert.equal(normalize(output.path), `.claude/commands/aof/${id}.md`, `${id} renders under commands/aof/`);
        assert.equal(invocationOf(output.content), `/aof:${id}`, `${id} aof-invocation is /aof:${id}`);
      }
    }
  },
  {
    name: "arch/ADR-007: agent members remain agents/<id>.md (unaffected by the namespace rule)",
    run: async () => {
      const bundle = loadBundle();
      const outputs = renderBundleOutputs(bundle, { runtimes: ["claude"] });
      const agentIds = bundle.resources.filter((r) => r.kind === "agent").map((r) => r.id);
      assert.equal(agentIds.length, 8, "8 agent members");

      const byId = new Map(outputs.filter((o) => o.resource.kind === "agent").map((o) => [o.resource.id, o]));
      for (const id of agentIds) {
        const output = byId.get(id);
        assert.ok(output, `rendered output for agent ${id}`);
        assert.equal(normalize(output.path), `.claude/agents/${id}.md`, `${id} stays under agents/`);
        // Agents carry no aof-invocation at all.
        assert.equal(invocationOf(output.content), null, `${id} has no aof-invocation`);
      }
    }
  },
  {
    name: "arch/ADR-007: the namespace rule is general — a non-namespaced command renders flat (no regression)",
    run: async () => {
      // Prove the adapter rule keys on the declared property, not a bundle branch:
      // a command WITHOUT commandNamespace still renders flat commands/<id>.md
      // invoked /<id>. (Guards against breaking existing non-namespaced commands.)
      const { renderConfigOutputs } = await import("../../src/adapters.mjs");
      const flat = renderConfigOutputs(
        { resources: [{ id: "plain", kind: "command", runtimes: ["claude"], description: "x", body: "hi" }], workflows: [], packages: [] },
        { runtimes: ["claude"] }
      ).find((o) => o.resource.id === "plain");
      assert.equal(normalize(flat.path), ".claude/commands/plain.md", "non-namespaced command stays flat");
      assert.equal(invocationOf(flat.content), "/plain", "non-namespaced invocation is /plain");
    }
  }
];
