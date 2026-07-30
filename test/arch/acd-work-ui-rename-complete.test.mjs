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
// NOTE: `subcommand === "ui"` is matched ONLY inside the `workCommand` body, so any
// OTHER dispatcher's `ui` branch does NOT satisfy this work-side check — the
// dispatchers are isolated exactly as acd-mesh-command-cli-bijection isolates
// meshCommand.
//
// REWORKED with m42 wave (d) leg d1's wave-3 tail (the launcher seam): the `ui`
// serve verb's door is the ROUTE TABLE now (work:ui carries cli.route
// ["work","ui"]; its ladder branch is deleted), so the XOR runs over THREE
// candidate doors — the old `board` ladder branch, a `ui` ladder branch, and the
// routed work:ui — and exactly ONE may exist. The broken states stay red: a dead
// board branch surviving beside the route, a ladder branch shadowing the route
// (a second door), or the serve verb vanishing entirely.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCommand, listCommands } from "../../src/command-core.mjs";
import { deriveRouteTable } from "../../src/spine/face.mjs";

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
    name: "arch/25 ADR-001: the work board/ui serve verb has EXACTLY ONE door (board ladder | ui ladder | routed work:ui) — locks the rename AND the seam migration",
    run: async () => {
      const body = workCommandBody(stripComments(await readFile(CLI_MJS, "utf8")));
      // The dispatcher itself is gated (workCommand must be defined).
      assert.ok(body.length > 0, "workCommand is defined in cli.mjs (the work face dispatcher)");
      const hasBoard = hasBranch(body, "board");
      const hasUiLadder = hasBranch(body, "ui");
      const uiCommand = getCommand("work:ui");
      const uiRouted = uiCommand != null && deriveRouteTable(listCommands()).get("work ui") === uiCommand;
      const doors = [hasBoard, hasUiLadder, uiRouted].filter(Boolean).length;
      assert.equal(
        doors,
        1,
        `the work serve verb has EXACTLY ONE door — got board-ladder=${hasBoard}, ui-ladder=${hasUiLadder}, ui-routed=${uiRouted}. ` +
          "More than one = a dead branch or a ladder shadowing the route (a second door); " +
          "zero = the board/ui serve verb vanished with no replacement (25/ADR-001)."
      );
      // The rename itself stays locked: the old board branch may never return.
      assert.equal(hasBoard, false, "the retired `subcommand === \"board\"` branch stays gone (25/ADR-001)");
    },
  },
];
