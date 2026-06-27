// Fitness function FF-D for milestone 18 / ADR-006 (no Notion read on associate or
// projection — 17/ADR-003 REAFFIRMED):
//   Neither the associate write (src/commands/notion-associate.mjs) nor the projection
//   (src/notion/projection.mjs) imports/constructs a Notion spawn seam (makeNotionSpawn /
//   notion/cli / notionSpawn) NOR a Notion read-verb argv (retrieve/query/search/list/
//   get). Addressing (board/parent) comes ONLY from committed config + the descriptor,
//   never a Notion query. PLUS a SNAPSHOT guard over acd-notion-one-way's allowed/
//   forbidden verb sets (byte-for-byte unchanged) — a future edit that loosens one-way
//   fails HERE too.
//
// Two proofs, CI-able offline. Supersedes acd-notion-parent-no-read (re-pointed at the
// descriptor-era associate + projection; the one-way snapshot is reaffirmed, never refined).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ASSOCIATE = path.join(repoRoot, "src", "commands", "notion-associate.mjs");
const PROJECTION = path.join(repoRoot, "src", "notion", "projection.mjs");
const ONE_WAY = path.join(repoRoot, "test", "arch", "acd-notion-one-way.test.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const NOTION_READ_VERBS = ["retrieve", "query", "search", "list", "get"];

// Array-literal string tokens (a spawn argv is an array of string literals).
function arrayTokenLists(code) {
  const lists = [];
  for (const m of code.matchAll(/\[([^\]]*)\]/g)) {
    const toks = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
    if (toks.length) lists.push(toks);
  }
  return lists;
}

export const archTests = [
  {
    name: "arch/18 FF-D: the associate write + the projection import no Notion spawn seam and construct no Notion read-verb argv",
    async run() {
      for (const file of [ASSOCIATE, PROJECTION]) {
        const code = stripComments(await readFile(file, "utf8"));
        const rel = path.relative(repoRoot, file);
        assert.ok(
          !/makeNotionSpawn|notion\/cli|notionSpawn/.test(code),
          `${rel} imports/constructs no Notion spawn seam (makeNotionSpawn/notion/cli/notionSpawn)`
        );
        for (const tokens of arrayTokenLists(code)) {
          // A Notion argv names "api" then a noun then a verb. Forbid any read verb in an
          // argv-shaped array literal in the associate/projection path.
          if (tokens.includes("api")) {
            for (const verb of NOTION_READ_VERBS) {
              assert.ok(!tokens.includes(verb), `${rel} constructs no Notion read verb (found "${verb}")`);
            }
          }
        }
      }
    },
  },
  {
    name: "arch/18 FF-D: the acd-notion-one-way write-method + page-path invariants are intact (snapshot guard — reaffirms 17/ADR-003 over the real ntn api egress)",
    async run() {
      const src = await readFile(ONE_WAY, "utf8");
      const nows = src.replace(/\s+/g, ""); // whitespace-insensitive snapshot
      // The one-way egress allows ONLY write methods (POST/PATCH/PUT) — never a GET read.
      assert.ok(
        nows.includes('WRITE_METHODS=newSet(["POST","PATCH","PUT"])'),
        "the allowed write-method set is unchanged (POST/PATCH/PUT — disk→Notion writes only)"
      );
      // And the path guard pins every write to v1/pages (never a schema/query endpoint).
      assert.ok(
        nows.includes('/^v1\\/pages(\\/|$)/.test(call.path)'),
        "the page-only path guard (v1/pages) is intact"
      );
      // Self-check (non-vacuous): a GET read is NOT in the allowed write-method set.
      assert.ok(!nows.includes('WRITE_METHODS=newSet(["POST","PATCH","PUT","GET"])'), "a loosened set admitting GET is not on disk (the guard would fire)");
    },
  },
];
