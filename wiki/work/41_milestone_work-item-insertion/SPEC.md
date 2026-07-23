---
type: milestone
number: 41
slug: work-item-insertion
title: "Work-item insertion & re-index"
status: done
owner: product-owner
created: 2026-07-16
updated: 2026-07-19
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 41 · Work-item insertion & re-index

## Objective

The work stream numbers items by append order — the next `NN` is always `max + 1`, so every new
milestone, story, or UAT lands at the tail. Concurrent work streams break that assumption: work
discovered mid-flight belongs *beside* related items in the roadmap, not appended after everything
that came later. Today the only way to slot an item into position is to renumber folders by hand and
chase every reference that points at them — error-prone and validate-breaking.

This milestone adds `insert-milestone`, `insert-story`, and `insert-uat`: each frames a new item at a
**target position** and then re-indexes every subsequent item up by one, keeping the work stream
valid throughout. The outcome is verifiable by an outsider: after inserting at position `P`, the new
item occupies `P`; every pre-existing item that was `≥ P` has shifted up by exactly one; all
machine-readable references (`depends`, `parent`, milestone→story checklists, ROADMAP rows) still
point at the right items; and `aof work validate` is green with no manual repair.

## Scope

In scope:
- **Three insert commands** — `insert-milestone`, `insert-story`, `insert-uat` — that scaffold a
  framed item at a caller-given target position, reusing the framing logic of their `add-*`
  counterparts; they differ only in *placement*, not in what they scaffold.
- **The corresponding Claude command surface** *(re-open 2026-07-18)* — a bundled `/aof:insert-*`
  command doc for each insert command (`src/bundle/commands/insert-milestone.md`, `insert-story.md`,
  `insert-uat.md`), mirroring its `add-*` twin, so the feature is discoverable and usable through the
  ACD command surface after `aof work init` / `aof work update` — not only via the raw CLI. Adding a
  `work:*` command *implies* its Claude command; the CLI+engine is not the whole deliverable (see
  RETROSPECTIVE R5).
- **Integrity-preserving re-index** of every item at/after the insertion point: rename the
  `NN_type_slug` folders, bump frontmatter `number`, and rewrite all **machine** references —
  `depends` edges, `parent`, milestone→story checklist bullets, and ROADMAP.md rows — so nothing
  dangles.
- **Count-gated confirmation** — when only a handful of items must shift, proceed automatically; when
  many must shift, warn the user that the re-order is costly and confirm intent before proceeding.
- **Validate-green invariant** — the command leaves `aof work validate` passing (folder↔frontmatter,
  closed tag vocabulary, depends graph) as its acceptance bar.

Out of scope:
- **Prose cross-reference rewriting** — human mentions like "see milestone 34" or "#34" inside doc
  bodies are *not* rewritten; machine references are the correctness surface. Deferred; may be a
  follow-up best-effort sweep.
- **`insert-chore` / `insert-spike`** — not requested. The re-index machinery is shared and can
  extend to these item types later without redesign.
- **Moving / re-ordering an existing item** — this milestone only *inserts new* items; renumber-in-
  place of already-present work is a separate capability.
- **Concurrent-insert safety** — single-actor assumption; locking two simultaneous inserts is not in
  scope.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 41.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down by `aof:refine 41` (2026-07-16); partition rationale in `ARCHITECTURE.md` ADR-005 —
the two number spaces plus their shared engine. Stories 02 ∥ 03 are independent siblings on story 01.

- [x] `41/01` — `01_story_reindex-engine` — the deterministic renumber + `depends`/`parent` rewrite
  core + shift-count primitive (`src/work-reindex.mjs`); the shared foundation, no command surface.
- [x] `41/02` — `02_story_insert-top-level` — `insert-milestone` + `insert-uat` (top-level driver
  placement, one axis) with the count-gated confirmation guard. Depends on `41/01`.
- [x] `41/03` — `03_story_insert-story` — `insert-story` nested-story placement (the `SS` axis),
  best-effort `## Stories` update. Depends on `41/01`; independent of `41/02`.

## Dependencies

- **`add-milestone` / `add-story` / `add-uat`** — insert reuses their scaffolding/framing logic; the
  insert commands are placement wrappers over the same authoring path.
- **`aof work validate`** (folder↔frontmatter, depends graph) — the green bar the re-index must
  preserve; it defines "did the re-index stay honest".
- **ROADMAP.md** — the roadmap index whose numbered rows must stay consistent after a shift.

## Acceptance criteria — Claude command surface (re-open 2026-07-18)

Verifiable by an outsider, in addition to the original validate-green bar:
- **One bundle command doc per insert command** — `src/bundle/commands/insert-milestone.md`,
  `insert-story.md`, and `insert-uat.md` exist, each mirroring the structure of its `add-*` twin and
  describing *placement at a target position* (`--at`, and `--under` for the story axis) rather than
  append.
- **Rendered by init/update** — after `aof work init` (or `aof work update` against a prior install)
  in a consumer repo, each `/aof:insert-*` command is present in the rendered command surface for the
  installed runtime(s); a repo already on an older bundle picks them up via `work update` with no
  manual step.
- **Parity is guarded** — a fitness function asserts that every `work:insert-*` CLI command registered
  in `src/cli.mjs` has a matching `src/bundle/commands/insert-*.md`, so a future insert command cannot
  ship CLI-only and silently skip its Claude command again.

## Accept decision

**RE-ACCEPTED — 2026-07-19.** The Claude command surface gap is closed. Delivered: four
`src/bundle/commands/insert-*.md` wrappers (`insert-milestone`, `insert-story`, `insert-uat`, and
`insert-chore` — the 4th insert command carried the identical defect, so the fix covers the whole insert
family), declared in `src/bundle/bundle.json` and regenerated into `manifest.json`; each renders BOTH a
`/aof:insert-*` Claude command and a codex `aof-insert-*` skill. Guarded by a new registry-derived fitness
function `acd-work-insert-command-bundle-parity` (every `work:insert-*` CLI command must have a matching
bundle wrapper — no carve-out). Verified against the acceptance criteria above: 126 green across every
guard the change touches (bundle membership/manifest-hashes/namespace/parity + render-path), AND proven
end-to-end in a throwaway consumer repo — `aof work init` renders all four, and `aof work update` on an
install that lacked them reports exactly `4 created`. See VERIFICATION "Claude command surface (re-open)".

**RE-OPENED — 2026-07-18.** The 2026-07-16 acceptance verified the CLI + engine but the milestone shipped
**no Claude command surface** for the insert commands (`src/bundle/commands/` carried only the `add-*`
docs), so the feature was undiscoverable/unusable via `aof work update` in a consumer repo — the CLI+engine
was mistaken for the whole deliverable (root lesson: RETROSPECTIVE R5).

**ACCEPTED (CLI/engine only) — `aof:verify 41` (2026-07-16).** All three stories `done`. The single lane in scope
(`@executable`) is green — `node scripts/test.mjs` → exit 0, 2576 ok / 0 not-ok, both m41 fitness
functions armed+green — and `aof work validate 41` → PASS. No `@manual`/`@uat` lane exists (foundational
CLI/engine milestone, no UI). Two deferred non-blocker findings (F-4101 pad-width non-uniformity across
a 2→3 digit boundary; F-4102 inline-only `depends` rewrite) — no blocker open. Full record in
`VERIFICATION.md`; lessons distilled to `RETROSPECTIVE.md` and folded into memory.
