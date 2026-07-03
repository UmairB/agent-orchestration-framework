@docs @assets @distribution @executable
Feature: the migrate command ships in the bundle and the mechanical CLI is untouched
  In order that /aof:migrate lands in every install the same way the other ACD commands do, the
  command is a bundle member whose manifest entry is derived — and adding it changes nothing about
  the mechanical CLI's observable contract.

  # Distribution is the STORY.md hint made testable: a new bundle body
  # (src/bundle/commands/migrate.md → rendered .claude/commands/aof/migrate.md), the manifest
  # regenerated because it is DERIVED, never hand-maintained (ADR-002), landing in installs via
  # "aof work update". The non-regression scenario pins the story's non-goal — no change to
  # "aof migrate"'s observable contract — as a suite-level observable.
  #
  # All rows are offline, deterministic, CI-runnable — the whole feature is @executable.
  # The structural invariants "manifest entries are content-addressed {path, runtime, resource,
  # hash}" and "commands carry commandNamespace aof" are already pinned by the bundle arch-tests —
  # do not restate them as Thens here.

  Scenario: the bundle descriptor lists the migrate command member
    Given the bundle descriptor "src/bundle/bundle.json"
    Then it lists a "migrate" member of kind "command" with the body file "commands/migrate.md"
    And the member renders for the claude runtime under the "aof" command namespace

  Scenario: the shipped manifest is regenerated, not hand-edited
    When the bundle manifest is regenerated from the descriptor
    Then the regeneration reproduces the shipped "src/bundle/manifest.json" byte-for-byte
    And the manifest carries an entry for the rendered migrate command whose hash matches the rendered content

  Scenario: work update lands the rendered command in an install
    Given an installed workspace behind the shipped bundle
    When I run "aof work update"
    Then ".claude/commands/aof/migrate.md" exists in the install
    And its content hash matches the shipped manifest's entry for it

  Scenario: the mechanical CLI's observable contract is unchanged
    Given the story-29 migrate suite and its two fitness functions
    When the full test suite runs with the new command member shipped
    Then every story-29 migrate test and both fitness functions still pass, untouched

  # QA case design (QA-owned matrix): one row per install-state × invocation pair, each pinning the
  # one observable fate of the rendered ".claude/commands/aof/migrate.md" (existence, hash vs the
  # shipped manifest entry, or preserved local bytes). Grounded in the engine's real semantics:
  # a never-initialized repo is refused (nothing written); init and update are symmetric twins;
  # local drift is PRESERVED without --force (ADR-005) and restored with it. The plain
  # behind-the-bundle update row is the headline scenario above — not repeated here.
  # All rows offline and deterministic — @executable via the feature-level tag.
  Scenario Outline: what lands at ".claude/commands/aof/migrate.md" follows the install's state
    Given a target workspace where <install-state>
    When I run <invocation> in it
    Then <rendered-command-outcome>

    Examples: landing and idempotence
      | install-state                                                                    | invocation              | rendered-command-outcome                                                                            |
      | no install exists (never init-ed; no work section in .aof/aof.lock.json)         | "aof work update"       | the run exits non-zero pointing at init, and ".claude/commands/aof/migrate.md" does not exist       |
      | no install exists at all                                                         | "aof work init"         | ".claude/commands/aof/migrate.md" exists and its hash matches the shipped manifest's entry          |
      | a prior update already landed the migrate command (the install is current)       | "aof work update"       | the rendered file is byte-identical before and after — the re-run rewrites nothing                  |
      | the install predates the migrate member (the rendered file is absent)            | "aof work update --dry-run" | the pending render is reported and ".claude/commands/aof/migrate.md" still does not exist       |

    Examples: a tampered local render — preserved by default, restored on --force
      | install-state                                                                    | invocation              | rendered-command-outcome                                                                            |
      | the rendered migrate.md was locally edited (its hash diverges from the manifest) | "aof work update"       | the local bytes are preserved and the run reports the file as drift — nothing is clobbered          |
      | the rendered migrate.md was locally edited (its hash diverges from the manifest) | "aof work update --force" | the file's content hash matches the shipped manifest's entry again — the local edit is gone       |
