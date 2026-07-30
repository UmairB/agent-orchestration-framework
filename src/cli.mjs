import path from "node:path";
import { access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatFriendlyApplyAction, relativeDisplayPath } from "./render-plan.mjs";
import { writeText, sweepStaleTempFiles } from "./fs.mjs";
import { writeWorkspaceConfig } from "./workspace-writer.mjs";
import { selectRuntimes } from "./prompt.mjs";
import { globalMeshPaths, isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "./workspace.mjs";
import { loadWorkspace, findWork } from "./work.mjs";
import { invoke, getCommand } from "./command-core.mjs";
// m42 wave (d) leg d1 — the registry-derived route table + the ONE generic face,
// and the shared runtime-flag interpretation (one home; the local copies are gone).
import { resolveRoute, runCommandFace } from "./spine/face.mjs";
import { hasRuntimeOptions, parseRuntimes } from "./spine/flags.mjs";
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
// m42 "interactive worker terminals" — the INPUT direction's loopback push, wired
// as a LITERAL `terminalInputPush` key at the same production call site (null when
// no relay is configured — the route then stays output-only).
import { createTerminalRelayPushTransport } from "./mesh-terminal-relay-bridge.mjs";
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

  // m42 wave (d) leg d1 — THE ROUTE TABLE, derived from the registry (never a
  // hand-kept ladder): any command declaring `cli.route` dispatches here through
  // the ONE generic face (src/spine/face.mjs) BEFORE the legacy ladder below.
  // As verbs migrate (WAVE-D-MIGRATION.md), their ladder branches are deleted;
  // when the last one goes, run() IS argv → route table → face.
  const routed = resolveRoute(argv);
  if (routed) {
    await runCommandFace(routed.command, routed.rest);
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

  // `aof migrate <folder>` — MIGRATED (m42 wave (d) leg d1, wave 2):
  // migrate:folder carries `cli.route: ["migrate"]` and dispatches through the
  // route table above; no ladder branch remains.

  // milestone 40 / story 02 — the top-level `upgrade` spelling: the SAME
  // work:upgrade command the `aof work upgrade` route reaches, delegated
  // through the generic face (the bare-`aof project` sanctioned-delegation
  // precedent — one door, two spellings).
  if (command === "upgrade") {
    await runCommandFace(getCommand("work:upgrade"), rest);
    return;
  }

  if (["add", "apply", "sync", "clean", "global", "install", "validate", "doctor", "config", "catalog"].includes(command)) {
    throw removedCommandError(command);
  }

  throw new Error(`Unknown command "${command}".\n\n${helpText()}`);
}

async function assetsCommand(args) {
  const [subcommand, ...rest] = args;

  // add/list/show/remove/use/unuse/validate/clean/apply — MIGRATED (m42 wave
  // (d) leg d1): registry Commands routed in run() through the generic face;
  // they never reach this ladder. Still here: ui (the launcher idiom).

  if (subcommand === "ui") {
    await assetsUiCommand(rest);
    return;
  }

  throw new Error(`Unknown assets command "${subcommand ?? ""}".\n\nExamples:\n  aof assets add skill code-review\n  aof assets add --global skill shared-review\n  aof assets apply --dry-run`);
}

// add/list/show/remove/validate/install — ALL MIGRATED (m42 wave (d) leg d1):
// registry Commands routed in run() through the generic face. Only an unknown
// subcommand ever reaches this shim.
async function packagesCommand(args) {
  const [subcommand] = args;
  throw new Error(`Unknown packages command "${subcommand ?? ""}".\n\nExamples:\n  aof packages add gsd --codex\n  aof packages install gsd --dry-run\n  aof packages install --from-lock --dry-run`);
}

async function projectCommand(args) {
  const [subcommand = "show", ...rest] = args;

  // "show" — MIGRATED (m42 wave (d) leg d1): `aof project show` dispatches via
  // the route table in run(); this branch remains ONLY for the bare `aof project`
  // default spelling, delegating to the SAME registered command + generic face
  // (one door, two spellings — the upgrade/work-upgrade precedent).
  if (subcommand === "show") {
    await runCommandFace(getCommand("project:show"), rest);
    return;
  }

  // validate/doctor/migrate — MIGRATED (m42 wave (d) leg d1): registry Commands
  // routed in run() through the generic face; they never reach this ladder.

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

  // list / validate / doc / tasks / next / doctor / feedback / run-* / continue /
  // refine / verify / the insert-* family / promote-gap — MIGRATED (m42 wave (d)
  // leg d1, wave 2): registry Commands carrying `cli.route`, dispatched in run()
  // through the route table + the ONE generic face; they never reach this
  // ladder. Their face copies (workListCommand, workValidateCommand,
  // workDoctorCommand, workNextCommand, workFeedbackCommand, the run-verb
  // wrappers + runVerbCli, workInsertCli) are deleted.

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

  // milestone 40 / story 02 — `aof work upgrade` rides work:upgrade's route
  // table entry; this branch never fires (the route dispatches first) but the
  // top-level `aof upgrade` spelling below delegates to the SAME command.

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

// `aof graph <verb>` — build/query/triage/impact MIGRATED (m42 wave (d) leg d1,
// wave 3): registry Commands carrying `cli.route`, dispatched in run() through
// the route table + the ONE generic face (graphVerbCommand RETIRED — the face's
// --json single-envelope discipline is the same contract). Still here: `serve`
// (the launcher idiom — a long-lived stdio MCP server) + the unknown-verb shim.
async function graphCommand(args) {
  const [subcommand, ...rest] = args;

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

  // identity / status / heartbeat / relay / invite / join / revoke / logs /
  // terminal-resume — MIGRATED (m42 wave (d) leg d1, wave 3): registry Commands
  // carrying `cli.route`, dispatched in run() through the route table + the ONE
  // generic face (meshVerbCli RETIRED — its --workspace resolution, positional
  // discipline, and node-not-found read-miss split moved to the face +
  // commands/mesh-face-shared.mjs). Still here: the CLI-only nested verbs
  // (ui/repo/assign/recover-push/desktop), the `serve --serve` daemon branch,
  // and the bare-usage/unknown-sub shims.
  const subcommand = sub;
  const [, ...rest] = args;
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
  // milestone 33 / story 01 (ADR-003) — the coordination-launcher dispatch branch,
  // ABOVE the unknown-sub fallthrough. `aof mesh serve --serve` is the FOREGROUND
  // presence+sync daemon (the long-lived face over the one-shot core, NEVER the
  // bijection-probed run). The bare (non-blocking probe) spelling DELEGATES
  // through runCommandFace (the bare-`aof project` sanctioned-delegation form) —
  // mesh:serve deliberately carries NO cli.route: the route table matches argv
  // words only (flags never participate), so a routed ["mesh","serve"] would
  // swallow `--serve` and the daemon branch would be unreachable. This branch
  // stays until the launcher seam is designed.
  if (subcommand === "serve") {
    if (parseOptions(rest).serve) {
      await meshServeDaemonCommand(rest);
      return;
    }
    await runCommandFace(getCommand("mesh:serve"), rest);
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

// meshVerbCli — RETIRED (m42 wave (d) leg d1, wave 3): every registered mesh
// verb carries cli.route + cli.spec and dispatches through the route table +
// the ONE generic face. Its three face-level behaviours moved with it: the
// `--workspace <path|id>` resolution into the face (resolveWorkspaceRoot), the
// positional discipline + read-miss split into commands/mesh-face-shared.mjs.

// Emit a mesh face error: under --json ONE { ok:false, error, code } document on stdout
// (+ non-zero exit); otherwise the message on stderr (+ non-zero exit). Callers
// are the REMAINING CLI-only nested verbs (repo/assign/recover-push) — deleted
// when they migrate (the wave-3 tail).
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
// `aof import <unit>` — only the unknown-unit shim remains (m42 wave (d) leg
// d1, wave 2): `import milestone` rides import:milestone's route table entry
// and never reaches this ladder (importMilestoneCommandCli deleted).
async function importCommand(args) {
  const [unit] = args;

  // SPEC §Scope: the unit of import is a milestone, not arbitrary content —
  // "milestone" is the only supported sub-noun in v0, so an unknown sub-noun
  // exits non-zero citing the supported unit (stderr + non-zero exit).
  console.error(
    `Unknown import unit "${unit ?? ""}". The supported import unit is "milestone".\n\nUsage: aof import milestone <repo> <selector> [--dry-run] [--json]`
  );
  process.exitCode = 1;
}

// migrateCommand / upgradeCommand — RETIRED (m42 wave (d) leg d1, wave 2):
// migrate:folder routes as ["migrate"]; work:upgrade routes as
// ["work","upgrade"] with the top-level `aof upgrade` spelling delegating
// through runCommandFace in run().

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

// `aof work integrations notion <verb> …` — only the unknown-verb shim remains
// (m42 wave (d) leg d1, wave 2): sync-work/associate ride their four-word route
// table entries and never reach this ladder (notionSyncWorkCli /
// notionAssociateCli deleted; their usage refusals live in the commands' argv
// adapters).
async function notionIntegrationCommand(args) {
  const [verb] = args;

  console.error(
    `Unknown notion integration verb "${verb ?? ""}". Usage: aof work integrations notion <sync-work <milestone> [--dry-run] | associate <ref> --board <key|none> --parent <id|key|none>> [--json]`
  );
  process.exitCode = 1;
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
      terminalInputPush: createTerminalRelayPushTransport(config),
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

// workListCommand / workValidateCommand / workDoctorCommand / workNextCommand /
// workFeedbackCommand / the run-verb wrappers + runVerbCli / workInsertCli —
// RETIRED (m42 wave (d) leg d1, wave 2): every one of these verbs carries
// cli.route + cli.spec and dispatches through the route table + the ONE
// generic face (src/spine/face.mjs), whose --json single-envelope discipline
// (incl. the insert family's shifted count) IS these faces' one home.

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

// assetsListCommand — RETIRED (m42 wave (d) leg d1): now the registered
// assets:list command (src/commands/assets-list.mjs), routed through the
// generic face. Byte-identical output; flag vocabulary declared on the command.

// printValidationResult — RETIRED (m42 wave (d) leg d1): the shared report
// lives in src/commands/validate-shared.mjs (renderValidationReport).

// assetsApplyCommand — RETIRED (m42 wave (d) leg d1): now the registered
// assets:apply command (src/commands/assets-apply.mjs), routed through the
// generic face. Byte-identical output; runtimesForApply moved with it, the
// friendly-action/marker/display helpers to render-plan.mjs.

async function assetsUiCommand(args) {
  const options = parseOptions(args);
  await setupUiCommand({ ...options, uiMode: "assets" });
}

// packagesListCommand — RETIRED (m42 wave (d) leg d1): now the registered
// packages:list command (src/commands/packages-list.mjs), routed through the
// generic face. Byte-identical output; packageSummaries moved to packages.mjs.

// packagesInstallCommand — RETIRED (m42 wave (d) leg d1): now the registered
// packages:install command (src/commands/packages-install.mjs), routed through
// the generic face; the frameworkInstall/installFromLock machinery moved with
// it. Byte-identical transcript; the failure summary now ends the stdout
// document (the exit rides cli.exit).

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

// projectShowCommand — RETIRED (m42 wave (d) leg d1): now the registered
// project:show command (src/commands/project-show.mjs), routed through the
// generic face (bare `aof project` delegates to the same command above).

// frameworkInstallCommand / installFromLockCommand — RETIRED (m42 wave (d)
// leg d1): the machinery lives in src/commands/packages-install.mjs.

// packageSummaries — moved to src/packages.mjs (m42 wave (d) leg d1: command
// logic leaves the face file); imported above for the remaining inline users.
// interactiveInstallCommand — DELETED with the packages:install migration
// (dead code: zero callers).

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

// formatFriendlyApplyAction / successMarker / relativeDisplayPath — moved to
// src/render-plan.mjs with the assets:apply migration (m42 wave (d) leg d1);
// imported above for the remaining inline work-init/work-update/planning-init
// faces. printAdapterWarnings / strictAdapterWarningsFailed — RETIRED (the
// adapter-warnings block renders via validate-shared adapterWarningLines;
// strictness is command data behind cli.exit).

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
