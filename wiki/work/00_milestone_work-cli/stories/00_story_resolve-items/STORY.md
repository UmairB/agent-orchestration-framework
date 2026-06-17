---
type: story
number: 00
slug: resolve-items
title: "Resolve items from the folder index"
parent: 00
status: done
owner: product-owner
created: 2026-06-17
updated: 2026-06-17
---
# 00 · Resolve items from the folder index

## User story

As an ACD command (and the developer running `aof work` by hand),
I want to enumerate and resolve any work item — a milestone, a nested story, or a uat session — straight from its `NN_type_slug` folder name,
so that commands resolve work by index instead of hand-globbing `**/*.md`, and an item's identity is known without opening a file.

## Tasks

- [x] `tasks/00_resolve-by-ref.feature` — resolve a structured ref (`NN`, `NN/SS`, bare-number uat) to exactly that item + its record
- [x] `tasks/01_resolve-by-query.feature` — match items by free-text slug / folder-name query

## Notes

This is the foundation the other two stories build on: it owns the discovery engine
(`listItems`, the `NN_type_slug` parse, `parseFrontmatter`/`readMeta`) that `validate-stream` (00/01)
and `order-work` (00/02) both consume. The structural invariant — enumeration & resolution are
content-free — is recorded in the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (ADR-001 + its
fitness function).
