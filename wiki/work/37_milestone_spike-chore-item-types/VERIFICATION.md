---
doc: verification
milestone: 37
verified: 2026-07-10
verifier: aof:verify
verdict: accept
---
<!--
  Milestone VERIFICATION.md — the verification record. Pointers, not restatements.
  Only sections with content are written (absence of a section is information — no @uat here).
-->
# 37 · Spike & Chore Work-Item Types — Verification

Ref resolved via `aof work find 37 --json` → milestone `spike-chore-item-types`, 4 stories, all
`in-review` at gate entry. Lanes in scope: `@executable`, `@manual`. **No `@uat`** (no UAT session
framed) — the human-acceptance step is skipped, so no user is pestered.

## Verification evidence

### Automated + fitness functions (no human)

- **`@executable` suite green** — `node scripts/test.mjs` → exit 0, **2321 ok / 0 not-ok** (0 `not ok`
  lines). Covers story 00's engine task-tests, story 01's template/bundle task-tests, and the whole
  regression sweep (node + Rust `app/desktop`). *verifies →* `00/*.feature`, `01/*.feature`
  `@executable`.
- **Fitness functions self-activated green** — the 6 milestone FFs (FF-3701..3706) fire live now that
  `ITEM_RE` admits `spike`/`chore`: vocabulary (admits the new two, still admits the original four),
  `isDriver`, `recordDoc`→`SPIKE.md`/`CHORE.md`, spike/chore-no-`.feature`-validates-clean (+ non-vacuity),
  `nextWork` uat-shaped candidacy-guarded branch, `CHORE.md` `## Definition of Done` checklist. All green
  in the suite run above.
- **`aof work validate 37` → PASS** (exit 0) — folder↔frontmatter, closed vocabulary, depends graph.

### Agent-run `@manual` scenarios

Executed in a **throwaway stream** (scratchpad) against the REAL shipped templates + the REAL validator,
so the live `wiki/work` stream is not polluted. Each observable `Then` confirmed black-box.

- **Story 01 — `/aof:add-spike`, `/aof:add-chore` scaffold a folder that validates clean.**
  Instantiated `01_spike_<slug>/SPIKE.md` and `02_chore_<slug>/CHORE.md` from the bundled templates
  (`.aof/templates/work/{spike,chore}/`) with placeholders filled as the command directs → `aof work
  validate` PASS (exit 0), no findings for either folder; `aof work find` resolves each as `type:
  spike`/`chore`, `parent: null`; `list --json` surfaces both as drivers. The shipped `add-spike.md` /
  `add-chore.md` command docs direct exactly this scaffold (`type` pinned, `depends: []` default,
  frame-only — no `tasks/`, no `.feature`). *verifies →* `01/00_spike-template-and-command.feature`
  (@manual), `01/01_chore-template-and-command.feature` (@manual).
- **Story 02 — spike verified on its recorded finding, not on tests.** Applied the shipped `verify.md`
  `<spike-chore>` criterion to the finding-state matrix: `## Finding` still holding the template stub
  `<the answer, and the evidence/reasoning behind it>` → **declined** (placeholder = unfilled); a
  `## Finding` filled with a real resolved finding (no residual `<…>`) → **accept → `done`**, with no
  scenario suite and no "tests green" step. Empty/absent map to decline by the same rule. *verifies →*
  `02/00_spike-verify-finding-recorded.feature` (@manual).
- **Story 02 — chore verified on ticked checklist + green validate (two gates, together).** Scaffolded
  chore with unticked `- [ ]` boxes → **declined** (gate 1 fails). Every box ticked `- [x]` **and**
  `aof work validate` PASS → **accept → `done`**, with no `.feature`/behavioural step. A red validate
  would decline even with all boxes ticked (the AND). *verifies →*
  `02/01_chore-verify-checklist-and-validate.feature` (@manual).
- **Story 02 — refine + behavioural bypass.** Shipped `refine.md` refuses/redirects a spike/chore
  (no Three-Amigos, no `stories/`, no `tasks/`; points at `aof:verify <ref>`); `verify.md`'s
  `<spike-chore>` path runs no `@executable`/`@manual` scenario suite for the type. *verifies →*
  `02/02_refine-bypass-and-board-badge.feature` (@manual scenarios).
- **Story 03 — shatter frames a blocking unknown as a `spike` driver.** Shipped `shatter.md` frames
  milestone-vs-`spike` per PRD chunk (blocking unknown → `NN_spike_<slug>/SPIKE.md` from the template,
  `type: spike` + `origin:`, groups no stories), wires the consuming milestone's **backward-only**
  `depends: [<spike-NN>]` (spike numbered below), names the finding it waits on, and excludes `chore`
  (ad-hoc only, ADR-004). Mechanical substrate proven: a mixed milestone+spike+chore roadmap with a
  milestone `depends: [<spike>]` backward edge → `aof work validate` PASS (exit 0), acyclic; the FF
  suite asserts the milestone-blocked-on-not-done-spike / unblock-on-done behaviour directly.
  *verifies →* `03/00_shatter-frames-spike.feature` (@manual).

## Design conformance

- **Surface:** the board type-badge for `spike`/`chore` drivers (`ui/src/board/{api.ts,model.ts,
  BoardLanes.tsx}`). **Verdict: `INCONCLUSIVE`** — no renderable baseline exists (no `DESIGN.md`, no
  committed mock, no `work.ui.baseUrl`/`--url`). This is by design: ADR-003 scopes the board change to a
  **minimal type-badge only**, with full per-type board rendering explicitly out of scope. There is no
  design contract to conform to, so the honest verdict is `INCONCLUSIVE`, not `CONFORMS`/`GAPS`.
- **What was confirmed instead (render/type-check):** `npm run ui:build` → exit 0 (green). Code
  inspection: `spike`/`chore` join the `type` union (`api.ts`, `model.ts`); `deriveBoard` collects them
  as `otherDrivers`; `BoardLanes` places them via the **same existing driver mechanism** as `uat`
  (`place(d, d.type)`) — no new lane/column, and the placement tag text **is** the item's type, which is
  exactly the badge the scenario asserts.

## Findings

| id  | observed | type | severity | triage | routed-to | status |
|-----|----------|------|----------|--------|-----------|--------|
| F-3701 | The board type-badge scenario is tagged `@executable` but has **no UI test harness** (no `toHaveScreenshot`/DOM assertion); it is verified by `npm run ui:build` + code inspection only, so the badge is not locked against visual regression. | non-blocker (test-coverage gap) | low | defer | QA (browser-harness follow-on, already noted out-of-scope in STATE) | open (deferred) |

<!-- Only genuine defects/gaps are tabled. No blocker finding — acceptance proceeds. -->

## Accept decision

**ACCEPT.** Every lane is satisfied: `@executable` suite + all 6 fitness functions green
(2321 ok / 0 not-ok), `aof work validate 37` PASS, and every `@manual` scenario across the four stories
confirmed agent-run against the real shipped templates/skill-docs/validator. Design conformance is
`INCONCLUSIVE` only because the board change is a deliberately-minimal type-badge with no design baseline
(ADR-003, in scope). The single finding (F-3701) is a deferred non-blocker test-coverage gap — no blocker
finding is open. All four stories are `done`; the milestone is accepted.
