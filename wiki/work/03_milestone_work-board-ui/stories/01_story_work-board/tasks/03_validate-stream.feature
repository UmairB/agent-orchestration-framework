@ui @work @board
Feature: Validate reports the work-stream validator's findings inline against the selected item
  In order to check whether the work stream is well-formed without running a CLI command
  Validate calls the in-process work-stream validator and renders its findings — one path · problem row each — or a positive "no issues" line when the stream is clean, inline next to the item rather than in a vanishing toast.

  # Validate is an in-process call to validateWork(workDir, config, scopeRef)
  # (work.mjs:252), never a CLI shell-out (ADR-004). It returns an array of
  # { path, problem } findings; an empty array means the stream is clean. The
  # board exposes this at "/api/work/validate" and renders the rows inline
  # (DESIGN §3 — validate output is content to read against the item, so it
  # persists, not a toast). The `scopeRef` narrows validation to a selection.
  # The endpoint is @executable; the rendered result is @manual.
  Background:
    Given a fixtured work stream the board can validate via "/api/work/validate"

  # --- the validate endpoint (server-side) ----------------------------------

  # The endpoint returns the validator's findings as path · problem rows when the
  # stream has issues.
  @executable
  Scenario: the validate endpoint returns the validator's findings
    Given the fixtured stream has a story whose frontmatter slug disagrees with its folder
    When the board requests "/api/work/validate"
    Then the response is a list of findings
    And one finding names the offending document path and its problem

  # A clean stream yields an empty findings list — the positive case the board
  # renders as "no issues".
  @executable
  Scenario: a clean stream returns no findings
    Given the fixtured stream is well-formed
    When the board requests "/api/work/validate"
    Then the response is an empty list of findings

  # Validate is scoped to the selection when a scope ref is supplied: only items
  # in scope are checked (validateWork's scopeRef narrowing).
  @executable
  Scenario: validate scoped to a selection reports only in-scope findings
    Given the fixtured stream has a malformed item under milestone "03" and a malformed item under milestone "04"
    When the board requests "/api/work/validate" scoped to "03"
    Then only findings under milestone "03" are reported
    And findings under milestone "04" are not reported

  # The validate path is read-only — it reports findings and mutates nothing.
  @executable
  Scenario: validate changes no files
    Given a snapshot of the fixtured work stream before validating
    When the board requests "/api/work/validate"
    Then no file in the work stream is changed

  # --- the rendered result (browser) ----------------------------------------

  # A clean validate shows a positive line, not a blank result.
  @manual
  Scenario: a clean validate renders a positive no-issues line
    Given the selected scope is well-formed
    When the operator presses "Validate"
    Then the result region shows a positive "No issues" line

  # Findings render as inline rows — one path · problem per row — and persist in
  # the result region (not a toast that flashes and vanishes, DESIGN §3).
  @manual
  Scenario: findings render as inline path-and-problem rows that persist
    Given the selected scope has two validator findings
    When the operator presses "Validate"
    Then the result region lists two finding rows
    And each row shows the offending path and its problem
    And the rows remain visible until the next action replaces them

  # While validating, the button shows a busy state; a failed validate call
  # surfaces an error line rather than a silent success.
  @manual
  Scenario: a failed validate call surfaces an error line
    Given the "/api/work/validate" request fails
    When the operator presses "Validate"
    Then the result region shows an error line
