import assert from "node:assert/strict";
import { parseResourceInput, resolveConfirmation, resolveRuntimeSelection, resolveSelection } from "../src/prompt.mjs";

const items = [
  { id: "local-skill", defaultEnabled: true },
  { id: "local-command", defaultEnabled: true },
  { id: "optional-agent", defaultEnabled: false }
];

export const promptTests = [
  {
    name: "empty selection returns default-enabled items",
    run() {
      assert.deepEqual(resolveSelection(items, "").map((item) => item.id), ["local-skill", "local-command"]);
    }
  },
  {
    name: "selection accepts numbers and ids",
    run() {
      assert.deepEqual(resolveSelection(items, "1, optional-agent").map((item) => item.id), ["local-skill", "optional-agent"]);
    }
  },
  {
    name: "runtime selection accepts all and explicit runtimes",
    run() {
      assert.deepEqual(resolveRuntimeSelection("all"), ["claude", "codex"]);
      assert.deepEqual(resolveRuntimeSelection("codex"), ["codex"]);
    }
  },
  {
    name: "confirmation accepts yes no and defaults",
    run() {
      assert.equal(resolveConfirmation("yes"), true);
      assert.equal(resolveConfirmation("n"), false);
      assert.equal(resolveConfirmation("", true), true);
    }
  },
  {
    name: "resource input parses project asset details",
    run() {
      assert.deepEqual(parseResourceInput(JSON.stringify({
        kind: "skill",
        id: "interactive-skill",
        description: "Interactive skill",
        runtimes: ["codex"],
        body: "Interactive body"
      })), {
        kind: "skill",
        id: "interactive-skill",
        description: "Interactive skill",
        runtimes: ["codex"],
        body: "Interactive body"
      });
    }
  },
  {
    name: "resource input rejects project-only kinds for global assets",
    run() {
      assert.throws(
        () => parseResourceInput(JSON.stringify({ kind: "command", id: "global-command" }), { global: true }),
        /Invalid global resource kind/
      );
    }
  },
  {
    name: "resource input explains invalid asset ids",
    run() {
      assert.throws(
        () => parseResourceInput(JSON.stringify({ kind: "skill", id: "bad id" })),
        /Use letters, numbers, dots, underscores, or hyphens/
      );
    }
  },
  {
    name: "resource input can skip starter content",
    run() {
      assert.equal(
        parseResourceInput(JSON.stringify({ kind: "agent", id: "research-agent", body: "Do not prompt in init" }), { skipBody: true }).body,
        ""
      );
    }
  }
];
