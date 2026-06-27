// Traceability wiring for milestone 18 / story 02, task 01 —
// tasks/01_legacy-mechanism-removed.feature (@executable, every scenario + both
// Scenario-Outline Examples groups). One test object per @executable scenario/row;
// ADR-001/002/007.
//
// Two observable surfaces:
//   (1) PROJECTION — a milestone with a stray `notion: { parent: p1 }` in its SPEC.md
//       frontmatter AND no `.integrations.json` projects TOP-LEVEL (no parent relation):
//       frontmatter is no longer a routing source (the parser revert + the descriptor
//       being the sole routing source). Driven via resolveNotionRouting → projectMilestone,
//       the exact sync-work path, over an on-disk fixture.
//   (2) SCHEMA — compile aof.schema.json with Ajv-2020 (the acd-notion-parents-schema
//       compile idiom, NOT validateConfig): a per-board `parents` validates; a
//       notion-TOP-LEVEL `parents` peer to `boards` is REJECTED (a CLUSTER at instancePath
//       `/work/integrations/notion` — the closed-notion-block failure; the build-note
//       cluster idiom, matched as "some error at that path", NOT "exactly one
//       additionalProperties error"). The accept/reject matrix of the two supported arms.
//
// The full closedness / boards-registry invariant is FF-F (an arch-test authored in this
// story); these Thens assert the observable accept/reject + projection result.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNotionRouting } from "../src/integrations/routing.mjs";
import { projectMilestone } from "../src/notion/projection.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_URL = path.join(repoRoot, "schemas", "aof.schema.json");

// ----------------------------------------------------------- projection ----

const FULL_STATUS_MAP = {
  "not-started": "Not started",
  "in-progress": "In progress",
  "in-review": "In review",
  done: "Done",
};

// A flat m17 board connection (the implicit default board) the projection addresses.
const FLAT = {
  dataSourceId: "ds-ops",
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: FULL_STATUS_MAP,
  relationProperty: "Sub-tasks",
};

// Build a fixture milestone folder whose SPEC.md frontmatter carries a STRAY
// `notion: { parent: p1 }` and (deliberately) NO `.integrations.json` descriptor.
async function makeStrayMilestone() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-legacy-removed-"));
  const dir = path.join(repo, "wiki", "work", "18_milestone_demo");
  await mkdir(dir, { recursive: true });
  // The stray frontmatter routing key — post-revert it is a verbatim string, never read
  // for routing; NO `.integrations.json` exists alongside it.
  await writeFile(
    path.join(dir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 18\nslug: demo\nstatus: in-progress\nnotion: { parent: p1 }\n---\n# Demo\n",
    "utf8"
  );
  const item = { type: "milestone", dir, ref: "18", parent: null };
  return { repo, item };
}

function fixtureItems() {
  return [
    { ref: "18", type: "milestone", slug: "demo", meta: { title: "Demo", status: "in-progress" } },
    { ref: "18/00", type: "story", slug: "s", meta: { title: "Story", status: "in-progress" } },
  ];
}

const opFor = (plan, ref) => plan.ops.find((o) => o.ref === ref);

// ---------------------------------------------------------------- schema ----

