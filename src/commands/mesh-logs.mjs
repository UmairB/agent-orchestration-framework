// mesh:logs — read a daemon's durable JSONL log (m42 wave (a), TECH_DEBT item 2's
// reader half: "nobody needs to redirect stdout by hand to see what a daemon did").
//
// A READ over the sink mesh-log.mjs writes: `aof mesh logs [proc] [--tail N]`.
// `proc` defaults to mesh-serve (the daemon whose warnings carry the mesh's real
// diagnostics); an unknown proc is an input-contract failure naming the valid set.
// An absent log is absent-NOT-error — `{ entries: [] }` with the path it WOULD be
// at, so "no log yet" and "wrong machine/home" are distinguishable at a glance.
// The remote-node read (`--node <id>`, over the fabric) is the deferred second leg.
import { commandError } from "./errors.mjs";
import { readMeshLog, meshLogPath } from "../mesh-log.mjs";

const KNOWN_PROCS = ["mesh-serve", "mesh-ui"];

export const meshLogsCommand = {
  id: "mesh:logs",
  input: {
    type: "object",
    properties: { proc: { type: "string" }, tail: { type: "number" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const proc = typeof input.proc === "string" && input.proc.length > 0 ? input.proc : "mesh-serve";
    if (!KNOWN_PROCS.includes(proc)) {
      throw commandError(`Unknown log proc "${proc}" — one of: ${KNOWN_PROCS.join(", ")}.`, "invalid-proc", 400);
    }
    const tail = Number.isFinite(input.tail) && input.tail > 0 ? Math.floor(input.tail) : 200;
    const storeOptions = ctx?.globalWorkStoreOptions ?? {};
    const { path: logPath, entries } = readMeshLog(proc, { tail, ...storeOptions });
    return { ok: true, proc, path: logPath, count: entries.length, entries };
  },

  cli: {
    // `aof mesh logs [proc] [--tail N]` — one optional positional + the tail knob.
    argv: (positionals, options = {}) => ({
      ...(typeof positionals[0] === "string" && positionals[0].length > 0 ? { proc: positionals[0] } : {}),
      ...(options.tail != null ? { tail: Number(options.tail) } : {}),
    }),

    render(result) {
      if (result.entries.length === 0) return `${result.proc} — no log entries yet (${result.path}).`;
      return result.entries
        .map((e) => (e.raw != null ? e.raw : `${e.at ?? "-"} ${e.level ?? "-"} ${e.code ?? "-"}: ${e.message ?? ""}`))
        .join("\n");
    },

    json: (result) => result,
  },
};
