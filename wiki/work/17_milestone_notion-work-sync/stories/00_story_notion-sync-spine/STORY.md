---
type: story
number: 00
slug: notion-sync-spine
title: "The notion-sync spine — the registered notion:sync-work command + frozen envelope, the .aof/ mapping sidecar, and the opt-in no-op gate"
parent: 17
status: in-review
owner: product-owner
created: 2026-06-25
updated: 2026-06-26
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · The notion-sync spine — the contracts the siblings fan out from

## User story

As the product owner who runs the sync (and as the two sibling stories that fan out from this one),
I want `notion:sync-work` registered on the milestone-08 command core with its frozen `{ milestone, dryRun? }`
input + per-item result envelope, the `aof work integrations notion sync-work <milestone>` CLI dispatch, the
`.aof/notion.work-map.json` mapping sidecar (the sole aof-item ↔ Notion-page identity store), and the opt-in
no-op gate that reads `work.integrations.notion` and returns an honest `{ configured:false, items:[], hint }`
when it is absent,
so that there is ONE canonical command both faces inherit for free, one frozen envelope the projection logic
and any future board/MCP face can reason over, one identity store that makes re-syncs update-in-place, and a
hard-guaranteed "unconfigured ⇒ changes nothing, says so" baseline — the spine the projection/sync (01) and
provisioning/doctor (02) stories build against without re-opening these contracts.

<!-- This is the SPINE (ADR-001 mapping · ADR-002 command/envelope · ADR-004 config-load + no-op gate). It
     freezes the command id + input + per-item envelope, the mapping-store contract, and the opt-in-no-op
     gate. It owns NO projection/Notion-write logic (story 01), NO descriptor/schema/doctor surface
     (story 02), and NO arch-tests (story 03). It is provable end-to-end with the Notion-CLI spawn seam
     stubbed and the configured path returning an empty plan. -->

## Tasks

<!-- Contract authored at the Three Amigos stage (`aof:refine 17 --autonomous`, 2026-06-25): PO headline
     Scenarios + aof-qa Examples tables/tagging + aof-developer feasibility. Each task is one `.feature`
     under tasks/; the box is ticked when its `@executable` feature is green (at `aof:continue`). Structural
     invariants (the opt-in-no-op zero-call guarantee, the mapping-sidecar-only rule) live in
     ARCHITECTURE.md fitness functions as story-03 arch-tests, NOT here. Tags `@cli @adapter @work-stream`;
     all scenarios `@executable` (CLI/Notion spawn seam stubbed). -->

- [x] [`tasks/00_command-registered-and-invokable.feature`](tasks/00_command-registered-and-invokable.feature)
  — `notion:sync-work` is registered in the frozen command core (`{id,input,run,cli}`); `aof work
  integrations notion sync-work <milestone>` dispatches via `invoke`; `--json` projects the `SyncResult`
  envelope; an unknown `integrations <provider>` / a missing milestone fails cleanly. (6 scenarios) — ADR-002
- [x] [`tasks/01_opt-in-no-op-when-unconfigured.feature`](tasks/01_opt-in-no-op-when-unconfigured.feature)
  — with no `work.integrations.notion`, the command returns `{ configured:false, items:[], hint }`, spawns
  NO CLI (spy never fires), touches Notion not at all, and prints a setup hint; an unconfigured project is
  healthy. (4 scenarios) — ADR-004
- [x] [`tasks/02_mapping-sidecar-roundtrip.feature`](tasks/02_mapping-sidecar-roundtrip.feature) —
  `readMapping`/`resolvePageId`/`recordPageId` over the git-ignored `.aof/notion.work-map.json`: a HIT
  resolves the recorded page id, a MISS resolves `null`, a recorded binding survives a re-read with its
  meta, and a different `dataSourceId` does not resolve another board's bindings. (5 scenarios) — ADR-001

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md): **ADR-001** (the `.aof/` mapping sidecar is
the SOLE identity store — no external-id property, no resolve-by-query; frozen
`readMapping`/`resolvePageId`/`recordPageId`), **ADR-002** (`notion:sync-work` registered on the command core
under the `integrations notion` namespace; the frozen `{ milestone, dryRun? }` input + per-item
`created/updated/unchanged/skipped/no-op` envelope; the `notion:*` prefix excludes it from the `/api/work`
bijection but inherits the generic command-cli bijection), **ADR-004** (the config-LOAD + the opt-in-no-op
gate live here, since the command shape carries `configured`).

This story **owns**: `src/commands/notion-sync-work.mjs` (the registration + the frozen envelope + the
`configured:false` no-op gate); the `notion:sync-work` entry in
[command-core.mjs](../../../../../src/command-core.mjs)'s `COMMANDS`; the new `integrations` sub-noun branch
in `workCommand` ([cli.mjs](../../../../../src/cli.mjs)) routing through `invoke`; `src/notion/mapping.mjs`
(the sidecar store) + the `.aof/notion.work-map.json` baseline entry in
[aof-gitignore.mjs](../../../../../src/aof-gitignore.mjs). It **reuses** `work.mjs`'s
`listItems`/`readMeta`/`parseFrontmatter` to walk the milestone + its stories — NO new traversal.

**Independent because** it consumes only already-shipped contracts — the milestone-08 command core
(`08/ADR-002`, `invoke`/`getCommand`), the `work.mjs` traversal model, and milestone-13's `.aof/`
git-ignored derived-store + `aof-gitignore.mjs` seam (`13/ADR-001`) — and produces the THREE frozen contracts
the siblings consume (the command envelope, the mapping store, the config/no-op gate). The projected
create/patch logic is stubbed behind the Notion-CLI spawn seam, so it is provable end-to-end without a live
Notion. **It is the critical path** — stories 01 and 02 fan out from its frozen output.
