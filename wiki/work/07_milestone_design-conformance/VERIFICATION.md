---
doc: verification
---
<!--
  Milestone VERIFICATION.md — the verify/accept record. Evidence + findings + sign-off + accept decision.
  Write only sections that have content (absence of a section is information). Pointers, not restatements.
-->
# 07 · Design-Conformance Verification — Verification

> Milestone 07 is **machinery-only**: it builds the design-conformance loop (agents, commands, DESIGN
> template, schema, fitness functions). It has **no DESIGN.md / UI surface of its own**, no served app,
> no `work.ui.baseUrl`, and Playwright is deliberately uninstalled (ADR-002). So the structural contract
> is fully verifiable here; the served-app/render/judgment residuals are deferred to the first real UI
> milestone that *consumes* the loop.

## Verification evidence

### Automated suite + fitness functions — GREEN
`node scripts/test.mjs` → **798 ok / 0 not-ok / exit 0** (2026-06-21). All five NEW fitness functions ran green
(+ the existing manifest guard):
- `acd-design-role-split` — designer no-`Bash` + judges-a-handed-screenshot; QA carries `Bash` + owns the
  Playwright harness, `toHaveScreenshot`, functional checks; orchestration renders + hands off; a11y run
  QA-owned + gated on opt-in. **verifies →** ADR-001/004; story 00/00, 01/00, 01/02, 02/01 `@executable`.
- `acd-conformance-verdict-contract` — `CONFORMS`/`GAPS`/`INCONCLUSIVE` named + closed; INCONCLUSIVE-when-no-
  baseline/no-render; render via `npx playwright`; Playwright NOT in `package.json`. **verifies →** ADR-002;
  story 00/01, 02/01 `@executable`.
- `acd-design-template-baseline` — DESIGN template carries the committed-`mocks/` source-of-truth + a
  mandatory binding-checklist section; no remote-link-only mock. **verifies →** ADR-003; story 02/02.
- `acd-a11y-config-schema` — `work.ui.a11y` optional + CLOSED peer to `baseUrl`; absent/empty validate;
  unknown key fails on `additionalProperties`; `level` enum `A/AA/AAA`; `a11y` a plain `domains` opt-in.
  **verifies →** ADR-004; story 01/01.
- `acd-design-conformance-bundled` — the contract markers are present in the `src/bundle/` assets; the
  drift-guard self-test trips when a required marker is removed; wired into `scripts/test.mjs`. **verifies →**
  ADR-005; story 02/03.
- (existing) `acd-bundle-manifest-hashes` — the derived `manifest.json` content-addresses the rendered
  bundle (the only cross-story co-touch). GREEN.

### Design-conformance render step — N/A (no surface)
Milestone 07 owns no DESIGN.md / frontend surface — it edits the DESIGN *template*, not a DESIGN for itself.
There is nothing to render, so the render → hand-to-designer → spawn-QA step does not apply to this
milestone. (The render path itself is verified structurally by the fitness functions above + the `@manual`
evidence below.)

### `@manual` — live-state observations (exercisable now, no served app needed)
- **No base URL ⇒ honest INCONCLUSIVE.** `.aof/aof.config.json` has no `work.ui` block (no `work.ui.baseUrl`)
  and no `--url` was passed. The bundled `verify`/`continue` wiring routes a surface with no resolvable base
  URL / screenshot to `INCONCLUSIVE`, names the missing render/base URL, and never hands the designer
  component code to guess from (`verify.md` "Verdict" step). For this repo's config the only reachable
  verdict for any hypothetical surface is the honest INCONCLUSIVE. **verifies →** story 02/01 `@manual` "no
  base URL resolvable ⇒ INCONCLUSIVE" + the no-render rows of the routing table.
- **a11y lane off ⇒ no a11y check.** `work.tags.domains` does not contain `a11y` (absent ≡ off). The bundled
  QA contract gates the axe-core-via-Playwright run on that opt-in (green via `acd-design-role-split` QA
  a11y slice), so on this board QA runs no a11y check and produces no a11y findings. **verifies →** story
  01/02 `@manual` "with the lane off, no a11y check runs" + the lane-off row of the ownership table.
- **Designer handed no screenshot ⇒ INCONCLUSIVE (rule level).** The bundled `aof-designer` states "Handed
  no screenshot → INCONCLUSIVE … not a guess inferred from the component code", backed green by
  `acd-conformance-verdict-contract`. The runtime exercise (spawning the designer to observe the verdict)
  was deliberately NOT run: this repo's local `.claude/agents/aof-designer.md` render is **stale** (Finding
  F1) — it would exercise the pre-lift contract, not the deliverable. **verifies →** story 00/00 `@manual`
  (rule level; runtime exercise deferred with the residuals below).

