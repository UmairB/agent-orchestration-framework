---
doc: verification
milestone: 39
verified: 2026-07-17
verifier: aof:verify
verdict: accept
---
<!--
  Milestone VERIFICATION.md — the verification record. Pointers, not restatements.
  Only sections with content are written (absence of a section is information — no @uat, no UI here).
-->
# 39 · Delivery Memory — Verification

Ref resolved via `aof work find 39 --json` → milestone `delivery-memory-outcome`, 4 stories, all
`in-review` at gate entry. Lanes in scope: **`@executable`** (the bulk) **+ `@manual`** (story
`01/task-01`, two scenarios — authored-at-Accept and product-state-vs-motive). There are **no `@uat`**
scenarios (no human step) and **no UI / `DESIGN.md`** surface (no design-conformance render). The
`@manual` lane here is unusual: it verifies `aof:verify`'s OWN Accept-time authoring behaviour, so it
was run inline by this verify pass — delegating it to a developer/evidence subagent would itself
violate the ADR-004 rule under test.

## Verification evidence

### Automated + fitness functions (no human)

- **`@executable` suite green** — `node scripts/test.mjs` → exit 0, **2659 ok / 0 not-ok** (zero
  `not ok` lines), plus the Rust `app/desktop` lanes green (`cargo test` 79 passed, `cargo check` ok).
  The 8 m39 traceability modules — `outcome-template`, `verify-authors-outcome`, `outcome-parse-records`,
  `capability-recall-surfaces`, `dangling-declaration-ff`, `gap-carries-discharge`,
  `promote-gap-to-chore`, `scope-flags-fields-agree` — are all green inside that total. *verifies →*
  `01/00`, `01/01` (its `@executable` rows), `02/00`, `02/01`, `03/00`, `03/01`, `04/00`.
- **All 6 m39 fitness functions armed + green** (each non-vacuous, with a planted-negative self-check):
  - `arch/39 ADR-001` `acd-outcome-record-frozen-shape` — `parseOutcome` records carry EXACTLY
    `MEMORY_RECORD_FIELDS`; `INDEX_VERSION === GRAPHIFY_INDEX_VERSION === 1` (no field added → no
    lockstep bump); a gap's `status ∈ {"", open, discharged}`. **ok**.
  - `arch/39 ADR-002` `acd-outcome-single-index-seam` — `buildRecords` is the single shared
    record-source both backends consume; the graphify backend defines no parser of its own. **ok**.
  - `arch/39 ADR-003` `acd-outcome-capability-ranking-bounded` — `TYPE_BOOST_CAPABILITY` (0.1) is
    asserted `< TITLE_BOOST_PER_TERM` (0.6) directly on the exported constants (the STATE-flagged fix:
    it now neutralises the signal it isolates, per 05/R2). **ok**.
  - `arch/39 ADR-004` `acd-outcome-authored-by-verify` — `recordDoc` never returns `OUTCOME.md`;
    `verify.md` is the only bundle prompt that authors it. **ok**.
  - `arch/39 ADR-005 (present)` `acd-outcome-dangling-declaration-present` — the honesty check is on
    disk and registered; non-optional now `parseOutcome` has landed (self-activates). **ok**.
  - `arch/39 ADR-005 (behaviour)` `acd-outcome-declared-field-has-producer` (story 04) — every
    `MEMORY_RECORD_FIELDS` field has a producer write-site; a planted producerless field (the
    `warnings_delivered` shape) trips the SAME detector; the record-format-only scope boundary is
    stated and asserted. **ok**. *verifies →* `04/00`.
- **Traceability + litmus (agent-only layer of `aof:validate`)** — the 7 m39 task features map 1:1 to
  the 8 m39 test modules, and the two new commands (`work:insert-chore`, `work:promote-gap`) are
  honestly registered across the registry guards `acd-work-command-cli-bijection`,
  `acd-work-command-route-coverage`, and `command-core-contract` — all green in the run above. Each
  scenario asserts an observable outcome (a shipped template byte, a parsed record's fields, a ranked
  order, a scaffolded chore, a red/green detector), not an implementation detail — litmus holds.

### Agent-run `@manual` (no human) — verify's own Accept-time authoring

Both `@manual` scenarios are `aof:verify`'s own behaviour (ADR-004), executed **inline** by this pass:

- **"OUTCOME.md is authored at Accept, never at insert"** — this pass instantiated
  `wiki/work/39_milestone_delivery-memory-outcome/OUTCOME.md` at the Accept juncture (the same point
  step 5/6 compacts STATE, triggers RETROSPECTIVE, and runs `memory ingest`), filled from the
  `Delivered`/`Assumptions`/`Gaps` template. The folder carried **no** `OUTCOME.md` before; it now
  holds one with 4 `## Delivered` capabilities, 3 `## Assumptions`, 3 `## Gaps`, and **no residual
  `<…>` angle-bracket placeholder** in any section (`grep` for `<…>` → NONE). *verifies →* `01/01`
  `@manual` scenario 1.
