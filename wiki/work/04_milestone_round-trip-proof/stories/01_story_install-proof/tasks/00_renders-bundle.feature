@cli @assets @round-trip @executable
Feature: a cold aof work init renders the full ACD bundle
  In order to trust the install lands a complete ACD setup from a cold start
  every supported bundle member must render under the fresh repo at its conventional location.

  # Overlaps milestone 01's work-init by design (ADR-002/003): this re-proves the install COMPOSES
  # from a cold start inside a hermetic repo (the harness's createRoundTripRepo + installBundle) —
  # the end-to-end assertion 01's per-unit tests don't make. Black-box throughout: every Then is a
  # file that does or does not exist on disk, or a frontmatter value, or a process exit code.

  Background:
    Given a fresh isolated repo with the bundle installed via the harness

  # Headline: a representative member of each of the three kinds is present after a cold install.
  Scenario: a representative member of each kind lands at its conventional path
    Then the file ".claude/agents/aof-architect.md" exists in the repo
    And the file ".claude/commands/aof/refine.md" exists in the repo
    And the file ".aof/templates/work/milestone/SPEC.md" exists in the repo

  # Command members preserve ACD's "/aof:" invocation namespace (ADR-007): they render under the
  # "commands/aof/" subdirectory, never flat, and carry the namespaced invocation. All three facts
  # are black-box (file presence, a frontmatter value, file absence).
  Scenario: command members are namespaced under aof, not written flat
    Then the file ".claude/commands/aof/refine.md" exists in the repo
    And that file's frontmatter "aof-invocation" equals "/aof:refine"
    And no file is written flat at ".claude/commands/refine.md" in the repo

  # The case matrix: each member kind renders to its conventional on-disk location. <location> is a
  # repo-relative, forward-slashed path. agents/commands land under the ".claude" runtime root;
  # template files land at the fixed bundle template location ".aof/templates/work/<id>/<file>"
  # (runtime-independent — NOT under ".claude", NOT under "wiki/").
  Scenario Outline: a bundle member of a given kind lands at its conventional location
    Then the file "<location>" exists in the repo

    Examples:
      | kind     | id            | location                                |
      | agent    | aof-architect | .claude/agents/aof-architect.md         |
      | agent    | aof-developer | .claude/agents/aof-developer.md         |
      | command  | refine        | .claude/commands/aof/refine.md          |
      | command  | continue      | .claude/commands/aof/continue.md        |
      | command  | verify        | .claude/commands/aof/verify.md          |
      | template | milestone     | .aof/templates/work/milestone/SPEC.md   |
      | template | story         | .aof/templates/work/story/STORY.md      |
      | template | task          | .aof/templates/work/task/example.feature|

  # --dry-run is the read-only contract: a cold init in --dry-run mode writes nothing and exits 0.
  # The proof is the absence of the canonical members AND the absence of the lock the real install
  # would write (ties the no-write guarantee to the lock artifact task 01 owns).
  Scenario: --dry-run reports planned writes but writes nothing on a cold repo
    Given a fresh isolated repo with no install
    When "aof work init --dry-run" is run in the repo
    Then the command exits 0
    And the file ".claude/agents/aof-architect.md" does not exist in the repo
    And the file ".claude/commands/aof/refine.md" does not exist in the repo
    And the file ".aof/templates/work/milestone/SPEC.md" does not exist in the repo
    And the file ".aof/aof.lock.json" has no "work" section in the repo
