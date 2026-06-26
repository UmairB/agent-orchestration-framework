import path from "node:path";
import { access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, loadProjectConfig } from "./dsl.mjs";
import { applyConfig, supportedRuntimes } from "./adapters.mjs";
import { executeFrameworkInstallPlan, frameworkPlanFromLock, gsdPackageFromConfig, installFramework, knownFrameworks, planFrameworkInstall } from "./frameworks.mjs";
import { mergeFrameworkInstallAttempts, readLock, writeLock } from "./lock.mjs";
import { createLockManifest, createRenderPlan, executeApplyActions, planApplyActions, summarizeLockManifest } from "./render-plan.mjs";
import { readJson, writeText } from "./fs.mjs";
import { normalizePackage } from "./packages.mjs";
import { writeWorkspaceConfig } from "./workspace-writer.mjs";
import { promptResourceInput, selectRuntimes } from "./prompt.mjs";
import { findProjectConfig, globalWorkspacePaths, isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "./workspace.mjs";
import { collectAdapterWarnings } from "./adapter-warnings.mjs";
import { adapterWarningsForConfig, doctorConfig, inspectConfig, inspectGlobalConfig, validateConfig, validateGlobalConfig } from "./config-inspect.mjs";
import { addProjectGlobalRef, removeProjectGlobalRef } from "./config-editor.mjs";
import { loadWorkspace, findWork } from "./work.mjs";
import { invoke, getCommand } from "./command-core.mjs";
import { serveStdio } from "./graph-mcp-server.mjs";
import { initWork } from "./work-init.mjs";
import { updateWork } from "./work-update.mjs";
import { workMemoryCommand } from "./work-memory.mjs";
import { useHeadroom, unuseHeadroom } from "./work-headroom.mjs";
import { serveBoard } from "./board-serve.mjs";
import { initPlanning } from "./planning-init.mjs";

export async function run(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(helpText());
    return;
  }

  if (command === "init") {
    await initCommand(rest);
    return;
  }

  if (command === "assets") {
    await assetsCommand(rest);
    return;
  }

  if (command === "packages") {
    await packagesCommand(rest);
    return;
  }

  if (command === "project") {
    await projectCommand(rest);
    return;
  }

  if (command === "work") {
    await workCommand(rest);
    return;
  }

  if (command === "graph") {
    await graphCommand(rest);
    return;
  }

  if (command === "planning") {
    await planningCommand(rest);
    return;
  }

  if (command === "import") {
    await importCommand(rest);
    return;
  }

  if (["add", "apply", "sync", "clean", "global", "install", "migrate", "validate", "doctor", "config", "catalog"].includes(command)) {
    throw removedCommandError(command);
  }

  throw new Error(`Unknown command "${command}".\n\n${helpText()}`);
}

async function assetsCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "add") {
    await assetsAddCommand(rest);
    return;
  }

  if (subcommand === "list") {
    await assetsListCommand(rest);
    return;
  }

  if (subcommand === "show") {
    await assetsShowCommand(rest);
    return;
  }

  if (subcommand === "remove") {
    await assetsRemoveCommand(rest);
    return;
  }

  if (subcommand === "use") {
    await assetsUseCommand(rest);
    return;
  }

  if (subcommand === "unuse") {
    await assetsUnuseCommand(rest);
    return;
  }

  if (subcommand === "apply") {
    await assetsApplyCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await assetsValidateCommand(rest);
    return;
  }

  if (subcommand === "clean") {
    await assetsCleanCommand(rest);
    return;
  }

  if (subcommand === "ui") {
    await assetsUiCommand(rest);
    return;
  }

  throw new Error(`Unknown assets command "${subcommand ?? ""}".\n\nExamples:\n  aof assets add skill code-review\n  aof assets add --global skill shared-review\n  aof assets apply --dry-run`);
}

async function packagesCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "add") {
    await packagesAddCommand(rest);
    return;
  }

  if (subcommand === "list") {
    await packagesListCommand(rest);
    return;
  }

  if (subcommand === "show") {
    await packagesShowCommand(rest);
    return;
  }

  if (subcommand === "remove") {
    await packagesRemoveCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await packagesValidateCommand(rest);
    return;
  }

  if (subcommand === "install") {
    await packagesInstallCommand(rest);
    return;
  }

  throw new Error(`Unknown packages command "${subcommand ?? ""}".\n\nExamples:\n  aof packages add gsd --codex\n  aof packages install gsd --dry-run\n  aof packages install --from-lock --dry-run`);
}

async function projectCommand(args) {
  const [subcommand = "show", ...rest] = args;

  if (subcommand === "show") {
    await projectShowCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await validateCommand(rest);
    return;
  }

  if (subcommand === "doctor") {
    await doctorCommand(rest);
    return;
  }

  if (subcommand === "migrate") {
    await migrateCommand(rest);
    return;
  }

  if (subcommand === "provision") {
    await projectProvisionCli(rest);
    return;
  }

  throw new Error(`Unknown project command "${subcommand ?? ""}".\n\nExamples:\n  aof project show\n  aof project validate\n  aof project doctor\n  aof project migrate --dry-run\n  aof project provision graphify [--version 0.8.44] [--uninstall] [--dry-run] [--json]`);
}

// `aof project provision <tool> [--version V] [--force] [--uninstall] [--dry-run]
//  [--json]` — the 12/ADR-003 lifecycle surface, routed through the command core
// (invoke("project:provision", …), the 08 bijection). It mirrors graphVerbCommand's
// getCommand → loadWorkspace → invoke → cli.json/render idiom, INCLUDING the
// --json single-pass envelope (print ONLY command.cli.json(result)). Unlike the
// graph verbs, provision is GLOBAL-STORE oriented and reads no project files —
// loadWorkspace is best-effort (a dir with no .aof config still provisions), so it
// is wrapped in try/catch and a minimal ctx is passed when no workspace resolves.
async function projectProvisionCli(args) {
  const options = parseOptions(args);
  const command = getCommand("project:provision");

  let workspace;
  try {
    workspace = await loadWorkspace(process.cwd(), options.config);
  } catch {
    // Provision does not need a real project — proceed with no workspace.
    workspace = undefined;
  }
  const ctx = { workspace };

  const input = command.cli.argv(options._, options);

  if (options.json) {
    try {
      const result = await invoke(command.id, input, ctx);
      console.log(JSON.stringify(command.cli.json(result), null, 2));
    } catch (error) {
      // A single structured error envelope (mirrors graphVerbCommand) — the
      // --json face always emits one parseable envelope, success OR error.
      console.log(JSON.stringify({ ok: false, error: error.message, code: error.code ?? "error" }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  // Non-json: render the result; a command error propagates to bin/aof.mjs
  // (stderr + non-zero exit).
  const result = await invoke(command.id, input, ctx);
  console.log(command.cli.render(result));
}

async function workCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "find") {
    await workFindCommand(rest);
    return;
  }

  if (subcommand === "list") {
    await workListCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await workValidateCommand(rest);
    return;
  }

  if (subcommand === "doctor") {
    await workDoctorCommand(rest);
    return;
  }

  if (subcommand === "next") {
    await workNextCommand(rest);
    return;
  }

  if (subcommand === "doc") {
    await workDocCommand(rest);
    return;
  }

  if (subcommand === "tasks") {
    await workTasksCommand(rest);
    return;
  }

  if (subcommand === "feedback") {
    await workFeedbackCommand(rest);
    return;
  }

  if (subcommand === "init") {
    await workInitCommand(rest);
    return;
  }

  if (subcommand === "update") {
    await workUpdateCommand(rest);
    return;
  }

  if (subcommand === "memory") {
    await workMemoryCommandCli(rest);
    return;
  }

  if (subcommand === "board") {
    await workBoardCommand(rest);
    return;
  }

  if (subcommand === "integrations") {
    await workIntegrationsCommand(rest);
    return;
  }

  if (subcommand === "use-headroom") {
    await workUseHeadroomCommand(rest);
    return;
  }

  if (subcommand === "unuse-headroom") {
    await workUnuseHeadroomCommand(rest);
    return;
  }

  throw new Error(`Unknown work command "${subcommand ?? ""}".\n\nExamples:\n  aof work init [dir] [--dry-run] [--runtime claude,codex] [--force] [--with-headroom]\n  aof work update [dir] [--dry-run] [--force]\n  aof work find 04\n  aof work find 04/02\n  aof work find auth --json\n  aof work list\n  aof work list 03\n  aof work list --json\n  aof work doc 04 SPEC\n  aof work tasks 04/02 --json\n  aof work feedback 04/02 --note "spec was thin" --actor qa\n  aof work memory recall "pin line endings"\n  aof work validate\n  aof work doctor [scope] [--json] [--strict]\n  aof work next 03-10\n  aof work board [--port 4180]\n  aof work integrations notion sync-work 17 [--dry-run] [--json]\n  aof work use-headroom\n  aof work unuse-headroom`);
}

// `aof graph <verb>` — the top-level graphify dispatch (sibling to `aof work`,
// 09/ADR-001). Each verb is a thin argv → invoke("graph:<verb>") → render/--json
// face over the registered command, exactly the workListCommand idiom. The
// `serve` verb is the seam story 04 (mcp-server-runtime) will fill — declared but
// not implemented here (ADR-005 amendment), so it currently falls through to the
// unknown-verb error, which story 04 replaces with the server launch.
async function graphCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "build") {
    await graphVerbCommand("graph:build", rest);
    return;
  }

  if (subcommand === "query") {
    await graphVerbCommand("graph:query", rest);
    return;
  }

  if (subcommand === "triage") {
    await graphVerbCommand("graph:triage", rest);
    return;
  }

  // `aof graph impact <path> [<path> ...]` (milestone 11 re-open / ADR-007): the
  // DETERMINISTIC, edge-based coupling lookup the running agents consume — exact
  // dependencies + dependents for the given files, computed from graph.json (no
  // fuzz, no spawn). Thin argv → invoke("graph:impact") → render/--json face.
  if (subcommand === "impact") {
    await graphVerbCommand("graph:impact", rest);
    return;
  }

  // `aof graph serve` (story 04, ADR-005 amendment): launch the stdio MCP server
  // the story-02 rendered MCP config entry targets (command:"aof", args:["graph",
  // "serve"]). It is a thin transport face over the SAME command core — it reaches
  // the graph ONLY through invoke("graph:…"), and spawns no graphify itself.
  if (subcommand === "serve") {
    await graphServeCommand(rest);
    return;
  }

  console.error(`Unknown graph command "${subcommand ?? ""}".\n\nExamples:\n  aof graph build <folder> [--backend claude] [--json]\n  aof graph query "what calls main" [--json]\n  aof graph impact src/command-core.mjs [src/cli.mjs ...] [--json]\n  aof graph triage [--mode conflicts] [--json]\n  aof graph serve`);
  process.exitCode = 1;
}

