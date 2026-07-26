@uat @ui @design @distribution
Feature: The rendered tray icon at 16px reads its state by shape/badge in a light + dark taskbar — a design-conformance judgement
  In order that the ambient tray signal is legible at a glance from a real Windows taskbar — in both themes,
  in monochrome, and for a colour-blind operator — the rendered 16px icon for each of the three states
  (healthy / degraded / stopped) is judged by a person against the design, not by a returned struct.

  # DESIGN §Surface 2 "Tray ICON states" is the conformance source; mocks/tray-menu.png is the pixel source of
  # truth ONCE landed, and until then DESIGN's binding checklist is the standing baseline (DESIGN §"Review rule"
  # — the review does NOT return INCONCLUSIVE-on-missing-baseline while DESIGN.md stands). At author time the
  # PNG is not yet committed (mocks/ holds only README.md), so this @uat judges against the §Surface 2 checklist.
  #
  # THE PURE STATE→BADGE MAPPING this render displays is 00_tray-icon-states (the @executable lane — no
  # TrayIconBuilder, no window). THIS feature is the VISUAL lane only: QA renders each of the three states at
  # 16px into BOTH a simulated light and dark taskbar and hands the composite to the designer; the designer
  # returns CONFORMS / DESIGN-GAP. Once CONFORMS, the approved render becomes the baseline QA's own
  # toHaveScreenshot visual-regression guards against future drift (the SEAM is QA's; building the baseline into
  # a hard gate is a QA follow-on, out of scope for this feature). The a11y lane is OFF for this story (no
  # "a11y" in work.tags.domains); the monochrome-legibility judgement below is a design-conformance check.
  #
  # RESOLVED (developer-amigo): the render harness is the cached ms-playwright Chromium driven directly
  #   (`--headless=new --screenshot=<ABSOLUTE forward-slash path>`; `npx playwright` is policy-blocked) — the
  #   proven m34/m35 pattern — over the icon's own HTML/CSS/SVG glyph fed each state, NOT a screenshot of a
  #   built-and-launched Tauri window (which would gate the design review on a signed build + a WebView2 box).
  #   Deferred design gate — judged at `aof:verify`.

  Scenario: the rendered tray icon at 16px reads its state by shape/badge in both light and dark taskbars
    Given the tray icon is rendered at 16px for each state healthy, degraded, and stopped
    And it is composited into both a light taskbar and a dark taskbar
    When a person judges the render against DESIGN §Surface 2 and mocks/tray-menu.png
    Then healthy shows the mesh mark with no badge
    And degraded shows the mark with a small caution badge (an attention tone, not alarm)
    And stopped shows the mark dimmed/hollow with a stop badge, clearly distinct at a glance from degraded
    And each state is distinguishable in monochrome — the badge shape carries the meaning, colour never alone
    And the shape and badge are identical across light and dark, only the fill adapting to the theme
    And stale-driven degradation reads as calm grey/amber, never red (DESIGN §Review notes "Stale is never red")
