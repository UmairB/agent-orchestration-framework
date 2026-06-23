@cli @adapter @memory
Feature: --dry-run previews what it would materialize and writes / indexes / networks nothing
  In order to let a user see what an import WOULD recover before committing it, --dry-run must recover +
  preview the artifacts (and the record count) it would materialize while leaving the import store
  unchanged, the memory index untouched, and — for a remote source — performing only a read-only fetch
  with no local write, exactly the planning-init dry-run discipline.

  # ADR-002: --dry-run recovers + previews the artifacts it WOULD materialize (and the records they
  # would yield) and writes / indexes / networks-for-remote nothing — the src/planning-init.mjs dry-run
  # discipline (a dry-run spawns / writes / networks nothing; the live commit is never resolved). The
  # @executable rows run OFFLINE against a local fixture repo read in place via the injection seam
  # (AOF_PLANNING_* / resolveInjectedSha idiom) behind a fixed recovery input (recovery is story 01).
  # The @manual row needs a real REMOTE repo + live network (the read-only fetch), so it is tagged
  # @manual and asserts only the observable outcome.
  #
  # These are OBSERVABLE behaviours: a dry-run exits 0 and prints a preview + a record count; after it
  # the import store has no new/modified file and the memory index is unchanged; --json emits the
  # preview as structured data without writing. The STRUCTURAL invariant "no git write verb / no
  # shell-string spawn is ever constructed; the only external fetch is the read-only git ls-remote /
  # fetch argv idiom" is the story-03 arch-test acd-import-read-only-source — comment-only, not a Then.

  Background:
    Given a local fixture aof-structured source repo with a recoverable milestone "00"
    And a fixed recovery input for milestone "00"

  @executable
  Scenario: --dry-run previews the artifacts and the record count it would materialize
    When I run "aof import milestone <fixture-repo> 00 --dry-run"
    Then the command exits 0
    And stdout previews the artifacts it would materialize
    And stdout reports the record count it would yield

  @executable
  Scenario: after --dry-run the import store is unchanged and the memory index is untouched
    Given a record of the import store and the memory index before the run
    When I run "aof import milestone <fixture-repo> 00 --dry-run"
    Then the command exits 0
    And no file is created or modified in the import store
    And the memory index is unchanged

  @executable
  Scenario: --dry-run with --json emits the preview as structured data without writing
    When I run "aof import milestone <fixture-repo> 00 --dry-run --json"
    Then the command exits 0
    And the JSON preview lists the artifacts it would materialize
    And the JSON preview reports the record count it would yield
    And no file is created or modified in the import store

  # @manual: needs a real REMOTE repo + live network — the read-only fetch (git ls-remote / read-only
  # fetch into a scratch dir, NEVER a clone-into-source). Cannot run offline in CI; asserts only the
  # observable outcome — the preview is produced and nothing is written locally.
  @manual
  Scenario: --dry-run against a real remote repo fetches read-only and writes nothing locally
    Given a reachable remote source repo URL with a recoverable milestone
    When I run "aof import milestone <remote-url> <selector> --dry-run"
    Then the command exits 0
    And stdout previews the artifacts it would materialize
    And no import store is created locally
    And the memory index is unchanged