// The shared graph verb face: getCommand → loadWorkspace → invoke → cli.json/
// render (the workListCommand idiom). CRITICAL (the reachability @executable
// scenario): in --json mode, a command error (graphify-missing / no-graph) is
// caught and emitted as a SINGLE structured JSON envelope { ok:false, error, code }
// on stdout (+ non-zero exit), so `aof graph <verb> --json` ALWAYS emits one
// parseable JSON envelope — success OR structured error — even with no binary or
// no graph present. The non-json face lets the error propagate to bin/aof.mjs
// (stderr + non-zero exit).
async function graphVerbCommand(id, args) {
  const options = parseOptions(args);
  const command = getCommand(id);
  const workspace = await loadWorkspace(process.cwd(), options.config);

  if (options.json) {
    try {
      const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
      console.log(JSON.stringify(command.cli.json(result), null, 2));
    } catch (error) {
      // A single structured error envelope — proves the verb is dispatched even
      // when its preconditions (live binary / built graph) are not met.
      console.log(JSON.stringify({ ok: false, error: error.message, code: error.code ?? "error" }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  // Non-json: render the result; a command error propagates to bin/aof.mjs
  // (stderr + non-zero exit), which is the missing-graph @executable path.
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
  console.log(command.cli.render(result));
}

// `aof graph serve` — start the stdio MCP server (story 04, ADR-005 amendment).
// loadWorkspace resolves the ctx the server's tool handlers pass to invoke; the
// server then speaks line-delimited JSON-RPC 2.0 over stdin/stdout until EOF. It
// reaches the graph ONLY through invoke("graph:…") and spawns no graphify itself
// (the driver src/graphify.mjs is the sole spawn site — ADR-006 inv. 2).
async function graphServeCommand(args) {
  const options = parseOptions(args);
  const workspace = await loadWorkspace(process.cwd(), options.config);
  await serveStdio({ workspace });
}

// `aof import <unit> <repo> [selector] [--dry-run] [--json]` — the top-level
// import dispatch (a sibling of `aof graph` / `aof work`, 13/ADR-002). The only
// import unit in v0 is `milestone` (SPEC §Scope): an unknown sub-noun exits
// non-zero citing the supported unit "milestone". `milestone` is a thin
// argv → invoke("import:milestone") → render/--json face over the registered
// command, mirroring graphVerbCommand (the getCommand → loadWorkspace → invoke →
// cli.json/render idiom, INCLUDING the --json single-structured-envelope discipline).
async function importCommand(args) {
  const [unit, ...rest] = args;

  if (unit === "milestone") {
    await importMilestoneCommandCli(rest);
    return;
  }

  // SPEC §Scope: the unit of import is a milestone, not arbitrary content —
  // "milestone" is the only supported sub-noun in v0, so an unknown sub-noun
  // exits non-zero citing the supported unit (stderr + non-zero exit).
  console.error(
    `Unknown import unit "${unit ?? ""}". The supported import unit is "milestone".\n\nUsage: aof import milestone <repo> <selector> [--dry-run] [--json]`
  );
  process.exitCode = 1;
}

// `aof import milestone <repo> [selector]` — the thin face over the registered
// import:milestone command (13/ADR-002). Mirrors graphVerbCommand: getCommand →
// loadWorkspace → invoke → cli.json/render. A missing <repo> throws the command's
// missing-repo usage error (propagated to bin/aof.mjs: stderr + non-zero exit). In
// --json mode a command error is emitted as a SINGLE structured envelope
// { ok:false, error, code } on stdout (+ non-zero exit), exactly like the graph
// verbs — so `aof import milestone … --json` always emits one parseable envelope.
async function importMilestoneCommandCli(args) {
  const options = parseOptions(args);
  const command = getCommand("import:milestone");
  const workspace = await loadWorkspace(process.cwd(), options.config);

  if (options.json) {
    try {
      const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
      console.log(JSON.stringify(command.cli.json(result), null, 2));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: error.message, code: error.code ?? "error" }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  // Non-json: render the result; a command error (missing-repo / ambiguous /
  // unsupported) propagates to bin/aof.mjs (stderr + non-zero exit).
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
  console.log(command.cli.render(result));
}

// `aof work integrations <provider> …` — the namespace seam for board/issue-tracker
// integrations (17/ADR-002). `integrations notion` is the only provider in this
// milestone; a future provider (Linear, Jira, …) is a sibling branch, NOT a built
// abstraction. An unknown provider exits non-zero citing the supported provider
// "notion" (stderr + non-zero exit; nothing is pushed to Notion in this path).
async function workIntegrationsCommand(args) {
  const [provider, ...rest] = args;

  if (provider === "notion") {
    await notionIntegrationCommand(rest);
    return;
  }

  console.error(
    `Unknown integrations provider "${provider ?? ""}". The supported integrations provider is "notion".\n\nUsage: aof work integrations notion sync-work <milestone> [--dry-run] [--json]`
  );
  process.exitCode = 1;
}

// `aof work integrations notion <verb> …` — the Notion provider's verb dispatch.
// `sync-work` is the only verb (17/ADR-002). An unknown verb exits non-zero with a
// usage message; nothing is pushed to Notion.
async function notionIntegrationCommand(args) {
  const [verb, ...rest] = args;

  if (verb === "sync-work") {
    await notionSyncWorkCli(rest);
    return;
  }

  console.error(
    `Unknown notion integration verb "${verb ?? ""}". Usage: aof work integrations notion sync-work <milestone> [--dry-run] [--json]`
  );
  process.exitCode = 1;
}

// `aof work integrations notion sync-work <milestone> [--dry-run] [--json]` — the
// thin face over the registered notion:sync-work command (17/ADR-002), routing
// through invoke (the registry door, never a direct path). Mirrors the import /
// graph-verb idiom: getCommand → loadWorkspace → invoke → cli.json/render. A MISSING
// <milestone> exits non-zero with a usage message for `integrations notion sync-work
// <milestone>` (and pushes nothing to Notion). In --json mode a command error is
// emitted as a SINGLE structured envelope { ok:false, error, code } on stdout (+
// non-zero exit), exactly like the import/graph verbs.
async function notionSyncWorkCli(args) {
  const options = parseOptions(args);
  const command = getCommand("notion:sync-work");

  // A missing <milestone> is a usage error caught BEFORE any workspace load /
  // invoke, so the error path constructs no Notion egress at all.
  if (options._[0] == null) {
    console.error(
      "Usage: aof work integrations notion sync-work <milestone> [--dry-run] [--json]"
    );
    process.exitCode = 1;
    return;
  }

  const workspace = await loadWorkspace(process.cwd(), options.config);

  if (options.json) {
    try {
      const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
      console.log(JSON.stringify(command.cli.json(result), null, 2));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, error: error.message, code: error.code ?? "error" }, null, 2));
      process.exitCode = 1;
    }
    return;
  }

  // Non-json: render the result; a command error propagates to bin/aof.mjs (stderr +
  // non-zero exit).
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
  console.log(command.cli.render(result));
}

async function workBoardCommand(args) {
  const options = parseOptions(args);
  // Default to 4180 so it does not collide with `aof assets ui` (4177 frontend /
  // 4178 API); the board serves on this single port.
  const port = Number.parseInt(options.port ?? "4180", 10);
  const projectDir = path.resolve(options.target ?? process.cwd());

  let session;
  try {
    session = await serveBoard({ projectDir, port });
  } catch (error) {
    if (error.code === "ui-build-missing") {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Pass --port <n> to pick another.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { server, boardUrl } = session;
  console.log("AOF work board is running locally.");
  console.log(`Open this URL in your browser: ${boardUrl}`);
  console.log(`Project: ${projectDir}`);
  console.log("Press Ctrl+C to stop the board.");

  await new Promise((resolve) => {
    const shutdown = () => {
      server.close(() => {
        resolve();
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

// `aof work use-headroom [dir]` — enable the headroom plugin (config-only read-merge-
// write of work.headroom; never the lock). PATH-checks headroom and prints a one-line
// install hint when it is absent, but always writes the config and never installs (ADR-004/005).
async function workUseHeadroomCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? options._[0] ?? process.cwd());
  const result = await useHeadroom({ targetDir });
  console.log(`Enabled headroom in ${result.configPath}`);
}

// `aof work unuse-headroom [dir]` — disable the headroom plugin (sets enabled:false but
// keeps the block so the providers choice survives; never the lock) (ADR-004).
async function workUnuseHeadroomCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? options._[0] ?? process.cwd());
  const result = await unuseHeadroom({ targetDir });
  console.log(`Disabled headroom in ${result.configPath}`);
}

async function workInitCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options._[0] ?? process.cwd());
  const runtimes = hasRuntimeOptions(options) ? parseRuntimes(options) : ["claude"];

  const result = await initWork({
    targetDir,
    runtimes,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    withHeadroom: Boolean(options.withHeadroom)
  });

  if (result.guarded) {
    if (options.json) {
      printJson({ guarded: true, manifest: relativeDisplayPath(result.manifestPath, targetDir), message: result.message });
    } else {
      console.error(result.message);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    printJson({
      targetDir: path.relative(process.cwd(), targetDir) || ".",
      runtimes: result.runtimes,
      dryRun: result.dryRun,
      summary: result.summary,
      manifest: result.manifestWritten ? relativeDisplayPath(result.manifestPath, targetDir) : null,
      actions: result.actions.map((item) => ({ action: item.action, path: relativeDisplayPath(item.path, targetDir) })),
      notInstallable: result.notInstallable
    });
    return;
  }

  if (result.dryRun) {
    console.log("dry-run: the following files would be written (nothing written):");
  }
  for (const item of result.actions) {
    console.log(`  ${formatFriendlyApplyAction(item, { dryRun: result.dryRun, targetDir })}`);
  }
  reportNotInstallable(result.notInstallable);
  if (!result.dryRun) {
    const { created, updated, skipped } = result.summary;
    const drift = result.summary["drift-warning"];
    console.log(`Initialised ACD: ${created} created, ${updated} updated, ${skipped} kept, ${drift} drift-warning.`);
    console.log(`Manifest: ${relativeDisplayPath(result.manifestPath, targetDir)}`);
  }
}

async function workUpdateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options._[0] ?? process.cwd());

  const result = await updateWork({
    targetDir,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force)
  });

  if (result.notInitialized) {
    if (options.json) {
      printJson({ notInitialized: true, manifest: relativeDisplayPath(result.manifestPath, targetDir), message: result.message });
    } else {
      console.error(result.message);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    printJson({
      targetDir: path.relative(process.cwd(), targetDir) || ".",
      runtimes: result.runtimes,
      dryRun: result.dryRun,
      summary: result.summary,
      manifest: result.manifestWritten ? relativeDisplayPath(result.manifestPath, targetDir) : null,
      actions: result.actions.map((item) => ({ action: item.action, path: relativeDisplayPath(item.path, targetDir) })),
      notInstallable: result.notInstallable
    });
    return;
  }

  if (result.dryRun) {
    console.log("dry-run: the following changes would be applied (nothing written):");
  }
  for (const item of result.actions) {
    console.log(`  ${formatFriendlyApplyAction(item, { dryRun: result.dryRun, targetDir })}`);
  }
  reportNotInstallable(result.notInstallable);
  if (!result.dryRun) {
    const { created, updated, skipped, deleted } = result.summary;
    const drift = result.summary["drift-warning"];
    console.log(`Updated ACD: ${created} created, ${updated} updated, ${skipped} up-to-date, ${deleted} deleted, ${drift} drift-warning.`);
    console.log(`Manifest: ${relativeDisplayPath(result.manifestPath, targetDir)}`);
  }
}

// `aof work memory <verb>` — delegates to the memory seam (milestone 05, story
// 00). The seam owns argv/scope parsing, config-driven backend selection, the
// frozen-interface dispatch, and the --json-vs-text rendering; it sets
// process.exitCode non-zero on an unknown/missing verb.
async function workMemoryCommandCli(args) {
  await workMemoryCommand(args, { loadWorkspace });
}

async function planningCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "init") {
    await planningInitCommand(rest);
    return;
  }

  throw new Error(`Unknown planning command "${subcommand ?? ""}".\n\nExamples:\n  aof planning init [dir] [--dry-run] [--with-optional] [--runtime claude|codex] [--force]`);
}

async function planningInitCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options._[0] ?? process.cwd());
  const runtime = options.runtime ?? "claude";

  if (!["claude", "codex"].includes(runtime)) {
    throw new Error(`Unsupported runtime "${runtime}". Expected one of: claude, codex.`);
  }

  const result = await initPlanning({
    targetDir,
    runtime,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    withOptional: Boolean(options.withOptional),
    // In --json mode, suppress the human boundary/warning/codex lines so stdout is
    // pure JSON (the plan/codex/manualFallback are carried in the JSON payload).
    log: options.json ? () => {} : undefined
  });

  // Guarded refusal (ADR-006), sha rejection (ADR-002), and a failed runtime step
  // (the honesty gate) all map to a non-zero exit, mirroring the work-init guard.
  if (result.guarded || result.shaRejected || result.installFailed) {
    if (options.json) {
      printJson({
        guarded: Boolean(result.guarded),
        shaRejected: Boolean(result.shaRejected),
        installFailed: Boolean(result.installFailed),
        manifest: relativeDisplayPath(result.manifestPath, targetDir),
        message: result.message
      });
    } else {
      console.error(result.message);
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    printJson({
      targetDir: path.relative(process.cwd(), targetDir) || ".",
      runtime: result.runtime,
      dryRun: result.dryRun,
      sha: result.sha,
      plan: result.planCommands,
      codex: result.codex,
      manualFallback: result.manualFallback,
      manifest: result.manifestWritten ? relativeDisplayPath(result.manifestPath, targetDir) : null,
      plugins: result.manifest?.plugins ?? null
    });
    return;
  }

  if (result.dryRun) {
    // The plan/codex preview lines were already printed by initPlanning via the
    // console.log default. Nothing more to print for a dry-run.
    return;
  }

  console.log(`Pinned the pm-skills marketplace at ${result.sha} for ${result.runtime}.`);
  if (result.runtime === "claude") {
    console.log(`Installed ${result.manifest.plugins.length} planner plugin(s): ${result.manifest.plugins.map((entry) => entry.name).join(", ")}.`);
  } else {
    console.log("Codex: marketplace registered; plugins NOT installed (see the manual fallback above).");
  }
  console.log(`Manifest: ${relativeDisplayPath(result.manifestPath, targetDir)}`);
}

