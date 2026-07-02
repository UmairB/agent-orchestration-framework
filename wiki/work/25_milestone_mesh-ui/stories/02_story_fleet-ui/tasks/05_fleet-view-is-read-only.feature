@ui @work @distribution
Feature: the fleet view is read-only — it renders the fleet and can change nothing
  In order that mission-control stays a window and never becomes an unaudited lever,
  the fleet surface carries no mutating affordance and its server accepts no mutating request —
  rendering the fleet writes nothing anywhere,
  so that issuing, assigning, routing, or revoking work stays impossible from this surface until
  milestone 27 deliberately adds it over the trust boundary, and the board's write-isolation
  posture is mirrored onto the new face.

  # ARCHITECTURE ADR-004: read-only, no new threat surface — the surface renders
  # already-git-synced records over the same-origin 127.0.0.1 server. That the face module
  # performs zero fs writes / no shell-out / serves no /ws/terminal is STRUCTURAL
  # (acd-mesh-ui-write-isolation, §Fitness C), NOT re-asserted here. This feature asserts the
  # OBSERVABLE read-only-ness: the wire rejects mutation, the disk is unchanged by rendering,
  # and the page offers nothing to click that would mutate. DESIGN documented default 2: the
  # only interactions on the surface are drill-in (task 03) and refresh (task 04).
  #
  # BROWSER LANE (QA-owned): the @manual no-mutating-affordance scenario is a Playwright
  # DOM-audit candidate — the harness enumerates the page's interactive elements and asserts
  # the set is exactly the board drill-ins plus the ⟳ refresh. Tag stays @manual (the human
  # judgement stands; the audit is QA's regression behind it).
  Background:
    Given a fleet server running against records I plant

  # The wire: any write-method request on the fleet namespace is rejected — there is no
  # mutating route to hit, including the would-be m27 verbs (issue/assign), which must not
  # exist early. Method-set completeness: POST/PUT/PATCH/DELETE is the full HTTP mutating
  # set; GET/HEAD/OPTIONS are safe methods and deliberately not in the matrix.
  @executable
  Scenario Outline: a write-method request to the fleet face is rejected
    When the fleet server receives a "<method>" request to "<route>"
    Then the request is rejected without any state change
    And the response is a clean method-rejection, not a crash

    Examples:
      | method | route            |
      | POST   | /api/mesh/status |
      | PUT    | /api/mesh/status |
      | PATCH  | /api/mesh/status |
      | DELETE | /api/mesh/status |
      | POST   | /api/mesh/issue  |
      | POST   | /api/mesh/assign |

  # The disk: serving the fleet view end-to-end mutates nothing — the strongest observable
  # form of the write-isolation posture.
  @executable
  Scenario: serving and rendering the fleet view changes no files
    Given a snapshot of the workspace's on-disk state
    When the fleet page is loaded and /api/mesh/status is read repeatedly
    Then the workspace's on-disk state is byte-unchanged

  # No terminal on this face: the board's per-item terminal is one level down; the fleet
  # face refuses the upgrade — including at the board's own /ws/terminal path, the one an
  # operator's muscle memory would try.
  @executable
  Scenario Outline: the fleet face serves no terminal websocket
    When a websocket upgrade is attempted against the fleet server at "<path>"
    Then the upgrade is refused
    And no terminal session is opened

    Examples:
      | path         |
      | /ws/terminal |
      | /            |

  # The page: no mutating affordance exists anywhere on the rendered surface — the visual
  # statement that the fleet view renders and never drives (m27 adds issue/assign, not here).
  # [Playwright DOM-audit candidate — see the browser-lane note above]
  @manual
  Scenario: the rendered surface offers no mutating control
    Given the operator opens the populated fleet view
    Then no control on the page issues, assigns, routes, revokes, starts, or stops anything
    And the only interactive affordances are the board drill-ins and the ⟳ refresh
