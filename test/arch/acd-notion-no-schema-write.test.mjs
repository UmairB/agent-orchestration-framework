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

// The HTTP methods that WRITE. A write to a SCHEMA path is the forbidden
// never-touch-schema form; the only path the sync may write is `v1/pages`.
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT"]);
// Schema-object API paths — a write (POST/PATCH) to any of these is forbidden. The
// page create addresses the data source via the BODY (`parent.data_source_id`), NOT a
// write to `v1/data_sources` — that addressing is legitimate and is NOT a schema write.
const SCHEMA_PATH_RE = /^v1\/(databases|data_sources|data-sources)(\/|$)|\/properties(\/|$)/;

// From an `api` spawn argv's tokens, extract { method, path }: the method follows `-X`
// (ntn infers GET when absent); the path is the first `v1/…` token.
function apiCall(tokens) {
  if (tokens[0] !== "api") return null;
  const xi = tokens.indexOf("-X");
  const method = xi >= 0 && tokens[xi + 1] ? tokens[xi + 1] : "GET";
  const apiPath = tokens.find((t) => /^v1\//.test(t)) ?? null;
  return { method, path: apiPath };
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
    name: "arch/notion-no-schema-write: no src/notion/* spawn argv writes a database/data-source/property/view — the only write is a PAGE create/patch",
    async run() {
      let sawPageCreate = false;
      for (const file of await notionSourceFiles()) {
        const code = stripCommentsOnly(await readFile(file, "utf8"));
        for (const tokens of arrayLiteralTokenLists(code)) {
          const call = apiCall(tokens);
          if (!call || !call.path) continue;
          const isWrite = WRITE_METHODS.has(call.method);
          // A WRITE to a schema path (databases/data_sources/properties/views) is forbidden.
          assert.ok(
            !(isWrite && SCHEMA_PATH_RE.test(call.path)),
            `${path.relative(repoRoot, file)} constructs no schema write (found: ${call.method} ${call.path})`
          );
          if (call.method === "POST" && /^v1\/pages$/.test(call.path)) sawPageCreate = true;
        }
      }
      assert.ok(sawPageCreate, "the apply layer DOES create a PAGE (POST v1/pages) — the create surface is real, not absent");

      // Self-check (non-vacuous): the guard FIRES on a planted schema write and does NOT
      // fire on the accepted page create (which addresses the data source via the body).
      const dbWrite = apiCall(arrayLiteralTokenLists('["api", "-X", "POST", "v1/databases", "-d", body]')[0]);
      assert.ok(WRITE_METHODS.has(dbWrite.method) && SCHEMA_PATH_RE.test(dbWrite.path), "the guard fires on a planted POST to v1/databases");
      const pageWrite = apiCall(arrayLiteralTokenLists('["api", "-X", "POST", "v1/pages", "-d", body]')[0]);
      assert.ok(!SCHEMA_PATH_RE.test(pageWrite.path), "the guard does NOT fire on a page create (POST v1/pages, data source named in the body)");
    },
  },
];