function reportNotInstallable(notInstallable = []) {
  if (notInstallable.length === 0) return;
  const byRuntime = new Map();
  for (const item of notInstallable) {
    const list = byRuntime.get(item.runtime) ?? [];
    list.push(item);
    byRuntime.set(item.runtime, list);
  }
  for (const [runtime, items] of byRuntime) {
    const kinds = [...new Set(items.map((item) => item.kind))].join(", ");
    console.log(`Not installable on ${runtime} (${kinds}): ${items.map((item) => item.id).join(", ")} — unsupported by the capability matrix; not written.`);
  }
}

async function workFindCommand(args) {
  const options = parseOptions(args);
  const query = options._[0];
  if (!query) {
    throw new Error("Usage: aof work find <ref | query>   (e.g. aof work find 04, aof work find 04/02, aof work find auth)");
  }

  const { workDir } = await loadWorkspace(process.cwd(), options.config);
  const rows = await findWork(workDir, query);

  if (options.json) {
    console.log(JSON.stringify(rows.map((row) => ({ ...row, dir: path.relative(process.cwd(), row.dir) })), null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log(`No work item matches "${query}".`);
    process.exitCode = 1;
    return;
  }

  for (const row of rows) {
    const title = row.title ? `  — ${row.title}` : "";
    console.log(`${row.ref.padEnd(7)} ${row.type.padEnd(9)} ${(row.status ?? "-").padEnd(12)} ${row.slug}${title}`);
    console.log(`        ${path.relative(process.cwd(), row.dir)}`);
  }
}

// `aof work list [scope] [--json]` — the whole work stream as the board's data
// source. `--json` emits the frozen flat-array contract (ADR-002) as pure JSON
// on stdout (no human chrome); the bare command prints a depth-indented human
// listing (ref · type · status · title), optionally narrowed to a scope subtree.
async function workListCommand(args) {
  const options = parseOptions(args);
  const scope = options._[0];
  // Rewired through the registry (ADR-002/003): the data comes from work:list via
  // invoke; the CLI applies its own face projection (here, pretty 2-space --json)
  // and keeps the scope-view affordance below (a CLI-face presentation, not
  // operation logic). list's input takes no positionals, so cli.argv ignores them.
  const command = getCommand("work:list");
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const rows = await invoke(command.id, command.cli.argv(options._, options), { workspace });

  // JSON mode is the contract surface: the WHOLE stream, pure JSON, byte-stable
  // across runs. The human render (the command's CLI adapter) applies the
  // scope-narrowing view affordance — the contract `--json` form stays the full
  // stream so the board binds to one fixture.
  if (options.json) {
    console.log(JSON.stringify(command.cli.json(rows), null, 2));
    return;
  }
  console.log(command.cli.render(rows, { scope }));
}

async function workValidateCommand(args) {
  const options = parseOptions(args);
  const scope = options._[0];
  // Rewired through the registry (ADR-002/003): work:validate returns the richer
  // { findings } envelope with RAW absolute paths. The CLI --json adapter
  // (cli.json) UNWRAPS to the bare [{path,problem}] array and re-bases each path
  // to cwd (path.relative, OS separators) — the CLI's historical wire, preserved
  // byte-for-byte. The scoped human framing below stays a CLI-face affordance.
  const command = getCommand("work:validate");
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });

  if (options.json) {
    console.log(JSON.stringify(command.cli.json(result), null, 2));
    if (result.findings.length > 0) process.exitCode = 1;
    return;
  }

  console.log(command.cli.render(result, { scope }));
  // A non-empty findings list is a non-zero exit (today's CLI behaviour).
  if (result.findings.length > 0) process.exitCode = 1;
}

