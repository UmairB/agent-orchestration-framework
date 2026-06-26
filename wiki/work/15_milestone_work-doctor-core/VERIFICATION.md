---
doc: verification
milestone: 15
updated: 2026-06-25
---
<!--
  Milestone VERIFICATION.md — the record of acceptance. Written by aof:verify.
  Only sections with content are kept (absence of a section is information):
  this milestone is @executable-only (no @manual / @uat / UI), so it carries
  Verification evidence + Findings + Accept decision — no User sign-off section.
-->
# 15 · Work Doctor Core — Verification

Lanes in scope: **@executable only**. All 9 task `.feature` files across the four stories are
`@executable`; there are **no `@manual`** (so no agent-runnable scenario to broker) and **no `@uat`**
scenarios (human acceptance skipped — a foundational/technical milestone), and **no UI surface**
(`DESIGN.md` absent, so the design-conformance lane does not apply).

## Verification evidence

### @executable suite + fitness functions (automated, no human)
- **`npm test` → 1233 ok / 0 not ok, exit 0.** The runner exits non-zero on any failure, so exit 0 ⇒
  every registered test passed.
  - verifies → every task `.feature` in stories 00–03: `doctor/00–03` (spine: registered command, the
    `{ findings }` envelope, healthy-is-silent, scope-as-filter, stream-level finding under narrow
    scope, the CLI render / `--json` envelope+summary / advisory / `--strict`, the `/api/work/doctor`
    board face, the snapshot-once + appended-group + de-dupe engine), `doctor/15-01` (coherence +
    lifecycle-completeness), `doctor/15-02` (freshness/date-sanity + structural-integrity incl. the
    dormant ROADMAP no-op and the structured-index mismatch).
- **Fitness functions (arch-tests) green:**
  - `arch/15 ADR-001` — every finding is exactly `{ code, severity, path, message }`, severity ∈
    {warn, error}. verifies → ARCHITECTURE ADR-001.
  - `arch/15 ADR-002` — the `--strict` exit matrix (clean→0, warn→0, warn+strict→nonzero, error→nonzero).
    verifies → `01_cli-face.feature`.
  - `arch/15 ADR-003` — `doctorWork` byte-identical across two runs with the same fixture + injected
    `now`; **no** doctor module reads the wall-clock (no `Date.now(`/argless `new Date()` across the
    `work-doctor*` family). verifies → `03_engine-spine.feature`, ADR-003.
  - `arch/15 ADR-005` — served `/api/work` routes are in registry-derived bijection with the `work:*`
    commands (not hard-coded); plus `command-core/00 the registry exposes exactly the known work
    commands` — the **third** hard-coded-six site the R-lesson named, now derived.
  - `arch/15-03` — the shipped `validate.md` invokes `aof work doctor $ARGUMENTS` **after**
    `aof work validate $ARGUMENTS` with the same scope. verifies → `00_doctor-after-validate.feature`.

### Agent-runnable smoke on the real stream (white-box, confirms the green is honest end-to-end)
- `aof work validate 15` → **PASS** (exit 0); `aof work doctor 15` → **healthy** (15 is coherent, exit 0).
- `aof work doctor` (whole stream) → **53 warnings / 0 errors**, advisory exit **0**; `--strict` exit **1**.
  Codes surfaced on real data prove every check-group fires: `orphan-folder` (1 — `.gsd-archive`),
  `missing-retrospective` (2), `started-story-no-tasks` (6), `milestone-no-stories` (1),
  `mtime-ahead-of-updated` (43).
- `aof work doctor --json` → the exact `{ healthy, strict, errors, warnings, findings }` summary envelope.

### Deferred QA flag (from STATE `## Feedback`) — confirmed
- The `mtime-ahead-of-updated` **date-only-vs-timed** semantics ("a date-only `updated` covers its whole
  day; an explicit-time `updated` compares to the exact instant") is pinned in
  `00_freshness-date-sanity.feature` Examples (`2026-06-20T12:00:00Z → none` vs `…T12:00:01Z → warn`).
  The suite is green ⇒ implemented exactly as the contract specifies. Flag resolved.

## Findings

No **new** defect or gap surfaced at verify. The in-build findings (de-dupe key separator, the
engine-determinism grep scope, zoneless-datetime parse, scope-dropping of stream-level findings,
symlink recursion guard) were triaged and **fixed at the review gate during `aof:continue`** (see STATE
`## Progress (build)` — QA **PASS**, architect **PASS-WITH-FINDINGS, all minor**, fixes confirmed
applied, suite 1233 ok). One review finding (deriving a 4th `SIX_WORK_IDS` subset guard) was
**deliberately not applied** with recorded rationale (it is a frozen-subset regression detector; deriving
it from `listCommands()` would make it tautological) — a non-blocker, no open defect.

## Accept decision

**ACCEPT.** All four stories' `@executable` contracts are green, every milestone-15 fitness function
passes, the validity gate (`aof work validate 15`) is PASS, and no blocker finding is open. The doctor
fires end-to-end on the real stream (advisory by default, `--strict` gates) and is wired into
`/aof:validate` after `aof work validate`, lane-grouped — validate stays the hard keystone, doctor the
advisory floor. Recorded after the `aof:validate 15` gate (PASS) and `aof:retrospective 15`.
