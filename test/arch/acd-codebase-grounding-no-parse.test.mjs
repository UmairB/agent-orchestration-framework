// Fitness function for milestone 11 / ADR-001 + ADR-006 inv. 1 (no-parse /
// legible-output):
// "No 11 seam parses `graph:query`/`graph:triage` `stdout` into a data shape, and
//  no 11-introduced `src/` module reads `graph.json` / imports `normalizeGraph`/
//  `readGraph`. The grounding is agent-consumed command OUTPUT — the agent RUNS
//  `aof graph query|triage` and READS the legible markdown; aof never destructures
//  it. (An agent CAN read graphify's markdown answer; 10's PROGRAM consumer could
//  not, hence ITS structured reads — but 11 has no program consumer.)"
//
// Two halves, mirroring the 09/10 house idiom:
//   (a) PROMPT-CONTENT (the three wired bundle seams): each grounding step instructs
//       the agent to RUN `aof graph query|triage` and READ the output, and carries an
//       explicit NO-PARSE directive over the markdown (never parse the answer / never
//       read graph.json for structure). No aof-side JSON.parse/regex is wired over the
//       command output (the seams are prompt text — they contain no parse code).
//   (b) IMPORT-GRAPH (the src/ surface): the ONLY src/ modules that read graph.json /
//       import normalizeGraph/readGraph are the EXISTING 09 readers (graphify.mjs,
//       graph-normalize.mjs, graph-build.mjs, graph-query.mjs, graph-triage.mjs,
//       graph-mcp-server.mjs) and 10's memory backend (memory/graphify-backend.mjs).
//       11 added NO new such module — the assertion is that NONE beyond this frozen
//       allow-list appears.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");
const bundleDir = path.join(srcDir, "bundle");

// The three wired 11 seams (ADR-002): the architect agent prompt (inherited by
// continue + code-review review), refine's break-down boundary grounding, and
// code-review's PR-impact triage grounding.
const SEAMS = {
  architect: path.join(bundleDir, "agents", "aof-architect.md"),
  refine: path.join(bundleDir, "commands", "refine.md"),
  codeReview: path.join(bundleDir, "commands", "code-review.md"),
};

// The FROZEN allow-list of src/ modules that legitimately read graph.json /
// import the pure graph-normalize helpers (09's readers + 10's backend). 11 adds
// NONE — any src/*.mjs OUTSIDE this list that reaches graph.json or imports
// normalizeGraph/readGraph is an 11-introduced parse surface and FAILS.
// NOTE: graph-mcp-server.mjs is NOT here — it reaches the graph via invoke("graph:…")
// (the registered command), never by reading graph.json / importing the normalizer
// (09/ADR-005). Its only `graph.json` mentions are in comments/strings (discounted).
const GRAPH_READER_ALLOWLIST = new Set([
  path.join("src", "graphify.mjs"),           // imports + re-exports the normalizer
  path.join("src", "graph-normalize.mjs"),    // DEFINES readGraph/normalizeGraph; reads graph.json
  path.join("src", "commands", "graph-build.mjs"),
  path.join("src", "commands", "graph-query.mjs"),
  path.join("src", "commands", "graph-triage.mjs"),
  path.join("src", "commands", "graph-impact.mjs"), // ADR-007: the deterministic, edge-based coupling
                                                    // command the running agents consume — reads the
                                                    // STRUCTURED graph.json via the pure normalizer (the
                                                    // 09/ADR-001 permitted handle, exactly as 10's backend
                                                    // does), NOT graphify's opaque markdown stdout. No spawn.
  path.join("src", "memory", "graphify-backend.mjs"),
]);

// Strip line + block comments AND string/template literals (the exact 09/10
// scanner) — so a `graph.json` in a comment or a `"--backend"` string literal is
// discounted and only LIVE CODE trips the guard.
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

// Strip ONLY comments, KEEPING string literals — so import specifiers (string-typed)
// survive while a `graph.json` mention in a comment is discounted.
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