### `@manual` / `@uat` — deferred to the first real UI-milestone consumer
These require a **served app at a base URL**, a **real browser/Playwright render**, a **designer-approved
baseline**, and (for refine) a **user-supplied mock** — none of which exist for a machinery-only milestone.
The ARCHITECTURE explicitly classifies them as "NOT fitness functions" (the build-time/judgment residuals).
To be exercised when a real UI milestone runs the loop:
- story 01/00 `@manual` — QA harness regression vs a served surface.
- story 01/02 `@manual` — a11y ON run (lane on + served app + browser).
- story 02/00 `@manual` ×3 — refine actually commits a user-supplied mock / makes the checklist the baseline.
- story 02/01 `@manual` — served-app render reaches a non-INCONCLUSIVE verdict; the render-present routing rows.
- story 00/01 `@manual` decision-table — the screenshot-present (CONFORMS/GAPS-reachable) rows.
- story 00/01 `@uat` — judgment quality (CONFORMS vs the right GAPS) on a real rendered surface + reviewer agreement.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| F1 | This repo's local `.claude/agents/aof-designer.md` (Jun 18) + `aof-qa.md` (Jun 16) were **stale renders** predating the Jun 21 bundle upgrade — the rendered designer still carried the demoted "read the component code and infer (weaker)" fallback. `.claude/` is **gitignored** (not version-controlled, never ships); the `src/bundle/` source of truth was correct + green. | process / install-drift | non-blocker | re-render the local install | local dev install | **resolved** — `aof work init` re-rendered the 8 agents + aof commands (2026-06-21); the live designer now carries the upgraded contract (`infer (weaker)` gone, `Handed no screenshot → INCONCLUSIVE` present) and `.aof/aof.lock.json` records the install. |

F1 did **not** affect the milestone deliverable — new aof projects render fresh from the green bundle; it
only affected aof-the-repo's own live agents, now re-rendered. **Side-effect of the re-render:** `aof work
init` also materialised 12 `.aof/templates/work/…` files, which are **not** gitignored (only `.claude/` is)
and so are currently untracked-but-committable. Decide whether to commit them (the materialised work-template
set) or add `.aof/templates/` to `.gitignore` as a local install artifact — out of scope for this verify.

## Validate gate
`aof work validate` → **PASS — work stream is well-formed.** Test-traceability + litmus were closed at review
(STATE: every `@executable` row backed by an assertion; lane audit PASS). Full suite green (above).

## Re-verification (2026-06-22)
Re-ran the gate in the current post-08–12 tree: the `@executable` suite is green (**990 ok / 0 not-ok**, up
from 798 at the 07 build) and the **17 design-conformance arch-test rows** (the five new fitness functions +
the manifest guard) are all green; `aof work validate 07` = **PASS**; F1 stays resolved; **no blocker open**.
The deferred residuals remain structurally un-exercisable — there are **0 committed mocks** anywhere under
`wiki/work` and `work.ui.baseUrl` is still unset, so no served surface + baseline exists to run the 5 `@uat`
+ 22 `@manual` rows. Nothing changed since the hold except that the loop's deliverable is still green.

## Accept decision
**Accepted on the machinery deliverable — 2026-06-22 (supersedes the 2026-06-21 operator HOLD).** 07 *is* the
design-conformance loop's machinery (agents, commands, DESIGN template, schema, fitness functions); it is
fully verified and green (990/0 suite + 17 design-conformance arch-tests, `validate 07` PASS) with **no
blocker open**. The `@uat`/served-app residuals do **not** test 07's deliverable — they test the loop's
*output quality on a consumer surface*, which by construction needs a downstream UI milestone with a committed
mock + served base URL; gating a machinery milestone on a consumer that does not yet exist left it parked
across two sessions (see RETROSPECTIVE R4). The residuals are therefore **carried forward** as an explicit
obligation on the **first real UI milestone that consumes the loop** — to be homed in that milestone's verify
or a cross-milestone **UAT session** (`aof:add-uat`), flagged "exercise on first consumer," not "blocks 07."
All three stories are `done`; `SPEC.md status: done`, its `## Stories` boxes ticked, `STATE.md` compacted, and
[RETROSPECTIVE.md](RETROSPECTIVE.md) written (R1–R4). The `@executable` deliverable's task boxes were all
green; the deferred residuals are tracked above, not as open story tasks.

### Carried-forward obligation (for the first UI consumer)
Exercise these against a served UI surface with a committed baseline (a future UI milestone's verify or a UAT
session over it): story 00/01 `@uat` (judgment quality — CONFORMS vs the right GAPS + reviewer agreement);
story 02/01 `@manual` (served-app render reaches a non-INCONCLUSIVE verdict); story 01/00 `@manual` (QA
harness regression vs a served surface); story 01/02 `@manual` (a11y ON run); story 02/00 `@manual` ×3 (refine
commits a user-supplied mock / makes the checklist the baseline); story 00/01 `@manual` decision-table
(screenshot-present CONFORMS/GAPS rows).
