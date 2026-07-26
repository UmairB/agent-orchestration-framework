@executable @ui @distribution
Feature: The pure tray-menu model — (role, process-state, fleet-summary) → the ordered menu items + their state-labelled labels
  In order that the right-click tray menu reads correctly for any node — a non-interactive health header,
  ONE state-labelled Start/Stop item (never both), an Open-web-UI item disabled when there is nothing to
  open, a visibility-labelled Show/Hide, and Quit alone below a separator — a framework-free supervisor-core
  helper maps (role, local process state, fleet summary) to the ordered list of menu items with their labels
  and enabled/omitted flags, so the render layer stays a thin consumer of a pure descriptor.

  # DESIGN §Surface 2 "Layout regions, in order (the right-click menu)" + ADR-002 (the menu drives the
  # supervisor) + ADR-001 (native menu via TrayIconBuilder). This is the PURE menu MODEL — no TrayIconBuilder,
  # no native flyout, no WebView2, no I/O — a plain Rust function returning an ordered item list, so it runs
  # HEADLESSLY as a cargo unit test (the @executable lane). WHAT each action DOES when clicked (drives the real
  # supervisor, launches the URL) is 02_ambient-residency-and-actions; the ICON the menu co-renders with is
  # 00_tray-icon-states.
  #
  # TWO RAMPS, KEPT HONEST (DESIGN §Non-negotiable framing — "never conflate the two ramps"): the HEADER is
  # FLEET PRESENCE (`N online · M stale`, the mesh:status heartbeat roll-up). The Start/Stop item reflects the
  # LOCAL SERVER process state (running/stopped — the supervisor watchdog signal). They are different signals in
  # different regions of the SAME menu and must read truthfully side by side — a fleet with stale nodes can
  # still show `Stop mesh` because the local server is running.
  #
  # RESOLVED (developer-amigo): confirm the @executable lane — this maps to a cargo unit test over a pure
  #   `tray_menu(role, server_state, ui_state, window_visible, fleet_summary) -> Vec<MenuItem>` builder in the
  #   app/desktop/ core (no TrayIconBuilder). Confirm each MenuItem carries {label, kind (header/action/separator),
  #   enabled, id} so "disabled", "state-labelled", "omitted", and "last, below a separator" are real returned
  #   fields the test asserts, not a native-render-only fact.

  Background:
    Given the pure tray-menu builder is imported from the supervisor core with no native flyout

  # The full menu for a CONTROL node with the server RUNNING (DESIGN §Surface 2 regions in order): header
  # (fleet presence, non-interactive) → Stop mesh (server is running) → Open web UI (enabled — UI child up) →
  # Hide window (window currently visible) → separator → Quit (last). Start/Stop is ONE item labelled for the
  # current state — `Stop mesh`, never `Start mesh` alongside it.
  Scenario: a control node with the server running renders the full menu in order — Stop mesh, all items present
    Given a "control" node with server "running", ui "running", window "visible", and fleet "3 online · 1 stale"
    When the tray menu model is built
    Then the menu items in order are:
      | position | kind      | label                | enabled |
      | 1        | header    | 3 online · 1 stale   | no      |
      | 2        | action    | Stop mesh            | yes     |
      | 3        | action    | Open web UI          | yes     |
      | 4        | action    | Hide window          | yes     |
      | 5        | separator |                      | no      |
      | 6        | action    | Quit                 | yes     |
    And the header is non-interactive
    And there is exactly one Start/Stop item, and it is not accompanied by its opposite label
    And Quit is the last item and sits below a separator

  # The HEADER roll-up is the fleet-presence ramp (DESIGN §Surface 2 region 1 + the menu-level states). It is a
  # non-interactive status readout of `N online · M stale`, distinct from the calm empty/loading/error copy
  # (DESIGN §Surface 2 "States"). Header text NEVER becomes an alarm — `no nodes yet` / `checking…` /
  # `mesh unreachable` are calm words, not "0 online" alarm and not an error dump.
  Scenario Outline: the non-interactive header shows the fleet-presence roll-up, calm in every menu-level state
    Given the fleet summary is "<summary_state>" yielding header "<header>"
    When the tray menu model is built for a "control" node with server "running"
    Then the first menu item is a non-interactive header labelled "<header>"
    And the header is a status readout, never an interactive control
    And the header text is calm words, never an error code dump

    Examples: the four menu-level states (DESIGN §Surface 2 "States") — header is fleet presence, kept calm
      | summary_state | header             |
      | populated     | 3 online · 1 stale |
      | empty         | no nodes yet       |
      | loading       | checking…          |
      | error         | mesh unreachable   |

  # Start/Stop mesh is ONE state-labelled item (DESIGN §Surface 2 region 2): show `Stop mesh` when the local
  # server is running, `Start mesh` when it is stopped — never both at once, never a dead/dimmed opposite. The
  # label is driven by the LOCAL server process state (the supervisor ramp), NOT by fleet presence.
  Scenario Outline: Start/Stop mesh is a single item whose label reflects the local server state — never both
    Given a "control" node with server "<server>"
    When the tray menu model is built
    Then the menu contains exactly one server-control item labelled "<label>"
    And the menu does NOT contain the opposite label "<not_label>"
    And the server-control label is driven by the local server process state, not by fleet presence

    Examples: one item, state-labelled (DESIGN §Surface 2 region 2)
      | server  | label      | not_label  |
      | running | Stop mesh  | Start mesh |
      | stopped | Start mesh | Stop mesh  |

  # A WORKER node OMITS the server control entirely (DESIGN §Surface 2 region 2 + ADR-002 role-driven set —
  # "a worker's menu omits the server control rather than showing a dead item"). It is ABSENT, not present-but-
  # dimmed: the worker has no `serve --serve` to supervise, so there is no Start/Stop mesh item at all. The rest
  # of the menu (header, Open web UI, Show/Hide, separator, Quit) is unchanged — the worker still runs `aof mesh ui`.
  Scenario: a worker node omits the server control entirely — it is absent, not a dimmed dead item
    Given a "worker" node with ui "running", window "visible", and fleet "2 online · 0 stale"
    When the tray menu model is built
    Then the menu contains no Start mesh or Stop mesh item at all
    And the omitted server control is ABSENT, not present-and-disabled
    And the menu still contains, in order, the header, Open web UI, Hide window, a separator, and Quit
    And Quit is the last item and sits below a separator

  # Open web UI is DISABLED when the UI child is stopped (DESIGN §Surface 2 region 3 — "disabled when the web UI
  # is stopped", there is nothing to open). Unlike the worker's server control, this item is PRESENT-but-
  # disabled (dimmed), not omitted — the affordance exists, it is just inert until the UI is up.
  Scenario Outline: Open web UI is present-but-disabled when the UI child is stopped, enabled when it is running
    Given a "control" node with server "running" and ui "<ui>"
    When the tray menu model is built
    Then the menu contains an Open web UI item that is "<enabled>"
    And the Open web UI item is present in both cases — disabled, never omitted, when the UI is stopped

    Examples: enabled tracks the UI child state (DESIGN §Surface 2 region 3)
      | ui      | enabled  |
      | running | enabled  |
      | stopped | disabled |

  # Show/Hide window is state-labelled by CURRENT visibility (DESIGN §Surface 2 region 4 — "label reflects
  # current visibility"): `Hide window` when the window is shown, `Show window` when it is hidden (the ambient
  # hide-to-tray case — 02_ambient-residency-and-actions). One item, its label flips with the window state.
  Scenario Outline: Show/Hide window is one item whose label reflects the current window visibility
    Given a "control" node with server "running" and window "<visibility>"
    When the tray menu model is built
    Then the menu contains exactly one window-toggle item labelled "<label>"
    And the window-toggle label reflects the current window visibility

    Examples: label flips with visibility (DESIGN §Surface 2 region 4)
      | visibility | label       |
      | visible    | Hide window |
      | hidden     | Show window |

  # Quit is ALWAYS last, below a separator (DESIGN §Surface 2 region 5 — "deliberately below a separator and
  # last, so an ambient-presence tool is not quit by accident"). This holds across role and process state: on a
  # control node, a worker node, and a server-stopped control node, Quit remains the terminal item, preceded by
  # a separator, so the accidental-quit guard is structural, not incidental.
  Scenario Outline: Quit is always the last item, below a separator, regardless of role or process state
    Given a "<role>" node with server "<server>" and ui "<ui>"
    When the tray menu model is built
    Then the last menu item is "Quit"
    And the item immediately before Quit is a separator
    And Quit is never rendered above any other action item

    Examples: the separator-then-Quit tail holds across the menu variants
      | role    | server  | ui      |
      | control | running | running |
      | control | stopped | stopped |
      | worker  | n/a     | running |
