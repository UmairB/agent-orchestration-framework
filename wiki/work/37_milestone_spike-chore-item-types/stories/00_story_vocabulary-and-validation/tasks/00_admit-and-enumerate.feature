<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — what is observably true when spike/chore folders are enumerated as first-class types.
# Litmus: every Then is confirmable from `aof work find|list --json` stdout, no source read.
# Structural invariants (ITEM_RE shape, isDriver truthiness) are FF-3701/FF-3702 in test/arch/ — NOT here.

@cli @work @work-stream @executable
Feature: spike and chore folders are enumerated as first-class item types
  In order to track investigative and housekeeping work as real work items
  the system must resolve and list a NN_spike_<slug> / NN_chore_<slug> folder as its own type

  Background:
    Given a work stream that contains a milestone, a story under it, an adhoc task,
      a uat session, a NN_spike_<slug> folder, and a NN_chore_<slug> folder, each with a valid record doc

  # Headline: a spike folder resolves as type `spike` on the find --json contract.
  Scenario: aof work find resolves a spike folder as type spike
    When I run `aof work find <spike-number> --json`
    Then the single result row has a `type` field equal to "spike"
    And its `ref` field equals the spike's two-digit slot number

  # Headline: a chore folder resolves as type `chore`.
  Scenario: aof work find resolves a chore folder as type chore
    When I run `aof work find <chore-number> --json`
    Then the single result row has a `type` field equal to "chore"
    And its `ref` field equals the chore's two-digit slot number

  # The closed vocabulary: the two new types AND the original four all resolve;
  # a folder outside the vocabulary is not enumerated at all.
  Scenario Outline: the item vocabulary admits the six known types and rejects the unknown one
    When I run `aof work find <query> --json`
    Then the result <resolves> as type <type>

    Examples:
      | query            | folder-name-shape         | type      | resolves            |
      | <milestone-num>  | NN_milestone_<slug>       | milestone | resolves            |
      | <story-ref>      | NN_story_<slug>           | story     | resolves            |
      | <task-num>       | NN_task_<slug>            | task      | resolves            |
      | <uat-num>        | NN_uat_<slug>             | uat       | resolves            |
      | <spike-num>      | NN_spike_<slug>           | spike     | resolves            |
      | <chore-num>      | NN_chore_<slug>           | chore     | resolves            |
      | <widget-num>     | NN_widget_<slug>          | —         | yields zero rows    |

  # A bogus type outside the closed enum is invisible to the engine entirely — it never
  # appears in the whole-stream listing (its folder is skipped by enumeration).
  Scenario: a folder outside the vocabulary is absent from the stream listing
    Given the stream also contains a NN_widget_<slug> folder
    When I run `aof work list --json`
    Then no element of the array has `slug` equal to the widget folder's slug
    And no element of the array has `type` equal to "widget"

  # Headline: a ready spike/chore appears in the whole-stream listing.
  Scenario Outline: aof work list includes a ready <type> in the stream listing
    Given the <type> folder's record doc has status "not-started"
    When I run `aof work list --json`
    Then some element of the array has `type` equal to "<type>"
    And that element's `slug` equals the <type> folder's slug
    And that element's `parent` field is null

    Examples:
      | type  |
      | spike |
      | chore |
