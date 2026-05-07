import assert from "node:assert/strict";
import { resolveConfirmation, resolveRuntimeSelection, resolveSelection } from "../src/prompt.mjs";

const items = [
  { id: "project-context", defaultEnabled: true },
  { id: "prime", defaultEnabled: true },
  { id: "code-reviewer", defaultEnabled: false }
];

export const promptTests = [
  {
    name: "empty selection returns default-enabled items",
    run() {
      assert.deepEqual(resolveSelection(items, "").map((item) => item.id), ["project-context", "prime"]);
    }
  },
  {
    name: "selection accepts numbers and ids",
    run() {
      assert.deepEqual(resolveSelection(items, "1, code-reviewer").map((item) => item.id), ["project-context", "code-reviewer"]);
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
