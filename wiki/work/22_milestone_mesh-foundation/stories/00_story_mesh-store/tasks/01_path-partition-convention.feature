@cli @work @distribution @executable
Feature: Every mesh record path is built by a single node-id-keyed seam that composes with milestone 19's run-record seam
  In order to keep git merges add-only (the move that keeps git a viable bus) and to provably compose with the run-record store at milestone 26
  the mesh-store builds every record path from one seam keyed by node id, with no shared file two nodes co-write, and the run-dimension convention is the additive delta on milestone 19's frozen runRecordPath shape,
  so that concurrent nodes touch different files (git never faces a three-way content merge) and milestone 26 inserts the <node>/ segment as one additive edit, not a rework.

  # The CONFLICT-AVOIDANCE convention (ARCHITECTURE ADR-002). This feature asserts the
  # OBSERVABLE partition behaviour — node-keyed paths, no shared file, the run-dimension
  # convention composing with 19's seam. The single-join-site source discipline is the
  # acd-mesh-partition-write ARCH-TEST (fitness #1), not a scenario here. This milestone
  # BUILDS the nodes/<node-id>.json dimension; the runs/<node>/<run-id>.json dimension is
  # CONVENTION only (milestone 26 builds it) and presence/<node>.json is RESERVED (milestone 23).
  Background:
    Given the mesh-store loaded in-process from src/mesh-store.mjs

  # The seam is keyed by node id: the path for a node is the partition root + nodes/ + the
  # node id + .json — and it is the ONLY shape the store produces for a node record.
  Scenario: the node-record path is the single node-id-keyed seam under the partition root
    When I ask the store for the record path of node id "build-server"
    Then the path ends with "nodes/build-server.json"
    And the path is rooted at the partition root inside the work stream (not a .aof/ sidecar)

  # The seam treats the node id as a single FLAT filename segment: an id is one path
  # component, never a sub-path. A node-id-keyed path is the trust boundary, so an id that
  # LOOKS like it carries separators must not escape nodes/ into a parent or a nested dir —
  # the path is exactly nodes/<id>.json with the id as one leaf segment. (Id sanitization
  # itself is story 01's node-identity mechanic; here we pin only that the seam never lets an
  # id become a multi-segment path.)
  # QA: covers the already-sanitized legal id, an id that would TRAVERSE if not flat-segmented,
  # and an id with an embedded slash — each must resolve to one leaf file directly under nodes/.
  Scenario Outline: the node id is one flat filename segment directly under nodes/, never a sub-path
    When I ask the store for the record path of node id "<id>"
    Then the path's parent directory is exactly the partition root's nodes/ directory
    And the path's final segment is "<expected-leaf>"
    And the path does not escape nodes/ into a parent or nested directory

    Examples:
      | id              | expected-leaf        |
      | build-server    | build-server.json    |
      | laptop-a1b2     | laptop-a1b2.json     |
      | ../escape       | ../escape.json       |
      | a/b             | a/b.json             |

  # No shared/aggregate file: there is no single nodes.json (or any combined file) two nodes
  # would both write — the precondition for add-only merges (rejecting the aggregate alternative).
  Scenario: there is no aggregate file two nodes would co-write
    Given node-record objects for "umair-desktop" and "umair-mbp"
    When I publish both node records
    Then no file named "nodes.json" (or any combined-roster file) exists under the partition root
    And each node's record is its own discrete file under nodes/

  # The run-dimension CONVENTION composes with milestone 19's frozen seam: the path the
  # convention prescribes for a (node, run) record is exactly 19's runRecordPath with the
  # <node>/ segment inserted — proving milestone 26 is a pure additive delta on the one join site.
  # QA: pin BOTH the convention shape AND that it equals 19's seam + <node>/ (the compose-with-19
  # invariant), so a divergent partition scheme cannot slip in unnoticed.
  Scenario: the run-dimension convention is the additive <node>/ delta on milestone 19's runRecordPath shape
    Given an item "19" whose milestone-19 runRecordPath for run "<run-id>" is "<runs-dir>/<run-id>.json"
    When I ask the convention for the (node "umair-desktop", run "<run-id>") record path of item "19"
    Then the convention path is "<runs-dir>/umair-desktop/<run-id>.json"
    And it equals milestone 19's runRecordPath with one "umair-desktop/" segment inserted before the run-id file
    And the run-id leaf filename is byte-identical to milestone 19's (only the <node>/ segment was added)
    And this milestone does NOT write any runs/<node>/ file (the convention is documented, milestone 26 builds it)

  # The presence dimension is RESERVED, not built: the convention NAMES the
  # presence/<node-id>.json shape (so milestone 23 has a reference) but this milestone
  # writes no presence record.
  Scenario: the presence dimension is named as a reserved shape but not built here
    Then the convention names the presence record shape as "presence/<node-id>.json"
    And this milestone writes no presence/ file (milestone 23 builds the presence dimension)
