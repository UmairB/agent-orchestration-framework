// mesh:logs — read a daemon's durable JSONL log (m42 wave (a), TECH_DEBT item 2's
// reader half: "nobody needs to redirect stdout by hand to see what a daemon did").
//
// A READ over the sink mesh-log.mjs writes: `aof mesh logs [proc] [--tail N]`.
// `proc` defaults to mesh-serve (the daemon whose warnings carry the mesh's real
// diagnostics); an unknown proc is an input-contract failure naming the valid set.
// An absent log is absent-NOT-error — `{ entries: [] }` with the path it WOULD be
// at, so "no log yet" and "wrong machine/home" are distinguishable at a glance.
// The remote-node read (`--node <id>`, over the fabric) is the deferred second leg.
import { commandError } from "../command-error.mjs";
import { MESH_WORKSPACE_FLAG, guardMeshPositionals } from "./mesh-face-shared.mjs";
import { readMeshLog, meshLogPath } from "../mesh-log.mjs";
// m42 / item 2's REMOTE read — `--node <id>` answers from the control's node_logs
// ring (streamed up by each worker's daemon), no SSH archaeology.
import { openGlobalWorkProjectionStore, readNodeLogEntries } from "../global-work-store.mjs";
import { globalMeshPaths } from "../workspace.mjs";

// m43 / ADR-010/R6.5 — `degrade` is ADMITTED, and it is not cosmetic. `reportDegrade`
// (src/degrade.mjs) writes every coded degrade event into a sink beside the daemons' own
// logs, and until now no verb could read it: ADR-005 requires the reader migration's
// fallback to be an EXPLICIT, REPORTED degrade rather than a silent one, and a report with
// no reader is a report only a file has seen. One entry, and without it the requirement is
// decorative.
const KNOWN_PROCS = ["mesh-serve", "mesh-ui", "degrade"];

export const meshLogsCommand = {
  id: "mesh:logs",
  input: {
    type: "object",
    properties: { proc: { type: "string" }, tail: { type: "number" }, node: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const tail = Number.isFinite(input.tail) && input.tail > 0 ? Math.floor(input.tail) : 200;
    const storeOptions = ctx?.globalWorkStoreOptions ?? {};

    // REMOTE: a node id names whose streamed log to read (this node's store copy).
    const node = typeof input.node === "string" ? input.node.trim() : "";
    if (node !== "") {
      const store = await openGlobalWorkProjectionStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
      try {
        const entries = readNodeLogEntries(store, node, { tail });
        return { ok: true, node, count: entries.length, entries };
      } finally {
        store.close?.();
      }
    }

    const proc = typeof input.proc === "string" && input.proc.length > 0 ? input.proc : "mesh-serve";
    if (!KNOWN_PROCS.includes(proc)) {
      throw commandError(`Unknown log proc "${proc}" — one of: ${KNOWN_PROCS.join(", ")}.`, "invalid-proc", 400);
    }
    const { path: logPath, entries } = readMeshLog(proc, { tail, ...storeOptions });
    return { ok: true, proc, path: logPath, count: entries.length, entries };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; meshVerbCli's cli.mjs ladder branch is deleted.
    route: ["mesh", "logs"],
    spec: {
      usage: "aof mesh logs [proc] [--tail N] [--node <id>] [--workspace <path|id>] [--json]",
      flags: {
        tail: { type: "string", description: "how many trailing entries to read" },
        node: { type: "string", description: "read a remote node's streamed log entries" },
        ...MESH_WORKSPACE_FLAG,
      },
    },

    // `aof mesh logs [proc] [--tail N]` — one optional positional + the tail knob.
    argv: (positionals, options = {}) => {
      guardMeshPositionals("logs", positionals, { max: 1 });
      return {
        ...(typeof positionals[0] === "string" && positionals[0].length > 0 ? { proc: positionals[0] } : {}),
        ...(options.tail != null ? { tail: Number(options.tail) } : {}),
        ...(typeof options.node === "string" && options.node.length > 0 ? { node: options.node } : {}),
      };
    },

    render(result) {
      if (result.entries.length === 0) {
        return result.node != null
          ? `${result.node} — no streamed log entries yet (the node's daemon streams them while connected).`
          : `${result.proc} — no log entries yet (${result.path}).`;
      }
      return result.entries
        .map((e) => (e.raw != null ? e.raw : `${e.at ?? "-"} ${e.level ?? "-"} ${e.code ?? "-"}: ${e.message ?? ""}`))
        .join("\n");
    },

    json: (result) => result,
  },
};
