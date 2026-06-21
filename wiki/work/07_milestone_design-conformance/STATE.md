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

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- **Broken down 2026-06-21** (`aof:refine 07 --autonomous`) → `in-progress`. Three independent stories,
  decoupled by the frozen responsibility-split contract (ARCHITECTURE.md ADR-001):
  - `00_designer-fidelity-judge` — `not-started` (owns `src/bundle/agents/aof-designer.md`)
  - `01_qa-browser-harness` — `not-started` (owns `src/bundle/agents/aof-qa.md` + `work.ui.a11y` schema)
  - `02_review-wiring-and-convention` — `not-started` (owns `refine`/`verify`/`continue` + DESIGN
    template + drift guard)
  - Contracts authored for all three (Three Amigos, fanned out in parallel — the stories are independent
    by construction). Next: `aof:continue 07`.
- **Build started 2026-06-21** (`aof:continue 07`). All three stories → `in-progress`. Orchestrated build
  in two waves: **Wave 1** (3 parallel `aof-developer`s) authors the disjoint bundle content + each
  story's exclusive arch-test (designer body; QA body + `work.ui.a11y` schema + `acd-a11y-config-schema`;
  commands + DESIGN template + `acd-design-template-baseline`). **Wave 2** (one integrator) authors the
  three CROSS-CUTTING arch-tests (`acd-design-role-split`, `acd-conformance-verdict-contract`, the NEW
  `acd-design-conformance-bundled` drift guard — each reads assets owned by >1 story), wires all five new
  arch-tests into `scripts/test.mjs`, and regenerates the derived `manifest.json` once (the only
  co-touched artifact, ADR-005/006). Split chosen because production files are disjoint but those three
  test files + the runner + the manifest are genuinely co-touched — so the cut is parallel-build but
  serial-integrate, not 3 blind worktrees.
- **Built + reviewed 2026-06-21** (`aof:continue 07`). All three stories `in-review`; every task `@executable`
  scenario green. Landed: the bundled designer (read-only judge, no `Bash`), QA (harness + `toHaveScreenshot`
  + opt-in a11y), `refine`/`verify`/`continue` (render→hand-off→spawn-QA, 390/768/1280 breakpoints,
  INCONCLUSIVE-without-baseline), the DESIGN template (committed-`mocks/` + mandatory binding checklist),
  the closed `work.ui.a11y` schema block, and **five new fitness functions** wired into `scripts/test.mjs`
  (`acd-design-role-split`, `acd-conformance-verdict-contract`, `acd-design-template-baseline`,
  `acd-a11y-config-schema`, `acd-design-conformance-bundled` — the drift guard, with a self-test proving it
  trips on a removed marker). Manifest regenerated (derived). Full suite green.
  - **Review verdicts.** *Architect (structural):* PASS — zero ADR violations; the role-split tool boundary
    is structural and the five fitness functions are load-bearing (the drift-guard self-test + the
    manifest-hashes guard both proved they catch real drift). *QA (behavioural):* PASS after fixes — every
    `@executable` scenario/Examples row now has a backing assertion. *Craft:* PASS — no malformed tags, valid
    schema JSON, sound greps. **Fixes applied at review:** closed three `@executable` traceability gaps
    (the QA a11y-contract markers `01/02`; refine obligations 3–4 `02/00`; the no-renderable-Route→INCONCLUSIVE
    clause `02/01`), tightened one loose `infer` proxy to the full phrase, revived a dead OR-branch in the
    template-baseline test, and noted the bare-`a11y` domain token in the schema. A reported "manifest stale /
    suite RED" finding was a **transient artifact** of the architect's concurrent adversarial mutation
    (revert restored green) — confirmed not a shipped defect (independent re-run: manifest guards green, no
    bundle file changed).

