// work:tasks — a story's task features, parsed (was board-ui.mjs handleTasks;
// ADR-002/003).
//
// A READ command (resolveItem, slug-fallback tolerated). The tasks are the
// `<dir>/tasks/*.feature` files, sorted by filename, each parsed with
// `parseFeature` into its scenarios plus per-lane counts. A missing `tasks/` dir
// is absent-NOT-error → `{ ref, tasks: [] }` (mirrors work:doc's ENOENT path).
// An unresolved ref IS an error (ref-not-found) — the resolver's null, distinct
// from a resolved item with no tasks dir.
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { parseFeature } from "../feature-parse.mjs";
import { resolveItem } from "./resolve.mjs";
import { commandError } from "./errors.mjs";

export const tasksCommand = {
  id: "work:tasks",
  input: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    const item = await resolveItem(ctx.workspace.workDir, ref);
    if (!item) {
      throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    }

    const tasksDir = path.join(item.dir, "tasks");
    let entries;
    try {
      entries = await readdir(tasksDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return { ref: item.ref, tasks: [] };
      }
      throw error;
    }

    const fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".feature"))
      .map((entry) => entry.name)
      .sort();

    // Read + parse in parallel; Promise.all preserves the input (sorted) order,
    // so `tasks` is built in the same order as the sorted filenames.
    const tasks = await Promise.all(
      fileNames.map(async (file) => {
        const text = await readFile(path.join(tasksDir, file), "utf8");
        const parsed = parseFeature(text);
        const counts = { executable: 0, manual: 0, uat: 0 };
        for (const scenario of parsed.scenarios) {
          if (scenario.lane && counts[scenario.lane] !== undefined) counts[scenario.lane] += 1;
        }
        return { file, feature: parsed.feature, scenarios: parsed.scenarios, counts };
      })
    );

    return { ref: item.ref, tasks };
  },

  cli: {
    // `aof work tasks <ref>` — one positional maps onto the input.
    argv: (positionals) => ({ ref: positionals[0] }),

    // No historical human form; render a one-line-per-task summary with lane
    // counts. The full scenarios print in --json mode (the contract surface).
    render(result) {
      if (result.tasks.length === 0) return `${result.ref} — no tasks`;
      return result.tasks
        .map((task) => {
          const { executable, manual, uat } = task.counts;
          return `${task.file}  (${executable}E ${manual}M ${uat}U)  ${task.feature ?? "-"}`;
        })
        .join("\n");
    },

    // No path in the result — passes through to --json unchanged.
    json: (result) => result,
  },
};
