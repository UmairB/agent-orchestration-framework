---
type: story
number: 00
slug: routing-reader-and-associate
parent: 18
status: done
owner: product-owner
created: 2026-06-26
updated: 2026-06-27
---
# 00 · Routing reader + `boards` registry + `associate` rewrite — the authoring spine

## User story

As an operator who routes each work item to its own external tool(s), I want a co-located, committed
`.integrations.json` descriptor at the item's folder — written and cleared by `aof work integrations notion
associate <ref> --board <key> --parent <id|key|none>`, validated **purely against committed config** (a
central `boards` registry, an unknown board/parent an honest command error), and read back by a small
`JSON.parse`-based reader that resolves the **record-doc folder** (so an imported AOF.md-class milestone is
first-class) and **tolerates an unknown provider key** — so the association is self-describing, diffable, and
lives *with* the item, while the page-id binding stays derived in the git-ignored sidecar and no Notion call
is ever made.

<!-- The AUTHORING SPINE of milestone 18 (ARCHITECTURE.md ADR-002/003/004): the new
     `src/integrations/routing.mjs` reader + resolver is the seam BOTH the authoring side (this story's
     `associate`) and the consumption side (story 01's projection) depend on — so it lands first. Three code
     pieces: (1) the reader/resolver module, (2) the `boards` registry schema (oneOf with the flat m17
     back-compat arm) at the Ajv-2020 compile seam, (3) the `associate` verb rewrite whose ONLY mutation is
     the `.integrations.json` write. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 18 --autonomous`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. The STRUCTURAL invariants — the
     boards-registry schema accepted at the Ajv seam (FF-F), the reader's provider-extensibility (FF-E), and
     the associate-side no-Notion-read / descriptor-committed guarantees (FF-A/FF-D halves) — are the
     milestone's ARCH-TESTS (ARCHITECTURE.md §Fitness functions), AUTHORED in story 02, NOT task scenarios
     here. These features carry only the OBSERVABLE behaviour. -->

- [x] **00 · [routing-reader](tasks/00_routing-reader.feature)** — `src/integrations/routing.mjs`:
  `readRouting(item)` reads the folder's `.integrations.json` via `JSON.parse` (absent ⇒ `{}`, never
  throws — mirrors `readMapping`); the file is resolved in the **record-doc folder** (AOF.md-first, else
  SPEC.md — `recordDoc` semantics); the shape is provider-namespaced `{ "notion": { board?, parent? } }`;
  an **unknown provider key** (a `jira`/`linear` block) is **ignored, never a hard failure**; `parent`
  disambiguates by shape — a 32-hex UUID (dashed or compact) is a raw page-id used **verbatim**, anything
  else is a **key**.
- [x] **01 · [boards-registry-and-default](tasks/01_boards-registry-and-default.feature)** — the central
  `work.integrations.notion.boards` registry + the `resolveNotionRouting` resolver: a descriptor naming
  `board: X` resolves to **X's** connection; an **absent** `board` ⇒ the configured **`default`** board; a
  **flat m17 block** (no `boards` key) is treated as the **implicit default** board (back-compat); an
  **unknown** `default` or board key is an honest config error; a key in `parent` resolves against the
  **chosen board's** `parents` map, a page-id is used verbatim.
- [x] **02 · [associate-writes-descriptor](tasks/02_associate-writes-descriptor.feature)** — the verb `aof
  work integrations notion associate <ref> --board <key> --parent <id|key|none>`: writes/clears the item's
  `.integrations.json` (the **ONLY** mutation — never the sidecar, never Notion); validates `--board` /
  `--parent` against committed config (an unknown board ⇒ `unknown-board-key`, an unknown parent key ⇒
  `unknown-parent-key`, **naming the available keys**, writing **nothing**); `--parent none` clears the
  parent; idempotent (`unchanged` makes no write); the `--json` envelope is `{ ref, board, parent, action:
  "set"|"unset"|"unchanged" }`; a non-milestone ref is the honest `not-a-milestone` error.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md): **ADR-001** (parent = raw page-id *or* a key
into the **per-board** `parents`, disambiguated by UUID shape) · **ADR-002** (the `boards` registry — a
`oneOf` with the flat m17 back-compat arm, `default` is a string key naming a board, validated at the
Ajv-2020 compile seam not `validateConfig`) · **ADR-003** (the `.integrations.json` dotfile + the new
`src/integrations/routing.mjs` reader — named `routing` to avoid the m12 `NOTION_DESCRIPTOR` collision,
`JSON.parse`, recordDoc-folder resolution, unknown-provider-tolerant) · **ADR-004** (the associate write is
the only mutation) · **ADR-006** (authored-vs-derived + one-way reaffirmed — no Notion read on the associate
path).

This story **owns** the new reader/resolver module, the schema `boards` block, and the `associate` rewrite.
The reader is the **new shared seam** story 01's projection consumes.

**Independent because** it delivers a self-contained authoring + read seam with no dependency on the
consumption side: the resolver is exercised over fixtures, the schema over the Ajv compile seam, and
`associate` over the command registry — none needs the projection or the sidecar. **Build-order: this is
first** (00 → 01 → 02); story 01 imports this reader/resolver, story 02's `parseFrontmatter` revert is safe
only once this descriptor is the routing source.

**Feasibility (developer amigo seat — confirmed at Contract): BUILDABLE as specified, no contract change.**
The seams are all present: `recordDoc` (`src/work.mjs:97`), the command-core registry (`src/command-core.mjs:94`),
the existing `notion-associate.mjs` to rewrite, the closed `work.integrations.notion` block to promote
(`schemas/aof.schema.json:450-478`); the new `src/integrations/` dir is greenfield. Two **build notes** (not
contract changes): (1) **CLI wiring** — `parseOptions` (`cli.mjs:1943-1965`) is generic, so `--board ops` flows
through to `options.board` with no parser change; the build adds `board: options.board` to the verb's
`cli.argv` and updates the usage/help strings (`cli.mjs:507,566`). (2) **Interim test churn** — the rewrite of
`notion-associate.mjs` breaks the existing frontmatter-based `test/notion-associate*.test.mjs`; those are
deleted in story 02, so the builder updates-or-quarantines them here and flags the red rather than leaving it
silently. The Ajv `oneOf` (flat m17 arm | `{default, boards}` arm) was probed live: both arms validate, a
both-arms config is rejected by `oneOf` exactly-one (the desired mutual exclusion), and the `default`-names-a-real-board
cross-check belongs in the resolver (runtime), not the schema. The reader/resolver need only `node:fs` + `path`
(+ optionally `recordDoc`) — **no `parseFrontmatter` import** (FF-B). `validateConfig` is hand-rolled and never
compiles the schema, so the shape invariant is enforced ONLY at the Ajv seam (ADR-002), as intended.
