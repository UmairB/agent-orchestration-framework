<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the version READER (ADR-001/ADR-003): a record doc's `schema`
# resolves to a non-negative INTEGER (the only field a migration selector reads)
# and `aofVersion` to a plain STRING (provenance, never parsed for logic); a
# missing `schema` reads as 0 (the pre-versioning baseline) and a non-integer
# coerces to 0 too; `WORK_ITEM_SCHEMA_VERSION` is the single exported int
# constant, value 1. The existing minimal `parseFrontmatter` (work.mjs:314) is
# UNCHANGED — it already parses both keys as scalars (18/ADR-007 protected); the
# int coercion lives in the reader, not the parser.
#
# LITMUS: every Then is confirmable from the fixture's on-disk state after the
# read — the confirmation seam is the STORY-01 exported schema reader's RETURN
# (indicatively `readItemSchema`/`readItemVersion`; `readMeta` at work.mjs:344 is
# private) given the frontmatter authored on disk, cross-checked against a fresh
# `parseFrontmatter` call proving the parser hands back the RAW scalar unchanged
# (so the coercion is the reader's, not a parser change). NOTE the `aof work
# list --json` contract is frozen at its seven fields (board ADR-002 — "no
# convenience fields"), so it deliberately does NOT surface `schema`; the reader
# API is the read seam, not a CLI list read. No source read anywhere.

@cli @work @work-stream @executable
Feature: the reader resolves an item's schema as an integer and its aofVersion as a string, reading an unstamped item as the pre-versioning baseline 0
  In order that a migration selector has a deterministic integer to compare and a human has legible provenance
  the reader must resolve a record doc's `schema` to a non-negative integer (missing or non-integer ⇒ the baseline 0) and its `aofVersion` to a plain string, without changing the shared frontmatter parser

  Background:
    Given a fixture work stream scaffolded into a temp dir
    And a milestone item whose record-doc frontmatter I author line-by-line

  # Headline: the coercion matrix. A present integer reads back as itself; a
  # non-numeric value falls to the baseline 0. `schema: 2` proves the reader is a
  # FAITHFUL read, never clamped to the current constant — an item stamped ahead
  # must read ahead (so story 03 staleness never mis-flags it). The missing-key
  # baseline is its own scenario below (a "no key" case is not a value column).
  Scenario Outline: a present schema value resolves to that integer; a non-integer falls to the baseline 0
    Given the item's record-doc frontmatter carries the line "schema: <value>"
    When the reader resolves that item's schema
    Then the resolved schema is the integer <resolved>
    And the resolved schema is a whole number, never a string

    Examples:
      | value  | resolved |
      | 1      | 1        |
      | 0      | 0        |
      | 2      | 2        |
      | latest | 0        |

  # The unstamped baseline (ADR-003): no `schema` key at all reads as 0 — the
  # pre-versioning baseline the registry migrates FROM, mirroring
  # readSchemaVersion's null→needs-migration treatment (global-work-store.mjs:80-87).
  Scenario: an item with no schema key resolves to the baseline schema 0
    Given the item's record-doc frontmatter carries no "schema" key at all
    When the reader resolves that item's schema
    Then the resolved schema is the integer 0

  # `aofVersion` is provenance, never a selector: it reads back as the verbatim
  # string, never coerced to a number.
  Scenario: aofVersion resolves to a plain string, never parsed for logic
    Given the item's record-doc frontmatter carries the line "aofVersion: 0.1.0"
    When the reader resolves that item's version
    Then the resolved aofVersion is the string "0.1.0"
    And the resolved aofVersion is not a number

  # One exported constant, ADR-001: the single declaration of "the current
  # document shape", value 1 at this milestone, mirroring GLOBAL_WORK_SCHEMA_VERSION's
  # single-constant idiom (global-work-store.mjs:7).
  Scenario: WORK_ITEM_SCHEMA_VERSION is a single exported integer constant with value 1
    When I read the exported WORK_ITEM_SCHEMA_VERSION constant
    Then its value is the integer 1
    And it is a whole number, never a string

  # No parser change (18/ADR-007): parseFrontmatter still returns BOTH keys as
  # plain scalars — the int coercion is the reader's job, not the parser's. If the
  # parser had changed, `schema` would come back a number here; it must come back
  # the raw scalar string, and the reader is what turns it into an integer.
  Scenario: parseFrontmatter is unchanged — it returns both version keys as raw scalars
    Given the item's record-doc frontmatter carries "schema: 1" and "aofVersion: 0.1.0"
    When I parse that record doc with the shared parseFrontmatter
    Then the parsed "schema" is the raw scalar "1", not a coerced integer
    And the parsed "aofVersion" is the raw scalar "0.1.0"
