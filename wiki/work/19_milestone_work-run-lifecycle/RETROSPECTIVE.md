---
doc: retrospective
milestone: "19"
slug: work-run-lifecycle
created: 2026-06-30
---
<!--
  Milestone RETROSPECTIVE.md — answers ONE question: what did HOW we executed teach us?
  Distilled at Accept (aof:verify) / backfilled by aof:retrospective. One R<n> per lesson, APPEND-only —
  never renumber. References VERIFICATION @finding-<id> / ADR / commit; never restates them.
  Lessons graduate into memory (aof work memory ingest) so the next milestone's refine/continue recall them.
-->
# 19 · Work-Run Lifecycle — Retrospective

## R1 — An ADR that registers a command-core command must enumerate EVERY registry-derived fitness function it trips, not just the CLI bijection

- **Kind:** near-miss · **Area:** architecture · **Stage:** refine · **Owner:** architect · **Raised by:** developer (build)
- **What happened.** ADR-003 named only `acd-work-command-cli-bijection` as the fitness function story 01
  would extend. Registering the three `work:run-*` commands also tripped two *other* registry-derived
  invariants the ADR did not anticipate: the `/api/work` route bijection
  (`acd-work-command-route-coverage`, which asserts every `work:*` command has a served board route) and
  the `command-core/00 exactly the known work commands` allow-list. Both conflicted with ADR-003's
  "only the CLI face is wired here; the board is milestone 21."
- **Why.** The registry-derived fitness functions (generalised by `15/ADR-005`) fan out from a *single*
  act — adding a `COMMANDS` entry. They are auto-coverage by design, so any new command is silently
  conscripted into all of them at once. The ADR reasoned about the one it named and missed that the
  same additive move arms two more.
- **Lesson.** When an ADR adds a command-core command, list **all** the registry-derived gates the
  registration arms — CLI bijection **and** route-coverage **and** the known-commands allow-list — and
  state how each is satisfied (extend / carve-out). The build resolved it cleanly without touching
  `board-ui.mjs` (the precedented m15-doctor `WORK_IDS` widening + a documented `BOARD_DEFERRED`
  carve-out mirroring the `notion:*` m17/18 exclusion), and the carve-out comes out when milestone 21
  wires the board routes — but the ADR should have predicted the surface, not the build.
- **Refs:** STATE §Feedback; ADR-003; `acd-work-command-route-coverage` / `acd-work-command-cli-bijection`
  / `command-core/00`.

## R2 — The foundation's run-record durability has two known producer-side gaps deliberately deferred to milestone 20 — m20 MUST pick them up, not re-discover them

- **Kind:** near-miss (carried-forward) · **Area:** code · **Stage:** verify (craft review) · **Owner:** milestone 20 · **Raised by:** architect / craft-review
- **What happened.** Two durability gaps surfaced at the craft gate that the read-side tolerance fix
  (`readRuns` skipping a torn file + a coded `invalid-brief`) only *masks*: (a) `persist()` writes per-run
  files with a non-atomic `writeFile`, so a process killed mid-write leaves a torn file; (b) `seq` is a
  sequential read-then-write counter, so two interleaved `startRun` calls mint the same `runId` and the
  second silently overwrites the first.
- **Why.** Both are genuinely **out of this foundation's scope** — the single-operator model triggers and
  runs in one step, with no concurrency and no mid-write kill in the happy path. But they are the exact
  "resumable rests on durable state" promise milestone 20 (autonomous-run-resilience) consumes, so masking
  them at the read side is correct *here* and a latent gap *there*.
- **Lesson.** Milestone 20 must (a) route the run-record write through the atomic temp+rename seam
  (`src/fs.mjs:writeText`) and (b) own concurrent `runId` minting in its scheduler/dedup — these are not
  schema changes, they are the resilience mechanics m20 exists to add. **Related contract assumption to
  preserve:** `compactStamp` strips `-`/`:`/`.`, so the sortable `runId` stamp depends on every caller
  passing a UTC `Z`-form `toISOString()` (the frozen ADR-003 contract); production is safe today, but when
  m20 increments `seq` / persists transitions it must keep that UTC-`Z` assumption intact rather than
  inject a non-UTC `now`.
- **Refs:** STATE §Feedback (two entries — architect/craft-review + the minor `compactStamp` note);
  ADR-001/002/003; `src/run-store.mjs` (`persist`/`seq`/`compactStamp`); milestone 20 SPEC.

## R3 — The STATE template's `## Verification` block hard-codes a `@manual`/UAT checkbox that is wrong for a milestone with zero `@manual` scenarios

- **Kind:** misunderstanding · **Area:** process · **Stage:** verify · **Owner:** author / template · **Raised by:** QA (F-19-01)
- **What happened.** STATE.md §Verification carried `- [ ] @manual signed off — see UAT.md`, but this
  milestone ships no `@manual`/`@uat` scenario and no `UAT.md` exists — a stale template checkbox implying
  a human-acceptance lane that does not exist.
- **Why.** The STATE scaffold pre-seeds a `@manual`/UAT verification line unconditionally, so a purely
  technical/foundational milestone (all `@executable`, board deferred) inherits a checkbox it can never
  satisfy. Absence of a `@manual` lane is information; a stale unchecked box hides it.
- **Lesson.** The STATE template should omit the `@manual` / `UAT.md` verification line when a milestone
  ships zero `@manual` scenarios (write only the sections that have content — the same "no empty None
  placeholders" discipline the verify flow applies to VERIFICATION/SESSION). Resolved in this accept's
  STATE compaction (the stale line removed).
- **Refs:** VERIFICATION `@finding-F-19-01`; STATE §Verification.

## R4 — Ambiguity-resolution scenarios should pin the UNAFFECTED invariant, not only the targeted outcome

- **Kind:** near-miss · **Area:** contract · **Stage:** refine · **Owner:** QA / author · **Raised by:** QA (F-19-02)
- **What happened.** The `run-commands` "two running runs / first runId → completes that run as done"
  scenario asserts the named run completed but does **not** assert the *other* running run stayed
  `running`. The behaviour is correct as built; the scenario text is faithful but under-specifies the
  invariant that unambiguous resolution touches only the target.
- **Why.** Ambiguity/selection scenarios naturally assert the thing that *changed* and omit the
  equally-important thing that must **not** change (the sibling/unaffected record). That omission is a
  silent contract gap even when the implementation happens to be right.
- **Lesson.** When a scenario resolves one item out of several (a `runId`/ref disambiguation), pin both
  sides: the target transitioned **and** every sibling is byte-unchanged. A cheap "the sibling run is
  still running" assertion closes the gap. Carried as an optional hardening (non-blocking).
- **Refs:** VERIFICATION `@finding-F-19-02` + §Mis-specification flags; `run-commands/00`.
