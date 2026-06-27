// Traceability wiring for milestone 18 / story 00, task 01 —
// tasks/01_boards-registry-and-default.feature (@executable, every scenario + every
// Scenario-Outline row). One test object per @executable scenario/row; ADR-001/002/003.
//
// resolveNotionRouting(item, notionConfig) is driven over temp fixtures: a descriptor
// naming a board resolves to that board's connection; an absent board ⇒ the configured
// default; a flat m17 block ⇒ the implicit default board; a parent KEY resolves against
// the CHOSEN board's parents; a raw page-id is verbatim; an unknown board / default is
// an honest RoutingError naming the available boards. PURELY from committed config — no
// Notion call. The SCHEMA-shape invariant (the registry validates at the Ajv seam) is
// FF-F (an arch-test authored in story 02), NOT asserted here.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveNotionRouting } from "../src/integrations/routing.mjs";

const board = (extra = {}) => ({
  dataSourceId: "ds-x",
  statusProperty: "Status",
  statusMap: { "not-started": "a", "in-progress": "b", "in-review": "c", done: "d" },
  relationProperty: "Sub",
  ...extra,
});

// The Background registry: boards "ops" and "growth", default "ops". Each board carries
// a distinct dataSourceId so the resolved connection is identifiable.
const REGISTRY = {
  default: "ops",
  boards: {
    ops: board({ dataSourceId: "ds-ops" }),
    growth: board({ dataSourceId: "ds-growth", parents: {} }),
  },
};

// A flat m17 block (no boards key) — the back-compat / implicit-default-board arm.
const FLAT = board({ dataSourceId: "ds-flat" });

// A fixture item: a folder on disk + an optional .integrations.json descriptor.
async function makeItem(descriptor) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-boards-registry-"));
  const dir = path.join(repo, "wiki", "work", "18_milestone_demo");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPEC.md"), "---\ntype: milestone\nnumber: 18\nslug: demo\n---\n", "utf8");
  if (descriptor !== undefined) {
    await writeFile(path.join(dir, ".integrations.json"), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  }
  const item = { type: "milestone", dir, ref: "18", parent: null };
  return { repo, item };
}

export const integrationsBoardsRegistryTests = [
  {
    // Scenario: a descriptor naming a board resolves to that board's connection
    name: "integrations-boards-registry/01 a descriptor naming a board resolves to that board's connection",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "growth" } });
      try {
        const resolved = resolveNotionRouting(item, REGISTRY);
        assert.equal(resolved.board.dataSourceId, "ds-growth", "the resolved board is growth's dataSourceId");
        assert.deepEqual(resolved.board.statusMap, REGISTRY.boards.growth.statusMap, "the growth statusMap is resolved");
        assert.equal(resolved.board.relationProperty, "Sub", "the growth relationProperty is resolved");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an item with no board falls back to the default board
    name: "integrations-boards-registry/01 an item with a parent but no board falls back to the default board ops",
    async run() {
      const { repo, item } = await makeItem({ notion: { parent: "11112222333344445555666677778888" } });
      try {
        const resolved = resolveNotionRouting(item, REGISTRY);
        assert.equal(resolved.board.dataSourceId, "ds-ops", "the resolved board is the default ops");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an item with no descriptor at all routes to the default board, top-level
    name: "integrations-boards-registry/01 an item with no descriptor routes to the default board, parent page id null",
    async run() {
      const { repo, item } = await makeItem(); // no .integrations.json
      try {
        const resolved = resolveNotionRouting(item, REGISTRY);
        assert.equal(resolved.board.dataSourceId, "ds-ops", "the resolved board is the default ops");
        assert.equal(resolved.parentPageId, null, "the resolved parent page id is null (top-level)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a flat milestone-17 config is treated as the implicit default board
    name: "integrations-boards-registry/01 a flat m17 config is the implicit default board (back-compat)",
    async run() {
      const { repo, item } = await makeItem(); // no descriptor
      try {
        const resolved = resolveNotionRouting(item, FLAT);
        assert.ok(resolved.board, "the resolve succeeds");
        assert.equal(resolved.board.dataSourceId, "ds-flat", "the flat block's dataSourceId is resolved");
        assert.deepEqual(resolved.board.statusMap, FLAT.statusMap, "the flat block's statusMap is resolved");
        assert.equal(resolved.board.relationProperty, "Sub", "the flat block's relationProperty is resolved");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a parent key resolves against the chosen board's parents map
    name: "integrations-boards-registry/01 a parent key resolves against the chosen board's parents map",
    async run() {
      const registry = {
        default: "ops",
        boards: {
          ops: board({ dataSourceId: "ds-ops" }),
          growth: board({ dataSourceId: "ds-growth", parents: { "q3-roadmap": "page-Q3" } }),
        },
      };
      const { repo, item } = await makeItem({ notion: { board: "growth", parent: "q3-roadmap" } });
      try {
        const resolved = resolveNotionRouting(item, registry);
        assert.equal(resolved.parentPageId, "page-Q3", "the parent key resolves against growth's parents map");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a raw page-id parent is used verbatim with no registry lookup
    name: "integrations-boards-registry/01 a raw page-id parent is used verbatim with no registry lookup",
    async run() {
      const { repo, item } = await makeItem({ notion: { parent: "11112222333344445555666677778888" } });
      try {
        const resolved = resolveNotionRouting(item, REGISTRY);
        assert.equal(resolved.parentPageId, "11112222333344445555666677778888", "the raw page-id is used verbatim");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline: an unresolvable board reference is an honest config error (both rows).
    // The two failure origins are distinguished by code; the error names the available boards.
    name: "integrations-boards-registry/01 an unresolvable board reference fails with a distinct code naming the available boards (both rows)",
    async run() {
      // Row 1: the descriptor names a board "ghost" absent from the registry ⇒ unknown-board-key
      {
        const { repo, item } = await makeItem({ notion: { board: "ghost" } });
        try {
          assert.throws(
            () => resolveNotionRouting(item, REGISTRY),
            (err) => {
              assert.equal(err.code, "unknown-board-key", "the code is unknown-board-key");
              assert.match(err.message, /"ops"/, "the error names the available board ops");
              assert.match(err.message, /"growth"/, "the error names the available board growth");
              return true;
            }
          );
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // Row 2: the config "default" names a board "ghost" absent from the registry ⇒ unknown-default-board
      {
        const badDefault = { default: "ghost", boards: REGISTRY.boards };
        const { repo, item } = await makeItem(); // no descriptor ⇒ falls to the (dangling) default
        try {
          assert.throws(
            () => resolveNotionRouting(item, badDefault),
            (err) => {
              assert.equal(err.code, "unknown-default-board", "the code is unknown-default-board");
              assert.match(err.message, /"ops"/, "the error names the available board ops");
              assert.match(err.message, /"growth"/, "the error names the available board growth");
              return true;
            }
          );
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },
];
