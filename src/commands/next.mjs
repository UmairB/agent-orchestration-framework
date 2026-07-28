// work:next — the next actionable item, respecting `depends` (ADR-002).
//
// `run` returns the core `nextWork` result with its `path` left a RAW ABSOLUTE in
// its on-disk OS form. Mesh git-bus lease/issuance overlays are retired; global
// visibility is handled by the mesh projection/WebSocket path, not by filtering
// next-work candidacy from repo-local mesh files.
import path from "node:path";
import { nextWork } from "../work.mjs";

export const nextCommand = {
  id: "work:next",
  input: {
    type: "object",
    // `now` remains accepted as a white-box no-op for older callers.
    properties: { scope: { type: "string" }, now: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const scope = scopeOf(input);
    const ws = ctx.workspace;

    // The raw nextWork result — its `path` (when present) is the OS-native
    // absolute item directory; the command does not relativise or slash it.
    return await nextWork(ws.workDir, scope);
  },
  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs face copy is deleted.
    route: ["work", "next"],
    spec: {
      usage: "aof work next [range] [--json]",
      flags: {},
    },

    // `aof work next [scope]` — an optional positional maps onto the input.
    argv: (positionals) => (positionals[0] ? { scope: positionals[0] } : {}),

    // Reproduces today's `aof work next` human render byte-for-byte: a scope-aware
    // done line, the blocked line naming the unmet drivers, or the
    // ready item's two-line `ref … / cwd-relative path` form.
    render(result, faceCtx = {}) {
      const scope = faceCtx.scope ?? faceCtx.positionals?.[0];
      if (result.state === "done") {
        return `Nothing actionable${scope ? ` in ${scope}` : ""} — everything is done.`;
      }
      if (result.state === "blocked") {
        return `Blocked: ${result.ref} (${result.slug}) waits on milestone(s) ${result.waitingOn.join(", ")} — not done.`;
      }
      const head = `${result.ref.padEnd(7)} ${result.type.padEnd(9)} ${(result.status ?? "-").padEnd(12)} ${result.slug}`;
      return `${head}\n        ${path.relative(process.cwd(), result.path)}`;
    },

    // `aof work next --json` relativises `path` to cwd (cli.mjs:611), passing the
    // rest of the result through; a path-less (done) result passes through whole.
    json: (result) =>
      typeof result.path === "string"
        ? { ...result, path: path.relative(process.cwd(), result.path) }
        : result,
  },
};

function scopeOf(input) {
  const scope = typeof input?.scope === "string" ? input.scope.trim() : "";
  return scope === "" ? undefined : scope;
}
