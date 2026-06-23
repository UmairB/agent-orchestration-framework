---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 07 · Design-Conformance Verification — State

> **Compacted at Accept (2026-06-22).** Durable decisions live in [ARCHITECTURE.md](ARCHITECTURE.md)
> (ADR-001..006); the verify evidence + the carried-forward residuals in [VERIFICATION.md](VERIFICATION.md);
> the execution lessons in [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R4). The blow-by-blow build/review
> narrative is archived.

## Progress

- **Framed → Refined → Built → Verified & ACCEPTED (2026-06-21 → 2026-06-22).** Framed after a session
  diagnosing why the designer is poor at verifying designs (no committed mock, no rendered screenshot, no
  base URL → it infers from code). Refined (`aof:refine 07 --autonomous`) into **3 independent stories**
  over ADR-001..006; built in two waves (parallel bundle content → one integrator for the cross-cutting
  arch-tests + runner wiring + the derived manifest); verified and accepted on the machinery deliverable.
  All three stories **done**: **00** designer-fidelity-judge · **01** qa-browser-harness · **02**
  review-wiring-and-convention.
- **Deliverable shipped:** the bundled designer (read-only judge, no `Bash`), QA (Playwright harness +
  `toHaveScreenshot` + opt-in a11y), `refine`/`verify`/`continue` (render→hand-off→spawn-QA at 390/768/1280,
  INCONCLUSIVE-without-baseline), the DESIGN template (committed-`mocks/` + mandatory binding checklist), the
  closed `work.ui.a11y` schema, and **five new fitness functions** + the manifest guard — all green.
- **Accepted on machinery 2026-06-22** (`aof:verify 07`, supersedes the 2026-06-21 operator HOLD).
  `@executable` 990/0 + 17 design-conformance arch-test rows green; `validate 07` PASS; F1 resolved; no
  blocker. 07 owns no served UI surface, so the 5 `@uat` + 22 `@manual` served-app residuals are
  **carried forward** to the first real UI milestone that consumes the loop (a UAT session / that
  milestone's verify) — see VERIFICATION.md + RETROSPECTIVE R4. **Finding F1 (resolved):** stale local
  `.claude/` renders re-rendered via `aof work init`; `.claude/` is gitignored.

## Durable decisions & carry-forwards

<!-- The decisions a consuming UI milestone inherits. Full rationale in the ADRs. -->
- **Role split = the structural tool boundary** (ADR-001): the designer carries no `Bash` (judges a
  *handed* screenshot); QA has `Bash` (runs the harness + owns `toHaveScreenshot`). Orchestration is the
  only party that renders then hands off.
- **Verdict contract** (ADR-002): `CONFORMS`/`GAPS`/`INCONCLUSIVE`, closed; INCONCLUSIVE-when-no-baseline;
  render via `npx playwright` (NOT a `package.json` dep — build-time `@manual` browser confirmation).
- **Baseline source of truth** (ADR-003): a committed mock under `mocks/` when one exists; otherwise the
  mandatory binding checklist. No remote-link-only mock.
- **Documented defaults:** breakpoints **390/768/1280** (DESIGN-overridable); a11y default **WCAG 2.1 AA**
  (`work.ui.a11y.level` ∈ `A/AA/AAA`), axe-core via Playwright, opt-in via `a11y` in `work.tags.domains`
  (absent ≡ off); the `@design` domain was added to `work.tags.domains`.
- **Carried-forward obligation:** exercise the `@uat`/served-app residuals on the **first real UI
  consumer** (committed mock + served base URL) — home them in that milestone's verify or via
  `aof:add-uat`. See VERIFICATION `### Carried-forward obligation`.

## Verification

<!-- Pointers, not restatements. See VERIFICATION.md. -->
- **Accepted on machinery 2026-06-22** — `@executable` 990/0, 17 design-conformance arch-tests green,
  `validate 07` PASS, no blocker. Residuals carried forward (no served UI surface here).
- Feedback-for-retro graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R4) and archived from here.
