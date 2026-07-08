// Traceability wiring for milestone 27 / story 00 — the targeting matcher (task
// 01, ADR-003).
//
// Covers EVERY @executable scenario in tasks/01_targeting-matcher.feature: the
// full truth table (any / node / capability / unknown-malformed), the honest-
// minimal-install floor (absent runtimes/skills coerce to [] rather than crash),
// and the pure-read independence (the verdict depends only on nodeId/runtimes/
// skills, never host/os/aofVersion/publishedAt). Pure-data fixtures, zero fs.
import assert from "node:assert/strict";
import { nodeSatisfiesTarget } from "../src/mesh-issuance.mjs";

function descriptor({ nodeId, runtimes, skills, ...rest }) {
  return { nodeId, runtimes, skills, ...rest };
}

export const meshTargetingMatcherTests = [
  // ── Scenario Outline: any ⇒ true for every descriptor (incl. a bare install) ──
  {
    name: 'targeting-matcher/01 { kind: "any" } is true for a fully-equipped descriptor',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude", "codex"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "any" }), true);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "any" } is true for a bare install (empty runtimes+skills)',
    run: async () => {
      const d = descriptor({ nodeId: "laptop-a1b2", runtimes: [], skills: [] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "any" }), true);
    },
  },

  // ── Scenario Outline: node ⇒ true iff nodeId matches, false otherwise ──
  {
    name: 'targeting-matcher/01 { kind: "node" } is true when nodeId matches exactly',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude"], skills: [] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "node", nodeId: "build-server" }), true);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "node" } is false when nodeId does not match',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude"], skills: [] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "node", nodeId: "laptop-a1b2" }), false);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "node" } is false for a mismatched bare-install descriptor',
    run: async () => {
      const d = descriptor({ nodeId: "laptop-a1b2", runtimes: [], skills: [] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "node", nodeId: "build-server" }), false);
    },
  },

  // ── Scenario Outline: capability ⇒ true iff value is in runtimes[] OR skills[] ──
  {
    name: 'targeting-matcher/01 { kind: "capability" } matches a runtime value',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude", "codex"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "capability", value: "codex" }), true);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "capability" } matches a skill value',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude", "codex"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "capability", value: "planner" }), true);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "capability" } is false when the value is neither a runtime nor a skill',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude", "codex"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "capability", value: "cursor" }), false);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "capability" } is false against a bare install (empty runtimes+skills)',
    run: async () => {
      const d = descriptor({ nodeId: "laptop-a1b2", runtimes: [], skills: [] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "capability", value: "codex" }), false);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "capability" } matches a runtime-only descriptor',
    run: async () => {
      const d = descriptor({ nodeId: "runner-1", runtimes: ["codex"], skills: [] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "capability", value: "codex" }), true);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "capability" } matches a skill-only descriptor',
    run: async () => {
      const d = descriptor({ nodeId: "runner-1", runtimes: [], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "capability", value: "planner" }), true);
    },
  },

  // ── Scenario Outline: unknown / malformed target ⇒ false (fail-safe) ──
  {
    name: 'targeting-matcher/01 an unknown target kind ("everyone") is false — fail-safe, never everyone',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "everyone" }), false);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "node" } with nodeId absent is false',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "node" }), false);
    },
  },
  {
    name: 'targeting-matcher/01 { kind: "capability" } with value absent is false',
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, { kind: "capability" }), false);
    },
  },
  {
    name: "targeting-matcher/01 a target with no kind at all ({}) is false",
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, {}), false);
    },
  },
  {
    name: "targeting-matcher/01 a null target is false",
    run: async () => {
      const d = descriptor({ nodeId: "build-server", runtimes: ["claude"], skills: ["planner"] });
      assert.equal(nodeSatisfiesTarget(d, null), false);
    },
  },

  // ── Scenario: a capability target against a descriptor missing runtimes and skills reads false, never a crash ──
  {
    name: "targeting-matcher/01 a capability target against a descriptor with no runtimes/skills fields at all reads false, never a crash (absent fields coerce to [])",
    run: async () => {
      const bare = { nodeId: "bare-node" }; // runtimes/skills keys entirely ABSENT, not merely empty
      let result;
      assert.doesNotThrow(() => { result = nodeSatisfiesTarget(bare, { kind: "capability", value: "codex" }); }, "no error is raised");
      assert.equal(result, false);
    },
  },

  // ── Scenario: the verdict depends only on nodeId, runtimes and skills — not host, os, aofVersion or publishedAt ──
  {
    name: "targeting-matcher/01 the verdict depends only on nodeId/runtimes/skills — not host, os, aofVersion or publishedAt",
    run: async () => {
      const d1 = { nodeId: "runner-1", runtimes: ["codex"], skills: [], host: "host-a", os: "linux", aofVersion: "0.1.0", publishedAt: "2026-07-01T00:00:00.000Z" };
      const d2 = { nodeId: "runner-1", runtimes: ["codex"], skills: [], host: "host-b", os: "darwin", aofVersion: "0.2.0", publishedAt: "2026-07-02T00:00:00.000Z" };
      const target = { kind: "capability", value: "codex" };
      assert.equal(nodeSatisfiesTarget(d1, target), true);
      assert.equal(nodeSatisfiesTarget(d2, target), true, "the non-capability descriptor fields never sway the verdict");
    },
  },
];
