import path from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatFriendlyApplyAction, relativeDisplayPath } from "./render-plan.mjs";
import { writeText } from "./fs.mjs";
import { writeWorkspaceConfig } from "./workspace-writer.mjs";
import { selectRuntimes } from "./prompt.mjs";
import { isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "./workspace.mjs";
import { loadWorkspace, findWork } from "./work.mjs";
import { invoke, getCommand } from "./command-core.mjs";
// m42 wave (d) leg d1 — the registry-derived route table + the ONE generic face,
// and the shared runtime-flag interpretation (one home; the local copies are gone).
import { resolveRoute, runCommandFace } from "./spine/face.mjs";
import { hasRuntimeOptions, parseRuntimes } from "./spine/flags.mjs";
import { initWork } from "./work-init.mjs";
import { updateWork } from "./work-update.mjs";
import { observeMilestone, observabilityEnabled } from "./work-observe.mjs";
import { workMemoryCommand } from "./work-memory.mjs";
import { useHeadroom, unuseHeadroom } from "./work-headroom.mjs";
import { selectOrchestratorModel, showOrchestratorModel } from "./work-orchestrator.mjs";
import { setDelegationCommand, setDelegationModelCommand, showDelegation } from "./work-delegation.mjs";
// serveBoard / serveStdio / the vite dev spawn — no longer imported here (m42
// wave (d) leg d1, wave-3 tail): the work:ui / graph:serve / assets:ui launch
// bodies own them in their command modules (the launcher seam).
// serveMeshUi + the fleet mirror/relay wiring — no longer imported here (m42
// wave (d) leg d1, wave-3 tail): `aof mesh ui` is the registered mesh:ui
// launcher-seam command (commands/mesh-ui.mjs owns the production serveMeshUi
// call site and its LITERAL startTerminalRelaySubscriber/terminalInputPush
// keys). publishRepoToMesh / assignWork+withdrawWork / recoverPush /
// meshDesktopCommand — likewise retired: mesh:repo-publish / mesh:assign /
// mesh:recover-push / mesh:desktop-install / mesh:desktop-run are registered
// Commands riding the route table.
// milestone 38 / story 00 (ADR-002) — `aof session start|ping|end`, the
// assistant-agnostic session-presence CLI seam. A CLI-only TOP-LEVEL command (the
// mesh-desktop.mjs nested-verb shape, but at the top level rather than under
// `mesh`) — NOT a registered mesh:* command (its stdin-JSON/env identity resolution
// doesn't fit meshVerbCli's single-positional shape).
import { meshSessionCommand } from "./commands/mesh-session.mjs";
// startLauncher / acquireMeshLauncherLock / createMeshLogSink — no longer
// imported here (m42 wave (d) leg d1, wave-3 tail): the `aof mesh serve --serve`
// daemon body moved into commands/mesh-serve.mjs as mesh:serve's cli.launch
// (the launcher seam).
import { initPlanning } from "./planning-init.mjs";
// milestone 28 / story 00 (ADR-003/ADR-004): the ONE SEA-safe asset-base seam
// (the dev-only vite re-exec route) + the version string for `aof --version`
// (ADR-004's "node mode = everything else" — an argv branch of the SAME run()
// dispatch, never a fork ahead of it, mirroring the existing `help` branch).
import { packageVersionString } from "./asset-base.mjs";
// TECH_DEBT item 1 — which code is this process actually running (source /
// payload / embedded + the install's build stamp)? Surfaced on --version (the
// daemons' startup lines moved to their launcher-seam bodies).
import { readBuildInfo, buildInfoString } from "./build-info.mjs";

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

// add/list/show/remove/use/unuse/validate/clean/apply/ui — ALL MIGRATED (m42
// wave (d) leg d1; ui with the launcher seam, wave-3 tail): registry Commands
// routed in run() through the generic face. Only an unknown subcommand ever
// reaches this shim.
async function assetsCommand(args) {
  const [subcommand] = args;
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

  // `aof work ui` — MIGRATED with the launcher seam (m42 wave (d) leg d1,
  // wave-3 tail): work:ui's probe run + cli.launch board body live in
  // commands/work-ui.mjs; it rides the route table and never reaches this
  // ladder.

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
// wave 3); `serve` MIGRATED with the launcher seam (wave-3 tail —
// graph:serve's probe run + cli.launch stdio body live in
// commands/graph-serve.mjs): registry Commands carrying `cli.route`, dispatched
// in run() through the route table + the ONE generic face. Only an unknown verb
// ever reaches this shim.
async function graphCommand(args) {
  const [subcommand] = args;
  console.error(`Unknown graph command "${subcommand ?? ""}".\n\nExamples:\n  aof graph build <folder> [--backend claude] [--json]\n  aof graph query "what calls main" [--json]\n  aof graph impact src/command-core.mjs [src/cli.mjs ...] [--json]\n  aof graph triage [--mode conflicts] [--json]\n  aof graph serve`);
  process.exitCode = 1;
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
  // terminal-resume — MIGRATED (m42 wave (d) leg d1, wave 3); assign /
  // recover-push / repo publish — MIGRATED (wave-3 tail); ui / serve /
  // desktop install / desktop run — MIGRATED (wave-3 tail part 2, the launcher
  // seam): registry Commands carrying `cli.route` (repo publish + the desktop
  // verbs ride three-word routes; ui and serve declare `cli.launch` bodies —
  // bare `mesh ui` and `mesh serve --serve` launch through the seam, --json is
  // always the non-blocking probe), dispatched in run() through the route table
  // + the ONE generic face. Still here: the repo + desktop no-verb/unknown-verb
  // shims (refusals a route cannot express) and the bare-usage/unknown-sub
  // shims.
  const subcommand = sub;
  const [, ...rest] = args;
  // `aof mesh repo publish` — MIGRATED (mesh:repo-publish, the three-word
  // route). This shim owns ONLY the refusals the route table cannot express:
  // no verb, or an unknown inner verb. Same envelope discipline as the
  // unknown-sub shim below.
  if (subcommand === "repo") {
    const verb = rest.find((token) => typeof token === "string" && !token.startsWith("--"));
    const asJson = rest.some((token) => token === "--json" || (typeof token === "string" && token.startsWith("--json=")));
    const refusal = verb === undefined
      ? { message: "`aof mesh repo` needs a verb.\n\nUsage:\n  aof mesh repo publish   publish this repo into the mesh", code: "invalid-input" }
      : { message: `Unknown mesh repo verb "${verb}".`, code: "unknown-subcommand" };
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: refusal.message, code: refusal.code }, null, 2));
    } else {
      console.error(refusal.message);
    }
    process.exitCode = 1;
    return;
  }
  // `aof mesh desktop install|run` — MIGRATED (mesh:desktop-install /
  // mesh:desktop-run, three-word routes). This shim owns ONLY the refusals the
  // route table cannot express: no verb, or an unknown inner verb (the repo-shim
  // precedent; the refusal bytes are the retired meshDesktopCommand face's own).
  if (subcommand === "desktop") {
    const verb = rest.find((token) => typeof token === "string" && !token.startsWith("--"));
    const asJson = rest.some((token) => token === "--json" || (typeof token === "string" && token.startsWith("--json=")));
    const refusal = verb === undefined
      ? { message: "`aof mesh desktop` needs a verb.\n\nUsage:\n  aof mesh desktop install   install the desktop app\n  aof mesh desktop run       launch the installed desktop app", code: "invalid-input" }
      : { message: `Unknown mesh desktop verb "${verb}".`, code: "unknown-subcommand" };
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: refusal.message, code: refusal.code }, null, 2));
    } else {
      console.error(refusal.message);
    }
    process.exitCode = 1;
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
// emitMeshError — RETIRED with the wave-3 tail (its last callers, the
// repo/assign/recover-push face copies, are registered Commands now; the
// generic face owns the one envelope).

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


