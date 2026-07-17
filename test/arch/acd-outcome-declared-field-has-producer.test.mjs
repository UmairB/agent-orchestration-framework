// Fitness function: acd-outcome-declared-field-has-producer (milestone 39 / ADR-005,
// story 04's deliverable) — "given (i) a declared field set from a single source of
// truth and (ii) a bounded set of producer modules, compute the declared fields with
// ZERO producer write-site and FAIL RED on any non-empty result."
//
// GENERALISES test/arch/acd-assignment-state-has-producer.test.mjs (35/ADR-001, "no
// state exists without a writer") from a state ENUM to a record-format FIELD SET:
//   (i)  the declared field set  = MEMORY_RECORD_FIELDS (src/memory/local-retrieval.mjs)
//   (ii) the producer modules    = the record parsers (src/memory/local-indexing.mjs:
//        parseArchitecture, parseRetrospective, parseAof, and — once story 02 lands,
//        concurrently — parseOutcome), all of which live in the ONE bounded module.
//
// "Has a producer" = some producer module ASSIGNS the field — object-shorthand
// `{ field, … }`, explicit `field: …`, or `record.field = …` (never `==`/`===`) —
// NEVER a bare substring match. This is empirically load-bearing, not a defensive
// nicety: parseRetrospective / parseArchitecture / parseAof all write `id`, `title`,
// `item`, `itemSlug`, `summary` via OBJECT-SHORTHAND ONLY — an explicit-key-only
// detector would report those as dangling TODAY, a false positive on a real
// producer. A trailing `//` comment between a comma and the next key (real example:
// `source:` sits right after a `// searchable blob` comment in every parser) also
// breaks a naive whitespace-run assumption, so comments are stripped before matching.
//
// ── Honest scope boundary (ADR-005) ──────────────────────────────────────────────
// IN SCOPE: a record-format field, drawn from a single-source ENUMERABLE list, with
// producers that are grep-able SAME-LANGUAGE write-sites in a BOUNDED module set —
// exactly the class that produced the `warnings_delivered` defect.
// OUT OF SCOPE, explicitly, not by omission: a CLI flag, an HTTP endpoint, a config
// key, a dynamically or reflectively written field, or a cross-language producer —
// none of these is statically enumerable in general in this codebase; the check
// reads no such declaration and renders no verdict over them. It catches the
// motivating class and claims nothing more.
// ──────────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_RECORD_FIELDS } from "../../src/memory/local-retrieval.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// (ii) The bounded producer module set. Every parser that can assign a
// MemoryRecord field lives in this ONE module (05/ADR-007's 2-importer seam;
// 39/ADR-002 composes `parseOutcome` into the SAME file, not a new module) — so a
// single-file read is the whole bounded set, today and once story 02 lands.
export const PRODUCER_MODULE_PATHS = ["src/memory/local-indexing.mjs"];

// The honest scope boundary as DATA (not just prose) — cross-checked against the
// top-of-file comment above by this file's own self-test, and reused by the
// traceability test's Scenario Outline so the disclaimer cannot silently drift
// from the code that claims it.
export const IN_SCOPE_DECLARATION_CLASSES = ["record-format field"];
export const OUT_OF_SCOPE_DECLARATION_CLASSES = [
  "CLI flag",
  "HTTP endpoint",
  "config key",
  "dynamically or reflectively written field",
  "cross-language producer",
];

export async function readProducerSources(root = repoRoot) {
  return Promise.all(PRODUCER_MODULE_PATHS.map((rel) => readFile(path.join(root, rel), "utf8")));
}

// The structural boundary check (review fix — extracted so the traceability
// test, test/dangling-declaration-ff.test.mjs, can REUSE these real
// predicates on its out-of-scope Scenario Outline rows instead of a trivial
// `field !== "CLI flag"` string comparison). Only "CLI flag" and "HTTP
// endpoint" have an obvious STATIC string-shape predicate in this codebase;
// the remaining out-of-scope classes (config key / dynamically-or-
// reflectively-written field / cross-language producer) have none — see
// `SELF_MODULE_PATH` below for how those rows are covered instead.
export function isCliFlagShaped(field) {
  return field.startsWith("--");
}
export function isHttpEndpointShaped(field) {
  return field.startsWith("/");
}

// This module's own source path (review fix) — reused by the traceability
// test so an out-of-scope row WITHOUT a structural shape predicate can assert
// the SAME "documented as out of scope" invariant the "honest scope boundary"
// test below already enforces on itself, rather than a vacuous per-field
// string comparison.
export const SELF_MODULE_PATH = fileURLToPath(import.meta.url);

