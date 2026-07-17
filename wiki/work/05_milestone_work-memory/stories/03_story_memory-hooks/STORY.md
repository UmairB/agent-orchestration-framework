---
type: story
number: 03
slug: memory-hooks
title: "Memory hooks — recall at decision points, ingest at Accept"
parent: 05
status: done
owner: product-owner
created: 2026-06-19
updated: 2026-06-19
schema: 1
aofVersion: 0.1.0
---
# 03 · Memory hooks — recall at decision points, ingest at Accept

## User story

As an ACD agent in the refine → continue → verify loop,
I want the commands to recall the relevant prior lessons before I decide, and to ingest the new lessons at Accept,
so that the memory seam actually changes decisions — "we already learned this" reaches me automatically at the moment it would save a repeat mistake, instead of only when a human remembers to run the verb. A seam nothing calls improves nothing; this story is what makes the milestone's objective ("agents improve over time") true.

<!-- Added AFTER the seam (00–02) was proven and accepted. Scoping the hooks out was the wrong cut:
     `recall`/`ingest` are callable but no command invokes them, so memory sits inert. This story
     closes the loop. It builds ON the accepted seam (sequential, not parallel with 00–02). -->

## Tasks

<!-- Contract for the read/write hooks. The mechanical, deterministic parts are @executable; that an
     agent HEEDS a surfaced lesson is agent-observed (@manual, recorded in VERIFICATION.md). The
     hooks live in the bundled command prompts (src/bundle/commands/*.md), so they ship to every
     project that runs `aof work init` — memory stays opt-in (none = unchanged). -->

- [x] `00_recall-block-injectable.feature` — `@executable`: a read hook injects recall's output as a **compact, bounded, scope-filtered, highest-first block** (one line per record: id · kind · area · title · `source`), capped at the hook limit — the shape a command pastes into agent context.
- [x] `01_refine-read-hook.feature` — `@manual`: `aof:refine`, before ADRs/stories are authored, runs a **role-scoped recall** (architect → `--area architecture`; PO → the milestone's domain) and surfaces it; a surfaced near-miss relevant to the decision is acknowledged in ARCHITECTURE.md/STATE (honoured or consciously departed from).
- [x] `02_continue-read-hook.feature` — `@manual`: `aof:continue`, before build, runs a domain + `--kind near-miss` recall and the developer considers the surfaced gotchas.
- [x] `03_verify-ingest-write-hook.feature` — `@manual` + count assertion: `aof:verify`, at Accept **after** `RETROSPECTIVE.md` is written, runs `aof work memory ingest`; the index `recordCount` then includes the just-accepted milestone's `R<n>` + `ADR-NNN`, so the lessons are recallable next milestone.
- [x] `04_hooks-inert-when-memory-off.feature` — `@executable`: with `memory.backend` `none` (or absent), every hook is a **silent no-op** — recall surfaces nothing, ingest writes nothing, and `refine`/`continue`/`verify` behave identically to ACD without memory (no block, no error, no prompt noise).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**: the read-hook
recall step in the bundled `aof:refine` / `aof:continue` commands, the write-hook `ingest` step in
`aof:verify` at Accept, the compact injection render, and the role → scope mapping
(architect=`area:architecture`, developer=domain+`kind:near-miss`, reviewer=`kind:near-miss`).

**Depends on the seam (`00`–`02`), not parallel with it.** It calls the *finished* verbs through the
frozen interface (ADR-003) — it adds no new backend method and no new contract; it consumes
`RecallResult` (ADR-004) and the `ingest`=`reindex` alias. The only new code surface is the compact
injection render (task 00); everything else is **prompt wiring** in `src/bundle/commands/*.md` plus the
no-op guard (task 04).

**Portability is the point.** The hooks ship in the bundle, so any project that runs `aof work init`
and sets `memory.backend: "local"` gets the loop; a project with no `memory` key is byte-for-byte
unaffected (task 04). Memory is opt-in, and absence is information.

**Litmus held:** do **not** verify a read hook by grepping a command prompt for the word "recall" (the
R1 requiring-grep smell). The read hooks are verified by agent observation that the recall ran and was
considered (`@manual`); only the mechanical render and the no-op guard are `@executable`.
