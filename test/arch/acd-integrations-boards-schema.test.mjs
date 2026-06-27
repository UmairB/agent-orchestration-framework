// Fitness function FF-F for milestone 18 / ADR-002 (boards-registry schema at the
// Ajv-2020 seam):
//   Compile aof.schema.json with Ajv-2020 (the acd-notion-parents-schema /
//   acd-headroom-config-schema compile idiom, NOT validateConfig — the m17-retro-mandated
//   seam): the `notion` block is a closed `oneOf` of two MUTUALLY-EXCLUSIVE arms.
//     (a) a valid `{ default, boards: { k: {…} } }` registry validates;
//     (b) a flat back-compat m17 block validates (the oneOf admits both);
//     (c) a malformed board entry (missing dataSourceId, a non-string `parents` value, an
//         unknown peer on a board OR on the notion block) is REJECTED;
//     (d) the `notion` block stays CLOSED (an unknown peer rejected, the failure on the
//         closed block).
//
// validateConfig is hand-rolled per-field diagnostics that never compiles the JSON-Schema,
// so a schema-shape invariant is only enforced by compiling aof.schema.json with Ajv-2020.
// Supersedes acd-notion-parents-schema (becomes the boards-registry fitness).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SCHEMA_URL = new URL("../../schemas/aof.schema.json", import.meta.url);

async function compileSchema() {
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const schema = JSON.parse(await readFile(SCHEMA_URL, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

const base = { name: "x", resources: [] };
const cfg = (notion) => ({ ...base, work: { integrations: { notion } } });
const SM = { "not-started": "a", "in-progress": "b", "in-review": "c", done: "d" };

// A flat m17 connection block (the implicit default board arm).
const flat = (extra = {}) => ({
  dataSourceId: "ds",
  statusProperty: "Status",
  statusMap: SM,
  relationProperty: "Sub",
  ...extra,
});
// A single board entry (the per-board connection in the registry arm).
const boardEntry = (extra = {}) => ({
  dataSourceId: "ds-o",
  statusProperty: "Status",
  statusMap: SM,
  relationProperty: "Sub",
  ...extra,
});

// A rejected notion config fails on the closed notion block — SOME error at instancePath
// `/work/integrations/notion` (the additionalProperties / oneOf / arm-required cluster).
function failsOnNotionBlock(validate) {
  const errs = validate.errors ?? [];
  return errs.some((e) => /^\/work\/integrations\/notion(\/|$)/.test(e.instancePath));
}

export const archTests = [
  {
    name: "arch/18 FF-F (a)+(b): a valid boards registry validates; a flat back-compat m17 block validates (the oneOf admits both arms)",
    async run() {
      const validate = await compileSchema();
      assert.equal(
        validate(cfg({ default: "ops", boards: { ops: boardEntry() } })),
        true,
        "a valid { default, boards: { ops: {…} } } registry validates"
      );
      assert.equal(
        validate(cfg({ default: "ops", boards: { ops: boardEntry({ parents: { p1: "page-P1" } }) } })),
        true,
        "a registry with a per-board parents map validates"
      );
      assert.equal(validate(cfg(flat())), true, "a flat back-compat m17 block validates (the oneOf)");
      assert.equal(validate(cfg(flat({ parents: { p1: "page-P1" } }))), true, "a flat m17 block with its own parents validates");
    },
  },
  {
    name: "arch/18 FF-F (c): a malformed board entry is rejected (missing dataSourceId, a non-string parents value, an unknown peer on a board)",
    async run() {
      const validate = await compileSchema();
      // A board missing its required dataSourceId.
      assert.equal(
        validate(cfg({ default: "ops", boards: { ops: { statusProperty: "S", statusMap: SM, relationProperty: "R" } } })),
        false,
        "a board entry missing dataSourceId is rejected"
      );
      assert.ok(failsOnNotionBlock(validate), "the missing-dataSourceId failure is on the notion block cluster");
      // A non-string per-board parents value.
      assert.equal(
        validate(cfg({ default: "ops", boards: { ops: boardEntry({ parents: { p1: 7 } }) } })),
        false,
        "a non-string per-board parents value is rejected"
      );
      // An unknown peer on a board entry (the entry is closed).
      assert.equal(
        validate(cfg({ default: "ops", boards: { ops: boardEntry({ mystery: true }) } })),
        false,
        "an unknown peer on a board entry is rejected (the board entry stays closed)"
      );
    },
  },
  {
    name: "arch/18 FF-F (d): the notion block stays closed — an unknown peer on the notion block is rejected (the failure on the closed block)",
    async run() {
      const validate = await compileSchema();
      // An unknown peer beside a flat block.
      assert.equal(validate(cfg(flat({ mystery: true }))), false, "an unknown peer on a flat notion block is rejected");
      assert.ok(failsOnNotionBlock(validate), "the unknown-peer failure is on the closed notion block");
      // The superseded prior-m18 shape: a notion-top-level `parents` peer to `boards`.
      assert.equal(
        validate(cfg({ default: "ops", boards: { ops: boardEntry() }, parents: { p1: "page-P1" } })),
        false,
        "a notion-top-level parents peer to the boards registry is rejected (the global map is gone — parents is per board)"
      );
      assert.ok(failsOnNotionBlock(validate), "the top-level-parents failure is on the closed notion block");
    },
  },
];
