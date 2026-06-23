// Fitness function for milestone 08 / ADR-004 inv. 3 (the registry is the only
// door): "The board surface (`src/board-ui.mjs`) imports NO work-core/operation
//  module except the command registry (`./command-core.mjs`), and performs no
//  work-operation filesystem call itself. The bespoke `handleDoc`/`handleTasks`/
//  `handleFeedback` logic and its direct `work.mjs`/`feature-parse.mjs` imports
//  moved INTO the commands (story 00); story 02 strips them from the face."
//
// Source-grep `src/board-ui.mjs` (the import-boundary idiom of
// acd-terminal-server-only, with comments discounted via the call-form discipline
// of acd-board-write-isolation):
//   - the ONLY operation-bearing import is `./command-core.mjs`;
//   - the `{ loadWorkspace, listStream, findWork, validateWork, nextWork }` import
//     FROM `./work.mjs` is ABSENT (loadWorkspace may come from ./command-core.mjs —
//     that is the door — but NOT from ./work.mjs);
//   - the `parseFeature` import from `./feature-parse.mjs` is ABSENT;
//   - no `appendFile(`/`writeFile(`/`readdir(`/`parseFeature(` call form remains
//     for the work ops (those moved to the commands).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOARD_UI = path.join(repoRoot, "src", "board-ui.mjs");
const SETUP_UI = path.join(repoRoot, "src", "setup-ui.mjs");

// Discount `// …` and `/* … */` so a comment naming a verb/module is not a match.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// All `import { … } from "<specifier>"` / `import x from "<specifier>"` statements,
// returned as { specifier, names } pairs. Catches both the named and default forms.
function imports(source) {
  const out = [];
  const re = /import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    out.push({ clause: match[1], specifier: match[2] });
  }
  return out;
}

export const archTests = [
  {
    name: "arch/ADR-004 inv.3: board-ui.mjs does NOT import work-operation core from ./work.mjs",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      const workImports = imports(source).filter((i) => i.specifier === "./work.mjs");
      assert.deepEqual(
        workImports.map((i) => i.specifier),
        [],
        "board-ui.mjs imports nothing from ./work.mjs — the work-core ops are reached through the registry, not directly"
      );
      // Belt-and-braces on the exact frozen import line ADR-004 names as the one to remove.
      assert.ok(
        !/import\s*\{[^}]*\b(listStream|findWork|validateWork|nextWork)\b[^}]*\}\s*from\s*["']\.\/work\.mjs["']/.test(source),
        "the `{ loadWorkspace, listStream, findWork, validateWork, nextWork }` from ./work.mjs import is gone"
      );
    },
  },
  {
    name: "arch/ADR-004 inv.3: board-ui.mjs does NOT import parseFeature from ./feature-parse.mjs",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      const featureImports = imports(source).filter((i) => i.specifier === "./feature-parse.mjs");
      assert.deepEqual(
        featureImports.map((i) => i.specifier),
        [],
        "board-ui.mjs imports nothing from ./feature-parse.mjs — task parsing moved into work:tasks"
      );
      assert.ok(
        !/\bparseFeature\b/.test(source),
        "board-ui.mjs no longer references parseFeature (the work:tasks command owns it)"
      );
    },
  },
  {
    name: "arch/ADR-004 inv.3: the command registry (./command-core.mjs) is the ONLY operation-bearing import",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      const specifiers = imports(source).map((i) => i.specifier);
      // The registry IS imported — the door is present (positive assertion the
      // ADR notes a deny-list lint could not make).
      assert.ok(
        specifiers.includes("./command-core.mjs"),
        "board-ui.mjs imports the command registry from ./command-core.mjs (the only door to the work ops)"
      );
      // No OTHER local ./<module> import brings in operation logic. The allow-list
      // is the registry plus the pure local presentation/IO helpers a thin HTTP
      // adapter legitimately needs (none of which carry a work operation). Any
      // direct command-body import (./commands/*) or work-core module is a breach.
      const operationBearing = imports(source).filter((i) => {
        const spec = i.specifier;
        if (!spec.startsWith(".")) return false; // node:* / package deps are not work-core
        if (spec === "./command-core.mjs") return false; // the door
        // The work-core / operation modules that must NOT be imported directly.
        return /\.\/(work|feature-parse)\.mjs$/.test(spec) || spec.startsWith("./commands/");
      });
      assert.deepEqual(
        operationBearing.map((i) => i.specifier),
        [],
        "board-ui.mjs imports no work-core/operation module except ./command-core.mjs"
      );
    },
  },
  {
    name: "arch/ADR-004 inv.3: board-ui.mjs runs no work-operation filesystem call of its own",
    run: async () => {
      const source = stripComments(await readFile(BOARD_UI, "utf8"));
      // Call form `\bverb\s*\(` — the bespoke doc/tasks/feedback fs logic moved into
      // the commands, so none of these operation-fs calls remain in the face.
      for (const verb of ["appendFile", "writeFile", "readdir", "parseFeature"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `board-ui.mjs makes no ${verb}( call — the work-op filesystem logic lives in the commands`
        );
      }
    },
  },
  {
    // ADR-004 inv.3 names "board-ui.mjs, and setup-ui.mjs for the work surface".
    // setup-ui.mjs hosts the single http.createServer that mounts the work API, but
    // it must reach the work ops ONLY through `handleWorkApi` (from ./board-ui.mjs) —
    // never by importing a work-core/operation module of its own behind the registry's
    // back. (This is inert today, but the guard makes the inv.3 surface match the ADR.)
    name: "arch/ADR-004 inv.3: setup-ui.mjs imports no work-core/operation module — it reaches the work surface only via board-ui's handleWorkApi",
    run: async () => {
      const source = stripComments(await readFile(SETUP_UI, "utf8"));
      const operationBearing = imports(source).filter((i) => {
        const spec = i.specifier;
        if (!spec.startsWith(".")) return false;
        return /\.\/(work|feature-parse|command-core)\.mjs$/.test(spec) || spec.startsWith("./commands/");
      });
      assert.deepEqual(
        operationBearing.map((i) => i.specifier),
        [],
        "setup-ui.mjs imports no ./work.mjs, ./feature-parse.mjs, ./command-core.mjs, or ./commands/* directly"
      );
      // The one work door it DOES hold is handleWorkApi from ./board-ui.mjs.
      assert.ok(
        /import\s*\{[^}]*\bhandleWorkApi\b[^}]*\}\s*from\s*["']\.\/board-ui\.mjs["']/.test(source),
        "setup-ui.mjs reaches the work surface via handleWorkApi from ./board-ui.mjs"
      );
    },
  },
];
