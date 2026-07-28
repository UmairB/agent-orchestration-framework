// src/spine/flags.mjs — shared CLI flag-interpretation helpers (m42 wave (d)
// leg d1). Runtime selection (--claude / --codex / --runtime a,b) is a FACE
// concern shared by many verbs; it lives here so a command's cli.argv adapter
// and the remaining cli.mjs inline handlers read the SAME interpretation —
// never a per-verb re-derivation. Import-clean of the command core (a command
// file may import this without creating a face→core→command cycle).
import { supportedRuntimes } from "../adapters.mjs";

// The three runtime-selection flags, spec-shaped for cli.spec composition:
//   spec.flags = { ...RUNTIME_FLAGS, target: {...} }
export const RUNTIME_FLAGS = Object.freeze({
  claude: Object.freeze({ type: "boolean", description: "select the claude runtime" }),
  codex: Object.freeze({ type: "boolean", description: "select the codex runtime" }),
  runtime: Object.freeze({ type: "string", description: "comma-separated runtime list" }),
});

export function parseRuntimes(options) {
  const selected = [];
  if (options.claude) selected.push("claude");
  if (options.codex) selected.push("codex");

  if (options.runtime) {
    selected.push(...String(options.runtime).split(",").map((runtime) => runtime.trim()).filter(Boolean));
  }

  if (selected.length === 0) return supportedRuntimes();
  return [...new Set(selected)];
}

export function hasRuntimeOptions(options) {
  return Boolean(options.claude || options.codex || options.runtime);
}
