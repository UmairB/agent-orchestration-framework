@cli @adapter @work-stream
Feature: the projection nests a routed milestone under its parent page, honestly top-level when the parent is unresolvable
  In order to make a routed milestone appear UNDER its phase/parent on the board, one level above its stories
  the projection must, when a milestone's routing resolves a parent page id, attach a relation to that page id
  through the chosen board's relationProperty (the same property a story uses for its milestone), and — when the
  parent is absent or unresolvable — attach NO relation and record an honest reason so the milestone projects
  top-level, never a relation to a fabricated id; stories keep nesting under their milestone.

  # ADR-001/003: the parent page id comes from resolveNotionRouting (a raw page-id verbatim, or a key resolved
  # in the chosen board's parents). The relation is set via the board's relationProperty — the SAME property a
  # story uses (no new relation property), so the board nests parent → milestone → story. ADR-005/006: an
  # absent/unresolvable parent ⇒ relation undefined + a reason; the milestone op is otherwise the m17 op
  # (top-level). No Notion read on this path.
  #
  # OBSERVABLE behaviours of the PURE projection over fixtures — @executable. The structural no-read / committed
  # guarantees are FF-D / FF-A (story 02), NOT Thens here. Comment-only.

  Background:
    Given a config with a board "ops" whose relationProperty is "Sub-tasks" and whose parents bind "p1" to "page-P1"
    And the default board is "ops"
    And a milestone "18" with a story "18/00" on disk

  @executable
  Scenario: a milestone with a resolved parent carries a relation to the parent page id
    Given milestone "18" routes to board "ops" with parent key "p1"
    When I project the milestone
    Then the milestone op carries a relation through "Sub-tasks" to "page-P1"

  @executable
  Scenario: a raw page-id parent nests the milestone under that page verbatim
    Given milestone "18" routes to board "ops" with parent "11112222333344445555666677778888"
    When I project the milestone
    Then the milestone op carries a relation through "Sub-tasks" to "11112222333344445555666677778888"

  # Honest top-level: a present-but-unresolvable parent key does NOT fabricate an id — no relation. The reason
  # is PRODUCED by the resolver (story 00) and threaded onto the op verbatim — the projection does not re-derive
  # the key lookup (that lives in resolveNotionRouting).
  @executable
  Scenario: an unresolvable parent key projects top-level carrying the resolver's reason
    Given milestone "18" routes to board "ops" with parent key "ghost" absent from the board's parents
    When I project the milestone
    Then the milestone op carries no parent relation
    And the milestone op carries the resolver's reason naming the unresolvable parent key

  # Clean top-level (a board, no parent) must NOT carry a spurious reason — distinguishing it from the
  # unresolvable case above.
  @executable
  Scenario: a milestone with a board but no parent projects top-level with no reason
    Given milestone "18" routes to board "ops" with no parent
    When I project the milestone
    Then the milestone op carries no parent relation
    And the milestone op records no reason

  # Stories keep the §A3 self-relation to the milestone page — and that page id is read from the ROUTED board's
  # sidecar bucket, not another board's (guards against a routing bug silently nulling the story's parent).
  @executable
  Scenario: a story's self-relation parent is read from the routed board's sidecar bucket
    Given milestone "18" routes to board "ops" with parent key "p1"
    And the sidecar holds the milestone page id "page-M" under "ops" and a DIFFERENT id under "growth"
    When I project the milestone
    Then the story "18/00" op carries a relation through "Sub-tasks" to "page-M"

  # The coupled-reason precedence the rewrite touches (projection couples the no-statusMap skip reason with the
  # phase/parent reason): a milestone that is BOTH unmapped-status AND unresolvable-parent must report BOTH.
  @executable
  Scenario: a milestone both unmapped-status and unresolvable-parent reports both reasons
    Given milestone "18" routes to board "ops" with parent key "ghost" absent from the board's parents
    And the milestone's status is absent from the "ops" board's statusMap
    When I project the milestone
    Then the milestone op is "skip"
    And the reason names BOTH the missing status mapping AND the unresolvable parent key
    And the milestone op carries no parent relation
