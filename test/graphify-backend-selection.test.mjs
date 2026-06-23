// Traceability wiring for milestone 10 / story 00 (graphify-backend-module),
// task 00 — 00_backend-registered-and-selectable.feature.
//
// Every @executable scenario AND every Scenario-Outline Examples row of that
// feature is covered here, exercised against the REAL seam (`runMemory` /
// `selectBackendName` / `resolveConfiguredBackend` / `BACKEND_REGISTRY` in
// ../src/work-memory.mjs), the REAL `$defs/memory` schema (the same ajv-2020 engine
// the codebase ships), and the REAL graphify backend module's default export
// (../src/memory/graphify-backend.mjs). One test object per scenario; Scenario-Outline
// rows folded one-per-row, each name tracing to feature + scenario.
//
//   00_backend-registered-and-selectable.feature
//     — a config naming graphify is schema-valid
//     — it dispatches to the graphify backend (status reports "graphify")
//     — the module's default export is the frozen { name, recall, reindex, status }
//     — an unregistered name is rejected by the $defs/memory.backend enum
//     — Outline: the configured backend determines who answers (local/none/graphify/absent)
//     — Outline: an unregistered name is rejected, never silently dispatched
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readFile, mkdtemp, mkdir } from "node:fs/promises";
import {
  runMemory,
  selectBackendName,
  resolveConfiguredBackend,
  BACKEND_REGISTRY,
} from "../src/work-memory.mjs";
import graphifyBackend from "../src/memory/graphify-backend.mjs";

// Schema loading + ajv-2020 compile mirrors test/work-memory-seam.test.mjs (the same
// engine the codebase ships in node_modules; the draft this schema declares).
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

// A minimal isolated projectRoot so status (which reads a store) never touches the
// repo. With no store present the graphify backend reports recordCount 0 (it never
// throws on an absent store — mirrors local). status reaches NO graphify binary.
async function freshProjectRoot() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-graphify-sel-"));
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return projectRoot;
}

// Run `aof work memory <verb>` through the REAL registry with the graphify backend
// selected, capturing --json stdout. ctx carries an isolated projectRoot/workDir so
// the real lazy `graphify` loader resolves and answers without touching the repo.
async function runGraphify(argv, { config = { memory: { backend: "graphify" } } } = {}) {
  const projectRoot = await freshProjectRoot();
  const lines = [];
  const ctx = { workDir: path.join(projectRoot, "wiki", "work"), projectRoot, configMemory: config.memory ?? {} };
  const outcome = await runMemory(argv, {
    config,
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: (l) => lines.push(l),
  });
  return { outcome, output: lines.join("\n"), projectRoot };
}

const FROZEN_KEYS = ["name", "recall", "reindex", "status"];

export const graphifyBackendSelectionTests = [
  // ====================================================================
  // 00_backend-registered-and-selectable.feature
  // ====================================================================
  {
    name: "graphify/selection: a config naming the graphify backend is schema-valid",
    run: async () => {
      const validate = await compileSchema();
      assert.equal(
        validate(baseConfig({ memory: { backend: "graphify" } })),
        true,
        "{memory:{backend:graphify}} validates against $defs/memory.backend"
      );
    },
  },
  {
    name: "graphify/selection: a config naming graphify dispatches to the graphify backend (status reports graphify)",
    run: async () => {
      const { outcome, output } = await runGraphify(["status", "--json"]);
      assert.equal(outcome.exitCode, 0, "the command exits 0");
      assert.equal(JSON.parse(output).backend, "graphify", "the status reports backend graphify");
    },
  },
  {
    name: "graphify/selection: the graphify backend module's default export is the frozen interface",
    run: async () => {
      // its keys are EXACTLY name, recall, reindex, status — no more, no less.
      assert.deepEqual(
        Object.keys(graphifyBackend).sort(),
        [...FROZEN_KEYS].sort(),
        "default export keys are exactly { name, recall, reindex, status }"
      );
      assert.equal(graphifyBackend.name, "graphify", '"name" is "graphify"');
      for (const method of ["recall", "reindex", "status"]) {
        assert.equal(typeof graphifyBackend[method], "function", `"${method}" is callable`);
      }
    },
  },
  {
    name: "graphify/selection: graphify is registered in BACKEND_REGISTRY as a lazy loader",
    run: async () => {
      assert.equal(typeof BACKEND_REGISTRY.graphify, "function", "BACKEND_REGISTRY carries a graphify loader");
      const resolved = await BACKEND_REGISTRY.graphify();
      assert.equal(resolved.name, "graphify", "the loader resolves the graphify backend's default export");
    },
  },
  {
    name: "graphify/schema: a config naming an unregistered backend is rejected by the enum (cites memory.backend)",
    run: async () => {
      const validate = await compileSchema();
      assert.equal(validate(baseConfig({ memory: { backend: "mempalace" } })), false, "{backend:mempalace} fails");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => e.instancePath === "/memory/backend" && e.keyword === "enum"),
        `the failure cites the memory.backend enum (got ${JSON.stringify(errors)})`
      );
    },
  },
  // Scenario Outline: the configured memory backend determines who answers.
  //   a registered name selects that backend; absence selects none.
  ...[
    { config: { memory: { backend: "local" } }, selected: "local" },
    { config: { memory: { backend: "none" } }, selected: "none" },
    { config: { memory: { backend: "graphify" } }, selected: "graphify" },
    { config: {}, selected: "none" }, // "absent" — the config has no memory key
  ].map((row) => ({
    name: `graphify/selection: outline — config ${JSON.stringify(row.config.memory ?? "absent")} selects backend "${row.selected}"`,
    run: async () => {
      assert.equal(
        selectBackendName(row.config),
        row.selected,
        "selectBackendName resolves the configured (or default) backend"
      );
      // A registered name resolves through the real registry to a backend of that name.
      if (row.selected !== "none" || row.config.memory) {
        const backend = await resolveConfiguredBackend(row.config);
        assert.equal(backend.name, row.selected, `the resolved backend's name is "${row.selected}"`);
      }
    },
  })),
  // Scenario Outline: an unregistered name is rejected by the schema, never silently dispatched.
  ...[{ backend: "mempalace" }, { backend: "" }].map((row) => ({
    name: `graphify/schema: outline — backend "${row.backend}" is rejected by the schema enum (never dispatched)`,
    run: async () => {
      const validate = await compileSchema();
      assert.equal(
        validate(baseConfig({ memory: { backend: row.backend } })),
        false,
        `backend "${row.backend}" fails validation`
      );
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => e.instancePath === "/memory/backend" && e.keyword === "enum"),
        "the rejection is on the memory.backend enum"
      );
    },
  })),
];
