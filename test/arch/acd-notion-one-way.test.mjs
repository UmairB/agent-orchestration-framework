// Fitness function for milestone 17 / ADR-003 (inv. 2):
//   "One-way / Notion-never-authoritative. Every Notion call is disk→Notion
//    (create/patch) or an addressing metadata read; NO path reads a Notion page's
//    status/title and writes it to disk; on divergence disk overwrites Notion."
//
// Source-grep of src/notion/sync.mjs + projection.mjs, CI-able offline:
//   (a) The Notion-CLI spawn argv only ever names PAGE create / PAGE patch
//       (`pages create` / `pages update`) — a disk→Notion write (the as-built egress,
//       STATE story-02 note). There is no Notion READ verb whose result feeds disk.
//   (b) The apply layer imports NO fs-WRITE of a record doc (STORY.md / SPEC.md /
//       frontmatter) — the only disk write it makes is the aof-owned sidecar
//       (recordPageId). There is no read-Notion→write-disk path.
//   Self-checked non-vacuous: the spawn-verb extractor sees a planted forbidden read
//   verb, and the record-doc-write matcher fires on a planted STORY.md write form.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SYNC = path.join(repoRoot, "src", "notion", "sync.mjs");
const PROJECTION = path.join(repoRoot, "src", "notion", "projection.mjs");

// Keep STRING literals (so we read argv-token strings) but drop comments — a `pages`
// in a comment is discounted while a real `["pages", "create", …]` argv survives.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The HTTP methods the apply layer is ALLOWED to construct against `v1/pages`: POST
// (create) / PATCH (update) — both disk→Notion page WRITES (the real `ntn api -X
// <method> v1/pages …` egress). A GET (a READ whose result could feed disk) is
// forbidden, as is any non-page path (a query/search/schema endpoint).
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT"]);
// The ntn `pages <verb>` convenience verbs the apply layer may use: page-content
// WRITES (disk→Notion). A `pages get` (read) / `pages trash` (delete) is forbidden.
const PAGE_WRITE_VERBS = new Set(["create", "edit"]);
const PAGE_READ_VERBS = new Set(["get", "retrieve", "trash"]);

// Pull the ordered string-literal tokens out of every array literal in the source —
// the apply layer builds its argv as `["api", "-X", "POST", "v1/pages", "-d", …]`.
function arrayLiteralTokenLists(codeWithStrings) {
  const lists = [];
  for (const m of codeWithStrings.matchAll(/\[([^\]]*)\]/g)) {
    const toks = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    if (toks.length > 0) lists.push(toks);
  }
  return lists;
}

// From an `api` spawn argv's tokens, extract { method, path }: the method is the token
// after `-X` (ntn infers GET when absent — a READ); the path is the first `v1/…` token.
// Returns null for a non-`api` array literal (e.g. the ACTION_BY_OP map).
function apiCall(tokens) {
  if (tokens[0] !== "api") return null;
  const xi = tokens.indexOf("-X");
  const method = xi >= 0 && tokens[xi + 1] ? tokens[xi + 1] : "GET";
  const apiPath = tokens.find((t) => /^v1\//.test(t)) ?? null;
  return { method, path: apiPath };
}

// A fs-write of a record doc (STORY.md / SPEC.md / a frontmatter file) — the forbidden
// read-Notion→write-disk sink. We forbid a writeFile/appendFile whose target names a
// record doc. (recordPageId writes the SIDECAR via mapping.mjs, not a record doc.)
const RECORD_DOC_WRITE =
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync)\s*\([^)]*(?:STORY\.md|SPEC\.md|frontmatter)/i;

