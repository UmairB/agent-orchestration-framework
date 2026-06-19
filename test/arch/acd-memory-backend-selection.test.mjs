// Fitness function for milestone 05 / ADR-002:
// "`memory.backend` is the only config key that selects a backend, and it is read
//  in exactly one place (the seam's dispatch). No agent prompt, command, or other
//  module branches on the backend name."
//
// This is a structural (grep-style) assert on the SEAM module plus a schema check:
//   (1) the memory-seam source reads `config.memory(?.).backend` in exactly ONE
//       code location (comments stripped), and that location is src/work-memory.mjs;
//   (2) no OTHER src/*.mjs module and no bundle agent/command body branches on the
//       backend-name literals "local"/"mempalace" as a dispatch branch (the
//       registry in the seam is the only place a name maps to a backend; the
//       backend modules under src/memory/ legitimately carry their own `name`);
//   (3) the schema gate: `{ memory: { backend: "local" } }` validates and an
//       unregistered backend name fails the $defs/memory enum.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, "..", "..", "src");
const SCHEMA_URL = new URL("../../schemas/aof.schema.json", import.meta.url);
const BUNDLE_DIR = path.join(SRC_DIR, "bundle");

// Strip line- and block-comments and string-quote noise enough that we test
// CODE, not prose. (We only need to discount `// ...` and `/* ... */`, which is
// where every ADR citation of `config.memory?.backend` lives.)
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

// A "dispatch branch" on a backend name: the literal appears in an equality
// comparison or a switch/case against a backend-ish identifier. We match the
// literal adjacent to `===` / `!==` / `case` / `switch` where a `backend`/`name`
// token is on the line — the shape that would route on the backend name.
function isDispatchBranchLine(line, literal) {
  const q = `["']${literal}["']`;
  const comparisons = [
    new RegExp(`backend[\\w?.]*\\s*[=!]==\\s*${q}`),
    new RegExp(`${q}\\s*[=!]==\\s*[\\w?.]*backend`),
    new RegExp(`name\\s*[=!]==\\s*${q}`),
    new RegExp(`${q}\\s*[=!]==\\s*name`),
    new RegExp(`case\\s+${q}`),
    new RegExp(`switch\\s*\\([^)]*backend[^)]*\\)`)
  ];
  return comparisons.some((re) => re.test(line));
}

export const archTests = [
  {
    name: "arch/ADR-002: config.memory.backend is read in exactly one code location, and it is the memory seam",
    run: async () => {
      const files = await listFiles(SRC_DIR, (f) => f.endsWith(".mjs"));
      const reads = [];
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        // Match a property access of `.backend` off a `.memory(?.)` access — the
        // backend-selection read. (Excludes `config.memory ?? {}`, which reads the
        // block, not the selection.)
        const matches = code.match(/memory\s*\??\.\s*backend\b/g) ?? [];
        for (let i = 0; i < matches.length; i += 1) reads.push(file);
      }
      assert.equal(reads.length, 1, `config.memory?.backend is read exactly once (found ${reads.length}: ${reads.map((f) => path.relative(SRC_DIR, f)).join(", ")})`);
      assert.equal(path.basename(reads[0]), "work-memory.mjs", "the single read lives in the memory seam (src/work-memory.mjs)");
    }
  },
  {
    name: "arch/ADR-002: no module outside the seam's registry branches on the backend-name literals",
    run: async () => {
      const seamPath = path.join(SRC_DIR, "work-memory.mjs");
      const memoryDir = path.join(SRC_DIR, "memory");
      const files = await listFiles(SRC_DIR, (f) => f.endsWith(".mjs"));
      const offenders = [];

      for (const file of files) {
        // The seam itself owns the registry (name -> backend). Backend modules
        // under src/memory/ legitimately declare their own `name` ("local"/"none")
        // — that is identity, not a dispatch branch on another module's choice.
        if (file === seamPath) continue;
        if (file.startsWith(memoryDir + path.sep)) continue;

        const code = stripComments(await readFile(file, "utf8"));
        for (const line of code.split(/\r?\n/)) {
          for (const literal of ["local", "mempalace"]) {
            if (isDispatchBranchLine(line, literal)) {
              offenders.push(`${path.relative(SRC_DIR, file)}: ${line.trim()}`);
            }
          }
        }
      }
      assert.equal(offenders.length, 0, `no module outside the seam branches on a backend name:\n${offenders.join("\n")}`);
    }
  },
  {
    name: "arch/ADR-002: no unregistered backend name (mempalace) appears anywhere in src or the bundle bodies",
    run: async () => {
      // "mempalace" is not a registered backend in this milestone, so ANY
      // occurrence in code/bundle bodies would be a stray dispatch branch.
      const srcFiles = await listFiles(SRC_DIR, (f) => f.endsWith(".mjs"));
      const bundleBodies = await listFiles(BUNDLE_DIR, (f) => f.endsWith(".md"));
      const hits = [];
      for (const file of [...srcFiles, ...bundleBodies]) {
        const text = await readFile(file, "utf8");
        // Strip comments for .mjs; bundle bodies are prose, scan whole.
        const scanned = file.endsWith(".mjs") ? stripComments(text) : text;
        if (/["']mempalace["']/.test(scanned)) hits.push(path.relative(SRC_DIR, file));
      }
      assert.equal(hits.length, 0, `"mempalace" must not appear as a literal: ${hits.join(", ")}`);
    }
  },
  {
    name: "arch/ADR-002: no bundle agent/command body branches on a memory backend name",
    run: async () => {
      // Agents/commands must not learn the backend name (they call the verbs).
      const bodies = await listFiles(BUNDLE_DIR, (f) => f.endsWith(".md"));
      const offenders = [];
      for (const file of bodies) {
        const text = await readFile(file, "utf8");
        // A body that compares or switches on memory.backend would be a leak.
        if (/memory\s*\??\.\s*backend\s*[=!]==/.test(text) || /backend\s*[=!]==\s*["'](local|none|mempalace)["']/.test(text)) {
          offenders.push(path.relative(BUNDLE_DIR, file));
        }
      }
      assert.equal(offenders.length, 0, `no bundle body dispatches on the backend name: ${offenders.join(", ")}`);
    }
  },
  {
    name: "arch/ADR-002: the schema gate — {memory:{backend:local}} validates and an unknown backend fails the enum",
    run: async () => {
      const validate = await compileSchema();
      const base = { name: "x", resources: [] };

      assert.equal(validate({ ...base, memory: { backend: "local" } }), true, "{memory:{backend:local}} passes the schema");
      assert.equal(validate({ ...base, memory: { backend: "none" } }), true, "{memory:{backend:none}} passes the schema");
      assert.equal(validate(base), true, "an absent memory key passes the schema");

      assert.equal(validate({ ...base, memory: { backend: "mempalace" } }), false, "an unknown backend name fails the schema");
      const errors = validate.errors ?? [];
      assert.ok(
        errors.some((e) => e.instancePath === "/memory/backend" && e.keyword === "enum"),
        "the failure is on the $defs/memory backend enum"
      );
    }
  }
];
