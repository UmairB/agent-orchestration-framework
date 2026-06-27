---
doc: verification
updated: 2026-06-27
---
<!--
  Milestone VERIFICATION.md — the record of the verify pass: evidence, findings, accept decision.
  Owner: aof:verify. Write only sections that have content (absence of a section is information).
-->
# 18 · Per-folder integration descriptor — Verification

Verify run `2026-06-27` (`aof:verify 18`). Lanes in scope: **`@executable` only** (62 scenarios incl.
outline rows across 8 task features) — **no `@manual`**, **no `@uat`** (no human-acceptance step), and
**no UI** (no `DESIGN.md` / frontend surface ⇒ no render → designer → QA design-conformance lane). The
inherited live-Notion lane (m17 finding NTN-V1) stays deferred and is **not** an m18 surface — m18 is the
offline routing/descriptor mechanism, every scenario of which is agent-runnable without a token. Outcome:
the automated + agent-run lanes are green, the validate gate passes, no blocker finding is open → milestone
**accepted**.

## Verification evidence

Agent-run, no token required — the suite was run as built and the fixed robustness paths were independently
re-smoked against the as-built modules (not restated from STATE).

- **`@executable` suite + fitness — green.** `node scripts/test.mjs` → **1381 ok / 0 not ok** (baseline
  1345; +36 from this milestone). The 71 milestone-18 assertions are all green: the 8 task-feature behavioural
  suites (`integrations-routing-reader` / `-boards-registry` / `-associate` / `-projection-board-routing` /
  `-projection-parent-nesting` / `-multiboard-sidecar` / `-parser-reverted` / `-legacy-removed`) and the six
  fitness arch-tests **FF-A..F** (`test/arch/acd-integrations-*`). *verifies →* every `@executable` scenario
  across stories 00/01/02 + the §Fitness FF-A..F table.
- **The six fitness functions are non-vacuous.** Each FF carries a planted-violation self-check that fires in
  the same run: FF-A "the forbidden matchers fire on a planted sidecar-entry-routing form"; FF-B "the
  `{}`-branch matcher fires on a planted flow-map branch; the parseFrontmatter matcher fires on a planted
  import"; FF-C/D/E/F exercised across both arms (valid + rejected). *verifies →* descriptor-is-committed-not-
  derived (FF-A), reader-is-JSON / parser-reverted (FF-B), board-resolution + default-fallback (FF-C),
  no-Notion-read (FF-D, snapshots 17/ADR-003 verb sets byte-for-byte), provider-extensible (FF-E),
  boards-schema-closed (FF-F).
- **C1 honest-error path re-smoked (the crash that the green suite missed).** Against the as-built
  `src/integrations/routing.mjs`, `resolveNotionRouting(milestone, { boards:{ ops:{…} } })` — a `boards`
  registry with **no `default`** — returns `{ board: undefined }` (no throw), which `notion-sync-work.mjs`
  (`src/commands/notion-sync-work.mjs:170`) converts to the honest `no-board-resolved` command error, **not** a
  raw `TypeError`. *verifies →* the C1 fix (fail-honestly, 17/ADR-004); see finding M18-C1.
- **C2 `isPageId` boundary re-smoked.** `isPageId` accepts **exactly** compact-32-hex and the canonical
  `8-4-4-4-12` UUID; a stray-dash form (`1-1-1-1-1`), 31-hex, a 32-char non-hex string, and a human key all
  classify as `"key"` (6/6 cases as specified). *verifies →* the C2 fix + `00_routing-reader.feature`
  parent-classification outline.
- **S2 associate clear-path re-smoked, live CLI.** `node src/cli.mjs work integrations notion associate 18
  --board none --parent some-key --json` → `{ ref:"18", board:null, parent:null, action:"unchanged" }`, exit 0,
  and **no `.integrations.json` was written** to the milestone folder — `--parent <key>` was **not**
  mis-rejected against the cleared board (parent validation short-circuits when the whole block is being
  cleared). *verifies →* the S2 fix + `02_associate-writes-descriptor.feature` `--board none` clear scenarios.

## Findings

