---
type: milestone
number: 18
slug: integration-descriptor
title: "Per-folder integration descriptor — a co-located .integrations.json routes each work item to its external tool(s) (Notion first); connection config stays central"
status: done
owner: product-owner
created: 2026-06-26
updated: 2026-06-27
depends: [17]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 18 · Per-folder integration descriptor — co-located `.integrations.json`

> **Supersedes the original milestone-18 design** (Notion Parent-Grouping via a `notion: { parent: <key> }`
> milestone-frontmatter key + a central `work.integrations.notion.parents` key→pageId map). That design was
> built and accepted earlier on this branch, then judged redundant against real usage (see Objective). Its
> code (`src/commands/notion-associate.mjs`, the `projectMilestone` parent resolution, the
> `parseFrontmatter` inline-map extension, the `parents` schema block) is **rewritten**, not extended, by
> the stories below. The prior planning docs are preserved out-of-tree; the prior retrospective's
> parseFrontmatter blast-radius lesson is a load-bearing input here (it motivates the JSON-file approach).

## Objective

Milestone 17 pushes each milestone to **one** Notion board (addressed by a single committed `dataSourceId`)
as a top-level row, stories as sub-tasks. The original milestone 18 let a milestone nest under a **phase**
page by declaring a `notion.parent` key in its `SPEC.md` frontmatter, resolved through a **central**
`work.integrations.notion.parents` map. That model is weakest at the case that actually occurs: in a real
GSD-managed repo (the `voice-vox-web` test-bed) milestones are routed to **many different Notion tasks**,
potentially across **different boards**. A single central key→pageId map then becomes a sprawling lookup
table divorced from the items it describes, and m17/m18 cannot express "this item belongs to a *different
board* than that one" at all — there is only one `dataSourceId`.