// `aof work doctor [scope] [--json] [--strict]` — the FACE over work:doctor
// (15/ADR-002), the validate sibling with the ADVISORY exit policy. The command's
// `run` returns the basis-neutral { findings } envelope with RAW absolute paths;
// the CLI --json adapter (cli.json) re-bases each path to cwd and carries the
// { healthy, strict, errors, warnings, findings } summary. The --strict EXIT GATE
// lives HERE (not in run): an `error` ALWAYS exits non-zero; a `warn` exits
// non-zero ONLY under --strict — mirroring `configCommand`'s
// `failed = errors.length > 0 || (strict && warns.length > 0)` form verbatim, with
// `warn` in place of config's `warning`. `run`'s findings are identical across
// --strict (the gate is the face, not the run).
async function workDoctorCommand(args) {
  const options = parseOptions(args);
  const scope = options._[0];
  const strict = Boolean(options.strict);
  const command = getCommand("work:doctor");
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });

  const errors = result.findings.filter((finding) => finding.severity === "error");
  const warns = result.findings.filter((finding) => finding.severity === "warn");
  const failed = errors.length > 0 || (strict && warns.length > 0);

  if (options.json) {
    console.log(JSON.stringify(command.cli.json(result, { strict }), null, 2));
  } else {
    console.log(command.cli.render(result, { scope }));
  }

  if (failed) process.exitCode = 1;
}

async function workNextCommand(args) {
  const options = parseOptions(args);
  const scope = options._[0];
  // Rewired through the registry (ADR-002/003): work:next returns the core result
  // with a RAW absolute path; the CLI --json adapter (cli.json) re-bases it to cwd
  // (path.relative) and leaves a path-less (done) result whole — today's wire,
  // byte-for-byte. The scoped done/blocked human lines stay a CLI-face affordance.
  const command = getCommand("work:next");
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });

  if (options.json) {
    console.log(JSON.stringify(command.cli.json(result), null, 2));
    return;
  }

  console.log(command.cli.render(result, { scope }));
}

// `aof work doc <ref> <DOC> [--json]` — a thin argv → command → result face over
// work:doc (ADR-003). A READ: resolves with the command's resolver (slug-fallback
// tolerated). `--json` emits the command's `{ ref, doc, present, body }` result;
// the bare command prints the body (or an absence line). An unknown DOC name /
// unresolved ref throws the command's error (invalid-doc / ref-not-found) up to
// bin/aof.mjs, which prints error.message to stderr and exits non-zero.
async function workDocCommand(args) {
  const options = parseOptions(args);
  const command = getCommand("work:doc");
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });

  if (options.json) {
    console.log(JSON.stringify(command.cli.json(result), null, 2));
    return;
  }
  console.log(command.cli.render(result));
}

// `aof work tasks <ref> [--json]` — a thin argv → command → result face over
// work:tasks (ADR-003). A READ: a resolved item with no tasks dir is the empty
// list (exit 0); an unresolved ref throws ref-not-found up to the top-level catch
// (stderr + non-zero exit). `--json` emits the `{ ref, tasks }` command result.
async function workTasksCommand(args) {
  const options = parseOptions(args);
  const command = getCommand("work:tasks");
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });

  if (options.json) {
    console.log(JSON.stringify(command.cli.json(result), null, 2));
    return;
  }
  console.log(command.cli.render(result));
}

// `aof work feedback <ref> --note "…" [--actor …] [--refs …]` — the ONLY CLI work
// write, a thin argv → command → result face over work:feedback (ADR-003). The
// command resolves EXACT-only (resolveItemExact): a non-exact ref throws
// ref-not-found rather than writing to a slug-matched wrong item, and a missing
// note throws missing-note BEFORE any write — both propagate to bin/aof.mjs
// (stderr + non-zero exit). An omitted --actor defaults to "you" inside the
// command. `--json` emits the `{ ok, bullet }` result.
async function workFeedbackCommand(args) {
  const options = parseOptions(args);
  const command = getCommand("work:feedback");
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });

  if (options.json) {
    console.log(JSON.stringify(command.cli.json(result), null, 2));
    return;
  }
  console.log(command.cli.render(result));
}

async function initCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? options._[0] ?? process.cwd());
  const paths = workspacePaths(targetDir);

  if (!options.force && await exists(paths.configPath)) {
    throw new Error(`Config already exists at ${paths.configPath}. Re-run with --force to replace it.`);
  }

  if (!options.force && await isLegacyConfigOnlyProject(targetDir)) {
    throw new Error(`Legacy config already exists at ${legacyConfigPath(targetDir)}. Run aof project migrate to create .aof/ explicitly.`);
  }

  if (options.items || options.defaults || options.select) {
    throw new Error("Catalog-backed init items are not available yet. Use `aof assets add ...` for project assets or `aof assets add --global ...` for reusable global assets.");
  }

  const runtimes = hasRuntimeOptions(options) ? parseRuntimes(options) : await selectRuntimes();
  const config = {
    name: path.basename(targetDir),
    resources: [],
    globalRefs: [],
    packages: []
  };

  if (options.dryRun) {
    console.log(`write: ${paths.configPath}`);
    console.log(`write: ${paths.lockPath}`);
    console.log("dry-run: no files written");
    return;
  }

  await writeWorkspaceConfig(targetDir, {
    ...config,
    $schema: "https://aof.local/schemas/aof.schema.json",
    runtimes
  });
  await writeInstallLock(targetDir, [], runtimes, null);
  console.log(`Created ${paths.configPath}`);
  await guideAfterInit(targetDir, runtimes, options);
}

async function guideAfterInit(targetDir, runtimes, options) {
  console.log("Next steps:");
  console.log("- Add project assets with `aof assets add skill`.");
  console.log("- Add reusable global assets with `aof assets add --global skill`.");
  console.log("- Add managed packages with `aof packages add gsd`.");
  console.log("- Validate this project with `aof project validate`.");
  console.log("- Render outputs with `aof assets apply --dry-run` then `aof assets apply`.");
  console.log("- Edit assets in the setup UI with `aof assets ui`.");
}

