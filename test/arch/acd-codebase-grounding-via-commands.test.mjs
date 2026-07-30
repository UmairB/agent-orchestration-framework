// Fitness function for milestone 11 / ADR-002 + ADR-005 + ADR-006 inv. 2 (reached
// only via the 09 commands; no new spawn site / no new graph-reaching module):
// "The loop reaches the codebase graph ONLY through the registered 09 commands
//  (`aof graph build/query/triage`) / the aof MCP face (graph_query/graph_triage) /
//  the pure readGraph reads. 11 adds NO new graphify spawn site and NO new
//  graph-reaching module — it is PURE PROMPT-WIRING (inherits 09/ADR-005 inv. 2,
//  acd-graph-no-face-spawn). Scope = the codebase (`aof graph build .`), distinct
//  from 10's work-stream scope."
//
// This EXTENDS the 09 acd-graph-no-face-spawn idiom for 11. Two halves:
//   (a) REGRESSION GUARD (GREEN now, must STAY green): the only `graphify`-binary
//       spawn in src/ remains src/graphify.mjs (the 09 sole-spawn-site assertion,
//       re-run here so an 11-area diff that adds a second spawn fails this test too);
//       and no NEW src/ module reaches the graph by any path other than the 09
//       commands / the MCP face / the pure reads (11 adds no module — the graph-
//       reaching module set is exactly 09's + 10's).
//   (b) SEAM-INVOKES-`aof graph` (RED until 01/02, GREEN now they are wired): each of
//       the three bundle seams invokes `aof graph build/query/triage` (the agent runs
//       the registered command / the MCP tool) and contains NO bespoke `graphify`
//       binary spawn — the seams reach the graph via the command, never a second
//       integration.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");
const bundleDir = path.join(srcDir, "bundle");
const DRIVER_REL = path.join("src", "graphify.mjs");

const SEAMS = {
  architect: path.join(bundleDir, "agents", "aof-architect.md"),
  refine: path.join(bundleDir, "commands", "refine.md"),
  codeReview: path.join(bundleDir, "commands", "code-review.md"),
};

// The FROZEN set of src/ modules that reach the graph by IMPORTING the driver
// (../graphify.mjs) or the pure normalizer (graph-normalize.mjs) — the surface this
// test's import-grep detects. 11 adds NONE. (graph-normalize.mjs is the normalizer
// ITSELF — it neither imports the driver nor itself, so it is not an import-reacher;
// graph-mcp-server.mjs reaches the graph via invoke("graph:…"), not by import — it is
// covered by the no-face-spawn guard, not by this import-grep. Neither is listed.)
const GRAPH_REACHING_ALLOWLIST = new Set([
  path.join("src", "graphify.mjs"),                 // imports the normalizer
  path.join("src", "commands", "graph-build.mjs"),  // imports the driver
  path.join("src", "commands", "graph-query.mjs"),  // imports the driver
  path.join("src", "commands", "graph-triage.mjs"), // imports the driver
  path.join("src", "commands", "graph-impact.mjs"), // imports the normalizer (11/ADR-007): the
                                                    // deterministic edge-based coupling command — reaches
                                                    // the graph via the pure read (NOT a spawn), exactly
                                                    // as 10's backend does.
  path.join("src", "memory", "graphify-backend.mjs"), // imports the normalizer (10)
]);

// The exact 09 scanner: strip line + block comments AND string/template literals so
// only LIVE CODE trips the call-form / import greps.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
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

// Strip ONLY comments, KEEP strings — for import specifiers (string-typed) and the
// bare-literal spawn guard.
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

async function collectMjs(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectMjs(full)));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

// A spawn whose target is the graphify binary (the 09 GRAPHIFY_SPAWN form: the
// resolved handle / the GRAPHIFY_BINARY constant).
const GRAPHIFY_SPAWN = new RegExp(
  "\\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\\s*\\(\\s*" +
    "(GRAPHIFY_BINARY|graphifyy?|resolved\\.(path|binary)|binaryPath)\\b"
);
// The 09 bare-literal spawn guard (string-retained source): argv[0] is a literal
// `"graphify"`/`"graphifyy"`.
const GRAPHIFY_LITERAL_SPAWN = new RegExp(
  "\\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\\s*\\(\\s*" +
    "[\"'`]graphifyy?[\"'`]"
);

