// Fitness function for milestone 10 / ADR-003 (05/ADR-002):
// "`graphify` is a registered memory backend — it is the third value in the
//  `$defs/memory.backend` enum AND carries a loader in `BACKEND_REGISTRY`; an
//  unregistered backend name fails the schema enum; and `config.memory?.backend`
//  is STILL read in exactly one place (`selectBackendName`, the seam) — registering
//  graphify grew the enum by one reviewable line, not a new dispatch branch."
//
// Mirrors the 05 `acd-memory-backend-selection` idiom, extended to `graphify`:
//   (1) schema gate: { memory: { backend: "graphify" } } validates; an unknown name
//       ("mempalace") fails on the $defs/memory backend enum.
//   (2) the registry carries a `graphify` loader resolving to the backend's default
//       export (the frozen { name:"graphify", recall, reindex, status } interface).
//   (3) the single-read invariant: `config.memory?.backend` is read in exactly ONE
//       code location across src/**/*.mjs (comments stripped), and it is the seam
//       (src/work-memory.mjs), inside `selectBackendName`.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BACKEND_REGISTRY, selectBackendName } from "../../src/work-memory.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, "..", "..", "src");
const SCHEMA_URL = new URL("../../schemas/aof.schema.json", import.meta.url);

// Strip line- and block-comments so we test CODE, not the ADR citations of
// `config.memory?.backend` that live in comments (the 05 idiom's stripComments).
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

async function listFiles(dir, predicate) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (predicate(full)) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

async function compileSchema() {
  const Ajv2020 = (await import("ajv/dist/2020.js")).default;
  const schema = JSON.parse(await readFile(SCHEMA_URL, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

export const archTests = [
  {
    name: "arch/graphify-backend-selection: {memory:{backend:graphify}} validates and an unregistered name fails the $defs/memory enum",
    run: async () => {
      const validate = await compileSchema();
      const base = { name: "x", resources: [] };

      assert.equal(validate({ ...base, memory: { backend: "graphify" } }), true, "{memory:{backend:graphify}} passes the schema (graphify is the third enum value)");
      // The 05 baseline still validates (the enum GREW, it did not replace).
      assert.equal(validate({ ...base, memory: { backend: "local" } }), true, "{memory:{backend:local}} still passes");
      assert.equal(validate({ ...base, memory: { backend: "none" } }), true, "{memory:{backend:none}} still passes");

      // An unregistered backend name fails — on the $defs/memory backend enum (05/ADR-002).
      assert.equal(validate({ ...base, memory: { backend: "mempalace" } }), false, "an unregistered backend name fails the schema");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => e.instancePath === "/memory/backend" && e.keyword === "enum"),
        "the failure is on the $defs/memory backend enum"
      );
    },
  },
  {
    name: "arch/graphify-backend-selection: BACKEND_REGISTRY carries a `graphify` loader resolving to the frozen { name:graphify, recall, reindex, status } interface",
    run: async () => {
      assert.ok(typeof BACKEND_REGISTRY.graphify === "function", "BACKEND_REGISTRY carries a `graphify` loader");
      const backend = await BACKEND_REGISTRY.graphify();
      // The loader resolves to the backend module's default export — the FROZEN
      // 05 interface (05/ADR-003), exactly { name, recall, reindex, status }.
      assert.deepEqual(
        Object.keys(backend).sort(),
        ["name", "recall", "reindex", "status"],
        "the graphify backend's default export is exactly { name, recall, reindex, status }"
      );
      assert.equal(backend.name, "graphify", "the backend's own name is `graphify`");
      for (const method of ["recall", "reindex", "status"]) {
        assert.equal(typeof backend[method], "function", `graphify backend ${method} is a function`);
      }
    },
  },
  {
    name: "arch/graphify-backend-selection: selectBackendName resolves the configured graphify name (and absent ≡ none)",
    run: () => {
      // selectBackendName is the single read point — it resolves the configured name
      // (registering graphify added a registry line, NOT a new read site).
      assert.equal(selectBackendName({ memory: { backend: "graphify" } }), "graphify", "selectBackendName resolves graphify");
      assert.equal(selectBackendName({ memory: { backend: "local" } }), "local", "selectBackendName resolves local");
      assert.equal(selectBackendName({}), "none", "absent memory ≡ none");
      assert.equal(selectBackendName(undefined), "none", "absent config ≡ none");
    },
  },
  {
    name: "arch/graphify-backend-selection: config.memory?.backend is read in exactly one code location (the seam), even after graphify is registered",
    run: async () => {
      // The single-read invariant (05/ADR-002), re-asserted now that graphify is a
      // registered backend: registering it must NOT have added a second read of
      // config.memory?.backend anywhere (e.g. the backend module branching on its
      // own selection). Strip comments so the ADR citations do not count as reads.
      const files = await listFiles(SRC_DIR, (f) => f.endsWith(".mjs"));
      const reads = [];
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        const matches = code.match(/memory\s*\??\.\s*backend\b/g) ?? [];
        for (let i = 0; i < matches.length; i += 1) reads.push(file);
      }
      assert.equal(
        reads.length,
        1,
        `config.memory?.backend is read exactly once (found ${reads.length}: ${reads.map((f) => path.relative(SRC_DIR, f)).join(", ")})`
      );
      assert.equal(path.basename(reads[0]), "work-memory.mjs", "the single read lives in the memory seam (src/work-memory.mjs)");
    },
  },
];
