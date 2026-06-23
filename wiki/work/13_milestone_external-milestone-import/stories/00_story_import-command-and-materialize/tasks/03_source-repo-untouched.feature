@cli @adapter @memory
Feature: the source repo is never mutated by an import
  In order to make "read another repo's milestone" safe to run against any source, an import must read
  the source repo and NEVER mutate it — a local path is read in place and its working tree + git state
  are byte-for-byte identical before and after, and a remote URL is fetched read-only with nothing
  pushed, committed, or written back to the source.

  # ADR-002 (cross-cutting constraint): the source repo is NEVER mutated. A local <repo> is read in
  # place; a remote is fetched read-only via the src/planning-init.mjs git-argv-spawn idiom (git
  # ls-remote / read-only fetch into a throwaway dir, never a clone INTO the source, never a write
  # back). The @executable rows run OFFLINE against a local fixture repo read in place via the
  # injection seam. The @manual row needs a real REMOTE URL + live network, so it is tagged @manual.
  #
  # These are OBSERVABLE behaviours: the fixture repo's tree state / `git status` is identical before
  # and after an import, and no file in the source is created/deleted/modified. The STRUCTURAL invariant
  # "no git write verb (commit/push/checkout-into-source/clone-into-source) is ever constructed and no
  # shell-string spawn is used" is the story-03 arch-test acd-import-read-only-source — it greps the
  # import module's source; it is comment-only here, NOT a scenario Then (you cannot observe "a verb was
  # not constructed" from outside; you observe that the source tree did not change).

  Background:
    Given a local fixture source repo under git with a recoverable milestone "00"

  @executable
  Scenario: after importing from a local fixture repo the source tree and git state are unchanged
    Given the source repo's tree hash and "git status --porcelain" before the import
    When I run "aof import milestone <fixture-repo> 00"
    Then the command exits 0
    And the source repo's tree hash after the import equals the one before
    And the source repo's "git status --porcelain" after the import equals the one before

  @executable
  Scenario: importing creates, deletes, or modifies no file in the source repo
    When I run "aof import milestone <fixture-repo> 00"
    Then the command exits 0
    And no file in the source repo is created
    And no file in the source repo is deleted
    And no file in the source repo is modified

  # @manual: needs a real REMOTE URL + live network — a read-only fetch with no write-back. Cannot run
  # offline in CI; asserts only the observable outcome — nothing is pushed/committed/written to the
  # source. (The "no git write verb is constructed" structural guarantee is acd-import-read-only-source,
  # story 03 — not asserted here.)
  @manual
  Scenario: importing from a real remote URL fetches read-only and writes nothing back to the source
    Given a reachable remote source repo URL with a recoverable milestone
    And the remote source repo's head commit before the import
    When I run "aof import milestone <remote-url> <selector>"
    Then the command exits 0
    And the remote source repo's head commit after the import equals the one before
    And nothing is pushed, committed, or written back to the source
