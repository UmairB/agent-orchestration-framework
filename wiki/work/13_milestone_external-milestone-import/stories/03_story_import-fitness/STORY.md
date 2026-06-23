---
type: story
number: 03
slug: import-fitness
title: "The import fitness functions — artifact-shape, read-only-source, indexer-extends-scan/no-graphify-spawn, not-a-work-item, derived-index — as arch-tests"
parent: 13
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
---
# 03 · The import fitness functions — the load-bearing structural guarantee

## User story

As the architecture itself (the "the import reuses the 05 doc shapes with no new parser, reads the source read-only, indexes only by extending the existing scan, never becomes a managed work item, and stays a derived index that never fabricates" guarantee),
I want the structural invariants of ADR-001…ADR-005 enforced as CI **arch-tests**,
so that the contract is **durable**: a future change that adds a bespoke `OUTPUT.md` parser or record shape, constructs a `git` write verb against the source, writes the memory index JSON directly or imports/spawns graphify, materializes an import as an `NN_type_slug` folder under `workDir`, or persists a record absent from its `.md` — fails CI **loudly** instead of silently re-introducing the drift.

## Tasks

<!-- This story's deliverable is the FITNESS FUNCTIONS of the ARCHITECTURE.md table — arch-tests, NOT
     task `.feature` scenarios (structural invariants belong in the fitness table, never inside a
     behaviour feature). Its contract is therefore ALREADY fully specified by the fitness-functions
     table — there is no Three-Amigos `.feature`-authoring pass; `aof:continue 13/03` authors the
     arch-tests directly and they turn GREEN as 00/01/02 land (mirrors 05/03 and 10/03). The six
     arch-tests (5 fitness rows; indexer-extends-scan + no-graphify-spawn are split into two files)
     are tracked here as the story's buildable units. -->

- [x] `test/arch/acd-import-artifact-shape.test.mjs` — **reuse the 05 doc shapes; no new parser, no new record shape**: a fixture materialized import parses with the EXISTING `parseArchitecture`/`parseRetrospective` into frozen `MemoryRecord`s; the import module defines no new parser/record shape; `SPEC.md` is never parsed into records — ADR-001.
- [x] `test/arch/acd-import-read-only-source.test.mjs` — **registered command + read-only source**: `getCommand("import:milestone")` is the frozen-shape command with a `cli` adapter; the import module constructs no `git` write verb / no shell-string spawn; the only external-fetch form is the read-only `git ls-remote`/fetch argv idiom — ADR-002.
- [x] `test/arch/acd-import-indexer-extends-scan.test.mjs` — **index via the existing store + scan extension**: the indexer extension reuses `buildRecords`/the existing parsers into the existing index path; no new index file under `.aof/`; the import command never writes `aof.memory.index.json` directly — ADR-003.
- [x] `test/arch/acd-import-no-graphify-spawn.test.mjs` — **never graphify directly**: the import command + materialize module import no `src/graphify.mjs` and spawn no graphify (graphify is reached only by the backend via the 09 commands) — ADR-003 (10/ADR-002).
- [x] `test/arch/acd-import-not-a-work-item.test.mjs` — **an import is never a managed work item**: a fixture import materialized into a temp project never appears via `listItems`/`findWork`/`nextWork`/`validateWork`; the store is OUTSIDE `workDir`, uses no `NN_type_slug` name, and is git-ignored via the nested-`.gitignore` baseline — ADR-004.
- [x] `test/arch/acd-import-derived-index.test.mjs` — **derived-index + no fabrication + clean snapshot**: each imported record's `source:line` resolves to live text in the import store; a second import over the same fixture source yields the identical artifact + record set; the import store is git-ignored; no record exists absent from the `.md` — ADR-001, ADR-005.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (the **Fitness functions** table — the
load-bearing deliverable). This story **owns** the six arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It authors **no production code**.

**Independent because** it asserts against the **frozen** command + materialize store (story 00),
recovery (story 01), and indexer extension (story 02) surfaces — but consumes **none of their
internals**: it source-greps the import module's import graph, parses a fixture materialized import with
the existing parsers, materializes a fixture import into a temp project and runs the work-item resolver
over it, and checks `source:line` resolution + re-import idempotency. Owning no production code, it cannot
block — or be blocked by — the siblings' internals; the tests are RED-until-built by design (they
reference the stories-00/01/02 surfaces and fail cleanly until those land) and go GREEN as the siblings
land.

> **Note (a separately-tracked deliverable, not a behaviour story):** the SPEC names the read-only /
> not-a-work-item / derived-index guarantees as load-bearing, so they get their own owner and review
> surface here. But the units are *arch-tests*, not `.feature` files — there is no Three-Amigos Contract
> pass; the contract is the ARCHITECTURE.md fitness table (mirrors 05/03 and 10/03).
