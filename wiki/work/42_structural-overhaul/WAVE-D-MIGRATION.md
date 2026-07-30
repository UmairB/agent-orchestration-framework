# Wave (d) — command spine & effects ledger: the migration plan

> The working ledger for legs d1–d5 ([ROADMAP](ROADMAP.md) wave (d); design record:
> [PRD-command-spine-effects-ledger.md](../../planning/PRD-command-spine-effects-ledger.md)).
> **Infrastructure + first migrations landed 2026-07-28** — this document is the plan for the
> REST: every remaining verb, cascade and gate, in order, with the ritual each one follows.

## What is already landed (the foundation + proofs)

| Piece | File(s) | What it is |
|---|---|---|
| The ONE generic CLI face | `src/spine/face.mjs` | spec-driven flag parsing (`parseSpecArgv`), registry-derived route table (`deriveRouteTable`/`resolveRoute`), `runCommandFace` (loadWorkspace → invoke → render/--json), the ONE `--json` error envelope `{ ok:false, error, code }` + exit-code policy, and the post-invoke effects sweep (CLI sync-drain, crash recovery). |
| The per-node journal | `src/effects/journal.mjs` | `journal.sqlite` beside the projection (AOF_GLOBAL_HOME-honoring); `events` + `effect_steps` (pending/done/failed/skipped, attempts, busy_timeout from birth); append is one transaction: event + its owed steps. |
| The effects table | `src/effects/table.mjs` | `EFFECTS` — the closed vocabulary; one entry so far: `run.completed` → `rollback-status` (checkout) + `publish-projection` (local). Adding a consequence is one line here. |
| The dispatcher | `src/effects/dispatch.mjs` | `drainEffects` (locus-routed, idempotent-at-least-once, failures → degrade + retry, never silent, per-reactor outcomes) + `runEffectsEphemeral` (journal-unavailable fallback — behaviour never gates on the ledger's health). |
| The transition seam | `src/effects/run-transitions.mjs` | `transitionRunComplete` — the run store's ONLY event-raiser: fact write (store guards intact) → append `run.completed` → sync drain. Write-then-append for file stores (reconciler scan = d5). |
| Migrated commands (proofs) | `assets:list`, `packages:list`, `project:show` (class A — new Commands), `work:doc`, `work:tasks` (class B — face copies deleted), `work:run-complete` (class C — cascade port) | See the ritual below; each is the worked example for its class. |
| BDD-first integration lane | `test/integration/` (README, `command-spine.feature`, `effects-ledger.feature`, step registry + common grammar, convention-resolving runner) | The contract of record for every migrated verb. The crash-window scenario (pending steps paid by the next CLI invocation) runs on every suite pass. |
| Gates | `acd-command-route-derived` (new), `acd-effects-ledger` (new), `acd-work-command-cli-bijection` (route-aware), `acd-status-rollback-bounded` (ledger-aware) | Registry-derived, never ladder-greps. |

## The three migration classes and their rituals

**Class A — unregistered inline verb → registry Command.**
1. Scenario first: add/extend a feature under `test/integration/features/` (the common grammar
   usually suffices — see `test/integration/README.md`).
2. New `src/commands/<family>-<verb>.mjs`: `{ id, input, run, cli: { route, spec, argv, render, json } }`.
   `run` returns basis-neutral data; `render` reproduces the inline handler's console.log lines
   joined with `\n` — byte-identical. Logic that lived in cli.mjs moves to its owning module
   (precedent: `packageSummaries` → `packages.mjs`), NEVER stays in the face file.
3. Register in `command-core.mjs`; delete the inline handler + its ladder branch (leave a
   one-line RETIRED note). `spec.workspace: false` if the verb never used `loadWorkspace`.
4. Verbs whose real body is a long-lived process (`ui`, `serve --serve`, `desktop run`) keep the
   registered-run-as-probe idiom (mesh:serve precedent): the Command's `run` is the probe; the
   launcher stays a face branch until the launcher seam is designed.

**Class B — registered verb with a copied face → route table.**
1. Add `cli.route` + `cli.spec` to the existing command; delete its cli.mjs face copy + branch.
2. The bijection gates accept either door; the route-derived gate forbids a re-implementation
   surviving in the ladder (a delegating branch must call `runCommandFace` — the bare
   `aof project` default is the sanctioned example).

**Class C — cascade port (a mutation that owes consequences).**
1. Declare/extend the event in `src/effects/table.mjs` (payload carries its own evidence: refs, dirs,
   outcome, workspaceRoot — never a ping). Reactors idempotent or event-id-deduped.
2. Route the write through a transition seam (`run-transitions.mjs` or a sibling for the store);
   delete every inline copy of the consequence at every call site.
3. Land the writer-isolation/gate updates in the SAME change (the status-rollback-bounded
   precedent), plus a ledger scenario in `effects-ledger.feature`.

**Every class:** no behaviour change, byte-identical output where asserted; focused suites only
(`AOF_GLOBAL_HOME="$(mktemp -d)"`, never the full suite on the control node); deploy = install +
desktop-app restart; the soak stays live.

## d1 — the remaining verb inventory (order = dependency-light first)

Wave 1 — **assets/packages/project completion**: ✅ DONE 2026-07-28 (tail landed same day).
Migrated as registry Commands (each with route + spec, byte-identical renders, pinned by
`config-family.feature` + the legacy features running through them): `assets
show/add/remove/use/unuse/validate/clean/apply`, `packages show/add/remove/validate/install`,
`project validate/doctor/migrate`. Face grew two adapters with this wave: **async `cli.argv`**
(interactive completion — assets:add prompts for a missing kind/id in the argv adapter, run()
stays headless) and **`cli.exit(result)`** (validate/doctor findings gate the exit code; the one
policy stays in the face). Helper moves: `parseRuntimes`/`hasRuntimeOptions` → `spine/flags.mjs`,
`formatApplyAction` + `formatFriendlyApplyAction`/`successMarker`/`relativeDisplayPath` →
`render-plan.mjs`, `packageDiagnostics` → `packages.mjs`, the shared validation report →
`commands/validate-shared.mjs` (the insert-shared idiom); the frameworkInstall/installFromLock
machinery lives in `commands/packages-install.mjs`, `runtimesForApply` in
`commands/assets-apply.mjs`. The two big flows follow the **pure-outcome write-verb idiom**:
run() executes and returns a mode-discriminated outcome, the render reproduces the retired
transcript byte-for-byte and in order — with two documented (previously unasserted)
normalisations on `packages install`: the terminal "Framework install/replay failed for …"
summary ends the stdout document instead of riding a thrown error to stderr (pinned in
`packages.feature`), and non-dry-run `--json` now emits one structured document.
`interactiveInstallCommand` deleted (dead, zero callers). **Still inline by design:** `assets ui`
(launcher idiom), top-level `init` (shares apply's machinery + the d4 writeLock item).
cli.mjs: 3,419 → 2,472 lines.

Wave 2 — **the work family's remaining faces**: ✅ DONE 2026-07-28. All 21 remaining
registered faces ride the route table (class B): `work list/validate/next/doctor/feedback`,
the run verbs, `continue/refine/verify` (the phase-door factory parametrises its own route),
the `insert-*` family + `promote-gap`, `work upgrade` (route; top-level `aof upgrade`
delegates through `runCommandFace` — the bare-`aof project` precedent), `import milestone`,
`migrate` (a one-word route), and the four-word notion routes (`work integrations notion
sync-work/associate` — their missing-arg usage refusals moved into the argv adapters, thrown
before invoke). DELETED from cli.mjs: `runVerbCli`, `workInsertCli`, `workListCommand`,
`workValidateCommand`, `workDoctorCommand`, `workNextCommand`, `workFeedbackCommand`, the
run-verb wrappers, `upgradeCommand`, `migrateCommand`, `importMilestoneCommandCli`,
`notionSyncWorkCli`, `notionAssociateCli`; the import/packages/notion group ladders are
unknown-shims only. Face grew with this wave: `faceCtx` now reaches `cli.json`/`cli.exit`
(doctor's --strict gate + strict-aware json summary; validate's findings gate), and the ONE
--json error envelope carries a structured `shifted` count when the error has one (the insert
confirm refusal's pinned contract). `INSERT_FLAGS` shared in `insert-shared.mjs`.
`acd-migrate-command-cli-bijection` updated to the route-or-ladder form (the work-bijection
precedent). cli.mjs: 2,472 → 1,990 lines.
CLI-only-by-design verbs (`work find/observe/init/update/memory/orchestrator/delegation*/
*-headroom`, `planning init`, `session`): register as Commands with `route` when touched;
they are LOW priority — no cascade surface, no face copies.

### Owed from waves 1+2: ✅ ALL THREE PAID 2026-07-30 (with the wave-3 landing)

1. **`cli.ps1` DELETED** (the operator-owed decision, taken with the wave-3 landing): the .mjs
   runner supersedes it — convention resolution means a new feature never edits a runner; the
   hand-kept feature map was the ladder disease itself. Gone with it: the five `.steps.ps1`
   modules, the `test:integration:ps` npm script, the README line.
2. **`work:doctor --strict` pinned**: `command-spine.feature` grew the advisory-gate scenario
   (a warn-carrying stream — the no-stories milestone fixture — exits 0 bare / 1 under
   `--strict`, `errors` 0 and the same `milestone-no-stories` finding both ways). The common
   grammar's JSON-field step now accepts integers alongside booleans/strings.
3. **Dead compat dropped**: `list`/`next`/`validate`/`doctor` read `faceCtx.positionals`/
   `faceCtx.options` only — the pre-route `faceCtx.scope`/`faceCtx.strict` left-hand sides are
   gone (zero callers confirmed by grep).

Wave 3 — **graph + mesh registered verbs**: ✅ DONE 2026-07-30 (the unregistered mesh tail
remains — see below). Graph: `build/query/triage/impact` carry `cli.route` + `cli.spec`
(class B); `graphVerbCommand` + its four branches DELETED; `graph serve` keeps the launcher
idiom as a ladder branch. Mesh: `identity/status/heartbeat/relay/invite/join/revoke/logs/
terminal-resume` carry routes (class B); `meshVerbCli` DELETED. Its three face behaviours
moved: **`--workspace <path|id>` resolution into the generic face** (`resolveWorkspaceRoot` in
face.mjs — path-or-descriptor-id, `workspace-unresolvable`/`workspace-unknown` codes, active
only for commands declaring the flag), **the positional discipline + read-miss split into
`commands/mesh-face-shared.mjs`** (`guardMeshPositionals` thrown from argv adapters,
`refuseReadMiss` thrown from identity's render/json — byte-identical refusal text, the
command-level null untouched for other faces). The face also grew the **raw `--json` scan**
(the meshVerbCli precedent, now THE policy): a spec-parse refusal under `--json` is ONE
envelope on stdout, never a stderr leak. **`mesh:serve` deliberately carries NO route** — the
route table matches words only, so a routed ["mesh","serve"] would swallow `--serve`; its
ladder branch delegates the bare probe through `runCommandFace` (the bare-`aof project`
sanctioned form) until the launcher seam is designed. `emitMeshError` SURVIVES for the three
CLI-only nested verbs still calling it (repo/assign/recover-push) — it dies with them.
Gates: `acd-graph-command-cli-bijection` + `acd-mesh-command-cli-bijection` proof (b)
rewritten to the route-OR-ladder form (the work-bijection precedent).
**Documented contract change (previously pinned):** an unknown flag on a mesh verb under
`--json` now emits code `unknown-flag` (the face's more specific vocabulary) instead of the
mesh face's folded `invalid-input`; the message is the face's `Unknown flag "--x" for
mesh:<verb>. Usage: …` form. `test/mesh-identity-cli-face.test.mjs` updated. Two STALE pins
fixed en route (pre-existing at HEAD, verified by stash): the identity frozen-schema key
lists in `mesh-identity-cli-face` + `mesh-identity-status-commands` still expected `skills`,
removed from the descriptor at 34/02 by operator directive. cli.mjs: 1,990 → 1,752 lines.

Wave 3 tail, part 1 — **the flag-bearing nested verbs as Commands**: ✅ DONE 2026-07-30
(class A). `mesh:assign` (route ["mesh","assign"], `--to`/`--withdraw` + the
`--workspace` flag — the STATE residual closed), `mesh:recover-push`
(["mesh","recover-push"], `spec.workspace: false` — global-store oriented, runs from
anywhere like the retired face), `mesh:repo-publish` (the THREE-word
["mesh","repo","publish"] route — the four-word notion precedent). Cores stay in their
modules (a core's `{ ok:false, error, code }` becomes a THROWN command error in
mesh:assign's run; recover-push's run RETURNS coded outcomes verbatim). DELETED from
cli.mjs: `meshRepoCommand`/`meshAssignCommand`/`meshRecoverPushCommand`,
`MESH_REPO_FLAGS`/`MESH_ASSIGN_FLAGS`/`MESH_RECOVER_PUSH_FLAGS`, and **`emitMeshError`
(zero callers — the generic envelope is the one home)**. The repo no-verb/unknown-verb
shim stays in meshCommand (refusals a route cannot express). `acd-desktop-verbs-outside-
bijection` REWORKED in the same change: it now pins the LAUNCHER boundary only — `ui`
(launcher) + `repo` (shim) ladder-only-and-unregistered; assign/recover-push moved INTO
the mesh bijection (proof (b) reads each command's OWN declared route, so the three-word
route counts). Two carried-over contracts documented: `mesh recover-push --json` prints
the coded result VERBATIM at exit 0 even on failure (the retired face's shape — callers
read `ok`/`code` off the document; non-json stays stderr + exit 1), and its pre-invoke
"Requesting recovery push…" stdout progress line is DROPPED (the face's one-document
discipline). Two `command-spine.feature` scenarios pin the routed refusal envelope + the
three-word route. Fixed en route (pre-existing at HEAD, macOS-only):
`test/support/mesh-assign-fixture.mjs` now realpaths its root — the raw symlinked
os.tmpdir() made the fixture's path-derived workspaceId disagree with the spawned CLI's,
so the already-active cross-process scenario could never match rows on macOS. cli.mjs:
1,752 → 1,520 lines.

Wave 3 tail, part 2 — **the launcher seam + the launcher verbs**: designed + landed
2026-07-30. **THE SEAM (`cli.launch`):** a command whose real body is a long-lived
foreground process declares ONE optional adapter, `cli.launch(options)`, consulted by
the generic face after spec-parse. `null` ⇒ not launcher mode (the normal
probe/invoke path). A function ⇒ the launcher body: the face first runs
`await cli.argv(positionals, options)` (so the positional discipline + input shaping
govern BOTH doors), then awaits `body(input, faceCtx)` until the process ends. The
body owns its workspace posture (required for serve, best-effort for ui), its
announce lines, its friendly coded refusals (stderr + exit 1, never a stack for the
expected classes) and its signal-driven shutdown; it lives in the command's own
module, never the face file. **The probe rule: `--json` NEVER launches** — the face
checks `options.json` BEFORE consulting `cli.launch`, so every launcher verb's
machine face is its non-blocking registered run (the probe) by FACE POLICY, and no
bijection spawn-probe can ever hang on a serve. The face never sweeps effects after
a launch (a daemon owns its own drain). Landed on the seam: **mesh:serve** (route
["mesh","serve"] + a declared `serve` boolean; bare = the probe, `--serve` = the
daemon body moved whole into commands/mesh-serve.mjs; the "route would swallow
--serve" objection died with the seam), **mesh:ui** (class A: probe run =
`meshUiProbe` — port/scope/projectDir/uiBuildPresent/relayConfigured, non-blocking —
launch body = the fleet server moved whole into commands/mesh-ui.mjs;
`MESH_UI_FLAGS` retired). **mesh desktop install/run are NOT launcher verbs** (one-
shot: install copies files, run spawns DETACHED and returns) — they landed as plain
class A three-word routes `mesh:desktop-install` / `mesh:desktop-run` (flags
--install-dir / --app-artifact / --bootstrapper-artifact; ctx-injected
env/spawnFn/artifact seams preserved for the white-box tests), with the desktop
no-verb/unknown-verb SHIM staying in meshCommand (the repo-shim precedent).
DELETED from cli.mjs: `meshUiCommand` + `MESH_UI_FLAGS`, `meshServeDaemonCommand`,
the serve/ui ladder branches, the meshDesktopCommand dispatch (the mesh-desktop face
fn + its local parser/envelope die in mesh-desktop.mjs). Documented contract
changes: `mesh serve --serve --json` now emits the PROBE document (previously
started the daemon with --json ignored); launcher/desktop verbs adopt the family's
loud refusals (`Unknown flag "--x" for mesh:<verb>` replacing `Unknown option
"--x".`, code `unknown-flag`; stray positionals refused via guardMeshPositionals
where they were silently ignored). Gates moved with the shape:
`acd-desktop-verbs-outside-bijection` → **`acd-launcher-seam`** (the shims stay
ladder-only + unregistered; every cli.launch command keeps a runnable probe; the
face's json-before-launch ordering is pinned structurally + self-checked);
`acd-mesh-ui-global-default`'s structural half + `acd-terminal-stream-transport-
wired` inv. 7 now read commands/mesh-ui.mjs; the mesh bijection argsFor maps
ui/desktop-install/desktop-run.
**Part 2 continued (same day): the remaining launcher verbs onto the seam.**
`graph:serve` (probe = `mcpServeProbe` — server identity + protocol + the tool
descriptors off the commands' own frozen schemas; launch = the serveStdio loop,
its own loadWorkspace), `work:ui` (probe = `boardUiProbe` — port/projectDir/
uiBuildPresent/boardUrl; launch = the board body, byte-identical announces +
refusals), `assets:ui` (probe = ports + editor URL; launch = the setup-UI body
INCLUDING the `--no-serve`/`--dry-run` not-started print — a seam body need not
be long-lived — and the DEV-ONLY vite re-exec moved with it, still routing
through assetBase so acd-sea-safe-asset-base needs no edit). The assets + graph
group ladders are unknown-verb shims only now. Gate deltas: work/graph bijection
argsFor map `ui`/`serve` (probe spawns); `work:ui` joins the route-coverage
BOARD_DEFERRED carve-out (the verb IS the door into the board — a board serving
a launch-the-board route is a category error, documented there);
`acd-launcher-seam`'s armed list pins all five riders. One command-spine
scenario pins all three probes.
**End state (still owed):** the low-priority CLI-only verbs (work find/observe/
init/update/memory/orchestrator/delegation*/*-headroom, planning init, session,
top-level init, project provision's face copy); then `parseOptions` + its
boolean allow-list have zero callers and are deleted; `helpText()` derives its
verb listing from the registry.

Also owed in d1 (PRD): invert the four upward imports into `commands/`, break the
`mesh-repo` ↔ `mesh-worker-execution` cycle, and confine `console.log` to the face
(an arch gate per item, landed with the fix).

## d2 — the run-completion sweep: ✅ PORTED 2026-07-28 (live drill owed)

All 7 worker-side `completeRun` sites in `src/mesh-worker-execution.mjs` now settle through
`transitionRunComplete` (journal honoring the injected `globalWorkStoreOptions.env`); the
`acd-effects-ledger` gate pins `completeRun` reachable ONLY from the store + the transition seam:

| Site | Path | What changed |
|---|---|---|
| withdraw settles (pre-spawn / live-PTY / direct) | `cancelled` | cascade declared (rollback reactor skips on cancelled by design); the settle event is durable |
| the execution bracket's settle | done/failed | the MAIN one — a FAILED worker run now rolls the primary checkout's item back via the declared reactor (the "8 sites, 1 rollback" disease dies), `failureReason` structural |
| ghost-record startup reclaim | `failed/runtime_offline` | rides the ledger; a crash mid-settle leaves pending steps, not a ghost |
| terminal-resume settle + its generic-catch | done/failed | same cascade as the bracket |
| `run-store.mjs` internal reclaim (run-start's scan) | restart reclaim | stays store-internal; ports when the two reclaim halves unify (d4) |

Worker sites pass no `workspace` (payload `workspaceRoot: null` → the publish reactor skips) — the
pre-port behaviour, deliberately: worker-side projection publish is d3's `settle-assignment`
territory, and publishing from inside a worktree re-opens the phantom-workspace class until the
pinned-id path is universal. **What remains for d2: the exit drill on the live soak — kill a
worker between transition and settle → the settle lands on the next drain.** `run.started` joins
the vocabulary only when a real reactor wants it, never speculatively.

## d3 / d4 / d5 — unchanged from the ROADMAP, now with their substrate named

- **d3** — the durable outbox drains remote-locus (`control-store`) steps over the existing
  worker-stream cursor; `control-stream-server` apply-handlers → guard + append into control's
  OWN journal; control's converge tick calls `drainEffects` with control-reachable loci; the
  holder/terminal-never-regresses guards move inside the shared transition.
- **d4** — the cascade sweep: `publish-on-mutate` becomes the `local` reactor everywhere (the 3
  remaining `withGlobalWorkPropagation` importers — `run-start.mjs`, `feedback.mjs`, plus the
  publisher itself — then the "no import outside effects" gate); the two reclaim halves unify on
  one transition edge; insert/reindex raises `stream.reindexed` (run-record refs, Notion sidecar,
  projection remap); the two `writeLock` bypasses (`aof init`, `project migrate`) adopt
  read-merge; Notion sync becomes `integration:notion` reactors deduped by contentHash.
- **d5** — FACT/PROJECTION classification per store; `aof doctor --explain <event>` renders the
  EFFECTS entry + journal state, `--converge` drains; the file-store reconciler scan closes the
  write-vs-append crash window `run-transitions.mjs` documents.

## Standing risks / notes

- ~~`acd-bundle-manifest-hashes` RED~~ FIXED 2026-07-28: manifest regenerated
  (`scripts/generate-bundle-manifest.mjs`, 81 entries) at the operator's direction; gate green.
- The face's post-invoke sweep announces drained steps on stderr; stdout stays one document.
- `node:sqlite` prints an ExperimentalWarning on stderr in bare invocations (daemons/tests set
  `NODE_NO_WARNINGS=1`); cosmetic, pre-existing class (the projection uses the same driver).
