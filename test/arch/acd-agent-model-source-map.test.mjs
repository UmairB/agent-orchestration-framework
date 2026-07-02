// Fitness function for story 30 / task 01 (the bundle SOURCE surface).
//
// The task feature flagged two STRUCTURAL invariants as arch-tests (NOT Thens):
//   (1) every one of the 8 frozen ACD roles declares a `model` in the bundle
//       SOURCE (`src/bundle/agents/*.md` frontmatter) — no role un-mapped;
//   (2) the declared SOURCE value is a family alias (lowercase `opus`/`sonnet`),
//       never a dated/fully-pinned id (e.g. anything shaped like `claude-…-N-N`).
//
// These check the bundle SOURCE frontmatter — a DISTINCT surface from the
// rendered `.claude/agents/<role>.md` file the behavioural test in
// test/bundle-model-map.test.mjs asserts. Do not collapse the two: the render
// pass could in principle drop or reshape the value, so the source is pinned
// here on its own. The frozen 8-role set is fixed by the descriptor
// (readDescriptor), so this test derives the role set live rather than
// re-hardcoding it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readDescriptor, bundleRoot } from "../../src/work-bundle.mjs";

// The two moving family aliases the bundle is allowed to ship. Lowercase and
// un-hyphenated — the "moving alias, not a pinned id" contract (STORY.md).
const ALLOWED_ALIASES = new Set(["opus", "sonnet"]);

// Read the single-line `model:` frontmatter value from a bundle agent SOURCE
// file, or null when absent. Reads ONLY the leading `---`…`---` block so a body
// mention cannot false-match. Mirrors the bundle's own single-line frontmatter
// contract (splitFrontmatter in src/work-bundle.mjs).
function sourceModelValue(role) {
  const member = readDescriptor().members.find((m) => m.id === role && m.kind === "agent");
  assert.ok(member, `descriptor declares agent member ${role}`);
  const raw = readFileSync(path.join(bundleRoot(), member.file), "utf8").replace(/^﻿/, "");
  const end = raw.indexOf("\n---", 3);
  const block = end === -1 ? raw : raw.slice(0, end);
  const match = /^model:[ \t]?(.*)$/m.exec(block);
  return match ? match[1].trim() : null;
}

// The frozen 8 ACD agent ids, DERIVED from the descriptor at test time (no 4th
// hardcoded copy of the list — the descriptor is the single source of truth).
function acdAgentIds() {
  return readDescriptor()
    .members.filter((m) => m.kind === "agent")
    .map((m) => m.id);
}

export const archTests = [
  {
    name: "arch/story-30: every frozen ACD role declares a model in the bundle SOURCE frontmatter (no role un-mapped)",
    run: async () => {
      const roles = acdAgentIds();
      assert.equal(roles.length, 8, "the descriptor declares exactly the 8 frozen ACD agents");
      for (const role of roles) {
        const value = sourceModelValue(role);
        assert.ok(
          value !== null && value !== "",
          `bundle source ${role}.md declares a non-empty model frontmatter line`
        );
      }
    }
  },
  {
    name: "arch/story-30: the bundle SOURCE model value is a lowercase family alias, never a dated/pinned id",
    run: async () => {
      for (const role of acdAgentIds()) {
        const value = sourceModelValue(role);
        assert.ok(value !== null, `${role} declares a model value`);

        // A family alias — one of the two moving aliases, matched exactly.
        assert.ok(
          ALLOWED_ALIASES.has(value),
          `${role} source model "${value}" is a family alias (one of: ${[...ALLOWED_ALIASES].sort().join(", ")})`
        );

        // Never re-cased: byte-identical to its own lowercase form (rules out
        // "Opus" / "OPUS" — a downstream literal match depends on the exact case).
        assert.equal(value, value.toLowerCase(), `${role} source model "${value}" is not re-cased`);

        // Never a version-dated / fully-pinned id. Reject a `claude-…-N-N` shape
        // (e.g. "claude-opus-4-8"): no digits, no hyphens in a bare alias.
        assert.ok(
          !/^claude-.*\d+-\d+/.test(value),
          `${role} source model "${value}" is not a version-dated id (claude-…-N-N)`
        );
        assert.ok(!/\d/.test(value), `${role} source model "${value}" carries no version digit`);
        assert.ok(!value.includes("-"), `${role} source model "${value}" is a bare alias, not a hyphenated id`);
      }
    }
  }
];
