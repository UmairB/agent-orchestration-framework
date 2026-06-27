// Fitness function FF-C for milestone 18 / ADR-002 + ADR-003 (board resolution +
// default fallback + the no-regression arm):
//   Drive resolveNotionRouting (story 00's resolver) + projectMilestone (the pure
//   projection) over fixtures:
//     - a descriptor naming `board: X` resolves to X's connection;
//     - an absent `board` ⇒ the configured `default` board;
//     - an ABSENT descriptor ⇒ the default board, TOP-LEVEL, byte-for-byte m17 (the
//       no-regression arm — the resolved op equals the m17 op with no routing).
//
// This is the behaviour-driving fitness (not a source-grep): it exercises the real
// resolver + projection so a routing regression (wrong board, a fabricated parent on an
// unrouted milestone, a plan that diverges from m17) fails HERE. Subsumes the
// no-regression arm of the retired acd-notion-parent-projection.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveNotionRouting } from "../../src/integrations/routing.mjs";
import { projectMilestone } from "../../src/notion/projection.mjs";

const FULL_STATUS_MAP = {
  "not-started": "Not started",
  "in-progress": "In progress",
  "in-review": "In review",
  done: "Done",
};

// A board connection (m17 flat shape) with a distinct dataSourceId per board so the
// resolved board is identifiable.
const board = (extra = {}) => ({
  dataSourceId: "ds-x",
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: FULL_STATUS_MAP,
  relationProperty: "Sub-tasks",
  ...extra,
});

// The registry: boards "ops" and "growth", default "ops".
const REGISTRY = {
  default: "ops",
  boards: { ops: board({ dataSourceId: "ds-ops" }), growth: board({ dataSourceId: "ds-growth" }) },
};

// An EQUIVALENT flat m17 config (no boards key) — the implicit default board, the same
// connection as "ops" expressed in the single-board m17 shape (so the no-regression
// deep-equal is meaningful).
const FLAT = board({ dataSourceId: "ds-ops" });

function fixtureItems() {
  return [
    { ref: "18", type: "milestone", slug: "demo", meta: { title: "Demo", status: "in-progress" } },
    { ref: "18/00", type: "story", slug: "s", meta: { title: "Story", status: "in-progress" } },
  ];
}

const mapping = (dataSourceId, entries = {}) => ({ dataSourceId, entries });

async function makeItem(descriptor) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-ff-board-res-"));
  const dir = path.join(repo, "wiki", "work", "18_milestone_demo");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPEC.md"), "---\ntype: milestone\nnumber: 18\nslug: demo\n---\n", "utf8");
  if (descriptor !== undefined) {
    await writeFile(path.join(dir, ".integrations.json"), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  }
  const item = { type: "milestone", dir, ref: "18", parent: null };
  return { repo, item };
}

function projectVia(routing, items, sidecar) {
  return projectMilestone({
    items,
    config: routing.board,
    mapping: sidecar ?? mapping(routing.board.dataSourceId),
    parentPageId: routing.parentPageId,
    reason: routing.reason,
  });
}

const opFor = (plan, ref) => plan.ops.find((o) => o.ref === ref);

export const archTests = [
  {
    name: "arch/18 FF-C: a descriptor naming a board resolves to that board's connection",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "growth" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY);
        assert.equal(routing.board.dataSourceId, "ds-growth", "the descriptor's `board: growth` resolves to growth's connection");
        const plan = projectVia(routing, fixtureItems());
        assert.equal(plan.dataSourceId, "ds-growth", "the plan addresses the growth board's data-source");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/18 FF-C: an absent `board` in the descriptor ⇒ the configured default board",
    async run() {
      // A descriptor with a parent but NO board ⇒ the default board (ops).
      const { repo, item } = await makeItem({ notion: { parent: "11112222333344445555666677778888" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY);
        assert.equal(routing.board.dataSourceId, "ds-ops", "an absent `board` falls back to the default ops board");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/18 FF-C: an ABSENT descriptor ⇒ the default board, top-level, byte-for-byte m17 (the no-regression arm)",
    async run() {
      const { repo, item } = await makeItem(); // no .integrations.json
      try {
        const items = fixtureItems();
        // The boards-config path: resolve (default ops, no parent) then project.
        const planBoards = projectVia(resolveNotionRouting(item, REGISTRY), items);
        // The equivalent flat m17 path: the resolved op must be byte-for-byte identical.
        const planFlat = projectVia(resolveNotionRouting(item, FLAT), items);

        assert.equal(planBoards.dataSourceId, "ds-ops", "the absent-descriptor plan addresses the default ops board");
        assert.deepEqual(planBoards, planFlat, "the boards-config plan equals the flat m17 plan byte-for-byte (no regression)");
        const m = opFor(planBoards, "18");
        assert.equal(m.relation, undefined, "the unrouted milestone op carries no parent relation (top-level)");
        assert.equal(m.reason, undefined, "the unrouted milestone op records no reason (clean top-level)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
