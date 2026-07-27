import path from "node:path";
import { access, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, loadProjectConfig } from "./dsl.mjs";
import { applyConfig, supportedRuntimes } from "./adapters.mjs";
import { executeFrameworkInstallPlan, frameworkPlanFromLock, gsdPackageFromConfig, installFramework, knownFrameworks, planFrameworkInstall } from "./frameworks.mjs";
import { mergeFrameworkInstallAttempts, readLock, writeLock } from "./lock.mjs";
import { createLockManifest, createRenderPlan, executeApplyActions, planApplyActions, summarizeLockManifest } from "./render-plan.mjs";
import { readJson, writeText, sweepStaleTempFiles } from "./fs.mjs";
import { normalizePackage } from "./packages.mjs";
import { writeWorkspaceConfig } from "./workspace-writer.mjs";
import { promptResourceInput, selectRuntimes } from "./prompt.mjs";
import { findProjectConfig, globalMeshPaths, globalWorkspacePaths, isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "./workspace.mjs";
import { collectAdapterWarnings } from "./adapter-warnings.mjs";
import { adapterWarningsForConfig, doctorConfig, inspectConfig, inspectGlobalConfig, validateConfig, validateGlobalConfig } from "./config-inspect.mjs";
import { addProjectGlobalRef, removeProjectGlobalRef } from "./config-editor.mjs";
import { loadWorkspace, findWork } from "./work.mjs";
import { invoke, getCommand } from "./command-core.mjs";
import { serveStdio } from "./graph-mcp-server.mjs";
import { initWork } from "./work-init.mjs";
import { updateWork } from "./work-update.mjs";
import { observeMilestone, observabilityEnabled } from "./work-observe.mjs";
import { workMemoryCommand } from "./work-memory.mjs";
import { useHeadroom, unuseHeadroom } from "./work-headroom.mjs";
import { selectOrchestratorModel, showOrchestratorModel } from "./work-orchestrator.mjs";
import { setDelegationCommand, setDelegationModelCommand, showDelegation } from "./work-delegation.mjs";
import { serveBoard } from "./board-serve.mjs";
import { serveMeshUi, DEFAULT_MESH_UI_PORT } from "./mesh-ui-serve.mjs";
// milestone 38 / story 06 — ADR-014 AMENDMENT (2026-07-19, closing BLOCKER
// F-38.06, option (a)): the fleet CONSUMER seam — a real relay subscription,
// wired as a LITERAL `startTerminalRelaySubscriber` key at the production
// `serveMeshUi({...})` call site below (meshUiCommand).
import { createTerminalMirrorSubscriberTransport, startTerminalMirrorSubscriber } from "./mesh-terminal-mirror.mjs";
import { publishRepoToMesh } from "./commands/mesh-repo.mjs";
import { assignWork, withdrawWork } from "./commands/mesh-assign.mjs";
import { recoverPush } from "./commands/mesh-recover-push.mjs";
// milestone 36 / story 03 (ADR-003) — the CLI-only `aof mesh desktop <install|run>`
// nested-verb sub-group (the mesh-repo.mjs/mesh-assign.mjs `← 1 cli.mjs` shape).
// Deliberately outside the mesh:* registry (see the meshCommand dispatch note below).
import { meshDesktopCommand } from "./commands/mesh-desktop.mjs";
// milestone 38 / story 00 (ADR-002) — `aof session start|ping|end`, the
// assistant-agnostic session-presence CLI seam. A CLI-only TOP-LEVEL command (the
// mesh-desktop.mjs nested-verb shape, but at the top level rather than under
// `mesh`) — NOT a registered mesh:* command (its stdin-JSON/env identity resolution
// doesn't fit meshVerbCli's single-positional shape).
import { meshSessionCommand } from "./commands/mesh-session.mjs";
// milestone 33 / story 01 (ADR-003) — the coordination-launcher serve seam:
// `aof mesh serve --serve` is a foreground per-node presence+sync daemon over
// src/mesh-launcher.mjs's startLauncher; the registered mesh:serve probe deliberately
// does NOT run it (command-core.mjs: the registered run is the non-blocking probe).
import { startLauncher } from "./mesh-launcher.mjs";
import { acquireMeshLauncherLock } from "./mesh-launcher-lock.mjs";
import { initPlanning } from "./planning-init.mjs";
// milestone 28 / story 00 (ADR-003/ADR-004): the ONE SEA-safe asset-base seam
// (the dev-only vite re-exec route) + the version string for `aof --version`
// (ADR-004's "node mode = everything else" — an argv branch of the SAME run()
// dispatch, never a fork ahead of it, mirroring the existing `help` branch).
import { assetBase, packageVersionString } from "./asset-base.mjs";
// TECH_DEBT item 1 — which code is this process actually running (source /
// payload / embedded + the install's build stamp)? Surfaced on --version and on
// every daemon startup line, so a stale build is VISIBLE rather than inferred.
import { readBuildInfo, buildInfoString } from "./build-info.mjs";
// m42 wave (a) / TECH_DEBT item 2 — the daemons' durable JSONL log sink (warnings
// tee beside the live stderr; startup records the build id).
import { createMeshLogSink } from "./mesh-log.mjs";

export async function run(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(helpText());
    return;
  }

  // milestone 28 / story 00 (ADR-004): node mode = "everything but mesh relay" —
  // --version is an argv branch of the SAME run() dispatch, exactly like help
  // above; NOT a registered command-core command and NOT a fork ahead of run().
  if (command === "--version" || command === "-v") {
    // "0.1.0 (source)" / "0.1.0 (payload b3319d6.20260726T134012)" — the semver
    // stays the line's prefix (the existing contract); the runtime-mode + build
    // stamp ride behind it (TECH_DEBT item 1's "the build is honest about itself").
    console.log(`${packageVersionString()} (${buildInfoString(readBuildInfo())})`.trim());
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

  if (command === "mesh") {
    await meshCommand(rest);
    return;
  }

  // milestone 38 / story 00 (ADR-002) — the additive `aof session start|ping|end`
  // top-level dispatch (the mesh-desktop.mjs CLI-only nested-verb precedent, but a
  // top-level sibling of `work`/`graph`/`mesh` since a session verb is fired from an
  // editor hook, not nested under a mesh sub-group).
  if (command === "session") {
    await meshSessionCommand(rest);
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

  // story 29 — reclaim the top-level `migrate` verb: convert a source folder INTO a
  // managed milestone under work.dir (the import contrast). A thin argv → invoke(
  // "migrate:folder") → render/--json face, mirroring importMilestoneCommandCli.
  if (command === "migrate") {
    await migrateCommand(rest);
    return;
  }

  // milestone 40 / story 02 — reclaim the top-level `upgrade` verb: run the
  // migration registry engine over the CURRENT work stream (the contrast with
  // `migrate`: migrate converts a FOREIGN folder in; upgrade advances the
  // stream's OWN items to this build's schema). A thin argv -> invoke(
  // "work:upgrade") -> render/--json face, mirroring migrateCommand exactly.
  // Also reachable as `aof work upgrade` (workCommand, below) — the SAME face.
  if (command === "upgrade") {
    await upgradeCommand(rest);
    return;
  }

  if (["add", "apply", "sync", "clean", "global", "install", "validate", "doctor", "config", "catalog"].includes(command)) {
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
    await projectMigrateCommand(rest);
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

  // `aof work observe <ref>` — a CLI-only diagnostic face (the mesh-desktop /
  // mesh-session idiom: deliberately OUTSIDE the work:* command registry, since it
  // reads Claude Code session transcripts rather than the work store). Mines
  // per-agent time/token spend + stall gaps for a milestone and (with --write)
  // drops an `observability/` folder into it. Not registry-registered => the
  // acd-work-command-cli-bijection guard (registry -> CLI) does not require it.
  if (subcommand === "observe") {
    await workObserveCommand(rest);
    return;
  }

  // milestone 41 / story 02 — the two additive insert-top-level dispatch
  // branches, ABOVE the unknown-subcommand fallthrough (the m19/m22 additive-verb
  // idiom). The EXACT `subcommand === "<sub>"` form the
  // acd-work-command-cli-bijection grep requires; both reuse the shared
  // workInsertCli face.
  if (subcommand === "insert-milestone") {
    await workInsertCli("work:insert-milestone", rest);
    return;
  }

  if (subcommand === "insert-uat") {
    await workInsertCli("work:insert-uat", rest);
    return;
  }

  // milestone 41 / story 03 — the nested-axis dispatch branch, same shape as
  // the two above (`--under NN` maps onto the engine's REQUIRED `parent`
  // selector at the shared workInsertCli face's argv adapter, ADR-006).
  if (subcommand === "insert-story") {
    await workInsertCli("work:insert-story", rest);
    return;
  }

  // milestone 39 / story 03 (gap-to-chore, ADR-001, feasibility flag 4) —
  // work:insert-chore joins the SAME insert-top-level dispatch family (the
  // shared workInsertCli face); work:promote-gap is its own thin verb but rides
  // the SAME face (same --json single-envelope discipline).
  if (subcommand === "insert-chore") {
    await workInsertCli("work:insert-chore", rest);
    return;
  }

  if (subcommand === "promote-gap") {
    await workInsertCli("work:promote-gap", rest);
    return;
  }

  // milestone 40 / story 02 — `aof work upgrade` is the SAME face as the
  // top-level `aof upgrade` verb above (both reach work:upgrade); nested here
  // so the registry-derived acd-work-command-cli-bijection guard (every
  // work:* command has a reachable `aof work <sub>` dispatch branch) stays
  // satisfied for work:upgrade's `work:` id.
  if (subcommand === "upgrade") {
    await upgradeCommand(rest);
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

  // `aof work continue <ref> [--node <id>]` — THE single continue door (2026-07-26).
  // Same shape as every other registry-backed verb; the command decides WHERE.
  if (subcommand === "continue") {
    await runVerbCli("work:continue", rest);
    return;
  }

  // m42 wave (b) — the one-door completion: `aof work refine <ref> [--node <id>]`
  // and `aof work verify <ref> [--node <id>]` are the SAME door (one factory, one
  // decision) with their own lifecycle phase.
  if (subcommand === "refine") {
    await runVerbCli("work:refine", rest);
    return;
  }
  if (subcommand === "verify") {
    await runVerbCli("work:verify", rest);
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

  if (subcommand === "run-start") {
    await workRunStartCommand(rest);
    return;
  }

  if (subcommand === "run-complete") {
    await workRunCompleteCommand(rest);
    return;
  }

  if (subcommand === "run-status") {
    await workRunStatusCommand(rest);
    return;
  }

  if (subcommand === "run-retry") {
    await workRunRetryCommand(rest);
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

  if (subcommand === "ui") {
    await workUiCommand(rest);
    return;
  }

  if (subcommand === "integrations") {
    await workIntegrationsCommand(rest);
    return;
  }

  if (subcommand === "orchestrator") {
    await workOrchestratorCommand(rest);
    return;
  }

  if (subcommand === "delegation") {
    await workDelegationCommand(rest);
    return;
  }

  if (subcommand === "delegation-model") {
    await workDelegationModelCommand(rest);
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

  throw new Error(`Unknown work command "${subcommand ?? ""}".\n\nExamples:\n  aof work init [dir] [--dry-run] [--runtime claude,codex] [--force] [--with-headroom]\n  aof work update [dir] [--dry-run] [--force]\n  aof work find 04\n  aof work find 04/02\n  aof work find auth --json\n  aof work list\n  aof work list 03\n  aof work list --json\n  aof work doc 04 SPEC\n  aof work tasks 04/02 --json\n  aof work feedback 04/02 --note "spec was thin" --actor qa\n  aof work run-start 19 [--session sess-1] [--brief '{"initiator":"operator"}'] [--json]\n  aof work run-complete 19 --outcome done|failed [--run <runId>] [--reason timeout] [--json]\n  aof work run-status 19 [--json]\n  aof work run-retry 19 [--run <runId>] [--max-attempts 3] [--json]\n  aof work memory recall "pin line endings"\n  aof work validate\n  aof work doctor [scope] [--json] [--strict]\n  aof work next 03-10\n  aof work ui [--port 4180]\n  aof work integrations notion sync-work 17 [--dry-run] [--json]\n  aof work orchestrator [fable|opus] [--show]\n  aof work delegation [on|off] [--model fable|opus] [--gpt-model <id>] [--no-model] [--show]\n  aof work delegation-model [<id>] [--show]\n  aof work use-headroom\n  aof work unuse-headroom\n  aof work insert-milestone "widget-support" --at 2 [--yes] [--json]\n  aof work insert-uat "release-gate" --at 1 [--depends 0,2] [--yes] [--json]\n  aof work insert-story "auth-guard" --at 1 --under 5 [--yes] [--json]\n  aof work insert-chore "tidy-config" --at 2 [--yes] [--json]\n  aof work promote-gap "warnings_delivered field" --discharge "a production path writes warnings_delivered" [--status open] [--at 2] [--yes] [--json]\n  aof work upgrade [--dry-run] [--json]`);
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

// `aof mesh <sub>` — the greenfield top-level mesh dispatch (a sibling to `aof work`
// / `aof graph`, ARCHITECTURE 22/ADR-001), reached from the top-level dispatch by the
// new `if (command === "mesh")` case. This is the SKELETON the spine (story 00) ships:
// it ROUTES ONLY — NO command logic, NO verb helper, NO workspace load, NO write. The
// "a node is just another thin face" premise (PRD §3) gets its structural teeth here
// before any mesh:* command lands; stories 01/02 each add ONE additive
// `if (subcommand === "<sub>") …; return;` dispatch branch above the unknown-sub
// rejection. The usage advertises NO behaviour beyond routing (identity/status/sync
// arrive with 01/02). The unknown-sub ladder mirrors graphCommand's
// console.error(usage) + process.exitCode = 1, and the --json single-structured
// envelope discipline (08/ADR-003): exactly ONE { ok:false, error, code } document on
// stdout naming the rejected sub. With zero verbs today, EVERY sub (including "" and a
// whitespace token) is unknown — the parseOptions positional carries "" / "   " as
// options._[0] distinct from `undefined` (no sub), so the matrix is distinguishable.
const MESH_USAGE = `aof mesh — the mesh node face (routing only; verbs arrive with later stories).\n\nUsage:\n  aof mesh            show this usage\n  aof mesh --json     the usage envelope as JSON`;

async function meshCommand(args) {
  const options = parseOptions(args);
  const sub = options._[0];

  // milestone 22 / story 01 — the two additive node-identity dispatch branches, ABOVE
  // the unknown-sub fallthrough (so identity/status leave the unknown-sub matrix). The
  // EXACT `subcommand === "<sub>"` form the acd-mesh-command-cli-bijection grep requires.
  // The args after the sub token are the verb's argv (the `const [sub, ...rest]` idiom
  // the import dispatcher uses).
  const subcommand = sub;
  const [, ...rest] = args;
  if (subcommand === "identity") {
    await meshVerbCli("mesh:identity", rest, { positionalAllowed: true });
    return;
  }
  if (subcommand === "status") {
    await meshVerbCli("mesh:status", rest, { positionalAllowed: false });
    return;
  }
  // milestone 23 / story 00 — the additive presence-publish dispatch branch, ABOVE the
  // unknown-sub fallthrough. The EXACT `subcommand === "heartbeat"` form the
  // acd-mesh-command-cli-bijection grep requires; reuses the shared meshVerbCli face.
  // mesh:heartbeat takes no positional (it publishes THIS node's presence, not a ref).
  if (subcommand === "heartbeat") {
    await meshVerbCli("mesh:heartbeat", rest, { positionalAllowed: false });
    return;
  }
  // milestone 23 / story 01 — the additive relay-mode dispatch branch, ABOVE the
  // unknown-sub fallthrough. The EXACT `subcommand === "relay"` form the
  // acd-mesh-command-cli-bijection grep requires; reuses the shared meshVerbCli face.
  // `aof mesh relay` is the relay-mode serve verb; its registered run is the NON-BLOCKING
  // status probe (so `aof mesh relay --json` runs clean + returns, never hanging on a
  // listen). mesh:relay takes no positional (the role is config-driven, not a named ref).
  if (subcommand === "relay") {
    await meshVerbCli("mesh:relay", rest, { positionalAllowed: false });
    return;
  }
  // milestone 24 / story 01 — the two additive device-code-enrollment dispatch
  // branches, ABOVE the unknown-sub fallthrough. The EXACT `subcommand === "<sub>"`
  // form the acd-mesh-command-cli-bijection grep requires; reuse the shared
  // meshVerbCli face. mesh:invite takes no positional (the control node MINTS — the
  // code is RETURNED once, never supplied); mesh:join takes ONE positional — the
  // presented 6-digit code the operator read off `aof mesh invite`.
  if (subcommand === "invite") {
    await meshVerbCli("mesh:invite", rest, { positionalAllowed: false });
    return;
  }
  if (subcommand === "join") {
    await meshVerbCli("mesh:join", rest, { positionalAllowed: true, extraFlags: ["control", "url"] });
    return;
  }
  // milestone 24 / story 02 — the additive revoke dispatch branch, ABOVE the unknown-sub
  // fallthrough. The EXACT `subcommand === "revoke"` form the acd-mesh-command-cli-bijection
  // grep requires; reuses the shared meshVerbCli face. mesh:revoke takes ONE positional —
  // the nodeId to revoke (the control node removes it from the roster + records a revocation).
  if (subcommand === "revoke") {
    await meshVerbCli("mesh:revoke", rest, { positionalAllowed: true });
    return;
  }
  // milestone 25 / story 02 (ADR-003) — the additive fleet-UI serve branch, ABOVE
  // the unknown-sub fallthrough (the m22 additive-branch idiom). `aof mesh ui` is a
  // CLI-ONLY serve verb (a sibling to `aof work ui`), NOT a registered mesh:*
  // command — it does NOT route through meshVerbCli and does NOT enter the mesh
  // bijection (ADR-002 §note). It stands up the OWN thin fleet serve-face
  // (src/mesh-ui-serve.mjs), reaching fleet data only through invoke("mesh:status").
  if (subcommand === "ui") {
    await meshUiCommand(rest);
    return;
  }
  // milestone 34 / story 06 (ADR-010) — the additive `aof mesh repo <verb>` sub-group,
  // ABOVE the unknown-sub fallthrough. Like `ui` and the `serve --serve` daemon it is a
  // CLI-ONLY nested verb, NOT a registered mesh:* command — so it is (correctly)
  // OUTSIDE the flat acd-mesh-command-cli-bijection (which maps registry mesh:* ids to
  // `subcommand === "<sub>"` branches; a nested `repo publish` has no flat registry id).
  if (subcommand === "repo") {
    await meshRepoCommand(rest);
    return;
  }
  // milestone 35 / story 00 (ADR-001/003/007) — the additive `aof mesh assign <ref>
  // --to <nodeId>` / `--withdraw` dispatch verb, ABOVE the unknown-sub fallthrough.
  // Like `repo`/`ui` it is a CLI-ONLY nested verb, NOT a registered mesh:* command
  // (the --to/--withdraw flags don't fit the single-positional meshVerbCli face) — so
  // it is (correctly) OUTSIDE the flat acd-mesh-command-cli-bijection.
  if (subcommand === "assign") {
    await meshAssignCommand(rest);
    return;
  }
  // VERIFICATION (live soak 2026-07-25) — the additive `aof mesh recover-push
  // <assignmentId>` control-driven recovery verb. A CLI-ONLY nested verb like
  // `assign`/`repo`/`ui` (its single-positional assignmentId + long poll don't fit the
  // meshVerbCli face), so it too is OUTSIDE the flat acd-mesh-command-cli-bijection.
  if (subcommand === "recover-push") {
    await meshRecoverPushCommand(rest);
    return;
  }
  // milestone 36 / story 03 (ADR-003) — the additive `aof mesh desktop <install|run>`
  // sub-group, ABOVE the unknown-sub fallthrough. Like `repo`/`ui`/`assign` it is a
  // CLI-ONLY nested verb, NOT a registered mesh:* command (the nested inner-verb face
  // doesn't fit the single-positional meshVerbCli shape) — so it is (correctly)
  // OUTSIDE the flat acd-mesh-command-cli-bijection (fitness acd-desktop-verbs-
  // outside-bijection). Routes the WHOLE `desktop` sub to the one new command
  // module (commands/mesh-desktop.mjs), which then dispatches on its own inner verb.
  if (subcommand === "desktop") {
    await meshDesktopCommand(rest);
    return;
  }
  // milestone 33 / story 01 (ADR-003) — the additive coordination-launcher dispatch
  // branch, ABOVE the unknown-sub fallthrough. The EXACT `subcommand === "serve"` form
  // the acd-mesh-command-cli-bijection grep requires; reuses the shared meshVerbCli
  // face for the bare (non-blocking probe) call. `aof mesh serve --serve` is the
  // FOREGROUND presence+sync daemon (the long-lived face over the one-shot core, NEVER
  // the bijection-probed run) — it preflights the fabric via probeFabric and
  // refuses-with-guidance if degraded, publishes this node's presence, runs global work propagation, and periodically
  // re-reads resolvePeers; it binds NO listening
  // broker socket. `aof mesh serve` (no --serve) stays the non-blocking probe.
  if (subcommand === "serve") {
    if (parseOptions(rest).serve) {
      await meshServeDaemonCommand(rest);
      return;
    }
    await meshVerbCli("mesh:serve", rest, { positionalAllowed: false });
    return;
  }

  // `aof mesh logs [proc] [--tail N]` — the durable-log reader (m42 wave (a),
  // TECH_DEBT item 2): read what a daemon logged without redirecting stdout by
  // hand. The optional positional is the proc (mesh-serve default).
  if (subcommand === "logs") {
    await meshVerbCli("mesh:logs", rest, { positionalAllowed: true, extraFlags: ["tail", "node"] });
    return;
  }

  // No sub: render the usage and exit 0 (recognised, not an error).
  if (sub === undefined) {
    if (options.json) {
      console.log(JSON.stringify({ ok: true, usage: MESH_USAGE.split("\n") }, null, 2));
      return;
    }
    console.log(MESH_USAGE);
    return;
  }

  // Any sub present (story 00 has ZERO verbs, so every sub — including "" and "   " —
  // is unknown): reject with ONE envelope naming the rejected sub, non-zero exit.
  if (options.json) {
    console.log(JSON.stringify({ ok: false, error: `Unknown mesh sub-command "${sub}".`, code: "unknown-subcommand" }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.error(`Unknown mesh sub-command "${sub}".\n\n${MESH_USAGE}`);
  process.exitCode = 1;
}

// The shared mesh-verb face (milestone 22 / story 01, ADR-001) — modelled on
// runVerbCli/graphVerbCommand: getCommand → loadWorkspace → invoke → cli.json/render,
// with the single-structured-envelope --json discipline (08/ADR-003). In --json mode a
// command error (or a face-level error this helper raises) is caught and emitted as ONE
// { ok:false, error, code } document on stdout (+ non-zero exit); the non-json face
// prints + exits non-zero. The FACE owns two errors the command itself does not raise:
//   - invalid-input : an unknown flag (only --json/--config are recognised), an
//                     empty-string id (`identity ""`), or a stray positional (`status
//                     umair-mbp` — status takes no id). Rejected, not silently ignored.
//   - node-not-found: a READ of an id with NO record in the tree (the absent-read on
//                     the READ path is a FACE error — distinct from the command-level
//                     absent null the mesh:identity run returns).
// opts.positionalAllowed: whether the sub accepts ONE id positional (identity yes,
// status no). The recognised flags on the mesh face are --json and --config; any other
// --flag is invalid-input, UNLESS named in opts.extraFlags.
async function meshVerbCli(id, args, { positionalAllowed = false, extraFlags = [] } = {}) {
  const command = getCommand(id);

  // Detect --json + an unknown flag from the RAW args, NOT from parseOptions's keys:
  // parseOptions consumes the token AFTER an unrecognised flag as its value, so an
  // unknown flag (`--bogus-flag --json`) would otherwise swallow `--json` and the
  // error would miss the JSON envelope. Scanning the raw flag tokens keeps --json
  // honoured AND reports the operator's original spelling.
  const flagTokens = args
    .filter((arg) => typeof arg === "string" && arg.startsWith("--"))
    .map((arg) => arg.slice(2).split("=", 2)[0]);
  const wantsJson = flagTokens.includes("json");
  // --workspace joins --json/--config as a face-wide flag (m42 item 4 — the
  // cwd-independent target selector every mesh verb accepts).
  const unknownFlag = flagTokens.find((flag) => flag !== "json" && flag !== "config" && flag !== "workspace" && !extraFlags.includes(flag));

  const options = parseOptions(args);
  // Force the resolved --json onto the parsed options so an unknown flag that
  // consumed the `--json` token still routes through the single-envelope face.
  if (wantsJson) options.json = true;

  // FACE input-validation (invalid-input), BEFORE any workspace load or invoke:
  //   (a) an unknown flag — only --json/--config are recognised on the mesh face;
  //   (b) a stray positional to a sub that takes no id (status);
  //   (c) an empty-string id (identity "" is not a readable id);
  //   (d) more than one positional.
  let inputError = null;
  if (unknownFlag) {
    inputError = `Unknown option "--${unknownFlag}".`;
  } else if (!positionalAllowed && options._.length > 0) {
    inputError = `"${id.slice("mesh:".length)}" takes no positional argument (got "${options._[0]}").`;
  } else if (positionalAllowed && options._.length > 1) {
    inputError = `"${id.slice("mesh:".length)}" takes at most one id (got ${options._.length}).`;
  } else if (positionalAllowed && options._.length === 1 && options._[0] === "") {
    inputError = `An empty id is not a readable node id.`;
  }
  if (inputError) {
    emitMeshError(options.json, inputError, "invalid-input");
    return;
  }

  // m42 wave (b) / item 4 — CWD-INDEPENDENT workspace resolution. Every mesh verb
  // used to resolve its workspace from process.cwd() alone, so a recovery command
  // run from the wrong directory silently operated on the WRONG workspace
  // (measured live: `aof mesh assign 18 --withdraw` reported "No assignment
  // exists" while the row sat in the store under another workspace's id).
  // `--workspace <path|id>` names the target explicitly: a path loads that
  // workspace; a bare id resolves its registered projectRoot through the global
  // descriptor store (the fleet's own registry) and refuses loudly when unknown —
  // never a silent fall-through to the cwd.
  let workspaceRoot = process.cwd();
  const requestedWorkspace = typeof options.workspace === "string" ? options.workspace.trim() : "";
  if (requestedWorkspace !== "") {
    if (existsSync(requestedWorkspace)) {
      workspaceRoot = requestedWorkspace;
    } else {
      const { openGlobalWorkProjectionStore } = await import("./global-work-store.mjs");
      let resolvedRoot = null;
      try {
        const store = await openGlobalWorkProjectionStore({});
        try {
          const row = store.db.prepare("SELECT project_root FROM global_workspace_descriptors WHERE workspace_id = ?").get(requestedWorkspace);
          resolvedRoot = row?.project_root ?? null;
        } finally {
          store.close?.();
        }
      } catch (error) {
        emitMeshError(options.json, `Could not resolve --workspace "${requestedWorkspace}": ${error.message}`, "workspace-unresolvable");
        return;
      }
      if (resolvedRoot == null) {
        emitMeshError(options.json, `Unknown workspace "${requestedWorkspace}" — not a path, and no registered workspace descriptor carries that id.`, "workspace-unknown");
        return;
      }
      workspaceRoot = resolvedRoot;
    }
  }
  const workspace = await loadWorkspace(workspaceRoot, options.config);
  const input = command.cli.argv(options._, options);

  if (options.json) {
    try {
      const result = await invoke(command.id, input, { workspace });
      // FACE read-miss split: a READ (a ref was supplied) that resolves to null is a
      // face-level node-not-found — the command returns null (not an error) by design.
      if (positionalAllowed && options._.length === 1 && result == null) {
        emitMeshError(true, `No node record for "${options._[0]}".`, "node-not-found");
        return;
      }
      console.log(JSON.stringify(command.cli.json(result), null, 2));
    } catch (error) {
      emitMeshError(true, error.message, error.code ?? "error");
    }
    return;
  }

  // Non-json: render; a read-miss is the same node-not-found face error (stderr +
  // non-zero exit); a command error propagates to bin/aof.mjs.
  const result = await invoke(command.id, input, { workspace });
  if (positionalAllowed && options._.length === 1 && result == null) {
    emitMeshError(false, `No node record for "${options._[0]}".`, "node-not-found");
    return;
  }
  console.log(command.cli.render(result));
}


// Emit a mesh face error: under --json ONE { ok:false, error, code } document on stdout
// (+ non-zero exit); otherwise the message on stderr (+ non-zero exit).
function emitMeshError(asJson, message, code) {
  if (asJson) {
    console.log(JSON.stringify({ ok: false, error: message, code }, null, 2));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
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

// `aof migrate <folder> [--dry-run] [--json]` — the thin face over the registered
// migrate:folder command (story 29). Mirrors importMilestoneCommandCli EXACTLY:
// parseOptions → getCommand("migrate:folder") → loadWorkspace → invoke →
// cli.render/cli.json. A missing <folder> throws the command's missing-folder usage
// error (propagated to bin/aof.mjs: stderr + non-zero exit); a nonexistent /
// unreadable path throws the distinct source-read error resolveImportSource raises.
// In --json mode a command error is emitted as a SINGLE structured envelope
// { ok:false, error, code } on stdout (+ non-zero exit), like the import/graph verbs.
async function migrateCommand(args) {
  const options = parseOptions(args);
  const command = getCommand("migrate:folder");
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

  // Non-json: render the result; a command error (missing-folder / nothing-
  // recoverable / source-read) propagates to bin/aof.mjs (stderr + non-zero exit).
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
  console.log(command.cli.render(result));
}

// `aof upgrade [--dry-run] [--json]` — the thin face over the registered
// work:upgrade command (milestone 40 / story 02, ADR-005). Mirrors
// migrateCommand EXACTLY: parseOptions → getCommand → loadWorkspace → invoke →
// cli.render/cli.json. Bare `aof upgrade` APPLIES; `--dry-run` PREVIEWS and
// writes nothing (the aof project migrate dry-run/apply face). In --json mode
// a command error (e.g. schema-newer-than-build) is emitted as a SINGLE
// structured envelope { ok:false, error, code } on stdout (+ non-zero exit),
// like the import/migrate/graph verbs. Also reachable as `aof work upgrade`
// (workCommand, above) — the SAME function, both routes reach the one command.
async function upgradeCommand(args) {
  const options = parseOptions(args);
  const command = getCommand("work:upgrade");
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

  // Non-json: render the result; a command error (schema-newer-than-build)
  // propagates to bin/aof.mjs (stderr + non-zero exit).
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

  if (verb === "associate") {
    await notionAssociateCli(rest);
    return;
  }

  console.error(
    `Unknown notion integration verb "${verb ?? ""}". Usage: aof work integrations notion <sync-work <milestone> [--dry-run] | associate <ref> --board <key|none> --parent <id|key|none>> [--json]`
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

// `aof work integrations notion associate <ref> --board <key|none> --parent <id|key|none> [--json]`
// — the thin face over the registered notion:associate command (18/ADR-004), routing
// through invoke (the registry door). Mirrors notionSyncWorkCli: getCommand →
// loadWorkspace → invoke → cli.json/render. A MISSING <ref>, or neither --board nor
// --parent, exits non-zero with a usage message BEFORE any workspace load (and writes
// nothing). In --json mode a command error is emitted as a SINGLE structured envelope
// { ok:false, error, code } on stdout (+ non-zero exit), like the sync-work verb.
async function notionAssociateCli(args) {
  const options = parseOptions(args);
  const command = getCommand("notion:associate");

  if (options._[0] == null || (options.board == null && options.parent == null)) {
    console.error(
      "Usage: aof work integrations notion associate <ref> --board <key|none> --parent <id|key|none> [--json]"
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

  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
  console.log(command.cli.render(result));
}

async function workUiCommand(args) {
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
  console.log("AOF work ui is running locally.");
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

// `aof mesh ui [--port 4181] [--local]` — the read-only fleet mission-control web
// surface (milestone 25 / story 02, ADR-003; milestone 34 / story 03, ADR-006). A
// CLI-ONLY serve verb (a sibling to `aof work ui`), NOT a registered mesh:*
// command. It stands up its OWN thin fleet serve-face (serveMeshUi) — one
// 127.0.0.1 server serving the ui/dist bundle with ?mode=fleet + the single
// GET /api/mesh/status route — and mirrors the board's ui-build-missing +
// EADDRINUSE friendly refusals (never a stack trace). Default port 4181 clears
// assets-ui 4177/4178 + board 4180, so the fleet view runs ON TOP of a board on
// one machine.
//
// milestone 34 / story 03 (ADR-006) — `aof mesh ui` is GLOBAL by default: it
// passes scope "global" to serveMeshUi and does NOT require the current
// directory to be a mesh-enabled workspace to start (serveMeshUi loads no
// workspace up front; the global read only opens the machine-wide projection
// store). `--local` passes scope "local" + this directory as projectDir — the
// pre-existing focused-workspace view, unchanged. The announced browser URL
// always names the selected scope (`?mode=fleet&scope=<global|local>`) so a
// bookmarked/shared link reproduces the same view. An unrecognized flag (e.g.
// `--workspace`) is rejected BEFORE serveMeshUi is ever called — the CLI's own
// input-validation guard, mirroring meshVerbCli's "Unknown option" phrasing.
const MESH_UI_FLAGS = new Set(["port", "local", "target"]);

async function meshUiCommand(args) {
  const flagTokens = args
    .filter((arg) => typeof arg === "string" && arg.startsWith("--"))
    .map((arg) => arg.slice(2).split("=", 2)[0])
    .map((flag) => flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
  const unknownFlag = flagTokens.find((flag) => !MESH_UI_FLAGS.has(flag));
  if (unknownFlag) {
    console.error(`Unknown option "--${unknownFlag}".`);
    process.exitCode = 1;
    return;
  }

  const options = parseOptions(args);
  const port = Number.parseInt(options.port ?? String(DEFAULT_MESH_UI_PORT), 10);
  const projectDir = path.resolve(options.target ?? process.cwd());
  const scope = options.local ? "local" : "global";

  // milestone 38 / story 06 — ADR-014 AMENDMENT: resolve `config` best-effort —
  // `aof mesh ui` requires NO mesh-enabled workspace to START (ADR-006's
  // existing global-by-default posture), so a `loadWorkspace` fault (cwd is not
  // a workspace at all, no aof.config.json, …) degrades to `config: undefined`
  // rather than refusing the command. `createTerminalMirrorSubscriberTransport`
  // already returns `null` for an undefined/unconfigured relay (no
  // `config.mesh.relay.url`), so `startTerminalMirrorSubscriber` cleanly
  // degrades to `{ connected:false }` — the mirror simply never receives a live
  // frame; every other route on the fleet face still serves.
  let config;
  try {
    ({ config } = await loadWorkspace(projectDir, options.config));
  } catch {
    config = undefined;
  }

  let session;
  try {
    session = await serveMeshUi({
      projectDir,
      port,
      scope,
      startTerminalRelaySubscriber: (mirror) => startTerminalMirrorSubscriber({ transport: createTerminalMirrorSubscriberTransport(config), mirror }),
    });
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

  const { server, fleetUrl } = session;
  console.log("AOF mesh ui is running locally.");
  // TECH_DEBT item 1 — the daemon's startup line records which build it runs
  // (a SECOND line: the announce line above is a pinned contract).
  console.log(`Build: ${buildInfoString(readBuildInfo())}`);
  // m42 wave (a) / item 2 — the ui daemon's durable startup record (same sink family
  // as mesh-serve's; the fleet server's own faults land via its error paths below).
  const uiLogSink = createMeshLogSink("mesh-ui", { env: process.env });
  uiLogSink.write({ level: "info", code: "daemon-started", message: `mesh ui running (build ${buildInfoString(readBuildInfo())})` });
  console.log(`Open this URL in your browser: ${fleetUrl}&scope=${scope}`);
  console.log(`Project: ${projectDir}`);
  console.log("Press Ctrl+C to stop the fleet view.");

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

// `aof mesh repo <verb>` — the per-repo mesh membership sub-group (milestone 34 / story
// 06, ADR-010). Today the ONE verb is `publish`: it writes the local per-repo published
// marker into .aof/aof.config.json AND publishes a snapshot into the machine-wide global
// store now (src/commands/mesh-repo.mjs's publishRepoToMesh). CLI-only (see the dispatch
// branch note). A failed snapshot is a non-fatal warning (the marker still lands);
// only a real fault is a non-zero mesh-face error.
const MESH_REPO_FLAGS = new Set(["json", "config"]);

async function meshRepoCommand(args) {
  const verb = typeof args[0] === "string" && !args[0].startsWith("--") ? args[0] : undefined;
  const rest = verb === undefined ? args : args.slice(1);

  const flagTokens = rest
    .filter((arg) => typeof arg === "string" && arg.startsWith("--"))
    .map((arg) => arg.slice(2).split("=", 2)[0]);
  const wantsJson = flagTokens.includes("json");
  const unknownFlag = flagTokens.find((flag) => !MESH_REPO_FLAGS.has(flag));
  const options = parseOptions(rest);
  if (wantsJson) options.json = true;

  if (unknownFlag) {
    emitMeshError(options.json, `Unknown option "--${unknownFlag}".`, "invalid-input");
    return;
  }
  if (verb === undefined) {
    emitMeshError(options.json, "`aof mesh repo` needs a verb.\n\nUsage:\n  aof mesh repo publish   publish this repo into the mesh", "invalid-input");
    return;
  }
  if (verb !== "publish") {
    emitMeshError(options.json, `Unknown mesh repo verb "${verb}".`, "unknown-subcommand");
    return;
  }
  if (options._.length > 0) {
    emitMeshError(options.json, `"repo publish" takes no positional argument (got "${options._[0]}").`, "invalid-input");
    return;
  }

  let result;
  try {
    const workspace = await loadWorkspace(process.cwd(), options.config);
    result = await publishRepoToMesh(workspace, {});
  } catch (error) {
    emitMeshError(options.json, error.message, error.code ?? "error");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  const lines = [
    `Published ${result.projectRoot} into the mesh as workspace ${result.workspaceId}.`,
    `Marked as a mesh repo in ${result.configPath}.`,
  ];
  lines.push(
    result.cloneUrl
      ? `Clone URL: ${result.cloneUrl}`
      : "Clone URL: none configured and none detected from `git remote get-url origin` — a worker clone-miss for this workspace will fail loud (assignment-repo-unavailable) until one is set.",
  );
  if (!result.published && result.warning) {
    lines.push(`warning: the snapshot did not land (${result.warning.code}): ${result.warning.message}`);
  } else {
    lines.push("Snapshot written to the global mesh store.");
  }
  console.log(lines.join("\n"));
}

// `aof mesh assign <ref> --to <nodeId>` / `--withdraw` — the operator dispatch verb
// (milestone 35 / story 00, ADR-001/003/007). CLI-only (see the dispatch branch
// note); core kept in commands/mesh-assign.mjs so it is unit-testable without
// spawning the CLI. One `--json` envelope: `{ ok:true, …record }` on a clean mint/
// withdraw, `{ ok:false, error, code }` on any coded refusal — never a second shape.
const MESH_ASSIGN_FLAGS = new Set(["json", "config", "to", "withdraw"]);

async function meshAssignCommand(args) {
  const flagTokens = args
    .filter((arg) => typeof arg === "string" && arg.startsWith("--"))
    .map((arg) => arg.slice(2).split("=", 2)[0]);
  const wantsJson = flagTokens.includes("json");
  const unknownFlag = flagTokens.find((flag) => !MESH_ASSIGN_FLAGS.has(flag));
  const options = parseOptions(args);
  if (wantsJson) options.json = true;

  if (unknownFlag) {
    emitMeshError(options.json, `Unknown option "--${unknownFlag}".`, "invalid-input");
    return;
  }

  const ref = options._[0];
  if (typeof ref !== "string" || ref.length === 0) {
    emitMeshError(
      options.json,
      "`aof mesh assign` needs a work ref.\n\nUsage:\n  aof mesh assign <ref> --to <nodeId>   assign a work item to a node\n  aof mesh assign <ref> --withdraw      withdraw the active assignment",
      "invalid-input",
    );
    return;
  }
  if (options._.length > 1) {
    emitMeshError(options.json, `"mesh assign" takes exactly one positional ref (got "${options._[1]}").`, "invalid-input");
    return;
  }
  if (options.withdraw && options.to) {
    emitMeshError(options.json, `"mesh assign" takes either --to <nodeId> or --withdraw, not both.`, "invalid-input");
    return;
  }
  if (!options.withdraw && (typeof options.to !== "string" || options.to.length === 0)) {
    emitMeshError(options.json, "`aof mesh assign <ref>` needs --to <nodeId> (or --withdraw).", "invalid-input");
    return;
  }

  let workspace;
  try {
    workspace = await loadWorkspace(process.cwd(), options.config);
  } catch (error) {
    emitMeshError(options.json, error.message, error.code ?? "error");
    return;
  }

  if (options.withdraw) {
    let result;
    try {
      result = await withdrawWork(workspace, ref, {});
    } catch (error) {
      emitMeshError(options.json, error.message, error.code ?? "error");
      return;
    }
    if (!result.ok) {
      emitMeshError(options.json, result.error, result.code);
      return;
    }
    if (options.json) {
      console.log(JSON.stringify({ ok: true, assignment: result.assignment }, null, 2));
      return;
    }
    console.log(
      result.assignment == null
        ? `No assignment exists for "${ref}"; nothing to withdraw.`
        : `Withdrew the assignment for "${ref}" (assignmentId ${result.assignment.assignmentId}).`,
    );
    return;
  }

  let result;
  try {
    result = await assignWork(workspace, ref, options.to, {});
  } catch (error) {
    emitMeshError(options.json, error.message, error.code ?? "error");
    return;
  }
  if (!result.ok) {
    emitMeshError(options.json, result.error, result.code);
    return;
  }
  if (options.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  console.log(`Assigned "${ref}" to "${result.targetNodeId}" (assignmentId ${result.assignmentId}).`);
}

// `aof mesh recover-push <assignmentId>` — the control-driven recovery verb
// (VERIFICATION, live two-machine soak 2026-07-25). Run on the CONTROL node to push a
// stalled/terminal assignment's stranded worktree home. CLI-only (see the dispatch
// branch note); core kept in commands/mesh-recover-push.mjs so it is unit-testable
// without spawning the CLI. One `--json` envelope: `{ ok, code, ... }` — the SAME
// single-shape discipline meshAssignCommand keeps. The target worker is determined
// ENTIRELY by the assignment record (its own target_node_id), so the operator supplies
// only the assignmentId; the command then blocks (polling the request row) until the
// daemon+worker settle it pushed/failed, or reports it still-pending on timeout.
const MESH_RECOVER_PUSH_FLAGS = new Set(["json"]);

async function meshRecoverPushCommand(args) {
  const flagTokens = args
    .filter((arg) => typeof arg === "string" && arg.startsWith("--"))
    .map((arg) => arg.slice(2).split("=", 2)[0]);
  const wantsJson = flagTokens.includes("json");
  const unknownFlag = flagTokens.find((flag) => !MESH_RECOVER_PUSH_FLAGS.has(flag));
  const options = parseOptions(args);
  if (wantsJson) options.json = true;

  if (unknownFlag) {
    emitMeshError(options.json, `Unknown option "--${unknownFlag}".`, "invalid-input");
    return;
  }

  const assignmentId = options._[0];
  if (typeof assignmentId !== "string" || assignmentId.length === 0) {
    emitMeshError(
      options.json,
      "`aof mesh recover-push` needs an assignmentId.\n\nUsage:\n  aof mesh recover-push <assignmentId>   commit + push a stalled assignment's stranded worktree home",
      "invalid-input",
    );
    return;
  }
  if (options._.length > 1) {
    emitMeshError(options.json, `"mesh recover-push" takes exactly one positional assignmentId (got "${options._[1]}").`, "invalid-input");
    return;
  }

  if (!options.json) {
    console.log(`Requesting recovery push for assignment "${assignmentId}" — minting a write credential and dispatching to its worker…`);
  }

  let result;
  try {
    result = await recoverPush(assignmentId, {});
  } catch (error) {
    emitMeshError(options.json, error.message, error.code ?? "error");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    emitMeshError(options.json, result.error ?? `Recovery push ${result.code}${result.detail ? ` (${result.detail})` : ""}.`, result.code);
    return;
  }
  console.log(`Pushed "${result.itemRef}" home from "${result.targetNodeId}" (assignment ${result.assignmentId}${result.detail ? `, ${result.detail}` : ""}).`);
}

// `aof mesh serve --serve` — the FOREGROUND presence+sync daemon (milestone 33 / story
// 01, ADR-003.1/.3): the long-lived `--serve` face over the one-shot launcher core
// (src/mesh-launcher.mjs's startLauncher). Preflights the fabric and refuses-with-
// guidance if degraded (never starting a loop over a dead fabric); a healthy preflight
// publishes this node's presence, starts global work propagation, and
// periodically re-reads the fabric peer-map — binding NO listening broker socket (the
// "bind" is the fabric self-address). Traps SIGINT/SIGTERM to stop cleanly.
async function meshServeDaemonCommand(args) {
  const options = parseOptions(args);
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const launcherLock = await acquireMeshLauncherLock({ env: process.env });
  if (!launcherLock.acquired) {
    const pid = launcherLock.pid != null ? ` (pid ${launcherLock.pid})` : "";
    console.error(`AOF mesh launcher is already running${pid}.`);
    process.exitCode = 1;
    return;
  }

  let handle = null;
  // m42 wave (a) / TECH_DEBT item 2 — the durable sink. Warnings TEE here beside the
  // live stderr line (a supervised daemon's stderr goes nowhere; this file is the
  // record). Startup/shutdown are logged too, with the build id, so "which build ran
  // when" is answerable from the file alone.
  const logSink = createMeshLogSink("mesh-serve", { env: process.env });
  // m42 / item 2's REMOTE read — a worker forwards each log event UP its stream so
  // the control's `aof mesh logs --node <id>` answers from its own store. Wired
  // after startLauncher returns (the client exists then); a forward fault is
  // already failure-isolated inside sendLogEntries.
  let forwardLogEntry = null;
  try {
    // review fix (live soak, 2026-07-17): a connect failure, propagation fault, or
    // dispatch-tick error used to be accumulated into handle.warnings and never read
    // again by this foreground loop — the daemon's own log showed nothing regardless
    // of what actually went wrong. Every warning now prints live, timestamped, as it
    // happens.
    handle = await startLauncher(workspace, {
      onWarning: (warning) => {
        console.error(`[mesh ${new Date().toISOString()}] ${warning.code}: ${warning.message}`);
        // 2026-07-27 — an event may carry its OWN level (the dispatch/worktree
        // DECISION records are info, not warn); anything level-less stays warn.
        const entry = { at: new Date().toISOString(), level: warning.level ?? "warn", code: warning.code ?? "warning", message: warning.message ?? "", path: warning.path ?? null };
        logSink.write(entry);
        forwardLogEntry?.(entry);
      },
    });
    if (handle.refused) {
      console.error(`The fabric is not ready to serve (${handle.probe.reason ?? "degraded"}):`);
      for (const line of handle.guidance.lines) console.error(`  ${line}`);
      process.exitCode = 1;
      return;
    }

    console.log(`AOF mesh launcher is running (node ${handle.record.nodeId}).`);
    // TECH_DEBT item 1 — same second-line build report as mesh ui's.
    console.log(`Build: ${buildInfoString(readBuildInfo())}`);
    console.log(`Self-address: ${handle.selfAddress ?? "(unresolved)"}`);
    console.log(`Log: ${logSink.path}`);
    console.log("Press Ctrl+C to stop the launcher.");
    logSink.write({ level: "info", code: "daemon-started", message: `mesh serve running (node ${handle.record.nodeId}, build ${buildInfoString(readBuildInfo())})`, node: handle.record.nodeId });
    if (handle.streamClient != null && typeof handle.streamClient.sendLogEntries === "function") {
      const client = handle.streamClient;
      forwardLogEntry = (entry) => {
        void client.sendLogEntries([entry]);
      };
      forwardLogEntry({ at: new Date().toISOString(), level: "info", code: "daemon-started", message: `mesh serve running (node ${handle.record.nodeId}, build ${buildInfoString(readBuildInfo())})`, path: null });
    }
    // m38-F26 (m42 wave (a)) — reclaim .tmp-* orphans a crashed publisher left in
    // the presence/nodes stores (age-gated; a live writer's temp is never touched).
    for (const dir of [path.join(globalMeshPaths({ env: process.env }).meshRoot, "presence"), globalMeshPaths({ env: process.env }).nodesRoot]) {
      const swept = await sweepStaleTempFiles(dir);
      if (swept.removed.length > 0) {
        logSink.write({ level: "info", code: "temp-orphans-swept", message: `reclaimed ${swept.removed.length} stale .tmp-* file(s) in ${dir}` });
      }
    }

    await new Promise((resolve) => {
      const shutdown = () => {
        handle.stop();
        resolve();
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  } finally {
    await launcherLock.release();
  }
}
// `aof work orchestrator [model] [dir] [--show]` — set the model the main ACD
// (orchestrating) session runs on. Config-only read-merge-write of
// settings.claude.model in .aof/aof.config.json (never the lock); the render engine
// projects it into .claude/settings.json. With no model arg it prompts Fable 5 vs
// Opus 4.8; `--show` reports the current value without mutating.
async function workOrchestratorCommand(args) {
  const options = parseOptions(args);
  const positionals = options._ ?? [];
  const targetDir = path.resolve(options.dir ?? options.target ?? (positionals.length > 1 ? positionals[1] : process.cwd()));

  if (options.show) {
    await showOrchestratorModel({ targetDir });
    return;
  }

  const model = options.model ?? positionals[0];
  await selectOrchestratorModel({ targetDir, model });
}

// `aof work delegation [on|off] [dir] [--model fable|opus] [--no-model] [--show]` —
// flip whether gpt-5.6 (via Codex) is in play, then pick the orchestrator model.
// Writes work.agents.delegation (never the lock) and re-renders so the codex-*
// skills follow the toggle: off ⇒ disable-model-invocation present (won't auto-fire),
// on ⇒ dropped (auto-invocable). Default off ≡ Claude-only. After setting the toggle
// it prompts Fable 5 vs Opus 4.8 (skip with --no-model).
async function workDelegationCommand(args) {
  const options = parseOptions(args);
  const positionals = options._ ?? [];
  const targetDir = path.resolve(options.dir ?? options.target ?? (positionals.length > 1 ? positionals[1] : process.cwd()));
  const gptModel = options.gptModel;

  if (options.show || (positionals.length === 0 && options.state === undefined && gptModel === undefined)) {
    await showDelegation({ targetDir });
    return;
  }

  // The on/off toggle is optional here — `--gpt-model <id>` alone sets only the Codex
  // delegation model (the convenience twin of `aof work delegation-model`). When a
  // state IS given, flip it first, then apply any model change, then re-render once.
  const state = options.state ?? positionals[0];
  if (state !== undefined) {
    await setDelegationCommand({ targetDir, state });
  }
  if (gptModel !== undefined) {
    await setDelegationModelCommand({ targetDir, model: gptModel });
  }

  // Re-render so the changes take effect on the installed codex-* skills — the toggle
  // drives their `disable-model-invocation` (off ⇒ present/blocked, on ⇒ dropped/auto-
  // invocable) and the model is baked into every `{{delegationModel}}` recipe. Uses the
  // SAME update path (force re-render), which also keeps the lock consistent. If the
  // project isn't init'd yet, the config is written and `aof work init` will honour it.
  const update = await updateWork({ targetDir, force: true });
  if (update.notInitialized) {
    console.log("Config written. This project isn't ACD-initialised yet — run `aof work init` and it will be applied.");
  } else {
    console.log("Re-rendered the codex-* skills to match the config. Reload your Claude Code session so it picks up the change.");
  }

  // A model-only invocation (`--gpt-model` with no on/off) is done — don't touch the
  // orchestrator model.
  if (state === undefined) {
    return;
  }

  // After flipping delegation, also pick the orchestrator (main-session) model —
  // Fable 5 or Opus 4.8 — so the two model decisions are made together. `--no-model`
  // skips it; `--model fable|opus` sets it without a prompt; otherwise prompt when
  // interactive (or the AOF_ORCHESTRATOR_INPUT test seam is set), and on a
  // non-interactive run with no --model just print a hint rather than hang.
  if (options.noModel) {
    console.log("Orchestrator model left unchanged. Set it anytime with `aof work orchestrator fable|opus`.");
    return;
  }
  const model = options.model;
  const canPrompt = process.stdin.isTTY || process.env.AOF_ORCHESTRATOR_INPUT !== undefined;
  if (model !== undefined || canPrompt) {
    await selectOrchestratorModel({ targetDir, model });
  } else {
    console.log("Orchestrator model left unchanged. Choose one with `aof work orchestrator fable|opus`, or re-run with `--model fable|opus`.");
  }
}

// `aof work delegation-model [<id>] [dir] [--show]` — get or set the Codex delegation
// model (config-only; never the lock), the moving variable the codex-* skills and ACD
// agents target. No id (or --show) reports the current model; an id writes
// work.agents.delegationModel and re-renders so the baked `{{delegationModel}}` recipes
// pick up the new model. Distinct from `--model fable|opus` (the orchestrator/Claude side).
async function workDelegationModelCommand(args) {
  const options = parseOptions(args);
  const positionals = options._ ?? [];
  const targetDir = path.resolve(options.dir ?? options.target ?? (positionals.length > 1 ? positionals[1] : process.cwd()));

  if (options.show || positionals.length === 0) {
    await showDelegation({ targetDir });
    return;
  }

  await setDelegationModelCommand({ targetDir, model: positionals[0] });

  // Re-render so the new model is baked into the installed codex-* skills and agents
  // (the `{{delegationModel}}` substitution runs on the same force-update path the toggle
  // uses). If the project isn't init'd yet, the config is written and init will honour it.
  const update = await updateWork({ targetDir, force: true });
  if (update.notInitialized) {
    console.log("Config written. This project isn't ACD-initialised yet — run `aof work init` and the model will be applied.");
  } else {
    console.log("Re-rendered the codex-* skills to target the new model. Reload your Claude Code session so it picks up the change.");
  }
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

  throw new Error(`Unknown planning command "${subcommand ?? ""}".\n\nExamples:\n  aof planning init [dir] [--dry-run] [--with-optional] [--runtime claude|codex] [--scope user|project|local] [--force]`);
}

async function planningInitCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options._[0] ?? process.cwd());
  const runtime = options.runtime ?? "claude";

  if (!["claude", "codex"].includes(runtime)) {
    throw new Error(`Unsupported runtime "${runtime}". Expected one of: claude, codex.`);
  }

  // ADR-010: declarations default to project scope (the repo's .claude/settings.json)
  // so the planner travels with the repo, not the user's global settings.
  const scope = options.scope ?? "project";
  if (!["user", "project", "local"].includes(scope)) {
    throw new Error(`Unsupported scope "${scope}". Expected one of: user, project, local.`);
  }

  const result = await initPlanning({
    targetDir,
    runtime,
    scope,
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

// `aof work observe <ref> [--write] [--json] [--stall <min>]` — mine Claude Code
// session transcripts for the milestone's per-agent time/token spend + stall gaps.
// A READ by default; `--write` drops `wiki/work/<folder>/observability/{report.md,
// agents.json}` into the milestone. The config opt-in (`work.observability.enabled`)
// gates AUTOMATIC generation by the lifecycle — an explicit invocation here always
// runs (an operator asked for it directly).
async function workObserveCommand(args) {
  const options = parseOptions(args);
  const ref = options._[0];
  if (!ref) {
    throw new Error('Usage: aof work observe <milestone-ref> [--write] [--json] [--stall <minutes>] [--if-enabled]');
  }
  // `--if-enabled` self-gates on the opt-in config flag (work.observability.enabled)
  // and no-ops when off. This is the form the lifecycle (aof:retrospective) calls, so
  // the bundle instruction can invoke observe unconditionally and the CLI decides —
  // deterministic, rather than asking the agent to branch on config. A DIRECT
  // `aof work observe` (no --if-enabled) always runs: an operator asked for it.
  if (options.ifEnabled) {
    const workspace = await loadWorkspace(process.cwd(), options.config);
    if (!observabilityEnabled(workspace.config)) {
      if (!options.json) console.log("observability disabled (set work.observability.enabled to enable) — skipped.");
      return;
    }
  }
  const stallMs = options.stall != null ? Number(options.stall) * 60 * 1000 : undefined;
  const result = await observeMilestone({
    cwd: process.cwd(),
    ref,
    stallMs,
    // Stamp with the caller's wall clock (Date.now is fine in the CLI process).
    generatedAt: Date.now(),
    write: Boolean(options.write),
  });

  if (options.json) {
    console.log(JSON.stringify(result.json, null, 2));
  } else {
    console.log(result.report);
    if (!result.found) {
      console.log(`\n(no Claude Code transcripts found under ${result.projectsDir})`);
    }
    if (result.written) {
      console.log(`\nWrote ${path.relative(process.cwd(), result.written.reportPath)} + agents.json`);
    }
  }
}

// The shared insert-top-level face (milestone 41 / story 02, ADR-002/004) —
// getCommand -> loadWorkspace -> invoke -> cli.json/render, mirroring
// projectProvisionCli's single-structured-envelope --json discipline. ADR-004's
// never-deadlock guard: an above-threshold caller without --yes is a command
// error (code "insert-confirm-required"), caught here and emitted as ONE
// { ok:false, error, code, shifted } envelope (+ non-zero exit) in --json mode —
// never a hang on an unanswered prompt. The non-json face lets the error
// propagate to bin/aof.mjs (stderr + non-zero exit).
async function workInsertCli(id, args) {
  const options = parseOptions(args);
  const command = getCommand(id);
  const workspace = await loadWorkspace(process.cwd(), options.config);
  const input = command.cli.argv(options._, options);

  if (options.json) {
    try {
      const result = await invoke(command.id, input, { workspace });
      console.log(JSON.stringify(command.cli.json(result), null, 2));
    } catch (error) {
      console.log(
        JSON.stringify({ ok: false, error: error.message, code: error.code ?? "error", shifted: error.shifted ?? null }, null, 2),
      );
      process.exitCode = 1;
    }
    return;
  }

  const result = await invoke(command.id, input, { workspace });
  console.log(command.cli.render(result));
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

// `aof work run-start <ref> [--session …] [--brief '<json>'] [--json]` — a thin
// argv → invoke("work:run-start") → render/--json face over the registered command
// (ADR-003). A WRITE: resolveItemExact rejects a non-exact ref with ref-not-found.
// The --json face mirrors projectProvisionCli: it emits EXACTLY ONE structured
// envelope on stdout (success command.cli.json(result), OR { ok:false, error, code }
// + non-zero exit) — the CLI error matrix (01_cli-face.feature) requires the failure
// to surface as a structured JSON document on stdout, not on stderr.
async function workRunStartCommand(args) {
  await runVerbCli("work:run-start", args);
}

// `aof work run-complete <ref> --outcome done|failed|cancelled [--run <runId>]
//  [--json]` — the terminal-transition WRITE, same single-envelope --json discipline.
// invalid-outcome (a --outcome outside the closed set, including ""), ref-not-found
// (a non-exact ref), no-running-run / ambiguous-run / illegal-transition all surface
// as the structured { ok:false, error, code } envelope under --json.
async function workRunCompleteCommand(args) {
  await runVerbCli("work:run-complete", args);
}

// `aof work run-status <ref> [--json]` — the observability READ over work:run-status
// (resolveItem slug-fallback tolerated). An item with no runs is the empty history,
// not an error; an unresolved ref surfaces ref-not-found through the same envelope.
async function workRunStatusCommand(args) {
  await runVerbCli("work:run-status", args);
}

// `aof work run-retry <ref> [--run <runId>] [--max-attempts N] [--json]` — the
// resume WRITE over work:run-retry (20/ADR-003). resolveItemExact rejects a non-exact
// ref. Same single-envelope --json discipline: the store's coded rejections
// (not-retryable / attempts-exhausted / no-retryable-run / duplicate-run) surface as
// the structured { ok:false, error, code } envelope on stdout (+ non-zero exit).
async function workRunRetryCommand(args) {
  await runVerbCli("work:run-retry", args);
}

// The shared run-verb face: getCommand → loadWorkspace → invoke → cli.json/render,
// with the projectProvisionCli single-envelope --json discipline. In --json mode a
// command error is caught and emitted as ONE structured JSON envelope on stdout
// (+ non-zero exit), so every `aof work run-* … --json` prints exactly one parseable
// JSON document (success OR structured error). The non-json face lets the error
// propagate to bin/aof.mjs (stderr + non-zero exit).
async function runVerbCli(id, args) {
  const options = parseOptions(args);
  const command = getCommand(id);
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

  // Non-json: render the result; a command error propagates to bin/aof.mjs
  // (stderr + non-zero exit).
  const result = await invoke(command.id, command.cli.argv(options._, options), { workspace });
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

// `aof project migrate [dir]` — the LEGACY config-format migration (root
// aof.config.json → .aof/aof.config.json). Renamed from `migrateCommand` when the
// top-level `migrate` verb was reclaimed for folder→managed-milestone migration
// (story 29); this is the project-config migrator, reached only via `project migrate`.
async function projectMigrateCommand(args) {
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

// DEV-ONLY: the vite UI dev server re-exec (RESEARCH §0; ADR-003 allow-list).
// Never on the shipped path — a SEA never runs vite. Re-homed onto the ONE
// asset-base seam for correctness (the same repoRoot-derivation every other
// site used), but allow-listed from the "must serve packaged assets" assertion
// (acd-sea-safe-asset-base fitness #1) since this line never executes in a SEA.
function startSetupUiFrontend(port, apiUrl = "http://127.0.0.1:4178") {
  // "version" resolves to the repo root in dev (the same base package.json/
  // work-bundle-manifest.mjs read); it never runs under a SEA (dev-only path).
  const repoRoot = assetBase("version");
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

    if (["claude", "codex", "global", "local", "dryRun", "force", "select", "interactive", "noGuide", "noServe", "defaults", "json", "fromLock", "strict", "install", "verbose", "archived", "withOptional", "withHeadroom", "uninstall", "withdraw", "serve", "yes", "changelog", "write", "ifEnabled", "show", "noModel"].includes(key)) {
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
  aof work ui [--port]                   serve the BUILT board (ui/dist) same-origin (api + terminal ws + static, one origin)
  aof migrate <folder> [--dry-run] [--json]   convert an existing folder INTO a managed milestone under work.dir (the import contrast)
  aof upgrade [--dry-run] [--changelog] [--json]   advance the work stream's OWN items to this build's schema (bare = apply, --dry-run = preview only, --changelog emits the generated upgrade changelog)
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