// Strip `//` line comments before matching. Two reasons, both real: (1) a field
// name mentioned only in prose ("// nothing populates the summary field") must
// never count as a producer write-site; (2) a trailing comment sitting between a
// comma and the next key (the real `source:` case above) must not break the
// whitespace-run the shorthand/explicit patterns rely on.
function stripLineComments(source) {
  return String(source).replace(/\/\/[^\n]*/g, "");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The three producer write-site SYNTAX shapes this detector recognises (ADR-005 /
// 39 STATE flag 5): object-shorthand `{ field, … }`, explicit `field: …`, and
// `record.field = …` (excluding `==`/`===`). A bare occurrence of the field name
// anywhere else in the source — a comment, a substring of a longer identifier, a
// string literal's prose — is NEVER a match.
function fieldWriteSitePatterns(field) {
  const f = escapeRegExp(field);
  return [
    new RegExp(`[{,]\\s*${f}\\s*:`), // explicit key:    { …, field: value, … }
    new RegExp(`[{,]\\s*${f}\\s*(?=[,}])`), // object shorthand: { …, field, … }
    new RegExp(`\\.${f}\\s*=(?!=)`), // dot-write:       record.field = value  (not ==/===)
  ];
}

// Pure: does ANY of the bounded producer module sources assign `field`?
export function hasProducerWriteSite(field, moduleSources) {
  const patterns = fieldWriteSitePatterns(field);
  return moduleSources.some((raw) => {
    const src = stripLineComments(raw);
    return patterns.some((re) => re.test(src));
  });
}

// The ADR-005 contract: the declared fields with ZERO producer write-site among
// the bounded module set. Empty ⇒ clean; non-empty ⇒ the fitness function is red.
export function findDanglingFields(fields, moduleSources) {
  return fields.filter((field) => !hasProducerWriteSite(field, moduleSources));
}

export const archTests = [
  {
    name: "arch/39 ADR-005: every declared record-format field (MEMORY_RECORD_FIELDS) has a producer write-site — the dangling set is empty",
    run: async () => {
      const sources = await readProducerSources();
      const dangling = findDanglingFields(MEMORY_RECORD_FIELDS, sources);
      assert.deepEqual(dangling, [], `dangling declared fields with no producer: ${JSON.stringify(dangling)}`);
    },
  },
  {
    name: "arch/39 ADR-005: a planted producerless field (the warnings_delivered shape) trips the SAME detector and fails red — non-vacuous",
    run: async () => {
      const sources = await readProducerSources();

      // The real field list is clean under the SAME detector call...
      assert.deepEqual(findDanglingFields(MEMORY_RECORD_FIELDS, sources), [], "the real field set stays clean");

      // ...but a THROWAWAY field list — never the frozen MEMORY_RECORD_FIELDS —
      // carrying a synthetic producerless field (the warnings_delivered shape: a
      // retro-lesson-driven format extension nothing populates) trips it.
      const plantedFields = [...MEMORY_RECORD_FIELDS, "warnings_delivered"];
      const dangling = findDanglingFields(plantedFields, sources);
      assert.deepEqual(
        dangling,
        ["warnings_delivered"],
        `expected exactly the planted field to dangle: ${JSON.stringify(dangling)}`,
      );

      // warnings_delivered stays synthetic-only — it is NEVER added to the real
      // frozen field set (05/ADR-005).
      assert.ok(!MEMORY_RECORD_FIELDS.includes("warnings_delivered"), "warnings_delivered stays synthetic, never real");
    },
  },
  {
    name: "arch/39 ADR-005: the detector requires a producer write-site — object-shorthand, explicit key, or dot-write — never a bare substring occurrence",
    run: async () => {
      // Every write-site shape the contract recognises, including a dot-write
      // (not exercised by the real parsers today, but part of the documented
      // contract) — all four field forms recognised as producers.
      const positiveSource = `
        function build() {
          return { recordType, id, item: itemValue, };
        }
        function later(record) {
          record.status = "open";
        }
      `;
      for (const field of ["recordType", "id", "item", "status"]) {
        assert.ok(hasProducerWriteSite(field, [positiveSource]), `${field} recognised via its write-site syntax`);
      }

      // A bare substring occurrence of the field name — inside a comment, inside
      // prose in a string literal, or as a prefix of a longer identifier — is
      // NEVER a producer write-site. (A `==`/`===` comparison is also rejected —
      // it reads a field, it does not produce one.)
      const negativeSource = `
        // nothing populates the "summary" field here
        const message = "there is no summaryless entry"; // "summary" only a substring of "summaryless"
        const ownerId = 5; // "owner" only appears as a substring of "ownerId"
        function guard(record) {
          if (record.status === "open") return true; // a READ, not a write
          return false;
        }
      `;
      for (const field of ["summary", "owner", "status"]) {
        assert.equal(
          hasProducerWriteSite(field, [negativeSource]),
          false,
          `${field} must NOT be recognised from a bare substring occurrence or a comparison read`,
        );
      }
    },
  },
  {
    name: "arch/39 ADR-005: the honest scope boundary is stated and asserted — record-format fields declared in scope; CLI flags, HTTP endpoints, config keys, and dynamic/cross-language producers declared out of scope",
    run: async () => {
      assert.deepEqual(IN_SCOPE_DECLARATION_CLASSES, ["record-format field"]);
      assert.deepEqual(OUT_OF_SCOPE_DECLARATION_CLASSES, [
        "CLI flag",
        "HTTP endpoint",
        "config key",
        "dynamically or reflectively written field",
        "cross-language producer",
      ]);

      // The declared surface this check actually reads (MEMORY_RECORD_FIELDS) never
      // contains a CLI-flag-, HTTP-endpoint-, or config-key-shaped entry — the
      // boundary is honoured by the INPUT, not merely claimed in prose.
      for (const field of MEMORY_RECORD_FIELDS) {
        assert.ok(!isCliFlagShaped(field), `${field} is not CLI-flag-shaped`);
        assert.ok(!isHttpEndpointShaped(field), `${field} is not HTTP-endpoint-shaped`);
      }

      const selfSource = await readFile(SELF_MODULE_PATH, "utf8");
      for (const clause of OUT_OF_SCOPE_DECLARATION_CLASSES) {
        assert.ok(selfSource.includes(clause), `top-of-file comment names "${clause}" as out of scope`);
      }
    },
  },
];
