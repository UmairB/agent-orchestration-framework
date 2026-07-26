<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-003 Tier 2 (best-effort, NOT gated): insert-story updates the
# milestone SPEC's `## Stories` checklist bullets so a reader sees the new story and
# the shifted refs. validateWork does NOT parse this checklist (confirmed at
# src/work.mjs validateWork ~L569 — it checks folder<->frontmatter, parent, and the
# depends graph only) — so a stale or imperfect bullet is a human-doc nit, never a
# reason for the insert to "fail."
# LITMUS: every Then is confirmable by reading the milestone's SPEC.md `## Stories`
# section after the command runs, and from the command's own exit code / --json
# success field — no source read of the engine.
# TIER BOUNDARY: this file asserts Tier 2 (the ## Stories prose surface). The Tier 1
# validate-green guarantee lives in file 01 and is NEVER coupled to this best-effort
# update — a skipped or stale bullet leaves Tier 1 entirely untouched.

@cli @work @work-stream @executable
Feature: insert-story updates the milestone's Stories checklist on a best-effort basis, and a stale bullet never fails the insert
  In order that the milestone SPEC stays a readable, roughly-accurate map of its stories without making that map a hard correctness gate
  aof work insert-story must add a Stories bullet for the new story and renumber shifted bullets' refs on a best-effort basis, without ever failing the insert over that update

  Background:
    Given milestone "05"'s SPEC.md `## Stories` section lists bullets for "05/00", "05/01", and "05/02"

  # Headline: a new bullet appears for the inserted story, in position.
  Scenario: insert-story adds a Stories bullet for the new story
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then milestone "05"'s SPEC.md `## Stories` section includes a bullet naming ref "05/01" and slug "auth-guard"

  # Headline: shifted siblings' bullets are renumbered to match their new refs.
  Scenario: insert-story renumbers the shifted siblings' Stories bullets to match their new refs
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then milestone "05"'s SPEC.md `## Stories` section includes a bullet naming ref "05/02" for the story formerly "05/01"
    And milestone "05"'s SPEC.md `## Stories` section includes a bullet naming ref "05/03" for the story formerly "05/02"

  # Tier-2 discipline #1: the command still SUCCEEDS (Tier-1 placement intact) even
  # when the ## Stories section is missing and the bullet update cannot be applied —
  # the best-effort surface is skipped, never gated.
  Scenario: insert-story still succeeds when the milestone's Stories section is missing, logging the skip rather than failing
    Given milestone "05"'s SPEC.md has no `## Stories` section
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then the command exits zero and the --json envelope reports success
    And a fresh `aof work find 05/01 --json` resolves the new story at ref "05/01" (Tier-1 placement intact)
    And the --json envelope notes that the `## Stories` checklist update was skipped

  # Tier-2 discipline #2: a stale/unrenumbered pre-existing bullet is a human-doc nit,
  # NOT a validate failure — validateWork does not parse this checklist. This is the
  # explicit Tier-2-vs-Tier-1 boundary: validate (the Tier-1 surface) ignores ## Stories.
  Scenario: a stale Stories bullet left over from before this milestone's refine does not fail aof work validate
    Given milestone "05"'s SPEC.md `## Stories` section has a bullet with a slug that no longer matches any story's folder
    When I run `aof work validate --json`
    Then the report includes no finding about the mismatched Stories bullet
    And `aof work validate` stays green over milestone "05" despite the stale bullet (the checklist is invisible to Tier-1 validate)
