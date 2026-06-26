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

// The Notion-CLI verb pairs the apply layer is ALLOWED to construct: a `pages create`
// / `pages update` — both disk→Notion page writes (the as-built `ntn api pages …`
// egress). A `pages retrieve` / `pages query` / `search` / `databases query` (a READ
// whose result could feed disk) is forbidden.
const NOTION_WRITE_NOUN_VERBS = [
  ["pages", "create"],
  ["pages", "update"],
];
// Notion noun-verb read forms that, if present, could feed Notion state back to disk.
const NOTION_READ_VERBS = ["retrieve", "query", "search", "list", "get"];

// Pull the ordered string-literal tokens out of every array literal in the source —
// the apply layer builds its argv as `["api", "pages", "create", …]`, so the noun-verb
// pair is two adjacent literal tokens inside an array.
function arrayLiteralTokenLists(codeWithStrings) {
  const lists = [];
  for (const m of codeWithStrings.matchAll(/\[([^\]]*)\]/g)) {
    const toks = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    if (toks.length > 0) lists.push(toks);
  }
  return lists;
}

// The noun-verb pairs an array's tokens express: each adjacent (tok[i], tok[i+1]).
function nounVerbPairs(tokens) {
  const pairs = [];
  for (let i = 0; i < tokens.length - 1; i += 1) pairs.push([tokens[i], tokens[i + 1]]);
  return pairs;
}

// A fs-write of a record doc (STORY.md / SPEC.md / a frontmatter file) — the forbidden
// read-Notion→write-disk sink. We forbid a writeFile/appendFile whose target names a
// record doc. (recordPageId writes the SIDECAR via mapping.mjs, not a record doc.)
const RECORD_DOC_WRITE =
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync)\s*\([^)]*(?:STORY\.md|SPEC\.md|frontmatter)/i;

export const archTests = [
  {
    name: "arch/notion-one-way: every Notion-CLI spawn argv names a PAGE create/update (disk→Notion) — no Notion READ verb whose result could feed disk",
    async run() {
      const code = stripCommentsOnly(await readFile(SYNC, "utf8"));
      const lists = arrayLiteralTokenLists(code);
      let sawPageWrite = false;
      for (const tokens of lists) {
        for (const [noun, verb] of nounVerbPairs(tokens)) {
          if (noun === "pages") {
            const allowed = NOTION_WRITE_NOUN_VERBS.some(([n, v]) => n === noun && v === verb);
            assert.ok(
              allowed,
              `${path.relative(repoRoot, SYNC)} names only a PAGE create/update (found "pages ${verb}", a non-write page verb)`
            );
            sawPageWrite = true;
          }
          // A read verb following ANY noun (databases/data_sources/search) is the
          // forbidden read-as-truth form.
          assert.ok(
            !NOTION_READ_VERBS.includes(verb),
            `${path.relative(repoRoot, SYNC)} issues no Notion READ verb whose result feeds disk (found "${noun} ${verb}")`
          );
        }
      }
      assert.ok(sawPageWrite, "the apply layer DOES spawn a page write (the one-way egress is real, not absent)");

      // Self-check (non-vacuous): the extractor sees a planted forbidden read verb and
      // the allowed-pair check would reject it.
      const planted = arrayLiteralTokenLists('["api", "pages", "retrieve", "--page-id", id]');
      const plantedPairs = planted.flatMap(nounVerbPairs);
      assert.ok(
        plantedPairs.some(([n, v]) => n === "pages" && NOTION_READ_VERBS.includes(v)),
        "the verb extractor fires on a planted forbidden `pages retrieve` read form"
      );
      assert.ok(
        !NOTION_WRITE_NOUN_VERBS.some(([n, v]) => n === "pages" && v === "retrieve"),
        "`pages retrieve` is NOT in the allowed write-pair set"
      );
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