async function assetsAddCommand(args) {
  const options = parseOptions(args);
  let [kind, id] = options._;
  let interactiveInput = null;
  if (!kind && !id) {
    interactiveInput = await promptResourceInput({
      global: Boolean(options.global),
      description: options.description,
      skipBody: true,
      runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : undefined
    });
    kind = interactiveInput.kind;
    id = interactiveInput.id;
  } else if (!kind || !id) {
    const promptInput = await promptResourceInput({
      global: Boolean(options.global),
      kind,
      id,
      description: options.description,
      skipBody: true,
      runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : undefined
    });
    interactiveInput = promptInput;
    kind = promptInput.kind;
    id = promptInput.id;
  }

  const input = {
    kind,
    id,
    name: options.name,
    description: interactiveInput?.description ?? options.description,
    body: options.body ?? interactiveInput?.body,
    runtimes: interactiveInput?.runtimes ?? (hasRuntimeOptions(options) ? parseRuntimes(options) : supportedRuntimes()),
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun)
  };
  const { scaffoldGlobalResource, scaffoldResource } = await import("./scaffold.mjs");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = options.global
    ? await scaffoldGlobalResource(input)
    : await scaffoldResource(targetDir, input);

  if (result.dryRun) {
    console.log(`write: ${result.assetPath}`);
    console.log(`write: ${result.configPath}`);
    return;
  }

  console.log(`Created ${result.assetPath}`);
  console.log(`Updated ${result.configPath}`);
  console.log(`Next: edit the source file directly or run \`aof assets ui\`.`);
}

async function assetsListCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const inspection = options.global ? await inspectGlobalConfig() : await inspectConfig(targetDir, options);
  if (options.json) {
    printJson({
      scope: options.global ? "global" : "project",
      configPath: inspection.configPath,
      resources: inspection.resources
    });
    return;
  }

  console.log(`${options.global ? "global" : "project"}: ${inspection.configPath}`);
  if (inspection.resources.length === 0) {
    console.log("resources: 0");
    return;
  }
  console.log(`resources: ${inspection.resources.length}`);
  for (const resource of inspection.resources) {
    console.log(`- ${resource.kind}:${resource.id} runtimes=${resource.runtimes.join(",")}`);
  }
}

async function assetsShowCommand(args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!kind || !id) {
    throw new Error("Usage: aof assets show [--global] <kind> <id> [--json]");
  }

  const paths = options.global ? globalWorkspacePaths() : workspacePaths(path.resolve(options.target ?? process.cwd()));
  if (!await exists(paths.configPath)) {
    const command = options.global ? "aof assets add --global <kind> <id>" : "aof assets add <kind> <id>";
    throw new Error(`Config not found at ${paths.configPath}. Run ${command} first.`);
  }

  const raw = await readJson(paths.configPath);
  const resource = (raw.resources ?? []).find((item) => item.kind === kind && item.id === id);
  if (!resource) {
    throw new Error(`Resource not found: ${kind}:${id}`);
  }

  const sourcePath = resource.path ? path.resolve(path.dirname(paths.configPath), resource.path) : null;
  const bodyExists = sourcePath ? await exists(sourcePath) : Boolean(resource.body || resource.prompt || resource.instructions);
  const payload = {
    configPath: paths.configPath,
    resource: {
      ...resource,
      sourcePath,
      bodyExists
    }
  };

  if (options.json) {
    printJson(payload);
    return;
  }

  console.log(`${options.global ? "global" : "project"}: ${paths.configPath}`);
  console.log(`resource: ${resource.kind}:${resource.id}`);
  if (resource.name) console.log(`name: ${resource.name}`);
  if (resource.description) console.log(`description: ${resource.description}`);
  console.log(`runtimes: ${(resource.runtimes ?? supportedRuntimes()).join(",")}`);
  if (sourcePath) console.log(`path: ${sourcePath}`);
  console.log(`body: ${bodyExists ? "present" : "missing"}`);
}

async function assetsRemoveCommand(args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!kind || !id) {
    throw new Error("Usage: aof assets remove [--global] <kind> <id> [--dry-run] [--force]");
  }

  const paths = options.global ? globalWorkspacePaths() : workspacePaths(path.resolve(options.target ?? process.cwd()));
  if (!await exists(paths.configPath)) {
    throw new Error(`Config not found at ${paths.configPath}.`);
  }

  const raw = await readJson(paths.configPath);
  const resources = Array.isArray(raw.resources) ? raw.resources : [];
  const index = resources.findIndex((resource) => resource.kind === kind && resource.id === id);
  if (index < 0) {
    throw new Error(`Resource not found: ${kind}:${id}`);
  }

  const resource = resources[index];
  const sourcePath = resource.path ? path.resolve(path.dirname(paths.configPath), resource.path) : null;
  const assetDir = sourcePath ? path.dirname(sourcePath) : null;
  const config = {
    ...raw,
    resources: resources.filter((_resource, resourceIndex) => resourceIndex !== index)
  };

  if (options.dryRun) {
    if (assetDir) console.log(`delete: ${assetDir}`);
    console.log(`write: ${paths.configPath}`);
    console.log("dry-run: no source assets or config files were changed");
    return;
  }

  if (assetDir) await rm(assetDir, { recursive: true, force: true });
  await writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
  if (assetDir) console.log(`Deleted ${assetDir}`);
  console.log(`Updated ${paths.configPath}`);
  console.log("Generated runtime outputs were not removed. Run `aof assets clean` to remove lock-owned generated files.");
}

async function assetsUseCommand(args) {
  await assetsGlobalRefCommand("use", args);
}

async function assetsUnuseCommand(args) {
  await assetsGlobalRefCommand("unuse", args);
}

async function assetsGlobalRefCommand(action, args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!options.global || !kind || !id) {
    throw new Error(`Usage: aof assets ${action} --global <kind> <id>`);
  }

  const targetDir = path.resolve(options.target ?? process.cwd());
  const update = action === "use" ? addProjectGlobalRef : removeProjectGlobalRef;
  const result = await update(targetDir, { kind, id }, options);
  if (!result.ok) {
    for (const item of result.diagnostics ?? []) console.log(`${item.severity}: ${item.path} ${item.message}`);
    process.exitCode = 1;
    return;
  }

  const verb = action === "use" ? "Added" : "Removed";
  console.log(`${verb} global reference ${kind}:${id}`);
  console.log(`Updated ${workspacePaths(targetDir).configPath}`);
}

async function assetsValidateCommand(args) {
  const options = parseOptions(args);
  if (options.global) {
    await printValidationResult(await validateGlobalConfig(), options, "global config passed validation");
    return;
  }

  await validateCommand(args);
}

