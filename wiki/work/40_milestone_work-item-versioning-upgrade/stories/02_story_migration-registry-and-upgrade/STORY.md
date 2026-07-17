---
type: story
number: 02
slug: migration-registry-and-upgrade
title: "The migration registry & aof upgrade — version→version transforms declared as code, a dry-run-first idempotent engine, and a reconstructed-marker so the framework is ready for the backfill without performing it"
parent: 40
status: not-started
owner: product-owner
created: 2026-07-17
updated: 2026-07-17
depends: [40/01]
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs (ARCHITECTURE.md).
-->
# 02 · The migration registry & `aof upgrade` — the engine

## User story

As the **maintainer of a stream that predates the current aof**,
I want a **registry of version→version transforms declared as code** and an **`aof upgrade` command that
reports what would change, then applies it idempotently**,
so that catching a stale stream up is a **command I run**, not advice I have to find and follow by hand —
and the set of migrations between "what this stream is" and "what aof is now" is *computed* from the
registry, never researched.

<!-- This is the engine (ADR-005). A NEW module `src/work-upgrade.mjs` holds the registry
     (WORK_ITEM_MIGRATIONS) and the engine; it IMPORTS work.mjs's readers + story 01's writer, and
     work.mjs NEVER imports it back (acd-upgrade-engine-blast-radius). It carries the 0→1 stamp transform
     (which backstamps the existing stream) AND the reconstructed-marker capability that makes the whole
     framework READY for m39's backfill without performing it. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` ADR-003 / ADR-005 / ADR-008:

1. **A new module `src/work-upgrade.mjs`** exports `WORK_ITEM_MIGRATIONS` — an ordered list of transform
   descriptors (indicatively `{ from, to, id, summary, apply, reconstructs? }`) — and the engine
   (`planUpgrade` / `runUpgrade`). It **imports `work.mjs`'s readers + the ADR-004 writer**; `work.mjs`
   **never imports it back** (ADR-005; guarded by `acd-upgrade-engine-blast-radius`).
2. **The registry is a contiguous chain and the single source of truth (ADR-005):** transforms form
   `0 → 1 → …`; the **highest transform `to` value EQUALS `WORK_ITEM_SCHEMA_VERSION`** (fitness
   `acd-work-item-schema-single-constant`) — constant declares the target, registry provides the path,
   the two cannot drift. The engine selects the sub-chain `item.schema → current`.
3. **The `0 → 1` stamp transform (ADR-003):** writes `schema: 1` + `aofVersion` onto an unstamped
   (schema-0) item via story 01's writer. It is the registry's first transform, it backstamps any
   unstamped item, and it sets **no** reconstructed marker (it records a true version, infers nothing).
4. **`aof upgrade` — dry-run first (ADR-005):** the CLI face (a top-level verb over an indicative
   `work:upgrade` command, mirroring `aof migrate` / `aof project migrate`, `cli.mjs:2362-2395`) reports
   **what would change without mutating anything**, and applies only on confirm/apply, writing through
   story 01's atomic writer.
5. **Idempotent by construction (ADR-005; fitness `acd-upgrade-idempotent`):** an item already at
   `WORK_ITEM_SCHEMA_VERSION` selects an empty chain and is left **byte-untouched**; a second run is a
   no-op — mirroring `openGlobalWorkProjectionStore` re-opening a current store without re-migrating.
6. **A store schema newer than the build is a refusal, not a downgrade** — the `global-work-store.mjs:30-37`
   precedent applied to the document stream.
7. **The existing aof stream is backstamped** — running `aof upgrade` over the aof repo's own 00–39
   items stamps them `schema: 1` + `aofVersion` and leaves `aof work validate` **green** (`@manual`, the
   real delivery; the mechanism is proven `@executable` on a fixture).
8. **The registry can express a reconstructed-marker (ADR-008; fitness
   `acd-reconstructed-marker-expressible`):** a transform descriptor can declare it produces
   *reconstructed* content (`reconstructs: true`), and a doc so produced is written with a
   `reconstructed: true` frontmatter marker — the analogue of the import leg's `imported: true`. **No
   backfill is performed here** — this proves the framework is *ready* to carry m39's backfill (its
   readiness criterion). `aof upgrade` transforms SHAPE only; it never infers content, revises authored
   prose, or rewrites history.

## Tasks

<!-- Authored at `aof:refine 40 --autonomous` (Three Amigos). -->

- [ ] `tasks/00_registry-contiguous-chain.feature`
- [ ] `tasks/01_upgrade-dry-run-then-apply.feature`
- [ ] `tasks/02_upgrade-idempotent.feature`
- [ ] `tasks/03_stamp-transform-backstamps-unstamped.feature`
- [ ] `tasks/04_reconstructed-marker-expressible.feature`

## Notes

- **Dependency:** `depends: [40/01]` — needs the constant, the reader (schema-0 baseline) and the
  transform-scoped writer. Independent of stories 03/04's surfaces; can run in parallel with 03 once 01
  lands.
- **The `@manual` backstamp scenario** (criterion 7) mutates the live aof stream — the developer runs
  `aof upgrade` on the real repo and records the validate-green result in `VERIFICATION.md`. The
  `@executable` scenarios prove the mechanism deterministically on a fixture stream first.
- **Reconstruction is the readiness gate, not a deliverable here (ADR-008):** the marker must be
  *expressible*; running any reconstruction (m39's `OUTCOME.md` backfill) is out of scope for this
  milestone and lands later as a `reconstructs: true` registered transform depending on both 39 and 40.
- **Fitness functions** (guard-if-present, arm when `work-upgrade.mjs` lands):
  `acd-upgrade-idempotent`, `acd-upgrade-engine-blast-radius`, `acd-reconstructed-marker-expressible`,
  `acd-work-item-schema-single-constant` (the registry-max === constant half).