- **Verified — ACCEPTANCE HELD 2026-06-21** (`aof:verify 07`). See `VERIFICATION.md`. Deliverable fully green:
  `@executable` suite + all five new fitness functions (798 ok / 0 not-ok), `aof work validate` PASS, live-state
  `@manual` paths confirmed (no-baseUrl → INCONCLUSIVE; a11y-off → no-run). Design-render step **N/A** (07 owns
  no DESIGN.md / UI surface — it edits the DESIGN *template*). The served-app `@manual` + the one `@uat`
  (judgment quality on a real rendered surface) are **un-exercisable** here (machinery-only, no served UI /
  baseline / browser) → **deferred to the first real UI milestone that consumes the loop**. **Operator chose to
  HOLD** acceptance (not accept on the structural suite alone): 07 stays `in-progress`, stories stay `in-review`,
  no retro run. **Finding F1 (resolved):** local `.claude/` renders were stale (pre-lift designer fallback);
  re-rendered via `aof work init` (live agents now match the upgraded bundle; lock records the install). Re-run
  `aof:verify 07` once a live render + `@uat` can be exercised.

## Feedback (for retro)

<!-- Mistakes, blockers, contract problems surfaced during build/review. Triaged + distilled into
     RETROSPECTIVE.md at aof:verify, then archived. -->

- **Manifest regen is a manual habit (ADR-005 near-miss, process).** The derived `src/bundle/manifest.json`
  must be regenerated by `scripts/generate-bundle-manifest.mjs` after every bundle-body edit; ADR-005 leaves
  this as a developer habit caught only by `acd-bundle-manifest-hashes` going RED. It was handled correctly
  this build (regenerated before the suite ran green), but the architect flagged that a stale derived artifact
  is easy to ship by forgetting the step. Worth considering: an enforced boundary — a generator `--check`
  mode wired into the test run that fails loudly (or auto-regenerates) so a stale manifest cannot be committed.
- **Cross-cutting test files break pure story parallelism (build-orchestration note).** Three of the six
  fitness functions read assets owned by >1 story (`acd-design-role-split`, `acd-conformance-verdict-contract`,
  `acd-design-conformance-bundled`), and `scripts/test.mjs` + the manifest are co-touched. ADR-006 frames the
  stories as independent "by construction" on disjoint *production* files, but the *test* layer is genuinely
  serial-integrate. The two-wave build (parallel bundle content → one integrator for the cross-cutting tests
  + wiring + manifest) handled it cleanly; future UI/bundle milestones should expect the same parallel-build /
  serial-integrate shape and plan the integrator wave up front rather than discovering the coupling mid-fan-out.
