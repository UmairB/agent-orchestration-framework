@cli @adapter @work-stream
Feature: notion:sync-work is a registered command and aof work integrations notion sync-work dispatches through it
  In order to give the PO (and any future board/MCP face) ONE canonical sync command they inherit for free
  the system must register "notion:sync-work" in the frozen Command core with the { id, input, run, cli }
  shape, dispatch "aof work integrations notion sync-work <milestone>" through it via invoke, project the
  SyncResult envelope as --json, and fail cleanly on a missing milestone or an unknown integrations provider.

  # ADR-002: the command is the registered "notion:sync-work" Command in the frozen core
  # (src/command-core.mjs, { id, input, run, cli }; input { milestone:string, dryRun?:boolean },
  # required:["milestone"], additionalProperties:false; invoked via invoke("notion:sync-work", input,
  # { workspace })), and the CLI "aof work integrations notion sync-work …" is a thin argv -> invoke ->
  # render / --json face dispatched through a NEW "integrations" sub-noun on workCommand (cli.mjs) — exactly
  # as import:milestone is. "integrations notion" is the namespace segment so a sibling provider registers as
  # "aof work integrations <provider> …"; an unknown provider fails citing the supported provider "notion".
  # These scenarios run against a CONFIGURED fixture workspace with the Notion-CLI spawn seam STUBBED — for
  # story 00 the projection is stubbed behind the spawn seam returning an empty/stub plan, so a configured run
  # exits 0 with an (empty-or-stub) items list — so the whole lane is @executable.
  #
  # These are OBSERVABLE behaviours: the command resolves from the registry with a callable cli adapter; a
  # configured run exits 0 and reports the milestone it synced; --json projects the SyncResult envelope; a
  # missing milestone / unknown provider exits non-zero with a usage / citation message.
  #
  # STRUCTURAL — the command-cli bijection for notion:sync-work (it carries a `cli` adapter + dispatches via
  # the registry with --json) is INHERITED from 08/ADR-004 (acd-work-command-cli-bijection), NOT a Then here;
  # the notion:*-prefix exclusion from the /api/work bijection is the same inherited contract. The opt-in
  # no-op and the seven sync invariants are story-03 arch-tests (ADR-005), NOT scenarios here. Comment-only —
  # do not restate them as Thens.

  Background:
    Given a fixture workspace with milestone "17" and its stories on disk
    And the workspace config has a "work.integrations.notion" block
    And the Notion-CLI spawn seam is stubbed to return an empty plan

  @executable
  Scenario: notion:sync-work is registered in the Command core with the frozen shape
    Given the command registered as "notion:sync-work"
    Then its keys are exactly "id", "input", "run", and "cli"
    And "id" is "notion:sync-work"
    And "run" is callable
    And its "cli" adapter is present and callable

  # ADR-002: the CLI face dispatches through the new "integrations" sub-noun on workCommand, routing through
  # invoke("notion:sync-work", …) — the registry door, never a direct path.
  @executable
  Scenario: aof work integrations notion sync-work over a configured fixture exits 0 and reports the milestone
    When I run "aof work integrations notion sync-work 17"
    Then the command exits 0
    And stdout reports the milestone "17" it synced

  # --json is the structured face (ADR-002): the SyncResult envelope verbatim (refs are not paths, so no
  # relativise step). For story 00 the configured run returns an empty/stub items list.
  @executable
  Scenario: --json projects the SyncResult envelope
    When I run "aof work integrations notion sync-work 17 --json"
    Then the command exits 0
    And the JSON result has "milestone" equal to "17"
    And the JSON result has a boolean "configured"
    And the JSON result has a boolean "dryRun"
    And the JSON result has an "items" array

  @executable
  Scenario: a missing <milestone> fails cleanly with a usage message
    When I run "aof work integrations notion sync-work"
    Then the command exits non-zero
    And stderr shows a usage message for "integrations notion sync-work <milestone>"
    And nothing is pushed to Notion

  # ADR-002: "integrations notion" is the namespace seam; a future provider is a sibling, but only "notion"
  # is supported in this milestone, so an unknown provider fails citing the supported provider.
  @executable
  Scenario: an unknown integrations provider fails cleanly citing the supported provider
    When I run "aof work integrations widget 17"
    Then the command exits non-zero
    And stderr states the supported integrations provider is "notion"
    And nothing is pushed to Notion

  # The arg-shape matrix. All over the configured fixture + the stubbed spawn seam, so the whole matrix is
  # @executable. A well-formed invocation exits 0; a missing milestone is a usage error; an unknown provider
  # cites "notion"; "--dry-run" parses into dryRun:true on the projected input (the dry-run BEHAVIOUR — a
  # zero-Notion-call diff — is ADR-003, story 01; here only the flag PARSE is asserted).
  # "exit" column: 0 = synced; usage = non-zero + usage message; provider = non-zero citing "notion";
  # dry-run = exits 0 with dryRun:true in the envelope.
  @executable
  Scenario Outline: the sync argument shape determines the outcome
    When I run "aof work integrations notion sync-work <args>"
    Then the command <exit-result>

    Examples: a well-formed invocation syncs
      | args            | exit-result                                          |
      | 17              | exits 0 and reports the synced milestone "17"        |
      | 17 --dry-run    | exits 0 with "dryRun" true in the envelope           |

    Examples: a missing required arg fails cleanly
      | args            | exit-result                                          |
      |                 | exits non-zero with a usage message                  |

    Examples: an unknown provider is rejected
      | args            | exit-result                                          |
      | widget 17       | exits non-zero citing the provider "notion"          |
