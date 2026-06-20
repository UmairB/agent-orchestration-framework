@cli @work @memory @executable
Feature: aof work memory routes each verb to the configured backend through the frozen interface
  In order to recall and ingest lessons through one unchanging surface
  the system must dispatch every memory verb to the selected backend via the frozen interface,
  and reject an unknown verb with usage and a non-zero exit.

  # The seam owns argv parsing, config dispatch, and rendering; the backend owns the data
  # (ADR-003). These scenarios run against an in-memory STUB backend whose methods record the
  # call they received, so we assert the OBSERVABLE routing — which interface method a verb
  # reaches — not what real recall returns. The frozen interface has exactly three methods
  # {recall, reindex, status} (ADR-003); "brief" and "ingest" are seam-level conveniences
  # composed over recall/reindex, NOT new interface methods.
  Background:
    Given a project whose config selects a stub backend that records each interface call it receives

  Scenario: recall reaches the backend's recall method
    When I run "aof work memory recall \"pin line endings\""
    Then the command exits 0
    And the backend's "recall" method was invoked with the query "pin line endings"

  Scenario: reindex reaches the backend's reindex method
    When I run "aof work memory reindex"
    Then the command exits 0
    And the backend's "reindex" method was invoked

  Scenario: status reaches the backend's status method
    When I run "aof work memory status"
    Then the command exits 0
    And the backend's "status" method was invoked

  # brief is a situational digest composed over recall — it reaches backend.recall, not a
  # method named "brief"; the interface exposes no such method (ADR-003).
  Scenario: brief is composed over the backend's recall method, not a new interface method
    When I run "aof work memory brief"
    Then the command exits 0
    And the backend's "recall" method was invoked
    And the backend exposes no "brief" method

  # ingest is the Accept-time alias of reindex (ADR-003, FINDINGS §4) — same interface method,
  # no separate write path; the interface exposes no method named "ingest".
  Scenario: ingest is an alias of reindex and reaches the backend's reindex method
    When I run "aof work memory ingest 01"
    Then the command exits 0
    And the backend's "reindex" method was invoked
    And the backend exposes no "ingest" method

  Scenario: an unknown verb prints usage and exits non-zero
    When I run "aof work memory frobnicate"
    Then the command exits non-zero
    And the output lists the supported memory verbs
    And no backend method was invoked

  Scenario: a missing verb prints usage and exits non-zero
    When I run "aof work memory"
    Then the command exits non-zero
    And the output lists the supported memory verbs
    And no backend method was invoked

  # The full verb -> interface-method routing table. recall and brief both reach recall;
  # reindex and ingest both reach reindex (ingest is the alias); status reaches status.
  # The "composed?" column records that brief/ingest are seam compositions, not interface
  # methods — a verb marked "yes" reaches its method without the interface gaining a method
  # of the verb's own name.
  Scenario Outline: each verb routes to its frozen interface method
    When I run "aof work memory <verb> <args>"
    Then the command exits 0
    And the backend's "<method>" method was invoked
    And it is a seam-level composition: <composed>

    Examples: the verb spine routes 1:1 to its interface method
      | verb    | args            | method  | composed |
      | recall  | "query"         | recall  | no       |
      | reindex |                 | reindex | no       |
      | status  |                 | status  | no       |

    Examples: brief and ingest are conveniences composed over the spine
      | verb    | args            | method  | composed |
      | brief   |                 | recall  | yes      |
      | ingest  | 01              | reindex | yes      |
