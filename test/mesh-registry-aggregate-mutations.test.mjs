// Traceability wiring for milestone 24 / story 00 — the add-only aggregate mutations
// (tasks/01_roster-boards-revocations.feature).
//
// Covers EVERY @executable scenario in tasks/01_roster-boards-revocations.feature,
// exercising the REAL src/mesh-registry.mjs pure accessors — a registry value in, a
// registry value out (no fs, no relay, no git). Every admittedAt / revokedAt is an
// INJECTED value, never wall-clock (the 22/R2 discipline), so order-preservation and
// byte-unchanged assertions are deterministic. One test object per scenario (the
// Scenario Outline runs its Examples rows in one test). node:assert/strict.
//
//   01_roster-boards-revocations.feature — admitting a node APPENDS { nodeId,
//     admittedAt, boards } to the roster order-preserving (a second admit lands after
//     the first, unchanged); registering a board appends with SET semantics (a repeat
//     is a no-op, first-appearance order preserved); appending a revocation adds the
//     explicit-deny record and COEXISTS with the roster (distinct from removal); any
//     add-only mutation leaves every OTHER entry byte-unchanged; reading the aggregate
//     returns the full roster/boards/revocations and mutates nothing.
import assert from "node:assert/strict";
import { admitNode, registerBoard, appendRevocation, emptyRegistry } from "../src/mesh-registry.mjs";

