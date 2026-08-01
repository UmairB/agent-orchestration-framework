<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the CO-AUTHORED SETTINGS FILE (STORY.md AC9–AC12, ADR-002):
# `.claude/settings.json` is hand-maintained by the operator, so aof splices only its
# own SELF-IDENTIFYING hook entry through a read-overlay-write merge (indicatively
# `mergeClaudeSettings`, mirroring `mergeLock` at lock.mjs:37-50 and `writeSidecarPatch`
# at node-identity.mjs:74-95, including the latter's skip-the-write-when-byte-identical
# refinement); the whole-file render path is CLOSED for this file so it can never reach
# `planApplyActions`' ungated fall-through (render-plan.mjs:48); and the hook SCRIPT and
# the hook ENTRY ship through DIFFERENT doors — the script as a content-hashed bundle
# asset, the entry through the merge.
# LITMUS: every Then is confirmable from the settings FILE's own bytes before and after
# a run — its parsed content, its byte-for-byte comparison against the prior copy, and
# its mtime — plus the `--json` plan envelope of the command that ran. No source read;
# in particular the invariant "the settings writer never writes the file wholesale" is a
# property of every possible run and is already owned by
# `test/arch/acd-claude-settings-co-authored.test.mjs` — it is NOT restated here. What
# IS asserted here is the observable consequence: after a run, the operator's keys are
# still there, byte for byte, and the plan named no action for the file.
#
# THE FIXTURE, AND A HARD RULE FOR WHOEVER BUILDS THIS: every scenario below runs
# against a BYTE-COPY of the operator's real `.claude/settings.json` placed in a scratch
# workspace. The real file is this repo's live hook config — the `SessionStart` /
# `UserPromptSubmit` / `SessionEnd` session wiring and the `PreToolUse` test-isolation
# guard all depend on it — and NOTHING in this task may write to it. The copy carries
# the operator's measured top-level key set (`hooks`, `enabledPlugins`,
# `extraKnownMarketplaces`, `permissions`, `sandbox`), its five hand-wired hook events
# (`SessionStart`, `UserPromptSubmit`, `SessionEnd`, `PreToolUse`, and `PostToolUse`
# present-but-empty), `permissions.deny` and `sandbox.filesystem.denyRead`.
#
# ONE RESIDUAL CONCERN RAISED AT REFINE (flagged to the PO, not silently encoded): the
# TORN-file rows below follow ADR-002's stated contract literally — a torn read yields
# `{}`. For `mergeLock`'s subject that is safe, because the lock is aof-owned; for a
# CO-AUTHORED file with ~140 possible top-level keys it means a single missing brace in
# the operator's own file is answered by replacing it with an aof-only three-line
# document. The rows are written to the ADR, and the fifth row records the one thing
# that softens it: when there is nothing to splice, the byte-identical skip leaves the
# torn file untouched. If the architect wants a refuse-and-report instead, exactly two
# rows change.

