@manual @ui @distribution @adapter
Feature: The supervisor brings up the role-driven process set and restarts crashes under jittered backoff while special-casing the named clean exits
  In order that this node keeps exactly the right mesh processes alive for its role without restart-storming a
  process that exited cleanly, the supervisor supervises the ROLE-DRIVEN set (control brings up
  `aof mesh serve --serve` + `aof mesh ui`; a worker brings up `aof mesh ui` ONLY), restarts a genuine crash
  under jittered exponential backoff, and SURFACES — never tight-loops — the two children's named clean-exit-1
  modes, driving a local-process state machine that maps to DESIGN's local-process ramp.

  # ARCHITECTURE 36/ADR-002 d1-2 (role-driven supervision set off `isControlNode` + watchdog restart with
  # jittered backoff, crash-vs-clean-exit aware). The supervision SET is driven off the `isControlNode` boolean
  # from the SAME `mesh status --json` poll (ADR-004; task 01) — no role re-derivation in Rust: control node ⇒
  # `serve --serve` + `ui`; worker node ⇒ `ui` only (RESEARCH §3, DESIGN §States "a worker omits the Mesh-server
  # control"). A child that exits is restarted under jittered exponential backoff BUT the named clean-exit-1
  # modes are special-cased, not blindly restart-looped: `mesh ui` fast-exit-1 is `ui-build-missing`/`EADDRINUSE`
  # (surface the message, don't tight-loop); `mesh serve --serve` exit-1 "launcher already running (pid N)" is
  # the daemon's OWN lock-file single-instance guard firing — treat as "someone else already has it," not a crash
  # to restart (RESEARCH §3). The state machine `Running | Restarting(backoff) | Stopped | CleanExit(reason)` maps
  # to DESIGN's `restarting`/`stopped` local-process ramp (DESIGN §UI behaviour). This is OBSERVABLE supervisor
  # behaviour — a `@manual` scenario (spawn/crash/observe), NOT an arch grep (ARCHITECTURE §Fitness functions,
  # "honestly un-writable as an arch-test until the engine exists — armed at build by story 00").
  #
  # RESOLVED (developer-amigo): `@manual` — this needs a real supervisor process spawning real (or stub) long-
  # lived children and observing restart timing / clean-exit surfacing, which no source grep can assert. Proposed
  # exercise: drive it with STUB `aof`-shaped children the test controls (a stub that blocks then crashes on
  # command; a stub that fast-exit-1s with `ui-build-missing`/`EADDRINUSE`; a stub that exit-1s with the launcher-
  # lock message), asserting restart-under-backoff on the crash and surface-not-restart-storm on the named clean
  # exits, plus the role-set membership under each isControlNode value. Confirm the stub-child harness next.

  Background:
    Given a running supervisor on this node
    And its role is read from the last `mesh status --json` poll's isControlNode

  # THE ROLE-DRIVEN SET (ADR-002 d1 / RESEARCH §3): the supervision membership is a pure function of
  # isControlNode — a control node brings up BOTH children; a worker brings up ONLY the web UI, never the server.
  Scenario Outline: the supervised set is driven off isControlNode
    Given isControlNode is <isControlNode>
    When the supervisor establishes the process set for this node's role
    Then it supervises <supervises>
    And it does not supervise <omits>

    Examples:
      | isControlNode | supervises                            | omits                       |
      | true          | aof mesh serve --serve AND aof mesh ui | nothing                     |
      | false         | aof mesh ui ONLY                       | aof mesh serve --serve      |

  # RESTART ON A GENUINE CRASH (ADR-002 d2): a supervised child that crashes (an unexpected exit, not a named
  # clean exit) is restarted under a jittered backoff — the delay grows between successive crashes and is
  # jittered, it is not a fixed-zero tight loop.
  Scenario: a child that crashes is restarted under jittered exponential backoff
    Given a supervised "aof mesh ui" child running healthily
    When the child crashes with an unexpected exit
    Then the supervisor restarts the child
    And the restart is delayed by a backoff, not immediate
    And successive crashes grow the backoff delay
    And the backoff carries jitter (successive delays are not a fixed value)

  # NAMED CLEAN EXITS ARE SURFACED, NOT RESTART-STORMED (ADR-002 d2 / RESEARCH §3): the two children's named
  # clean-exit-1 modes are special-cased — the supervisor surfaces the message and does NOT tight-loop a restart.
  Scenario Outline: a named clean-exit-1 mode is surfaced and not tight-loop-restarted
    Given a supervised "<child>" child
    When it exits 1 with the named condition "<condition>"
    Then the supervisor surfaces the message "<condition>"
    And it does not tight-loop-restart the child
    And the child's local-process state becomes CleanExit with reason "<condition>"

    Examples:
      | child                   | condition                        |
      | aof mesh ui             | ui-build-missing                 |
      | aof mesh ui             | EADDRINUSE                       |
      | aof mesh serve --serve  | launcher already running (pid N) |

  # THE LOCAL-PROCESS STATE MACHINE (ADR-002 Consequences → DESIGN local-process ramp): a crash transitions
  # Running → Restarting(backoff) → Running; a named clean exit transitions Running → CleanExit(reason). These map
  # to DESIGN's `restarting` and `stopped` local signals — a REAL supervisor signal, distinct from fleet presence.
  Scenario Outline: the local-process state machine transitions on crash vs named clean exit
    Given a supervised child in state "Running"
    When the child <event>
    Then the child transitions through "<states>"
    And its terminal-observed local state maps to DESIGN's "<ramp>" local-process signal

    Examples:
      | event                                   | states                                      | ramp       |
      | crashes then is restarted               | Running -> Restarting(backoff) -> Running   | restarting |
      | exits cleanly with a named reason       | Running -> CleanExit(reason)                | stopped    |
