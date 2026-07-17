---
type: story
number: 04
slug: generated-changelog
title: "The generated changelog — a projection of the migration registry that cannot drift, so 'how do I upgrade' resolves to a command and never to prose"
parent: 40
status: in-review
owner: product-owner
created: 2026-07-17
updated: 2026-07-17
depends: [40/02]
schema: 1
aofVersion: 0.1.0
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

- [x] `tasks/00_changelog-generated-from-registry-no-drift.feature` — 6 `@executable` scenarios green (+ a CLI round-trip regression test); the `@manual` regenerate-and-diff runs at `aof:verify`

## Delivery notes

- **Generator + artifact:** `renderChangelog(migrations = WORK_ITEM_MIGRATIONS)` + `changelogDrift()` in
  `src/work-upgrade.mjs`; the committed artifact is `UPGRADE-CHANGELOG.md` at the repo root (a
  package-level "how do I upgrade" artifact — future milestones' transforms land in the same registry
  and the same changelog). `aof upgrade --changelog` is the regenerate surface. `.gitattributes` pins the
  artifact to LF so the byte-identity drift guard survives a Windows checkout.
- **Deterministic by construction:** the generator body is static strings + each descriptor's
  `id`/`from`/`to`/`summary` — no timestamp, no package version, no volatile value — so
  `renderChangelog(WORK_ITEM_MIGRATIONS)` reproduces the committed 983-byte artifact byte-for-byte.
- **Review:** behavioural PASS (drift guard is a genuine full-string byte compare, real 3-transform
  fixtures, deterministic, litmus-honest). Structural verified inline (the `--changelog` is a flag on the
  existing `work:upgrade` command — bijection guards green; no forbidden import; `.gitattributes` + the
  arch-test one-line fix both legitimate). **Finding QA-40-04-1 fixed:** `aof upgrade --changelog`
  emitted a doubled trailing newline (`console.log` adds its own) that broke the `> UPGRADE-CHANGELOG.md`
  round-trip — the render now strips the generator's trailing newline; a regression test asserts CLI
  stdout === committed.

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
