@cli @work @work-stream @executable @validate
Feature: The doc-bloat check-group flags a long-form context doc whose line count exceeds its per-artifact budget
  In order to catch an over-long SPEC.md / ARCHITECTURE.md / STORY.md that would poison every downstream agent's context before it spreads
  the doc-bloat check-group reads each item's recorded per-artifact line counts off the snapshot, compares each against the resolved per-kind budget, and emits a `doc-over-budget` warn finding anchored at the over-budget FILE naming its measured lines + the budget,
  so that an operator gets a deterministic context-budget health finding through the unchanged `aof work doctor` surface, while a doc within budget stays silent.

  # ADR-004: ONE machine code `doc-over-budget`, severity `warn` (the ONLY value
  # this group emits — no error tier), fired ONCE per over-budget artifact and
  # anchored at the over-budget FILE's raw absolute path (the SPEC.md /
  # ARCHITECTURE.md / STORY.md that is too long). The `message` names the artifact,
  # its measured line count, and the budget it exceeded.
  # ADR-005: the per-kind budgets are config-sourced (`budgetsFromConfig`); when no
  # `config.work.doctor.budgets` is set the DOCUMENTED DEFAULTS apply — SPEC.md 300,
  # ARCHITECTURE.md 700, STORY.md 150 — and these defaults are what every Examples
  # row below asserts against. (The config-override behaviour is feature 01.)
  # ADR-001 (inherited m15): the envelope is { code, severity, path, message }; an
  # empty findings array means healthy — silent within budget, no "ok" rows.
  # BOUNDARY CONVENTION (fixed here): the check fires on STRICTLY GREATER THAN budget
  # (measured lines > budget). A doc measuring EXACTLY its budget is healthy; a doc
  # one line over fires. Every Examples row's `#` states the relation.
  # ADR-002/003: the metric is LINES, counted from the snapshot's recorded per-artifact
  # line count (taken via `/\r?\n/` over text the snapshot already read). The fixtures
  # state each artifact's line count explicitly so every outcome is deterministic.
  # LITMUS: every Then asserts a `doc-over-budget` finding present/absent (its code +
  # severity, anchored at a named file) given a fixture line count + the default
  # budget — NEVER the envelope shape, the no-baked-literal guarantee, or determinism
  # (those are the milestone's ARCH-TESTS, not task scenarios).

  Background:
    Given a work stream loaded as a snapshot recording each item's per-artifact line counts for SPEC.md / ARCHITECTURE.md / STORY.md
    And the doc-bloat check-group run with the default budgets (SPEC.md = 300, ARCHITECTURE.md = 700, STORY.md = 150)

  # The clean baseline: a milestone (SPEC + ARCHITECTURE) and a story (STORY) all
  # within their default budgets emit nothing. A silent group over healthy artifacts
  # is the contract (ADR-001) — there are no "ok" rows.
  Scenario: a milestone and a story all within their default budgets produce no doc-over-budget finding
    Given a milestone whose SPEC.md is 124 lines and whose ARCHITECTURE.md is 631 lines
    And a story whose STORY.md is 81 lines
    When the doc-bloat check-group runs
    Then no doc-over-budget finding is reported

  # The per-kind boundary rows: an artifact of <kind> measuring <lines> against its
  # DEFAULT budget. The strictly-greater-than convention is fixed here — a doc AT its
  # budget is healthy, one line over fires. Each kind straddles its own boundary:
  # SPEC 300, ARCHITECTURE 700, STORY 150. The finding (when fired) is anchored at
  # that kind's file and names the measured lines + budget.
  Scenario Outline: an artifact over its default budget yields a doc-over-budget finding anchored at that file
    Given a "<kind>" artifact measuring <lines> lines
    When the doc-bloat check-group runs
    Then the finding outcome is "<finding>"

    Examples: SPEC.md — default budget 300
      | kind            | lines | finding                  | # relation to the 300-line budget
      | SPEC.md         | 412   | doc-over-budget / warn   | # 112 over → fires, anchored at SPEC.md
      | SPEC.md         | 301   | doc-over-budget / warn   | # 1 over the budget → fires
      | SPEC.md         | 300   | (none)                   | # exactly at budget → healthy (strictly-greater convention)
      | SPEC.md         | 299   | (none)                   | # 1 under budget → healthy

    Examples: ARCHITECTURE.md — default budget 700 (ADR logs legitimately grow)
      | kind            | lines | finding                  | # relation to the 700-line budget
      | ARCHITECTURE.md | 820   | doc-over-budget / warn   | # 120 over → fires, anchored at ARCHITECTURE.md
      | ARCHITECTURE.md | 701   | doc-over-budget / warn   | # 1 over the budget → fires
      | ARCHITECTURE.md | 700   | (none)                   | # exactly at budget → healthy
      | ARCHITECTURE.md | 699   | (none)                   | # 1 under budget → healthy

    Examples: STORY.md — default budget 150
      | kind            | lines | finding                  | # relation to the 150-line budget
      | STORY.md        | 210   | doc-over-budget / warn   | # 60 over → fires, anchored at STORY.md
      | STORY.md        | 151   | doc-over-budget / warn   | # 1 over the budget → fires
      | STORY.md        | 150   | (none)                   | # exactly at budget → healthy
      | STORY.md        | 149   | (none)                   | # 1 under budget → healthy

  # Only the long-form CONTEXT docs are budgeted. A non-context artifact (STATE.md,
  # VERIFICATION.md, RETROSPECTIVE.md, a `.feature` file) is NOT measured — even when
  # it is far longer than any budget, no doc-over-budget finding fires. The check
  # ignores artifacts outside the SPEC/ARCHITECTURE/STORY set.
  Scenario Outline: a long non-context artifact is not budgeted
    Given a milestone whose SPEC.md is 120 lines and whose ARCHITECTURE.md is 200 lines
    And a "<artifact>" in that item measuring <lines> lines
    When the doc-bloat check-group runs
    Then no doc-over-budget finding is reported

    Examples: non-context artifacts are exempt regardless of length
      | artifact          | lines | # why it is not budgeted
      | STATE.md          | 900   | # STATE.md is not a long-form context doc → exempt
      | VERIFICATION.md   | 1200  | # VERIFICATION.md is not budgeted → exempt
      | RETROSPECTIVE.md  | 800   | # RETROSPECTIVE.md is not budgeted → exempt
      | 00_some.feature   | 500   | # `.feature` files are not budgeted → exempt

  # Two over-budget artifacts in ONE milestone ⇒ TWO distinct findings, each anchored
  # at its own file (ADR-004: one finding per over-budget artifact; the file is the
  # anchor, so SPEC + ARCHITECTURE do not collapse to one folder finding).
  Scenario: a milestone whose SPEC.md and ARCHITECTURE.md are both over budget yields two distinct findings
    Given a milestone whose SPEC.md is 350 lines (over the 300-line budget)
    And whose ARCHITECTURE.md is 780 lines (over the 700-line budget)
    When the doc-bloat check-group runs
    Then a doc-over-budget warn finding is reported anchored at that milestone's SPEC.md
    And a doc-over-budget warn finding is reported anchored at that milestone's ARCHITECTURE.md
    And exactly two doc-over-budget findings are reported for that milestone