This milestone replaces the frontmatter-key + central-map mechanism with a **co-located, per-folder
`.integrations.json`** descriptor. Each work item's folder declares its **own** external-tool routing —
which board, which parent — so the association is self-describing, committed, and lives *with* the item
exactly as its `SPEC.md`/`STATE.md` do (aof's self-contained-folder principle). **Connection/credential
config stays central** but is promoted from a single flat block to a **`boards` registry** so multiple
boards are addressable by key. The page-id **binding** (which Notion page each item owns) stays **derived**
in the git-ignored sidecar (17/ADR-001) — the authored/derived split is the one principle carried over
intact. The descriptor is a **plain JSON file** read by `JSON.parse`, deliberately *not* milestone
frontmatter: the original m18 had to extend the shared `parseFrontmatter` to read an inline map and its own
retrospective flagged that as a blast-radius hazard — a dedicated file never touches that parser. The file is
**provider-namespaced** (`{ "notion": { … } }`) so a future `jira`/`linear`/`github` block is an additive
key, not a schema migration.

An outsider can verify the objective is met when: a milestone whose folder carries an `.integrations.json`
naming a board + parent, once synced, appears **under that parent on that board** (its stories one level
deeper); two milestones routed to **different** parents (or different boards) each land in the right place
after one `sync-work`; and a milestone with **no** descriptor syncs **top-level on the default board exactly
as under milestone 17** — a backward-compatible, opt-in addition. The `associate` verb writes/clears the
descriptor (the assignment is visible in the committed work stream, not a derived artifact), and resolves
keys **purely against committed config** — no Notion read (17's one-way invariant unchanged).

## Scope

In scope:
- **The `.integrations.json` per-folder descriptor + reader** — a committed JSON file at a work item's
  folder root, provider-namespaced: `{ "notion": { "board"?: <board-key>, "parent"?: <page-id|key> } }`.
  Read by a small `JSON.parse`-based reader (NOT `parseFrontmatter`, NOT frontmatter). Absent ⇒ default
  board, top-level (m17 behaviour), unchanged. The reader resolves the record-doc folder via `recordDoc`
  semantics so imported/converted milestones (AOF.md class) are first-class (carries the original m18
  BLOCKER fix forward).
- **The central `work.integrations.notion.boards` registry** — a closed `{ "<board-key>": { dataSourceId,
  tokenEnv, statusProperty, statusMap, relationProperty } }` map (the m17 connection fields, now per board),
  with a designated **default** board. Validated at the Ajv-2020 schema-compile seam (the m17-retro-mandated
  idiom). Supersedes the flat single-board `work.integrations.notion` block; back-compat is an open question.
- **The `associate` verb rewrite** — `aof work integrations notion associate <ref> --board <key> --parent
  <page-id|key|none>` writes/clears the item's `.integrations.json` (the **only** mutation; never the
  sidecar, never Notion). Validates `--board`/`--parent` against committed config; an unknown board key is an
  honest command error. `--parent none` clears the parent; clearing the whole notion block is in scope.
- **The projection extension** — `projectItem`/`projectMilestone` read routing from `.integrations.json`
  (board → connection, parent → relation parent page id) and address the chosen board, nesting the item
  under its parent via that board's `relationProperty`. No descriptor / no parent ⇒ default board, top-level
  — byte-for-byte the m17 plan (the no-regression invariant).
- **Removal of the superseded mechanism** — delete the `notion.parent` frontmatter convention, the
  `parseFrontmatter` inline-flow-map extension (revert `work.mjs` to its pre-m18 minimal reader), and the
  central `parents` schema block. Their fitness tests are replaced by the ones below.
- **Fitness** — descriptor-is-committed-not-derived (read from `.integrations.json` + config, never the
  sidecar; sidecar gains no routing field); the reader uses `JSON.parse` and has **no** `parseFrontmatter`
  dependency (the parser is back to its pre-m18 shape); board resolution + default-board fallback; no Notion
  read on the associate/projection path (17 one-way reaffirmed); the descriptor schema is provider-namespaced
  and extensible (an unknown provider key is tolerated/ignored, not a hard failure).

Out of scope:
- **Creating the parent page or the board in Notion** — both pre-exist; aof binds by id, never creates
  (17/ADR-003).
- **Implementing non-Notion providers** — only the `{ <provider>: … }` namespace is reserved; no `jira`/
  `linear`/`github` adapter is built.
- **Two-way / reading routing or status back from Notion** — one-way preserved (17 invariant).
- **Arbitrary N-level regrouping** — stories still nest under their milestone; this adds only the
  item→parent level, on the item's chosen board.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 18.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down by `aof:refine 18 --autonomous` into **three independent stories**, grounded in the codebase
graph (the new `src/integrations/routing.mjs` reader is the convergence seam → spine first; `mapping.mjs` is
the 3-importer hub where multi-board coexistence belongs; `work.mjs` is the 14-importer god-node → its parser
revert is gated last). See [ARCHITECTURE.md](ARCHITECTURE.md) (ADR-001..007 + §Fitness functions, superseding
prior 18/ADR-001..005). **Build-order 00 → 01 → 02 is load-bearing.**

- [x] **00 · [routing-reader-and-associate](stories/00_story_routing-reader-and-associate/STORY.md)** — the
  authoring spine: the `src/integrations/routing.mjs` reader/resolver, the central `boards` registry schema
  (a `oneOf` with the flat m17 back-compat arm) at the Ajv-2020 seam, and the `associate` rewrite
  (`--board`/`--parent <id|key|none>` writes/clears `.integrations.json`, the only mutation).
- [x] **01 · [projection-and-multiboard-sidecar](stories/01_story_projection-and-multiboard-sidecar/STORY.md)**
  — the consumption side: the projection reads routing → addresses the chosen board + nests under the parent
  via its `relationProperty` (absent descriptor ⇒ default board, top-level, byte-for-byte m17), and the
  sidecar is re-keyed to coexist across multiple boards (v2 per-data-source buckets + v1 migration).
- [x] **02 · [supersede-frontmatter-and-fitness](stories/02_story_supersede-frontmatter-and-fitness/STORY.md)**
  — the cleanup + fitness: revert `parseFrontmatter` to its pre-m18 minimal shape, remove the `notion.parent`
  convention + the central `parents` schema block, delete the five superseded arch-tests + behavioural tests,
  and author the six new fitness invariants (FF-A..F).

## Open questions (for refine)

- **Parent addressing — raw page-id vs named key vs both?** Should `.integrations.json` `parent` hold a raw
  Notion page id (fully self-contained, but the id repeats across folders that share a parent) or a key into
  a small central `parents` registry (dedupes shared parents, but reintroduces a central indirection), or
  allow either (id when one-off, key when shared)? Lean: allow a raw id, optionally a key — locality is the
  whole point, and shared-parent dedupe is the minority case.
- **Migration of the flat `work.integrations.notion` block → `boards` registry.** Keep back-compat (treat
  an existing flat block as the implicit `default` board) or hard-cut to `boards` only? Lean: back-compat —
  m17 just shipped and its config shouldn't break.
- **Descriptor file location/name.** `.integrations.json` at the folder root (proposed) vs a key inside an
  existing doc. Lean: a discrete dotfile — machine-managed by `associate`, separate from human-authored docs.
- **Does `.integrations.json` count toward the m16 context budget / m15 doctor surfaces?** Likely no (it's a
  tiny machine file), but name it explicitly so doctor/validate don't flag it.

## Dependencies

- **17 · notion-work-sync** — this rewrites 17's projection consumption, promotes its single-board
  `work.integrations.notion` block to a `boards` registry, and reuses its `integrations notion` command
  namespace + one-way egress. (Live-Notion lanes remain deferred — finding NTN-V1 — until a token exists.)
- **08 · cli-command-core** — `associate` stays a registered command-core command with a `--json` envelope.
- **13 · external-milestone-import** — imported milestones (AOF.md record-doc class) must be able to carry an
  `.integrations.json` too; the reader resolves the record-doc folder, not a hardcoded `SPEC.md`.
