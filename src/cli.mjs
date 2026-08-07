import { pathToFileURL } from "node:url";
import { loadWorkspace } from "./work.mjs";
import { getCommand, listCommands } from "./command-core.mjs";
// m42 wave (d) leg d1 — the registry-derived route table + the ONE generic
// face. listCommands feeds helpText, whose verb listing is DERIVED from the
// registry (each routed command's cli.spec.usage) — never a hand-kept text.
import { resolveRoute, runCommandFace } from "./spine/face.mjs";
import { workMemoryCommand } from "./work-memory.mjs";
// selectOrchestratorModel / showOrchestratorModel / setDelegationCommand /
// setDelegationModelCommand / showDelegation / updateWork — no longer imported
// here (m42 wave (d) leg d1, the CLI-only batch closing half): the model-config
// trio (work:orchestrator / work:delegation / work:delegation-model) is
// registered in commands/orchestrator-delegation.mjs, riding the route table.
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
// initPlanning — no longer imported here (m42 wave (d) leg d1, the CLI-only
// batch closing half): planning:init is registered in commands/planning-init.mjs.
// selectRuntimes / writeWorkspaceConfig / the workspace guards — likewise
// retired with the top-level init migration (project:init, commands/project-init.mjs).
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

  // `aof init` — MIGRATED (m42 wave (d) leg d1, the CLI-only batch closing
  // half): project:init carries `cli.route: ["init"]` (the one-word route,
  // migrate:folder precedent) and dispatches through the route table above.

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

  // validate/doctor/migrate — MIGRATED (m42 wave (d) leg d1); provision —
  // MIGRATED (wave-3 tail, class B — projectProvisionCli deleted; the command
  // carries route ["project","provision"] with spec.workspace: false): registry
  // Commands routed in run() through the generic face; they never reach this
  // ladder.

  throw new Error(`Unknown project command "${subcommand ?? ""}".\n\nExamples:\n  aof project show\n  aof project validate\n  aof project doctor\n  aof project migrate --dry-run\n  aof project provision graphify [--version 0.8.44] [--uninstall] [--dry-run] [--json]`);
}

