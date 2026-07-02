// Fitness function: acd-work-ui-rename-complete (milestone 25 / ADR-001) — the
// "the `aof work board` → `aof work ui` rename actually happened" proof, in the
// acd-mesh-command-cli-bijection grep idiom (isolate the dispatcher body; discount
// comments; match the exact `subcommand === "<sub>"` dispatch literal).
//
// The invariant is a MUTUAL EXCLUSION over the `workCommand` body: the serve-verb
// dispatch is EITHER the old `subcommand === "board"` OR the new `subcommand === "ui"`,
// NEVER both and NEVER neither. Phrased as an XOR so it is GREEN on BOTH sides of the
// rename and RED only in the broken half-renamed states:
//   - current tree      : "board" present, "ui" absent            → XOR true  (green)
//   - post-rename tree   : "board" absent,  "ui" present           → XOR true  (green)
//   - both present       : a dead `=== "board"` branch left behind → XOR false (red)
//   - neither present    : the board serve verb vanished, no verb  → XOR false (red)
// So this test is WRITABLE now (green) and locks the rename from the Decide stage
// forward — the moment story 01 renames `board`→`ui` it stays green; the moment it
// leaves a dangling branch (or drops the verb) it reds. (ADR-001, fitness table B.)
//
// NOTE: `subcommand === "ui"` is matched ONLY inside the `workCommand` body, so the
// `meshCommand` `subcommand === "ui"` branch (milestone 25 / ADR-003, the `aof mesh ui`
// serve verb) does NOT satisfy this work-side check — the two dispatchers are isolated
// exactly as acd-mesh-command-cli-bijection isolates meshCommand.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_MJS = path.join(repoRoot, "src", "cli.mjs");

// Discount `// …` and `/* … */` so a comment naming a branch literal is not a match.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Isolate the `workCommand` function body so the dispatch grep cannot be satisfied by
// a `subcommand === "<sub>"` belonging to meshCommand / graphCommand / any other
// dispatcher (mirrors acd-mesh-command-cli-bijection's meshCommandBody).
function workCommandBody(source) {
  const start = source.search(/(?:async\s+)?function\s+workCommand\s*\(/);
  if (start === -1) return "";
  const re = /\n(?:export\s+)?(?:async\s+)?function\s/g;
  re.lastIndex = start + 1;
  const next = re.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

function hasBranch(body, sub) {
  return new RegExp(`subcommand\\s*===\\s*["']${sub}["']`).test(body);
}

export const archTests = [
  {
    name: "arch/25 ADR-001: workCommand dispatches EXACTLY ONE of the board/ui serve verb (XOR — locks the rename, green on both sides)",
    run: async () => {
      const body = workCommandBody(stripComments(await readFile(CLI_MJS, "utf8")));
      // The dispatcher itself is gated (workCommand must be defined).
      assert.ok(body.length > 0, "workCommand is defined in cli.mjs (the work face dispatcher)");
      const hasBoard = hasBranch(body, "board");
      const hasUi = hasBranch(body, "ui");
      // XOR: exactly one of the two serve-verb literals is present.
      assert.notEqual(
        hasBoard,
        hasUi,
        `workCommand dispatches EXACTLY ONE serve verb — got board=${hasBoard}, ui=${hasUi}. ` +
          "Both present = a dead `subcommand === \"board\"` branch left behind after the rename; " +
          "neither present = the board/ui serve verb vanished with no replacement (25/ADR-001)."
      );
    },
  },
];