async function printValidationResult(diagnostics, options, successMessage) {
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      diagnostics
    });
  } else if (!failed) {
    console.log(`valid: ${successMessage}`);
    if (warnings.length > 0) console.log(`warnings: ${warnings.length}`);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warnings.length} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.path} ${item.message}`);
  }

  if (failed) process.exitCode = 1;
}

async function assetsApplyCommand(args) {
  const options = parseOptions(args);
  if (options.install) {
    throw new Error("aof assets apply does not run package installers. Use `aof packages install ...` for package execution.");
  }
  if (options.global) {
    throw new Error("aof assets apply does not support global runtime output. Reference global source assets with `aof assets use --global ...`, then run `aof assets apply`.");
  }
  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const paths = workspacePaths(targetDir);
  const runtimes = await runtimesForApply(configPath, options);
  const validationDiagnostics = await validateConfig(targetDir, options);
  const validationErrors = validationDiagnostics.filter((item) => item.severity === "error");
  if (validationErrors.length > 0) {
    await printValidationResult(validationDiagnostics, options, "config passed validation");
    return;
  }
  const config = await loadProjectConfig(configPath);
  const adapterWarnings = collectAdapterWarnings(config, {
    targetDir,
    runtimes,
    global: Boolean(options.global)
  });
  const desiredOutputs = await createRenderPlan(config, {
    targetDir,
    runtimes,
    global: Boolean(options.global)
  });
  const previousLock = await readLock(paths.lockPath);
  const actions = await planApplyActions(desiredOutputs, previousLock, {
    targetDir,
    force: Boolean(options.force)
  });

  const manifest = createLockManifest({
    actions,
    desiredOutputs,
    previousLock,
    config,
    runtimes,
    global: Boolean(options.global)
  });

  if (options.dryRun) {
    const summary = summarizeLockManifest(manifest);
    if (options.json) {
      printJson({ dryRun: true, strict: Boolean(options.strict), adapterWarnings, actions, lockPreview: summary });
      if (options.strict && adapterWarnings.length > 0) process.exitCode = 1;
      return;
    }
    console.log("dry-run: no files or lock state were written");
    printAdapterWarnings(adapterWarnings);
    if (strictAdapterWarningsFailed(options, adapterWarnings)) return;
    if (actions.length > 0) console.log("Planned asset changes");
    for (const item of actions) {
      console.log(options.verbose ? formatApplyAction(item) : formatFriendlyApplyAction(item, { dryRun: true }));
    }
    console.log(`Would update ${relativeDisplayPath(paths.lockPath, targetDir)} (${summary.files} file${summary.files === 1 ? "" : "s"}, ${summary.frameworks} framework intent${summary.frameworks === 1 ? "" : "s"})`);
    return;
  }

  printAdapterWarnings(adapterWarnings);
  if (strictAdapterWarningsFailed(options, adapterWarnings)) return;
  if (actions.length > 0) console.log("Applied assets");
  for (const item of actions) {
    console.log(options.verbose ? formatApplyAction(item) : formatFriendlyApplyAction(item, { targetDir }));
  }

  await executeApplyActions(actions);
  await writeLock(paths.lockPath, manifest);
  console.log(`${successMarker()} Updated ${relativeDisplayPath(paths.lockPath, targetDir)}`);
}

async function assetsCleanCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const { createCleanPlan, executeCleanPlan } = await import("./clean.mjs");
  const plan = await createCleanPlan(targetDir);

  if (!plan.lock) {
    console.log(`clean: no lock file found at ${plan.lockPath}`);
    return;
  }

  if (options.dryRun) {
    console.log("dry-run: no generated files or lock entries will be removed");
  }

  if (plan.actions.length === 0) {
    console.log("clean: no generated file entries in lock");
  }

  for (const item of plan.actions) {
    console.log(formatApplyAction(item));
  }
  console.log(`lock-preview: remove ${plan.removedCount} file entr${plan.removedCount === 1 ? "y" : "ies"}`);

  if (options.dryRun) return;

  await executeCleanPlan(plan);
  console.log(`lock: ${plan.lockPath}`);
}

async function assetsUiCommand(args) {
  const options = parseOptions(args);
  await setupUiCommand({ ...options, uiMode: "assets" });
}

async function packagesAddCommand(args) {
  const options = parseOptions(args);
  const [packageId] = options._;
  if (packageId !== "gsd") {
    throw new Error("Usage: aof packages add gsd [--codex] [--claude] [--runtime list] [--source source] [--package npm-package] [--dry-run]");
  }

  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const raw = await readJson(configPath);
  const pkg = normalizePackage(packageIntentFromOptions(options, raw), 0);
  const packages = [
    ...(Array.isArray(raw.packages) ? raw.packages.filter((item) => item?.id !== "gsd") : []),
    packageForConfig(pkg)
  ];
  const nextConfig = { ...raw, packages };

  if (options.dryRun) {
    console.log(`dry-run: no config changes were written and no installer code ran`);
    console.log(`write: ${configPath}`);
    console.log(`package: gsd source=${pkg.source} runtimes=${pkg.runtimes.join(",")}`);
    return;
  }

  await writeText(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  console.log(`Updated ${configPath}`);
  console.log(`package: gsd source=${pkg.source} runtimes=${pkg.runtimes.join(",")}`);
  console.log("Next: run `aof packages install gsd --dry-run` to preview installer commands.");
}

async function packagesListCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const config = await loadProjectConfig(await findProjectConfig(targetDir, options.config));
  const paths = workspacePaths(targetDir);
  const lock = await readLock(paths.lockPath);
  const packages = packageSummaries(config.packages ?? [], lock);

  if (options.json) {
    printJson({ packages });
    return;
  }

  console.log(`packages: ${packages.length}`);
  for (const pkg of packages) {
    const attempts = pkg.installAttempts.length;
    console.log(`- ${pkg.id} namespace=${pkg.namespace} source=${pkg.source} runtimes=${pkg.runtimes.join(",")} attempts=${attempts}`);
  }
}

async function packagesShowCommand(args) {
  const options = parseOptions(args);
  const [packageId] = options._;
  if (!packageId) throw new Error("Usage: aof packages show <id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const config = await loadProjectConfig(await findProjectConfig(targetDir, options.config));
  const paths = workspacePaths(targetDir);
  const lock = await readLock(paths.lockPath);
  const pkg = packageSummaries(config.packages ?? [], lock).find((item) => item.id === packageId);
  if (!pkg) throw new Error(`Package "${packageId}" is not configured. Run \`aof packages add gsd\` to declare GSD package intent.`);

  if (options.json) {
    printJson(pkg);
    return;
  }

  console.log(`package: ${pkg.id}`);
  console.log(`namespace: ${pkg.namespace}`);
  console.log(`source: ${pkg.source}`);
  console.log(`runtimes: ${pkg.runtimes.join(",")}`);
  console.log(`installAttempts: ${pkg.installAttempts.length}`);
  for (const attempt of pkg.installAttempts) {
    console.log(`- ${attempt.runtime} status=${attempt.status} scope=${attempt.scope}`);
  }
}

