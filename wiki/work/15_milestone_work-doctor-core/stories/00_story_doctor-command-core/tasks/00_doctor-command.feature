@cli @work @work-stream @validate @executable
Feature: work:doctor is a registered command-core command returning the basis-neutral { findings } health envelope
  In order to give every face (CLI, board, MCP) ONE canonical health command they inherit for free
  the work stream registers work:doctor on the milestone-08 command core as a { id, input, run, cli } command whose run returns a basis-neutral { findings } envelope over a snapshot of the stream,
  so that a clean stream is silent (empty findings = healthy) and a single cross-item incoherence surfaces as exactly one coded, severity-tagged finding any face can project.

  # This is the doctor SPINE seen through the registry (ADR-001). work:doctor is the
  # validate sibling: same command core, same getCommand/invoke door, the SAME
  # basis-neutral { findings } shape (raw absolute paths in run — the face
  # relativises), and the SAME scope-as-filter semantics. The difference is the
  # RICHER finding (a { code, severity, path, message } health finding, not a
  # per-file { path, problem }) — but the EXACT four-key envelope shape and the
  # absolute-path rule are frozen by the envelope-contract ARCH-TEST, NOT asserted
  # here. This feature asserts the OBSERVABLE command behaviour: it resolves, it
  # invokes to { findings }, a clean stream is empty, a seeded violation is present,
  # and scope filters. ctx = { workspace } (the loadWorkspace result), as for every
  # registered command.
  Background:
    Given the command registry loaded in-process from src/command-core.mjs
    And a work-stream fixture loaded as the invoke workspace

  # Doctor is on the SAME core as validate — no side-channel. getCommand resolves it
  # to the frozen { id, input, run, cli } command both faces and the bijection
  # arch-tests reach it through.
  Scenario: getCommand resolves work:doctor to a registered command
    When I get the command for "work:doctor"
    Then the lookup returns a command
    And the command has the id "work:doctor"
    And the command has an "input" schema, an async "run" function, and a "cli" adapter

  # invoke runs the command's run over the workspace and returns the run's result
  # verbatim — the health envelope is a single { findings } field, mirroring validate.
  Scenario: invoke over the workspace returns the { findings } envelope
    When I invoke "work:doctor" with no scope and the fixture workspace
    Then the result carries a "findings" array
    And the result carries no other top-level field

  # A clean stream is SILENT: doctor is finding-oriented like validate (no ok rows),
  # so a coherent, well-formed fixture means an EMPTY findings array — empty findings
  # is the observable signal for "healthy".
  Scenario: a coherent fixture yields empty findings (healthy is silent)
    Given the fixture stream has no cross-item incoherence
    When I invoke "work:doctor" with no scope and the fixture workspace
    Then the result's findings array is empty

  # The smallest non-clean case: ONE seeded cross-item violation surfaces as exactly
  # ONE finding. We assert the OBSERVABLE finding is present and names the cross-item
  # fact (a code + a message about the relationship) — NOT the exact four-key shape
  # (that is the envelope arch-test) and NOT which check family it belongs to (that
  # is a story-01 check-behaviour feature).
  Scenario: one seeded cross-item violation yields exactly one finding naming the cross-item fact
    Given the fixture stream has exactly one seeded cross-item incoherence
    When I invoke "work:doctor" with no scope and the fixture workspace
    Then the result's findings array has exactly one finding
    And that finding carries a non-empty "code"
    And that finding's "message" names the cross-item fact

  # Scope-as-filter, the SAME semantics as validate: an in-scope ref returns only
  # that subtree's findings; an unresolved scope is a filter that matches nothing —
  # EMPTY findings, NO thrown error (a typo'd ref must not crash the health lane).
  Scenario Outline: scope filters the findings to a subtree, and an unresolved scope is empty without error
    Given the fixture stream has a seeded incoherence under milestone "<seeded-ref>"
    When I invoke "work:doctor" with scope "<scope>" and the fixture workspace
    Then the invoke does not raise an error
    And the findings are "<finding-set>"

    Examples:
      | scope        | seeded-ref | finding-set                          |
      | 07           | 07         | only findings under that subtree     |
      | 08           | 07         | empty (out-of-scope subtree)         |
      | 99/no-such   | 07         | empty (unresolved scope matches none)|
