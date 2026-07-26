@executable @ui @design @distribution
Feature: The pure status-render view-model maps a `mesh status --json` payload to node rows — the corrected shape, the two ramps kept separate
  In order that an operator reads the fleet at a glance — every node's liveness, role, version and current work —
  a framework-free view-model maps the CORRECTED `mesh status --json` payload (nested `presence`, `node.local`, `node.stale`, top-level `isControlNode`)
  to a fixed row descriptor per node, deriving the fleet-presence health dot from `node.stale`/`presence` (never from a local-process signal)
  so that the WebView renders `online | stale | offline`, `this node`, a role badge, the `aofVersion`, and current work from `presence.activeRuns` (a work ref + title, else `idle`) — truthfully and without crashing on a node that never beat.

  # DESIGN §Surface 1 (§"Layout regions" item 3 — the body node row anatomy; §"Design ramp per region")
  # + ADR-004 (the CORRECTED contract: `{ nodes, boards, isControlNode }`, each node `presence?` nested with
  # `activeRuns`/`aofVersion`/`heartbeatAt`, `node.stale: boolean`, `node.local: true` on this node only). This
  # is the LOAD-BEARING correction (ARCHITECTURE Fitness-functions note): `activeRuns`/`aofVersion` are NOT flat
  # on the node — they live under `presence`, which is OMITTED (not null) when the node has never beat, and
  # `stale` is FALSE for a never-beat node (you can only be stale once you have a heartbeat — mesh-identity.mjs
  # :255-258). The row descriptor is a PURE mapping — no DOM, no clock, no I/O — so these scenarios run headless.
  #
  # THE TWO RAMPS STAY SEPARATE (DESIGN §Non-negotiable framing / §Review notes "the two ramps stay separate"):
  # the BODY health dots are the FLEET-PRESENCE ramp (online/stale/offline — the `mesh:status` heartbeat signal);
  # the control-bar process pills are the LOCAL-SUPERVISOR ramp (running/stopped/restarting — story 00's
  # supervisor state). This view-model derives ONLY the body dots from `mesh:status`; it NEVER reads a local
  # process signal for a body dot, and a scenario asserts a node reads `online` in the body while its local
  # web-UI child pill reads `stopped` — both truthful side by side.
  #
  # SEAM SPLIT — this task is the PURE view-model (the SHAPE→rows mapping) ONLY. The state-selection (which of
  # the four states renders) is task 01. The no-write / read-only WIRE posture is task 02. That the render LOOKS
  # right against the mock + checklist is the @uat design-conformance judgement (task 03). The a11y lane is OFF
  # for this story (no "a11y" in work.tags.domains — no axe-core run, no a11y finding).
  #
  # RESOLVED (developer-amigo): confirm the harness shape — this @executable pure-model is expected to be a
  # Rust `#[test]` (`cargo test`) over the `app/desktop/` deserialize+map fn (the corrected-shape build-
  # correctness `.feature` ADR-004 defers to story 02), NOT a Node headless test. The developer amigo confirms
  # the exact test runner and whether the fixture payloads are inline JSON or a shared fixtures dir.

  Background:
    Given the pure status-render view-model is imported with no DOM and no clock
    And it is handed a deserialized `mesh status --json` payload of shape `{ nodes, boards, isControlNode }`

  # THE HEALTH DOT — the fleet-presence ramp, derived from `node.presence`/`node.stale` ONLY (DESIGN §Surface 1
  # body row · §Design ramp "health dot from the presence ramp"). online = has presence, not stale; stale =
  # has presence, stale true (a MUTED grey dot — NEVER red, stale is degraded liveness not data loss, DESIGN
  # §Review notes "stale is never red"); offline/unknown = NO presence key (never beat) → a hollow/dim dot,
  # never a crash on the absent `presence`.
  Scenario Outline: each node's health dot comes from the fleet-presence ramp (presence + stale), never from a process signal
    Given a node with presence "<presence>" and stale "<stale>"
    When the node row descriptor is selected
    Then the health dot reads "<dot>"
    And the dot is paired with its label "<label>" (colour never travels alone)
    And a stale dot is a muted/grey mark, never red

    Examples: the fleet-presence ramp (DESIGN §Surface 1 · ADR-004 corrected shape)
      | presence | stale | dot            | label   |
      | present  | false | filled accent  | online  |
      | present  | true  | hollow muted   | stale   |
      | absent   | false | hollow dim     | offline |

  # CURRENT WORK — the row's emphasis (DESIGN §Surface 1 body row: "current work is the single most-glanced
  # fact"). It comes from `presence.activeRuns` (nested — NOT flat on the node, ADR-004): a non-empty array →
  # a work ref (mono, e.g. `35/02`) + short title with a RUNNING marker (pulsing accent dot); an empty array,
  # or NO presence at all → `idle` in muted text. The ref stays mono so it reads as an addressable work item.
  Scenario Outline: current work is read from `presence.activeRuns` — a running ref+title, else muted `idle`
    Given a node whose `presence.activeRuns` is "<activeRuns>"
    When the node row descriptor is selected
    Then the current-work cell reads "<work>"
    And the work state is "<workState>"
    And a running work ref renders in mono with a pulsing accent marker
    And an idle cell is muted text, never an accent

    Examples: current work from the nested activeRuns (DESIGN §Surface 1 · ADR-004)
      | activeRuns                    | work                       | workState |
      | [{ref:"35/02",title:"UI"}]    | 35/02 · UI (running)       | running   |
      | []                            | idle                       | idle      |
      | (no presence key)             | idle                       | idle      |

  # THE `this node` TAG — an IDENTITY label off `node.local`, NOT a colour change (DESIGN §Surface 1 body row:
  # "an identity label — neutral outline chip — not a colour change; driven off `mesh:status` local"). `local`
  # is present (true) ONLY on this node's entry (omitted elsewhere — mesh-identity.mjs:259-261), so exactly the
  # local node carries the tag; it never recolours the row or the health dot.
  Scenario Outline: the `this node` tag is an identity label off `node.local`, only on the local node, never a colour change
    Given a node with `local` "<local>"
    When the node row descriptor is selected
    Then the row "<carries>" a neutral-outline `this node` tag
    And the tag does not change the node's health-dot colour or the row colour

    Examples: the local identity tag (DESIGN §Surface 1 · ADR-004 `node.local`)
      | local          | carries      |
      | true           | carries      |
      | (absent)       | does not carry |

  # THE ROLE BADGE + VERSION — the role badge is a neutral outline chip (`control` / `worker`), derived from the
  # node's caps/role with the top-level `isControlNode` marking THIS install's role (DESIGN §Surface 1 body row
  # + control-bar this-machine label). The `aofVersion` is read from `presence.aofVersion` (nested, mono, quiet)
  # — a node with no presence reads no version (unknown), never a crash on the absent `presence`.
  Scenario Outline: the role badge is a neutral chip and the version is read from `presence.aofVersion` (nested, mono)
    Given a node with role "<role>" and `presence.aofVersion` "<version>"
    When the node row descriptor is selected
    Then the role badge reads "<role>" as a neutral outline chip (no fill)
    And the version cell reads "<versionCell>" in mono
    And an absent presence yields an unknown-version cell, never a throw

    Examples: role badge + nested version (DESIGN §Surface 1 · ADR-004 `presence.aofVersion`)
      | role    | version | versionCell |
      | control | v1.9.3  | v1.9.3      |
      | worker  | v1.9.3  | v1.9.3      |
      | worker  | (no presence) | —     |

  # A NODE WITH NO `presence` renders WHOLE (DESIGN §Surface 1 populated: "a node still renders"; ADR-004: a
  # never-beat node OMITS presence). The corrected-shape read must NOT assume `activeRuns`/`aofVersion` are flat
  # — it reads them under `presence`, and when `presence` is absent it renders idle current-work + unknown
  # liveness + unknown version WITHOUT crashing (the load-bearing corrected-shape build-correctness assertion).
  Scenario: a node with no `presence` renders idle / unknown-liveness / unknown-version without crashing
    Given a node with no `presence` key, `stale: false`, and a role badge
    When the node row descriptor is selected
    Then the health dot reads "offline" (hollow/dim — unknown liveness, never red)
    And the current-work cell reads "idle" (muted)
    And the version cell reads unknown ("—")
    And the mapping does not throw dereferencing the absent `presence.activeRuns` or `presence.aofVersion`
    And the row is still rendered — never dropped for a missing presence

  # THE TWO RAMPS ARE READ SEPARATELY (DESIGN §Non-negotiable framing / §Review notes). The BODY dot for a node
  # is the fleet-presence signal from `mesh:status`; the CONTROL-BAR process pill is this machine's supervisor
  # signal (story 00). A node can be `online` in the body while its local web-UI child pill reads `stopped` —
  # this view-model derives the body dot ONLY from presence/stale and NEVER from a process pill, so both read
  # truthfully side by side. Conflating them (colouring a body dot from a local child's state) is the forbidden
  # gap (DESIGN §Review notes "a review flags any surface that conflates them").
  Scenario: a node reads online in the body while its local web-UI child pill reads stopped — the two ramps never conflate
    Given the local node is `online` in the fleet-presence body (has presence, not stale)
    And this machine's Mesh web UI child process pill is `stopped` (a local-supervisor signal)
    When the node row descriptor and the control-bar pill descriptor are both selected
    Then the body health dot reads "online" (from `presence`/`stale`, the fleet ramp)
    And the control-bar web-UI pill reads "stopped" (from the supervisor state, the local ramp)
    And the body dot is NOT derived from the local process pill — the two ramps are read from separate sources
    And neither signal overwrites the other — both render truthfully side by side
