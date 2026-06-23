// Fitness function for milestone 08 / ADR-004 inv. 4 (ADR-001's guard):
// "No `/api/work*` serving path spawns a subprocess to serve the operation — the
//  boundary is in-process (one shared command core), NOT a per-request shell-out
//  to `aof …`. The board face calls the registry's `invoke` in-process; it never
//  spawns the CLI to answer a work route."
//
// Source-grep `src/board-ui.mjs` (the board's `/api/work*` surface) with comments
// and strings discounted via the call-form discipline the house tests use: assert
// NO `child_process` import and NO `spawn(`/`spawnSync(`/`exec(`/`execSync(`/
// `execFile(` call form, and NO `aof <…>` CLI-invocation string on the
// work-serving path. This guard is GREEN today (no subprocess in board-ui.mjs) and
// must STAY green across the story-02 migration — the re-home must honour the
// in-process boundary, not quietly shell out per request.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOARD_UI = path.join(repoRoot, "src", "board-ui.mjs");

// Strip `// …` line comments and `/* … */` block comments so a comment that merely
// names a verb ("never a spawn shell-out") does not trip the call-form grep. This
// is the same comment-discounting discipline as acd-board-write-isolation.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export const archTests = [
  {
    name: "arch/ADR-004 inv.4: board-ui.mjs imports no child_process for the work surface",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      assert.ok(
        !/\bchild_process\b/.test(source),
        "board-ui.mjs imports no node:child_process — the work boundary is in-process, not a subprocess"
      );
    },
  },
  {
    name: "arch/ADR-004 inv.4: board-ui.mjs makes no spawn/exec call on the work-serving path",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      // Call form `\bverb\s*\(` — a comment naming the verb is already discounted,
      // and this only matches an actual invocation, not a substring mention.
      for (const verb of ["spawn", "spawnSync", "exec", "execSync", "execFile"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `board-ui.mjs makes no ${verb}( call — no per-request subprocess to serve a work op`
        );
      }
    },
  },
  {
    name: "arch/ADR-004 inv.4: board-ui.mjs invokes no `aof` CLI string to serve a work route",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      // No CLI-invocation literal (`aof work …`, or `aof <sub>` as an argv head)
      // shelling the operation out instead of calling the in-process registry.
      assert.ok(
        !/["'`]\s*aof\s+work\s+\w+/.test(source),
        "board-ui.mjs contains no 'aof work <op>' CLI-invocation string"
      );
      assert.ok(
        !/\baof\.mjs\b/.test(source),
        "board-ui.mjs references no bin/aof.mjs entrypoint to shell out to"
      );
    },
  },
];
