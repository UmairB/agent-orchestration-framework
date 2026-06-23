// Fitness function for milestone 10 / ADR-002 (complements 09's acd-graph-no-face-spawn):
// "The graphify memory backend reaches graphify EXCLUSIVELY through the registered
//  09 `graph:*` commands via `invoke(...)` — no bespoke second integration. The
//  backend module (src/memory/graphify-backend.mjs) imports `invoke` from
//  command-core.mjs and reaches the graph via `invoke('graph:…')`; it imports NEITHER
//  `../graphify.mjs` (the SOLE graphify spawn site) NOR `node:child_process`, and has
//  NO spawn/spawnSync/exec call-form. It reads the on-disk graph.json only through the
//  PURE, spawn-free `graph-normalize.mjs` helpers (reading the artifact is NOT a spawn,
//  09/ADR-001/002)."
//
// House discipline (the 09 call-form-not-comment idiom): the grep runs over the
// COMMENT-and-STRING-stripped source, so the module's many documenting mentions of
// "graphify.mjs"/"child_process"/"spawn" (it explains at length that it does NOT touch
// them) do NOT trip the guard — only LIVE CODE counts. Two halves:
//   (a) import-graph: the import SPECIFIERS (live code) — `command-core.mjs` IS
//       imported; `../graphify.mjs` and `node:child_process` are NOT.
//   (b) call-form: no spawn/spawnSync/exec/execFile/execSync family call anywhere in
//       live code; and an `invoke("graph:…")` call-form IS present (the only door).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKEND = path.join(repoRoot, "src", "memory", "graphify-backend.mjs");

// Strip line + block comments AND string/template literals, so a grep sees only live
// code (the exact scanner the 09 no-face-spawn / privacy-boundary guards use). A
// `child_process` mentioned in a comment, or a `"--backend"` in a string, becomes
// whitespace and cannot trip the guard.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

// An ES import/export-from SPECIFIER in live code: `from "<specifier>"`. (Strings are
// stripped by the scanner above, so to read specifiers we keep them: this regex runs
// over the COMMENT-only-stripped source — a documented "../graphify.mjs" in a comment
// is discounted, but a real `from "../graphify.mjs"` specifier survives.)
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

// A child-process call-form (spawn/exec family) against ANY argv[0] — the file must
// have NONE in live code (it spawns nothing; it reaches the graph via invoke()).
const CHILD_PROCESS_CALL = /\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\s*\(/;

// An `invoke("graph:…")` / `invoke(`graph:…`)` call-form — the ONLY door to graphify.
// Runs over the comment-stripped-but-string-RETAINED source so the "graph:" target
// literal survives (the via-command door is a STRING-typed first arg). A bare invoke
// identifier with a variable id would still match the leading form; we additionally
// assert the `graph:` literal appears as an invoke argument.
const INVOKE_GRAPH_CALL = /\binvoke\s*\(\s*["'`]graph:/;

export const archTests = [
  {
    name: "arch/graphify-backend-via-command: the backend imports `command-core.mjs` (invoke) and the PURE graph-normalize helpers",
    run: async () => {
      const raw = await readFile(BACKEND, "utf8");
      const specs = importSpecifiers(stripCommentsOnly(raw));
      assert.ok(
        specs.some((s) => /(^|\/)command-core\.mjs$/.test(s)),
        `the backend imports from command-core.mjs (the only door to graphify); imports: ${specs.join(", ")}`
      );
      // It reads graph.json through the spawn-free normalizer module, NOT the driver.
      assert.ok(
        specs.some((s) => /(^|\/)graph-normalize\.mjs$/.test(s)),
        `the backend imports the pure graph-normalize.mjs helpers (readGraph/normalizeGraph), not the driver; imports: ${specs.join(", ")}`
      );
    },
  },
  {
    name: "arch/graphify-backend-via-command: the backend imports NEITHER ../graphify.mjs NOR node:child_process (no bespoke second integration)",
    run: async () => {
      const raw = await readFile(BACKEND, "utf8");
      const specs = importSpecifiers(stripCommentsOnly(raw));
      // It must NOT import the SOLE graphify spawn site (src/graphify.mjs) — that would
      // be the "bespoke second integration" SPEC §Objective forbids (it would bypass the
      // graph:build command's egress/offline/binary-absent guards).
      const importsDriver = specs.some((s) => /(^|\/)graphify\.mjs$/.test(s));
      assert.equal(importsDriver, false, `the backend must NOT import ../graphify.mjs (the spawn site); imports: ${specs.join(", ")}`);
      // And it must NOT import node:child_process at all (it spawns nothing).
      const importsCp = specs.some((s) => /(^|\/)child_process$/.test(s) || /^node:child_process$/.test(s));
      assert.equal(importsCp, false, `the backend must NOT import node:child_process; imports: ${specs.join(", ")}`);
    },
  },
  {
    name: "arch/graphify-backend-via-command: the backend has NO spawn/exec call-form and does not reference child_process in live code",
    run: async () => {
      const raw = await readFile(BACKEND, "utf8");
      const code = stripCommentsAndStrings(raw);
      assert.ok(
        !CHILD_PROCESS_CALL.test(code),
        "the backend contains NO spawn/spawnSync/exec/execFile/execSync call-form (it reaches the graph via invoke, never a spawn)"
      );
      assert.ok(
        !/child_process/.test(code),
        "the backend does not reference node:child_process in live code"
      );
    },
  },
  {
    name: "arch/graphify-backend-via-command: the backend's ONLY graphify access is invoke('graph:…')",
    run: async () => {
      const raw = await readFile(BACKEND, "utf8");
      // Keep string literals so the `graph:` invoke target survives; strip comments so
      // a documented `invoke("graph:build")` example in prose does not count.
      const code = stripCommentsOnly(raw);
      assert.ok(
        INVOKE_GRAPH_CALL.test(code),
        "the backend reaches the graph via an invoke('graph:…') call (the registered 09 command, the only door)"
      );
      // Self-check (non-vacuous): the guard WOULD catch the form, and would NOT match a
      // bare comment mention or an unrelated invoke.
      assert.ok(INVOKE_GRAPH_CALL.test('await invoke("graph:build", input, ctx)'), "the guard matches invoke(\"graph:build\", …)");
      assert.ok(!INVOKE_GRAPH_CALL.test('invoke("memory:recall")'), "the guard does NOT match a non-graph invoke target");
    },
  },
];