// workUiCommand — RETIRED (m42 wave (d) leg d1, wave-3 tail, the launcher
// seam): `aof work ui` is the registered work:ui command (commands/work-ui.mjs)
// — probe run + cli.launch board body — on the route table.

// meshUiCommand + MESH_UI_FLAGS — RETIRED (m42 wave (d) leg d1, wave-3 tail
// part 2, the launcher seam): `aof mesh ui` is the registered mesh:ui command
// (src/commands/mesh-ui.mjs) — probe run + cli.launch fleet-server body — on
// the route table. The production serveMeshUi call site (with its LITERAL
// startTerminalRelaySubscriber / terminalInputPush keys) moved with it.

// meshRepoCommand / meshAssignCommand / meshRecoverPushCommand — RETIRED (m42
// wave (d) leg d1, wave-3 tail): mesh:repo-publish / mesh:assign /
// mesh:recover-push are registered Commands in their own modules
// (commands/mesh-repo.mjs, mesh-assign.mjs, mesh-recover-push.mjs), riding the
// route table + the ONE generic face. The repo no-verb/unknown-verb shim lives
// in meshCommand; recover-push's pre-invoke progress line and its json-exit-0
// on coded failure are documented in WAVE-D-MIGRATION.md.

// meshServeDaemonCommand — RETIRED (m42 wave (d) leg d1, wave-3 tail part 2,
// the launcher seam): the `--serve` daemon body is mesh:serve's cli.launch
// (src/commands/mesh-serve.mjs); the route table carries both spellings and
// the face's probe rule keeps `--json` non-blocking.
// meshDesktopCommand — RETIRED (same change): mesh:desktop-install /
// mesh:desktop-run are registered three-word routes (commands/mesh-desktop.mjs);
// only the no-verb/unknown-verb shim remains in meshCommand.
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

// assetsUiCommand / setupUiCommand / startSetupUiFrontend — RETIRED (m42 wave
// (d) leg d1, wave-3 tail, the launcher seam): `aof assets ui` is the
// registered assets:ui command (commands/assets-ui.mjs) — probe run +
// cli.launch editor body — on the route table; the DEV-ONLY vite re-exec (the
// acd-sea-safe-asset-base allow-list note) moved with it.

// packagesListCommand — RETIRED (m42 wave (d) leg d1): now the registered
// packages:list command (src/commands/packages-list.mjs), routed through the
// generic face. Byte-identical output; packageSummaries moved to packages.mjs.

// packagesInstallCommand — RETIRED (m42 wave (d) leg d1): now the registered
// packages:install command (src/commands/packages-install.mjs), routed through
// the generic face; the frameworkInstall/installFromLock machinery moved with
// it. Byte-identical transcript; the failure summary now ends the stdout
// document (the exit rides cli.exit).

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
