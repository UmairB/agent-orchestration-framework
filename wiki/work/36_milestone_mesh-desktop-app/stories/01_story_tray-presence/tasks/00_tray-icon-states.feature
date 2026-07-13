@executable @ui @distribution
Feature: The pure health-summary → tray-icon-state mapping — shape/badge, readable in monochrome, colour never alone
  In order that an operator glancing at the Windows taskbar reads fleet+supervision health at a glance —
  by the icon's SHAPE and BADGE, not by colour alone — a framework-free supervisor-core helper maps a
  health summary (fleet presence + local server/app process state) to exactly one of three icon states
  (healthy / degraded / stopped), each carrying a monochrome-legible mark so the signal survives a
  greyscale taskbar, a monochrome-icon mode, and colour-blindness.

  # DESIGN §Surface 2 "Tray ICON states" + ADR-002 (the health/role model, story 00) + ADR-001 (the tray via
  # Tauri TrayIconBuilder). This is a PURE state-selection over the core's health model — no TrayIconBuilder,
  # no WebView2, no taskbar, no I/O — a plain Rust function in the app/desktop/ supervisor core, so it runs
  # HEADLESSLY as a cargo unit test (the @executable lane), exactly like the icon-render surface is judged
  # separately by the @uat visual below.
  #
  # TWO RAMPS, KEPT HONEST (DESIGN §Non-negotiable framing / §Review notes — "never conflate the two ramps"):
  # the tray HEADER shows fleet presence (N online · M stale — see 01_tray-menu-model). The ICON here is the
  # AMBIENT roll-up: `degraded` may be driven by fleet staleness OR by a local server `restarting`; `stopped`
  # by the local server/app supervision being down. This helper takes BOTH signals (fleet summary AND local
  # server/app process state) as inputs and does not let one masquerade as the other — it is the one place the
  # two ramps legitimately combine into a single ambient glyph, and it must read both truthfully.
  #
  # SEAM SPLIT — this task is the PURE mapping ONLY. WHAT the rendered 16px glyph LOOKS like in a light/dark
  # taskbar is the @uat visual below (against DESIGN §Surface 2 + mocks/tray-menu.png). WHICH menu items the
  # state co-renders with is 01_tray-menu-model. That closing the window keeps the icon RESIDENT is
  # 02_ambient-residency-and-actions. The a11y lane is OFF for this story (no "a11y" in work.tags.domains — no
  # axe-core run, no a11y finding); the monochrome-legibility assertion below is a BEHAVIOURAL contract on the
  # descriptor, not an axe check.
  #
  # RESOLVED (developer-amigo): confirm the @executable lane — this maps to a cargo unit test over a pure
  #   `icon_state(fleet_summary, server_state, app_state) -> IconState` selector in the app/desktop/ core (no
  #   TrayIconBuilder, no window). Confirm the descriptor carries a monochrome `badge` field (none/caution/stop)
  #   alongside the `state`, so the shape/badge assertions below are a real returned field, not a render-only fact.

  Background:
    Given the pure tray-icon-state helper is imported from the supervisor core with no taskbar and no window

  # The three states (DESIGN §Surface 2 "Tray ICON states"). Each pairs a NAME with a monochrome-legible BADGE
  # so the state reads in greyscale: healthy = the mesh mark, no badge; degraded = the mark + a caution badge
  # (amber dot/triangle overlay — attention, not alarm); stopped = the mark dimmed/hollow + a stop badge.
  # `healthy` requires BOTH all-online AND the local server running — either an offline/stale fleet OR a
  # non-running server pulls it off `healthy`. Colour is NEVER the sole differentiator: the badge shape differs
  # per state, so a monochrome render still distinguishes all three.
  Scenario Outline: a health summary maps to exactly one icon state, distinguished by badge shape in monochrome
    Given a fleet summary "<fleet>" with server process "<server>" and app supervision "<app>"
    When the tray icon state is selected
    Then the icon state is "<state>"
    And the icon badge is "<badge>"
    And the badge shape distinguishes this state without relying on colour
    And the selector returns exactly one state, never both a healthy and a degraded badge at once

    Examples: healthy — all nodes online AND the local server running, no badge (DESIGN §Surface 2)
      | fleet          | server  | app     | state   | badge   |
      | all-online     | running | running | healthy | none    |

    Examples: degraded — something stale in the fleet OR the local server restarting; a caution badge, attention not alarm
      | fleet          | server     | app     | state    | badge   |
      | one-stale      | running    | running | degraded | caution |
      | all-online     | restarting | running | degraded | caution |
      | some-stale     | running    | running | degraded | caution |

    Examples: stopped — the local server (or the whole app supervision) is stopped; a dim/stop badge, distinct at a glance
      | fleet          | server  | app      | state   | badge   |
      | all-online     | stopped | running  | stopped | stop    |
      | all-online     | running | stopped  | stopped | stop    |
      | no-nodes       | stopped | running  | stopped | stop    |

  # DESIGN §Review notes "Stale is never red" — a degraded icon driven by fleet STALENESS carries the calm
  # caution badge, NOT an alarm/error treatment. Stale is degraded liveness, not data loss; the badge is the
  # attention (amber) tone, and the helper must not escalate a stale-only fleet to the stopped/alarm form.
  Scenario: a stale-only fleet degrades to the calm caution badge, never to an alarm or the stopped state
    Given a fleet summary "one-stale" with server process "running" and app supervision "running"
    When the tray icon state is selected
    Then the icon state is "degraded"
    And the icon badge is "caution"
    And the icon state is NOT "stopped" and is not an alarm/error treatment

  # DESIGN §Surface 2 "Ships light- and dark-taskbar variants … the shape/badge is identical across themes,
  # only the fill adapts." The PURE state/badge is theme-INVARIANT: selecting the state does not depend on the
  # taskbar theme, so the same summary yields the same state+badge in light and dark — only the render (the
  # @uat below) swaps the fill.
  Scenario Outline: the state and badge are identical across light and dark taskbars — only the render fill adapts
    Given a fleet summary "one-stale" with server process "running" and app supervision "running"
    When the tray icon state is selected for taskbar theme "<theme>"
    Then the icon state is "degraded"
    And the icon badge is "caution"
    And the selected state and badge do not vary with the taskbar theme

    Examples: both themes are first-class (DESIGN §Shared ramp "light + dark")
      | theme |
      | light |
      | dark  |

  # Keep-last-good over a silent status re-poll (DESIGN §Surface 2 "Loading"/"Error" — keep-last-good). A SILENT
  # failed poll must NOT flip the icon to a spurious `stopped` alarm; the helper describes the LAST-GOOD summary
  # it is handed, so the ambient signal does not flicker to "everything is down" on a transient poll miss. (An
  # actual server-stopped fact is a different input, still maps to `stopped` — this covers only the silent miss.)
  Scenario: on a silent status re-poll failure the icon holds the last-good state — it does not flicker to stopped
    Given the last-good summary was fleet "all-online" server "running" app "running" (state "healthy")
    And a subsequent silent status poll fails and the helper is handed the last-good summary
    When the tray icon state is selected for the last-good summary
    Then the icon state is "healthy"
    And the helper does not flip to "stopped" on the silent-poll miss

  # The rendered 16px glyph in a light/dark taskbar is judged separately — the @uat visual lives in its own
  # single-lane feature (03_tray-icon-visual.feature), so this feature stays a pure @executable mapping.