export const archTests = [
  {
    name: "arch/codebase-grounding-via-commands: the ONLY graphify-binary spawn in src/ remains src/graphify.mjs (11 adds no new spawn site — the 09 regression guard, re-asserted)",
    run: async () => {
      const files = await collectMjs(srcDir);
      assert.ok(files.length > 0, "found src/*.mjs files to scan");
      const offenders = [];
      let driverHasSpawn = false;
      for (const file of files) {
        const rel = path.relative(repoRoot, file);
        const code = stripCommentsAndStrings(await readFile(file, "utf8"));
        if (GRAPHIFY_SPAWN.test(code)) {
          if (rel === DRIVER_REL) driverHasSpawn = true;
          else offenders.push(rel);
        }
        // The bare-literal form too (string-retained), except the driver itself.
        if (rel !== DRIVER_REL) {
          const stringRetained = stripCommentsOnly(await readFile(file, "utf8"));
          if (GRAPHIFY_LITERAL_SPAWN.test(stringRetained)) offenders.push(rel);
        }
      }
      assert.deepEqual(
        [...new Set(offenders)],
        [],
        `only src/graphify.mjs may spawn the graphify binary; 11 introduced no new spawn site; offenders: ${offenders.join(", ")}`
      );
      assert.ok(driverHasSpawn, "src/graphify.mjs IS the sole graphify spawn site (the 09 driver seam)");

      // Self-check (non-vacuous): the spawn guards WOULD catch an injected violation.
      assert.ok(GRAPHIFY_SPAWN.test("spawnSync(resolved.path, args)"), "the resolved-handle spawn guard is live");
      assert.ok(GRAPHIFY_LITERAL_SPAWN.test('spawn("graphify", ["build"])'), "the bare-literal spawn guard is live");
    },
  },
  {
    name: "arch/codebase-grounding-via-commands: 11 added NO new src/ module that reaches the graph except via the 09 commands / the MCP face / the pure reads (the graph-reaching module set is exactly 09's + 10's)",
    run: async () => {
      // Any src/ module that imports the driver (../graphify.mjs) or the pure
      // normalizer (graph-normalize.mjs) reaches the graph. The complete set of such
      // modules must be the frozen allow-list — 11 adds none. (The bundle seams are
      // PROMPT text, not modules; they reach the graph by instructing the agent to run
      // the CLI command, which is not a module-level import.)
      const files = await collectMjs(srcDir);
      const reachers = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file);
        const specs = importSpecifiers(stripCommentsOnly(await readFile(file, "utf8")));
        const importsDriver = specs.some((s) => /(^|\/)graphify\.mjs$/.test(s));
        const importsNormalizer = specs.some((s) => /(^|\/)graph-normalize\.mjs$/.test(s));
        if (importsDriver || importsNormalizer) reachers.push(rel);
      }
      const offenders = reachers.filter((rel) => !GRAPH_REACHING_ALLOWLIST.has(rel));
      assert.deepEqual(
        offenders,
        [],
        `no NEW src/ module may reach the graph outside the frozen 09+10 allow-list — 11 is prompt-only and adds none; offenders: ${offenders.join(", ")}`
      );
      // And the allow-list members actually exist + reach (honest allow-list).
      for (const rel of GRAPH_REACHING_ALLOWLIST) {
        assert.ok(reachers.includes(rel), `allow-listed graph-reaching module ${rel} genuinely imports the driver/normalizer`);
      }
    },
  },
  {
    name: "arch/codebase-grounding-via-commands: each 11 seam invokes `aof graph build/query/triage` (the registered 09 command / MCP tool) and spawns NO bespoke graphify binary",
    run: async () => {
      // The seam-invokes-`aof graph` half (RED until 01/02 wired; GREEN now): each
      // seam reaches the graph through the registered command the AGENT runs, never a
      // bespoke graphify spawn.
      const architect = await readFile(SEAMS.architect, "utf8");
      const refine = await readFile(SEAMS.refine, "utf8");
      const codeReview = await readFile(SEAMS.codeReview, "utf8");

      // Every seam builds via `aof graph build` (the codebase-scope command — ADR-005:
      // scope = the codebase, `aof graph build .`).
      for (const [label, text] of [["aof-architect", architect], ["refine (break-down)", refine], ["code-review (PR triage)", codeReview]]) {
        assert.match(text, /aof graph build\b/, `${label} invokes the registered \`aof graph build\` command`);
        // Codebase scope (ADR-005): the build target is the whole project (`.`), not the
        // work stream — distinguishes 11 from 10.
        // Mutation proof: changing this back to a package or `src` subtree goes red.
        assert.match(text, /aof graph build\s+\.(?:`|\s)/, `${label} builds the WHOLE PROJECT (\`aof graph build .\`)`);
        assert.match(text, /replac\w+|evict\w+/, `${label} warns that subset builds replace the graph`);
      }
      // ADR-007: every coupling/impact consumer now invokes the DETERMINISTIC
      // `aof graph impact` (exact edge-based dependents + dependencies) as its primary
      // grounding step — the reliable signal, replacing the fuzzy `graph query`/`triage`
      // as the thing the agent ranks/decides on.
      for (const [label, text] of [["aof-architect", architect], ["refine (break-down)", refine], ["code-review (PR impact)", codeReview]]) {
        assert.match(text, /aof graph impact\b/, `${label} invokes the registered \`aof graph impact\` command (the exact coupling signal)`);
      }

      // No seam spawns a bespoke graphify binary itself (the agent runs the CLI; the
      // seam must not instruct a direct `graphify <verb>` spawn bypassing `aof graph`).
      // graphify IS named in code-review's prose (documenting what `aof graph triage`
      // spawns under the hood: "spawns `graphify prs --triage`") — that is a DESCRIPTION
      // of the command's internals, not a bespoke spawn instruction. Assert no seam
      // tells the agent to RUN a bare `graphify` binary as its grounding step.
      for (const [label, text] of [["aof-architect", architect], ["refine (break-down)", refine], ["code-review (PR triage)", codeReview]]) {
        assert.ok(
          !/\b(run|exec|spawn|call)\b[^\n]{0,40}`?graphify\s+(build|query|triage|extract)\b/i.test(text),
          `${label} does not instruct a bespoke graphify-binary spawn (the agent runs \`aof graph …\`, the registered command)`
        );
      }
    },
  },
];
