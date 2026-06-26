@cli @adapter @work-stream
Feature: the sync is one-way — disk overwrites Notion on divergence and disk is never written back
  In order to keep aof's on-disk stream the single source of truth, the sync must overwrite a Notion page
  that drifted out-of-band with the on-disk value on the next run (disk always wins on divergence) and must
  leave the on-disk record untouched — no Notion value is ever read back onto disk.

  # ADR-003: the sync is ONE-WAY (disk → Notion). Every Notion call is a write derived from disk
  # (create/patch) or an addressing metadata read; on divergence disk overwrites Notion, and no code path
  # reads a Notion page's status/title and copies it onto disk.
  #
  # @manual: these rows need a LIVE Notion workspace + a real integration token (RESEARCH §A1/A2 — no token
  # on the dev host) — the only way to observe an out-of-band Notion edit being overwritten is against a
  # real board. They assert only the OBSERVABLE one-way behaviour. The STRUCTURAL invariant (no
  # read-Notion → write-disk path; Notion never authoritative) is story-03's arch-test acd-notion-one-way
  # (ADR-005 inv. 2) — referenced here, never asserted as a Then.

  Background:
    Given a live Notion workspace with the board's data-source, status property, and self-relation property
    And a work.integrations.notion config bound to that data-source with a complete statusMap
    And a first sync of milestone "17" has already created and bound every page

  # @manual: a human edits the milestone page's status on the board directly, diverging it from disk; the
  # next sync overwrites it back to the on-disk value — disk wins on divergence.
  @manual
  Scenario: a Notion page edited out-of-band is overwritten from disk on the next sync
    Given the board page for "17" has been edited out-of-band to a status that differs from disk
    And the on-disk status of "17" is unchanged
    When I run "aof work integrations notion sync-work 17"
    Then the command exits 0
    And the board page for "17" again shows the board option mapped from the on-disk status of "17"

  # @manual: the on-disk record is the source of truth and the sync never reads Notion back onto it — after
  # a sync the STORY.md / SPEC.md frontmatter is byte-for-byte unchanged.
  @manual
  Scenario: a sync leaves the on-disk record unchanged and reads no Notion value back onto disk
    Given a record of the on-disk SPEC.md and STORY.md frontmatter for "17" and its stories before the run
    When I run "aof work integrations notion sync-work 17"
    Then the command exits 0
    And the on-disk SPEC.md and STORY.md frontmatter for "17" and its stories are unchanged