All findings below were surfaced at the build **Review** gate (`aof:continue` — architect structural + QA
behavioural + developer craft) and **fixed at that gate**; the verify pass re-confirmed the three substantive
fixes (M18-C1/C2/S2 above) and re-ran the full suite green. No **new** defect was found at verify. The QA
deferred test-hardening recs are carried here as the findings ledger of record (findings live in
`VERIFICATION.md`, never in a task folder).

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| M18-C1 | `resolveNotionRouting` returns `{ board: undefined }` on a present-but-shapeless config (a `boards` registry with no `default`); `notion-sync-work` then dereferenced `routing.board.dataSourceId` unguarded → raw `TypeError`. The `@executable` features only exercise valid configs, so the crash path was invisible to the green suite. | defect (robustness) | major | **fix** (done at build gate) — added the present-but-shapeless guard → honest `no-board-resolved` command error (17/ADR-004); re-smoked at verify. | `notion-sync-work.mjs:170-177` | **closed (fixed + verified)** |
| M18-S2 | `associate --board none --parent <key>` mis-rejected a valid-shaped key against the (already-cleared) board with `unknown-parent-key`. | defect | minor | **fix** (done) — parent validation short-circuits when the whole notion block is being cleared; re-smoked at verify (`unchanged`, no write). | `notion-associate.mjs` | **closed (fixed + verified)** |
| M18-C2 | `isPageId` stripped all dashes before testing → looser than its stated contract (a stray-dash form passed as a page-id). | defect | minor | **fix** (done) — tightened to compact-32 **or** the exact canonical `8-4-4-4-12`; re-smoked at verify (6/6 cases). | `routing.mjs:78-83` | **closed (fixed + verified)** |
| M18-S1 | Stale doc-comments described the **superseded** SPEC.md-frontmatter / story-00-stub mechanism (`command-core.mjs:63-67` "Records a milestone PHASE parent in its committed SPEC.md frontmatter"; a `notion-sync-work.mjs` "story-00 stub" comment). Not covered by behavioural tests or arch-tests. | doc drift | minor | **fix** (done) — comments refreshed to the shipped `.integrations.json` mechanism (ADR-003/004). | `command-core.mjs`, `notion-sync-work.mjs` | **closed (fixed)** |
| M18-S3 | The resolver's unresolvable-parent `reason` could leak a literal `"undefined"` board name when no board resolved. | nit | nit | **fix** (done) — reason text branches on whether a board resolved. | `routing.mjs:193-195` | **closed (fixed)** |
| M18-Q | QA deferred test-hardening recs — behaviour is correct under probe, assertions could be tighter: **Q1** anchor the no-regression test to a captured golden m17 `SyncPlan` literal (it currently deep-equals two m18 codepaths, so a coordinated change to both arms could pass silently); **Q4** tighten the resolver-reason substring assertion to name both the key and the parents-map context; **Q5** assert the `--json` envelope still reports `board` on the `--parent none` unset path; **Q2** cover `--parent none` on an already-parentless/absent descriptor reporting `unchanged` with zero disk write. Also noted at verify: the `no-board-resolved` honest-error path (M18-C1) has no regression test — only the src guard. | test-coverage gap | non-blocker | **defer** to backlog — no behaviour defect; the suite is green and the fixed paths re-smoked at verify. Land the assertion-tightening (incl. a `no-board-resolved` guard test) in a follow-up hardening pass. | backlog (test hardening) | open (deferred) |

## Accept decision

**Accepted `2026-06-27`.** All three stories (00 routing-reader+boards+associate · 01 projection+multi-board
sidecar · 02 supersede-frontmatter+fitness) are built and reviewed; the `@executable` suite + the six fitness
functions are green (1381 ok / 0 not ok, all 6 FFs non-vacuous); the three substantive review fixes
(M18-C1/C2/S2) were re-smoked independently at verify; `aof work validate 18` passes; and **no blocker finding
is open** (the only open finding, M18-Q, is a non-blocker test-hardening deferral). There are no `@uat`
scenarios and no UI surface, so no human-acceptance or design-conformance step applies. Stories 00–02 →
`done`; SPEC status → `done`. The inherited live-Notion lane (NTN-V1) stays deferred at the m17 level and does
not gate this milestone.

## Gate

`aof work validate 18 --json` → `[]` (no problems), **exit 0 — PASS** (folder↔frontmatter, closed-vocab tags,
depends graph `[17]`). Test-traceability holds — all 8 task features map to a green `integrations-*`
behavioural suite and the FF-A..F arch-tests (71/71 m18 assertions green). The litmus is trivially satisfied
(no UI surface ⇒ no visual fidelity to keep out of the `.feature`s).
