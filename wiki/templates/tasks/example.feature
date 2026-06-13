# tasks/*.feature — answers ONE question: what will be observably true when it's done?
# Owner: product-owner, co-authored Three Amigos (PO writes Scenarios, QA writes Examples,
#   developer checks feasibility). Part of the spine.
#
# THE LITMUS TEST for every line: could a black-box tester confirm this WITHOUT reading the source?
#   yes -> outcome, keep it.   no -> it's a decision/invariant, move it (ADR / fitness function).
#
# Tags: @milestone-NNN + layer + refinement + domain + a VERIFICATION tag (@executable | @manual).
#   @executable -> mapped to a passing test, enforced by the traceability lint.
#   @manual     -> verified by a procedure in UAT.md (which points back here with `verifies →`).

@milestone-NNN @<layer> @<refinement> @<domain> @executable
Feature: <the acceptance surface — a coherent area of behaviour>
  As <the role that benefits>
  I want <the capability>
  So that <the value>

  Background:
    Given <shared precondition stated as an observable fact>

  # A headline Scenario: one of the 3–7 behaviours a stakeholder needs to see.
  Scenario: <a single observable behaviour>
    When <an action>
    Then <an observable result — black-box confirmable>

  # A Scenario Outline: the test-case MATRIX. Keep the template readable; push the enumeration
  # (every status code, boundary, malformed input) into the Examples table. One source, three
  # zoom levels: skim the outline, read the table, run the rows.
  Scenario Outline: <behaviour> maps <input> to <result>
    When <action with <input>>
    Then it yields <result>

    Examples:
      | input      | result          |
      | <case a>   | <expected a>    |
      | <case b>   | <expected b>    |
      | <edge>     | <expected edge> |

  # A @manual scenario: same shape, different verification route. Its procedure lives in UAT.md.
  @manual
  Scenario: <something only a human / live environment can confirm>
    When <action in the real environment>
    Then <observable result a human checks>
