// work:use-headroom / work:unuse-headroom — the headroom plugin toggle (m42
// wave (d) leg d1, wave-3 tail; formerly cli.mjs's CLI-only
// workUseHeadroomCommand / workUnuseHeadroomCommand). Config-only
// read-merge-write of work.headroom; never the lock (ADR-004/005).
//
// The cores' injectable `log` becomes a COLLECTOR here (the pure-outcome
// write-verb idiom + the confine-console.log-to-the-face owed item): the
// install hint the core used to print mid-run rides the result as `notes`, so
// the render reproduces the retired transcript in order and the NEW --json face
// stays one parseable document (a mid-run console.log would have polluted it).
import path from "node:path";
import { useHeadroom, unuseHeadroom } from "../work-headroom.mjs";

function targetDirFrom(positionals, options) {
  return path.resolve(options.target ?? positionals[0] ?? process.cwd());
}

const HEADROOM_FLAGS = Object.freeze({
  target: { type: "string", description: "project directory (default: cwd; a bare positional dir also works)" },
});

export const useHeadroomCommand = {
  id: "work:use-headroom",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
    },
    required: ["targetDir"],
    additionalProperties: false,
  },

  async run(input) {
    const notes = [];
    const result = await useHeadroom({ targetDir: input.targetDir, log: (line) => notes.push(line) });
    return { ...result, notes };
  },

  cli: {
    route: ["work", "use-headroom"],
    spec: {
      usage: "aof work use-headroom [dir] [--json]",
      workspace: false,
      flags: { ...HEADROOM_FLAGS },
    },

    argv: (positionals, options) => ({ targetDir: targetDirFrom(positionals, options) }),

    render: (result) => [...result.notes, `Enabled headroom in ${result.configPath}`].join("\n"),

    json: (result) => ({ configPath: result.configPath, notes: result.notes }),
  },
};

export const unuseHeadroomCommand = {
  id: "work:unuse-headroom",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
    },
    required: ["targetDir"],
    additionalProperties: false,
  },

  async run(input) {
    const notes = [];
    const result = await unuseHeadroom({ targetDir: input.targetDir, log: (line) => notes.push(line) });
    return { ...result, notes };
  },

  cli: {
    route: ["work", "unuse-headroom"],
    spec: {
      usage: "aof work unuse-headroom [dir] [--json]",
      workspace: false,
      flags: { ...HEADROOM_FLAGS },
    },

    argv: (positionals, options) => ({ targetDir: targetDirFrom(positionals, options) }),

    render: (result) => [...result.notes, `Disabled headroom in ${result.configPath}`].join("\n"),

    json: (result) => ({ configPath: result.configPath, notes: result.notes }),
  },
};