@cli @adapter @distribution
Feature: the co-authored .claude/settings.json takes a surgical, idempotent, retractable merge — never a whole-file render
  In order that an operator's hand-maintained hooks, permissions, sandbox and plugin config survive every aof run — including a `work init`, which treats every unlocked file as fresh
  aof must splice exactly one self-identifying hook entry into one event key inside one top-level key, write nothing when the result is unchanged, retract exactly what it authored, and never render this file whole

  Background:
    Given a scratch workspace whose `.claude/settings.json` is a byte-copy of the operator's hand-authored file
    And an `.aof/aof.config.json` in that workspace declaring the claude-runtime artifact-sync hook

  # HEADLINE (AC9) — the defect this closes, stated as its own negation. A wholesale
  # render builds the file's entire body from `config.hooks` + `config.settings` and
  # nothing else, so every row below is a key it would have deleted.
  @executable
  Scenario Outline: every pre-existing key survives the merge byte-identical
    When the merge runs against the fixture
    Then <subject> is <outcome>

    Examples:
      | subject                        | outcome                                                  |
      | `hooks.SessionStart`           | byte-identical to before                                 |
      | `hooks.UserPromptSubmit`       | byte-identical to before                                 |
      | `hooks.SessionEnd`             | byte-identical to before                                 |
      | `hooks.PreToolUse`             | byte-identical to before                                 |
      | `permissions`                  | byte-identical to before                                 |
      | `sandbox`                      | byte-identical to before                                 |
      | `enabledPlugins`               | byte-identical to before                                 |
      | `extraKnownMarketplaces`       | byte-identical to before                                 |
      | `hooks.PostToolUse`            | grown by exactly one aof-authored entry, and nothing else |
      | the set of top-level keys      | unchanged — no key added, none removed                   |

  # THE MERGE TARGET IS THREE LEVELS DEEP (AC9): not "one key" but one hook array entry,
  # inside one event key, inside one top-level key. Neither existing precedent
  # (`mergeLock`, `writeSidecarPatch`) reaches below the top level, so an operator entry
  # on the SAME event is the case that would break a naive port of either.
  @executable
  Scenario: an operator entry on the same PostToolUse event survives byte-identical beside aof's
    Given the fixture's `hooks.PostToolUse` already holds an operator group with matcher "Bash"
    When the merge runs
    Then the operator's `PostToolUse` group is byte-identical to before
    And aof's entry is present beside it
    And the operator's group keeps its position relative to any other operator group
    And no other event key under `hooks` changed

  # IDEMPOTENCE (AC10) — what the self-identifying marker buys. Without one, the merge
  # cannot tell its own entry from an operator's on the next run, and would either
  # append a duplicate every run or clobber a sibling.
  @executable
  Scenario Outline: running the merge repeatedly leaves exactly one aof-authored entry
    When the merge runs <runs> time(s) with the same config
    Then `hooks.PostToolUse` holds exactly <aofEntries> aof-authored entry
    And the operator's own entries are byte-identical to before the first run
    And the file's bytes after the last run are identical to its bytes after the first

    Examples:
      | runs | aofEntries |
      | 1    | 1          |
      | 2    | 1          |
      | 5    | 1          |

  # THE SKIP-WRITE REFINEMENT (AC9, `writeSidecarPatch`'s own): a merge whose result is
  # byte-identical performs NO write at all. Observable as an mtime that does not move —
  # which is what stops a no-op `work update` looking like an edit to git, to a watcher,
  # or to the operator.
  @executable
  Scenario: a merge whose result is byte-identical writes nothing and leaves no mtime churn
    Given the merge has already run once and aof's entry is present
    When the merge runs again with the same config
    Then the file's bytes are unchanged
    And the file's mtime is unchanged
    And no temporary file is left beside it

  # RETRACTION (AC10): removing the hook from config removes exactly aof's entry and
  # nothing else. The first row is the precise one — the operator's file ships
  # `PostToolUse: []` present-and-empty, so a retraction must return it to `[]`, never
  # delete the key.
  @executable
  Scenario Outline: retracting the hook from config removes exactly aof's entry
    Given `hooks.PostToolUse` holds <before>
    When the claude hook is removed from `.aof/aof.config.json` and the merge runs
    Then `hooks.PostToolUse` holds <after>
    And every other top-level key is byte-identical to before the retraction
    And every other event key under `hooks` is byte-identical to before the retraction

    Examples:
      | before                                   | after                                                     |
      | aof's entry alone                        | an empty array — the key survives, it is not deleted       |
      | an operator group then aof's entry       | the operator group alone, byte-identical, still first      |
      | aof's entry then an operator group       | the operator group alone, byte-identical                   |
      | two operator groups around aof's entry   | both operator groups, byte-identical, in their original order |
      | an empty array (aof never installed)     | an empty array, unchanged — and no write is performed      |

  # THE READ SIDE (AC9): absent / torn / `{}`. The `{}`-vs-missing distinction is real
  # and is what rows 2 and 4 pin — with nothing to splice, a missing file must stay
  # missing (no empty artefact is created) and a present `{}` must stay byte-identical.
  # See the header's residual concern about the torn rows.
  @executable
  Scenario Outline: an absent, empty, torn or empty-object settings file is handled without inventing content
    Given the workspace's `.claude/settings.json` is <before>
    And `.aof/aof.config.json` <declares> the claude-runtime artifact-sync hook
    When the merge runs
    Then the file afterwards is <after>
    And no top-level key is present that the merge did not author or find

    Examples:
      | before                            | declares    | after                                                              |
      | absent (no file at all)           | declares    | created, holding exactly `hooks.PostToolUse` with aof's entry      |
      | absent (no file at all)           | omits       | still absent — no empty file is created                            |
      | present and zero bytes            | declares    | read as `{}`, then written with exactly aof's entry                |
      | present and exactly `{}`          | omits       | byte-identical, mtime unchanged — no write is performed            |
      | present and torn (truncated JSON) | declares    | read as `{}`, then written with exactly aof's entry                |
      | present and torn (truncated JSON) | omits       | byte-identical — the skip-write leaves the torn file untouched     |

  # SELF-IDENTIFYING MEANS AOF RECOGNISES ITS OWN, AND ONLY ITS OWN (AC10). An entry an
  # operator hand-copied without the marker is the operator's; aof neither adopts, edits
  # nor retracts it. An entry aof DID author is aof's to keep canonical.
  @executable
  Scenario: an unmarked look-alike entry is treated as the operator's, and aof's own marked entry is kept canonical
    Given the fixture's `hooks.PostToolUse` holds an entry identical to aof's but carrying no ownership marker
    When the merge runs
    Then the unmarked entry is byte-identical to before
    And aof's own marked entry is present beside it
    When the queue path inside aof's own marked entry is hand-edited and the merge runs again
    Then aof's marked entry is restored to the value the config implies
    And the unmarked entry is still byte-identical to before
    And retracting the hook from config removes only the marked entry, leaving the unmarked one byte-identical

  # THE WHOLE-FILE RENDER PATH IS CLOSED (AC11) — the latent defect closed BEFORE it
  # arms. `planApplyActions` falls through to an ungated "existing file will be
  # overwritten" for any file with no prior lock entry, which describes this file
  # exactly; `work init` makes it worse by treating every unlocked file as fresh. The
  # observable is that the plan names no action for the file at all, on every door.
  @executable
  Scenario Outline: with a claude hook configured, no command plans a whole-file action for .claude/settings.json
    Given `.aof/aof.config.json` declares the claude-runtime artifact-sync hook
    And the workspace's `.claude/settings.json` has no entry in aof's install lock
    When `<command>` runs against the workspace
    Then the plan envelope names no action for `.claude/settings.json` — no create, no update, no drift-warning, no "existing file will be overwritten"
    And the operator's five top-level keys are byte-identical afterwards
    And the operator's four hand-wired hook events are byte-identical afterwards

    Examples:
      | command                 |
      | aof work init --json    |
      | aof work update --json  |
      | aof assets apply --json |

  # TWO DOORS (AC12): the enqueue SCRIPT is aof-exclusive and rides the existing
  # content-hashed, drift-protected bundle mechanism; the settings ENTRY rides the
  # merge. Splitting them is what keeps "a whole-file render iff aof exclusively owns
  # the file" true of every file the bundle writes — asserted here as behaviour (an
  # operator sentinel in the settings file survives an install) rather than as a claim
  # about the manifest's contents.
  @executable
  Scenario: the script installs as a drift-protected asset while the installer never writes the settings file
    Given a target workspace whose `.claude/settings.json` carries an operator-only sentinel key
    When the bundle is installed into that workspace
    Then the enqueue script exists at its installed path with the content the bundle recorded
    And the operator's sentinel key is byte-identical afterwards
    And `.claude/settings.json` appears in no install action of that run
    When the installed enqueue script is hand-modified and the install is re-run
    Then that modification is reported as drift on the script, exactly as for any other bundled file
    And the hook entry's argv still names the installed script's absolute path

  # THE REAL FILE, ON THE REAL REPO — the check that cannot be a fixture, because the
  # hazard is specifically about THIS operator's hand-authored file and the moment a
  # claude hook first lands in THIS repo's `.aof/aof.config.json`. Run against a scratch
  # CLONE, never the live checkout; the live `.claude/settings.json` is this repo's own
  # working hook config and must not be written by a verification step.
  @manual
  Scenario: on a scratch clone of this repo, arming the hook leaves the operator's live settings intact
    Given a scratch clone of this repo whose `.claude/settings.json` is the operator's real file
    When the claude-runtime artifact-sync hook is added to that clone's `.aof/aof.config.json`
    And `aof work update` then `aof work init` are run in that clone
    Then the file's `permissions`, `sandbox`, `enabledPlugins` and `extraKnownMarketplaces` are byte-identical to the committed file
    And `SessionStart`, `UserPromptSubmit`, `SessionEnd` and `PreToolUse` are byte-identical to the committed file
    And the only difference from the committed file is one added entry under `hooks.PostToolUse`
    And a `claude` session started in that clone still fires the session hooks and the test-isolation guard
