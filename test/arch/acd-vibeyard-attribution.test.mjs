// Fitness function for milestone 03 / ADR-003:
// "Every source file that adapts vibeyard code (PTY spawn-options block, the
//  CliProvider interface, the terminal-pane WS wiring, the ported protocol
//  modules) carries vibeyard's MIT attribution notice; and the repo NOTICE
//  surface records the vibeyard MIT obligation."
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Each adapted file must name vibeyard AND MIT in its header notice.
const ADAPTED_FILES = [
  "src/terminal-ws.mjs",
  "src/terminal-providers.mjs",
  "ui/src/board/TerminalDock.tsx",
  "ui/src/board/terminal/dock-state.mjs",
  "ui/src/board/terminal/provider-picker.mjs",
  "ui/src/board/terminal/resize.mjs",
  // milestone 38 / story 06 / task 04 — the fleet's read-only terminal-VIEW reaches
  // the SAME vibeyard-derived xterm pane wiring (new Terminal / FitAddon / open /
  // fit / dispose) through TerminalDock.tsx, which ported it first (DESIGN §Surface
  // 3 V3 requires that reuse). The attribution travels with the derivation — this
  // entry WIDENS the invariant's scope to the new derived file; it weakens nothing.
  "ui/src/fleet/terminal-view/FleetTerminalView.tsx",
];

export const archTests = [
  ...ADAPTED_FILES.map((rel) => ({
    name: `arch/ADR-003: ${rel} carries the vibeyard MIT attribution notice`,
    run: async () => {
      const text = await readFile(path.join(repoRoot, rel), "utf8");
      // The notice (in the file header) must name vibeyard and MIT.
      assert.ok(/vibeyard/i.test(text), `${rel} names vibeyard`);
      assert.ok(/\bMIT\b/.test(text), `${rel} names the MIT licence`);
      // And it should read as an attribution/adaptation notice, not an incidental
      // mention — the litmus is "Adapted from … vibeyard … (MIT)".
      assert.ok(
        /Adapted from\s+\S*vibeyard/i.test(text),
        `${rel} carries an "Adapted from … vibeyard" attribution notice`
      );
    },
  })),
  {
    name: "arch/ADR-003: the repo NOTICE surface records the vibeyard MIT obligation",
    run: async () => {
      const text = await readFile(path.join(repoRoot, "NOTICE"), "utf8");
      assert.ok(/vibeyard/i.test(text), "the NOTICE names vibeyard");
      assert.ok(/\bMIT\b/.test(text), "the NOTICE records the MIT obligation");
    },
  },
];
