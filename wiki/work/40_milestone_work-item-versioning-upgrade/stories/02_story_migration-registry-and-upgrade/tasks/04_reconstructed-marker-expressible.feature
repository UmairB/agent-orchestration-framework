<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the registry can EXPRESS a reconstructed-marker (ADR-008, fitness
# acd-reconstructed-marker-expressible): a transform descriptor may declare
# `reconstructs: true`, and a doc it produces is written with a `reconstructed: true`
# frontmatter marker — the exact analogue of the import leg's `imported: true`
# (import/materialize.mjs). The 0→1 stamp transform records a TRUE version and sets NO
# marker; `aof upgrade` transforms SHAPE only and never revises authored body prose
# (ADR-004 body-byte-identity). NO backfill is performed here — this proves the framework
# is READY to carry m39's backfill without doing it (the readiness criterion).
# LITMUS: expressibility from a SYNTHETIC reconstructing transform over a fixture whose
# produced doc's on-disk frontmatter carries `reconstructed: true`; the stamp's no-marker
# and shape-only guarantees from the fixture's on-disk frontmatter + body byte-identity;
# and "no backfill" from the EXPORTED descriptors carrying no `reconstructs: true`. No
# source read.

@cli @work @work-stream
Feature: the registry can express a reconstructed-marker while the stamp transform sets none and `aof upgrade` transforms shape only
  In order that the framework is ready to carry a future content backfill without silently presenting inference as authored fact
  a transform may declare `reconstructs: true` and produce a doc marked `reconstructed: true`, the 0→1 stamp must set no such marker, and `aof upgrade` must transform frontmatter shape only — never authored body prose — with no reconstruction performed in this milestone

  Background:
    Given the upgrade module exporting WORK_ITEM_MIGRATIONS, the 0→1 stamp transform, and the transform-scoped frontmatter writer

  # Expressibility: a synthetic transform that declares `reconstructs: true` produces a
  # doc carrying the `reconstructed: true` marker — the `imported: true` analogue.
  @executable
  Scenario: a transform declaring `reconstructs: true` produces a doc carrying the `reconstructed: true` marker
    Given a synthetic registry transform whose descriptor declares `reconstructs: true`
    And a fixture item that transform applies to
    When that transform runs over the fixture item
    Then the doc it produces carries a `reconstructed: true` frontmatter marker

  # The stamp is NOT a reconstruction: it records a true version and sets no marker.
  @executable
  Scenario: the 0→1 stamp transform sets NO reconstructed marker
    Given an unstamped fixture item
    When I run `aof upgrade` and apply the 0→1 stamp over it
    Then its frontmatter now reads `schema: 1` with an `aofVersion` string
    And its frontmatter carries NO `reconstructed` marker
    And the exported descriptor for the 0→1 stamp does not declare `reconstructs`

  # Shape only: the writer rewrites the frontmatter block and leaves authored body prose
  # byte-identical — `aof upgrade` never revises prose (ADR-004).
  @executable
  Scenario: `aof upgrade` transforms frontmatter shape only and leaves authored body prose byte-identical
    Given an unstamped fixture item with authored body prose below its frontmatter
    When I run `aof upgrade` and apply over the fixture item
    Then only the leading frontmatter block changed
    And the authored body is byte-identical to before the upgrade

  # Readiness, not backfill: the capability is present but UNUSED — the real registry
  # declares no reconstructing transform, and upgrading the fixture produces no marked doc.
  @executable
  Scenario: the marker is expressible but no reconstruction is performed in this milestone
    Then no descriptor in the exported WORK_ITEM_MIGRATIONS declares `reconstructs: true`
    And running `aof upgrade` and applying over the fixture stream produces no doc carrying a `reconstructed` marker
