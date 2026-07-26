<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — validateWork flags any item whose `schema` is behind the current
# WORK_ITEM_SCHEMA_VERSION (an unstamped item reads as schema 0, ADR-003) as a
# STALENESS finding whose message names `aof upgrade` as the remedy, while an item AT
# the current schema is left clean and an up-to-date stream stays green.
# LITMUS: every Then is confirmable from `aof work validate --json` over the fixture
# stream — the CLI `--json` face (commands/validate.mjs) emits a BARE array of
# `[{path, problem}]`, each `path` relativised to cwd. A staleness finding is an entry
# whose `path` is the behind item's record doc and whose `problem` string NAMES the
# literal `aof upgrade`. There is no dedicated `type`/`remedy` field on a finding — the
# staleness class and its named remedy both ride the `problem` message, exactly the
# shape ADR-006 specifies. The seam is validateWork (work.mjs:574): the new finding
# class lands INSIDE the existing deterministic pass (folder↔frontmatter / tags /
# depends graph), derived from the item's `schema` frontmatter compared to the story-01
# constant WORK_ITEM_SCHEMA_VERSION (initial value 1 — schema 1 IS the current shape).
# No source read anywhere; the fixture is a throwaway stream, never the live repo.
# The CODE-dependency half of ADR-005 (validate must not `import work-upgrade.mjs`) is a
# WHITE-BOX claim owned by the fitness function `acd-upgrade-engine-blast-radius` — out
# of black-box scope here. These scenarios confirm only the OBSERVABLE half of the
# determinism/dep-01-only cut: the message names the command, enumerates no pending
# transforms, and the `--json` output is stable across runs.

@cli @work @validate @executable
Feature: aof work validate reports any item whose schema is behind the current WORK_ITEM_SCHEMA_VERSION as a staleness finding that names aof upgrade
  In order that a stale stream is visibly stale instead of silently tolerated — so silence stops being indistinguishable from "up to date", which is exactly how drift goes unnoticed until it breaks
  aof work validate must flag every item whose schema (an unstamped item read as 0, ADR-003) is below the current WORK_ITEM_SCHEMA_VERSION, naming `aof upgrade` as the remedy, while leaving an at-current item and an up-to-date stream clean

  Background:
    Given a fixture work stream whose current WORK_ITEM_SCHEMA_VERSION is 1
    And every existing item in the stream is stamped `schema: 1` at the current schema and is otherwise well-formed

  # Headline: an item BEHIND the current schema is flagged; an item AT it is not. An
  # unstamped item (no `schema` key) reads as schema 0 (ADR-003), so it is behind. The
  # staleness finding is self-identifying: it is the entry whose `problem` names
  # `aof upgrade` on the item's own record doc.
  Scenario Outline: an item whose schema is below the current WORK_ITEM_SCHEMA_VERSION is flagged; an item at the current schema is not
    Given the fixture also contains an otherwise-well-formed item whose record-doc frontmatter has <schema-frontmatter>
    When I run `aof work validate --json` over the fixture stream
    Then the `--json` findings <outcome> an entry whose `path` is that item's record doc and whose `problem` names `aof upgrade`

    Examples:
      | schema-frontmatter | outcome        |
      | schema: 0          | include        |
      | (no schema key)    | include        |
      | schema: 1          | do not include |

  # The remedy is a STRING LITERAL in the finding message (ADR-006) — "how do I fix
  # this" resolves to the command `aof upgrade`, not to prose the reader must hunt for.
  Scenario: the staleness finding names aof upgrade as the remedy in its message
    Given the fixture also contains an otherwise-well-formed unstamped item (read as schema 0, behind the current schema)
    When I run `aof work validate --json` over the fixture stream
    Then the `--json` findings contain an entry on that item's record doc whose `problem` string contains the literal `aof upgrade`
    And that same `problem` string identifies the item as behind the current schema

  # An up-to-date stream is silent for the RIGHT reason now: every item is stamped at
  # the current schema, so there is genuinely nothing to report — no false staleness.
  Scenario: a stream whose every item is stamped at the current schema produces no staleness finding
    Given no item behind the current schema is added to the fixture
    When I run `aof work validate --json` over the fixture stream
    Then no finding's `problem` names `aof upgrade`
    And the `--json` findings are empty across the fixture stream

  # Determinism / dep-01-only (observable half, ADR-005): the staleness finding is
  # derived from the item's `schema` frontmatter + the work.mjs constant ALONE. It
  # names the command but does NOT enumerate WHICH transforms are pending (that is
  # `aof upgrade --dry-run`, story 02) and needs no registry — so the message carries
  # no transform count/list/id, and the output is stable run-to-run.
  Scenario: the staleness finding is deterministic and names the command without enumerating pending transforms
    Given the fixture also contains an otherwise-well-formed unstamped item (read as schema 0, behind the current schema)
    When I run `aof work validate --json` over the fixture stream twice
    Then both runs emit byte-identical `--json` findings
    And the staleness finding's `problem` names `aof upgrade` but contains no count, list, or id of pending transforms
    And no finding's `problem` names `aof upgrade --dry-run`