async function workCommand(args) {
  const [subcommand, ...rest] = args;

  // list / validate / doc / tasks / next / doctor / feedback / run-* / continue /
  // refine / verify / the insert-* family / promote-gap — MIGRATED (m42 wave (d)
  // leg d1, wave 2); find / observe / use-headroom / unuse-headroom / ui —
  // MIGRATED (wave-3 tail, the CLI-only batch + the launcher seam): registry
  // Commands carrying `cli.route`, dispatched in run() through the route table
  // + the ONE generic face; they never reach this ladder. Their face copies
  // (workListCommand, workValidateCommand, workDoctorCommand, workNextCommand,
  // workFeedbackCommand, the run-verb wrappers + runVerbCli, workInsertCli,
  // workFindCommand, workObserveCommand, the headroom pair, workUiCommand) are
  // deleted.

  // milestone 40 / story 02 — `aof work upgrade` rides work:upgrade's route
  // table entry; this branch never fires (the route dispatches first) but the
  // top-level `aof upgrade` spelling below delegates to the SAME command.

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

  // orchestrator / delegation / delegation-model — MIGRATED (m42 wave (d) leg
  // d1, the CLI-only batch closing half): the model-config trio is registered
  // in commands/orchestrator-delegation.mjs, riding the route table; the
  // prompts live in their async argv adapters, the prints in their renders.

  throw new Error(`Unknown work command "${subcommand ?? ""}".\n\nExamples:\n  aof work init [dir] [--dry-run] [--runtime claude,codex] [--force] [--with-headroom]\n  aof work update [dir] [--dry-run] [--force]\n  aof work find 04\n  aof work find 04/02\n  aof work find auth --json\n  aof work list\n  aof work list 03\n  aof work list --json\n  aof work doc 04 SPEC\n  aof work tasks 04/02 --json\n  aof work feedback 04/02 --note "spec was thin" --actor qa\n  aof work run-start 19 [--session sess-1] [--brief '{"initiator":"operator"}'] [--json]\n  aof work run-complete 19 --outcome done|failed [--run <runId>] [--reason timeout] [--json]\n  aof work run-status 19 [--json]\n  aof work run-retry 19 [--run <runId>] [--max-attempts 3] [--force] [--json]\n  aof work resume [19] [--force] [--json]\n  aof work memory recall "pin line endings"\n  aof work validate\n  aof work doctor [scope] [--json] [--strict]\n  aof work next 03-10\n  aof work ui [--port 4180]\n  aof work integrations notion sync-work 17 [--dry-run] [--json]\n  aof work orchestrator [fable|opus] [--show]\n  aof work delegation [on|off] [--model fable|opus] [--gpt-model <id>] [--no-model] [--show]\n  aof work delegation-model [<id>] [--show]\n  aof work use-headroom\n  aof work unuse-headroom\n  aof work insert-milestone "widget-support" --at 2 [--yes] [--json]\n  aof work insert-uat "release-gate" --at 1 [--depends 0,2] [--yes] [--json]\n  aof work insert-story "auth-guard" --at 1 --under 5 [--yes] [--json]\n  aof work insert-chore "tidy-config" --at 2 [--yes] [--json]\n  aof work promote-gap "warnings_delivered field" --discharge "a production path writes warnings_delivered" [--status open] [--at 2] [--yes] [--json]\n  aof work upgrade [--dry-run] [--json]`);
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
// stdout naming the rejected sub. EVERY unrouted sub (including "" and a whitespace
// token) is unknown — the first non-flag token carries "" / "   " distinct from
// `undefined` (no sub), so the matrix is distinguishable. The token scan replaced
// parseOptions with its retirement (m42 wave (d) leg d1, closing half) — the
// repo/desktop shims below already used this idiom.
const MESH_USAGE = `aof mesh — the mesh node face (routing only; verbs arrive with later stories).\n\nUsage:\n  aof mesh            show this usage\n  aof mesh --json     the usage envelope as JSON`;

async function meshCommand(args) {
  const sub = args.find((token) => typeof token === "string" && !token.startsWith("--"));
  const asJson = args.some((token) => token === "--json" || (typeof token === "string" && token.startsWith("--json=")));

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
    if (asJson) {
      console.log(JSON.stringify({ ok: true, usage: MESH_USAGE.split("\n") }, null, 2));
      return;
    }
    console.log(MESH_USAGE);
    return;
  }

  // Any sub present (every routed verb dispatched before this ladder, so any
  // sub that reaches here — including "" and "   " — is unknown): reject with
  // ONE envelope naming the rejected sub, non-zero exit.
  if (asJson) {
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

// workOrchestratorCommand / workDelegationCommand / workDelegationModelCommand —
// RETIRED (m42 wave (d) leg d1, the CLI-only batch closing half): the
// model-config trio is registered in commands/orchestrator-delegation.mjs on
// the route table. The prompts (the orchestrator-model picker, its
// AOF_ORCHESTRATOR_INPUT seam intact) moved into the async argv adapters; the
// prints into collector-fed renders; a bad --model is refused pre-write.

// workUseHeadroomCommand / workUnuseHeadroomCommand — RETIRED (m42 wave (d)
// leg d1, wave-3 tail): work:use-headroom / work:unuse-headroom are registered
// Commands (commands/headroom.mjs) on the route table; the cores' install hint
// rides the result as `notes` so the render reproduces the transcript and the
// --json face stays one document.

// workInitCommand / workUpdateCommand — RETIRED (m42 wave (d) leg d1,
// wave-3 tail): work:init / work:update are registered Commands
// (commands/init-update.mjs) on the route table (pure-outcome idiom; the
// guarded/not-initialised refusal message now ends the stdout document — the
// packages:install normalisation precedent — with cli.exit gating 1; the
// --json refusal doc keeps its retired shape).

// `aof work memory <verb>` — delegates to the memory seam (milestone 05, story
// 00). The seam owns argv/scope parsing, config-driven backend selection, the
// frozen-interface dispatch, and the --json-vs-text rendering; it sets
// process.exitCode non-zero on an unknown/missing verb.
async function workMemoryCommandCli(args) {
  await workMemoryCommand(args, { loadWorkspace });
}

// `aof planning <sub>` — `init` MIGRATED (m42 wave (d) leg d1, the CLI-only
// batch closing half): planning:init is a registered Command
// (commands/planning-init.mjs) on the route table; the printing core's log is
// a collector there, and the refusal message now ends the stdout document (the
// packages:install normalisation precedent). Only an unknown subcommand ever
// reaches this shim.
async function planningCommand(args) {
  const [subcommand] = args;
  throw new Error(`Unknown planning command "${subcommand ?? ""}".\n\nExamples:\n  aof planning init [dir] [--dry-run] [--with-optional] [--runtime claude|codex] [--scope user|project|local] [--force]`);
}

// workFindCommand — RETIRED (m42 wave (d) leg d1, wave-3 tail): work:find is a
// registered Command (commands/find.mjs) on the route table — the bare-array
// --json document and the no-match stdout+exit-1 read-miss are carried
// contracts (--json stays [] at exit 0).

// workListCommand / workValidateCommand / workDoctorCommand / workNextCommand /
// workFeedbackCommand / the run-verb wrappers + runVerbCli / workInsertCli —
// RETIRED (m42 wave (d) leg d1, wave 2): every one of these verbs carries
// cli.route + cli.spec and dispatches through the route table + the ONE
// generic face (src/spine/face.mjs), whose --json single-envelope discipline
// (incl. the insert family's shifted count) IS these faces' one home.

// workObserveCommand — RETIRED (m42 wave (d) leg d1, wave-3 tail): work:observe
// is a registered Command (commands/observe.mjs) on the route table. Documented
// change: a skipped `--if-enabled --json` run now emits ONE { skipped: true }
// document (previously nothing — the one-document discipline).


// initCommand / guideAfterInit / writeInstallLock — RETIRED (m42 wave (d) leg
// d1, the CLI-only batch closing half): `aof init` is the registered
// project:init command (commands/project-init.mjs) on the one-word route. The
// interactive selectRuntimes completion lives in its async argv adapter (the
// assets:add precedent); the guards throw CODED refusals from run() with the
// retired messages; the lock seed moved with it (still wholesale — the d4
// writeLock read-merge item is untouched).

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
// logic leaves the face file). interactiveInstallCommand — DELETED with the
// packages:install migration (dead code: zero callers).

// parseOptions + its global boolean allow-list, printJson — DELETED (m42 wave
// (d) leg d1, the CLI-only batch closing half — the d1 end-state): every
// registered verb's flag vocabulary is its OWN cli.spec, parsed by
// parseSpecArgv in the one generic face; the last callers (init / planning
// init / the model-config trio / meshCommand's usage scan) migrated or moved
// to the shims' token-scan idiom. A typo'd flag can no longer silently become
// a stringly option anywhere in the CLI.

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

// helpText — REGISTRY-DERIVED (m42 wave (d) leg d1, the d1 end-state): the
// verb listing is each routed command's own cli.spec.usage, grouped by route
// family — never a hand-kept text that drifts from the real vocabulary. The
// one-word routes (init, migrate) open the Usage block; the static tail names
// the deliberately-unrouted doors (work memory, session) and the standing
// defaults prose.
const HELP_FAMILY_TITLES = Object.freeze({
  usage: "Usage",
  project: "Project",
  assets: "Assets",
  packages: "Packages",
  work: "Work (ACD work stream)",
  planning: "Planning",
  graph: "Graph",
  mesh: "Mesh",
  import: "Import",
});
const HELP_FAMILY_ORDER = ["usage", "project", "assets", "packages", "work", "planning", "graph", "mesh", "import"];
const HELP_USAGE_WORD_ORDER = ["init", "migrate"];

function helpText() {
  const families = new Map();
  for (const command of listCommands()) {
    const route = command.cli?.route;
    if (!Array.isArray(route) || route.length === 0) continue;
    const family = route.length === 1 ? "usage" : route[0];
    const entries = families.get(family) ?? [];
    entries.push({ word: route[0], usage: command.cli.spec?.usage ?? `aof ${route.join(" ")}` });
    families.set(family, entries);
  }
  const usageRank = (word) => {
    const index = HELP_USAGE_WORD_ORDER.indexOf(word);
    return index === -1 ? HELP_USAGE_WORD_ORDER.length : index;
  };
  families.get("usage")?.sort((a, b) => usageRank(a.word) - usageRank(b.word));

  const sections = [];
  for (const family of [...HELP_FAMILY_ORDER, ...families.keys()]) {
    const entries = families.get(family);
    if (!entries) continue;
    families.delete(family);
    const title = HELP_FAMILY_TITLES[family] ?? `${family[0].toUpperCase()}${family.slice(1)}`;
    sections.push(`${title}:\n${entries.map((entry) => `  ${entry.usage}`).join("\n")}`);
  }

  return `aof - Agent Orchestration Framework

${sections.join("\n\n")}

Also:
  aof work memory <verb> [args] [--json]   recall/brief/ingest/reindex/status via the configured backend
  aof session start|ping|end               assistant-session presence (fired from editor hooks)
  aof --version                            version + runtime-mode/build provenance

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
// the command modules import them directly (nothing in this face file needs
// them). printAdapterWarnings / strictAdapterWarningsFailed — RETIRED (the
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
