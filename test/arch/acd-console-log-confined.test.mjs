// Fitness function: acd-console-log-confined (milestone 42 wave (d) leg d1;
// PRD-command-spine-effects-ledger §command-spine-faces — "`console.log` confined to
// the face", the third of d1's owed items).
//
// THE INVARIANT — printing is a FACE act, not a core act. `src/` began the wave with
// 248 console.logs in cli.mjs alone; the verb migrations moved each one into a
// `render()` that RETURNS lines, which the ONE generic face prints. What keeps it that
// way is this gate: the set of modules that may call `console.log` is CLOSED and
// declared below, and it may only ever SHRINK (the acd-silent-catch ratchet idiom —
// a sanctioned floor, not an amnesty).
//
// Why a declared floor rather than a blanket ban: three legitimate printer classes
// survive, and each is named with its reason in PRINTERS. Everything else — every
// command module, every core — reports through a value: a `render()` return, or a
// `log` collector its caller injects (the cores' defaults are NO_PRINT for exactly
// this reason, so an un-injected call is silent-by-contract rather than a second
// printer sneaking output past the face's one-document discipline).
//
// The gate is comment-blind (a comment naming console.log is not a call) and matches
// the CALL FORM `console.log(`, so a mention in a string or an identifier is not a
// match either.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");

// THE CLOSED SET. Key = repo-relative path under src/; value = why it may print.
// Adding a row is a DESIGN decision, not a fix — the ratchet below fails on growth.
const PRINTERS = {
  // (1) The faces themselves — the one door output is supposed to leave by.
  "spine/face.mjs": "THE generic CLI face: the one place a command's render/--json document reaches stdout",
  "cli.mjs": "the top-level face — helpText, --version, and the ladder shims the route table cannot express",

  // (2) `cli.launch` bodies — a long-lived foreground process owns its own announce
  // lines by seam design (the launcher seam's contract: the body owns workspace
  // posture, announces, refusals and shutdown). Their MACHINE face is the probe,
  // which never launches, so the one-document discipline is preserved where it
  // matters (`--json` is checked before cli.launch is consulted).
  "commands/mesh-serve.mjs": "cli.launch body — the control/serve daemon's announce + shutdown lines",
  "commands/mesh-ui.mjs": "cli.launch body — the fleet server's announce lines",
  "commands/work-ui.mjs": "cli.launch body — the board server's announce lines",
  "commands/assets-ui.mjs": "cli.launch body — the setup UI's announce + not-started print",

  // (3) Interactive + long-lived-server prints that are not a command document.
  "prompt.mjs": "interactive prompting — the question IS the output, and it is not a document",
  "terminal-ws.mjs": "the board server's terminal socket: the spawned-PTY pid line, traceability for a running process",

  // (4) The two DELIBERATELY unrouted ladder doors (WAVE-D-MIGRATION d1 wave 2:
  // "work memory and session stay laddered by design — they delegate wholesale").
  // They are their own faces today; when either joins the route table its row goes,
  // and the ratchet below makes that a one-way door.
  "commands/mesh-session.mjs": "`aof session start|ping|end` — a declared ladder face (its own envelope + exit policy)",
  "work-memory.mjs": "`aof work memory …` — a declared ladder face (runMemory's log default IS its printer)",
};

// The count may only fall. A migration that retires a printer should also drop its
// PRINTERS row; a NEW printer must be an explicit, argued edit here.
const PRINTER_CEILING = 11;

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function printsToConsole(source) {
  return /\bconsole\.log\s*\(/.test(stripComments(source));
}

// Every .mjs under src/, repo-relative to src/ (one level of subdirectory is enough —
// spine/, commands/, effects/, import/).
async function srcModules(dir = SRC, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await srcModules(path.join(dir, entry.name), rel)));
    else if (entry.name.endsWith(".mjs")) out.push(rel);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/42 wave (d) d1 (acd-console-log-confined): only the declared faces, launcher bodies and ladder doors call console.log — every core reports through a value",
    run: async () => {
      const modules = await srcModules();
      const printers = [];
      for (const rel of modules) {
        const source = await readFile(path.join(SRC, rel), "utf8");
        if (printsToConsole(source)) printers.push(rel);
      }
      const undeclared = printers.filter((rel) => !(rel in PRINTERS));
      assert.deepEqual(
        undeclared,
        [],
        `console.log is confined to the declared printers (undeclared: ${undeclared.join(", ")}). ` +
          "A command renders (return the lines, the face prints them); a core reports through the `log` " +
          "collector its caller injects — its default is NO_PRINT, never console.log.",
      );
    },
  },
  {
    name: "arch/42 wave (d) d1: the printer set is a RATCHET — it may shrink, never grow (and every declared row is still a real printer)",
    run: async () => {
      const modules = await srcModules();
      const printers = new Set();
      for (const rel of modules) {
        const source = await readFile(path.join(SRC, rel), "utf8");
        if (printsToConsole(source)) printers.add(rel);
      }
      assert.ok(
        printers.size <= PRINTER_CEILING,
        `the printer count (${printers.size}) is at or below the sanctioned ceiling ${PRINTER_CEILING} — a NEW printer is a design decision, not a fix`,
      );
      // A declared row that no longer prints is stale bookkeeping: the gate would
      // silently license a future re-print. Drop the row with the migration.
      const stale = Object.keys(PRINTERS).filter((rel) => !printers.has(rel));
      assert.deepEqual(
        stale,
        [],
        `every PRINTERS row still names a real printer (stale rows, drop them: ${stale.join(", ")})`,
      );
    },
  },
  {
    name: "arch/42 wave (d) d1: no core carries a console.log default for its `log` collector (an un-injected core is silent, never a second printer)",
    run: async () => {
      const modules = await srcModules();
      const offenders = [];
      for (const rel of modules) {
        const source = stripComments(await readFile(path.join(SRC, rel), "utf8"));
        // `log = console.log` (default parameter) and `options.log ?? console.log` /
        // `?? ((line) => console.log(line))` (the nullish fallback form) are the two
        // shapes this class took before the sweep.
        if (/log\s*=\s*console\.log\b/.test(source) || /\?\?\s*\(?\(?[^)]*\)?\s*=>?\s*console\.log/.test(source)) {
          offenders.push(rel);
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `no module defaults a log collector to console.log (found: ${offenders.join(", ")}) — use NO_PRINT`,
      );

      // --- self-check: the detector FIRES on both retired shapes.
      assert.ok(/log\s*=\s*console\.log\b/.test("export async function f({ log = console.log } = {}) {}"));
      assert.ok(/\?\?\s*\(?\(?[^)]*\)?\s*=>?\s*console\.log/.test("const log = options.log ?? ((line) => console.log(line));"));
    },
  },
];
