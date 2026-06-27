@cli @work @work-stream @executable @validate
Feature: The doc-bloat budget is config-sourced — the same artifact flips finding↔no-finding across configured budgets
  In order to tune the context-budget per project rather than ship a baked-in constant
  the doc-bloat check-group resolves each per-kind budget from `config.work.doctor.budgets` (defaulting per kind when a key is absent) and compares each recorded line count against the RESOLVED budget,
  so that the SAME over-length artifact warns under a low configured budget and stays silent under a high one, an unset budget falls back to the documented default, and a partially-set `budgets` leaves the other kinds on their defaults.

  # ADR-005: the budget is config-sourced via `budgetsFromConfig(config)` reading
  # `config.work.doctor.budgets = { spec, architecture, story }` and substituting the
  # DOCUMENTED DEFAULTS (SPEC.md 300, ARCHITECTURE.md 700, STORY.md 150) for any
  # ABSENT key. The budget NUMBER lives only in the resolver — never baked into the
  # group body. These scenarios PROVE config-sourcing behaviourally: one artifact,
  # one line count, finding↔no-finding flipped purely by the configured budget.
  # ADR-006: a partially-set `budgets` (one key present) leaves the unset kinds on
  # their defaults — `budgets.spec` set does not change the architecture / story
  # budgets, which stay at 700 / 150.
  # ADR-004: when fired, the finding is `doc-over-budget` / `warn`, anchored at the
  # over-budget file.
  # BOUNDARY CONVENTION (inherited from feature 00): fires on measured lines > budget;
  # a doc at exactly its (configured) budget is healthy.
  # LITMUS: every Then asserts a `doc-over-budget` finding present/absent given a fixed
  # artifact line count + a STATED configured/defaulted budget — NEVER the absence of a
  # baked-in literal or the resolver's source shape (those are the config-sourced
  # ARCH-TEST, not a task scenario). The fixtures state every line count and budget so
  # the outcome is deterministic.

  Background:
    Given a work stream loaded as a snapshot recording each item's per-artifact line counts

  # The headline flip: ONE 400-line SPEC.md, run twice with different configured
  # `work.doctor.budgets.spec`. A budget below 400 fires; a budget at-or-above 400 is
  # silent. Same artifact, same line count — only the configured budget changes the
  # outcome, which is exactly what "read from config, not baked" means observably.
  Scenario Outline: the same over-length SPEC flips finding↔no-finding across configured budgets
    Given a milestone whose SPEC.md is 400 lines
    And config.work.doctor.budgets.spec is <budget>
    When the doc-bloat check-group runs
    Then the finding outcome is "<finding>"

    Examples: one 400-line SPEC.md against varying configured spec budgets
      | budget | finding                  | # relation of the 400-line SPEC to the configured budget
      | 300    | doc-over-budget / warn   | # budget below 400 → SPEC over budget → fires
      | 399    | doc-over-budget / warn   | # 1 under the line count → still over → fires
      | 400    | (none)                   | # budget equals line count → at budget → healthy (strictly-greater)
      | 401    | (none)                   | # budget 1 above line count → within budget → silent
      | 500    | (none)                   | # budget well above 400 → within budget → silent

  # Absent config ⇒ the documented defaults apply. With NO `work.doctor.budgets` at
  # all, each kind resolves to its default (SPEC 300, ARCHITECTURE 700, STORY 150).
  # A SPEC over 300 fires; one under does not — proving the default, not OFF, is the
  # fallback (absent ≡ defaults, ADR-005).
  Scenario Outline: with no work.doctor.budgets configured the documented default applies
    Given no config.work.doctor.budgets is set
    And a "<kind>" artifact measuring <lines> lines
    When the doc-bloat check-group runs
    Then the finding outcome is "<finding>"

    Examples: defaults — SPEC 300 / ARCHITECTURE 700 / STORY 150
      | kind            | lines | finding                  | # relation to the resolved DEFAULT budget
      | SPEC.md         | 350   | doc-over-budget / warn   | # over the default 300 → fires
      | SPEC.md         | 250   | (none)                   | # under the default 300 → silent
      | ARCHITECTURE.md | 750   | doc-over-budget / warn   | # over the default 700 → fires
      | ARCHITECTURE.md | 650   | (none)                   | # under the default 700 → silent
      | STORY.md        | 200   | doc-over-budget / warn   | # over the default 150 → fires
      | STORY.md        | 120   | (none)                   | # under the default 150 → silent

  # Partial config ⇒ the other kinds keep their defaults. `budgets.spec` is set HIGH
  # (1000) while `architecture` and `story` are UNSET — so an over-default SPEC is now
  # silent (its budget is raised to 1000) while an over-default ARCHITECTURE / STORY
  # still fires on its untouched default (700 / 150). One key set never moves another.
  Scenario Outline: a partial budgets config leaves unset kinds on their defaults
    Given config.work.doctor.budgets.spec is 1000 with architecture and story unset
    And a "<kind>" artifact measuring <lines> lines
    When the doc-bloat check-group runs
    Then the finding outcome is "<finding>"

    Examples: spec raised to 1000; architecture (default 700) and story (default 150) untouched
      | kind            | lines | finding                  | # relation to the EFFECTIVE budget for that kind
      | SPEC.md         | 900   | (none)                   | # over the old default 300 but under the configured 1000 → silent
      | SPEC.md         | 1001  | doc-over-budget / warn   | # over the configured 1000 → still fires above its raised budget
      | ARCHITECTURE.md | 800   | doc-over-budget / warn   | # architecture unset → default 700 unchanged → 800 over → fires
      | STORY.md        | 200   | doc-over-budget / warn   | # story unset → default 150 unchanged → 200 over → fires
      | STORY.md        | 140   | (none)                   | # story unset → default 150 unchanged → 140 under → silent
