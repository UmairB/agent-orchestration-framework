// Traceability wiring for milestone 05 / story 00 `memory-seam`.
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's four task features is covered here, exercised against the REAL seam
// (`runMemory` / `parseMemoryArgv` / `resolveConfiguredBackend` in
// ../src/work-memory.mjs) and the REAL `none` backend (../src/memory/none-backend.mjs).
// The routing/scope/render scenarios run against an in-memory STUB backend that
// records the call it received, echoes the scope/opts it was handed, and returns a
// fixed RecallResult — so the seam never needs story 01/02's code or a real index.
//
//   00_verb-dispatch.feature            — the five verbs route through the frozen
//        interface {recall, reindex, status}; brief→recall (composed), ingest→reindex
//        (alias); unknown/missing verb prints usage and exits non-zero, invoking
//        NO backend method.
//   01_backend-selection-and-schema.feature — config.memory?.backend selects the
//        answering backend; absent memory ≡ none; $defs/memory makes {backend:local}
//        valid and rejects an unknown name by enum.
//   02_none-backend-noop.feature        — every verb is a graceful no-op against none
//        (or memory absent): recall→empty RecallResult, reindex/ingest→{recordCount:0},
//        status→{backend:none, recordCount:0}.
//   03_argv-scope-and-json-rendering.feature — scope flags parse into `scope`,
//        --limit into `opts`; text view by default, structured records array under --json.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  runMemory,
  parseMemoryArgv,
  resolveConfiguredBackend,
  selectBackendName,
  BACKEND_REGISTRY,
  MEMORY_VERBS,
  memoryUsage
} from "../src/work-memory.mjs";
import noneBackend from "../src/memory/none-backend.mjs";

// ------------------------------------------------------------ test rig ----

// An in-memory STUB backend satisfying the frozen interface. It records every
// call (so we can assert WHICH interface method a verb reached), echoes the
// scope/opts it was handed, and returns a FIXED RecallResult. It deliberately
// exposes NO `brief` or `ingest` method — those are seam compositions, not
// interface methods (ADR-003).
function makeStub({ backendName = "local" } = {}) {
  const calls = [];
  const fixedRecords = [
    { score: 27, recordType: "adr", id: "ADR-002", item: "01", itemSlug: "acd-asset-bundle", title: "t", area: "architecture", stage: "", kind: "", owner: "", text: "body", summary: "gist", source: "01_milestone_acd-asset-bundle/ARCHITECTURE.md:66" }
  ];
  const RENDERED_TEXT = "recall \"q\"  →  1 hit(s)\n  ▸ [ADR-002 · m01] t\n    ↳ …:66\n";
  const backend = {
    name: backendName,
    async recall(query, scope, opts, ctx) {
      calls.push({ method: "recall", query, scope, opts, ctx });
      return { query, scope, records: fixedRecords, text: RENDERED_TEXT };
    },
    async reindex(only, ctx) {
      calls.push({ method: "reindex", only, ctx });
      return { recordCount: 0 };
    },
    async status(ctx) {
      calls.push({ method: "status", ctx });
      return { backend: backendName, recordCount: 0 };
    }
  };
  return { backend, calls, fixedRecords, RENDERED_TEXT };
}

// Run the seam against a stub, capturing stdout lines and the resolved-backend.
async function runWithStub(argv, { config = {}, stub } = {}) {
  const rig = stub ?? makeStub();
  const lines = [];
  const outcome = await runMemory(argv, {
    config,
    resolveBackend: async () => rig.backend,
    log: (line) => lines.push(line)
  });
  return { ...outcome, output: lines.join("\n"), lines, calls: rig.calls, rig };
}

// Schema loading mirrors test/schema.test.mjs. Validation uses ajv 2020 (the
// draft this schema declares) — the same engine the codebase ships in node_modules.
async function loadSchema() {
  return JSON.parse(await readFile(new URL("../schemas/aof.schema.json", import.meta.url), "utf8"));
}

