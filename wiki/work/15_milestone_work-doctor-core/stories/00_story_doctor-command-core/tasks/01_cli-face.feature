@cli @work @work-stream @validate @executable
Feature: aof work doctor renders the health findings, emits the --json envelope+summary, and is advisory by default
  In order to let a human and a CI step read the work stream's health through the CLI face
  the aof work doctor [scope] [--json] [--strict] command renders a healthy line on a clean stream and a "severity: code — message" line per finding (cwd-relative paths) otherwise, and under --json emits the canonical envelope plus a { healthy, strict, errors, warnings, findings } summary,
  so that the same finding set the command's run produces is surfaced through the CLI's path-projection and summary discipline, advisory by default, with --strict accepted and surfaced.

  # The CLI is the FACE over the registered work:doctor command (ADR-002). It mirrors
  # the work validate render/json adapter discipline AND the config doctor --json
  # summary shape { healthy, strict, errors, warnings, findings }. Two things this
  # feature deliberately does NOT assert — they are the --strict-exit ARCH-TEST, not
  # behaviour here: (1) the process EXIT CODE (the four-case matrix: clean→0,
  # warn-only→0, warn-only+strict→non-zero, error→non-zero); (2) that run's findings
  # are byte-identical across --strict. Here we assert the OBSERVABLE render text, the
  # --json envelope+summary fields, the cwd-relative path projection, and that
  # --strict is accepted and surfaced (the `strict` field) — NOT the exit gate.
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # A clean stream renders the healthy line — finding-oriented, silent when well; the
  # human sees a single positive line, not a row-per-check report.
  Scenario: a clean stream renders the healthy line
    Given the fixture work stream has no findings
    When I run "aof work doctor"
    Then the output contains a healthy line
    And the output lists no finding lines

  # Each finding renders one human line "severity: code — message" with the anchor
  # path shown CWD-RELATIVE (the CLI's path-projection face — run carries the raw
  # absolute; the face relativises to process.cwd()).
  Scenario: each finding renders a severity-coded line with a cwd-relative path
    Given the fixture work stream has a seeded "error"-severity finding
    When I run "aof work doctor"
    Then the output contains a line of the form "severity: code — message"
    And that line shows the finding's anchor path relative to the current directory
    And that line is not an absolute path

  # --json emits the canonical finding envelope (each finding cwd-relative-pathed)
  # PLUS the config-doctor-shaped summary { healthy, strict, errors, warnings,
  # findings }, so a CI step reads health without re-deriving from the finding list.
  Scenario: --json emits the canonical envelope plus the { healthy, strict, errors, warnings, findings } summary
    Given the fixture work stream has one "warn" finding and one "error" finding
    When I run "aof work doctor --json"
    Then the JSON has a "findings" array carrying each finding's code, severity, path, and message
    And each finding's "path" in the JSON is cwd-relative, not absolute
    And the JSON has a boolean "healthy" field
    And the JSON has a boolean "strict" field
    And the JSON has an integer "errors" count of 1 and an integer "warnings" count of 1

  # Advisory by default: a warn-ONLY stream reports/loads as NOT-failing — healthy is
  # true and strict is false without the flag. (This is the OBSERVABLE advisory
  # framing through the face; the matching exit code is the arch-test.)
  Scenario: a warn-only stream is advisory (healthy) by default
    Given the fixture work stream has warn findings only
    When I run "aof work doctor --json"
    Then the JSON "strict" field is false
    And the JSON "healthy" field is true

  # --strict is accepted by the face and SURFACED in the envelope (strict: true). We
  # assert it changes the SURFACED summary (the gate framing), and that the same
  # warn-only finding set is still reported — the flag is a face concern, not a
  # mutation of the findings list. (The exit-code consequence is the arch-test.)
  Scenario Outline: --strict is accepted and surfaced, leaving the reported finding set intact
    Given the fixture work stream has warn findings only
    When I run "aof work doctor <flags> --json"
    Then the JSON "strict" field is "<strict>"
    And the JSON "healthy" field is "<healthy>"
    And the JSON "findings" array still lists every warn finding

    Examples:
      | flags    | strict | healthy |
      |          | false  | true    |
      | --strict | true   | false   |

  # The optional scope positional flows through the face to the command's scope
  # filter: scoping to a clean subtree renders healthy even when another subtree has
  # findings (observable proof scope is honoured through the CLI).
  Scenario: a scope positional filters the rendered findings to that subtree
    Given the fixture work stream has findings under milestone "07" and none under milestone "08"
    When I run "aof work doctor 08"
    Then the output contains a healthy line
