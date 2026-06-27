// Traceability wiring for milestone 18 / story 00, task 00 —
// tasks/00_routing-reader.feature (@executable, every scenario + every Scenario-Outline
// row). One test object per @executable scenario/row; ADR-001/003.
//
// readRouting(item) reads the per-folder .integrations.json with JSON.parse over a temp
// fixture (no real workspace): an absent/malformed file ⇒ {} (no throw), an unknown
// provider block is ignored, an AOF.md-class (imported) milestone is read first-class,
// and a notion parent is classified by UUID shape (raw page-id vs key). The STRUCTURAL
// "uses JSON.parse / no parseFrontmatter" + "unknown-provider-tolerant" invariants are
// FF-B / FF-E (arch-tests authored in story 02), NOT asserted here.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readRouting, classifyParent } from "../src/integrations/routing.mjs";

// A fixture work item: a folder on disk plus the listItems()-shaped { dir, type } the
// reader resolves the descriptor path from (recordDoc semantics — item.dir + the record
// doc; the descriptor is a sibling of that doc).
async function makeItem({ doc = "SPEC.md", descriptor, malformed } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-routing-reader-"));
  const dir = path.join(repo, "wiki", "work", "18_milestone_demo");
  await mkdir(dir, { recursive: true });
  // A record doc so recordDoc(item) resolves (AOF.md-first for an imported milestone).
  await writeFile(path.join(dir, doc), "---\ntype: milestone\nnumber: 18\nslug: demo\n---\n# Demo\n", "utf8");
  if (descriptor !== undefined) {
    const body = malformed ? descriptor : `${JSON.stringify(descriptor, null, 2)}\n`;
    await writeFile(path.join(dir, ".integrations.json"), body, "utf8");
  }
  const item = { type: "milestone", dir, ref: "18", parent: null };
  return { repo, item };
}

export const integrationsRoutingReaderTests = [
  {
    // Scenario: a folder carrying a notion descriptor yields its routing
    name: "integrations-routing-reader/00 a folder carrying a notion descriptor yields its board + parent",
    async run() {
      const { repo, item } = await makeItem({ descriptor: { notion: { board: "ops", parent: "p1" } } });
      try {
        const routing = readRouting(item);
        assert.equal(routing.notion?.board, "ops", "the routing's notion board is ops");
        assert.equal(routing.notion?.parent, "p1", "the routing's notion parent is p1");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an absent descriptor is "no routing", not an error
    name: "integrations-routing-reader/00 an absent descriptor reads as {} without throwing (no notion block)",
    async run() {
      const { repo, item } = await makeItem(); // no .integrations.json written
      try {
        let routing;
        assert.doesNotThrow(() => { routing = readRouting(item); }, "the read succeeds without throwing");
        assert.equal(routing.notion, undefined, "the routing has no notion block");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a malformed descriptor is tolerated as "no routing"
    name: "integrations-routing-reader/00 a malformed (non-JSON) descriptor is tolerated as {} (no notion block)",
    async run() {
      const { repo, item } = await makeItem({ descriptor: "{ this is : not valid json ,,", malformed: true });
      try {
        let routing;
        assert.doesNotThrow(() => { routing = readRouting(item); }, "the read succeeds without throwing");
        assert.equal(routing.notion, undefined, "the routing has no notion block");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an unknown provider block is ignored, not a hard failure (FF-E behaviour)
    name: "integrations-routing-reader/00 an unknown provider block is ignored — the notion routing is still read",
    async run() {
      const { repo, item } = await makeItem({
        descriptor: { notion: { board: "ops", parent: "p1" }, jira: { project: "ABC", board: 17 } },
      });
      try {
        let routing;
        assert.doesNotThrow(() => { routing = readRouting(item); }, "the unknown jira block does not cause an error");
        assert.ok(routing.notion && routing.notion.board, "the routing's notion board is present");
        assert.equal(routing.notion.board, "ops", "the notion routing is read despite the unknown peer");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an AOF.md-class (imported) milestone's descriptor is read first-class
    name: "integrations-routing-reader/00 an AOF.md-class (imported) milestone's descriptor is read first-class",
    async run() {
      const { repo, item } = await makeItem({ doc: "AOF.md", descriptor: { notion: { parent: "p1" } } });
      try {
        const routing = readRouting(item);
        assert.equal(routing.notion?.parent, "p1", "the descriptor in an AOF.md-class folder is read");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline: a notion parent is classified by shape — raw page-id vs key
    // (every Examples row → one assertion). The reader resolves the parent value; the
    // classifier disambiguates by the ^[0-9a-fA-F]{32}$-after-stripping-dashes boundary.
    name: "integrations-routing-reader/00 a notion parent is classified by UUID shape — raw page-id vs key (every outline row)",
    async run() {
      const rows = [
        // a 32-hex UUID (dashed or compact) is a raw page-id used verbatim
        { parent: "11112222333344445555666677778888", kind: "raw page-id" },
        { parent: "1111aaaa-2222-3333-4444-555566667777", kind: "raw page-id" },
        // any other string is a key
        { parent: "phase-alpha", kind: "key" },
        { parent: "q3-roadmap", kind: "key" },
        // a near-miss of the UUID shape falls cleanly to "key" (the boundary)
        { parent: "1111222233334444555566667777888", kind: "key" }, // 31 hex
        { parent: "111122223333444455556666777788889", kind: "key" }, // 33 hex
        { parent: "1111222233334444555566667777888g", kind: "key" }, // 32 chars, a non-hex 'g'
      ];
      for (const { parent, kind } of rows) {
        const { repo, item } = await makeItem({ descriptor: { notion: { parent } } });
        try {
          const routing = readRouting(item);
          const classified = classifyParent(routing.notion?.parent);
          assert.equal(classified, kind, `parent "${parent}" is treated as a ${kind} (got "${classified}")`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
];