export const meshRegistryAggregateMutationsTests = [
  {
    name: "mesh-registry-aggregate/01 admitting a node appends to the roster order-preserving, a second admit landing after the first unchanged",
    async run() {
      const r1 = admitNode(emptyRegistry(), { nodeId: "node-a", admittedAt: "2026-07-01T10:00:00Z", boards: ["board-x"] });
      const firstEntryBytes = JSON.stringify(r1.roster[0]);

      const r2 = admitNode(r1, { nodeId: "node-b", admittedAt: "2026-07-01T10:05:00Z", boards: ["board-y"] });

      assert.deepEqual(r2.roster.map((e) => e.nodeId), ["node-a", "node-b"], 'the roster is exactly ["node-a", "node-b"] in that order');
      assert.deepEqual(r2.roster[0], { nodeId: "node-a", admittedAt: "2026-07-01T10:00:00Z", boards: ["board-x"] }, "node-a carries its injected admittedAt and boards");
      assert.equal(JSON.stringify(r2.roster[0]), firstEntryBytes, "the node-a entry is byte-unchanged after the second admit");
      assert.deepEqual(r2.roster[1], { nodeId: "node-b", admittedAt: "2026-07-01T10:05:00Z", boards: ["board-y"] }, "node-b carries its injected admittedAt and boards");
      // append, never in-place: the second admit carries the FIRST entry through by
      // reference — it was not rewritten
      assert.equal(r2.roster[0], r1.roster[0], "the first roster entry was not rewritten by the second admit (the same entry value, carried through)");
    },
  },
  {
    name: "mesh-registry-aggregate/01 registering a board appends with set semantics — a repeat is a no-op, first-appearance order preserved (outline: A / A,B / A,B,A / A,A,A / A,B,C,B,A)",
    async run() {
      // Examples: | sequence | boards |
      const rows = [
        { sequence: ["A"], boards: ["A"] },
        { sequence: ["A", "B"], boards: ["A", "B"] },
        { sequence: ["A", "B", "A"], boards: ["A", "B"] },
        { sequence: ["A", "A", "A"], boards: ["A"] },
        { sequence: ["A", "B", "C", "B", "A"], boards: ["A", "B", "C"] },
      ];
      for (const row of rows) {
        let registry = emptyRegistry();
        for (const board of row.sequence) {
          registry = registerBoard(registry, board);
        }
        assert.deepEqual(registry.boards, row.boards, `[${row.sequence.join(", ")}] the boards list is exactly [${row.boards.join(", ")}] (first-appearance order preserved)`);
        assert.equal(new Set(registry.boards).size, registry.boards.length, `[${row.sequence.join(", ")}] no board appears twice (set semantics — a repeat register is a no-op)`);
      }
    },
  },
  {
    name: "mesh-registry-aggregate/01 appending a revocation adds to revocations and coexists with the roster, an explicit deny distinct from removal",
    async run() {
      const withRoster = admitNode(emptyRegistry(), { nodeId: "node-a", admittedAt: "2026-07-01T10:00:00Z", boards: [] });
      const rosterEntryBytes = JSON.stringify(withRoster.roster[0]);

      const revoked = appendRevocation(withRoster, { nodeId: "node-a", revokedAt: "2026-07-01T11:00:00Z", reason: "left the fleet" });

      assert.deepEqual(
        revoked.revocations,
        [{ nodeId: "node-a", revokedAt: "2026-07-01T11:00:00Z", reason: "left the fleet" }],
        'revocations contains { nodeId "node-a", revokedAt "2026-07-01T11:00:00Z", reason "left the fleet" }'
      );
      assert.ok(revoked.roster.some((e) => e.nodeId === "node-a"), "node-a still appears on the roster (a revocation is an explicit deny record, distinct from roster removal)");
      assert.equal(JSON.stringify(revoked.roster[0]), rosterEntryBytes, "the roster entry for node-a is byte-unchanged by the revocation append");
    },
  },
  {
    name: "mesh-registry-aggregate/01 an add-only mutation leaves every other entry byte-unchanged",
    async run() {
      // a registry with roster ["node-a", "node-b"], boards ["board-x"], and a
      // revocation for "node-c"
      let registry = emptyRegistry();
      registry = admitNode(registry, { nodeId: "node-a", admittedAt: "2026-07-01T10:00:00Z", boards: ["board-x"] });
      registry = admitNode(registry, { nodeId: "node-b", admittedAt: "2026-07-01T10:30:00Z", boards: [] });
      registry = registerBoard(registry, "board-x");
      registry = appendRevocation(registry, { nodeId: "node-c", revokedAt: "2026-07-01T11:00:00Z", reason: null });

      // record the on-value bytes of every existing roster, boards, and revocation entry
      const rosterBytes = registry.roster.map((e) => JSON.stringify(e));
      const boardsBytes = JSON.stringify(registry.boards);
      const revocationBytes = registry.revocations.map((e) => JSON.stringify(e));

      const after = admitNode(registry, { nodeId: "node-d", admittedAt: "2026-07-01T12:00:00Z", boards: ["board-x"] });

      assert.deepEqual(after.roster.map((e) => e.nodeId), ["node-a", "node-b", "node-d"], "node-d is appended to the roster after node-a and node-b");
      for (let i = 0; i < rosterBytes.length; i += 1) {
        assert.equal(JSON.stringify(after.roster[i]), rosterBytes[i], `pre-existing roster entry ${i} is byte-unchanged`);
        assert.equal(after.roster[i], registry.roster[i], `pre-existing roster entry ${i} was not rewritten in place (carried through, the git-merge-clean add-only property)`);
      }
      assert.equal(JSON.stringify(after.boards), boardsBytes, "the boards list is byte-unchanged");
      for (let i = 0; i < revocationBytes.length; i += 1) {
        assert.equal(JSON.stringify(after.revocations[i]), revocationBytes[i], `pre-existing revocation entry ${i} is byte-unchanged`);
      }
    },
  },
  {
    name: "mesh-registry-aggregate/01 reading the aggregate returns the full roster, boards, and revocations the fleet view will read, mutating nothing",
    async run() {
      let registry = emptyRegistry();
      registry = admitNode(registry, { nodeId: "node-a", admittedAt: "2026-07-01T10:00:00Z", boards: ["board-x"] });
      registry = admitNode(registry, { nodeId: "node-b", admittedAt: "2026-07-01T10:30:00Z", boards: ["board-y"] });
      registry = registerBoard(registry, "board-x");
      registry = registerBoard(registry, "board-y");
      registry = appendRevocation(registry, { nodeId: "node-b", revokedAt: "2026-07-01T11:00:00Z", reason: "revoked" });
      const beforeBytes = JSON.stringify(registry);

      // read the roster, boards, and revocations back (a pure read over the value)
      const roster = registry.roster;
      const boards = registry.boards;
      const revocations = registry.revocations;

      assert.deepEqual(roster.map((e) => e.nodeId), ["node-a", "node-b"], 'the roster is exactly ["node-a", "node-b"] in order');
      assert.deepEqual(boards, ["board-x", "board-y"], 'the boards are exactly ["board-x", "board-y"]');
      assert.deepEqual(
        revocations,
        [{ nodeId: "node-b", revokedAt: "2026-07-01T11:00:00Z", reason: "revoked" }],
        "the revocations contain the deny record for node-b"
      );
      assert.equal(JSON.stringify(registry), beforeBytes, "the read mutated nothing (a pure read over the aggregate)");
    },
  },
];
