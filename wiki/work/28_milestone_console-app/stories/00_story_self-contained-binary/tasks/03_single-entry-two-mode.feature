@cli @adapter @distribution @executable
Feature: One binary, two modes — node and relay are two argv routes through the ONE run() command core, with no forked per-mode entry
  In order to ship "one binary, two modes" WITHOUT a second product or a second dispatch path to keep in sync
  invoking run() with node-mode argv (anything-but-mesh-relay) and with relay-mode argv (mesh relay) both route through the same in-process command core (08/ADR-001),
  so that the packaged binary needs zero mode-dispatch logic of its own — the mode IS the subcommand, carried intact by the esbuild bundle of run().

  # ARCHITECTURE ADR-004: the packaged SEA main is bin/aof.mjs's bundled equivalent — it calls the SAME
  # run(process.argv.slice(2)) and nothing else. relay mode = `aof mesh relay` (the existing 23/ADR-001
  # route: run(["mesh","relay"]) → meshVerbCli("mesh:relay") → invoke("mesh:relay")); node mode =
  # everything else. NO top-level `relay` fast-path, NO forked per-mode entry, NO --mode flag. The graph
  # proves the single door: src/cli.mjs has 0 src-dependents (only bin/aof.mjs) / 26 dependencies.
  #
  # The SOURCE invariant "the entry calls exactly run(...) with no per-mode fork" is the
  # acd-single-entry-command-core ARCH-TEST (fitness #2) — NOT a scenario here. This feature asserts the
  # OBSERVABLE routing IN-PROCESS at the run() level (no built binary needed): node-mode argv and
  # relay-mode argv both dispatch through the one command core. The built-binary two-mode smoke rides
  # the @manual 01_sea-build-recipe.
  #
  # DEVELOPER-SEAT (feasibility): run() must be invokable in-process such that the routed command id is
  # observable (e.g. `aof mesh relay` reaches invoke("mesh:relay") and NOT a bypass). Confirm the relay
  # verb's registered run is the NON-BLOCKING probe (23/ADR-001) so the relay-mode route returns and is
  # assertable without binding a long-lived listener (mirror the bijection test's --json probe form).
  Background:
    Given run(argv) from src/cli.mjs — the one in-process command core (08/ADR-001)
    And the relay verb's registered run is the non-blocking probe (23/ADR-001)

  # The headline: two argv shapes, one core. R4: pin the unaffected side — the relay route does NOT
  # bypass the command core (no direct serveRelay call ahead of run()); it reaches invoke("mesh:relay").
  #
  # QA: broadened the argv→route matrix to cover more of the 26-command surface the single door carries —
  #  - the BARE `[]` invocation (no subcommand → node-mode help/default; a real entry a user types);
  #  - `graph build` and `init` (further node-mode routes, proving node mode = "everything but mesh relay",
  #    not just version/work);
  #  - `mesh identity` (a mesh SIBLING of relay that is NODE mode — pins that "mesh" alone is not "relay",
  #    only `mesh relay` is the relay route);
  #  - `mesh relay` WITHOUT --json (the relay route is the subcommand, independent of the probe flag — the
  #    --json is the probe FORM, not what selects the mode).
  # Each row is a distinct real route; the point is that ALL of them dispatch through the one run().
  Scenario Outline: node-mode and relay-mode argv both route through the one command core
    When run(<argv>) dispatches
    Then it routes through the in-process command core to <command>
    And no per-mode entry fork was taken before run() dispatched

    Examples: the two modes are two argv routes
      | argv                       | command                        |
      | []                         | node mode (default/help)       |
      | ["--version"]              | node mode (version)            |
      | ["work","next"]            | node mode (work:next)          |
      | ["graph","build"]          | node mode (graph:build)        |
      | ["init"]                   | node mode (init)               |
      | ["mesh","status"]          | node mode (mesh:status)        |
      | ["mesh","identity"]        | node mode (mesh:identity)      |
      | ["mesh","relay","--json"]  | relay mode (invoke mesh:relay) |
      | ["mesh","relay"]           | relay mode (invoke mesh:relay) |

  # No forked entry — the packaged main is shape-equivalent to bin/aof.mjs. R4: assert the ABSENCE of a
  # second dispatch (this is the observable counterpart to fitness #2's source grep).
  Scenario: the packaged entry calls run(process.argv.slice(2)) and nothing else — no relay fast-path
    Given the SEA-main recipe (bin/aof.mjs's bundled equivalent)
    When the entry receives relay-mode argv
    Then it hands the FULL argv to run() without inspecting argv[0] for a "relay" fast-path
    And relay mode is reached only through run()'s existing argv dispatch (the one door)

  # QA: added the ERROR-ROUTING boundary — an unknown subcommand must be handled INSIDE run()'s own
  # dispatch (a node-mode unknown-command error), not by a pre-run fork that would have to duplicate the
  # error path. This pins that even the failure case goes through the one door. R4: pin the unaffected
  # side — an unknown command produces run()'s standard error, and relay mode is unaffected.
  Scenario: an unknown subcommand is rejected by run()'s own dispatch, not a pre-run fork
    When run(["definitely-not-a-command"]) dispatches
    Then run() surfaces its standard unknown-command error (node mode)
    And no per-mode entry fork intercepted the argv before run()

  # QA: added the NON-BLOCKING-RETURN assertion for the relay route — ADR-004/23-ADR-001 register the
  # NON-BLOCKING probe as the run(); the long-lived serveRelay is separate. The relay-mode route must
  # RETURN (so it is assertable in-process) and must NOT bind a long-lived listener as a side effect of
  # dispatch. R4: pin the unaffected side — dispatching relay mode leaves no dangling server.
  Scenario: the relay-mode route runs the non-blocking probe and returns without binding a long-lived listener
    When run(["mesh","relay","--json"]) dispatches
    Then it invokes mesh:relay's registered non-blocking probe and returns a result
    And no long-lived relay listener was bound by the dispatch itself
