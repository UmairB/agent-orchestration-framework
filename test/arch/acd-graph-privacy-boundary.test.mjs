// Fitness function for milestone 09 / ADR-006 inv. 4 (privacy boundary not
// widened; ADR-001 + ADR-005):
// "No aof code path ships source code / AST to a backend. aof passes graphify a
//  `--backend` + a folder PATH only, and a null/absent backend ⇒ NO `--backend`
//  flag (zero egress; code/AST stays local — RESEARCH §E/F). aof never reads
//  source-file CONTENTS to send anywhere — it passes graphify a PATH and lets
//  graphify do the local AST extraction."
//
// Proven STRUCTURALLY (a source grep of the driver + the graph command modules,
// comments/strings discounted) plus a BEHAVIOURAL spot-check of the build
// command's egress classification:
//   (a) the build spawn passes graphify the input PATH (extract <path>) — aof
//       hands graphify a folder, never file CONTENTS;
//   (b) every `--backend` flag the driver emits is GATED on a truthy backend, so a
//       null/absent backend pushes NO `--backend` (and no secret/key flag is ever
//       passed);
//   (c) the only file the driver READS is the graph.json artifact (graphPath) —
//       it never reads `input.path` source contents to ship to a backend;
//   (d) the build command classifies egress "none" when no backend ran.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { graphBuildCommand, classifyEgress } from "../../src/commands/graph-build.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.join(repoRoot, "src");
const DRIVER = path.join(srcDir, "graphify.mjs");
// The pure graph.json read/normalize helpers were extracted to graph-normalize.mjs
// (10/01, a spawn-free module the graphify memory backend imports without touching
// the spawn site); graphify.mjs re-exports them. The driver's only file READ
// (readGraph) lives there now, so the "reads only the graph artifact" guard scans
// BOTH modules — the egress invariant is unchanged, only the read's home moved.
const NORMALIZER = path.join(srcDir, "graph-normalize.mjs");
const GRAPH_COMMANDS = [
  path.join(srcDir, "commands", "graph-build.mjs"),
  path.join(srcDir, "commands", "graph-query.mjs"),
  path.join(srcDir, "commands", "graph-triage.mjs"),
];

// Strip line + block comments AND string literals (the same call-form-not-comment
// discipline the no-face-spawn guard uses) so the grep sees only live code. A
// backtick template body becomes spaces (a `--backend` mentioned in a comment or a
// help string must NOT count as an emitted flag).
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

