@cli @work @scaffold @executable
Feature: migrate converts a source folder into a managed aof work item under the stream
  In order to adopt work that already exists on a codebase without restarting it from scratch
  the system must turn a source folder into a real, managed milestone item — SPEC (+ stories + tasks) —
  that lands under work.dir, resolves through "aof work find", and passes "aof work validate".

  # The CORE seam (STORY.md hint 1): folder in -> a full aof SPEC + stories + tasks out. Unlike import,
  # whose output is a read-only AOF.md knowledge digest (that contrast is task 01), migrate's output is a
  # MANAGED work item — refinable / continuable / verifiable — so it must be a first-class member of the
  # work stream: a numbered milestone folder under work.dir whose SPEC.md / STATE.md satisfy the same
  # folder<->frontmatter contract every other item does, and whose substructure (stories, task .features)
  # is scaffolded from what the source presents.
  #
  # The command registers in the frozen Command core with the { id, input, run, cli } shape and dispatches
  # "aof migrate <folder>" as a thin argv -> invoke -> render / --json face, exactly as import:milestone
  # and the graph verbs do (the exact command id is the developer/architect's call — the bijection
  # arch-test pins it; these scenarios assert only the OBSERVABLE invocation).
  #
  # These @executable rows run OFFLINE against a small LOCAL fixture source folder under this story's
  # "fixtures/" dir, read in place behind import's read-only source-access seam (resolveImportSource).
  # The STRUCTURAL invariants — "migrate registers exactly one command, frozen { id, input, run, cli };
  # source access is read-only" — are story arch-tests, NOT Thens here; do not restate them as scenarios.

  Background:
    Given a small local fixture source folder under this story's "fixtures/" dir that holds existing work
    And the work stream already holds items at the slots before the next free one

  Scenario: migrate is a registered command and "aof migrate <folder>" dispatches through it
    Given the migrate command registered in the Command core
    Then its keys are exactly "id", "input", "run", and "cli"
    And its "run" is callable and its "cli" adapter is present and callable

  Scenario: migrate over a local fixture folder exits 0 and reports the managed item it created
    When I run "aof migrate <fixture-folder>"
    Then the command exits 0
    And stdout reports the managed milestone item it created and where it landed

  Scenario: the produced item is a valid managed milestone under work.dir
    When I run "aof migrate <fixture-folder>"
    Then a numbered milestone folder is created under work.dir
    And it holds a SPEC.md and a STATE.md whose frontmatter matches the folder (type "milestone")

  Scenario: the produced item resolves through the stream's own resolver
    When I run "aof migrate <fixture-folder>"
    And I then run "aof work find <produced-ref> --json"
    Then exactly one item is returned and its type is "milestone"

  Scenario: the produced item passes work validation
    When I run "aof migrate <fixture-folder>"
    Then "aof work validate" reports no folder<->frontmatter, tag-vocabulary, or depends-graph errors for the produced item

  Scenario: the source folder's intent becomes the produced SPEC's objective and scope
    Given the fixture folder states what its work set out to do
    When I run "aof migrate <fixture-folder>"
    Then the produced SPEC.md carries that intent as its objective and an in/out scope
    And the SPEC.md is legible intent, not a fabricated objective the source never stated

  Scenario: the source's substructure is scaffolded into stories and task features
    Given the fixture folder presents more than one distinct unit of work
    When I run "aof migrate <fixture-folder>"
    Then the produced milestone has a stories/ folder with a story per recovered unit
    And each story lists its recovered tasks as task ".feature" files

  Scenario: the produced item lands at the next free slot without clobbering existing work
    When I run "aof migrate <fixture-folder>"
    Then the produced milestone takes the next free top-level slot
    And no existing item under work.dir is overwritten or renumbered

  # --dry-run mirrors import's dry-run discipline: PREVIEW the scaffold (the folder + artifacts + counts
  # it WOULD write) and write / index NOTHING.
  Scenario: --dry-run previews the scaffold and writes nothing
    When I run "aof migrate <fixture-folder> --dry-run"
    Then the command exits 0 and reports the managed item it WOULD create
    And no folder, SPEC.md, STATE.md, or task feature is written under work.dir

  Scenario: a missing <folder> argument fails cleanly with a usage message
    When I run "aof migrate"
    Then the command exits non-zero
    And stderr shows a usage message for "migrate <folder>"
    And nothing is created under work.dir

  # QA: author the case matrix below — the produced-item shape across {source shape, dry-run, slot
  # contention, --json projection}. Each row varies the input and pins the one OBSERVABLE outcome
  # (created vs previewed vs refused; the produced ref; whether it validates).
  #
  # The invocation-shape matrix mirrors import's arg-shape matrix (13/00): a well-formed folder creates
  # at the next free slot; --dry-run previews and writes nothing; a missing <folder> is a usage error;
  # an unreadable / nonexistent path is refused with nothing created; slot contention lands at the next
  # free slot and clobbers nothing. Every row is over the LOCAL fixture behind the read-only source seam,
  # so the whole matrix is @executable. "outcome" is the single black-box observable a tester confirms
  # by exit code + what does (or does not) appear under work.dir.
  Scenario Outline: the migrate invocation shape determines what is produced
    When I run "aof migrate <args>" against the fixture
    Then the command <outcome>

    Examples: a well-formed invocation creates a managed item
      | args                       | outcome                                                              |
      | <fixture-folder>           | exits 0 and creates a valid managed milestone at the next free slot  |

    Examples: --dry-run previews and writes nothing
      | args                       | outcome                                                              |
      | <fixture-folder> --dry-run | exits 0, reports the item it WOULD create, and writes nothing        |

    Examples: a missing or bad <folder> arg is refused with nothing created
      | args                       | outcome                                                              |
      |                            | exits non-zero with a usage message and creates nothing             |
      | <nonexistent-path>         | exits non-zero stating the source could not be read, creating nothing|

    Examples: slot contention lands at the next free slot, clobbering nothing
      | args                       | outcome                                                              |
      | <fixture-folder>           | takes the next free top-level slot, leaving every existing item unchanged |

  # The --json projection (mirrors import's --json face): the structured result names the produced item's
  # ref and dir plus a scaffold-count summary, so an automated caller can resolve the produced item
  # without scraping stdout. --dry-run --json projects the SAME shape over what it WOULD create while
  # still writing nothing. Each row pins one observable field of the JSON result.
  Scenario Outline: --json projects the produced item's ref, dir, and a scaffold summary
    When I run "aof migrate <args> --json" against the fixture
    Then the command exits 0
    And the JSON result <projection>

    Examples: a real run projects the produced item
      | args             | projection                                                          |
      | <fixture-folder> | names the produced milestone's ref                                  |
      | <fixture-folder> | names the produced milestone's dir under work.dir                   |
      | <fixture-folder> | reports a scaffold-count summary (stories and task features written)|

    Examples: a dry-run projects what it WOULD create while writing nothing
      | args                       | projection                                                          |
      | <fixture-folder> --dry-run | names the ref and dir it WOULD create, with nothing written under work.dir |
