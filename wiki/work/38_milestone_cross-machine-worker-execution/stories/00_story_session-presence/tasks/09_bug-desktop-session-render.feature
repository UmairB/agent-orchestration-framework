@bug @finding-F7 @finding-F8 @executable @ui @work @distribution
Feature: The desktop fleet renders a live session as `working · <repo> (session)`, and reads `activeRuns` in its real frozen shape
  In order that SPEC objective (a) holds on the DESKTOP fleet (m36) — the very surface whose UAT raised the
  "the fleet lies about what a node is doing" bug — the Rust desktop's node-row view model must learn the m38
  session signal (`presence.sessions`) and render `working · <repo> (session)`, applying ADR-004's run-wins rule.
  While there, it must read `presence.activeRuns` in the shape the producer actually emits.

  # FINDINGS F7 + F8 (aof:verify 38, BLOCKER — found by the live task-06 soak).
  #
  # F7 — THE DESKTOP NEVER LEARNED ABOUT SESSIONS. `app/desktop/crates/core/src/view_model.rs` defines
  #   `enum CurrentWork { Running { work_ref, title }, Idle }` — there is NO session variant — and
  #   `current_work(node)` derives the cell from `presence.activeRuns` ALONE ("a non-empty array yields the
  #   FIRST run's ref+title; an empty array, or no presence at all, yields `idle`"). So with a REAL live session
  #   published in presence, the desktop renders `idle`. VERIFIED LIVE: `aof mesh status --json` (the desktop's
  #   own single data path, 36/ADR-004) returned `sessions: [{workspaceId, repo:"aof", assistant, lastPingAt}]`
  #   while the desktop card read `idle`. The milestone's headline fix is absent from its headline surface.
  #
  # F8 — THE DESKTOP READS `activeRuns` IN A SHAPE THE PRODUCER NEVER EMITS. `current_work()` does
  #   `first.get("ref")` / `first.get("title")` — i.e. it expects `activeRuns[]` to hold OBJECTS. But
  #   `readActiveRuns` (src/mesh-presence.mjs:69-78) returns `runIds` — a bare **`string[]`** — and
  #   `mesh-identity.mjs:218` passes it through UNENRICHED. ADR-001 freezes `activeRuns: string[]`. So on a real
  #   running run the desktop's `.get("ref")` on a JSON string yields None and it renders `" · (running)"` with an
  #   EMPTY ref and title. (This is the m36-era twin of finding F1, which caught the identical `activeRuns`-as-
  #   objects assumption on the JS side.)
  #
  # ARCHITECTURAL NOTE (ADR-004 is amended alongside this task): ADR-004 asserts "Both UIs consume the SAME
  # projection function". That premise is FALSE — the desktop is a Rust/Tauri app and structurally CANNOT import
  # `ui/src/fleet/runs.mjs`. The RULE is shared; the IMPLEMENTATION is necessarily duplicated across the Rust and
  # JS surfaces. The binding discipline that replaces the false premise: BOTH implementations must be exercised
  # against the SAME REAL captured presence payload, so they cannot drift.
  #
  # @qa: fixtures MUST be a REAL captured `aof mesh status --json` payload (frozen five keys, `activeRuns` as
  # `string[]`), never a hand-authored record. That is the exact discipline whose absence produced F1/F4/F6/F7/F8.

  Background:
    Given the desktop's single data path — `aof mesh status --json` (36/ADR-004)
    And a REAL captured payload in which `presence` is the frozen FIVE keys and `activeRuns` is a `string[]`

  Scenario: a live session with no active run renders the working line (F7 — the headline regression)
    Given a node whose presence carries one live session on repo "aof" and an EMPTY `activeRuns`
    When the desktop derives the node row's current-work cell
    Then the cell reads `working · aof (session)`
    And its state is the ACTIVE state, carrying the same emphasis a running node carries — not the muted `idle` token
    And it is NOT `idle`

  Scenario: a node working two repos shows both (SPEC's acceptance line)
    Given a node with live sessions on repos "alpha" and "beta" and no active run
    Then the cell reads `working · alpha, beta (session)` — comma-joined under one `working ·` prefix, one trailing `(session)`

  Scenario: the run wins the line when a run and a session both exist (ADR-004)
    Given a node with an active run AND a live session
    Then the cell renders the RUN, not the session
    And the session does not add a second line for that same workspace

  Scenario: an expired session never sticks — the cell falls back to idle
    # The card renders only what the aggregate hands it; the publisher TTL-filters and run-subsumes before the
    # wire. The desktop must never recompute liveness nor ghost an expired session.
    Given the publisher has already dropped a TTL-expired session from `sessions[]`
    Then the cell reads `idle`
    And the desktop performs no session-liveness computation of its own

  Scenario Outline: `activeRuns` is read in its REAL frozen shape — a `string[]` of run ids (F8)
    Given `presence.activeRuns` is <active_runs> exactly as the producer emits it
    Then the current-work cell reads <cell>
    And the desktop never indexes a run element as an object with `ref`/`title` fields

    Examples:
      | active_runs                | cell            |
      | [] (empty)                 | idle            |
      | ["run-0001"]               | running 1 run   |
      | ["run-0001", "run-0002"]   | running 2 runs  |

  Scenario: no presence at all degrades cleanly
    Given a node with no presence record
    Then the cell reads `idle` without error