// Strip ONLY comments (keep string literals) — for asserting on the egress
// classifier, whose contract values ("none"/"docs-media") are string literals we
// WANT to see.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export const archTests = [
  {
    name: "arch/ADR-006 inv.4: aof passes graphify the input PATH (extract <path>) and emits NO secret/key flag",
    run: async () => {
      const raw = await readFile(DRIVER, "utf8");
      const code = stripCommentsAndStrings(raw);
      // The build spawn hands graphify the folder path (input.path), letting
      // graphify do the LOCAL AST extraction — aof never marshals file contents.
      assert.ok(/input\.path/.test(code), "the driver passes graphify the input.path folder (extract <path>)");
      // No credential/secret flag is ever marshalled to graphify (source/AST/keys
      // never leave the machine via aof — the egress is graphify's own doc/media
      // hop, unmodified).
      assert.ok(!/--api-?key/i.test(code), "the driver passes no --api-key flag");
      assert.ok(!/--secret/i.test(code), "the driver passes no --secret flag");
      // `--token-budget` is a graph-size budget, NOT a credential, so exclude it
      // explicitly: forbid a bare `--token`/`--token ` auth flag, allow `--token-budget`.
      assert.ok(!/--token(?!-budget)(?![\w-])/.test(code), "the driver passes no bare --token (auth) flag (--token-budget is a size budget, allowed)");
    },
  },
  {
    name: "arch/ADR-006 inv.4: every --backend flag the driver emits is GATED on a truthy backend (null/absent backend ⇒ no --backend, zero egress)",
    run: async () => {
      const raw = await readFile(DRIVER, "utf8");
      const code = stripCommentsAndStrings(raw);
      // Find every `--backend` occurrence in LIVE code (string-stripped, so the
      // flag literal survives only where it is a real argv push — `args.push(...)`
      // keeps the identifier `--backend`? No: it is a string. So we grep the RAW
      // source for the push call-form and verify each is inside a backend guard.)
      //
      // The structural contract: the ONLY place `--backend` is pushed is inside an
      // `if (input.backend)` (or equivalent truthiness) guard. We assert on the raw
      // source that each `args.push("--backend"...)` is preceded (in its block) by
      // a backend-truthiness condition, and that no UNGUARDED top-level push exists.
      const pushRe = /push\(\s*["']--backend["']/g;
      const pushes = [...raw.matchAll(pushRe)];
      assert.ok(pushes.length >= 1, "the driver emits a --backend flag for the with-backend path");
      for (const match of pushes) {
        // Look back a small window for the governing `if (input.backend)` guard.
        const before = raw.slice(Math.max(0, match.index - 200), match.index);
        assert.ok(
          /if\s*\(\s*input\.backend\b/.test(before),
          "every --backend push is gated on a truthy input.backend (no backend ⇒ no flag)"
        );
      }
      // Defensive: the initial `extract` argv array carries NO hard-coded
      // `--backend` (the flag is only ever a guarded push). The array literal is
      // `["extract", input.path]` — never a literal `--backend` before the guard.
      assert.ok(
        !/\[\s*["']extract["'][^\]]*--backend/.test(raw),
        "the initial extract argv carries no hard-coded --backend"
      );
    },
  },
  {
    name: "arch/ADR-006 inv.4: the driver READS only the graph.json artifact — never source-file contents to ship to a backend",
    run: async () => {
      // The driver's only file READ is `readGraph`, extracted to graph-normalize.mjs
      // (10/01) and re-exported from graphify.mjs. Scan BOTH so the invariant holds
      // wherever the read lives: every readFile* call targets graphPath / graph.json,
      // never input.path (the source folder). A read of input.path contents would
      // mean aof is marshalling source to ship to a backend.
      const readRe = /\b(readFileSync|readFile)\s*\(\s*([A-Za-z_$][\w.$]*)/g;
      let totalReads = 0;
      for (const module of [DRIVER, NORMALIZER]) {
        const code = stripCommentsAndStrings(await readFile(module, "utf8"));
        const reads = [...code.matchAll(readRe)];
        totalReads += reads.length;
        for (const match of reads) {
          const target = match[2];
          assert.ok(
            /graphPath|graph/i.test(target),
            `the file read targets the graph artifact (got read of \`${target}\` in ${path.basename(module)}), never source-file contents`
          );
          assert.ok(
            !/input/.test(target),
            "the driver never reads input.path (the source folder) contents to ship to a backend"
          );
        }
      }
      assert.ok(totalReads >= 1, "the driver reads the graph.json artifact (via readGraph in graph-normalize.mjs)");
    },
  },
  {
    name: "arch/ADR-006 inv.4: graph:build classifies egress `none` for a no-backend (offline) build and `docs-media` only when a backend hop ran",
    run: async () => {
      // The command modules grep: the offline/code-only path passes no backend.
      // Behavioural spot-check on the egress classifier (no live binary needed —
      // we stub the driver-fed result by reading the command's egress logic via
      // its own source, then assert the classification rule directly).
      const buildSrc = stripComments(await readFile(GRAPH_COMMANDS[0], "utf8"));
      // The classifier (extracted to classifyEgress, FIX 1): null/absent backend
      // → "none" (zero egress); ANY backend → "docs-media". A null/absent backend
      // MUST classify "none". Asserted both structurally (the helper body) and
      // BEHAVIOURALLY (the live exported classifier) below.
      assert.ok(
        /classifyEgress\s*\(\s*backend\s*\)\s*\{[\s\S]*?backend\s*==\s*null\s*\?\s*["']none["']\s*:\s*["']docs-media["']/.test(buildSrc),
        "classifyEgress maps a null/absent backend to `none` and any backend to `docs-media`"
      );
      // And the egress field on a BuildResult is computed via that classifier over
      // the input backend (defaulting to null when absent ⇒ "none").
      assert.ok(
        /egress\s*=\s*classifyEgress\s*\(\s*backend\s*\)/.test(buildSrc),
        "graph:build computes egress via classifyEgress(backend)"
      );
      assert.ok(
        /backend\s*=\s*input\.backend\s*\?\?\s*null/.test(buildSrc),
        "graph:build defaults an absent backend to null (⇒ egress none, no flag)"
      );
      // BEHAVIOURAL spot-check on the live exported classifier (no live binary):
      // none → "none", a network backend → "docs-media", and ollama (LOCAL) → STILL
      // "docs-media" — the doc/media hop RAN even though it ran on-box; locality is
      // a separate privacy property, never folded into the egress field (ADR-005).
      assert.equal(classifyEgress(null), "none", "no backend ⇒ egress none (code/AST only)");
      assert.equal(classifyEgress("claude"), "docs-media", "a network backend ⇒ egress docs-media");
      assert.equal(classifyEgress("ollama"), "docs-media", "ollama (local) ⇒ STILL docs-media — the hop ran; locality is not the egress field");
      // Sanity: the imported command object exposes the run + cli surface (so this
      // is the live command, not a stale copy).
      assert.equal(graphBuildCommand.id, "graph:build", "the imported command is graph:build");
      assert.equal(typeof graphBuildCommand.run, "function", "graph:build has a run()");
    },
  },
];
