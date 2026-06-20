// Traceability tests (@executable step definitions) for milestone 06 / story 00 —
// headroom-config-contract. One file covering the @executable scenarios of all three
// task features:
//   - tasks/00_config-schema-shape.feature        → schema validate/reject outcomes
//   - tasks/01_resolve-launch-passthrough.feature → resolver branches 1–3 (off/not-routable/degrade)
//   - tasks/02_resolve-launch-wrap.feature        → resolver branch 4 (wrap)
//
// Each test name traces to its feature + scenario. The schema scenarios compile
// schemas/aof.schema.json with Ajv-2020 exactly as acd-headroom-config-schema does; the
// resolver scenarios import resolveHeadroomLaunch from ../src/headroom.mjs and stub `which`.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveHeadroomLaunch } from "../src/headroom.mjs";

const SCHEMA_URL = new URL("../schemas/aof.schema.json", import.meta.url);

// Compile the real schema with the same Ajv-2020 setup the schema arch-test uses, so
// the validate/reject outcomes — and the cited keyword/instancePath — are asserted
// against the validator the project ships with.
async function compileSchema() {
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const schema = JSON.parse(await readFile(SCHEMA_URL, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

// A minimal valid base config (name + resources are required by the root schema); each
// scenario merges its work.headroom block onto it. "absent" ≡ no work.headroom key.
const BASE = { name: "x", resources: [] };
const withHeadroom = (block) => ({ ...BASE, work: { headroom: block } });

// `which` stubs for the resolver scenarios (no real PATH walk).
const headroomAt = (path) => (bin) => (bin === "headroom" ? path : null);
const HEADROOM_PATH = "/usr/local/bin/headroom";
const whichPresent = headroomAt(HEADROOM_PATH);
const whichAbsent = () => null;

export const headroomConfigContractTests = [
  // ───────────────────────────────────────────────────────────────────────────────
  // tasks/00_config-schema-shape.feature — validate/reject outcomes + cited keywords
  // ───────────────────────────────────────────────────────────────────────────────
  {
    name: "headroom/00 schema: the full frozen block { enabled, mode:wrap, providers } validates",
    async run() {
      const validate = await compileSchema();
      assert.equal(
        validate(withHeadroom({ enabled: true, mode: "wrap", providers: ["claude", "codex"] })),
        true,
        "the full v0 block validates"
      );
    },
  },
  {
    name: "headroom/00 schema: a config with no work.headroom key validates (absent ≡ off)",
    async run() {
      const validate = await compileSchema();
      assert.equal(validate(BASE), true, "an absent work.headroom passes (absent ≡ off)");
      assert.equal(validate({ ...BASE, work: {} }), true, "an absent block under a present work passes");
    },
  },
  {
    name: "headroom/00 schema: an enabled block with no mode key validates (mode defaults to wrap at runtime)",
    async run() {
      const validate = await compileSchema();
      assert.equal(validate(withHeadroom({ enabled: true })), true, "a mode-less enabled block is schema-valid");
    },
  },
  {
    name: "headroom/00 schema: mode \"proxy\" is rejected on the work.headroom.mode enum",
    async run() {
      const validate = await compileSchema();
      assert.equal(validate(withHeadroom({ enabled: true, mode: "proxy" })), false, "mode:\"proxy\" is rejected");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => /\/work\/headroom\/mode$/.test(e.instancePath) && e.keyword === "enum"),
        "the proxy failure cites the work.headroom.mode enum"
      );
    },
  },
  {
    name: "headroom/00 schema: any mode outside the v0 enum (\"turbo\") is rejected on the work.headroom.mode enum",
    async run() {
      const validate = await compileSchema();
      assert.equal(validate(withHeadroom({ enabled: true, mode: "turbo" })), false, "mode:\"turbo\" is rejected");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => /\/work\/headroom\/mode$/.test(e.instancePath) && e.keyword === "enum"),
        "the non-wrap mode failure cites the work.headroom.mode enum"
      );
    },
  },
  {
    name: "headroom/00 schema: an unknown key (port) inside work.headroom is rejected on the work.headroom additionalProperties keyword",
    async run() {
      const validate = await compileSchema();
      assert.equal(validate(withHeadroom({ enabled: true, port: 8080 })), false, "an unknown key is rejected");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some(
          (e) =>
            /\/work\/headroom$/.test(e.instancePath) &&
            e.keyword === "additionalProperties" &&
            e.params?.additionalProperty === "port"
        ),
        "the unknown-key failure cites the PARENT work.headroom additionalProperties keyword (additionalProperty:port)"
      );
    },
  },
  {
    name: "headroom/00 schema: \"gemini\" listed in providers is rejected on the work.headroom.providers items enum",
    async run() {
      const validate = await compileSchema();
      assert.equal(validate(withHeadroom({ enabled: true, providers: ["gemini"] })), false, "providers:[\"gemini\"] is rejected");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => /\/work\/headroom\/providers\/0$/.test(e.instancePath) && e.keyword === "enum"),
        "the gemini failure cites the work.headroom.providers items enum (at /providers/0)"
      );
    },
  },
  {
    // Scenario Outline: a work.headroom block validates only when it matches the frozen v0 shape.
    name: "headroom/00 schema [outline]: each frozen-shape/absent row validates and each non-wrap/unknown-key/gemini row is rejected",
    async run() {
      const validate = await compileSchema();
      const rows = [
        // valid — the frozen shape and an absent block
        { config: withHeadroom({ enabled: true, mode: "wrap", providers: ["claude", "codex"] }), outcome: true },
        { config: withHeadroom({ enabled: true }), outcome: true },
        { config: BASE, outcome: true }, // "absent"
        // rejected — a non-wrap mode, an unknown key, or gemini
        { config: withHeadroom({ enabled: true, mode: "proxy" }), outcome: false },
        { config: withHeadroom({ enabled: true, mode: "turbo" }), outcome: false },
        { config: withHeadroom({ enabled: true, port: 8080 }), outcome: false },
        { config: withHeadroom({ enabled: true, providers: ["gemini"] }), outcome: false },
      ];
      for (const { config, outcome } of rows) {
        assert.equal(validate(config), outcome, `validation outcome for ${JSON.stringify(config.work?.headroom ?? "absent")}`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // tasks/01_resolve-launch-passthrough.feature — branches 1–3 return raw, wrapped:false
  // Background: raw launch is bin "/usr/bin/claude" and args [] (per-scenario rawBin varies).
  // ───────────────────────────────────────────────────────────────────────────────
  {
    name: "headroom/01 passthrough: plugin absent — no work.headroom returns the raw launch unchanged",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "claude",
        config: { ...BASE }, // no work.headroom
        rawBin: "/usr/bin/claude",
        rawArgs: [],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: "/usr/bin/claude", args: [], wrapped: false });
    },
  },
  {
    name: "headroom/01 passthrough: plugin disabled — enabled:false returns the raw launch unchanged",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "claude",
        config: { work: { headroom: { enabled: false, providers: ["claude"] } } },
        rawBin: "/usr/bin/claude",
        rawArgs: [],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: "/usr/bin/claude", args: [], wrapped: false });
    },
  },
  {
    name: "headroom/01 passthrough: gemini is never routable — raw unchanged even when enabled and listed in providers",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "gemini",
        config: { work: { headroom: { enabled: true, providers: ["gemini"] } } },
        rawBin: "/usr/bin/gemini",
        rawArgs: [],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: "/usr/bin/gemini", args: [], wrapped: false });
    },
  },
  {
    name: "headroom/01 passthrough: a provider outside the configured subset returns the raw launch unchanged",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "codex",
        config: { work: { headroom: { enabled: true, providers: ["claude"] } } },
        rawBin: "/usr/bin/codex",
        rawArgs: [],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: "/usr/bin/codex", args: [], wrapped: false });
    },
  },
  {
    name: "headroom/01 passthrough: enabled and routable but headroom not on PATH degrades to the raw launch",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "claude",
        config: { work: { headroom: { enabled: true, providers: ["claude"] } } },
        rawBin: "/usr/bin/claude",
        rawArgs: [],
        env: {},
        which: whichAbsent,
      });
      assert.deepEqual(result, { bin: "/usr/bin/claude", args: [], wrapped: false });
    },
  },
  {
    // Scenario Outline: off, not-routable, and degrade branches all return the raw launch unchanged.
    name: "headroom/01 passthrough [outline]: every branch-1/2/3 row returns rawBin, args [], wrapped:false",
    async run() {
      const rows = [
        // branch 1 — absent or disabled returns raw
        { config: { ...BASE }, provider: "claude", onPath: true, rawBin: "/usr/bin/claude" },
        { config: { work: { headroom: { enabled: false } } }, provider: "claude", onPath: true, rawBin: "/usr/bin/claude" },
        // branch 2 — not in routable set returns raw (gemini never routable)
        { config: { work: { headroom: { enabled: true, providers: ["gemini"] } } }, provider: "gemini", onPath: true, rawBin: "/usr/bin/gemini" },
        { config: { work: { headroom: { enabled: true } } }, provider: "gemini", onPath: true, rawBin: "/usr/bin/gemini" },
        { config: { work: { headroom: { enabled: true, providers: ["claude"] } } }, provider: "codex", onPath: true, rawBin: "/usr/bin/codex" },
        // branch 3 — enabled + routable but headroom absent from PATH degrades to raw
        { config: { work: { headroom: { enabled: true, providers: ["claude"] } } }, provider: "claude", onPath: false, rawBin: "/usr/bin/claude" },
        { config: { work: { headroom: { enabled: true } } }, provider: "codex", onPath: false, rawBin: "/usr/bin/codex" },
      ];
      for (const { config, provider, onPath, rawBin } of rows) {
        const result = resolveHeadroomLaunch({
          providerId: provider,
          config,
          rawBin,
          rawArgs: [],
          env: {},
          which: onPath ? whichPresent : whichAbsent,
        });
        assert.equal(result.bin, rawBin, `result bin is rawBin for ${provider} / ${JSON.stringify(config.work?.headroom ?? "absent")}`);
        assert.deepEqual(result.args, [], "result args are []");
        assert.equal(result.wrapped, false, "wrapped is false");
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // tasks/02_resolve-launch-wrap.feature — branch 4: enabled + routable + on PATH wraps
  // Background: headroom resolves on PATH to "/usr/local/bin/headroom".
  // ───────────────────────────────────────────────────────────────────────────────
  {
    name: "headroom/02 wrap: an enabled routable claude session wraps to headroom wrap claude",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "claude",
        config: { work: { headroom: { enabled: true, providers: ["claude", "codex"] } } },
        rawBin: "/usr/bin/claude",
        rawArgs: [],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: HEADROOM_PATH, args: ["wrap", "claude"], wrapped: true });
    },
  },
  {
    name: "headroom/02 wrap: an enabled routable codex session wraps to headroom wrap codex",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "codex",
        config: { work: { headroom: { enabled: true, providers: ["claude", "codex"] } } },
        rawBin: "/usr/bin/codex",
        rawArgs: [],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: HEADROOM_PATH, args: ["wrap", "codex"], wrapped: true });
    },
  },
  {
    name: "headroom/02 wrap: non-empty raw args flow through after wrap provider",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "claude",
        config: { work: { headroom: { enabled: true, providers: ["claude"] } } },
        rawBin: "/usr/bin/claude",
        rawArgs: ["--foo"],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: HEADROOM_PATH, args: ["wrap", "claude", "--foo"], wrapped: true });
    },
  },
  {
    name: "headroom/02 wrap: an enabled block with no providers key wraps claude (default subset)",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "claude",
        config: { work: { headroom: { enabled: true } } },
        rawBin: "/usr/bin/claude",
        rawArgs: [],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: HEADROOM_PATH, args: ["wrap", "claude"], wrapped: true });
    },
  },
  {
    name: "headroom/02 wrap: an enabled block with no providers key wraps codex (default subset)",
    async run() {
      const result = resolveHeadroomLaunch({
        providerId: "codex",
        config: { work: { headroom: { enabled: true } } },
        rawBin: "/usr/bin/codex",
        rawArgs: [],
        env: {},
        which: whichPresent,
      });
      assert.deepEqual(result, { bin: HEADROOM_PATH, args: ["wrap", "codex"], wrapped: true });
    },
  },
  {
    // Scenario Outline: enabled + routable + headroom on PATH wraps to `headroom wrap <provider> ...rawArgs`.
    name: "headroom/02 wrap [outline]: every branch-4 row wraps to { bin: headroom, args: [wrap, provider, ...rawArgs], wrapped: true }",
    async run() {
      const rows = [
        // empty raw args — wrap <provider> only
        { config: { work: { headroom: { enabled: true, providers: ["claude", "codex"] } } }, provider: "claude", rawBin: "/usr/bin/claude", rawArgs: [], wrappedArgs: ["wrap", "claude"] },
        { config: { work: { headroom: { enabled: true, providers: ["claude", "codex"] } } }, provider: "codex", rawBin: "/usr/bin/codex", rawArgs: [], wrappedArgs: ["wrap", "codex"] },
        // non-empty raw args flow through after wrap <provider>
        { config: { work: { headroom: { enabled: true, providers: ["claude"] } } }, provider: "claude", rawBin: "/usr/bin/claude", rawArgs: ["--foo"], wrappedArgs: ["wrap", "claude", "--foo"] },
        { config: { work: { headroom: { enabled: true, providers: ["codex"] } } }, provider: "codex", rawBin: "/usr/bin/codex", rawArgs: ["--bar", "baz"], wrappedArgs: ["wrap", "codex", "--bar", "baz"] },
        // absent providers key defaults to both routable providers (each wraps)
        { config: { work: { headroom: { enabled: true } } }, provider: "claude", rawBin: "/usr/bin/claude", rawArgs: [], wrappedArgs: ["wrap", "claude"] },
        { config: { work: { headroom: { enabled: true } } }, provider: "codex", rawBin: "/usr/bin/codex", rawArgs: [], wrappedArgs: ["wrap", "codex"] },
      ];
      for (const { config, provider, rawBin, rawArgs, wrappedArgs } of rows) {
        const result = resolveHeadroomLaunch({
          providerId: provider,
          config,
          rawBin,
          rawArgs,
          env: {},
          which: whichPresent,
        });
        assert.deepEqual(
          result,
          { bin: HEADROOM_PATH, args: wrappedArgs, wrapped: true },
          `branch-4 wrap for ${provider} with rawArgs ${JSON.stringify(rawArgs)}`
        );
      }
    },
  },
];
