@uat @cli @ui @distribution
Feature: One `aof mesh desktop` command installs and launches the supervisor — tray up, mesh + ui kept up across a crash, view shows nodes + work, terminal closed
  In order to accept the whole milestone as an outsider (SPEC §Objective) — "one command brings up the ambient
  supervisor" — a human runs `aof mesh desktop install` then `aof mesh desktop run` on a real Windows node: a tray
  icon appears, the supervised mesh comes up and stays up across a crash, the window shows the fleet's nodes and
  current work, and it all keeps running with the launching terminal closed — control node brings up the server AND
  `aof mesh ui`; a worker node brings up `aof mesh ui` only.

  # ARCHITECTURE: this is the CROSS-STORY, whole-milestone acceptance (SPEC §Objective) — it exercises the BUILT
  # Rust app (stories 00 supervisor-core / 01 tray-presence / 02 node-work-view) through story 03's install+run
  # verbs. It touches every ADR at once: ADR-001 (Tauri tray window + WebView2 launch), ADR-002 (role-driven
  # supervision — control: `serve --serve` + `ui`; worker: `ui` only — off `mesh status`'s isControlNode; Job-Object
  # kill-on-close + restart-with-backoff keeps children up across a crash), ADR-003 (installed + launched via the
  # `aof mesh desktop` verbs, packaged at $HOME/.aof/bin), ADR-004 (the window renders `mesh status --json`'s
  # corrected shape — nodes[] + boards[] + isControlNode — strictly read-only). Run at aof:verify ONCE the Rust
  # stories land — it is honestly un-executable before the built app exists, so it is @uat (human-judged on a real
  # Windows fleet), never a fixture.
  #
  # QA: this is the outsider gate. The @executable dispatch/placement/discovery of story 03's OWN Node verbs are
  # tasks 00-02; THIS task is the human sign-off that the built app, installed and launched by those verbs, actually
  # does the whole job — the milestone's headline. Each scenario is a distinct outsider-verifiable claim.

  Background:
    Given a real Windows mesh with a control node and at least one worker node
    And each node has the m28 `aof` binary at $HOME/.aof/bin

  # THE ONE-COMMAND-EACH INSTALL + LAUNCH (SPEC §Objective): install, then run, brings the whole thing up.
  Scenario: on a control node, one install command and one run command bring up the supervisor with the terminal closed
    Given a control node
    When the operator runs `aof mesh desktop install` once, then `aof mesh desktop run` once
    Then a tray icon appears on the Windows taskbar
    And the mesh server (`aof mesh serve --serve`) AND `aof mesh ui` come up under the app's supervision
    And the app window shows the fleet's nodes and their current work
    And all of it keeps running after the launching terminal is closed

  # SUPERVISION HOLDS ACROSS A CRASH (ADR-002 — Job-Object + restart-with-backoff): a killed child comes back.
  Scenario: the supervised mesh server and ui are kept up across a crash (the app restarts them)
    Given the app is running on a control node with `serve --serve` and `ui` up
    When a supervised child (the mesh server or `aof mesh ui`) is killed
    Then the app restarts it under its backoff policy
    And the tray + window reflect the restart (a `restarting` local-process signal), then return to healthy
    And no orphaned child process is left behind

  # THE WORKER ROLE (SPEC §Objective + ADR-002 — worker brings up `ui` only, no server): the same command, ui-only.
  Scenario: on a worker node, the same command brings up `aof mesh ui` only (no server) with the same view
    Given a worker node (isControlNode is false)
    When the operator runs `aof mesh desktop install` once, then `aof mesh desktop run` once
    Then a tray icon appears and `aof mesh ui` comes up under supervision
    And NO mesh server (`serve --serve`) is started on the worker
    And the app window shows the same fleet nodes-and-work view
    And it keeps running with the launching terminal closed

  # THE VIEW IS THE FLEET (ADR-004 — read-only over mesh status --json): the window shows real nodes + current work.
  Scenario: the app window shows the fleet's nodes and current work, read-only, from `mesh status`
    Given the app is running and the fleet has active and idle nodes
    When the operator opens the app window
    Then it shows each node and its current work (the nodes-and-work view)
    And the view is read-only — it offers no fleet-mutation control (no assign/issue/revoke/invite/join)
    And a stale / no-heartbeat node is shown as such (never mis-shown as active)

  # QA: added the AMBIENT-RESIDENCY closer — the whole point of "with the terminal closed" is that closing the
  # window does NOT quit the supervisor (hide-on-close, ADR-001), and quitting from the tray DOES reap everything
  # (Job-Object kill-on-close, ADR-002). The outsider must be able to confirm both ends of residency.
  Scenario: closing the window keeps the supervisor resident; quitting from the tray reaps the whole child tree
    Given the app is running with its supervised children up
    When the operator closes the app window
    Then the app stays resident in the tray and the supervised children keep running
    When the operator then chooses Quit from the tray menu
    Then the app exits and reaps its whole supervised child tree (no orphaned `aof`/Node processes remain)
