<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the BORN-STAMP (ADR-002): scaffolding a NEW item writes
# `schema: <WORK_ITEM_SCHEMA_VERSION>` and `aofVersion: <packageVersionString()>`
# into the record doc's frontmatter at creation, so a freshly-created item is
# never stale-by-construction. The scaffold seam is the insert/bundle render path
# (insert-shared.mjs — top-level milestone + nested story, ARCHITECTURE story
# boundaries). A native milestone's record doc at scaffold is SPEC.md (recordDoc
# resolves AOF.md-first only when an AOF.md digest exists; a fresh milestone has
# none — work.mjs:287-298); a story's is STORY.md.
#
# LITMUS: every Then is confirmable from the new item's ON-DISK record doc after
# scaffold — read its raw frontmatter (readFile + parseFrontmatter) from the
# fixture temp dir; the schema is asserted EQUAL to the exported
# WORK_ITEM_SCHEMA_VERSION (not a stale hardcoded literal) and the aofVersion
# EQUAL to `packageVersionString()`'s runtime return (not a pinned string, so the
# assertion survives a package bump). The "never stale-by-construction" tie-in is
# read back through the story-01 reader. No source read.

@cli @work @scaffold @executable
Feature: scaffolding a new item stamps it at the current schema and the running aof version, so a freshly-created item is never stale-by-construction
  In order that a newly created work item can already say which aof produced it and never reads as behind on the day it is born
  the scaffold render path must write `schema: <WORK_ITEM_SCHEMA_VERSION>` and `aofVersion: <packageVersionString()>` into the new record doc's frontmatter at creation

  Background:
    Given a fixture work stream scaffolded into a temp dir
    And the aof work templates available to the scaffold render path

  # Headline: whichever in-scope item type is scaffolded, its record doc is born
  # carrying BOTH version keys. Milestone → SPEC.md, story → STORY.md — the two
  # scaffold paths this story touches (insert-shared.mjs + those templates).
  Scenario Outline: a newly scaffolded <type> is born carrying both version keys
    When I scaffold a new <type> into the fixture stream
    Then the new item's record doc "<doc>" frontmatter declares a "schema" key
    And that same frontmatter declares an "aofVersion" key

    Examples:
      | type      | doc      |
      | milestone | SPEC.md  |
      | story     | STORY.md |

  # The born schema is the CONSTANT, not a copied literal: it equals
  # WORK_ITEM_SCHEMA_VERSION (1 at this milestone), so the stamp can never drift
  # behind the current shape.
  Scenario: the born schema equals the current schema constant
    When I scaffold a new milestone into the fixture stream
    Then the new milestone's record doc frontmatter "schema" resolves to the integer WORK_ITEM_SCHEMA_VERSION
    And WORK_ITEM_SCHEMA_VERSION is 1 at this milestone, so the written schema is 1

  # The born provenance is the RUNNING package version — packageVersionString()'s
  # value (asset-base.mjs:235), a string, never an integer and never gating logic.
  Scenario: the born provenance equals the running aof package version
    When I scaffold a new story into the fixture stream
    Then the new story's record doc frontmatter "aofVersion" equals packageVersionString()
    And that aofVersion is a string, never a number

  # The whole point of the born-stamp (ADR-002): a fresh item is at the current
  # shape, so reading it back through the story-01 reader resolves the current
  # schema — a staleness check (story 03) would flag nothing on a new item.
  Scenario: a freshly-created item is never stale-by-construction
    When I scaffold a new story into the fixture stream
    Then the reader resolves the new story's schema as WORK_ITEM_SCHEMA_VERSION
    And so it is at the current shape, not behind it
