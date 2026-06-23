// work:next — the next actionable item, respecting `depends` (ADR-002).
//
// `run` returns the core `nextWork` result with its `path` left a RAW ABSOLUTE in
// its on-disk OS form — NO projection inside run (the ADR-002 keystone). Path
// display is a FACE adapter: the board projects to projectRoot + forward-slash,
// the CLI to cwd (path.relative). A `done` result carries no `path`.
import path from "node:path";
import { nextWork } from "../work.mjs";

export const nextCommand = {
  id: "work:next",
  input: {
    type: "object",
    properties: { scope: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const scope = scopeOf(input);
    // The raw nextWork result — its `path` (when present) is the OS-native
    // absolute item directory; the command does not relativise or slash it.
    return await nextWork(ctx.workspace.workDir, scope);
  },

  cli: {
    // `aof work next [scope]` — an optional positional maps onto the input.
    argv: (positionals) => (positionals[0] ? { scope: positionals[0] } : {}),

    // Reproduces today's `aof work next` human render byte-for-byte: a scope-aware
    // (faceCtx.scope) done line, the blocked line naming the unmet drivers, or the
    // ready item's two-line `ref … / cwd-relative path` form.
    render(result, faceCtx = {}) {
      if (result.state === "done") {
        return `Nothing actionable${faceCtx.scope ? ` in ${faceCtx.scope}` : ""} — everything is done.`;
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