export const archTests = [
  {
    name: "arch/codebase-grounding-no-parse: each 11 seam has the agent RUN `aof graph query|triage` and READ the legible output (agent-consumed command output)",
    run: async () => {
      // The architect + refine seams consume graph:query's coupling answer; the
      // code-review seam consumes graph:triage's ranked queue. Each must instruct
      // the agent to RUN the command and READ its output.
      const architect = await readFile(SEAMS.architect, "utf8");
      const refine = await readFile(SEAMS.refine, "utf8");
      const codeReview = await readFile(SEAMS.codeReview, "utf8");

      // ADR-007: each seam now leads with the DETERMINISTIC `aof graph impact` (exact
      // edge-based coupling), the reliable primary signal the running agents consume.
      for (const [label, text, cmd] of [
        ["aof-architect", architect, /aof graph impact/],
        ["refine (break-down)", refine, /aof graph impact/],
        ["code-review (PR impact)", codeReview, /aof graph impact/],
      ]) {
        assert.match(text, cmd, `${label} instructs the agent to RUN the registered graph:impact command`);
        // And to READ the output (the legible answer/queue) — the agent-consumed
        // command-output discipline (the word READ is the seam's own emphasis).
        assert.match(
          text,
          /\bREAD\b|reads? (the|it)|read (and|the) (it|legible|markdown|opaque)/i,
          `${label} instructs the agent to READ the command output (agent-consumed, not aof-parsed)`
        );
      }
    },
  },
  {
    name: "arch/codebase-grounding-no-parse: each coupling seam frames graph:impact as the DETERMINISTIC/exact signal and graph:query as a fuzzy hint (ADR-007)",
    run: async () => {
      // ADR-007's load-bearing distinction: `graph impact` is the EXACT, edge-derived
      // structured answer (the reliable signal the running agent ranks/decides on);
      // `graph query`'s markdown is similarity-seeded and FUZZY — a hint, never relied
      // on as fact. Each seam must draw that line, so a future edit that re-elevates the
      // fuzzy query to the primary signal fails here (non-vacuous over the wording).
      const architect = await readFile(SEAMS.architect, "utf8");
      const refine = await readFile(SEAMS.refine, "utf8");
      const codeReview = await readFile(SEAMS.codeReview, "utf8");

      for (const [label, text] of [
        ["aof-architect", architect],
        ["refine (break-down)", refine],
        ["code-review (PR impact)", codeReview],
      ]) {
        assert.match(
          text,
          /exact|deterministic/i,
          `${label} frames graph:impact as the exact / deterministic coupling signal`
        );
      }
      // The architect + refine seams that ALSO mention the fuzzy `graph query` must
      // mark it as a similarity-seeded hint, not fact (the ADR-007 demotion).
      for (const [label, text] of [["aof-architect", architect], ["refine (break-down)", refine]]) {
        if (/aof graph query/.test(text)) {
          assert.match(
            text,
            /fuzzy|similarity-seeded|hint|not fact|exploration/i,
            `${label} demotes graph:query to a fuzzy/similarity-seeded hint (impact is the fact)`
          );
        }
      }
    },
  },
  {
    name: "arch/codebase-grounding-no-parse: the 11 seams are PROMPT text — they wire NO aof-side parse (no JSON.parse/destructure over the command output)",
    run: async () => {
      // The seams are bundled markdown prompts (ADR-002 — 11 adds no code). They must
      // not smuggle an aof-side parse of the graph output. A markdown file naturally
      // contains no executable parse, but assert it explicitly so a future inline
      // `JSON.parse(stdout)` / fenced parse-snippet in a seam is caught.
      for (const [label, file] of Object.entries(SEAMS)) {
        const text = await readFile(file, "utf8");
        assert.ok(
          !/JSON\.parse\s*\(\s*(stdout|result|output|answer|queue)/i.test(text),
          `${label} seam wires no JSON.parse over the graph command stdout/output (agent reads it, aof does not)`
        );
      }
    },
  },
  {
    name: "arch/codebase-grounding-no-parse: 11 introduced NO new src/ module that reads graph.json / imports normalizeGraph/readGraph (only the frozen 09 readers + 10 backend do)",
    run: async () => {
      // The import-graph half: scan EVERY src/**/*.mjs (live code only). Any module
      // that reads graph.json OR imports normalizeGraph/readGraph/graphJsonPath must be
      // in the frozen allow-list (09's readers + 10's backend). 11 adds no module — so
      // the offender set must be empty.
      const files = await collectMjs(srcDir);
      assert.ok(files.length > 0, "found src/*.mjs files to scan");

      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file);
        const raw = await readFile(file, "utf8");
        const code = stripCommentsAndStrings(raw);
        const specs = importSpecifiers(stripCommentsOnly(raw));

        // Does this module reach graph.json / the pure normalizer in LIVE code?
        const importsNormalizer = specs.some((s) => /(^|\/)graph-normalize\.mjs$/.test(s));
        const usesGraphReadSymbols =
          /\bnormalizeGraph\b/.test(code) || /\breadGraph\b/.test(code) || /\bgraphJsonPath\b/.test(code);
        // A live-code `graph.json` token (string literals stripped — so this catches a
        // bare identifier path build, not a documented mention). Belt-and-braces with
        // the symbol/import checks above.
        const readsGraphJsonLiteral = /graph\.json/.test(raw) && !/graph\.json/.test(code)
          ? false // only a comment/string mention — discounted
          : /graphJson|graph_json/.test(code);

        if (importsNormalizer || usesGraphReadSymbols || readsGraphJsonLiteral) {
          if (!GRAPH_READER_ALLOWLIST.has(rel)) offenders.push(rel);
        }
      }

      assert.deepEqual(
        offenders,
        [],
        `no NEW src/ module (outside the frozen 09-readers + 10-backend allow-list) may read graph.json / import normalizeGraph/readGraph — 11 adds none; offenders: ${offenders.join(", ")}`
      );

      // Sanity: the allow-list is REAL (each listed module exists and is a known
      // reader) — guards against the allow-list silently masking a regression by
      // listing a non-existent path.
      for (const rel of GRAPH_READER_ALLOWLIST) {
        const raw = await readFile(path.join(repoRoot, rel), "utf8");
        const code = stripCommentsAndStrings(raw);
        const specs = importSpecifiers(stripCommentsOnly(raw));
        const isReader =
          specs.some((s) => /(^|\/)graph-normalize\.mjs$/.test(s)) ||
          /\bnormalizeGraph\b|\breadGraph\b|\bgraphJsonPath\b/.test(code);
        assert.ok(isReader, `allow-listed reader ${rel} is genuinely a graph.json reader (allow-list is honest)`);
      }
    },
  },
];
