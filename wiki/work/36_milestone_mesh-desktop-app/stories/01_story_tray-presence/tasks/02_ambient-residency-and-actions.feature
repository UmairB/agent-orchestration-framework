@manual @ui @distribution
Feature: Ambient residency + the menu actions driving real processes — hide-to-tray, Quit-is-the-only-exit, and Start/Stop/Open/Show driving the live supervisor
  In order that the supervisor is AMBIENT — surviving the window close, one-click reachable from the
  taskbar, and never a terminal — closing the window hides the app to the tray (it stays resident), Quit
  is the only full exit (and it reaps the supervised tree), and the menu's Start/Stop/Open/Show items drive
  the REAL supervisor engine (local supervision only — never a mesh mutation) rather than pure models.

  # DESIGN §Surface 2 + §"UI BEHAVIOUR that should become task scenarios" + ADR-001 (ambient prevent_close+hide
  # is manual wiring, RESEARCH §1) + ADR-002 (the menu drives the supervisor; Quit reaps via the Job Object) +
  # ADR-004 d3 (read-only: Start/Stop is LOCAL supervision only, arms acd-desktop-read-only-fleet).
  #
  # WHY @manual (not @executable): these scenarios require a RUNNING app driving REAL OS processes — an actual
  # window that hides, a real supervised `aof mesh serve --serve` / `aof mesh ui` spawned and reaped, a real
  # default-browser launch. That is black-box behaviour over live processes, judged by a person; the PURE
  # models the menu/icon are built FROM are the @executable 00/01 siblings. This is behavioural verification,
  # NOT white-box: "process alive / icon present / browser opened / no orphan" are all observable from outside.
  # WHITE-BOX confirmation that the Job Object handle is dropped, or that no mesh-mutating verb is spawned at the
  # source level, is the DEVELOPER's lane (acd-desktop-read-only-fleet is an arch-test; ADR-002's reap is the
  # story-00 @manual). Here we assert the OBSERVABLE outcome only.
  #
  # TWO RAMPS, KEPT HONEST: Start/Stop drives the LOCAL server process (supervisor ramp); the tray header/icon
  # reflect fleet presence + local health separately (00/01). This feature drives the local ramp and asserts it
  # never leaks into a fleet mutation. The a11y lane is OFF for this story (no "a11y" in work.tags.domains).

  Background:
    Given the desktop app is running and resident in the Windows tray

  # DESIGN §Surface 1 region 1 + §Surface 2 + §"UI BEHAVIOUR" ("Closing the window hides to tray (survives, does
  # not quit)") + ADR-001 (manual prevent_close+hide, RESEARCH §1). Closing the window via the X does NOT exit
  # the process — the window hides, the process stays alive, and the tray icon remains present. This is the
  # ambient-presence guarantee: the supervisor outlives the window.
  Scenario: closing the main window hides it to the tray — the app stays resident, the process alive, the icon present
    Given the main window is visible
    When the operator closes the window with the title-bar close button
    Then the window is hidden, not destroyed
    And the app process is still alive
    And the tray icon is still present in the taskbar
    And the supervised child processes continue running (the window close did not stop supervision)
    And the tray menu now offers "Show window" (the window is hidden — cross-ref 01_tray-menu-model)

  # DESIGN §Surface 2 region 5 + §"UI BEHAVIOUR" ("Quit is the only full exit") + ADR-002 decision 3 (the Job
  # Object kill-on-close reaps the child tree). Quit is the ONLY affordance that fully exits; and when it exits,
  # it tears down supervision — the supervised `aof` children (and their Node grandchildren) are reaped, leaving
  # NO orphans. The Job-Object reap MECHANISM is story 00's @manual; here we assert Quit is the trigger and the
  # OBSERVABLE no-orphan outcome (cross-ref story 00).
  Scenario: Quit is the only full exit and it tears down supervision — no orphaned child processes remain
    Given the supervised children (mesh server and/or mesh ui) are running
    When the operator selects "Quit" from the tray menu
    Then the app process exits fully
    And the tray icon is removed from the taskbar
    And no orphaned aof / Node child processes remain (the supervised tree is reaped — cross-ref story 00, ADR-002)
    And closing the window earlier did NOT trigger this exit — only Quit does

  # DESIGN §Surface 2 region 2 + §"UI BEHAVIOUR" (the toggles actually spawn/stop the supervised processes) +
  # ADR-002 (menu drives the supervisor) + ADR-004 d3 (LOCAL supervision only). The menu's Stop mesh / Start
  # mesh drives the REAL supervisor engine — Stop mesh stops the running `aof mesh serve --serve` on THIS
  # machine, Start mesh (re)spawns it — and the tray item's label flips to match (01_tray-menu-model). This is
  # LOCAL supervision only.
  Scenario Outline: Start/Stop mesh from the tray drives the real local supervisor — spawning/stopping the actual server
    Given the local mesh server is "<initial>"
    When the operator selects "<action>" from the tray menu
    Then the local "aof mesh serve --serve" process is "<result>" on this machine
    And the tray server-control label updates to "<new_label>" (cross-ref 01_tray-menu-model)
    And only THIS machine's server process is affected — no other fleet node is touched

    Examples: the menu action drives the live local supervisor (DESIGN §Surface 2 region 2)
      | initial | action     | result  | new_label  |
      | running | Stop mesh  | stopped | Start mesh |
      | stopped | Start mesh | running | Stop mesh  |

  # ADR-004 decision 3 + the story's fitness unit acd-desktop-read-only-fleet ("the tray's Start/Stop items
  # spawn ONLY local supervision; no mesh-mutating verb is ever reachable from the menu"). Driving Start/Stop
  # performs LOCAL supervision ONLY — it spawns from the allow-list {status, serve, ui} and NEVER a mesh-mutating
  # verb (assign / issue / revoke / invite / join). The read-only-over-the-fleet posture holds: no menu action
  # mutates fleet state. (The SOURCE-level guard that no such verb is spawnable is the developer's arch-test;
  # here we assert the OBSERVABLE — no fleet mutation results from any menu action.)
  Scenario Outline: Start/Stop performs LOCAL supervision only — no menu action ever mutates the fleet
    Given the operator drives "<action>" from the tray menu
    When the resulting spawn is observed
    Then the spawned aof verb is one of {status, serve, ui} (local supervision only)
    And no "<mutation>" verb is spawned by any tray action
    And no fleet node's assignment or membership state changes as a result (read-only over the fleet — ADR-004 d3)

    Examples: the read-only allow-list holds against every mesh-mutating verb (acd-desktop-read-only-fleet)
      | action     | mutation |
      | Start mesh | assign   |
      | Stop mesh  | issue    |
      | Start mesh | revoke   |
      | Stop mesh  | invite   |
      | Start mesh | join     |

  # DESIGN §Surface 2 region 3 + §"UI BEHAVIOUR" ("Open web UI launches the running `aof mesh ui` at its real
  # local URL in the default browser"). Open web UI opens the RUNNING `aof mesh ui` at its actual local URL in
  # the default browser — and is INERT (disabled — 01_tray-menu-model) when the UI child is stopped, so there is
  # nothing to open. It does not spawn a new server or mutate the fleet — it launches a browser at an existing URL.
  Scenario: Open web UI launches the running aof mesh ui at its real local URL in the default browser
    Given the local "aof mesh ui" child is running at its real local URL
    When the operator selects "Open web UI" from the tray menu
    Then the default browser opens at that running aof mesh ui local URL
    And no new server process is spawned and no fleet state is mutated (it only opens a browser)

  Scenario: Open web UI is inert when the UI child is stopped — there is nothing to open
    Given the local "aof mesh ui" child is stopped
    When the operator inspects the "Open web UI" tray item
    Then the item is disabled (cross-ref 01_tray-menu-model — disabled, not omitted)
    And selecting it opens no browser and has no effect

  # DESIGN §Surface 2 region 4 + §"UI BEHAVIOUR" ("Show/Hide toggles the main window"). Show/Hide from the tray
  # toggles the main window's visibility — Show brings the hidden window back, Hide sends it to the tray (the
  # same ambient hide the close button performs, without exiting) — and the tray label flips to match
  # (01_tray-menu-model).
  Scenario Outline: Show/Hide window from the tray toggles the main window's visibility
    Given the main window is "<initial>"
    When the operator selects "<action>" from the tray menu
    Then the main window is "<result>"
    And the app stays resident either way (Hide does not exit — only Quit does)
    And the tray window-toggle label updates to "<new_label>" (cross-ref 01_tray-menu-model)

    Examples: the toggle drives the live window (DESIGN §Surface 2 region 4)
      | initial | action      | result  | new_label   |
      | hidden  | Show window | visible | Hide window |
      | visible | Hide window | hidden  | Show window |
