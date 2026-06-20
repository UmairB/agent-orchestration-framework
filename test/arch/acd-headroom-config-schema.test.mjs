// Fitness function for milestone 06 / ADR-001 + ADR-002:
// "`work.headroom` is OPTIONAL and CLOSED (additionalProperties:false); a v0 block
//  (enabled:true, mode:"wrap", providers subset of the routable set) validates and an
//  absent block validates; `mode:"proxy"`, any other mode value, an unknown key, or a
//  non-routable provider ("gemini") fails validation on the work.headroom subtree."
//
// RED-until-built and CORRECT: the `work.headroom` $def does not exist in
// schemas/aof.schema.json yet. This test goes GREEN the moment the config-shape
// story adds the new object under $defs/work; until then the negative cases pass
// (unknown keys aren't rejected because work.additionalProperties is true) so the
// positive/closed assertions below fail — that red is the intended signal that the
// schema change is outstanding, not a test bug.
//
// Pure schema assertion (Ajv-2020), mirroring acd-memory-backend-selection's schema gate.
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
const headroom = (block) => ({ ...base, work: { headroom: block } });

export const archTests = [
  {
    name: "arch/ADR-001: a v0 work.headroom block (enabled, mode:wrap, routable providers) validates, and an absent block validates",
    run: async () => {
      const validate = await compileSchema();

      assert.equal(validate(base), true, "an absent work.headroom passes the schema (absent ≡ off)");
      assert.equal(validate({ ...base, work: {} }), true, "an absent work.headroom under a present work passes");
      assert.equal(
        validate(headroom({ enabled: true, mode: "wrap", providers: ["claude", "codex"] })),
        true,
        "the full v0 block validates"
      );
      assert.equal(validate(headroom({ enabled: false })), true, "{ enabled:false } validates (off-state)");
      assert.equal(validate(headroom({ enabled: true })), true, "enabled with defaulted mode/providers validates");
    }
  },
  {
    name: "arch/ADR-002: mode:\"proxy\" (and any non-wrap mode) fails validation on the work.headroom mode enum",
    run: async () => {
      const validate = await compileSchema();

      assert.equal(validate(headroom({ enabled: true, mode: "proxy" })), false, "mode:\"proxy\" is rejected at the schema (designed-not-shipped)");
      const proxyErrors = validate.errors ?? [];
      assert.ok(
        proxyErrors.some((e) => /\/work\/headroom\/mode$/.test(e.instancePath) && e.keyword === "enum"),
        "the proxy failure is on the work.headroom.mode enum"
      );

      assert.equal(validate(headroom({ enabled: true, mode: "bogus" })), false, "an unknown mode value fails the enum");
    }
  },
  {
    name: "arch/ADR-001: work.headroom is CLOSED — an unknown key, and a non-routable provider (\"gemini\"), fail validation",
    run: async () => {
      const validate = await compileSchema();

      assert.equal(validate(headroom({ enabled: true, port: 8080 })), false, "an unknown key (port) fails — work.headroom is additionalProperties:false");
      const keyErrors = validate.errors ?? [];
      assert.ok(
        keyErrors.some((e) => /\/work\/headroom$/.test(e.instancePath) && e.keyword === "additionalProperties"),
        "the unknown-key failure is on work.headroom additionalProperties"
      );

      assert.equal(
        validate(headroom({ enabled: true, mode: "wrap", providers: ["gemini"] })),
        false,
        "providers:[\"gemini\"] fails — gemini is never a routable headroom provider (ADR-003)"
      );
    }
  }
];