let _validate;
async function compileSchema() {
  if (_validate) return _validate;
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  _validate = ajv.compile(await loadSchema());
  return _validate;
}

function baseConfig(extra = {}) {
  return { name: "x", resources: [], ...extra };
}

export const workMemorySeamTests = [
  // ====================================================================
  // 00_verb-dispatch.feature
  // ====================================================================
  {
    name: "memory-seam/dispatch: recall reaches the backend's recall method with the query",
    run: async () => {
      const r = await runWithStub(["recall", "pin line endings"]);
      assert.equal(r.exitCode, 0, "exits 0");
      const call = r.calls.find((c) => c.method === "recall");
      assert.ok(call, "recall method was invoked");
      assert.equal(call.query, "pin line endings", "invoked with the query");
    }
  },
  {
    name: "memory-seam/dispatch: reindex reaches the backend's reindex method",
    run: async () => {
      const r = await runWithStub(["reindex"]);
      assert.equal(r.exitCode, 0);
      assert.ok(r.calls.some((c) => c.method === "reindex"), "reindex method was invoked");
    }
  },
  {
    name: "memory-seam/dispatch: status reaches the backend's status method",
    run: async () => {
      const r = await runWithStub(["status"]);
      assert.equal(r.exitCode, 0);
      assert.ok(r.calls.some((c) => c.method === "status"), "status method was invoked");
    }
  },
  {
    name: "memory-seam/dispatch: brief is composed over recall (no `brief` interface method)",
    run: async () => {
      const r = await runWithStub(["brief"]);
      assert.equal(r.exitCode, 0);
      assert.ok(r.calls.some((c) => c.method === "recall"), "brief reaches backend.recall");
      assert.ok(!r.calls.some((c) => c.method === "brief"), "no method named brief was reached");
      assert.equal(typeof r.rig.backend.brief, "undefined", "the backend exposes no brief method");
    }
  },
  {
    name: "memory-seam/dispatch: ingest is an alias of reindex (no `ingest` interface method)",
    run: async () => {
      const r = await runWithStub(["ingest", "01"]);
      assert.equal(r.exitCode, 0);
      assert.ok(r.calls.some((c) => c.method === "reindex"), "ingest reaches backend.reindex");
      assert.ok(!r.calls.some((c) => c.method === "ingest"), "no method named ingest was reached");
      assert.equal(typeof r.rig.backend.ingest, "undefined", "the backend exposes no ingest method");
    }
  },
  {
    name: "memory-seam/dispatch: an unknown verb prints usage and exits non-zero, invoking no backend",
    run: async () => {
      const r = await runWithStub(["frobnicate"]);
      assert.notEqual(r.exitCode, 0, "exits non-zero");
      assert.equal(r.calls.length, 0, "no backend method was invoked");
      // usage lists the supported verbs (the seam writes usage to stderr, but the
      // memoryUsage() text is the source of truth for what is listed).
      for (const verb of MEMORY_VERBS) {
        assert.ok(memoryUsage().includes(verb), `usage lists ${verb}`);
      }
    }
  },
  {
    name: "memory-seam/dispatch: a missing verb prints usage and exits non-zero, invoking no backend",
    run: async () => {
      const r = await runWithStub([]);
      assert.notEqual(r.exitCode, 0, "exits non-zero");
      assert.equal(r.calls.length, 0, "no backend method was invoked");
      for (const verb of MEMORY_VERBS) {
        assert.ok(memoryUsage().includes(verb), `usage lists ${verb}`);
      }
    }
  },
  {
    // Regression: `ingest`/`reindex` route STRAIGHT into the rebuild (which writes the
    // index and spawns the graph build) — so before the --help guard, `memory ingest
    // --help` did real work and hung. --help must print usage and reach NO backend.
    name: "memory-seam/dispatch: `ingest --help` prints usage and exits 0, reaching no backend (never starts the rebuild)",
    run: async () => {
      const r = await runWithStub(["ingest", "--help"]);
      assert.equal(r.exitCode, 0, "help exits 0");
      assert.equal(r.calls.length, 0, "no backend method was invoked (the rebuild never starts)");
      for (const verb of MEMORY_VERBS) {
        assert.ok(r.output.includes(verb), `help output lists ${verb}`);
      }
    }
  },
  {
    name: "memory-seam/dispatch: `reindex --help` prints usage and exits 0, reaching no backend",
    run: async () => {
      const r = await runWithStub(["reindex", "--help"]);
      assert.equal(r.exitCode, 0, "help exits 0");
      assert.equal(r.calls.length, 0, "no backend method was invoked");
      assert.ok(r.output.includes("reindex"), "help output names reindex");
    }
  },
  // Scenario Outline: each verb routes to its frozen interface method.
  // | verb | args | method | composed |
  ...[
    { verb: "recall", args: ["query"], method: "recall", composed: false },
    { verb: "reindex", args: [], method: "reindex", composed: false },
    { verb: "status", args: [], method: "status", composed: false },
    { verb: "brief", args: [], method: "recall", composed: true },
    { verb: "ingest", args: ["01"], method: "reindex", composed: true }
  ].map((row) => ({
    name: `memory-seam/dispatch: outline — verb "${row.verb}" routes to interface method "${row.method}" (composed=${row.composed})`,
    run: async () => {
      const r = await runWithStub([row.verb, ...row.args]);
      assert.equal(r.exitCode, 0, "exits 0");
      assert.ok(r.calls.some((c) => c.method === row.method), `${row.verb} reaches ${row.method}`);
      // "composed=yes" means the interface gains NO method of the verb's own name.
      if (row.composed) {
        assert.equal(typeof r.rig.backend[row.verb], "undefined", `interface has no ${row.verb} method`);
        assert.notEqual(row.verb, row.method, "a composition's verb name differs from the interface method it reaches");
      } else {
        // "composed=no": the verb name IS the interface method name.
        assert.equal(row.verb, row.method, "a spine verb's name equals its interface method");
      }
    }
  })),

  // ====================================================================
  // 01_backend-selection-and-schema.feature
  // ====================================================================
  {
    name: "memory-seam/selection: a config naming local dispatches to the local backend (status reports local)",
    run: async () => {
      // Inject a stub under "local" so selection routes to it WITHOUT the real
      // local module existing.
      const rig = makeStub({ backendName: "local" });
      const registry = { ...BACKEND_REGISTRY, local: () => rig.backend };
      const lines = [];
      const outcome = await runMemory(["status", "--json"], {
        config: { memory: { backend: "local" } },
        resolveBackend: (cfg) => resolveConfiguredBackend(cfg, registry),
        log: (l) => lines.push(l)
      });
      assert.equal(outcome.exitCode, 0);
      assert.equal(JSON.parse(lines.join("\n")).backend, "local", "status reports backend local");
    }
  },
  {
    name: "memory-seam/selection: a config naming none dispatches to the none backend (status reports none)",
    run: async () => {
      const lines = [];
      const outcome = await runMemory(["status", "--json"], {
        config: { memory: { backend: "none" } },
        resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
        log: (l) => lines.push(l)
      });
      assert.equal(outcome.exitCode, 0);
      assert.equal(JSON.parse(lines.join("\n")).backend, "none", "status reports backend none");
    }
  },
  {
    name: "memory-seam/selection: an absent memory key is equivalent to the none backend",
    run: async () => {
      const lines = [];
      const outcome = await runMemory(["status", "--json"], {
        config: baseConfig(), // no `memory` key
        resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
        log: (l) => lines.push(l)
      });
      assert.equal(outcome.exitCode, 0);
      assert.equal(JSON.parse(lines.join("\n")).backend, "none", "absent memory selects none");
    }
  },
  {
    name: "memory-seam/schema: a config naming local is schema-valid",
    run: async () => {
      const validate = await compileSchema();
      assert.equal(validate(baseConfig({ memory: { backend: "local" } })), true, "{memory:{backend:local}} validates");
    }
  },
  {
    name: "memory-seam/schema: a config omitting the memory key is schema-valid",
    run: async () => {
      const validate = await compileSchema();
      assert.equal(validate(baseConfig()), true, "absent memory validates");
    }
  },
  {
    name: "memory-seam/schema: a config naming an unregistered backend is rejected by the enum (cites memory.backend)",
    run: async () => {
      const validate = await compileSchema();
      assert.equal(validate(baseConfig({ memory: { backend: "mempalace" } })), false, "{memory:{backend:mempalace}} fails");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => e.instancePath === "/memory/backend" && e.keyword === "enum"),
        `failure cites the memory.backend enum (got ${JSON.stringify(errors)})`
      );
    }
  },
  // Scenario Outline: the configured memory backend determines who answers.
  // Registered name selects that backend; absence selects none.
  ...[
    { config: { memory: { backend: "local" } }, selected: "local" },
    { config: { memory: { backend: "none" } }, selected: "none" },
    { config: {}, selected: "none" } // "absent"
  ].map((row) => ({
    name: `memory-seam/selection: outline — config ${JSON.stringify(row.config.memory ?? "absent")} selects backend "${row.selected}"`,
    run: async () => {
      assert.equal(selectBackendName(row.config), row.selected, "selectBackendName resolves the configured (or default) backend");
    }
  })),
  // Scenario Outline: an unregistered name is rejected by the schema, never silently dispatched.
  ...[
    { backend: "mempalace" },
    { backend: "" }
  ].map((row) => ({
    name: `memory-seam/schema: outline — backend "${row.backend}" is rejected by the schema enum (never dispatched)`,
    run: async () => {
      const validate = await compileSchema();
      assert.equal(validate(baseConfig({ memory: { backend: row.backend } })), false, `backend "${row.backend}" fails validation`);
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => e.instancePath === "/memory/backend" && e.keyword === "enum"),
        "the rejection is on the memory.backend enum"
      );
    }
  })),

  // ====================================================================
  // 02_none-backend-noop.feature  (exercises the REAL none backend)
  // ====================================================================
  {
    name: "memory-seam/none: recall against none succeeds with no records",
    run: async () => {
      const r = await runWithStub(["recall", "anything", "--json"], {
        config: { memory: { backend: "none" } },
        stub: { backend: noneBackend, calls: [] }
      });
      assert.equal(r.exitCode, 0);
      const records = JSON.parse(r.output);
      assert.ok(Array.isArray(records) && records.length === 0, "the recall result's records array is empty");
    }
  },
  {
    name: "memory-seam/none: reindex against none succeeds reporting zero records",
    run: async () => {
      const r = await runWithStub(["reindex", "--json"], {
        config: { memory: { backend: "none" } },
        stub: { backend: noneBackend, calls: [] }
      });
      assert.equal(r.exitCode, 0);
      assert.equal(JSON.parse(r.output).recordCount, 0, "record count of 0");
    }
  },
  {
    name: "memory-seam/none: ingest against none succeeds reporting zero records",
    run: async () => {
      const r = await runWithStub(["ingest", "--all", "--json"], {
        config: { memory: { backend: "none" } },
        stub: { backend: noneBackend, calls: [] }
      });
      assert.equal(r.exitCode, 0);
      assert.equal(JSON.parse(r.output).recordCount, 0, "record count of 0");
    }
  },
  {
    name: "memory-seam/none: status against none reports the none backend with zero records",
    run: async () => {
      const r = await runWithStub(["status", "--json"], {
        config: { memory: { backend: "none" } },
        stub: { backend: noneBackend, calls: [] }
      });
      assert.equal(r.exitCode, 0);
      const status = JSON.parse(r.output);
      assert.equal(status.backend, "none", "reports backend none");
      assert.equal(status.recordCount, 0, "reports record count 0");
    }
  },
  {
    name: "memory-seam/none: brief against none succeeds with an empty digest",
    run: async () => {
      const r = await runWithStub(["brief"], {
        config: { memory: { backend: "none" } },
        stub: { backend: noneBackend, calls: [] }
      });
      assert.equal(r.exitCode, 0, "brief against none exits 0");
    }
  },
  {
    name: "memory-seam/none: every verb is a no-op when the memory key is absent",
    run: async () => {
      // Absent memory ≡ none (ADR-002) — every verb must exit 0 and not error.
      const verbsWithArgs = [
        ["recall", "q"],
        ["brief"],
        ["ingest", "--all"],
        ["reindex"],
        ["status"]
      ];
      for (const argv of verbsWithArgs) {
        const r = await runMemory(argv, {
          config: baseConfig(), // no memory key
          resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
          log: () => {}
        });
        assert.equal(r.exitCode, 0, `verb ${argv[0]} exits 0 with memory absent`);
        assert.equal(r.ok, true, `verb ${argv[0]} reports no error`);
      }
    }
  },
  // Scenario Outline: every verb is a graceful no-op against the none backend.
  ...[
    { verb: "recall", args: ["q"], check: (out) => Array.isArray(JSON.parse(out)) && JSON.parse(out).length === 0, desc: "an empty RecallResult (records: [])" },
    { verb: "reindex", args: [], check: (out) => JSON.parse(out).recordCount === 0, desc: "{ recordCount: 0 }" },
    { verb: "ingest", args: ["--all"], check: (out) => JSON.parse(out).recordCount === 0, desc: "{ recordCount: 0 }" },
    { verb: "status", args: [], check: (out) => { const s = JSON.parse(out); return s.backend === "none" && s.recordCount === 0; }, desc: "{ backend: none, recordCount: 0 }" }
  ].map((row) => ({
    name: `memory-seam/none: outline — verb "${row.verb}" is a no-op returning ${row.desc}`,
    run: async () => {
      const r = await runWithStub([row.verb, ...row.args, "--json"], {
        config: { memory: { backend: "none" } },
        stub: { backend: noneBackend, calls: [] }
      });
      assert.equal(r.exitCode, 0, `${row.verb} exits 0`);
      assert.ok(row.check(r.output), `${row.verb} returns ${row.desc}`);
    }
  })),

  // ====================================================================
  // 03_argv-scope-and-json-rendering.feature
  // ====================================================================
  {
    name: "memory-seam/scope: a single scope flag parses into the scope object handed to the backend",
    run: async () => {
      const r = await runWithStub(["recall", "q", "--area", "architecture"]);
      const call = r.calls.find((c) => c.method === "recall");
      assert.equal(call.scope.area, "architecture", "scope.area = architecture");
    }
  },
  {
    name: "memory-seam/scope: multiple scope flags parse into one intersected scope object",
    run: async () => {
      const r = await runWithStub(["recall", "q", "--area", "architecture", "--kind", "near-miss", "--owner", "developer"]);
      const call = r.calls.find((c) => c.method === "recall");
      assert.equal(call.scope.area, "architecture");
      assert.equal(call.scope.kind, "near-miss");
      assert.equal(call.scope.owner, "developer");
    }
  },
  {
    name: "memory-seam/scope: --item parses into the scope object",
    run: async () => {
      const r = await runWithStub(["recall", "q", "--item", "01"]);
      const call = r.calls.find((c) => c.method === "recall");
      assert.equal(call.scope.item, "01", "scope.item = 01");
    }
  },
  {
    name: "memory-seam/scope: --limit parses into the opts object, not the scope object",
    run: async () => {
      const r = await runWithStub(["recall", "q", "--limit", "3"]);
      const call = r.calls.find((c) => c.method === "recall");
      assert.equal(call.opts.limit, 3, "opts.limit = 3 (numeric)");
      assert.ok(!("limit" in call.scope), "the scope object carries no limit");
    }
  },
  {
    name: "memory-seam/scope: with no scope flags the backend receives an empty scope",
    run: async () => {
      const r = await runWithStub(["recall", "q"]);
      const call = r.calls.find((c) => c.method === "recall");
      assert.equal(Object.keys(call.scope).length, 0, "empty scope object");
    }
  },
  {
    name: "memory-seam/render: recall prints the rendered text view by default",
    run: async () => {
      const r = await runWithStub(["recall", "q"]);
      assert.equal(r.exitCode, 0);
      assert.equal(r.output, r.rig.RENDERED_TEXT, "output is the RecallResult's rendered text view");
    }
  },
  {
    name: "memory-seam/render: recall under --json prints the structured records array (not the text blob)",
    run: async () => {
      const r = await runWithStub(["recall", "q", "--json"]);
      assert.equal(r.exitCode, 0);
      // parses as JSON
      const parsed = JSON.parse(r.output);
      // is the records array
      assert.ok(Array.isArray(parsed), "output parses as a JSON array");
      assert.deepEqual(parsed, r.rig.fixedRecords, "output is the RecallResult's records array");
      // is NOT the rendered text blob
      assert.ok(!r.output.includes(r.rig.RENDERED_TEXT), "output is not the rendered text blob");
    }
  },
  // Scenario Outline: a scope flag parses into its scope field handed to the backend.
  // First-class scope filters land on the scope object; --limit lands on opts.
  ...[
    { flag: "--area", value: "architecture", target: "scope", field: "area" },
    { flag: "--stage", value: "build", target: "scope", field: "stage" },
    { flag: "--kind", value: "near-miss", target: "scope", field: "kind" },
    { flag: "--owner", value: "developer", target: "scope", field: "owner" },
    { flag: "--item", value: "01", target: "scope", field: "item" },
    { flag: "--limit", value: "3", target: "opts", field: "limit" }
  ].map((row) => ({
    name: `memory-seam/scope: outline — ${row.flag} ${row.value} lands on ${row.target}.${row.field}`,
    run: async () => {
      const r = await runWithStub(["recall", "q", row.flag, row.value]);
      const call = r.calls.find((c) => c.method === "recall");
      const bag = row.target === "scope" ? call.scope : call.opts;
      const expected = row.field === "limit" ? Number.parseInt(row.value, 10) : row.value;
      assert.equal(bag[row.field], expected, `${row.target}.${row.field} = ${expected}`);
      // cross-check it did NOT land on the other bag
      const other = row.target === "scope" ? call.opts : call.scope;
      assert.ok(!(row.field in other), `${row.field} is not in the other bag`);
    }
  })),
  // Scenario Outline: the output mode selects the projection of the RecallResult.
  // | mode   | printed |
  // | (none) | the RecallResult's rendered text |
  // | --json | the RecallResult's records array |
  ...[
    { mode: [], printed: "text" },
    { mode: ["--json"], printed: "records" }
  ].map((row) => ({
    name: `memory-seam/render: outline — mode "${row.mode.join(" ") || "(default)"}" prints the ${row.printed} projection`,
    run: async () => {
      const r = await runWithStub(["recall", "q", ...row.mode]);
      assert.equal(r.exitCode, 0);
      if (row.printed === "text") {
        assert.equal(r.output, r.rig.RENDERED_TEXT, "prints the rendered text");
      } else {
        assert.deepEqual(JSON.parse(r.output), r.rig.fixedRecords, "prints the records array");
        assert.ok(!r.output.includes(r.rig.RENDERED_TEXT), "does not print the text blob");
      }
    }
  }))
];