async function compileSchema() {
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const schema = JSON.parse(await readFile(SCHEMA_URL, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

const base = { name: "x", resources: [] };
const cfg = (notion) => ({ ...base, work: { integrations: { notion } } });
const SM = { "not-started": "a", "in-progress": "b", "in-review": "c", done: "d" };
const flatBlock = (extra = {}) => ({
  dataSourceId: "ds",
  statusProperty: "S",
  statusMap: SM,
  relationProperty: "R",
  ...extra,
});
const boardEntry = (extra = {}) => ({
  dataSourceId: "ds-o",
  statusProperty: "S",
  statusMap: SM,
  relationProperty: "R",
  ...extra,
});

// The build-note cluster idiom: a rejected notion config reports SOME error at
// instancePath `/work/integrations/notion` (the closed-block additionalProperties / the
// oneOf failure / the arms' required errors) — NOT "exactly one additionalProperties
// error". Matched as "some error at that path".
function failsOnNotionBlock(validate) {
  const errs = validate.errors ?? [];
  return errs.some((e) => /^\/work\/integrations\/notion(\/|$)/.test(e.instancePath));
}

export const integrationsLegacyRemovedTests = [
  {
    // Scenario: a milestone with a stray notion.parent in frontmatter (and no descriptor)
    // routes nothing — the milestone op carries no parent relation; it projects top-level.
    name: "integrations-legacy-removed/01 a stray notion.parent in frontmatter (no descriptor) projects top-level (no parent relation)",
    async run() {
      const { repo, item } = await makeStrayMilestone();
      try {
        const routing = resolveNotionRouting(item, FLAT);
        // The stray frontmatter is NOT read for routing — the resolved parentPageId is null.
        assert.equal(routing.parentPageId, null, "the resolver reads no parent from the stray frontmatter (parentPageId null)");
        const plan = projectMilestone({
          items: fixtureItems(),
          config: routing.board,
          mapping: { dataSourceId: routing.board.dataSourceId, entries: {} },
          parentPageId: routing.parentPageId,
          reason: routing.reason,
        });
        const m = opFor(plan, "18");
        assert.equal(m.relation, undefined, "the milestone op carries no parent relation");
        assert.equal(m.properties.relation, undefined, "the milestone op's properties carry no relation");
        assert.equal(m.reason, undefined, "the milestone op records no honest reason (clean top-level, never a fabricated id)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a parents map declared per board remains valid at the Ajv seam
    name: "integrations-legacy-removed/01 a per-board parents map remains valid at the Ajv-2020 seam",
    async run() {
      const validate = await compileSchema();
      const ok = validate(cfg({ default: "ops", boards: { ops: boardEntry({ parents: { p1: "page-P1" } }) } }));
      assert.equal(ok, true, "a per-board parents map binding p1 → page-P1 validates");
    },
  },
  {
    // Scenario: a notion-top-level parents peer to the boards registry is rejected — the
    // failure is on the closed notion block (the cluster at /work/integrations/notion).
    name: "integrations-legacy-removed/01 a notion-top-level parents peer to the boards registry is rejected (failure on the closed notion block)",
    async run() {
      const validate = await compileSchema();
      const ok = validate(cfg({ default: "ops", boards: { ops: boardEntry() }, parents: { p1: "page-P1" } }));
      assert.equal(ok, false, "a top-level parents beside boards is rejected");
      assert.ok(
        failsOnNotionBlock(validate),
        "the failure is on the closed notion block (some error at /work/integrations/notion — the cluster idiom)"
      );
    },
  },
  {
    // Scenario Outline (Examples: the supported arms validate) — each row → one assertion.
    name: "integrations-legacy-removed/01 the notion config block accepts the two supported arms (every validates row)",
    async run() {
      const validate = await compileSchema();
      const rows = [
        { label: "a flat m17 block (back-compat)", notion: flatBlock() },
        { label: "a flat m17 block with its own parents map", notion: flatBlock({ parents: { p1: "page-P1" } }) },
        { label: "a { default, boards } registry", notion: { default: "ops", boards: { ops: boardEntry() } } },
        {
          label: "a { default, boards } registry with per-board parents",
          notion: { default: "ops", boards: { ops: boardEntry({ parents: { p1: "page-P1" } }) } },
        },
      ];
      for (const { label, notion } of rows) {
        assert.equal(validate(cfg(notion)), true, `${label} validates`);
      }
    },
  },
  {
    // Scenario Outline (Examples: the superseded / malformed / non-closed shapes are
    // rejected) — each row → one assertion, each failing on the notion block cluster.
    name: "integrations-legacy-removed/01 the notion config block rejects the superseded/malformed/non-closed shapes (every is-rejected row)",
    async run() {
      const validate = await compileSchema();
      const rows = [
        {
          label: "a { default, boards } registry plus a top-level parents",
          notion: { default: "ops", boards: { ops: boardEntry() }, parents: { p1: "page-P1" } },
        },
        {
          label: "a boards registry with a board missing its dataSourceId",
          notion: { default: "ops", boards: { ops: { statusProperty: "S", statusMap: SM, relationProperty: "R" } } },
        },
        {
          label: "a boards registry with an unknown peer on a board entry",
          notion: { default: "ops", boards: { ops: boardEntry({ mystery: true }) } },
        },
        { label: "a notion block carrying an unknown peer key", notion: flatBlock({ mystery: true }) },
      ];
      for (const { label, notion } of rows) {
        assert.equal(validate(cfg(notion)), false, `${label} is rejected`);
        assert.ok(failsOnNotionBlock(validate), `${label} fails on the notion block (cluster at /work/integrations/notion)`);
      }
    },
  },
];
