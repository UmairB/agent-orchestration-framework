---
type: milestone
number: 04
slug: round-trip-proof
title: "Round-trip Proof"
status: not-started
owner: product-owner
created: 2026-06-16
updated: 2026-06-16
depends: [01]
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

<!-- to be broken down — `aof:refine 04` -->

## Dependencies

- **01 · ACD Asset Bundle + work init/update** — needs the installer to render assets into the test repo.
