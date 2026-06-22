@cli @work @work-stream @executable
Feature: work:doc and work:tasks read an item's docs and tasks with slug-tolerant resolution and absent-not-error
  In order to move the board's bespoke doc/tasks reads into the one source of truth
  the work:doc and work:tasks commands resolve a ref (exact-preferred, slug-fallback tolerated), read the requested doc / the story's task features, and treat a missing file or tasks dir as absent rather than an error,
  so that both faces get identical read behaviour from the command instead of the board carrying its own handleDoc / handleTasks logic.

  # ADR-002/003: handleDoc and handleTasks move OUT of board-ui.mjs INTO
  # src/commands/doc.mjs + src/commands/tasks.mjs. These are READ commands, so they
  # resolve with resolveItem — exact ref preferred, but a free-text slug fallback is
  # tolerated (the read routes always allowed it; the WRITE command does not — see
  # 03_feedback-write-command). work:doc returns { ref, doc, present, body }; a
  # missing file is present:false with an empty body (today's ENOENT path), NOT a
  # 404. work:tasks returns { ref, tasks: [...] } parsed from <dir>/tasks/*.feature
  # (sorted), each task carrying its scenarios + per-lane counts; a missing tasks/
  # dir is an empty tasks array, not an error. An unresolved ref IS an error
  # (ref-not-found) — that is the resolver's null, distinct from absent content.
  Background:
    Given a work-stream fixture with a milestone "08" whose folder slug is "cli-command-core"
    And the milestone has a "SPEC.md" but no "RETROSPECTIVE.md"
    And a story "08/00" whose tasks dir holds two ".feature" files
    And the command registry loaded in-process

  # --- work:doc -------------------------------------------------------------

  # A present doc is returned with present:true and its verbatim body — the doc
  # name maps to its on-disk filename (SPEC->SPEC.md, etc.).
  Scenario: work:doc returns a present doc with its verbatim body
    When I invoke "work:doc" with ref "08" and doc "SPEC"
    Then the result reports ref "08", doc "SPEC", and present true
    And the result body equals the contents of the milestone's SPEC.md

  # A doc that does not exist on disk is absent-not-error: present:false and an
  # empty body, with a 200-equivalent success (no thrown error) — today's ENOENT
  # behaviour, now owned by the command.
  Scenario: a missing doc is present:false with an empty body, not an error
    When I invoke "work:doc" with ref "08" and doc "RETROSPECTIVE"
    Then the result reports present false
    And the result body is the empty string
    And the command does not raise an error

  # The read command tolerates a slug fallback: a free-text ref that is not an
  # exact id still resolves to the matching item (resolveItem's slug match).
  Scenario: work:doc resolves a free-text slug to the matching item
    When I invoke "work:doc" with ref "cli-command-core" and doc "SPEC"
    Then the result resolves to the "08" milestone
    And the result reports present true

  # A ref that resolves to nothing is an error distinct from absent content — the
  # caller turns this into the board's 404 / the CLI's failure.
  Scenario: a ref that resolves to no item raises ref-not-found
    When I invoke "work:doc" with ref "99" and doc "SPEC"
    Then the command raises a "ref-not-found" error
    And no doc body is returned

  # An unknown doc NAME is a distinct input-contract failure (invalid-doc) — the
  # command-level origin of the board's 400 invalid-doc and the CLI's rejection;
  # not to be confused with an absent-but-valid doc (present:false above).
  Scenario: an unknown doc name is rejected as invalid-doc, distinct from a missing doc
    When I invoke "work:doc" with ref "08" and doc "NONSENSE"
    Then the command raises an "invalid-doc" error
    And the failure is distinct from the present:false result an absent valid doc returns

  # --- work:tasks -----------------------------------------------------------

  # A story's tasks are its <dir>/tasks/*.feature files, parsed server-side into
  # scenarios + per-lane counts, in sorted filename order.
  Scenario: work:tasks lists a story's parsed feature scenarios with lane counts
    When I invoke "work:tasks" with ref "08/00"
    Then the result reports ref "08/00"
    And the result tasks list one entry per ".feature" file in sorted order
    And each task entry carries its feature title, its scenarios, and per-lane counts for executable, manual, and uat

  # A story with no tasks dir is absent-not-error: an empty tasks array, not a
  # thrown error (mirrors work:doc's ENOENT path).
  Scenario: a missing tasks dir yields an empty tasks list, not an error
    Given a story "08/01" with no tasks dir
    When I invoke "work:tasks" with ref "08/01"
    Then the result reports an empty tasks list
    And the command does not raise an error

  # An unresolved ref is an error (ref-not-found), distinct from a resolved item
  # with no tasks dir (empty list above) — the same absent-vs-unresolved split as
  # work:doc.
  Scenario: work:tasks on a ref that resolves to no item raises ref-not-found
    When I invoke "work:tasks" with ref "99"
    Then the command raises a "ref-not-found" error
    And no tasks list is returned
