---
type: milestone
number: 04
slug: round-trip-proof
title: "Round-trip Proof"
status: done
owner: product-owner
created: 2026-06-16
updated: 2026-06-20
depends: [01]
schema: 1
aofVersion: 0.1.0
---
# 04 · Round-trip Proof

## Objective

Prove the whole loop end-to-end: `aof work init` into a fresh repo, then run a milestone through
refine → continue → verify with the bundled ACD assets — the round-trip the ROADMAP calls for.

## Scope

In scope:
- A clean-repo `aof work init` + one worked milestone built and accepted with the bundled actors.
- Confirms the methodology and tooling compose; surfaces gaps back into 00 / 01.

Out of scope: shipping a real product feature — this validates aof's own machinery, not an app.

## Stories

Broken down into three stories that couple **only** through the locked shared contract — the
round-trip **harness** API ([ARCHITECTURE.md](ARCHITECTURE.md) ADR-005), mirroring milestone 01's
install-manifest technique. The harness (Story 00) creates an isolated repo, runs the real
`aof work init`, and seeds the sample milestone; the two proof stories then build in parallel against
that frozen API on **different verification surfaces** (`@executable` CI vs a single `@manual`/`@uat`
sign-off — ADR-003). See ARCHITECTURE.md for the ADRs and fitness functions.

- [x] `00_story_roundtrip-harness` — the frozen harness (isolated repo + real install + seeded sample milestone): the single coupling point the two proof stories share
- [x] `01_story_install-proof` — `@executable`: `aof work init` into the fresh repo renders the bundle, writes the `work` lock section to schema, and the work verbs resolve over it
- [x] `02_story_loop-proof` — drive the sample milestone refine → continue → verify with the bundled actors to `done`: `@executable` spine (`validate`/`next`) + one `@manual`/`@uat` round-trip sign-off

## Dependencies

- **01 · ACD Asset Bundle + work init/update** — needs the installer to render assets into the test repo.