- **Adversarial fitness-function review needs an isolated tree.** The structural reviewer mutated bundled
  assets in-place to prove the guards trip while other reviewers ran concurrently, producing a spurious
  "suite RED" reading. Worktree-isolating an adversarial reviewer (or having it mutate in-memory copies, as
  the drift-guard's own self-test does) would avoid the false alarm.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- **Origin (2026-06-21).** Framed after a working session diagnosing why the designer is poor at
  verifying designs: it has neither a committed mock nor a rendered screenshot to compare against
  (milestone 03's mock is a remote claude.ai/design artifact the read-only designer can't open, and
  `work.ui.baseUrl` is unset so the review falls back to inferring from code).
- **Decided in-session (pre-stories, to be confirmed at refine):**
  - "Looks right" = designer's job (fidelity vs mock/checklist); "works right" = QA's job. `browser-qa`
    (from the ecc repo) bundles both; ACD unbundles along its existing contract seam.
  - Designer JUDGES from a screenshot (stays read-only); QA RUNS the browser harness and owns the
    `toHaveScreenshot` regression that enforces the baseline the designer approved.
  - `INCONCLUSIVE`-without-baseline is the right verdict when no mock/checklist exists (independently
    arrived at by ecc's `browser-qa`) — refuse and flag, don't guess.
  - a11y → QA lane, optional, opt-in via `work.tags.domains` containing `a11y` (absent ≡ off).
- **Reference:** research notes on the ecc repo (`github.com/affaan-m/ecc`) — its `browser-qa`,
  `design-system`, and `frontend-design-direction` skills informed the verdict structure, breakpoints,
  and the INCONCLUSIVE rule.
- **Decided at refine (architect, ARCHITECTURE.md ADR-001..006; confirmed the in-session decisions
  above).** The seam = the **structural tool boundary**: the designer agent carries no `Bash` (can't run
  a browser → judges a *provided* screenshot), QA has `Bash` (runs the harness). The breakdown's only
  cross-story co-touch is the **derived `manifest.json`** (regenerated by `scripts/generate-bundle-manifest.mjs`,
  guarded by the existing `acd-bundle-manifest-hashes`) — the m03 shared-`server`-handle analogue.
- **Documented-default decisions taken at refine** (non-blocking; recorded per `--autonomous`):
  - **Breakpoints** for the render = **390 / 768 / 1280** (mobile / tablet / desktop), per-milestone
    DESIGN-overridable.
  - **a11y level** default = **WCAG 2.1 AA** (`work.ui.a11y.level` ∈ `A`/`AA`/`AAA`, `AA` default);
    **tooling** = axe-core injected via Playwright.
  - **Playwright** is invoked **on-demand via `npx`** (`npx playwright screenshot …`) and is **NOT** added
    to `package.json` — browser availability is a build-time `@manual` confirmation, not a refine blocker
    or a hard dependency. (A real render + judgment quality + a real a11y run are `@manual`/`@uat`.)
  - **Tag vocabulary:** added domain **`@design`** to `work.tags.domains` in `.aof/aof.config.json` (the
    per-milestone domain, as `@board`/`@memory`/`@round-trip` were added). m07 scenarios tag
    `@cli @assets @design` + a verification lane. (Did NOT add the `a11y` opt-in domain — aof is building
    the lane, not enabling it on its own board.)
- **No early stop.** No genuine blocking unknown or unsafe/irreversible decision surfaced — every scope
  item decomposes into additive, reversible changes (bundle text edits, one additive *closed* schema
  block, new fitness tests). Memory recall ran per the refine process and returned an **empty block**
  (backend `none` in this repo) — nothing prior to surface, proceeded unchanged.
- **Contracts authored (Three Amigos, 2026-06-21).** 9 task `.feature` files across the 3 stories (55
  scenarios). PO wrote the headline scenarios; `aof-qa` added the Examples/case matrices (the a11y schema
  boundary table mirroring `acd-headroom-config-schema`; the 2³ INCONCLUSIVE decision table; the
  GAP-shape rubric; the drift-guard self-test); `aof-developer` confirmed feasibility (incl. an Ajv-2020
  prototype proving every a11y schema row fires as written). PO rulings on the five amigo questions:
  (1) the INCONCLUSIVE truth-table is **behaviour → `@manual`** (the grep-confirmable rule *statements*
  stay `@executable`); (2) the designer owns "handed no screenshot → INCONCLUSIVE", the orchestration
  owns "no baseUrl/Route/render → INCONCLUSIVE"; (3) `work.ui.a11y.level` is **enum-only** `["A","AA","AAA"]`
  (the `work.headroom.mode` precedent); (4) a surface with no renderable `Route` collapses into the
  no-render INCONCLUSIVE driver (named, not a separate branch); (5) story 02's `@manual` "served app
  reaches a verdict" (orchestration observable) is distinct from story 00's `@uat` (judgment quality) —
  both kept. `aof work validate` PASS; lane audit PASS (every scenario carries exactly one lane).
- **Carry-forward to build (`aof:continue 07`) — surfaced by the dev feasibility leg, not contract
  problems):**
  - **Story 00 lift:** the prototyped `.claude/agents/aof-designer.md` still carries the *"otherwise read
    the component code and infer (weaker)"* fallback that **ADR-002 demotes** — the lift into
    `src/bundle/` must **remove/demote** it, else it conflicts with the `acd-conformance-verdict-contract`
    "never guesses from code" assertion.
  - **Story 01 authoring:** `.claude/agents/aof-qa.md` currently has **no** harness/`toHaveScreenshot`/
    a11y markers — story 01 authors them fresh in the bundle (the intended cross-story marker rollup that
    `acd-design-conformance-bundled` greps).
  - **All stories:** after editing any bundle body, **regenerate** `src/bundle/manifest.json` via
    `scripts/generate-bundle-manifest.mjs` and **wire** each new arch-test into `scripts/test.mjs` (the
    runner imports each explicitly).

## Verification

<!-- Pointers, not restatements. See VERIFICATION.md. -->
- [x] `@executable` suite green (798 ok / 0 not-ok)
- [x] Fitness functions green (5 new + existing manifest guard)
- [ ] `@manual` / `@uat` — deferred to first real UI consumer (no served surface here); acceptance **held**
