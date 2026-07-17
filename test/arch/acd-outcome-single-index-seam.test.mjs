// Fitness function for milestone 39 / ADR-002:
// "`buildRecords` (src/memory/local-indexing.mjs) remains the SINGLE shared
//  record-source seam BOTH backends consume; `parseOutcome` is composed into it,
//  not bolted onto one backend — so a delivery record reaches `local` AND
//  `graphify` with no graphify-only parser."
//
// Graph-verified blast radius (fresh `graph build src`): `graph impact
// src/memory/local-indexing.mjs` → `imported/called by ← (2)` = local-backend +
// graphify-backend, exactly the two backends. So a source parser added HERE reaches
// both; a source parser added in a BACKEND would fork the seam.
//
// Idiom: a NON-VACUOUS live assertion armed TODAY — the graphify backend's only
// record-source is the imported `buildRecords`, and NO source parser is defined in
// a backend (all live in local-indexing) — so forking the seam goes RED today.
// Red-until-built: the "parseOutcome reaches the shared seam" half is inert-green
// until story 02 exports the parser, then self-activates.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEXING = path.join(repoRoot, "src", "memory", "local-indexing.mjs");
const GRAPHIFY_BACKEND = path.join(repoRoot, "src", "memory", "graphify-backend.mjs");
const LOCAL_BACKEND = path.join(repoRoot, "src", "memory", "local-backend.mjs");

// A parser DEFINITION (not a re-export / import): `function parseX(` or
// `const parseX =`. Used to prove the source parsers live only in local-indexing.
const PARSER_DEF_RE = /(?:function|const)\s+(parse(?:Outcome|Architecture|Retrospective|Aof)\b)/g;

async function outcomeParser() {
  const mod = await import("../../src/memory/local-indexing.mjs");
  return typeof mod.parseOutcome === "function" ? mod.parseOutcome : null;
}

export const archTests = [
  {
    name: "arch/39 ADR-002: the graphify backend's record-source is the imported buildRecords, and it defines NO source parser of its own — LIVE, non-vacuous",
    run: async () => {
      const graphifySrc = await readFile(GRAPHIFY_BACKEND, "utf8");
      const localBackendSrc = await readFile(LOCAL_BACKEND, "utf8");
      const indexingSrc = await readFile(INDEXING, "utf8");

      // (a) graphify reaches records ONLY through the shared buildRecords import.
      assert.match(
        graphifySrc,
        /import\s*\{[^}]*\bbuildRecords\b[^}]*\}\s*from\s*["']\.\/local-indexing\.mjs["']/,
        "graphify-backend imports buildRecords from local-indexing (the shared seam)",
      );

      // (b) NO source parser is defined inside a backend — they all live in local-indexing.
      for (const [label, src] of [["graphify-backend", graphifySrc], ["local-backend", localBackendSrc]]) {
        const defs = [...src.matchAll(PARSER_DEF_RE)].map((m) => m[1]);
        assert.deepEqual(
          defs,
          [],
          `${label} defines no source parser (found: ${defs.join(", ") || "none"}) — the seam is not forked`,
        );
      }

      // (c) the existing source parsers DO live in local-indexing (non-vacuity anchor).
      const homeDefs = new Set([...indexingSrc.matchAll(PARSER_DEF_RE)].map((m) => m[1]));
      for (const parser of ["parseArchitecture", "parseRetrospective", "parseAof"]) {
        assert.ok(homeDefs.has(parser), `${parser} is defined in local-indexing (the single seam)`);
      }
    },
  },
  {
    name: "arch/39 ADR-002: parseOutcome is composed into buildRecords — an OUTCOME.md in the stream yields capability/gap records via the shared seam (self-activates)",
    run: async () => {
      const parseOutcome = await outcomeParser();
      if (!parseOutcome) return; // inert-green until story 02 exports the parser

      // Prove the parser is WIRED INTO buildRecords (not merely exported): a milestone
      // folder carrying an OUTCOME.md must yield delivery records from buildRecords.
      const { buildRecords } = await import("../../src/memory/local-indexing.mjs");
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-outcome-seam-"));
      const workDir = path.join(projectRoot, "wiki", "work");
      const dir = path.join(workDir, "39_milestone_delivery-memory-outcome");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "OUTCOME.md"),
        `---
doc: outcome
---
# 39 · Delivery — Outcome

## Delivered

- The delivery-memory capability is now provided.

## Gaps

- \`warnings_delivered\` has no production producer. Discharge: a producer writes it. Status: open.
`,
        "utf8",
      );
      await mkdir(path.join(projectRoot, ".aof"), { recursive: true });

      const records = await buildRecords(null, { workDir, projectRoot });
      const delivery = records.filter((r) => ["capability", "gap"].includes(r.recordType));
      assert.ok(
        delivery.length > 0,
        "buildRecords composed parseOutcome — an OUTCOME.md in the stream produced capability/gap records reaching the shared seam",
      );
    },
  },
];
