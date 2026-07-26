<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — `aof upgrade` is dry-run-first (ADR-005, the `aof project migrate`
# dry-run/apply face): `--dry-run` REPORTS what would change and mutates nothing; the
# apply performs the transforms and writes through story 01's atomic (temp+rename)
# frontmatter writer (ADR-004); and a stream schema NEWER than this build is a REFUSAL,
# not a downgrade (the global-work-store.mjs:30-37 precedent applied to the document
# stream). Exercised on a fixture stream mixing unstamped (schema-0) and stamped
# (schema-1) record docs.
# LITMUS: the dry-run's no-mutation half is confirmed by a before/after `aof work
# list --json` that is byte-identical AND by every record doc's on-disk frontmatter being
# unchanged; the apply half by the fixture's on-disk frontmatter after; the refusal by a
# non-zero exit plus the newer-than-build doc left byte-untouched — never a source read.

@cli @work @work-stream
Feature: `aof upgrade` reports before it writes, applies through the atomic writer, and refuses a stream newer than the build rather than downgrading it
  In order that catching a stale stream up is a command I can preview before I trust it
  `aof upgrade --dry-run` must report what would change without mutating anything, the apply must transform only the stale items through the atomic writer, and a schema newer than this build must be refused rather than downgraded

  Background:
    Given a fixture work stream whose items are a mix of unstamped (no `schema` key, read as 0) and stamped (`schema: 1`) record docs

  # Dry-run REPORTS the stale items and writes nothing — the before/after read and every
  # record doc's on-disk frontmatter are unchanged.
  @executable
  Scenario: `aof upgrade --dry-run` reports the items that would change and mutates nothing
    Given a fresh `aof work list --json` snapshot of the fixture before the run
    When I run `aof upgrade --dry-run` over the fixture stream
    Then the report names every unstamped (schema-0) item as pending the 0→1 stamp transform
    And it names no already-stamped (schema-1) item
    And a fresh `aof work list --json` after the run is byte-identical to the before snapshot
    And every record doc's on-disk frontmatter is unchanged

  # Apply transforms only the stale items, through the atomic writer, and leaves the
  # stream validate-green.
  @executable
  Scenario: applying `aof upgrade` stamps every unstamped item and leaves the already-stamped ones untouched
    When I run `aof upgrade` and confirm the apply over the fixture stream
    Then each previously-unstamped item's on-disk frontmatter now reads `schema: 1` with an `aofVersion` provenance string
    And each already-stamped item's record doc is byte-identical to before the apply
    And a fresh `aof work validate --json` over the fixture reports zero findings

  # The preview is honest: the exact set dry-run names as pending is the exact set apply
  # changes.
  @executable
  Scenario: the items dry-run names as pending are exactly the items the apply changes
    Given I run `aof upgrade --dry-run` and record the set of items reported pending
    When I then run `aof upgrade` and apply over the same fixture stream
    Then the set of record docs whose on-disk frontmatter changed equals the recorded pending set

  # A stream newer than this build is a refusal, not a downgrade (the store precedent).
  @executable
  Scenario: a stream schema newer than this build is refused, never downgraded
    Given the fixture also contains an item whose frontmatter reads a `schema` higher than WORK_ITEM_SCHEMA_VERSION
    When I run `aof upgrade` over the fixture stream
    Then the command refuses with a schema-newer-than-build error and exits non-zero
    And the newer-than-build item's record doc is left byte-untouched
    And no item in the fixture is written to a lower `schema` than it had