- **"product state, not motive"** (Scenario Outline) — the discriminator was applied to every entry.
  Recorded as **product state** (what the system now IS): e.g. the gap line *"no code path sets a gap's
  `status` to `discharged` when its chore completes"* — the canonical `warnings_delivered`-shape.
  **Kept out** (motive/reasoning → belongs in RETROSPECTIVE): the doc admits no *"we ran out of time to
  wire automated discharge"* (motive) and no *"we chose a bounded boost so ADR recall stays unchanged"*
  (reasoning) — the Delivered lines state the product fact (`TYPE_BOOST_CAPABILITY` 0.1 `<` 0.6), never
  the rationale. *verifies →* `01/01` `@manual` scenario 2.

### Live "indexed AND surfaced" proof (the milestone's load-bearing bar)

Beyond the fixture-based `@executable` calibration gate, the full loop was exercised against the **real**
index, not a fixture. `aof work memory reindex` → **358 records** (the live corpus plus the
freshly-authored OUTCOME records). Then:

- **Unscoped capability query** `"what provides delivery recall over adrs"` → the capability record
  *"Delivery is recallable over the ADRs"* returns **#1**, ahead of four `adr` records (including the
  seal-adjacent ADRs the original defect surfaced). This is the SPEC's central risk met **live**:
  *"indexing the doc and still getting four ADRs back is a failure of this milestone."*
- **`recall --status open --item 39`** → exactly the **3 open gaps**; no `capability` (status `""`) and
  no `adr` (status `Accepted`) leaks in — the reused `status` field + the new scope flag fire live.
- The 4 `capability` + 3 `gap` records all carry `area="delivery"` and the correct status mapping
  (capability `""`, gap `open`) — the milestone now recalls its OWN delivery (dogfood loop closed).

### Gate

- **`aof work validate 39` → PASS** (exit 0, "39 is well-formed") — folder↔frontmatter, closed tag
  vocabulary, depends graph, all clean for the milestone and its 4 stories. The co-present `OUTCOME.md`
  (no identity frontmatter) is **not** flagged as a missing/empty record doc — the story `01/01`
  `@executable` guarantee, confirmed live.
- **Whole-stream `aof work validate` → PASS** ("work stream is well-formed") — no environmental /
  pre-existing findings this pass.

## Prevention boundary (ADR-006 — stated explicitly, as required)

This milestone must **not** be sold — here or anywhere — as preventing the class of bug that produced
it. An `OUTCOME.md` is authored at Accept, **after** any fiction is already committed. What it delivers
is (1) **visibility** — the author must type "no production path populates this field", a real forcing
function; and (2) **non-compounding** — recall can now answer "what provides X", so the *next* milestone
does not inherit the blind spot that produced `warnings_delivered`. Genuine **prevention** of a dangling
field in the authoring milestone is the story-04 fitness function
(`acd-outcome-declared-field-has-producer`) **alone** — and only for the record-format-field class it
honestly scopes to; CLI flags, HTTP endpoints, and config keys remain uncovered (recorded as an open
OUTCOME gap). Recall makes fiction visible; it does not prevent it.

## Findings

No new defect surfaced at verify. The build/craft-review gate found and fixed 12 issues (1 MAJOR + a
cluster of robustness bugs the happy-path suite missed — recorded in STATE `## Feedback`, graduating to
`RETROSPECTIVE.md` this pass). The three honestly-declared boundaries — automated gap discharge has no
producer; dangling-declaration coverage is record-format-fields only; per-capability assumption
attribution is unexpressed — are **not defects**: they are recorded as schedulable `## Gaps` in the
milestone `OUTCOME.md` (each `status: open` with a discharge condition), which is exactly the
"a gap is a debt, not a note" mechanism this milestone ships. **No blocker finding is open.**

## Accept decision

**ACCEPT.** Both lanes in scope are satisfied: the `@executable` suite is green (2659 ok / 0 not-ok)
with all 6 m39 fitness functions armed and non-vacuous; the two `@manual` scenarios are met by this
pass's own Accept-time authoring of a placeholder-free, product-state-only `OUTCOME.md`; the live
"indexed AND surfaced" loop returns the capability #1 over four ADRs against the real 358-record index;
and both scoped and whole-stream `aof work validate` PASS. No `@uat` lane and no UI surface exist, so no
human sign-off and no design-conformance review apply. No blocker finding is open — the three declared
boundaries are schedulable OUTCOME gaps, not defects. All four stories (`39/01`, `39/02`, `39/03`,
`39/04`) are accepted → `done`; the milestone is accepted.
