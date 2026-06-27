@cli @adapter @work-stream
Feature: associate writes the per-folder .integrations.json — the only mutation, validated against committed config
  In order to record (or clear) a milestone's board + parent routing as committed, diffable intent that lives with the item
  the system must, on "aof work integrations notion associate <ref> --board <key> --parent <id|key|none>",
  write or clear the milestone's ".integrations.json" as its ONLY mutation — never the git-ignored sidecar and
  never Notion — after validating --board and --parent PURELY against committed config (an unknown board or
  parent key an honest error that names the available keys and writes nothing), reporting set / unset / unchanged.

  # ADR-004: the verb stays the registered "notion:associate" command-core command on the "integrations notion"
  # namespace with the --json envelope. It resolves the item via the shared listItems traversal (no new
  # traversal); routing is a top-level MILESTONE action (a non-milestone ref is "not-a-milestone"). The ONLY
  # mutation is the writeRouting(.integrations.json) call (ADR-003) — no sidecar write, no Notion call (ADR-006,
  # there is no spawn seam imported). --parent none clears the parent; the result envelope is
  # { ref, board, parent, action: "set"|"unset"|"unchanged" }; an unchanged write touches no file.
  #
  # These are OBSERVABLE behaviours driven through the command registry over a temp fixture — @executable.
  # STRUCTURAL — "associate makes ZERO sidecar/Notion writes and imports no spawn seam" + "the write target is
  # .integrations.json, not the sidecar" are the milestone arch-tests FF-A / FF-D (authored in story 02), NOT
  # Thens here. Comment-only — do not restate them.

  Background:
    Given a fixture workspace with a top-level milestone "18" on disk
    And the workspace config carries a boards registry with boards "ops" (parents bind "p1" to "page-P1") and "growth" (parents bind "g1" to "page-G1")
    And the default board is "ops"

  @executable
  Scenario: a valid --board and a parent key write the descriptor and nothing else
    When I run "aof work integrations notion associate 18 --board ops --parent p1"
    Then the command exits 0
    And the milestone folder's ".integrations.json" names notion board "ops" and parent "p1"
    And no ".aof/notion.work-map.json" sidecar is written
    And nothing is pushed to Notion

  # The written board field tracks the --board flag, and a parent key is validated against the CHOSEN (named,
  # non-default) board's parents — not the default's (ADR-001/004 per-board scoping).
  @executable
  Scenario: a non-default --board writes that board and validates the parent against it
    When I run "aof work integrations notion associate 18 --board growth --parent g1"
    Then the command exits 0
    And the milestone folder's ".integrations.json" names notion board "growth" and parent "g1"

  # A raw page-id parent needs no parents-map entry (ADR-001, locality).
  @executable
  Scenario: a raw page-id parent is accepted verbatim
    When I run "aof work integrations notion associate 18 --board ops --parent 11112222333344445555666677778888"
    Then the command exits 0
    And the milestone folder's ".integrations.json" names parent "11112222333344445555666677778888"

  # --parent none clears the parent (symmetric with set), leaving the board.
  @executable
  Scenario: --parent none clears the parent
    Given milestone "18" is already associated to board "ops" parent "p1"
    When I run "aof work integrations notion associate 18 --board ops --parent none"
    Then the command exits 0
    And the descriptor's notion block names board "ops" with no parent
    And the action reported is "unset"

  # Clearing the WHOLE notion block (--board none) is in scope (SPEC §Scope; ADR-004). It removes the notion
  # routing entirely so the item round-trips to "absent ⇒ default board, top-level".
  @executable
  Scenario: --board none clears the whole notion routing block
    Given milestone "18" is already associated to board "ops" parent "p1"
    When I run "aof work integrations notion associate 18 --board none"
    Then the command exits 0
    And the action reported is "unset"
    And re-reading the item's routing yields no notion block

  # The clear path is idempotent too: clearing an already-clear item changes nothing and writes no file.
  @executable
  Scenario: clearing an already-clear item reports unchanged and writes no file
    Given milestone "18" has no ".integrations.json"
    When I run "aof work integrations notion associate 18 --board none"
    Then the command exits 0
    And the action reported is "unchanged"
    And no ".integrations.json" file is created

  # Idempotence: re-writing the same routing changes nothing and touches no file (updated: is not churned).
  @executable
  Scenario: an associate that changes nothing reports unchanged and writes no file
    Given milestone "18" is already associated to board "ops" parent "p1"
    When I run "aof work integrations notion associate 18 --board ops --parent p1"
    Then the command exits 0
    And the action reported is "unchanged"
    And the ".integrations.json" file is byte-for-byte unchanged

  # PURE / no-read validation (ADR-006): an unknown board / parent key is refused with a DISTINCT code (the two
  # arms are not interchangeable), naming the available keys SCOPED to the chosen board, with NO disk write —
  # never a dangling association the config cannot resolve.
  @executable
  Scenario Outline: an unresolvable --board or --parent is an honest error that writes nothing
    When I run "aof work integrations notion associate 18 <args>"
    Then the command exits non-zero with code "<code>"
    And stderr names <vocabulary>
    And the milestone folder's ".integrations.json" is not created or modified
    And nothing is pushed to Notion

    Examples: an unknown board key — names the available boards
      | args                       | code              | vocabulary                         |
      | --board ghost --parent p1  | unknown-board-key | the available boards "ops","growth" |

    Examples: an unknown parent key — names the CHOSEN board's parent keys, not another board's
      | args                       | code               | vocabulary                          |
      | --board ops --parent ghost | unknown-parent-key | the "ops" board's parent keys "p1"  |
      | --board growth --parent p1 | unknown-parent-key | the "growth" board's parent keys "g1" |

  # Routing is a top-level milestone action — a story ref is the honest not-a-milestone error.
  @executable
  Scenario: associating a non-milestone ref is the honest not-a-milestone error
    Given a story "18/00" exists under milestone "18"
    When I run "aof work integrations notion associate 18/00 --board ops --parent p1"
    Then the command exits non-zero with code "not-a-milestone"
    And stderr states routing is associated on a top-level milestone
    And no ".integrations.json" is created in the milestone folder or the story folder

  # The --json face is the envelope verbatim (refs are not paths — no relativise step).
  @executable
  Scenario: --json projects the AssociateResult envelope
    When I run "aof work integrations notion associate 18 --board ops --parent p1 --json"
    Then the command exits 0
    And the JSON result has "ref" equal to "18"
    And the JSON result has "board" equal to "ops"
    And the JSON result has "parent" equal to "p1"
    And the JSON result has "action" equal to "set"
