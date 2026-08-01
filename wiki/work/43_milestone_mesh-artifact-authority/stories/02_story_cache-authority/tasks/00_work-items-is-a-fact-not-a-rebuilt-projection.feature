<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — AC1: `work_items` is reclassified `projection` → `fact` in
# `src/effects/stores.mjs`, and the RECLASSIFICATION IS THE ENFORCEMENT — `wholesaleDelete`
# (`global-work-store.mjs:45-61`) already throws before running for any table not classified
# `"projection"`, so the control's delete-and-rebuild (`:459`) cannot survive the
# reclassification even by accident. The cut is scoped to exactly ONE table: `projection_errors`
# (swept at the very next line, `:460`) stays a projection and keeps being rebuilt per publish.
# LITMUS: every Then is confirmable from one of three outsider-visible channels —
#   (a) the CODED ERROR a wholesale sweep now raises, `fact-table-wholesale-delete`;
#   (b) a fresh read of the workspace's CACHED ROWS through the store's public read surface
#       (`readWorkspaceItems` — the same rows the fleet `/api/mesh/status` payload renders as
#       `items[]`, and the board's `aof work list --mesh` overlay reads);
#   (c) the publish call's own RESULT ENVELOPE plus the workspace's `last_published_at`.
# No source read. "The sweep call no longer exists anywhere in src/" is a source ABSENCE and is
# the arch-test's job (`acd-work-items-single-writer`, committed green and ARMED at this cut) —
# never a scenario's.
# NOTE (43/04 dependency): the provenance columns `node_id` / `updated_at` land on `work_items`
# in `04_story_staleness-and-resync` (schema v8, ADR-006). NOTHING in this file reads them —
# every Then here is column-independent.

@executable @cli @work @distribution
Feature: work_items is a FACT — the publish tick can no longer sweep it, and the store gate refuses if anything tries
  In order that a row reported by whichever node authored it can never be deleted by another node's periodic rebuild
  the mesh cache must classify `work_items` as a fact, so the wholesale delete-and-rebuild is refused at the store gate rather than avoided by convention

  Background:
    Given a fresh mesh cache with the workspace "acme" registered
    And the control node's own work stream on disk carries milestone "43" and its stories

  # Headline: the tick still runs, still reports, still records that it ran — it simply
  # stops sweeping. A reclassification WITHOUT the publish rewrite would surface here as
  # the coded error escaping the tick, which is why the "no error raised" Then is load-bearing.
  Scenario: the control's publish tick completes and records itself, with no wholesale delete of work_items
    When the control node publishes its workspace snapshot
    Then the publish returns a result reporting the item count and the publish timestamp
    And no `fact-table-wholesale-delete` error is raised by the tick
    And the workspace's `last_published_at` advances to that tick's timestamp
    And a fresh read of the cached rows reports every ref the control's disk carries

  # The guard IS the enforcement: the sweep is refused at the store gate, and the refusal
  # leaves the table exactly as it was (a refusal that had already deleted would be worse
  # than no guard at all).
  Scenario: a wholesale delete of work_items is refused with a coded error and changes nothing
    Given the control has published, so "acme" has cached rows for every ref on its disk
    When a wholesale delete of the "work_items" table is attempted for workspace "acme"
    Then it is refused with the coded error "fact-table-wholesale-delete"
    And every cached row that was readable before the attempt is still readable afterwards

  # The reclassification is scoped to ONE table. The two streamed content tables were already
  # facts (m42 leg d5 — the reason streamed docs survive worktree cleanup while the row under
  # them reverted); `projection_errors` is swept at the line immediately after the work_items
  # sweep and must KEEP being swept, or a fixed error would linger in the cache forever.
  Scenario Outline: only work_items changes class — the tables around it keep theirs
    Given the control has published, so "acme" has rows in each cache table
    When a wholesale delete of the "<table>" table is attempted for workspace "acme"
    Then the sweep <outcome>

    Examples: the tables at and around the publish path
      | table             | outcome                                                        |
      | work_items        | is refused with the coded error "fact-table-wholesale-delete"  |
      | work_item_docs    | is refused with the coded error "fact-table-wholesale-delete"  |
      | work_item_runs    | is refused with the coded error "fact-table-wholesale-delete"  |
      | projection_errors | removes that workspace's rows — it is still a rebuilt projection |

  # projection_errors staying a rebuilt projection is observable end-to-end: a record doc that
  # cannot be parsed is reported, and the report DISAPPEARS once the doc is repaired. (What must
  # NOT happen to the item's own cached row on that failing tick is task 02's retraction case.)
  Scenario: a repaired record doc drops out of the cached projection errors on the next publish
    Given one item's record doc has unparseable frontmatter and the control has published
    And the cached projection errors for "acme" name that item's record doc
    When the record doc is repaired and the control publishes again
    Then the cached projection errors for "acme" no longer name that record doc
    And the cached row for that item reports its repaired status
