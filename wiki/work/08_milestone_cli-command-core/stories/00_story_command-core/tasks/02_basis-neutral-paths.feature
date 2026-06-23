@cli @work @work-stream @executable
Feature: work:list, work:validate and work:next return basis-neutral data with raw paths the command never projects
  In order that ONE command can serve both faces byte-for-byte without either having to un-project the other's path basis
  the stream and query commands return their data with any filesystem path as a RAW absolute (or, for list, the dir exactly as listStream emits it) — never relativised to cwd or the project root inside run,
  so that each face applies its own path-display projection losslessly (the keystone of ADR-002 that makes byte-for-byte-on-both-faces achievable on Windows separators).

  # ADR-002's keystone (the basis-neutral result): run does the OPERATION and
  # returns basis-NEUTRAL data. NO displayPath, NO path.relative, NO cwd/projectRoot
  # relativisation lives inside run — that is a FACE adapter (board: projectRoot +
  # forward-slash; CLI: cwd + path.relative). A command that pre-projected to one
  # basis would force the other face to un-project, which is lossy on Windows
  # separators. So work:validate returns { findings: [{ path: RAW abs, problem }] }
  # (the board's {findings} envelope SHAPE, raw paths), work:next returns the core
  # NextResult with path RAW abs, and work:list passes listStream through unwrapped
  # (its dir is already forward-slashed by listStream — neither cwd- nor
  # projectRoot-relative, so both faces emit it unchanged). The byte-for-byte
  # divergence between faces is proven on each FACE (stories 01/02), not here; here
  # we prove the command result is basis-neutral so that projection is possible.
  Background:
    Given a work-stream fixture the command core can operate over
    And the command registry loaded in-process

  # --- work:validate --------------------------------------------------------

  # validate returns the { findings } envelope shape, each finding's path left as a
  # raw absolute — the command applies no relativisation or slashing of its own.
  Scenario: work:validate returns findings whose paths are raw absolutes
    Given the fixtured stream has a story whose frontmatter slug disagrees with its folder
    When I invoke "work:validate" with no scope
    Then the result is a "findings" envelope
    And each finding has a "path" and a "problem"
    And each finding path is the absolute path of the offending file on disk in its on-disk OS form
    And no finding path is project-root-relative, and none is forward-slashed

  # A clean stream is an empty findings list (the positive case), still wrapped in
  # the { findings } envelope shape.
  Scenario: a clean stream returns an empty findings envelope
    Given the fixtured stream is well-formed
    When I invoke "work:validate" with no scope
    Then the result is a "findings" envelope with an empty findings list

  # An unresolved scope is a filter that matches nothing, not a validated ref: it
  # yields an empty findings envelope (no error) — preserving validateWork's
  # existing scope-narrowing semantics through the re-home.
  Scenario: an unresolved scope yields an empty findings envelope, not an error
    Given the fixtured stream is well-formed under every milestone
    When I invoke "work:validate" with scope "99"
    Then the result is a "findings" envelope with an empty findings list
    And the command does not raise an error

  # validate honours a scope ref, narrowing the operation the same way the existing
  # validateWork scopeRef does — the command is a thin re-home, not a rewrite.
  Scenario: work:validate narrows to a supplied scope
    Given the fixtured stream has a malformed item under milestone "03" and a malformed item under milestone "04"
    When I invoke "work:validate" with scope "03"
    Then only findings under milestone "03" are reported
    And findings under milestone "04" are not reported

  # --- work:next ------------------------------------------------------------

  # next returns the core NextResult with its path a raw absolute — again no face
  # projection inside the command.
  Scenario: work:next returns a NextResult whose path is a raw absolute
    When I invoke "work:next" with no scope
    Then the result carries the next item's ref, type, status, slug, and state
    And the result path is the absolute path of the next item's directory in its on-disk OS form
    And the path is not project-root-relative and is not forward-slashed

  # --- work:list ------------------------------------------------------------

  # list passes the whole listStream array through unwrapped; its dir is already
  # the forward-slashed absolute listStream emits, so the command neither re-bases
  # nor re-slashes it (both faces emit it identically).
  Scenario: work:list returns the whole stream with dir exactly as listStream emits it
    When I invoke "work:list" with no input
    Then the result is the full work-stream array
    And each element's dir is exactly the value listStream produces
    And each dir is the full forward-slashed absolute, not relativised to cwd or the project root
