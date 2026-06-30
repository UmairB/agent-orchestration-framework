@cli @work @distribution @executable
Feature: aof mesh is a registered top-level CLI face whose dispatcher skeleton gives the thin-face premise its structural teeth
  In order to make "a node is just another thin face" (PRD §3) a real, gated structural fact rather than an aspiration
  the aof mesh top-level command exists with a meshCommand dispatcher skeleton that renders usage with no sub and one structured error envelope for an unknown sub,
  so that the NEW registry-derived mesh-namespace bijection gate has a face to assert against, and stories 01/02 add their verbs as one additive dispatch branch each.

  # ARCHITECTURE ADR-001: the greenfield aof mesh face. Milestone 19 reused the pre-existing
  # aof work face; here the face is NEW, so the spine ships the dispatcher SKELETON (the
  # if (command === "mesh") top-level case + meshCommand's unknown-sub ladder) before any
  # mesh:* command lands. This feature asserts the SKELETON's observable behaviour; the
  # registry-derived bijection (cli adapter + dispatch + --json clean per mesh:* command) is
  # the acd-mesh-command-cli-bijection ARCH-TEST (fitness #3), RED until the commands land.
  # The --json single-envelope discipline is the milestone-08 face contract (08/ADR-002/003).
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # aof mesh is reachable as a top-level command (sibling to aof work / aof graph), not an
  # error — the dispatcher skeleton routes it.
  Scenario: aof mesh is a registered top-level CLI command
    When I run "aof mesh"
    Then the command is recognised (it is not an "unknown command" error)
    And the output renders the aof mesh usage (the available sub-commands)
    And the process exits zero

  # The skeleton's reachable surface, as a matrix: bare `aof mesh` renders usage and exits
  # zero (not an error); an unknown sub renders ONE structured { ok:false, error, code }
  # envelope under --json and exits non-zero (the 08/ADR-003 single-envelope discipline) —
  # never a half-printed result or a stack trace. The matrix covers the empty-string sub and a
  # whitespace sub alongside a plain bogus token, since each is an "unknown sub" the ladder
  # must reject identically rather than mistake for a verb.
  # QA: every code path the skeleton's unknown-sub ladder can emit is enumerated here; as
  # stories 01/02 wire identity/status/sync, those tokens leave this unknown-sub matrix and
  # become recognised verbs (verified in their own features).
  Scenario Outline: the mesh skeleton routes a known shape and rejects every unknown sub with one envelope
    When I run "aof mesh <args> --json"
    Then stdout is a single parseable JSON document
    And the result is "<shape>" with code "<code>" and exit "<exit>"

    Examples:
      | args     | shape              | code                | exit     |
      | (no sub) | usage / ok         | (none)              | zero     |
      | bogus    | ok:false error     | unknown-subcommand  | non-zero |
      | ""       | ok:false error     | unknown-subcommand  | non-zero |
      | "   "    | ok:false error     | unknown-subcommand  | non-zero |

  # The unknown-sub error names the offending sub so the operator sees WHICH token was
  # rejected, not a generic failure.
  Scenario: an unknown mesh sub-command's error names the rejected sub-command
    When I run "aof mesh bogus --json"
    Then stdout is a single parseable JSON envelope "{ ok:false, error, code }"
    And the "error" message names the rejected sub-command "bogus"
    And the process exits non-zero

  # The skeleton carries no command logic of its own — it only routes. Before stories 01/02
  # land, there is no identity/sync verb to dispatch, so the bijection gate (fitness #3) is
  # RED; this scenario pins that the skeleton itself is present and routing-only — observably,
  # the usage advertises no behaviour and invoking it mutates nothing on disk.
  Scenario: the meshCommand dispatcher is routing-only (no command logic, no side effects)
    Given the work stream has no mesh records on disk
    When I run "aof mesh"
    Then the usage lists no behaviour beyond routing (stories 01/02 add identity/status/sync)
    And no mesh record file was created, modified, or deleted on disk
    And no item record doc was edited
