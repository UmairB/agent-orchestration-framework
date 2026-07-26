---
type: story
number: 00
slug: work-list-json
title: "aof work list --json — the stream as the board's data source"
parent: 3
status: done
owner: product-owner
created: 2026-06-19
updated: 2026-06-20
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · aof work list --json — the stream as the board's data source

## User story

As the operator driving an ACD work stream,
I want a single `aof work list --json` command that emits the whole milestone → story → task stream and each item's derived status in one pass,
so that the work board (and any other consumer) has one stable, machine-readable data source to render the stream from — instead of globbing the filesystem or scraping per-item docs.

<!-- This story PRODUCES the locked shared contract (ARCHITECTURE ADR-002): the flat JSON array
     `{ ref, type, slug, status, title, parent, dir }` per item. It is the m03 analogue of m02's
     PRD-fixture seam — freezing this shape is what lets the board story (01) build in parallel against
     a fixture of it. Built on the EXISTING content-free `listItems`/`findWork` (src/work.mjs:57,140);
     this story adds only the `aof work list` subcommand + the `--json` emit, no new traversal. -->

## Tasks

- [x] `tasks/00_list-json-contract.feature` — `aof work list --json` emits the frozen flat array — exactly
  `{ ref, type, slug, status, title, parent, dir }` per item (no more, no fewer), the WHOLE stream in a
  stable order, `parent` the only tree edge (null/absent at depth 0); stdout is pure JSON (no human
  chrome interleaved — the m02 `--json` lesson)
- [x] `tasks/01_list-human-output.feature` — `aof work list` with no flag prints a readable hierarchical
  listing (depth-indented ref · type · status · title) for terminal use, consistent with the other
  `aof work` commands; an optional scope ref (e.g. `aof work list 03`) lists that subtree

## Notes

Produces the **locked shared contract** (ADR-002) — the only obligation this story owes the rest of the
milestone, delivered to story 01 as a checked-in fixture, never a runtime dependency. The contract field
set is exactly `listItems`'s (ADR-002), so the emit is a thin pass over the existing traversal; this
story must NOT add convenience fields (depth/hasChildren/doc-paths) to the contract surface — those are
derivable consumer-side and a fat contract is harder to freeze (ADR-002 Alternatives). Guarded by the
`acd-work-list-contract` fitness function (flat array; exactly the seven fields; `parent` resolves).
Independent of stories 01 and 02 by construction.
