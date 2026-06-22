// Shared CLI face projection for the graph:* read commands (query/triage). The
// command result carries a RAW ABSOLUTE graphPath (basis-neutral, 08/ADR-002);
// the CLI --json face relativises it to process.cwd() (path.relative, OS sep),
// mirroring work:next. This is a FACE adapter, never command logic.
import path from "node:path";

export function relativiseGraphPath(result) {
  if (typeof result.graphPath !== "string") return result;
  return { ...result, graphPath: path.relative(process.cwd(), result.graphPath) };
}
