@cli @work @board @bug @finding-F1
Feature: A first-class command serves the built board same-origin so the API, the terminal WS, and the bundle share one origin
  In order to actually open the work board and run the agent terminal against an item
  the operator needs one command that serves the BUILT board (not the dev source) on a single 127.0.0.1 origin, so the same-origin `/api/work*` calls and the `/ws/terminal` stream both resolve.

  # F-1 (VERIFICATION.md): the board's API calls are same-origin relative paths
  # (ui/src/board/api.ts) and the terminal WS URL is built from
  # window.location.host (ui/src/board/TerminalDock.tsx), so the page MUST be
  # served from one origin that also routes /api/work* and /ws/terminal. The
  # delivered launchers did not do this: `aof assets ui` runs vite (proxies only
  # /api, no /ws, no ws:true) in assets mode, and serveSetupUi served the dev
  # ui/ index (→ /src/main.tsx, vite-only), never the built ui/dist bundle. The
  # same server ALREADY routes /api/work* + /ws/terminal + static on one port
  # (acd-board-single-server); the only gap is serving the BUILT board there and
  # a command to launch it. These scenarios pin that fix.

  # --- the server can serve the built board same-origin (server-side) ---------

  # serveSetupUi takes a uiRoot override so it can serve the built bundle
  # (ui/dist) instead of the dev source. When it does, the served index
  # references the built assets (/assets/*.js), NOT the vite-only /src/main.tsx —
  # i.e. the page loads with no vite/dev server.
  @executable
  Scenario: serving with a built uiRoot returns the built index, not the dev source
    Given a serveSetupUi server whose uiRoot is a built bundle directory
    When a client requests "/"
    Then the response is the built index referencing the hashed bundle under "/assets/"
    And the served index does not reference "/src/main.tsx"

  # The headline: with the built board served, all three surfaces resolve on ONE
  # origin — the work-list API, a static bundle asset, and the terminal WS
  # handshake — so the relative api.ts fetches and the window.location.host WS
  # both reach the server. (This is the F-1 regression: the terminal can connect.)
  @executable
  Scenario: the API, a bundle asset, and the terminal WS all resolve on the one served origin
    Given a serveSetupUi server whose uiRoot is a built bundle directory
    When the board requests "/api/work/list"
    Then the response is a flat JSON array
    When a client requests the hashed bundle asset under "/assets/"
    Then it is served with a JavaScript content type
    When a client opens a "/ws/terminal" WebSocket on the same origin
    Then the handshake succeeds on the same port

  # --- the launch command (CLI) ----------------------------------------------

  # A first-class command launches the board: it resolves the built bundle,
  # serves it same-origin, and prints the board URL carrying the board mode so
  # the operator opens the board (not the assets editor).
  @executable
  Scenario: the board launch command serves the built bundle and prints the board-mode URL
    Given the built board bundle exists
    When the operator runs the board launch command
    Then it serves the built board on a single 127.0.0.1 origin
    And it prints a URL carrying the board mode

  # Honest degrade: if the build is absent, the command does not silently serve
  # the dev source or crash — it tells the operator to build the UI first.
  @executable
  Scenario: a missing build is reported, not silently served from source
    Given the built board bundle does not exist
    When the operator runs the board launch command
    Then it reports that the UI build is missing and how to produce it
    And it does not fall back to serving the dev source

  # --- the operator confirms it loads (browser) ------------------------------

  # The proactive analog of the A4 @uat lane's precondition: opening the printed
  # URL renders the board (not the assets editor) and the terminal dock can reach
  # a running session against a present provider — i.e. F-1 is truly cleared.
  @manual
  Scenario: opening the printed URL renders the board and the terminal can connect
    Given the operator has started the board launch command
    When they open the printed board-mode URL in a browser
    Then the work board renders (milestones → stories → tasks), not the assets editor
    And pressing Run agent on a selected item reaches the running state in the terminal dock
