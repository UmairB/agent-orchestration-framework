@bug @finding-F6 @executable @ui @work @distribution
Feature: The web fleet's read route carries the presence record, so the NodeCard can render the session it was built to render
  In order that SPEC objective (a) holds on the WEB fleet surface (m25/34) — a node with a live coding-assistant
  session reads `working · <repo> (session)` — the fleet's ONE read route `/api/mesh/status` must actually carry
  each node's presence record (`activeRuns` + `sessions`). Today it carries none, so the React NodeCard's
  session projection is dead code in production.

  # FINDING F6 (aof:verify 38, BLOCKER — found by the live task-06 soak).
  #
  # OBSERVED: with a REAL live session on disk and the presence daemon correctly publishing the frozen FIVE keys
  # (`aof mesh status --json` → `sessions: [{workspaceId, repo, assistant, lastPingAt}]`), the web fleet still
  # renders `idle`. GET /api/mesh/status returns node objects with keys
  # `nodeId, role, controlNode, host, os, runtimes, aofVersion, publishedAt, lastSeenAt, fabric, recordSource,
  # workspaces, descriptorPath, freshness, workspaceIds` — there is NO `presence` key at all.
  #
  # ROOT CAUSE: `src/mesh-ui-serve.mjs` serves BOTH scopes ("global" AND "local") from
  # `queryGlobalMeshStatus` (src/global-mesh-query.mjs), and that projection builds NO presence record — it
  # derives only a `freshness` ramp ("live"/"stale"/"unknown") from the presence timestamps and DROPS the record
  # itself. But `ui/src/fleet/Fleet.tsx:631` reads `fleetCurrentWorkLines(node.presence ?? {})` — with no
  # `presence` on the wire it always receives `{}`, so `activeRuns`/`sessions` are always empty and row 3 is
  # ALWAYS `idle`. This also means the m23 `running N runs` state has never rendered on the web fleet either.
  #
  # WHY IT SHIPPED GREEN: task 04's render test fed `fleetCurrentWorkLines` a hand-built presence FIXTURE, and
  # the build-time design review served `ui/dist` with a fixture presence payload. Neither ever fed the card the
  # shape its REAL producer (`/api/mesh/status`) emits. Same defect class as F1 and F4 — a component exercised
  # against a fixture shaped to its own convenience, never against its actual producer.
  #
  # @qa: the assertion whose absence let this ship is "the REAL read route's payload, fed to the REAL card
  # projection, yields the working line". Fixtures MUST be the route's actual response, not a hand-built record.

  Background:
    Given a node with a live coding-assistant session and no active run
    And the presence daemon has published the frozen five-key record for it

  Scenario: the fleet read route carries each node's presence record
    When the fleet client GETs `/api/mesh/status`
    Then each node object carries a `presence` key
    And that presence is the frozen FIVE-key record — `nodeId`, `heartbeatAt`, `activeRuns`, `sessions`, `aofVersion` (ADR-001, key order preserved)
    And `sessions[]` holds the node's LIVE (TTL-filtered, run-subsumed) sessions exactly as the publisher emitted them
    And the existing `freshness` ramp is UNCHANGED (additive — the presence record is carried ALONGSIDE it, breaking no existing consumer)

  Scenario: the real route payload, fed to the real card projection, renders the session
    # The end-to-end assertion that closes the fixture-vs-producer gap for THIS surface.
    Given the ACTUAL JSON body returned by `/api/mesh/status` (not a hand-built fixture)
    When `fleetCurrentWorkLines(node.presence)` is applied to it
    Then the line reads `working · <repo> (session)`
    And the token is `primary`, not the `muted` `idle` token

  Scenario Outline: every row-3 state survives the real route end to end
    Given a node whose published presence is <presence>
    When the fleet client reads `/api/mesh/status` and the card projects it
    Then row 3 reads <line>

    Examples:
      | presence                                  | line                          |
      | no runs, no sessions                      | idle                          |
      | a live session on one repo, no run        | working · <repo> (session)    |
      | live sessions on two repos, no run        | working · repoA, repoB (session) |
      | an active run (run wins, ADR-004)         | running N runs                |

  Scenario: a node that never beat still degrades cleanly
    # `presence` is OPTIONAL on the wire (ui/src/fleet/api.ts: `presence?: PresenceRecord`) — a never-beat node
    # must not become an error; it simply reads `idle`.
    Given a node with no presence record at all
    When the fleet client reads `/api/mesh/status`
    Then the node's `presence` is absent (not a fabricated empty record)
    And the card renders `idle` without error

  Scenario: both scopes carry it
    # mesh-ui-serve serves "global" AND "local" from the same queryGlobalMeshStatus — the fix must land for both,
    # or the gap simply moves.
    Then `/api/mesh/status?scope=global` carries the presence record
    And `/api/mesh/status?scope=local` carries the presence record
