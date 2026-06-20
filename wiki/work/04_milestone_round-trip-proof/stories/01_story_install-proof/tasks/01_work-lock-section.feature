@cli @assets @round-trip @executable
Feature: a cold install writes a conformant work section to the unified lock
  In order for the install to be drift-checkable by later aof work update
  init must write the "work" section of .aof/aof.lock.json to the frozen lock-v2 schema.

  # Black-box throughout: every Then reads the on-disk ".aof/aof.lock.json" as JSON and inspects
  # the "work" section. No source is read. The foreign-section-preservation case (milestone 02's
  # ADR-009) is OUT OF SCOPE here — the harness installs into a FRESH repo with no foreign sections,
  # so this proves only the shape of the section a cold install produces.

  Background:
    Given a fresh isolated repo with the bundle installed via the harness

  # Headline: the unified lock exists and its "work" section carries the lock-v2 envelope fields.
  Scenario: the cold install writes a work section with the lock-v2 envelope
    Then the file ".aof/aof.lock.json" exists in the repo
    And its "work" section has a "bundle.version" that is a non-empty string
    And its "work.runtimes" array contains "claude"
    And its "work.generatedAt" is a non-empty string
    And its "work.files" array is non-empty

  # Every rendered file is pinned: each "work.files[]" entry the renderer wrote carries a
  # sha256-prefixed hash and a repo-relative, forward-slashed path. These two facts make the
  # section a usable drift baseline. (Count parity with the rendered set is asserted by checking a
  # representative member of each kind from task 00 has an entry, below.)
  Scenario: every work.files entry is sha256-hashed with a forward-slashed path
    Then every "work.files" entry has a "hash" matching "^sha256:[0-9a-f]{64}$"
    And every "work.files" entry has a "path" containing no backslash

  # The entry SHAPE, per a representative member of each rendered kind. <path> is the forward-slashed
  # repo-relative path; the entry's "resource.id"/"resource.kind" must equal <id>/<kind>. This pins
  # that the lock catalogues agents, namespaced commands, AND template files alike.
  Scenario Outline: the work.files entry for a representative member has the conformant shape
    Then the "work.files" entry at path "<path>" exists
    And that entry's "resource.id" equals "<id>"
    And that entry's "resource.kind" equals "<kind>"
    And that entry's "runtime" is a non-empty string
    And that entry's "hash" matches "^sha256:[0-9a-f]{64}$"
    And that entry's "generatedAt" is a non-empty string

    Examples:
      | kind     | id            | path                                  |
      | agent    | aof-architect | .claude/agents/aof-architect.md       |
      | command  | refine        | .claude/commands/aof/refine.md        |
      | template | milestone     | .aof/templates/work/milestone/SPEC.md |

  # The work section owns only work-stream install state — no package/framework intent leaks in.
  Scenario: the work section carries no package or framework intent on a cold install
    Then its "work.packages" array is empty
    And its "work.frameworks" array is empty
    And its "work.frameworkInstallAttempts" array is empty

  # The eliminated per-vertical lock (milestone 02 ADR-009): the cold install produces exactly one
  # lock file and it is the unified one.
  Scenario: no separate work lock file is written
    Then the file ".aof/aof.work.lock.json" does not exist in the repo
    And the only "*.lock.json" file under ".aof/" in the repo is "aof.lock.json"
