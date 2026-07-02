@cli @work @distribution @executable
Feature: the fleet aggregate degrades gracefully — a missing or torn registry yields a single-node fleet, a stale node still renders
  In order that the fleet read NEVER blanks on a missing seam,
  mesh:status tolerates the m24 registry being absent, empty, or torn — the boards projection
  degrades to empty while the node roster still renders in full — and a stale node renders as a
  stale node,
  so that milestone 25 builds and answers truthfully before milestone 24 lands (a single-node
  fleet today), a torn record never blinds the roster, and degraded liveness is rendered state,
  never a dropped node or an error.

  # ARCHITECTURE ADR-002 decision 4: the codebase's ENOENT→[]/null discipline applied to the
  # fleet aggregate. readRegistry is itself absence-tolerant (no registry file ⇒ the empty
  # registry, 24/ADR-001); this feature asserts the AGGREGATE's observable degradation on top:
  # boards empty ⇒ nodes still render; torn ⇒ empty, not thrown; stale ⇒ rendered (the
  # 23/ADR-003 clean-degrade discipline applied to the render). The never-blank rule is the
  # load-bearing outcome: losing a seam loses that PROJECTION, never the view.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And mesh:status accepts an injected "now" and reads the records I plant

  # The headline: no registry at all — the single-node fleet. The node roster answers in
  # full; the boards projection is empty, not an error.
  Scenario: with no registry file the aggregate degrades to the node roster
    Given a node "node-a" with a fresh presence heartbeat
    And no group registry file exists in the workspace
    When I invoke mesh:status with an injected now
    Then the --json result carries "node-a" in its nodes half as usual
    And the boards projection is an empty list
    And no error is raised

  # A torn / unparseable / foreign-shaped registry reads as empty — skipped, never blinding
  # the roster.
  # DEV CORRECTION (was QA note — source reality re-checked against src/mesh-registry.mjs):
  # readRegistry is absence-tolerant for ENOENT ONLY. It has NO catch-all around the parse:
  # `JSON.parse(raw)` (line 113) sits OUTSIDE the readFile try/catch, and the module's own
  # comment (lines 98-101) states "a corrupt/torn registry THROWS rather than reading as
  # empty." So UNPARSEABLE bytes THROW out of readRegistry, and a "JSON array where the
  # object should be" PARSES but is the wrong shape. THEREFORE the AGGREGATE (mesh:status)
  # must own BOTH halves of the degradation itself: (a) wrap the readRegistry call in a
  # try/catch so a THROW (unparseable bytes) degrades to empty boards, never blinding the
  # roster; (b) shape-guard the parsed value so a non-registry shape (array, {}, null
  # roster/boards) degrades to empty boards, not a crash on `.boards`/`.roster`. This is
  # ADR-002 decision 4(c) ("a torn/unparseable record — skipped, never blinding the list")
  # applied at the aggregate — the buildable seam is a guarded readRegistry + a defensive
  # union over (registry.boards ?? []) ∪ (registry.roster ?? []).flatMap(r => r.boards ?? []).
  # The rows below split the two halves of "torn" — a THROW and a wrong-shape — and both must
  # degrade identically to an empty boards projection with the node roster intact.
  Scenario Outline: a torn or foreign-shaped registry degrades to an empty boards projection, not an error
    Given a node "node-a" with a fresh presence heartbeat
    And the group registry file exists but holds <content>
    When I invoke mesh:status with an injected now
    Then the --json result carries "node-a" in its nodes half as usual
    And the boards projection is an empty list
    And no error is raised

    Examples:
      | content                                             |
      | unparseable bytes (not JSON)                        |
      | the JSON object {} (no roster, no boards)           |
      | a JSON object whose roster and boards are null      |
      | a JSON array where the registry object should be    |

  # A registry present but empty (a control node that admitted no one yet) is the same
  # empty projection — absent and empty are the same rendered truth.
  # QA: "the empty registry" is m24's exact emptyRegistry() shape —
  # { "roster": [], "boards": [], "pending": [], "revocations": [] } — the literal an
  # absent file reads as, planted here explicitly on disk.
  Scenario: an empty registry renders the same as no registry
    Given the group registry file exists and holds { "roster": [], "boards": [], "pending": [], "revocations": [] }
    When I invoke mesh:status with an injected now
    Then the boards projection is an empty list
    And no error is raised

  # Degraded liveness is RENDERED, never dropped: a stale node keeps its roster line and
  # its boards keep their tiles' facts — staleness is a state, not a filter.
  Scenario: a stale node still renders in full, with its board still listed
    Given a node "node-a" whose presence heartbeatAt is well past the staleness threshold
    And a group registry whose roster admits "node-a" with board "let-shield"
    When I run "aof mesh status"
    Then "node-a" renders with the "stale" token (not dropped, not an error)
    And "let-shield" still renders in the boards section with its owner "node-a"

  # A board registered against a node the roster does not know (a torn half-sync) is
  # still listed — rendered truthfully with no owner, never dropped or thrown.
  # DEV FEASIBILITY VERDICT (was QA FLAG — ownerless representation): LOCKED, OMITTED (not
  # null). Consistent with the task-00 key verdict { ref, owner, activeRuns } and the m23
  # never-beat presence idiom (src/commands/mesh-identity.mjs: a node with no presence OMITS
  # the `presence` key — absent, not null — asserted by 23/00 task 01 `!("presence" in node)`).
  # So a board whose owner is missing from the roster carries the `ref` + `activeRuns` keys
  # but OMITS the `owner` key entirely (absent, never `owner: null`) — the first-wins roster
  # scan found no entry carrying the slug, so no owner is claimed. The HUMAN render (task 01's
  # boards section) DOES carry the ownerless board line: it renders the board `ref` with NO
  # "on <nodeId>" owner suffix (owner-absent ⇒ no owner label, truthfully — never a dropped
  # line, never an error). One resolution covers --json (owner key omitted) AND text (no owner
  # suffix). The scenario stands: assert "let-shield" is listed with NO owner key present.
  Scenario: a board whose owner is missing from the roster renders ownerless, not an error
    Given a group registry that registers board "let-shield" but whose roster admits no node carrying it
    When I invoke mesh:status with an injected now
    Then "let-shield" appears in the boards projection with its `owner` key OMITTED (absent, not null)
    And no error is raised

  # The run seam degrades too: a board whose owner has no synced presence (a peer whose
  # presence has not reached this node yet, or a never-beat owner) yields zero active runs,
  # never an error.
  # ADR-005 (finding F1) — SUPERSEDES the earlier "local work stream" seam. A board's
  # activeRuns is its OWNER node's synced presence.activeRuns, NOT a read of a
  # <workDir>/<slug> stream (that stream had NO runtime producer — F1). Reusing the SAME
  # merged presence the nodes half already computed is the SINGLE source (not a second read
  # path — mesh:status already reads presence for the roster), and it is the ONLY signal
  # reachable for a PEER board (the peer's run records never sync here, but its presence
  # does). The degradation floor is unchanged and even more natural: an owner with NO
  # presence record contributes an EMPTY activeRuns (the never-blank []-not-error rule) —
  # the board stays listed (from the union enumeration), its activeRuns read empty, nothing
  # throws.
  Scenario: a board whose owner has no synced presence reads as zero active runs
    Given a group registry whose roster admits "node-b" with board "remote-board"
    And no presence record for "node-b" has reached this node
    When I invoke mesh:status with an injected now
    Then "remote-board" appears in the boards projection with its `owner` "node-b"
    And its `activeRuns` list is empty (an absent run signal is degradation, not an error)
    And no error is raised
