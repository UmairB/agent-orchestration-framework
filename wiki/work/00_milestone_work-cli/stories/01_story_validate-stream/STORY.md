---
type: story
number: 01
slug: validate-stream
title: "Validate the work stream for CI"
parent: 00
status: done
owner: product-owner
created: 2026-06-17
updated: 2026-06-17
schema: 1
aofVersion: 0.1.0
---
# 01 · Validate the work stream for CI

## User story

As a maintainer gating the work stream in CI,
I want `aof work validate [ref]` to assert the stream's integrity — folder name ↔ frontmatter agree, every feature tag is in the closed vocabulary with exactly one verification lane per scenario, and the `depends` graph resolves and is acyclic — and exit non-zero on any breach,
so that a malformed or drifted stream fails the build instead of silently misleading the ACD commands that read it.

## Tasks

- [x] `tasks/00_folder-frontmatter.feature` — folder↔frontmatter agreement + CI exit codes (clean → 0, finding → non-zero)
- [x] `tasks/01_tag-vocabulary.feature` — closed tag vocabulary + exactly-one-verification-lane per scenario
- [x] `tasks/02_depends-graph.feature` — depends edges resolve to a driver + the graph is acyclic

## Notes

Consumes story 00's discovery engine; independent of `order-work` (00/02). The closed-tag-vocabulary
and acyclic-depends rules are machinery enforced here, not documentation — the structural framing is
in the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md).
