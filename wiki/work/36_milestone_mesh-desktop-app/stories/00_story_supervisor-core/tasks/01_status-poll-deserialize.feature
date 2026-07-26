@executable @ui @distribution @adapter
Feature: The supervisor polls aof mesh status --json on a cadence and deserializes the corrected fleet shape as its single data path
  In order that the tray and window render off ONE truthful model without the app reimplementing any mesh
  machinery, the supervisor reads fleet data through EXACTLY ONE aof command — `mesh status --json` — on a
  cadence, and deserializes the corrected shape ({ nodes, boards, isControlNode }; activeRuns/aofVersion
  nested under each node's optional presence; node.local; node.stale) without crashing on a node that omits
  presence, and extracts isControlNode as the role signal.

  # ARCHITECTURE 36/ADR-004 d1-2 (no-mesh-logic + single fleet-data path — the corrected shape, RESEARCH §3).
  # `mesh status --json` returns `{ nodes: [...], boards: [...], isControlNode }` — TWO arrays plus a scalar
  # flag; `activeRuns`/`aofVersion` live NESTED under each node's OPTIONAL `presence` (a node with no heartbeat
  # OMITS `presence` and reads unknown/idle); the "this is me" marker is `node.local: true` (present ONLY on
  # this node's entry); `node.stale` is a boolean. Coding against the flatter assumed shape would silently fail
  # to parse activeRuns/aofVersion and misread which node is local (RESEARCH §3). The invariants — "fleet data
  # ONLY via `mesh status`, no `mesh identity`/`mesh sync`, no direct .aof record-store read; the app imports no
  # git/websocket/sqlite crate family" — are STRUCTURAL → the fitnesses acd-desktop-single-data-path /
  # acd-desktop-no-mesh-logic (test/arch/), NOT steps. THIS feature asserts the observable deserialization: the
  # nested/optional reads, the local marker, the boolean stale, the top-level siblings, and that ONE data
  # command feeds both the view and the role signal on a cadence.
  #
  # RESOLVED (developer-amigo): proposed `@executable` via `cargo test` over the deserializer as a pure
  # function — a fixture `mesh status --json` document (the corrected shape, presence present on one node and
  # omitted on another) fed to the parse, asserting the typed model WITHOUT spawning a real aof. The cadence is
  # asserted as "one status invocation per tick" over a fake clock/timer seam (no live poll). Confirm the
  # `cargo test` lane + the timer/spawn injection seam next, mirroring m35's `@executable` Rust-logic features.

  Background:
    Given the supervisor deserializes a `mesh status --json` document
    And the document is the corrected shape "{ nodes, boards, isControlNode }"

  # THE CORRECTED SHAPE PER NODE (RESEARCH §3): a node WITH presence carries activeRuns/aofVersion NESTED under
  # presence; a node with NO presence omits it and reads unknown/idle — the parse must never crash on the
  # missing key. Each node's `local` and `stale` are read distinctly.
  Scenario Outline: a node deserializes activeRuns and aofVersion from its optional nested presence, or reads idle when presence is absent
    Given a node whose entry <presence> a "presence" object
    When the node is deserialized
    Then its activeRuns reads "<activeRuns>"
    And its reported aofVersion reads "<aofVersion>"
    And the deserialization does not crash on the presence key

    Examples:
      | presence  | activeRuns          | aofVersion |
      | carries   | the nested runs     | nested     |
      | omits     | unknown / idle      | unknown    |

  # THE LOCAL MARKER (RESEARCH §3): `local: true` is present on EXACTLY ONE node — this node's own entry — and
  # omitted everywhere else; it is a boolean flag, not a top-level localId string.
  Scenario: exactly one node is marked local and every other node is not
    Given a two-node document where the second node carries "local": true
    When the nodes are deserialized
    Then exactly one node reads local true
    And the first node reads local false (the key is omitted)
    And "local" is read as a per-node boolean, not a top-level id string

  # STALE IS A BOOLEAN (RESEARCH §3): node.stale is read as a boolean liveness flag on each node, independent of
  # presence — a node can be stale whether or not it carries presence.
  Scenario Outline: node.stale deserializes as a boolean on each node
    Given a node whose "stale" field is <staleField>
    When the node is deserialized
    Then its stale flag reads <stale>

    Examples:
      | staleField | stale |
      | true       | true  |
      | false      | false |

  # THE TOP-LEVEL SIBLINGS (RESEARCH §3): boards[] and isControlNode are parsed at the document root — TWO
  # arrays plus a scalar flag, not one array. isControlNode is extracted as the role signal (ADR-002 consumes it).
  Scenario: the top-level boards array and the isControlNode role flag are parsed at the document root
    Given a document with an empty "boards": [] and "isControlNode": true
    When the document is deserialized
    Then boards is read as an array at the top level
    And isControlNode reads true
    And isControlNode is exposed as the role signal the supervision set is driven off

  # SINGLE DATA PATH (ADR-004 d1-2 — arms acd-desktop-single-data-path / acd-desktop-no-mesh-logic): the poll
  # issues `mesh status --json` and ONLY that — never `mesh identity`/`mesh sync`, never a direct read of aof's
  # on-disk record/config store. This is asserted as observed spawn behaviour; the grep is the fitness.
  Scenario: the poll's ONLY fleet-data command is mesh status --json
    Given the supervisor performs one fleet-data poll
    When the commands it issues to obtain fleet data are observed
    Then the only fleet-data command issued is "mesh status --json"
    And no "mesh identity" or "mesh sync" command is issued for fleet data
    And no direct read of aof's ".aof" record or config store is performed

  # THE CADENCE (DESIGN §Footer / poll idiom): the poll runs repeatedly on a timer, one status invocation per
  # tick — the app's visibility model is poll/presence, not a push stream.
  Scenario: the poll re-issues mesh status --json once per cadence tick
    Given the poll is running on a cadence
    When three cadence ticks elapse
    Then "mesh status --json" is invoked exactly three times
    And each tick issues exactly one status invocation
