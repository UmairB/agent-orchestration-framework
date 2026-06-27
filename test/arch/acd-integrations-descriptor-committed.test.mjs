// Fitness function FF-A for milestone 18 / ADR-003 + ADR-006 (descriptor-is-committed-
// not-derived):
//   "Routing is read from the per-folder `.integrations.json` descriptor + the `boards`
//    config, NEVER the git-ignored sidecar; the sidecar entry shape gains NO routing
//    field (board/parent/phase). The resolver DOES read the descriptor + boards."
//
// Source-grep of src/integrations/routing.mjs + src/notion/projection.mjs +
// src/notion/mapping.mjs + src/commands/notion-associate.mjs, CI-able offline:
//   (a) NO module reads a sidecar entry's routing field — no `entries[*].(board|parent
//       |phase)` access, and no `recordPageId(... board|parent ...)` call that would
//       persist routing onto a binding; the mapping entry shape names none of them.
//   (b) The resolver (routing.mjs) DOES read the descriptor (readRouting) AND the boards
//       registry (asBoardsRegistry/boards) — routing comes from committed facts.
// The forbidden-field matcher is WORD-BOUND (`\bboard\b`) so it does NOT false-positive
// on the v2 `boards` BUCKET key that mapping.mjs uses throughout (a legitimate
// sidecar-shape key, not a per-entry routing field) — the build-note gotcha.
//   Self-checked non-vacuous: the forbidden matchers fire on a planted entry-routing form.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTING = path.join(repoRoot, "src", "integrations", "routing.mjs");
const PROJECTION = path.join(repoRoot, "src", "notion", "projection.mjs");
const MAPPING = path.join(repoRoot, "src", "notion", "mapping.mjs");
const ASSOCIATE = path.join(repoRoot, "src", "commands", "notion-associate.mjs");

// Drop comments (keep string literals so an argv/key in a real expression survives) — a
// `board` in a comment is discounted; a real `entry.board` access survives.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// A read of a SIDECAR ENTRY's routing field — the forbidden derived-routing access. The
// sidecar binds { pageId, lastStatus, lastSyncedAt } only; reading a `board`/`parent`/
// `phase` OFF an entry (or recordPageId persisting one) would make routing DERIVED. The
// `board`/`parent`/`phase` field names are WORD-BOUND so the v2 `boards` bucket key (a
// legitimate sidecar-shape key) is NOT matched.
const ENTRY_ROUTING_READ =
  /\b(?:entry|entries\s*\[[^\]]*\]|e)\s*[.?]\s*(?:\??\.\s*)?\b(?:board|parent|phase)\b/;
// A `.board` / `.parent` / `.phase` property access ON a sidecar entry variable, the
// general dotted form (entry.board, entry?.parent, e.phase). Word-bound so `entry.boards`
// would NOT match (there is no such key, but the boundary keeps the matcher honest).
const DOTTED_ROUTING_FIELD =
  /\.\s*\b(?:board|parent|phase)\b(?!s)/;
// A recordPageId call that carries a routing argument (board/parent) into the binding —
// the forbidden "persist routing onto a derived entry" form. recordPageId's real arity is
// (projectRoot, dataSourceId, aofRef, pageId, meta) — no board/parent.
const RECORD_PAGE_ROUTING =
  /recordPageId\s*\([^)]*\b(?:board|parent)\b[^)]*\)/;

export const archTests = [
  {
    name: "arch/18 FF-A: no module reads a sidecar entry's routing field (board/parent/phase) and recordPageId persists none — routing is committed, not derived",
    async run() {
      for (const file of [ROUTING, PROJECTION, MAPPING, ASSOCIATE]) {
        const code = stripComments(await readFile(file, "utf8"));
        const rel = path.relative(repoRoot, file);
        assert.ok(!ENTRY_ROUTING_READ.test(code), `${rel} reads no routing field off a sidecar entry (entries[*].board|parent|phase)`);
        assert.ok(!RECORD_PAGE_ROUTING.test(code), `${rel} calls recordPageId with no board/parent argument (the binding gains no routing field)`);
      }
      // mapping.mjs specifically: its entry shape names pageId/lastStatus/lastSyncedAt
      // ONLY — assert no dotted .board/.parent/.phase access anywhere (the entry shape
      // gains no routing field), while the `boards` bucket key is untouched by the bound.
      const mappingCode = stripComments(await readFile(MAPPING, "utf8"));
      assert.ok(
        !DOTTED_ROUTING_FIELD.test(mappingCode),
        "mapping.mjs entry shape names no routing field (no .board/.parent/.phase access — only pageId/lastStatus/lastSyncedAt)"
      );
      // The word-bound matcher must NOT fire on the v2 `boards` BUCKET key the sidecar
      // uses pervasively (parsed.boards, boards[dataSourceId], { version, boards }).
      assert.ok(mappingCode.includes("boards"), "mapping.mjs legitimately uses the `boards` bucket key (the v2 sidecar shape)");
      assert.ok(
        !DOTTED_ROUTING_FIELD.test("const b = parsed.boards; const x = boards[dataSourceId];"),
        "the word-bound matcher does NOT false-positive on the v2 `boards` bucket key (the build-note gotcha)"
      );
    },
  },
  {
    name: "arch/18 FF-A: the resolver reads the descriptor + the boards config (routing comes from committed facts)",
    async run() {
      const code = stripComments(await readFile(ROUTING, "utf8"));
      assert.ok(/readRouting\s*\(/.test(code), "routing.mjs reads the committed `.integrations.json` descriptor (readRouting)");
      assert.ok(/asBoardsRegistry\s*\(|\.boards\b|\bboards\b/.test(code), "routing.mjs reads the committed `boards` registry config");
      // The resolver does NOT reach the sidecar at all — no mapping.mjs import, no
      // readMapping/resolvePageId (routing is committed, the sidecar is derived).
      assert.ok(!/readMapping|resolvePageId|recordPageId|notion\/mapping/.test(code), "routing.mjs never reaches the derived sidecar (no mapping import/read)");
    },
  },
  {
    name: "arch/18 FF-A (self-check): the forbidden matchers fire on a planted sidecar-entry-routing form",
    async run() {
      // Non-vacuous: a planted `entry.board` read and a planted `recordPageId(... board)`
      // are caught by the matchers; the accepted forms are not.
      assert.ok(ENTRY_ROUTING_READ.test("const b = entry.board;"), "the entry-routing matcher fires on a planted `entry.board` read");
      assert.ok(DOTTED_ROUTING_FIELD.test("const p = entry?.parent;"), "the dotted-field matcher fires on a planted `entry?.parent` read");
      assert.ok(
        RECORD_PAGE_ROUTING.test("recordPageId(root, ds, ref, pageId, { board, parent })"),
        "the recordPageId matcher fires on a planted routing argument"
      );
      // …and does NOT fire on the accepted forms (the real entry shape + the v2 bucket key).
      assert.ok(!DOTTED_ROUTING_FIELD.test("const id = entry.pageId; const s = entry.lastStatus;"), "the dotted-field matcher accepts the real entry shape (pageId/lastStatus)");
      assert.ok(!RECORD_PAGE_ROUTING.test("recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta)"), "the recordPageId matcher accepts the real (no-routing) arity");
    },
  },
];