export const archTests = [
  {
    name: "arch/notion-one-way: every Notion-CLI spawn argv is a PAGE write (POST/PATCH v1/pages) — no GET read whose result could feed disk, no non-page path",
    async run() {
      const code = stripCommentsOnly(await readFile(SYNC, "utf8"));
      const lists = arrayLiteralTokenLists(code);
      let sawPageWrite = false;
      for (const tokens of lists) {
        // Form 1: a raw `api -X <method> v1/…` call.
        const call = apiCall(tokens);
        if (call && call.path) {
          // The path must address a PAGE (v1/pages or v1/pages/<id>), never a read/query/
          // search/schema endpoint whose result could feed disk.
          assert.ok(
            /^v1\/pages(\/|$)/.test(call.path),
            `${path.relative(repoRoot, SYNC)} addresses only v1/pages (found path "${call.path}")`
          );
          // The method must be a WRITE (disk→Notion). A GET read is the forbidden
          // read-as-truth form.
          assert.ok(
            WRITE_METHODS.has(call.method),
            `${path.relative(repoRoot, SYNC)} issues only write methods to v1/pages (found "${call.method} ${call.path}")`
          );
          sawPageWrite = true;
          continue;
        }
        // Form 2: a ntn `pages <verb>` convenience command (e.g. `pages edit` sets the
        // page BODY). Only page-content WRITES are allowed; a `pages get` (read) /
        // `pages trash` (delete) is the forbidden read-as-truth / destructive form.
        if (tokens[0] === "pages" && tokens[1]) {
          const verb = tokens[1];
          assert.ok(
            !PAGE_READ_VERBS.has(verb),
            `${path.relative(repoRoot, SYNC)} issues no Notion page READ/delete verb (found "pages ${verb}")`
          );
          assert.ok(
            PAGE_WRITE_VERBS.has(verb),
            `${path.relative(repoRoot, SYNC)} uses only page-content writes via \`pages <verb>\` (found "pages ${verb}")`
          );
          sawPageWrite = true;
        }
      }
      assert.ok(sawPageWrite, "the apply layer DOES spawn a page write (the one-way egress is real, not absent)");

      // Self-check (non-vacuous): a planted GET read of a page is caught (not a write
      // method); a planted POST to a non-page (schema) path is caught (path guard); and a
      // planted `pages get` read verb is caught (not a page-content write).
      const read = apiCall(arrayLiteralTokenLists('["api", "-X", "GET", "v1/pages/" + id]')[0]);
      assert.ok(read && read.method === "GET" && !WRITE_METHODS.has(read.method), "the guard flags a planted `-X GET v1/pages` read");
      const schema = apiCall(arrayLiteralTokenLists('["api", "-X", "POST", "v1/databases", "-d", body]')[0]);
      assert.ok(schema && !/^v1\/pages(\/|$)/.test(schema.path), "the guard flags a planted POST to a non-page (v1/databases) path");
      assert.ok(PAGE_READ_VERBS.has("get") && !PAGE_WRITE_VERBS.has("get"), "the guard flags a planted `pages get` read verb");
    },
  },
  {
    name: "arch/notion-one-way: the apply layer writes NO record doc (STORY.md/SPEC.md/frontmatter) — the only disk write is the aof-owned sidecar; no read-Notion→write-disk path",
    async run() {
      for (const file of [SYNC, PROJECTION]) {
        const code = stripCommentsOnly(await readFile(file, "utf8"));
        assert.ok(
          !RECORD_DOC_WRITE.test(code),
          `${path.relative(repoRoot, file)} writes no record doc from a Notion-derived value (no read-Notion→write-disk path)`
        );
      }
      // Self-check (non-vacuous): the matcher FIRES on a planted record-doc write and
      // does NOT fire on the accepted sidecar-record / page-write forms.
      assert.ok(
        RECORD_DOC_WRITE.test('await writeFile(path.join(item.dir, "STORY.md"), notionStatus)'),
        "the record-doc-write guard fires on a planted STORY.md write from a Notion value"
      );
      assert.ok(
        !RECORD_DOC_WRITE.test('await recordPageId(projectRoot, dataSourceId, op.ref, newPageId, meta)'),
        "the record-doc-write guard does NOT fire on the accepted sidecar record"
      );
    },
  },
];
