@cli @work @board @executable
Feature: aof work ui is the per-stream board's serve verb; aof work board no longer dispatches
  In order to drill from the fleet view into a single work stream's board under one coherent name,
  the CLI serve verb aof work board is renamed to aof work ui — the dispatch branch, the usage
  surfaces, and the human log line all read "ui",
  so that the operator launches the per-stream board as aof work ui (the drill-in target story 02
  links into), the retired verb falls through to the unknown-subcommand help rather than silently
  serving, and behaviour parity (the --port flag, the same board server) carries through the rename.

  # ARCHITECTURE ADR-001: the board is a CLI-ONLY serve verb, NOT a registered work:* command
  # (cli.mjs:339 dispatches subcommand === "board" to a local workBoardCommand; there is no
  # work:board in the registry). So the rename is a cli.mjs surface edit: the dispatch branch,
  # workBoardCommand → workUiCommand, the two usage strings (workCommand's unknown-sub help +
  # the top-level aof usage), and the human log line. That the rename actually HAPPENED — the
  # "board" branch gone iff the "ui" branch present — is the acd-work-ui-rename-complete
  # arch-test (XOR form), a structural invariant NOT re-asserted here. This feature asserts
  # only the observable verb surface. The served board itself being unchanged is task 01.
  #
  # QA case notes (source-grounded, the 22/R2 boundary-literal discipline):
  # - The unknown-sub fallthrough TODAY: workCommand throws `Unknown work command "<sub>".`
  #   followed by an Examples block (cli.mjs:359); the entry catch (bin/aof.mjs) prints
  #   error.message to STDERR and sets exit code 1; stdout carries nothing. The retired verb
  #   must ride exactly this path — same channel, same exit code, no special-casing.
  # - The default port is 4180 (cli.mjs:863, `options.port ?? "4180"`, chosen not to collide
  #   with assets ui's 4177/4178); the busy-port refusal is the exact stderr line
  #   `Port <n> is already in use. Pass --port <n> to pick another.` + exit code 1 (cli.mjs:876).
  # - The human line today is `AOF work board is running locally.` (cli.mjs:884), and the
  #   announced URL carries the `?mode=board` serve param (board-serve.mjs:37) — which ADR-001
  #   pins as UNCHANGED by the rename (the bundle's internal mode, not the CLI surface).
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # The headline: the renamed verb serves the board. The server, its default port, and the
  # ?mode=board serve param are m03's, unchanged — only the verb naming it changed.
  Scenario: aof work ui launches the per-stream board server
    When I run "aof work ui" against the fixture
    Then the board server starts and binds 127.0.0.1 on the documented default port 4180
    And the human line reads "AOF work ui is running locally." (it reads "ui", never "board")
    And the announced board URL still carries the unchanged "?mode=board" serve param

  # The retired verb is GONE, not aliased: "board" falls through to workCommand's
  # unknown-subcommand path exactly as any unrecognised sub does — same exit code, same
  # output channel. A deliberate rename leaves no silent alias behind (ADR-001 — no dead
  # branch, no double name).
  Scenario: aof work board falls through to the unknown-subcommand help
    When I run "aof work board" against the fixture
    Then no board server is started
    And the command exits with code 1
    And stderr reports the unknown subcommand — the report opens with: Unknown work command "board".
    And the work usage that follows lists "ui" among the work subcommands and does not list "board"
    And stdout carries no output

  # Behaviour parity through the rename: the --port override carries forward.
  Scenario: aof work ui --port binds the chosen port
    When I run "aof work ui --port" with a free port I chose
    Then the board server binds 127.0.0.1 on that chosen port

  # The port-busy refusal is part of the verb's observable surface and carries through the
  # rename verbatim (cli.mjs:876 — the EADDRINUSE guidance line).
  Scenario: aof work ui on a busy port refuses with the same guidance as before
    Given a listener already bound to a port I chose
    When I run "aof work ui --port" with that busy port
    Then no board server is started
    And the command exits with code 1
    And stderr reads: Port <n> is already in use. Pass --port <n> to pick another.

  # Both usage surfaces read the renamed verb — each with its OWN literal, because the two
  # surfaces render the port hint differently today: the top-level usage shows
  # `aof work board [--port]` (cli.mjs:2423) while the work unknown-sub Examples block shows
  # `aof work board [--port 4180]` (cli.mjs:359). A faithful rename preserves each surface's
  # own shape; the rows below pin that (22/R2 — the literal must agree with source reality).
  # The channel differs too: `aof help` prints to stdout (exit 0); the work unknown-sub help
  # arrives on stderr (exit 1).
  #
  # QA FEASIBILITY FLAG: the two rows pin a FAITHFUL rename (each usage surface keeps its own
  # port-hint shape: `[--port]` top-level vs `[--port 4180]` in the work help). If the
  # developer seat intends to normalise both surfaces to one shape while renaming, the two
  # "lists" literals below must be re-pinned to the normalised shape before build — decide at
  # the feasibility read, don't leave the literals ambiguous.
  #
  # DEV (feasibility read 2026-07-02, source-checked): RESOLVED — FAITHFUL. Confirmed the two
  # shapes are the real source literals today: cli.mjs:2423 renders `aof work board [--port]`
  # (a tab-aligned Work-section row with a trailing description, printed to STDOUT by `aof help`
  # via console.log(helpText()), exit 0) and cli.mjs:359 renders `aof work board [--port 4180]`
  # (a line in the unknown-sub Examples block, thrown → bin/aof.mjs catch → console.error →
  # STDERR, exit 1). ADR-001 decision 1 pins the VERB rename, not a shape normalisation ("both
  # usage lines … read 'ui'"); a faithful board→ui swap that leaves each surface's own port-hint
  # shape untouched is the ACD-correct minimal rename. The two "lists" literals below
  # (`aof work ui [--port]` / `aof work ui [--port 4180]`) are LOCKED as-is — do NOT normalise.
  #
  # DEV — rides the rename diff, NOT a doc-sweep item (task 02 is out of scope for it): the
  # stale code comment src/terminal-ws.mjs:52 names the retired verb — `the real \`aof work board\`
  # (serveBoard) turns it ON.` It is a CODE comment (not operator-facing prose), so it is out of
  # task 02's @docs sweep by that task's own boundary note; but the story-01 build MUST update it
  # to "aof work ui" as part of the rename diff so the source stops naming a verb that no longer
  # dispatches. This is a build reminder for the developer seat, not a new @executable assertion
  # (a comment is not observable behaviour) — the acd-work-ui-rename-complete XOR arch-test
  # discounts comments, so it neither catches nor blocks this; a reviewer catches it at build.
  Scenario Outline: the usage surfaces read aof work ui and never aof work board
    When I read the "<surface>" usage text by running "<obtained by>"
    Then the usage arrives on <channel>
    And it lists "<lists>" as the board serve verb
    And it does not mention "aof work board"

    Examples:
      | surface                 | obtained by               | channel | lists                     |
      | top-level aof usage     | aof help                  | stdout  | aof work ui [--port]      |
      | work unknown-subcommand | aof work not-a-subcommand | stderr  | aof work ui [--port 4180] |
