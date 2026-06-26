// Fitness function for milestone 17 / ADR-001 (inv. 1):
//   "Mapping-sidecar-only. The aof↔Notion mapping lives ONLY in the git-ignored
//    `.aof/` sidecar keyed by aof ref; no code writes an aof-identity property onto a
//    Notion page and no code issues a resolve-by-query to find a page (the sidecar is
//    the sole resolver)."
//
// Two legs, both CI-able offline (no Notion, no spawn):
//   (a) ROUND-TRIP: import readMapping/resolvePageId/recordPageId and prove, over an
//       injected temp project root, a MISS → null then a HIT → the recorded pageId.
//       The sidecar is the SOLE identity store: the recorded id resolves back.
//   (b) SOURCE-GREP src/notion/*: (i) the sidecar file name is in AOF_GITIGNORE_ENTRIES
//       (the mapping is git-ignored, ADR-001); (ii) no Notion `filter`-by-id resolve
//       query appears (no resolve-by-query to FIND a page); (iii) no aof-identity
//       property write — the only page-property writes name title / status / relation.
//       Self-checked non-vacuous: the forbidden-form matchers fire on a planted form.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMapping, resolvePageId, recordPageId, NOTION_WORK_MAP_FILE } from "../../src/notion/mapping.mjs";
import { AOF_GITIGNORE_ENTRIES } from "../../src/aof-gitignore.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_NOTION_DIR = path.join(repoRoot, "src", "notion");

// Strip line + block comments AND string/template literals so a documented mention
// (a `filter` in prose, or a token name inside an error MESSAGE) does not trip a
// guard — only LIVE CODE counts (the 09/10/13 call-form-not-comment idiom). String
// literals collapse to a space.
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | sq | dq | tpl
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

// Keep STRING literals (so we can read argv-token strings) but drop comments.
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// A resolve-by-query against a Notion identity property: a `filter` object keyed by a
// `property` + a value match (the §A5 external-id resolve form ADR-001 rejected). The
// accepted forms never construct such a filter — the sidecar IS the resolver.
const RESOLVE_BY_QUERY = /\bfilter\s*:\s*\{[^}]*\bproperty\s*:/;

async function notionSourceFiles() {
  const files = [];
  for (const entry of await readdir(SRC_NOTION_DIR)) {
    if (entry.endsWith(".mjs")) files.push(path.join(SRC_NOTION_DIR, entry));
  }
  return files;
}

export const archTests = [
  {
    name: "arch/notion-mapping-sidecar: the sidecar is the SOLE identity store — a MISS resolves null, a recorded HIT resolves the pageId (round-trip over an injected temp root)",
    async run() {
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-arch-notion-map-"));
      const dataSourceId = "ds-fixture";
      try {
        // MISS — a fresh project has no sidecar; readMapping never throws, resolve → null.
        const empty = await readMapping(root, dataSourceId);
        assert.equal(resolvePageId(empty, "17"), null, "an unrecorded ref resolves to null (a MISS → create)");

        // Record a binding, then a fresh read resolves the recorded page id (a HIT → patch).
        await recordPageId(root, dataSourceId, "17", "page-abc", { lastStatus: "Done" });
        const after = await readMapping(root, dataSourceId);
        assert.equal(resolvePageId(after, "17"), "page-abc", "the recorded page id round-trips (HIT → pageId)");

        // Per-board scoping: the same ref under a DIFFERENT data-source resolves null
        // (a binding under ds-A must not resolve under ds-B — two boards never collide).
        const other = await readMapping(root, "ds-other");
        assert.equal(resolvePageId(other, "17"), null, "a binding under one data-source does not resolve under another");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/notion-mapping-sidecar: the sidecar file is git-ignored (in AOF_GITIGNORE_ENTRIES) — the mapping is a derived, never-committed artifact",
    async run() {
      assert.ok(
        AOF_GITIGNORE_ENTRIES.includes(NOTION_WORK_MAP_FILE),
        `the sidecar file "${NOTION_WORK_MAP_FILE}" is in AOF_GITIGNORE_ENTRIES (git-ignored, ADR-001)`
      );
    },
  },
  {
    name: "arch/notion-mapping-sidecar: no src/notion/* code issues a resolve-by-query (a Notion filter against an identity property) — the sidecar is the sole resolver",
    async run() {
      for (const file of await notionSourceFiles()) {
        const code = stripCommentsAndStrings(await readFile(file, "utf8"));
        assert.ok(
          !RESOLVE_BY_QUERY.test(code),
          `${path.relative(repoRoot, file)} constructs no resolve-by-query filter against an identity property (the sidecar resolves identity, not a Notion query)`
        );
      }
      // Self-check (non-vacuous): the matcher FIRES on the forbidden resolve-by-query
      // form and does NOT fire on the accepted argv-array page writes.
      assert.ok(
        RESOLVE_BY_QUERY.test("query({ filter: { property: 'aof-ref', rich_text: { equals: ref } } })"),
        "the resolve-by-query guard fires on a filter-by-identity-property form"
      );
      assert.ok(
        !RESOLVE_BY_QUERY.test("['api', 'pages', 'update', '--page-id', op.pageId]"),
        "the resolve-by-query guard does NOT fire on the accepted page-write argv form"
      );
    },
  },
  {
    name: "arch/notion-mapping-sidecar: the only page-property writes name title/status/relation — no aof-identity property is written onto a Notion page",
    async run() {
      // The page-write argv builders (createPageArgv/patchPageArgv) carry property
      // FLAGS; the only ones that may appear are the title / status / relation property
      // flags. An aof-identity property write would name an `--external-id` / a
      // `--property aof` / a ref-bearing identity flag — none may appear.
      const sync = stripCommentsOnly(await readFile(path.join(SRC_NOTION_DIR, "sync.mjs"), "utf8"));
      // The accepted property flags the apply layer constructs.
      const ALLOWED_FLAGS = new Set([
        "--data-source-id", "--title", "--status-property", "--status-option",
        "--relation-property", "--relation-parent", "--page-id",
      ]);
      const flags = [...sync.matchAll(/["'](--[a-z][a-z0-9-]*)["']/g)].map((m) => m[1]);
      assert.ok(flags.length > 0, "the apply layer constructs page-write flags (the grep is not vacuous)");
      for (const flag of flags) {
        assert.ok(
          ALLOWED_FLAGS.has(flag),
          `${path.relative(repoRoot, path.join(SRC_NOTION_DIR, "sync.mjs"))} writes only title/status/relation page properties (found unexpected flag "${flag}")`
        );
      }
      // None of the allowed flags names an aof-identity / external-id property.
      for (const flag of ALLOWED_FLAGS) {
        assert.ok(
          !/external|aof-?ref|identity/i.test(flag),
          `no allowed page-write flag names an aof-identity property (checked "${flag}")`
        );
      }
    },
  },
];
