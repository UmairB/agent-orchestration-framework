// Fitness function for milestone 07 / ADR-004:
// "`work.ui.a11y` is OPTIONAL and CLOSED (additionalProperties:false), a peer to
//  work.ui.baseUrl; an absent block validates (absent ≡ default/off), an empty block
//  validates (level optional), and each documented level (A | AA | AAA) validates.
//  An unknown key inside the block, or a level outside the enum, fails validation on
//  the work.ui.a11y subtree. The lane opts IN via work.tags.domains containing "a11y"
//  — a plain free-string domain entry, so no schema change enables the lane."
//
// Pure schema assertion (Ajv-2020), mirroring acd-headroom-config-schema's schema gate
// (same compile helper, same archTests export shape, same keyword/instancePath assertions).
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
const ui = (block) => ({ ...base, work: { ui: block } });

export const archTests = [
  {
    name: "arch/ADR-004: an absent work.ui.a11y validates, an empty block validates, and each documented level (A/AA/AAA) validates",
    run: async () => {
      const validate = await compileSchema();

      assert.equal(validate(base), true, "an absent work.ui.a11y passes the schema (absent ≡ default/off)");
      assert.equal(validate({ ...base, work: {} }), true, "an absent work.ui under a present work passes");
      assert.equal(validate({ ...base, work: { ui: {} } }), true, "an absent a11y under a present work.ui passes");
      assert.equal(validate(ui({ a11y: {} })), true, "an empty work.ui.a11y block validates (level optional ≡ default AA)");
      assert.equal(validate(ui({ a11y: { level: "A" } })), true, "{ level:\"A\" } validates");
      assert.equal(validate(ui({ a11y: { level: "AA" } })), true, "{ level:\"AA\" } validates");
      assert.equal(validate(ui({ a11y: { level: "AAA" } })), true, "{ level:\"AAA\" } validates");
    }
  },
  {
    name: "arch/ADR-004: a11y is a peer-additive to baseUrl (both together validate), and \"a11y\" is a plain work.tags.domains opt-in (no schema change)",
    run: async () => {
      const validate = await compileSchema();

      assert.equal(
        validate(ui({ baseUrl: "http://localhost:5173", a11y: { level: "AA" } })),
        true,
        "baseUrl and a11y together under work.ui validate (a11y is a peer, not a replacement)"
      );
      assert.equal(
        validate({ ...base, work: { tags: { domains: ["a11y"] } } }),
        true,
        "\"a11y\" as a work.tags.domains entry validates with no schema change (the lane opt-in)"
      );
      assert.equal(
        validate({ ...base, work: { tags: { domains: ["@board", "a11y"] } } }),
        true,
        "\"a11y\" alongside other domains validates"
      );
    }
  },
  {
    name: "arch/ADR-004: work.ui.a11y is CLOSED — an unknown key inside the block fails on additionalProperties, pinned to /work/ui/a11y",
    run: async () => {
      const validate = await compileSchema();

      assert.equal(
        validate(ui({ a11y: { level: "AA", tool: "axe" } })),
        false,
        "an unknown key (tool) fails — work.ui.a11y is additionalProperties:false"
      );
      const toolErrors = validate.errors ?? [];
      assert.ok(
        toolErrors.some((e) => /\/work\/ui\/a11y$/.test(e.instancePath) && e.keyword === "additionalProperties"),
        "the unknown-key failure is on work.ui.a11y additionalProperties"
      );

      assert.equal(
        validate(ui({ a11y: { bogus: true } })),
        false,
        "a bare unknown key (bogus) fails — work.ui.a11y is additionalProperties:false"
      );
      const bogusErrors = validate.errors ?? [];
      assert.ok(
        bogusErrors.some((e) => /\/work\/ui\/a11y$/.test(e.instancePath) && e.keyword === "additionalProperties"),
        "the bogus-key failure is on work.ui.a11y additionalProperties"
      );
    }
  },
  {
    name: "arch/ADR-004: a level outside the enum (\"AAAA\", \"aa\") fails on the work.ui.a11y.level enum",
    run: async () => {
      const validate = await compileSchema();

      assert.equal(validate(ui({ a11y: { level: "AAAA" } })), false, "level:\"AAAA\" is rejected (outside the A/AA/AAA enum)");
      const tooLong = validate.errors ?? [];
      assert.ok(
        tooLong.some((e) => /\/work\/ui\/a11y\/level$/.test(e.instancePath) && e.keyword === "enum"),
        "the \"AAAA\" failure is on the work.ui.a11y.level enum"
      );

      assert.equal(validate(ui({ a11y: { level: "aa" } })), false, "level:\"aa\" is rejected (case-sensitive enum)");
      const wrongCase = validate.errors ?? [];
      assert.ok(
        wrongCase.some((e) => /\/work\/ui\/a11y\/level$/.test(e.instancePath) && e.keyword === "enum"),
        "the \"aa\" failure is on the work.ui.a11y.level enum"
      );
    }
  },
  {
    name: "arch/ADR-004: a wrong-type level (2) is rejected, pinned to work.ui.a11y.level (enum keyword — level is enum-only)",
    run: async () => {
      const validate = await compileSchema();

      assert.equal(validate(ui({ a11y: { level: 2 } })), false, "a non-string level (2) is rejected");
      const numErrors = validate.errors ?? [];
      assert.ok(
        numErrors.some((e) => /\/work\/ui\/a11y\/level$/.test(e.instancePath) && e.keyword === "enum"),
        "the wrong-type level failure is pinned to work.ui.a11y.level on the enum (level is enum-only — the work.headroom.mode precedent)"
      );
    }
  }
];
