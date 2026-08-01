<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY AC1: the execution-scope rule moves DOWN out of the
# `board-mesh-execution.mjs` face into the `assignment-record.mjs` leaf (imports 0),
# is re-exported for its existing consumers, and the three faces that read it —
# `work continue|refine|verify`, `work list`, `work run-status` — answer EXACTLY as
# they do at HEAD. This task is the no-regression half of AC1; the "defined exactly
# once in the repo" half is a PLACEMENT invariant and is NOT restated here (it lives
# in `test/arch/acd-item-lock-single-door.test.mjs`, already green — ARCHITECTURE
# §"Invariants MOVED here out of the feature layer").
#
# LITMUS: every Then is confirmable by an outsider from a command's `--json`
# envelope — no source read, no import graph. The scope derivation itself is a pure
# function with no CLI surface, so it is observed ONLY through the two envelopes that
# already publish it: `aof work continue <ref> --json` (which carries `scopeRef`,
# `dispatchRef`, `where`, `resolvedBy`) and `aof work list --json` (whose rows carry
# `execution.scopeRef` when an active assignment covers the row's scope). Those two
# reads are named in the steps because they are the only black-box channel for the
# rule. "Nothing was minted locally" is read from `aof work run-status <ref> --json`.
#
# FEASIBILITY: nothing new is needed. Every field asserted below exists at HEAD
# (`board-mesh-execution.mjs` `applyExecutionOverlay`/`resolveScopedExecution`,
# `commands/continue.mjs` `resolveContinueDecision`). This task is a BASELINE the
# refactor must not move — author it green against HEAD first, then keep it green
# across the move; a Then that changes value is the regression.

@executable @cli @work @distribution
Feature: the execution-scope rule has ONE home and the move does not change a single answer any face gives
  In order that moving the scope rule down into the pure leaf is a relocation and never a behaviour change — so the mint seam can reach it without the spine importing a face
  every existing consumer of the rule (the continue/refine/verify door, the board's row overlay, and run-status' streamed-run lookup) must return byte-identical answers before and after the move

  Background:
    Given an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published workspace
    And that workspace's work stream contains milestone "42" with stories "42/01", "42/02" and "42/03", and an unrelated milestone "43" with story "43/01"
    And the local node is "control-a"

  # Headline: the scope a ref executes under is the top-level item, and it is reported
  # identically for a milestone and for each of its stories. Read through the continue
  # door's own envelope, which is where the rule is publicly visible.
  Scenario Outline: the continue door reports the same execution scope for a milestone and every story under it
    Given an ACTIVE assignment for "42" held by node "aof-wsl" in state "running"
    When I run `aof work continue <ref> --json`
    Then the envelope's `scopeRef` is <scopeRef>
    And the envelope's `where` is "running" and its `node` is "aof-wsl"
    And the envelope's `dispatchRef` is <scopeRef> (the unit of mesh execution is the scope, never the child)
    And a fresh `aof work run-status <ref> --json` shows NO run minted on "control-a" by this command

    Examples:
      | case                    | ref   | scopeRef |
      | the scope itself        | 42    | 42       |
      | the first story under it| 42/01 | 42       |
      | a later story under it  | 42/03 | 42       |

  # A ref outside the held scope is untouched by it — the rule narrows to the
  # top-level item and never leaks sideways into a neighbour.
  Scenario Outline: an item outside the held scope resolves to its OWN scope and is offered locally
    Given an ACTIVE assignment for "42" held by node "aof-wsl" in state "running"
    When I run `aof work continue <ref> --json`
    Then the envelope's `scopeRef` is <scopeRef>
    And the envelope's `where` is "local" and its `resolvedBy` is "no-prior-run"

    Examples:
      | case                       | ref   | scopeRef |
      | an unrelated milestone     | 43    | 43       |
      | a story of that milestone  | 43/01 | 43       |

  # The board's row overlay reads the SAME rule: a story row inherits its milestone's
  # execution facts, and — deliberately — does NOT inherit its status.
  Scenario: a story row inherits its milestone's execution in the list envelope, and its own status is left alone
    Given an ACTIVE assignment for "42" held by node "aof-wsl" in state "running"
    And story "42/03" has frontmatter status "not-started"
    When I run `aof work list --json`
    Then the row for "42" carries `execution.scopeRef` "42" and status "in-progress"
    And the row for "42/03" carries `execution.scopeRef` "42" and `execution.nodeId` "aof-wsl"
    And the row for "42/03" still reports status "not-started" (the milestone is running; this story's own frontmatter stays the truth)
    And the row for "43" carries no `execution` key at all

  # run-status' streamed-run lookup falls back to the scope when the child has no
  # streamed runs of its own — the third consumer of the same rule.
  Scenario: run-status for a story falls back to its milestone's streamed runs
    Given an ACTIVE assignment for "42" held by node "aof-wsl" in state "running"
    And the worker has streamed run records for "42" and none for "42/03"
    When I run `aof work run-status 42/03 --json`
    Then the envelope reports the runs streamed for "42"
    And the envelope names the ref they were recorded under as "42"

  # The default-to-local path: with no assignment row at all, every face is
  # byte-identical to what a non-mesh workspace and the plain CLI get today.
  Scenario Outline: with no assignment row for the scope, every face answers exactly as a non-mesh workspace does
    Given the store holds <assignments>
    When I run `aof work list --json` and `aof work continue 42/03 --json`
    Then no row in the list envelope carries an `execution` key
    And the continue envelope's `where` is "local", its `resolvedBy` is "no-prior-run", its `dispatchRef` is "42/03" (the EXACT ref) and its `scopeRef` is "42"

    Examples:
      | case                          | assignments                                        |
      | no assignment rows at all     | no rows in global_assignments for this workspace   |
      | rows for another workspace    | an active row for "42" under a DIFFERENT workspace |
      | no global store at all        | no global store present for this workspace         |

  # A TERMINAL assignment is still REPORTED (that is how a finished mesh run explains
  # where its work went) but it is reported as not-active — the distinction this story
  # then builds the lock on. This is HEAD behaviour and must survive the move.
  Scenario: a terminal assignment is reported as not-active and routes continue to the last node, never to "running"
    Given the only assignment for "42" is a TERMINAL row (state "done") whose target node was "aof-wsl"
    When I run `aof work list --json` and `aof work continue 42/03 --json`
    Then the row for "42/03" carries `execution.scopeRef` "42" and `execution.active` false
    And the row for "42/03" reports its own frontmatter status, unchanged
    And the continue envelope's `where` is "remote", its `resolvedBy` is "last-node", its `node` is "aof-wsl" and its `dispatchRef` is "42"
