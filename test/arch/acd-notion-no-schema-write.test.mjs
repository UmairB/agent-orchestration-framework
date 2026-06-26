// Fitness function for milestone 17 / ADR-003 + SPEC §Out of scope (inv. 5):
//   "Never-touch-board-schema. The sync NEVER creates a database / data source /
//    property / view — it only creates/patches PAGES and reads metadata."
//
// Source-grep of src/notion/*, CI-able offline: across every Notion-CLI spawn argv,
// the ONLY create is a PAGE create — no schema-create noun-verb appears:
//   - no `databases create` / `data-sources create` / `data_sources create`;
//   - no `update-data-source-properties` (a property mutation);
//   - no `properties create` / a create-property verb.
// The accepted forms: `pages create` / `pages update`, and the `--data-source-id`
// ADDRESSING flag (which names — but never CREATES — a data source).
// Self-checked non-vacuous: the schema-create matcher fires on a planted
// `databases create` / `update-data-source-properties` form.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_NOTION_DIR = path.join(repoRoot, "src", "notion");

function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The ordered string-literal tokens of every array literal in the source (the apply
// layer builds `["api", "pages", "create", …]` — schema nouns/verbs would surface as
// literal tokens the same way).
function arrayLiteralTokenLists(codeWithStrings) {
  const lists = [];
  for (const m of codeWithStrings.matchAll(/\[([^\]]*)\]/g)) {
    const toks = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    if (toks.length > 0) lists.push(toks);
  }
  return lists;
}

// Schema-object NOUNS — a `create` against any of these (or a property mutation verb)
// is the forbidden never-touch-schema form. The only noun the sync may `create` is
// `pages`.
const SCHEMA_NOUNS = new Set(["databases", "database", "data-sources", "data_sources", "properties", "property", "views", "view"]);
// A standalone schema-mutation verb token (a property/schema mutation the CLI exposes).
const SCHEMA_MUTATION_TOKENS = new Set([
  "update-data-source-properties",
  "create-database",
  "create-data-source",
  "create-property",
]);

// A schema-create / schema-mutation appearing as adjacent argv tokens (a `<schema-noun>
// create`) OR a standalone schema-mutation token. Used over the joined token stream so
// a noun-then-create pair is caught regardless of intervening flags placement.
function schemaWriteTokens(tokens) {
  const hits = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (SCHEMA_MUTATION_TOKENS.has(t)) hits.push(t);
    if (SCHEMA_NOUNS.has(t)) {
      const next = tokens[i + 1];
      if (next === "create" || next === "update") hits.push(`${t} ${next}`);
    }
  }
  return hits;
}

async function notionSourceFiles() {
  const files = [];
  for (const entry of await readdir(SRC_NOTION_DIR)) {
    if (entry.endsWith(".mjs")) files.push(path.join(SRC_NOTION_DIR, entry));
  }
  return files;
}

export const archTests = [
  {
    name: "arch/notion-no-schema-write: no src/notion/* spawn argv creates a database/data-source/property/view — the only create is a PAGE create",
    async run() {
      let sawPageCreate = false;
      for (const file of await notionSourceFiles()) {
        const code = stripCommentsOnly(await readFile(file, "utf8"));
        for (const tokens of arrayLiteralTokenLists(code)) {
          const hits = schemaWriteTokens(tokens);
          assert.deepEqual(
            hits,
            [],
            `${path.relative(repoRoot, file)} constructs no schema-create/mutation argv (found: ${hits.join(", ")})`
          );
          // Track that a PAGE create IS present (so the guard is over a real create surface).
          for (let i = 0; i < tokens.length - 1; i += 1) {
            if (tokens[i] === "pages" && tokens[i + 1] === "create") sawPageCreate = true;
          }
        }
      }
      assert.ok(sawPageCreate, "the apply layer DOES create a PAGE (the create surface is real, not absent)");

      // Self-check (non-vacuous): the matcher FIRES on planted schema-create forms and
      // does NOT fire on the accepted page-create / addressing-flag forms.
      assert.deepEqual(
        schemaWriteTokens(["api", "databases", "create", "--title", "x"]),
        ["databases create"],
        "the schema-write matcher fires on a planted `databases create` form"
      );
      assert.deepEqual(
        schemaWriteTokens(["api", "update-data-source-properties", "--id", "x"]),
        ["update-data-source-properties"],
        "the schema-write matcher fires on a planted property-mutation token"
      );
      assert.deepEqual(
        schemaWriteTokens(["api", "pages", "create", "--data-source-id", "ds"]),
        [],
        "the schema-write matcher does NOT fire on `pages create` with a `--data-source-id` addressing flag"
      );
    },
  },
];
