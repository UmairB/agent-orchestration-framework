<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the two thin CLI commands (ADR-002) `aof work insert-milestone` and
# `aof work insert-uat`: each opens a slot at P in the top-level space (via the
# story-01 engine) then scaffolds the new item's skeleton from
# .aof/templates/work/<type>/ into that slot, with correct identity frontmatter.
# LITMUS: every Then is confirmable from `aof work insert-milestone|insert-uat --json`
# stdout plus a fresh `aof work find|list|validate --json` read afterward — no source
# read. NOTE the observable surface of a fresh read: `aof work find <ref> --json`
# returns {ref,type,slug,status,title,parent,dir} — it does NOT surface `depends`,
# `created`, `updated`, or a raw frontmatter `number`; `validate --json` checks
# created/updated PRESENCE and that parent/depends RESOLVE, not their exact values.

@cli @work @work-stream @executable
Feature: insert-milestone and insert-uat place a new top-level driver at P and scaffold its skeleton from the same templates add-* uses
  In order that work discovered mid-flight lands beside related items instead of always at the tail
  aof work insert-milestone and aof work insert-uat must open a slot at the caller's target position P, shift every pre-existing top-level item that was >= P up by one, and scaffold the new item's skeleton at P

  Background:
    Given a fixture work stream with top-level items numbered 00 through 04

  # Headline: insert-milestone places a new milestone at P and shifts the tail up.
  Scenario: insert-milestone places the new milestone at P and every pre-existing item >= P shifts up by exactly one
    When I run `aof work insert-milestone "widget-support" --at 2 --json`
    Then the command reports the new item's ref as "2"
    And a fresh `aof work find 2 --json` resolves a milestone with slug "widget-support"
    And the item that was previously numbered "02" now resolves at ref "3"
    And the item that was previously numbered "04" now resolves at ref "5"

  # Headline: insert-uat places a new uat session at P the same way.
  Scenario: insert-uat places the new uat session at P and every pre-existing item >= P shifts up by exactly one
    When I run `aof work insert-uat "release-gate" --at 1 --json`
    Then the command reports the new item's ref as "1"
    And a fresh `aof work find 1 --json` resolves a uat session with slug "release-gate"
    And the item that was previously numbered "01" now resolves at ref "2"

  # The scaffold reuses the SAME template as add-milestone/add-uat — the new item's
  # skeleton is a valid record doc with correct identity frontmatter from the start.
  # LITMUS: identity is confirmed via `find` (ref/type/slug) and `validate` (which
  # requires created+updated present and folder<->frontmatter consistent). The exact
  # created/updated=today VALUE is a scaffold detail no black-box read surfaces (find
  # returns no dates; validate only checks presence), so it is story-01's engine-API
  # assertion — here we assert the observable proxy: the item resolves and is valid.
  Scenario Outline: the new item is scaffolded from the same template add-<type> uses, with correct identity frontmatter
    When I run `aof work insert-<type> "<slug>" --at 2 --json`
    Then a fresh `aof work find 2 --json` resolves a <type> with slug "<slug>" at ref "2"
    And a fresh `aof work validate --json` reports zero findings for the new item's record doc

    Examples:
      | type      | slug           |
      | milestone | widget-support |
      | uat       | release-gate   |

  # The re-order is correct end-to-end and validate-green (ADR-003 Tier 1, the
  # acceptance bar): after the insert, the whole stream — including any depends
  # edges and nested-story parents that pointed at a shifted item — resolves clean.
  # LITMUS: validate-green IS the Tier-1 acceptance bar (no dangling parent/depends);
  # nested-story placement is confirmed black-box via `find`'s parent field (the
  # story re-homes under its milestone's new ref). The exact rewritten VALUE of a
  # depends/parent edge is story-01's engine-API assertion, NOT black-box observable
  # here — no read surfaces a depends value, and a dense stream can mask a
  # wrong-but-still-resolving number; this task asserts the bar validate enforces.
  Scenario: after an insert-milestone, the whole stream is validate-green with no manual repair
    Given the milestone at "03" has a nested story "beta-flow"
    And item "04" declares `depends: [3]`
    When I run `aof work insert-milestone "widget-support" --at 2 --json`
    Then a fresh `aof work validate --json` over the whole stream reports zero findings
    And a fresh `aof work find "beta-flow" --json` resolves the nested story under its milestone's new ref "4"
