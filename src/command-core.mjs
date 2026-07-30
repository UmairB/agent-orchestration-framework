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
import { continueCommand, refineDoorCommand, verifyDoorCommand } from "./commands/continue.mjs";
import { docCommand } from "./commands/doc.mjs";
import { tasksCommand } from "./commands/tasks.mjs";
import { validateCommand } from "./commands/validate.mjs";
import { nextCommand } from "./commands/next.mjs";
import { feedbackCommand } from "./commands/feedback.mjs";
// milestone 15 — work doctor core (work:doctor registers into the SAME core;
// 15/ADR-001). The 7th work command: the deterministic, cross-item HEALTH lane —
// validate's sibling with a richer { code, severity, path, message } envelope.
import { doctorCommand } from "./commands/doctor.mjs";
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
// story 29 — migrate-command (migrate:folder registers into the SAME core). The
// CONTRAST with import:milestone: import SUMMARISES a foreign folder into a
// read-only AOF.md digest; migrate CONVERTS it INTO a managed milestone under
// work.dir (refinable/continuable/verifiable). It reuses import's read-only
// source-access + recovery seam, then SCAFFOLDS a native managed milestone at the
// next free slot. Takes the `migrate:` prefix, so it is EXCLUDED from the
// `work:`-filtered bijection but inherits the generic command-cli bijection.
import { migrateFolderCommand } from "./commands/migrate-folder.mjs";
// milestone 17 — Notion work-board sync (notion:sync-work registers into the SAME
// core; 17/ADR-002). The PO's terminal command that pushes a milestone + its
// stories to a Notion board; opt-in via `work.integrations.notion` (absent ⇒ an
// honest no-op). Takes the `notion:*` prefix, so it is EXCLUDED from the /api/work
// bijection but inherits the generic command-cli bijection (08/ADR-004).
import { notionSyncWorkCommand } from "./commands/notion-sync-work.mjs";
// milestone 18 — integration descriptor (notion:associate registers into the SAME
// core; 18/ADR-003/004). Records (or clears) a milestone's board + parent routing in
// its committed `.integrations.json` descriptor; PURE/no-read (ADR-006) — the
// descriptor write is the only mutation (neither the sidecar nor Notion). Takes the
// `notion:*` prefix, so EXCLUDED from the /api/work bijection but inheriting the
// generic command-cli bijection (08/ADR-004).
import { notionAssociateCommand } from "./commands/notion-associate.mjs";
// milestone 19 — work-run-lifecycle (story 01: run-commands — the three work:run-*
// commands register into the SAME core; ADR-003). Each is a thin wrapper over
// story 00's src/run-store.mjs (the next.mjs-over-nextWork idiom): run-start /
// run-complete are WRITES (resolveItemExact — a typo never writes to the wrong
// item), run-status is the READ (resolveItem slug-fallback tolerated). Additive,
// exactly the 08 move — the registry-derived bijection auto-covers their presence.
import { runStartCommand } from "./commands/run-start.mjs";
import { runCompleteCommand } from "./commands/run-complete.mjs";
import { runStatusCommand } from "./commands/run-status.mjs";
// milestone 20 — autonomous-run-resilience (story 01: resilience-commands — work:run-retry
// registers into the SAME core; ADR-003). A thin WRITE wrapper over story 00's retryRun:
// it RESUMES a retryable failed run's lineage (carries the prior sessionId, attempt + 1,
// retryOf), the resume-vs-fresh verb distinction (run-start stays fresh). Additive (the
// m09–m19 door); it takes the precedented BOARD_DEFERRED carve-out (board = m21) but
// inherits the generic command-cli bijection (08/ADR-004).
import { runRetryCommand } from "./commands/run-retry.mjs";
// milestone 22 — mesh-foundation (story 01: node-identity — mesh:identity / mesh:status
// register into the SAME core; ADR-001/003). Thin over story 00's src/mesh-store.mjs
// (the partition seam + opaque per-node persist/read) and story 01's
// src/node-identity.mjs (id derivation + descriptor assembly): mesh:identity publishes/
// reads THIS node's record, mesh:status lists the machine-wide roster. Additive — exactly the
// 08 move (one import + one COMMANDS entry each). They take the `mesh:` prefix, so they
// are EXCLUDED from the `work:`-filtered bijection but inherit the NEW registry-derived
// acd-mesh-command-cli-bijection gate (story 00, fitness #3).
import { meshIdentityCommand, meshStatusCommand } from "./commands/mesh-identity.mjs";
// milestone 23 — control-node-relay (story 00: presence-heartbeat — mesh:heartbeat
// registers into the SAME core; ADR-002). Thin over story 00's src/mesh-presence.mjs
// (the presence-record assembly + the activeRuns read of the run records + the atomic
// publish via the m22-reserved presenceRecordPath); it publishes THIS node's presence
// git-only (no relay — story 02 adds the push). mesh:status is EXTENDED in place
// (mesh-identity.mjs) to render presence + the stale flag. Additive — one import + one
// COMMANDS entry. It takes the `mesh:` prefix, so it is EXCLUDED from the
// `work:`-filtered bijection but RIDES the existing acd-mesh-command-cli-bijection gate
// (now covering identity+status+sync+heartbeat).
import { meshHeartbeatCommand } from "./commands/mesh-heartbeat.mjs";
// milestone 23 — control-node-relay (story 01: thin relay — mesh:relay registers into
// the SAME core; ADR-001). Thin over story 01's src/mesh-relay.mjs: `aof mesh relay` is
// the relay-mode serve verb, but the registered run is the NON-BLOCKING status probe
// (the configured control-node + url + nominated-or-not) so the bijection gate runs clean
// + returns (the actual long-lived serve is serveRelay/relayMode, the launcher's job).
// The relay carries OPAQUE envelopes and imports the record side NOTHING (file-disjoint
// from story 00). Additive — one import + one COMMANDS entry. It takes the `mesh:` prefix,
// so it is EXCLUDED from the `work:`-filtered bijection but RIDES the existing
// acd-mesh-command-cli-bijection gate (now covering identity+status+sync+heartbeat+relay).
import { meshRelayCommand } from "./commands/mesh-relay.mjs";
// milestone 24 — group-enrollment (story 01: device-code enrollment — mesh:invite /
// mesh:join register into the SAME core; ADR-002/003/005). mesh:invite is the
// control-node-guarded MINT (a 6-digit code, recorded HASHED as a pending invite
// through story 00's writeRegistry seam, the plaintext returned ONCE in the result);
// mesh:join PRESENTS a code to the control node's device-flow HTTP endpoint (the
// POST /enroll route on the control service), stores the issued websocket credential
// in the machine-global mesh config, and configures no repository remotes. Additive —
// one import + one COMMANDS entry each. They take the `mesh:` prefix, so they are
// EXCLUDED from the `work:`-filtered bijection but RIDE the existing
// acd-mesh-command-cli-bijection gate (now covering identity+status+sync+heartbeat+
// relay+invite+join).
import { meshInviteCommand } from "./commands/mesh-invite.mjs";
import { meshJoinCommand } from "./commands/mesh-join.mjs";
// milestone 24 — group-enrollment (story 02: the enforceable trust boundary — ADR-004).
// mesh:revoke is the control-node-guarded REVOKE: it removes the node from the registry
// roster + appends an explicit-deny revocation { nodeId, revokedAt, reason } through
// story 00's writeRegistry seam (ONE atomic write). After it the relay auth-gate (in
// mesh-relay.mjs's upgrade handler) rejects the revoked node's credential on its next
// connect (T6). Additive — one import + one COMMANDS entry. It takes the `mesh:` prefix,
// so it is EXCLUDED from the `work:`-filtered bijection but RIDES the existing
// acd-mesh-command-cli-bijection gate (now covering identity+status+sync+heartbeat+
// relay+invite+join+revoke).
import { meshRevokeCommand } from "./commands/mesh-revoke.mjs";
// milestone 33 — mesh relay/transport redesign (story 01: fabric-native transport +
// coordination launcher — mesh:serve registers into the SAME core; ADR-003). Thin over
// story 01's src/mesh-launcher.mjs: `aof mesh serve` is the per-node presence+sync
// daemon serve verb, but the registered run is the NON-BLOCKING probe (fabric state +
// self-address + peer count + control-node status) — the actual long-lived daemon is the
// `--serve` CLI face's job (startLauncher), never the registered run. Additive — one
// import + one COMMANDS entry. It takes the `mesh:` prefix, so it is EXCLUDED from the
// `work:`-filtered bijection but RIDES the existing acd-mesh-command-cli-bijection gate
// (now covering identity+status+sync+heartbeat+relay+invite+join+revoke+issue+serve).
import { meshServeCommand } from "./commands/mesh-serve.mjs";
// m42 wave (a) — mesh:logs, the durable-log READER over mesh-log.mjs's sink
// (TECH_DEBT item 2). Additive — one import + one COMMANDS entry; takes the
// `mesh:` prefix so the mesh bijection gate covers it with no edit.
import { meshLogsCommand } from "./commands/mesh-logs.mjs";
// m42 quick-fix — mesh:terminal-resume, the control-driven re-attach of a
// parked/killed worker session (`claude --resume` in the retained worktree).
// Additive — one import + one COMMANDS entry; takes the `mesh:` prefix so the
// mesh bijection gate covers it with no edit.
import { meshTerminalResumeCommand } from "./commands/mesh-terminal-resume.mjs";
// m42 wave (d) leg d1 (wave-3 tail) — the previously CLI-only nested mesh verbs
// as registered Commands riding the route table: mesh:assign (--to/--withdraw,
// + the --workspace residual closed), mesh:recover-push (global-store oriented,
// workspace-free), mesh:repo-publish (the three-word route). Their cores stay
// in the same modules for the white-box tests; cli.mjs's face copies +
// emitMeshError are deleted. (The old acd-desktop-verbs-outside-bijection gate
// that governed this boundary is acd-launcher-seam now — ui/serve ride the
// launcher seam below; repo/desktop keep only their unknown-verb shims.)
import { meshAssignCommand } from "./commands/mesh-assign.mjs";
import { meshRecoverPushCommand } from "./commands/mesh-recover-push.mjs";
import { meshRepoPublishCommand } from "./commands/mesh-repo.mjs";
// m42 wave (d) leg d1 (wave-3 tail, part 2) — the launcher seam's first riders:
// mesh:ui (probe run + cli.launch fleet-server body; the retired cli.mjs
// meshUiCommand/MESH_UI_FLAGS face) and the desktop verbs as plain three-word
// routes (mesh:desktop-install / mesh:desktop-run — one-shot, NOT launcher
// verbs; the no-verb/unknown-verb shim stays in cli.mjs's meshCommand).
// mesh:serve (above) gained its route + cli.launch daemon body in the same
// change — the route table now carries every registered mesh verb.
import { meshUiCommand } from "./commands/mesh-ui.mjs";
import { meshDesktopInstallCommand, meshDesktopRunCommand } from "./commands/mesh-desktop.mjs";
// m42 wave (d) leg d1 (wave-3 tail, part 2 continued) — the remaining launcher
// verbs onto the SAME seam: graph:serve (the stdio MCP server), work:ui (the
// board), assets:ui (the setup-UI editor + its dev-only vite re-exec). Each is a
// probe run + a cli.launch body; their cli.mjs ladder branches are deleted.
import { graphServeCommand } from "./commands/graph-serve.mjs";
import { workUiCommand } from "./commands/work-ui.mjs";
import { assetsUiCommand } from "./commands/assets-ui.mjs";
// m42 wave (d) leg d1 (wave-3 tail, the CLI-only batch) — the low-priority
// CLI-only work verbs join the registry as routed Commands: work:find (the
// resolver read), work:observe (the transcript miner), the headroom toggle
// pair. Their cli.mjs faces are deleted; project:provision (below, m12) gained
// its route in the same change (class B — its face copy is deleted too).
import { findCommand } from "./commands/find.mjs";
import { observeCommand } from "./commands/observe.mjs";
import { useHeadroomCommand, unuseHeadroomCommand } from "./commands/headroom.mjs";
import { workInitCommand, workUpdateCommand } from "./commands/init-update.mjs";
// milestone 41 / story 02 (insert-top-level, ADR-002/004/005/006) — work:insert-
// milestone / work:insert-uat register into the SAME core. Each is a THIN wrapper
// (src/commands/insert-shared.mjs) over story 01's re-index engine
// (src/work-reindex.mjs): open the slot at the caller's target position P in the
// TOP-LEVEL number space, count-gate the confirmation, then scaffold the new
// item's skeleton from `.aof/templates/work/<type>/` — the SAME templates add-*
// uses. Additive — the registry-derived acd-work-command-cli-bijection guard
// covers the new verbs for free (08/ADR-004).
import { insertMilestoneCommand } from "./commands/insert-milestone.mjs";
import { insertUatCommand } from "./commands/insert-uat.mjs";
// milestone 41 / story 03 (insert-story, ADR-002/004/005/006) — work:insert-
// story, the NESTED-axis sibling: places a new story at local position SS
// under a milestone NN, reusing the SAME insert-shared.mjs mechanics
// (count-gate, template-scaffold-strip) via `runInsertStory`. Independent of
// story 02's top-level pair above — disjoint number space, own command file.
import { insertStoryCommand } from "./commands/insert-story.mjs";
// milestone 39 / story 03 (gap-to-chore, ADR-001, feasibility flag 4) —
// work:insert-chore joins the SAME top-level pair above (a THIN wrapper over
// insert-shared.mjs's runInsertTopLevel, reusing the mechanics, not a bespoke
// writer). work:promote-gap is the promotion verb: given a declared gap
// (title + discharge condition), it calls the SAME runInsertTopLevel engine to
// scaffold a chore, then seeds its Definition of Done + back-reference — the
// mechanical bridge from "a gap is a note" to "a gap is schedulable debt".
import { insertChoreCommand } from "./commands/insert-chore.mjs";
import { promoteGapToChoreCommand } from "./commands/promote-gap-to-chore.mjs";
// milestone 40 / story 02 (migration registry & `aof upgrade`, ADR-005) —
// work:upgrade registers into the SAME core. A thin wrapper over the NEW
// src/work-upgrade.mjs engine (WORK_ITEM_MIGRATIONS + planUpgrade/runUpgrade),
// which imports work.mjs's readers + the ADR-004 writer but is never imported
// BY work.mjs (acd-upgrade-engine-blast-radius — the god-node's blast radius
// does not grow). Reachable as the top-level `aof upgrade` verb (mirroring
// `aof migrate` -> migrate:folder) AND as `aof work upgrade` (cli.mjs's
// workCommand dispatch) — both routes reach this ONE registered command.
// CLI-only by design (no board affordance requested — the same BOARD_DEFERRED
// carve-out `insert-milestone`/`insert-chore`/etc already use).
import { upgradeCommand } from "./commands/upgrade.mjs";
// m42 wave (d) leg d1 (PRD-command-spine-effects-ledger) — the first three
// class-A migrations off cli.mjs's inline ladder: previously UNREGISTERED verbs
// (assets/packages/project family — self-contained, no cascade surface) become
// registry Commands carrying `cli.route` + `cli.spec`, dispatched by the
// registry-derived route table through the ONE generic face
// (src/spine/face.mjs). The remaining ~40 inline verbs follow the wave-(d)
// migration plan (wiki/work/42_structural-overhaul/WAVE-D-MIGRATION.md).
import { assetsListCommand } from "./commands/assets-list.mjs";
import { packagesListCommand } from "./commands/packages-list.mjs";
import { projectShowCommand } from "./commands/project-show.mjs";
// m42 wave (d) leg d1, WAVE 1 COMPLETION (2026-07-28) — the rest of the
// assets/packages/project families off the inline ladder: reads and writers
// alike are registry Commands on the route table, including the two big flows
// (assets:apply, packages:install — the wave-1 tail). Still inline by design:
// assets ui (launcher idiom) and init (shares apply's machinery + the d4
// writeLock item).
import { assetsShowCommand } from "./commands/assets-show.mjs";
import { assetsAddCommand } from "./commands/assets-add.mjs";
import { assetsRemoveCommand } from "./commands/assets-remove.mjs";
import { assetsUseCommand, assetsUnuseCommand } from "./commands/assets-refs.mjs";
import { assetsCleanCommand } from "./commands/assets-clean.mjs";
import { assetsValidateCommand } from "./commands/assets-validate.mjs";
import { assetsApplyCommand } from "./commands/assets-apply.mjs";
import { packagesShowCommand } from "./commands/packages-show.mjs";
import { packagesAddCommand } from "./commands/packages-add.mjs";
import { packagesRemoveCommand } from "./commands/packages-remove.mjs";
import { packagesValidateCommand } from "./commands/packages-validate.mjs";
import { packagesInstallCommand } from "./commands/packages-install.mjs";
import { projectValidateCommand } from "./commands/project-validate.mjs";
import { projectDoctorCommand } from "./commands/project-doctor.mjs";
import { projectMigrateCommand } from "./commands/project-migrate.mjs";

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
  doctorCommand,
  graphBuildCommand,
  graphQueryCommand,
  graphTriageCommand,
  graphImpactCommand,
  projectProvisionCommand,
  importMilestoneCommand,
  migrateFolderCommand,
  notionSyncWorkCommand,
  notionAssociateCommand,
  runStartCommand,
  runCompleteCommand,
  runStatusCommand,
  runRetryCommand,
  meshIdentityCommand,
  meshStatusCommand,
  meshHeartbeatCommand,
  meshRelayCommand,
  meshInviteCommand,
  meshJoinCommand,
  meshRevokeCommand,
  meshServeCommand,
  meshLogsCommand,
  meshTerminalResumeCommand,
  // m42 wave (d) leg d1 (wave-3 tail) — the nested verbs join the registry.
  meshAssignCommand,
  meshRecoverPushCommand,
  meshRepoPublishCommand,
  meshUiCommand,
  meshDesktopInstallCommand,
  meshDesktopRunCommand,
  graphServeCommand,
  workUiCommand,
  assetsUiCommand,
  findCommand,
  observeCommand,
  useHeadroomCommand,
  unuseHeadroomCommand,
  workInitCommand,
  workUpdateCommand,
  insertMilestoneCommand,
  insertUatCommand,
  insertStoryCommand,
  insertChoreCommand,
  promoteGapToChoreCommand,
  upgradeCommand,
  // work:continue (2026-07-26) — THE single "continue this task [--node <id>]" door.
  // Every face (board button, CLI, fleet) resolves WHERE a continue happens here, so a
  // board click can no longer start a local run against work that lives on a worker.
  continueCommand,
  // m42 wave (b) — the one-door-per-act COMPLETION: refine and verify are the SAME
  // door (one factory, one decision, one scope rule) with their own lifecycle phase.
  refineDoorCommand,
  verifyDoorCommand,
  // m42 wave (d) leg d1 — the first route-table commands (see the import note).
  assetsListCommand,
  packagesListCommand,
  projectShowCommand,
  // m42 wave (d) leg d1, wave-1 completion — the families in full.
  assetsShowCommand,
  assetsAddCommand,
  assetsRemoveCommand,
  assetsUseCommand,
  assetsUnuseCommand,
  assetsCleanCommand,
  assetsValidateCommand,
  assetsApplyCommand,
  packagesShowCommand,
  packagesAddCommand,
  packagesRemoveCommand,
  packagesValidateCommand,
  packagesInstallCommand,
  projectValidateCommand,
  projectDoctorCommand,
  projectMigrateCommand,
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
