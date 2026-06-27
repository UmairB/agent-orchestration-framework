// Traceability wiring for milestone 17 / story 02, task 00 —
// tasks/00_config-block-validates.feature (@executable, all scenarios).
//
// The acceptance authority for the work.integrations.notion block's SHAPE is the
// schema ITSELF — compiled in-process with Ajv-2020 (the milestone-06 idiom,
// acd-headroom-config-schema.test.mjs) — because validateConfig does no work.*
// subtree validation. Every @executable scenario / Scenario-Outline row → one
// assertion here, tracing to feature + scenario.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const SCHEMA_URL = new URL("../schemas/aof.schema.json", import.meta.url);

async function compileSchema() {
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const schema = JSON.parse(await readFile(SCHEMA_URL, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

const base = { name: "x", resources: [] };

// A well-formed work.integrations.notion block (the frozen ADR-004 shape).
const FULL_NOTION = {
  dataSourceId: "ds-123",
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: {
    "not-started": "Not started",
    "in-progress": "In progress",
    "in-review": "In review",
    done: "Done",
  },
  relationProperty: "Sub-tasks",
};

const withNotion = (notion) => ({ ...base, work: { integrations: { notion } } });

// Did any error point at the notion subtree path containing `fragment`?
function errorAt(errors, fragment) {
  return (errors ?? []).some((e) => (e.instancePath ?? "").includes(fragment) || JSON.stringify(e).includes(fragment));
}

export const notionConfigSchemaTests = [
  {
    // Scenario: a well-formed work.integrations.notion block validates.
    name: "notion-config/00 a well-formed work.integrations.notion block validates",
    async run() {
      const validate = await compileSchema();
      assert.equal(validate(withNotion(FULL_NOTION)), true, "the full frozen block validates");
      const notionErrors = (validate.errors ?? []).filter((e) => (e.instancePath ?? "").includes("/integrations/notion"));
      assert.equal(notionErrors.length, 0, "no validation error against work.integrations.notion");
      // Absent integrations also validates (opt-in: absent ≡ off).
      assert.equal(validate(base), true, "an absent integrations block validates (absent ≡ off)");
    },
  },

  {
    // Scenario: a statusMap missing an aof status is rejected naming in-review.
    name: "notion-config/00 a statusMap missing the in-review entry is rejected naming it",
    async run() {
      const validate = await compileSchema();
      const { "in-review": _omitted, ...partialMap } = FULL_NOTION.statusMap;
      const cfg = withNotion({ ...FULL_NOTION, statusMap: partialMap });
      assert.equal(validate(cfg), false, "a statusMap missing in-review is rejected");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some(
          (e) =>
            e.keyword === "required" &&
            e.params?.missingProperty === "in-review" &&
            (e.instancePath ?? "").includes("/integrations/notion/statusMap")
        ),
        `the error names the missing statusMap entry for in-review — got: ${JSON.stringify(errors)}`
      );
    },
  },

  {
    // Scenario: a block carrying a token-value field is rejected as an unknown property.
    name: "notion-config/00 a block with a token-value field is rejected as an unknown property",
    async run() {
      const validate = await compileSchema();
      const cfg = withNotion({ ...FULL_NOTION, token: "secret-ntn_abc123" });
      assert.equal(validate(cfg), false, "a literal token field is rejected");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some(
          (e) =>
            e.keyword === "additionalProperties" &&
            e.params?.additionalProperty === "token" &&
            (e.instancePath ?? "").includes("/integrations/notion")
        ),
        `the error names "token" as an unknown additional property on work.integrations.notion — got: ${JSON.stringify(errors)}`
      );
      // No schema-defined field holds a token value — only tokenEnv (the env-var NAME).
      const schema = JSON.parse(await readFile(SCHEMA_URL, "utf8"));
      const notionProps = schema.$defs.work.properties.integrations.properties.notion.properties;
      assert.ok(notionProps.tokenEnv, "tokenEnv (the env-var NAME) is the only auth field");
      assert.ok(!notionProps.token, "no schema-defined `token` field exists (no committed secret)");
    },
  },

  {
    // Scenario Outline: the block validates only when well-formed, else rejected
    // naming the offending field (every Examples row → one assertion).
    name: "notion-config/00 the block validates only when well-formed, else rejected naming the offending field (matrix)",
    async run() {
      const validate = await compileSchema();
      const rows = [
        {
          shape: "well-formed (all fields, four-status map)",
          mutate: (n) => n,
          outcome: true,
        },
        {
          shape: "missing dataSourceId",
          mutate: ({ dataSourceId, ...rest }) => rest,
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "required" && e.params?.missingProperty === "dataSourceId"), "names missing dataSourceId"),
        },
        {
          shape: "missing statusProperty",
          mutate: ({ statusProperty, ...rest }) => rest,
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "required" && e.params?.missingProperty === "statusProperty"), "names missing statusProperty"),
        },
        {
          shape: "missing statusMap",
          mutate: ({ statusMap, ...rest }) => rest,
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "required" && e.params?.missingProperty === "statusMap"), "names missing statusMap"),
        },
        {
          shape: "missing relationProperty",
          mutate: ({ relationProperty, ...rest }) => rest,
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "required" && e.params?.missingProperty === "relationProperty"), "names missing relationProperty"),
        },
        {
          shape: "dataSourceId is a number, not a string",
          mutate: (n) => ({ ...n, dataSourceId: 42 }),
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "type" && (e.instancePath ?? "").endsWith("/dataSourceId")), "names dataSourceId wrong type"),
        },
        {
          shape: "statusMap is a string, not an object",
          mutate: (n) => ({ ...n, statusMap: "Not started" }),
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "type" && (e.instancePath ?? "").endsWith("/statusMap")), "names statusMap wrong type"),
        },
        {
          shape: "statusMap value is a number, not a board name",
          mutate: (n) => ({ ...n, statusMap: { ...n.statusMap, done: 3 } }),
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "type" && (e.instancePath ?? "").includes("/statusMap/done")), "names the statusMap entry wrong type"),
        },
        {
          shape: 'adds an unknown "databaseId" property',
          mutate: (n) => ({ ...n, databaseId: "db-x" }),
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "additionalProperties" && e.params?.additionalProperty === "databaseId"), "names databaseId as unknown"),
        },
        {
          shape: 'adds a "token" property holding a secret value',
          mutate: (n) => ({ ...n, token: "ntn_secret" }),
          outcome: false,
          offending: (errors) => assert.ok(errors.some((e) => e.keyword === "additionalProperties" && e.params?.additionalProperty === "token"), "names token as unknown"),
        },
      ];

      for (const { shape, mutate, outcome, offending } of rows) {
        const cfg = withNotion(mutate({ ...FULL_NOTION, statusMap: { ...FULL_NOTION.statusMap } }));
        const valid = validate(cfg);
        assert.equal(valid, outcome, `shape "${shape}" → ${outcome ? "accepted" : "rejected"} (got ${valid})`);
        if (!outcome && offending) offending(validate.errors ?? []);
      }
    },
  },
];