async function packagesRemoveCommand(args) {
  const options = parseOptions(args);
  const [packageId] = options._;
  if (!packageId) throw new Error("Usage: aof packages remove <id> [--dry-run]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const raw = await readJson(configPath);
  const packages = Array.isArray(raw.packages) ? raw.packages : [];
  if (!packages.some((item) => item?.id === packageId)) {
    throw new Error(`Package "${packageId}" is not configured.`);
  }
  const nextConfig = { ...raw, packages: packages.filter((item) => item?.id !== packageId) };

  if (options.dryRun) {
    console.log("dry-run: no config changes were written and no runtime files or lock attempts were removed");
    console.log(`remove-package: ${packageId}`);
    console.log(`write: ${configPath}`);
    return;
  }

  await writeText(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  console.log(`Updated ${configPath}`);
  console.log(`Removed package intent ${packageId}`);
  console.log("Runtime files and lock install attempts were not removed.");
}

async function packagesValidateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const raw = await readJson(configPath);
  const diagnostics = packageDiagnostics(raw);
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      diagnostics
    });
  } else if (!failed) {
    console.log("valid: packages passed validation");
    if (warnings.length > 0) console.log(`warnings: ${warnings.length}`);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warnings.length} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.path} ${item.message}`);
  }

  if (failed) process.exitCode = 1;
}

async function packagesInstallCommand(args) {
  const options = parseOptions(args);
  if (options.fromLock) {
    await installFromLockCommand(options);
    return;
  }

  const [packageId] = options._;
  if (packageId) {
    if (packageId !== "gsd") {
      throw new Error(`Package "${packageId}" does not have installer support yet. Phase 20 supports GSD installer execution only.`);
    }
    const targetDir = path.resolve(options.target ?? process.cwd());
    const config = await loadProjectConfig(await findProjectConfig(targetDir, options.config));
    if (!gsdPackageFromConfig(config) && !options.source && !options.package) {
      throw new Error("GSD package intent is not configured. Run `aof packages add gsd` first.");
    }
    await frameworkInstallCommand(packageId, options);
    return;
  }

  const targetDir = path.resolve(options.target ?? process.cwd());
  const config = await loadProjectConfig(await findProjectConfig(targetDir, options.config));
  const installable = (config.packages ?? []).filter((pkg) => pkg.id === "gsd");
  if (installable.length === 0) {
    throw new Error("No installable packages are configured. Run `aof packages add gsd` first.");
  }
  for (const pkg of installable) {
    await frameworkInstallCommand(pkg.id, options);
  }
}

async function migrateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? options._[0] ?? process.cwd());
  const paths = workspacePaths(targetDir);
  const sourcePath = legacyConfigPath(targetDir);

  if (!await exists(sourcePath)) {
    throw new Error(`No legacy config found at ${sourcePath}.`);
  }

  if (!options.force && await exists(paths.configPath)) {
    throw new Error(`AOF workspace config already exists at ${paths.configPath}. Re-run with --force to replace it.`);
  }

  const legacyConfig = await readJson(sourcePath);
  const resolved = await loadConfig(sourcePath);
  if (options.dryRun) {
    console.log(`write: ${paths.configPath}`);
    console.log(`write: ${paths.lockPath}`);
    return;
  }

  await writeWorkspaceConfig(targetDir, {
    ...resolved,
    $schema: "https://aof.local/schemas/aof.schema.json",
    name: legacyConfig.name ?? resolved.name
  });
  await writeText(paths.lockPath, `${JSON.stringify({
    version: 1,
    migratedAt: new Date().toISOString(),
    source: "aof.config.json",
    runtimes: [...new Set(resolved.resources.flatMap((resource) => resource.runtimes))],
    items: resolved.resources.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      source: "legacy",
      runtimes: resource.runtimes
    }))
  }, null, 2)}\n`);

  console.log(`Created ${paths.configPath}`);
  console.log(`${paths.configPath} is now authoritative; root aof.config.json is legacy and was left untouched.`);
}

async function setupUiCommand(options) {
  const description = "project/global asset editor";

  if (options.noServe || options.dryRun) {
    console.log("Setup UI not started.");
    console.log("Run `aof assets ui` to open the local project/global asset editor.");
    return;
  }

  const uiPort = Number.parseInt(options.port ?? "4177", 10);
  const apiPort = Number.parseInt(options.apiPort ?? String(uiPort + 1), 10);
  const { serveSetupUi } = await import("./setup-ui.mjs");
  const { server } = await serveSetupUi(null, { port: apiPort });
  const frontend = startSetupUiFrontend(uiPort, `http://127.0.0.1:${apiPort}`);
  const uiUrl = `http://127.0.0.1:${uiPort}/?mode=assets`;

  console.log("AOF assets UI is running locally.");
  console.log(`Open this URL in your browser: ${uiUrl}`);
  console.log(`Project: ${process.cwd()}`);
  console.log(`Use the UI for ${description}. Keep this terminal open while you use it.`);
  console.log("Press Ctrl+C to stop the setup UI.");

  await new Promise((resolve, reject) => {
    const shutdown = () => {
      frontend.kill();
      server.close(() => {
        resolve();
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    frontend.once("exit", (code) => {
      server.close(() => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Setup UI frontend exited with code ${code}.`));
        }
      });
    });
  });
}

function startSetupUiFrontend(port, apiUrl = "http://127.0.0.1:4178") {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const uiDir = path.join(repoRoot, "ui");
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  return spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: uiDir,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_AOF_UI_MODE: "assets",
      VITE_AOF_API_URL: apiUrl,
      BROWSER: "none"
    }
  });
}

async function projectShowCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());

  const inspection = await inspectConfig(targetDir, options);
  if (options.json) {
    printJson(inspection);
    return;
  }
  console.log(`config: ${inspection.configPath}`);
  console.log(`name: ${inspection.name ?? "(unresolved)"}`);
  console.log(`resources: ${inspection.resources.length}`);
  for (const resource of inspection.resources) {
    console.log(`- ${resource.kind}:${resource.id} source=${resource.source ?? "local"} runtimes=${resource.runtimes.join(",")}`);
  }
  console.log(`globalRefs: ${inspection.globalRefs.length}`);
  for (const ref of inspection.globalRefs) {
    console.log(`- global:${ref.kind}:${ref.id}`);
  }
  console.log(`packages: ${inspection.packages.length}`);
  for (const pkg of inspection.packages) {
    console.log(`- ${pkg.id} source=${pkg.source} runtimes=${(pkg.runtimes ?? []).join(",")}`);
  }
  if (inspection.legacyConfigIsStale) console.log(`warning: root aof.config.json is legacy; ${inspection.configPath} is authoritative`);
}

async function validateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const diagnostics = await validateConfig(targetDir, options);
  const adapterWarnings = await adapterWarningsForConfig(targetDir, {
    ...options,
    runtimes: parseRuntimes(options)
  });
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const warningCount = warnings.length + adapterWarnings.length;
  const failed = errors.length > 0 || (options.strict && warningCount > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warningCount,
      diagnostics,
      adapterWarnings
    });
  } else if (!failed) {
    console.log("valid: config passed validation");
    if (warningCount > 0) console.log(`warnings: ${warningCount}`);
    printAdapterWarnings(adapterWarnings);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warningCount} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.path} ${item.message}`);
    printAdapterWarnings(adapterWarnings);
  }

  if (failed) process.exitCode = 1;
}

async function doctorCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const report = await doctorConfig(targetDir, {
    ...options,
    runtimes: parseRuntimes(options)
  });
  const errors = report.checks.filter((item) => item.severity === "error");
  const warnings = report.checks.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      healthy: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      ...report
    });
  } else {
    console.log(`doctor: ${failed ? "issues found" : "healthy"}`);
    for (const check of report.checks) {
      console.log(`${check.severity}: ${check.id} - ${check.message}`);
    }
    printAdapterWarnings(report.adapterWarnings);
    for (const suggestion of report.suggestions) {
      console.log(`next: ${suggestion}`);
    }
  }

  if (failed) process.exitCode = 1;
}

async function frameworkInstallCommand(framework, options) {
  const targetDir = path.resolve(options.target ?? process.cwd());
  const paths = workspacePaths(targetDir);
  let config = null;
  try {
    config = await loadConfig(await findProjectConfig(targetDir, options.config));
  } catch (error) {
    if (options.config) throw error;
  }
  const pkg = framework === "gsd" ? gsdPackageFromConfig(config) : null;
  const previousLock = await readLock(paths.lockPath);
  const source = options.package ?? options.source ?? pkg?.source;
  const packageOptions = pkg && source === pkg.source ? pkg : null;
  const runtimes = hasRuntimeOptions(options) ? parseRuntimes(options) : (pkg?.runtimes ?? parseRuntimes(options));
  const plan = planFrameworkInstall(framework, {
    package: packageOptions,
    source,
    namespace: pkg?.namespace,
    runtimes,
    global: Boolean(options.global),
    force: Boolean(options.force),
    previousLock
  });

  if (options.dryRun) {
    if (options.json) {
      printJson({ dryRun: true, network: false, commands: plan });
      return;
    }
    console.log("dry-run: no network or installer commands will run");
    for (const item of plan) console.log(item.skipped ? `skip: ${item.command} reason=${item.skipReason}` : item.command);
    return;
  }

  for (const item of plan) {
    if (item.skipped) {
      console.log(`skip: ${item.runtime} ${item.skipReason}`);
      continue;
    }
    console.log(`network-boundary: running ${item.command}`);
    console.log(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
    console.log("warning: this command may access the network and execute npm package code");
  }

  const attempts = executeFrameworkInstallPlan(plan);
  await writeLock(paths.lockPath, mergeFrameworkInstallAttempts(previousLock, attempts));
  for (const attempt of attempts) {
    console.log(`attempt: ${attempt.runtime} status=${attempt.status} exit=${attempt.exitStatus}`);
  }
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  if (failed.length > 0) {
    for (const attempt of failed) console.log(`retry: ${attempt.command}`);
    throw new Error(`Framework install failed for ${failed.map((attempt) => attempt.runtime).join(", ")}.`);
  }
}

async function installFromLockCommand(options) {
  const targetDir = path.resolve(options.target ?? process.cwd());
  const paths = workspacePaths(targetDir);
  const previousLock = await readLock(paths.lockPath);
  if (!previousLock) throw new Error(`No lock file found at ${paths.lockPath}.`);
  const plan = frameworkPlanFromLock(previousLock, { previousLock });
  if (plan.length === 0) throw new Error("No framework intent found in lock state.");

  if (options.dryRun) {
    if (options.json) {
      printJson({ dryRun: true, fromLock: true, network: false, commands: plan });
      return;
    }
    console.log("dry-run: no network or installer commands will run");
    for (const item of plan) console.log(item.command);
    return;
  }

  for (const item of plan) {
    console.log(`network-boundary: replaying ${item.command}`);
    console.log(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
    console.log("warning: this command may access the network and execute npm package code");
  }
  const attempts = executeFrameworkInstallPlan(plan);
  await writeLock(paths.lockPath, mergeFrameworkInstallAttempts(previousLock, attempts));
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  if (failed.length > 0) throw new Error(`Framework replay failed for ${failed.map((attempt) => attempt.runtime).join(", ")}.`);
}

function packageIntentFromOptions(options, rawConfig) {
  const source = options.source ?? (options.package ? `npm:${options.package}` : "npm:get-shit-done-cc@latest");
  return {
    id: "gsd",
    namespace: "gsd",
    source,
    runtimes: hasRuntimeOptions(options)
      ? parseRuntimes(options)
      : (Array.isArray(rawConfig.runtimes) && rawConfig.runtimes.length > 0 ? [...new Set(rawConfig.runtimes)] : supportedRuntimes())
  };
}

function packageForConfig(pkg) {
  return {
    id: pkg.id,
    namespace: pkg.namespace,
    source: pkg.source,
    runtimes: pkg.runtimes
  };
}

function packageSummaries(packages, lock) {
  const attempts = Array.isArray(lock?.frameworkInstallAttempts) ? lock.frameworkInstallAttempts : [];
  return packages.map((pkg) => ({
    id: pkg.id,
    namespace: pkg.namespace,
    source: pkg.source,
    sourceDescriptor: pkg.sourceDescriptor,
    runtimes: pkg.runtimes ?? [],
    installAttempts: attempts.filter((attempt) => attempt.framework === pkg.id)
  }));
}

function packageDiagnostics(raw) {
  const diagnostics = [];
  if (raw.packages !== undefined && !Array.isArray(raw.packages)) {
    return [{ severity: "error", path: "packages", message: "packages must be an array when provided." }];
  }

  for (const [index, pkg] of (Array.isArray(raw.packages) ? raw.packages : []).entries()) {
    try {
      normalizePackage(pkg, index);
    } catch (error) {
      const pathMatch = error.message.match(/^(packages\[\d+\](?:\.[A-Za-z0-9_]+)?)/);
      diagnostics.push({
        severity: "error",
        path: pathMatch?.[1] ?? `packages[${index}]`,
        message: error.message
      });
    }
  }
  return diagnostics;
}

async function interactiveInstallCommand(options) {
  throw new Error("Interactive project setup is being redesigned. Use `aof init`, `aof assets add ...`, and `aof assets add --global ...` for now.");
}

async function writeInstallLock(targetDir, items, runtimes, dbPath) {
  const lockPath = workspacePaths(targetDir).lockPath;
  const lock = {
    version: 1,
    generatedAt: new Date().toISOString(),
    catalog: dbPath,
    runtimes,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.source,
      runtimes: item.runtimes
    }))
  };

  await writeText(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function parseOptions(args) {
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

    if (["claude", "codex", "global", "local", "dryRun", "force", "select", "interactive", "noGuide", "noServe", "defaults", "json", "fromLock", "strict", "install", "verbose", "archived", "withOptional", "withHeadroom", "uninstall"].includes(key)) {
      options[key] = true;
      continue;
    }

    options[key] = inlineValue ?? args[++index];
  }

  return options;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function parseRuntimes(options) {
  const selected = [];
  if (options.claude) selected.push("claude");
  if (options.codex) selected.push("codex");

  if (options.runtime) {
    selected.push(...String(options.runtime).split(",").map((runtime) => runtime.trim()).filter(Boolean));
  }

  if (selected.length === 0) return supportedRuntimes();
  return [...new Set(selected)];
}

function hasRuntimeOptions(options) {
  return Boolean(options.claude || options.codex || options.runtime);
}

async function runtimesForApply(configPath, options) {
  if (hasRuntimeOptions(options)) return parseRuntimes(options);
  const raw = await readJson(configPath);
  if (Array.isArray(raw.runtimes) && raw.runtimes.length > 0) {
    return [...new Set(raw.runtimes)];
  }
  return supportedRuntimes();
}

function removedCommandError(command) {
  if (command === "catalog") {
    return new Error(`Removed command "catalog".\n\nCatalog is not currently supported. Project and global .aof assets are the active source model:\n  aof assets add skill\n  aof assets add --global skill\n  aof assets list --global`);
  }

  const replacements = {
    add: ["aof assets add skill", "aof assets add command", "aof assets add rule", "aof assets add agent"],
    apply: ["aof assets apply", "aof assets apply --dry-run"],
    sync: ["aof assets apply", "aof packages install"],
    clean: ["aof assets clean", "aof assets clean --dry-run"],
    global: ["aof assets add --global skill", "aof assets list --global", "aof assets use --global skill <id>"],
    install: ["aof assets ui", "aof packages add gsd", "aof packages install gsd", "aof packages install --from-lock"],
    migrate: ["aof project migrate"],
    validate: ["aof project validate", "aof assets validate", "aof packages validate"],
    doctor: ["aof project doctor"],
    config: ["aof project show", "aof project validate", "aof project doctor"]
  };
  return new Error(`Removed command "${command}".\n\nAOF now uses namespaced commands:\n${replacements[command].map((item) => `  ${item}`).join("\n")}`);
}

function formatApplyAction(item) {
  const parts = [
    `${item.action}: ${item.path}`,
    item.runtime ? `runtime=${item.runtime}` : null,
    item.resource ? `source=${item.resource.kind}:${item.resource.id}` : null,
    item.reason ? `reason=${item.reason}` : null
  ].filter(Boolean);
  return parts.join(" ");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function helpText() {
  return `aof - Agent Orchestration Framework

Usage:
  aof init [dir] [--claude] [--codex] [--runtime claude,codex] [--force] [--dry-run]

Project:
  aof project show [--json]
  aof project validate [--json] [--strict]
  aof project doctor [--json] [--strict]
  aof project migrate [dir] [--force] [--dry-run]

Assets:
  aof assets add skill|command|rule|agent [id] [--runtime claude,codex] [--description text] [--force]
  aof assets add --global skill|rule|agent [id] [--runtime claude,codex] [--description text] [--force]
  aof assets list [--global] [--json]
  aof assets show [--global] kind id [--json]
  aof assets remove kind id [--dry-run]
  aof assets use --global kind id
  aof assets unuse --global kind id
  aof assets apply [--config aof.config.json] [--target dir] [--claude] [--codex] [--dry-run] [--force] [--strict]
  aof assets validate [--global] [--json] [--strict]
  aof assets clean [--dry-run] [--force]
  aof assets ui [--port 4177] [--api-port 4178]

Packages:
  aof packages add gsd [--claude] [--codex] [--runtime claude,codex] [--source source]
  aof packages list [--json]
  aof packages show gsd [--json]
  aof packages remove gsd [--dry-run]
  aof packages validate [--json] [--strict]
  aof packages install [gsd] [--claude] [--codex] [--global] [--dry-run] [--force] [--json]
  aof packages install --from-lock [--dry-run] [--json]

Work (ACD work stream):
  aof work init [dir] [--dry-run] [--runtime claude,codex] [--force]   render the ACD bundle into a repo
  aof work update [dir] [--dry-run] [--force]   re-render the bundle, drift-checked against the install manifest
  aof work find <ref | query> [--json]   resolve a milestone (04), story (04/02), or slug (auth)
  aof work list [scope] [--json]         the whole stream (or a subtree); --json emits the flat-array board contract
  aof work memory <verb> [args] [--json]   recall/brief/ingest/reindex/status via the configured backend
  aof work validate [ref] [--json]       folder↔frontmatter, tag vocabulary, depends graph
  aof work next [range] [--json]         next actionable item in dependency order (drives autonomous)
  aof work board [--port]                serve the BUILT board (ui/dist) same-origin (api + terminal ws + static, one origin)
  aof planning init [dir] [--dry-run] [--with-optional] [--runtime claude|codex] [--force]   install the bought planner (pm-skills), record pinned-sha provenance

Defaults:
  init creates an empty project .aof workspace for the selected coding assistants.
  project commands inspect, validate, diagnose, and migrate the current repository's AOF workspace.
  assets apply renders source assets into the runtimes selected in .aof/aof.config.json unless runtime flags narrow the run.
  packages add records package intent only and never runs installer code.
  packages install prints a network/package-code boundary before executing installers.
  assets ui opens the project/global asset editor.
  --strict promotes adapter warnings to command failures for CI.
`;
}

function formatFriendlyApplyAction(item, options = {}) {
  const displayPath = relativeDisplayPath(item.path, options.targetDir);
  if (options.dryRun) {
    const verbs = {
      create: "Would create",
      update: "Would update",
      delete: "Would remove",
      skip: "Would keep",
      "drift-warning": "Warning"
    };
    const verb = verbs[item.action] ?? item.action;
    if (item.action === "drift-warning") return `drift-warning: ${displayPath} was modified; not overwriting`;
    return `${verb} ${displayPath}`;
  }

  const verbs = {
    create: "Created",
    update: "Updated",
    delete: "Removed",
    skip: "Kept",
    "drift-warning": "Warning"
  };
  if (item.action === "drift-warning") return `drift-warning: ${displayPath} was modified; not overwriting`;
  return `${successMarker()} ${verbs[item.action] ?? item.action} ${displayPath}`;
}

function successMarker() {
  if (process.stdout.isTTY) return "\u001b[32m\u2713\u001b[0m";
  return "\u2713";
}

function relativeDisplayPath(filePath, targetDir = process.cwd()) {
  const relativePath = path.isAbsolute(filePath) ? path.relative(targetDir, filePath) : filePath;
  return relativePath.replaceAll("\\", "/");
}

function printAdapterWarnings(warnings = []) {
  if (warnings.length === 0) return;
  console.log("adapter-warnings:");
  for (const warning of warnings) {
    const source = warning.kind && warning.id ? `${warning.kind}:${warning.id}` : warning.kind;
    const output = warning.generatedPath ? ` output=${warning.generatedPath}` : "";
    console.log(`- [${warning.code}] ${warning.path} runtime=${warning.runtime} source=${source}${output}`);
    console.log(`  reason: ${warning.reason}`);
    console.log(`  remediation: ${warning.remediation}`);
  }
}

function strictAdapterWarningsFailed(options, warnings = []) {
  if (!options.strict || warnings.length === 0) return false;
  console.log(`strict: ${warnings.length} adapter warning(s) treated as failure`);
  process.exitCode = 1;
  return true;
}

// Main-module guard. `bin/aof.mjs` is the canonical entry, and importers (tests,
// other modules) only ever call the exported `run`. But if this file is executed
// DIRECTLY (`node src/cli.mjs <args>`), the module would otherwise just define
// run() and exit 0 — a silent no-op that defeats `… || fallback` guards (the bad
// command "succeeds", so the fallback never fires). Mirror bin/aof.mjs here so a
// direct run actually dispatches. Importing never matches (argv[1] is the caller).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
