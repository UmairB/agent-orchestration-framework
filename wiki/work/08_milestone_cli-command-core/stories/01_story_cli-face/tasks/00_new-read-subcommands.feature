@cli @work @work-stream @executable
Feature: aof work doc and aof work tasks are first-class CLI subcommands over the command core
  In order that every operation the board exposes is also runnable from the terminal (the command->CLI bijection)
  the CLI gains thin `work doc <ref> <DOC>` and `work tasks <ref>` subcommands, each a thin argv -> command -> result -> render / --json,
  so that the doc and tasks reads — bespoke in the board until now — are reachable from the CLI through the same registered commands, not a second call site.

  # ADR-003: workCommand (cli.mjs) gains two NEW thin read subcommands that map
  # argv -> the same input the board maps from query, invoke the registry, and
  # render the result. `aof work doc <ref> <DOC>` (DOC in {SPEC, STORY,
  # VERIFICATION, RETROSPECTIVE}); `aof work tasks <ref>`. Both honour --json
  # (machine-readable result) and a human render. Paths in the CLI face project
  # against cwd (ADR-002), but doc/tasks results carry no displayable path so the
  # projection is moot here. The resolver is the command's (resolveItem,
  # slug-fallback tolerated) — these are reads. These subcommands are NEW, so
  # there is no historical CLI output to preserve; the contract is "they run, and
  # surface what the command returns".
  Background:
    Given a work-stream fixture with a milestone "08" that has a "SPEC.md" but no "RETROSPECTIVE.md"
    And a story "08/00" whose tasks dir holds two ".feature" files
    And I am positioned to run the aof CLI against that fixture

  # --- aof work doc ---------------------------------------------------------

  # The new subcommand prints the requested doc's body for a present doc, exit 0.
  Scenario: aof work doc prints a present doc body
    When I run "aof work doc 08 SPEC"
    Then the command exits 0
    And stdout contains the milestone's SPEC.md body

  # --json surfaces the command result the board also consumes: { ref, doc,
  # present, body } as pure parseable JSON, no human chrome on stdout.
  Scenario: aof work doc --json emits the command result as pure JSON
    When I run "aof work doc 08 SPEC --json"
    Then the command exits 0
    And the entire stdout parses as JSON in a single pass
    And the JSON reports ref "08", doc "SPEC", and present true

  # A missing doc is absent-not-error: present:false, exit 0 — the CLI inherits the
  # command's ENOENT path, never a crash.
  Scenario: aof work doc on an absent doc reports present:false and exits 0
    When I run "aof work doc 08 RETROSPECTIVE --json"
    Then the command exits 0
    And the JSON reports present false with an empty body

  # An unknown DOC name is rejected (the command's input contract) rather than
  # silently reading a wrong file.
  Scenario: aof work doc rejects an unknown doc name
    When I run "aof work doc 08 NONSENSE"
    Then the command exits non-zero
    And stderr names the unknown document

  # --- aof work tasks -------------------------------------------------------

  # work tasks lists a story's parsed scenarios; --json emits the { ref, tasks }
  # command result.
  Scenario: aof work tasks --json lists a story's tasks
    When I run "aof work tasks 08/00 --json"
    Then the command exits 0
    And the entire stdout parses as JSON in a single pass
    And the JSON reports ref "08/00" with one task entry per ".feature" file

  # A story with no tasks dir is absent-not-error: an empty tasks list, exit 0.
  Scenario: aof work tasks on a story with no tasks dir is an empty list, exit 0
    Given a story "08/01" with no tasks dir
    When I run "aof work tasks 08/01 --json"
    Then the command exits 0
    And the JSON reports an empty tasks list

  # An unresolved ref is a non-zero exit (ref-not-found on stderr), distinct from a
  # resolved story with no tasks dir (empty list, exit 0 above).
  Scenario: aof work tasks on an unresolved ref exits non-zero
    When I run "aof work tasks 99"
    Then the command exits non-zero
    And stderr reports that no item resolves to the ref
