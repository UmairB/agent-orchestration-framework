// The in-process command registry — the single source of truth for every work
// operation, the SPINE both faces couple through (ADR-002). The CLI is a thin
// `argv → invoke → render`/`--json` face; each UI server is a thin
// `transport → invoke → project` face. Both call this SAME core in-process —
// never a per-request subprocess (ADR-001).
//
// A Command is the frozen shape:
//   {
//     id:    string,                       // the registry key, e.g. "work:doc"
//     input: <JSONSchema>,                 // plain serialisable data only
//     run:   async (input, ctx) => result, // the operation; returns basis-NEUTRAL
//                                          //   data (raw absolute paths, or list's
//                                          //   dir as listStream emits it) — NO
//                                          //   displayPath/relativise inside run.
//     cli:   { argv, render, json },       // the CLI face adapter (argv → input,
//                                          //   human render, --json projection).
//   }
//
//   ctx = { workspace } where workspace is the loadWorkspace result
//   { workDir, config, projectRoot, configPath }.
//
// Path-display projection is a FACE adapter, NOT command logic: the board face
// relativises raw paths to projectRoot + forward-slash; the CLI face relativises
// to process.cwd() (path.relative, OS separators). Basis-neutral results let each
// face project losslessly — the keystone that makes byte-for-byte on both faces
// achievable on Windows separators (ADR-002).
import { loadWorkspace } from "./work.mjs";
import { listCommand } from "./commands/list.mjs";
import { docCommand } from "./commands/doc.mjs";
import { tasksCommand } from "./commands/tasks.mjs";
import { validateCommand } from "./commands/validate.mjs";
import { nextCommand } from "./commands/next.mjs";
import { feedbackCommand } from "./commands/feedback.mjs";
// milestone 09 — graphify command core (graph:build/query/triage register into
// the SAME core; ADR-001). The driver (src/graphify.mjs) is the sole spawn site.
import { graphBuildCommand } from "./commands/graph-build.mjs";
import { graphQueryCommand } from "./commands/graph-query.mjs";
import { graphTriageCommand } from "./commands/graph-triage.mjs";
// milestone 11 (re-open / ADR-007) — graph:impact: the DETERMINISTIC, edge-based,
// file-anchored coupling lookup the running ACD agents consume (dependencies +
// dependents straight from graph.json's edges). Reads the structured graph via the
// pure normalizer (NOT a spawn, NOT a markdown parse) — supersedes the milestone's
// original ADR-002 "zero production code" stance, which left it with no real consumer.
import { graphImpactCommand } from "./commands/graph-impact.mjs";
// milestone 12 — managed tool provisioning (project:provision registers into the
// SAME core; 12/ADR-003). It drives story 00's provider registry/resolver and is
// global-store oriented (reads no project files).
import { projectProvisionCommand } from "./commands/project-provision.mjs";
// milestone 13 — external milestone import (import:milestone registers into the
// SAME core; 13/ADR-002). It reads a source repo READ-ONLY and materializes a
// recovered milestone as a frozen artifact pair in the .aof/ import store.
import { importMilestoneCommand } from "./commands/import-milestone.mjs";

// The registry is the ONLY door (ADR-004 inv. 3): the faces obtain the
// `ctx.workspace` they pass to `invoke` THROUGH the registry, never by importing
// `work.mjs` directly. Re-exporting `loadWorkspace` here keeps board-ui.mjs's
// (and the CLI's) sole operation-bearing import the command core.
export { loadWorkspace };

// The six work-surface commands (08/ADR-002) PLUS the three graph commands
// (09/ADR-001), all in the SAME registry — so listCommands() returns the six
// work + three graph commands, and every face couples through this one core.
const COMMANDS = [
  listCommand,
  docCommand,
  tasksCommand,
  validateCommand,
  nextCommand,
  feedbackCommand,
  graphBuildCommand,
  graphQueryCommand,
  graphTriageCommand,
  graphImpactCommand,
  projectProvisionCommand,
  importMilestoneCommand,
];

// Keyed by id for O(1) lookup; insertion order preserved for listCommands().
const REGISTRY = new Map(COMMANDS.map((command) => [command.id, command]));

// The registry lookup both faces and the arch-tests use. A known id resolves to
// its command object; an unknown id resolves to undefined.
export function getCommand(id) {
  return REGISTRY.get(id);
}

// Every registered command (the full objects). The ADR-004 bijection arch-test
// asserts each carries a `cli` adapter and a reachable CLI dispatch branch.
export function listCommands() {
  return [...REGISTRY.values()];
}

// The in-process call both faces make: look up the command, await its run with
// the supplied input + ctx, and return the result VERBATIM (no projection — that
// is the caller/face's job). An unknown id is a programmer error: throw an Error
// naming the unknown id rather than silently returning undefined.
export async function invoke(id, input, ctx) {
  const command = REGISTRY.get(id);
  if (!command) {
    throw new Error(`Unknown command id "${id}".`);
  }
  return await command.run(input, ctx);
}
