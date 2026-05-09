import assert from "node:assert/strict";
import { resolveConfirmation, resolveRuntimeSelection, resolveSelection } from "../src/prompt.mjs";

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
  }
];
