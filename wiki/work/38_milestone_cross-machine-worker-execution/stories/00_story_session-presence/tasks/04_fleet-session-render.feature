@executable @ui @work @distribution @design
Feature: The fleet NodeCard renders the live-session state, with the run winning the primary line
  In order that an operator can see at a glance which repos a node is actively working — from a run OR a live
  assistant session — the NodeCard status line renders `working · <repo> (session)` for a session-only
  workspace, the run's line when a run exists (the run WINS), both lines for a node working two repos, and
  `idle` only when neither exists; one pure projection consumed identically by the desktop (36) and web (25) views.

  # ARCHITECTURE 38/ADR-004 (session↔run reconciliation) + DESIGN.md binding checklist (no mock; the checklist
  # is the conformance source of truth; baseline = the current NodeCard render, ui/src/fleet/Fleet.tsx:651).
  # Reconciliation is decided PER WORKSPACE: a running task-run is the stronger "executing" fact, so it wins the
  # primary line (ref · title, today's render) and subsumes a same-workspace session; a workspace with a live
  # session but NO run renders the FALLBACK `working · <repo> (session)`; N workspaces → N lines. The node's
  # overall state is `working` if ANY workspace has a run or a live session, else `idle`. The projection is PURE
  # over the presence record's { activeRuns, sessions } — no re-read, no third signal, no fleet-local vocabulary
  # (reuse the run-state ramp tokens: active=primary, quiet=muted; colour+label always together). STRUCTURAL:
  # run+session on one workspace → ONE line; session-only → the (session) fallback; two workspaces → two lines
  # → acd-session-run-reconciliation. Lives in the pure fleet-model helper (the ui/src/board/runs.mjs house
  # pattern — node:test-exercisable, no React harness).
  #
  # @qa: complete the Examples — idle (no run, no session), running (run only), working-session (session only),
  # run+session same workspace (run wins, ONE line), two workspaces (run in A + session in B → two lines),
  # stale-expired session (drops to idle — ties to ADR-002 TTL). This feature tests the PURE projection, not
  # the rendered pixels (that is the @uat visual review, task 06).

  Background:
    Given a presence record with activeRuns and sessions fields

  Scenario Outline: the per-workspace reconciliation collapses runs and sessions into the fleet lines
    # The presence record is ALREADY TTL-filtered (ADR-002): an expired session never reaches sessions[], so the
    # projection sees only live sessions — the stale-expired row is modelled as "the session was dropped by the
    # aggregate before it reached the card". Repo names are the repo short-name; two session-only repos join
    # `, ` under one `working ·` prefix with one trailing `(session)`. `lines` is the exact rendered text set,
    # in order; `token` reinforces active(primary)/quiet(muted) but never signals state alone (colour+label
    # travel together). `state` is the node's overall liveness.
    Given <situation>
    Then the node's current-work lines are <lines>
    And the tokens are <token>
    And the node's overall state is <state>

    Examples:
      | situation                                             | lines                                       | token   | state    |
      | no active run and no live session                     | idle                                        | muted   | idle     |
      | one running run in ws-A                               | running 1 runs                              | primary | working  |
      | three running runs in ws-A                            | running 3 runs                              | primary | working  |
      | a live session in ws-A (repo alpha), no run           | working · alpha (session)                   | primary | working  |
      | a run AND a live session, both in ws-A                | running 1 runs                              | primary | working  |
      | a run in ws-A, a live session in ws-B (repo beta)     | running 1 runs; working · beta (session)    | primary | working  |
      | live sessions in ws-A (alpha) and ws-B (beta), no run | working · alpha, beta (session)             | primary | working  |
      | the ws-A session had expired (dropped by the aggregate) | idle                                       | muted   | idle     |

  Scenario: the run wins the primary line and subsumes a same-workspace session — ONE line, not two
    # the load-bearing reconciliation pin: run + session on the SAME workspace never double-renders. The session
    # is subsumed by the run (same activity), so the workspace contributes exactly one line — the run's.
    Given a running run in ws-A AND a live session in ws-A
    When the fleet lines are projected
    Then ws-A contributes exactly one line
    And that line is the run's `running N runs` line
    And no `(session)` line is emitted for ws-A

  Scenario: a node working two repos shows both lines — one per workspace (SPEC acceptance line)
    # the SPEC's "a node working two repos shows both": reconciliation is per-workspace, so N workspaces with
    # work yield N lines; a run-workspace and a session-only workspace each get their own line.
    Given a running run in ws-A (repo alpha) and a live session in ws-B (repo beta)
    When the fleet lines are projected
    Then there are exactly two current-work lines
    And one line is alpha's `running N runs`
    And the other line is `working · beta (session)`

  Scenario: the desktop (36) and web (25) views consume the SAME projection — no divergent collapse
    # single-data-path discipline: both UIs call the one pure helper over { activeRuns, sessions }; given the
    # same presence record they produce byte-identical line sets (never two collapse rules that drift).
    Given any presence record
    When the desktop view and the web view each project its current-work lines
    Then the two line sets are identical
