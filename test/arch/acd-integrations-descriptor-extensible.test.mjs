// Fitness function FF-E for milestone 18 / ADR-003 (provider-namespaced + extensible):
//   The `.integrations.json` reader (src/integrations/routing.mjs `readRouting`)
//   TOLERATES an unknown provider key — a planted `jira` block (a future provider) is
//   IGNORED, not a hard failure: the reader returns the `notion` routing and does not
//   throw. Routing is provider-namespaced; a non-`notion` peer is additive.
//
// Driven over a temp fixture (the registry-driven temp-fixture idiom) — a behaviour
// fitness, not a source-grep, so a future reader that hard-fails on an unknown provider
// (or stops returning notion when a peer is present) fails HERE. Supersedes the
// extensibility intent of acd-notion-parents-schema (the closedness half moves to FF-F).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readRouting } from "../../src/integrations/routing.mjs";

// A fixture milestone folder + an `.integrations.json` whose `notion` block sits beside a
// planted UNKNOWN provider block (jira). Returns the resolver-shaped item + a cleanup.
async function makeItem(descriptor) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-ff-extensible-"));
  const dir = path.join(repo, "wiki", "work", "18_milestone_demo");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPEC.md"), "---\ntype: milestone\nnumber: 18\nslug: demo\n---\n", "utf8");
  await writeFile(path.join(dir, ".integrations.json"), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  const item = { type: "milestone", dir, ref: "18", parent: null };
  return { repo, item };
}

export const archTests = [
  {
    name: "arch/18 FF-E: the .integrations.json reader tolerates an unknown provider key (a planted jira block is ignored, not a hard failure)",
    async run() {
      const { repo, item } = await makeItem({
        notion: { board: "ops", parent: "p1" },
        jira: { project: "ABC", board: 17, anything: { nested: true } },
      });
      try {
        let routing;
        assert.doesNotThrow(() => {
          routing = readRouting(item);
        }, "the unknown jira provider block does not cause readRouting to throw");
        // The notion routing is still returned despite the unknown peer.
        assert.ok(routing.notion, "the reader returns the notion routing block");
        assert.equal(routing.notion.board, "ops", "the notion board is read despite the unknown peer");
        assert.equal(routing.notion.parent, "p1", "the notion parent is read despite the unknown peer");
        // The unknown peer is neither stripped-by-erroring nor interpreted — it is simply
        // present and ignored by every notion consumer (additive provider-namespacing).
        assert.ok(routing.jira, "the unknown jira block is preserved (ignored, not rejected)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/18 FF-E: an unknown provider key WITHOUT a notion block reads cleanly (no notion routing, no throw)",
    async run() {
      // A descriptor that is ONLY an unknown provider ⇒ no notion routing, but no throw —
      // the reader is provider-tolerant, treating the absent notion block as "no routing".
      const { repo, item } = await makeItem({ jira: { project: "ABC" } });
      try {
        let routing;
        assert.doesNotThrow(() => {
          routing = readRouting(item);
        }, "a notion-less descriptor with an unknown provider does not throw");
        assert.equal(routing.notion, undefined, "there is no notion routing (the notion block is absent)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
