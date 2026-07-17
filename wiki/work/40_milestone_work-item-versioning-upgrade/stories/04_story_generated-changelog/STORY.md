---
type: story
number: 04
slug: generated-changelog
title: "The generated changelog — a projection of the migration registry that cannot drift, so 'how do I upgrade' resolves to a command and never to prose"
parent: 40
status: not-started
owner: product-owner
created: 2026-07-17
updated: 2026-07-17
depends: [40/02]
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs (ARCHITECTURE.md).
-->
# 04 · The generated changelog — the projection that cannot drift

## User story

As the **maintainer deciding whether to upgrade**,
I want a changelog that is **generated from the migration registry** — enumerating each transform's
step and summary — rather than hand-authored prose,
so that the changelog **cannot describe a transform the registry does not contain, nor omit one it
does**, and "how do I upgrade" always resolves to `aof upgrade` — never to advice that binds nobody and
rots the moment the next transform lands (the passive-note failure this whole stream is abolishing).

<!-- This is the derivation (ADR-006), the SPEC's one load-bearing property made concrete. A generator
     projects WORK_ITEM_MIGRATIONS → the changelog; the generated artifact carries the `aof-generated`
     stamp (01/ADR-005 form) and a drift guard (regenerate == committed). Depends on story 02's registry. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` ADR-006:

1. **The changelog is a pure projection of `WORK_ITEM_MIGRATIONS` (ADR-006):** a generator function over
   the registry produces it from each descriptor's `id`/`from`/`to`/`summary` — it is **not** authored by
   hand. The generator reads the registry, **never the reverse**.
2. **It cannot drift (ADR-006; fitness `acd-changelog-generated`):** regenerating from the registry
   reproduces the committed artifact **byte-for-byte** — a hand edit fails the drift guard. The
   committed artifact carries the `aof-generated` stamp (01/ADR-005 form) so it is self-identifying.
3. **"How do I upgrade" resolves to `aof upgrade`, not prose (ADR-006):** the changelog *describes* the
   transforms (the steps); the *act* is the command. It contains no load-bearing advice.
4. **The generated changelog is committed to the repo** and matches regeneration from the current
   registry (`@manual` — the developer regenerates and confirms byte-identity; the generator/drift-guard
   mechanism is proven `@executable`).

## Tasks

<!-- Authored at `aof:refine 40 --autonomous` (Three Amigos). -->

- [ ] `tasks/00_changelog-generated-from-registry-no-drift.feature`

## Notes

- **Dependency:** `depends: [40/02]` — the changelog is a projection of story 02's `WORK_ITEM_MIGRATIONS`,
  so it lands after the registry exists. Independent of story 03.
- **Fitness function** `acd-changelog-generated` (guard-if-present) arms when the generator + committed
  artifact land: it asserts regenerate == committed and that the generator reads the registry, not the
  reverse.
- **This is the milestone's load-bearing property (SPEC):** a migration is code that runs; the changelog
  is generated from it. Getting this wrong (a hand-authored changelog) would repeat the exact
  passive-note failure the stream is abolishing — so the drift guard is not optional polish, it is the
  point.
