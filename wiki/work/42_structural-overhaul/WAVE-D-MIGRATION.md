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
**The CLI-only batch, first half (same day):** `work:find` (class A — the
bare-array --json document and the no-match stdout+exit-1 read-miss carried,
--json staying `[]` at 0 via a faceCtx-aware cli.exit), `work:observe` (class A
— spec.workspace:false, the --if-enabled gate loading its own workspace;
documented change: a skipped `--if-enabled --json` run now emits ONE
`{ skipped:true }` document where it printed nothing), `work:use-headroom` /
`work:unuse-headroom` (class A — the cores' injectable `log` becomes a
COLLECTOR: the install hint rides the result as `notes`, so the render
reproduces the transcript in order and the NEW --json face stays one document),
`project:provision` (class B — route + spec added; the projectProvisionCli face
copy deleted; spec.workspace:false since its run never read ctx.workspace — the
old best-effort load fed nothing). Route-coverage carve-outs + bijection
argsFor rows landed with them; three command-spine scenarios pin the find
read-miss split, the one-document config verb, and the provision route.
**The CLI-only batch, second half opener (same day): work:init / work:update**
(class A, the pure-outcome pair in commands/init-update.mjs — one module, the
shared notInstallable renderer as LINES). The refusal-shape decision: the
guarded / not-initialised message now ENDS THE STDOUT DOCUMENT (render) with
cli.exit gating 1 — the packages:install normalisation precedent (previously
stderr) — while the --json refusal doc keeps its exact retired shape
({ guarded|notInitialized, manifest, message }). The work bijection's spawn
proof adopted the mesh gate's [0,1]-for-coded-refusals policy for `update`
(the bare fixture is legitimately not-initialised). Fixed en route
(pre-existing at HEAD, verified by stash): work-init's codex pin still expected
`[--solo]` in the refine argument-hint, removed from the bundle long ago.
**The CLI-only batch, closing half — the d1 END-STATE REACHED (2026-07-30):**
`parseOptions` + its global boolean allow-list and `printJson` are DELETED;
every registered verb's flag vocabulary is its own cli.spec, and `helpText()`
derives its verb listing from the registry. The last five faces landed as
class A:
- **The model-config trio** (`work:orchestrator` / `work:delegation` /
  `work:delegation-model`, one module `commands/orchestrator-delegation.mjs` —
  the aof:delegate skill's surface). The two ritual moves: PROMPTS into the
  async argv adapters (the orchestrator-model picker + its
  AOF_ORCHESTRATOR_INPUT seam, exported from work-orchestrator.mjs; the
  assets:add precedent), PRINTS into collector-fed renders (the headroom
  precedent — the cores' `log` collects `notes`; byte-identical transcripts
  smoked for show/set/hint/skip/model-only). NEW --json faces (one document,
  notes stripped; previously --json was accepted-and-ignored); `--show` is the
  machine probe the bijection spawns. Documented changes: a bad `--model` is
  refused in the FACE pre-write (code `invalid-input`; previously the toggle
  flipped first and the error followed), the delegation prompt now fires
  pre-invoke (before the toggle lines print — the one-resolved-input
  discipline), and a stringly `--state` is no longer silently accepted.
- **`planning:init`** (`commands/planning-init.mjs`, route ["planning","init"]).
  The printing core's injectable log is a collector; the render reproduces the
  retired transcript in order (dry-run preview, boundary prints, codex degrade
  + manual fallback, the Pinned/Installed/Manifest tail). The
  guarded/sha-rejected/install-failed refusal message now ENDS THE STDOUT
  DOCUMENT (the packages:install normalisation) with cli.exit gating 1; the
  --json refusal document keeps its exact retired shape. Runtime/scope
  validation stays the core's (the face's duplicate pre-checks retired); a
  thrown refusal under --json is now the ONE envelope (previously a stderr
  leak). planningCommand is an unknown-sub shim.
- **`project:init`** (`commands/project-init.mjs`, the top-level `aof init` on
  the one-word route ["init"] — the migrate:folder precedent). Interactive
  selectRuntimes completes in the async argv; the config-exists/legacy guards
  are CODED refusals in run() (`config-exists` / `legacy-config`, retired
  messages verbatim), with an argv-side guard PEEK so the picker never opens
  when run() will refuse (the retired guard-before-prompt order,
  single-entry-two-mode's pin — the authoritative decision stays in run()).
  The catalog-era flags (--items/--defaults/--select) are declared only to
  keep their helpful retired refusal. writeInstallLock moved with it (still
  wholesale — the d4 writeLock read-merge item untouched). NEW --json face.
- **meshCommand's usage parse** — the parseOptions call became the shims'
  token-scan idiom (first non-flag token = sub; --json by raw scan). Corner
  case documented: `aof mesh --unknownflag value` now treats `value` as the
  (unknown) sub where parseOptions consumed it as the flag's value.
- **`helpText()` REGISTRY-DERIVED** — the shape decision: a Usage block for
  the one-word routes (init, migrate), then per-family sections (Project /
  Assets / Packages / Work / Planning / Graph / Mesh / Import) listing each
  routed command's own `cli.spec.usage` in registry order, then a static tail
  (`Also:` for the deliberately-unrouted work memory / session doors +
  the Defaults prose). lifecycle.feature's one stale help pin updated to the
  derived assets:add line.
Gates: the trio joins the work bijection (argsFor: `--show --json`) and the
route-coverage BOARD_DEFERRED carve-out; four command-spine scenarios pin the
trio's probes, the pre-write model refusal, the planning dry-run document, and
the init route (coded guard + dry-run plan + catalog refusal). Fixed en route
(pre-existing at HEAD, verified by stash): command-core-contract's WORK_IDS
still ended at wave (b) — the wave-2/3 additions (init/update/find/observe/
headroom pair/ui) had never joined the exact-set assertion, so the suite was
red on every machine that ran it; the closing-half trio landed in the same
edit. (`work memory` and `session` stay laddered by design — they delegate
wholesale and carry no parseOptions.) cli.mjs: 921 → 647 lines (3,419 at the
wave's start).

### The last three d1 items (the PRD's layering + printing half): ✅ ALL PAID 2026-07-31

With these, **leg d1 is COMPLETE** — every registered verb rides the route table, the
flag vocabularies are per-command specs, and the module graph underneath is acyclic and
one-directional.

1. **The four upward imports INVERTED** — `commands/errors.mjs` → `src/command-error.mjs`
   (the error contract is a contract, not a command: faces, commands AND cores share it,
   33 sites repointed); `aofVersion()` **DELETED** (a try/catch wrapper around
   `packageVersionString()`, which has degraded to `""` on its own since the SEA
   asset-base seam — a second door to one fact; the four publishers now read it one way,
   and run-start's import was dead); `assignWork`/`withdrawWork` → `src/mesh-assignment.mjs`
   (the fleet UI server calls the core directly — routing it through the registry instead
   would have made `mesh-ui-serve` ↔ `commands/mesh-ui` a NEW cycle), taking dead
   `assignError` with it.
2. **The cycle BROKEN** — `src/mesh-repo-marker.mjs` owns the `mesh.repo` config subtree:
   the published-marker writer (+ git-remote detection, userinfo strip) and the clone-URL
   shape rule. `mesh-worker-execution.mjs` imported the writer UP from
   `commands/mesh-repo.mjs`, which imported the shape rule back DOWN — both facts are
   about the same subtree and neither belongs to a command, so both former sides now
   import downward. The command keeps the VERB.
3. **`console.log` CONFINED** — the printing DEFAULTS are gone (9 sites, 5 modules: the
   headroom pair, the delegation trio, the orchestrator pair, planning-init's two,
   runMemory) — every routed caller already injected a collector, so the defaults were
   dead in production and live only as a hazard; an un-injected core is now silent by
   contract (`NO_PRINT`). `work-memory.mjs` gained the face/core split its module shape
   was hiding: the ladder FACE injects `console.log` visibly, the core defaults to
   NO_PRINT.

Gates (registry-/source-derived, self-checked, registered in `scripts/test.mjs`):
**`acd-command-layer-imports-downward`** — (a) no `src/*.mjs` statically imports
`src/commands/*` (cli.mjs + command-core.mjs exempt: they ARE the layer's doors),
(b) no dependency of a command reaches back into `commands/` (the direct no-cycle proof).
Dynamic `import()` is deliberately not an edge — it defers past module init, which is what
makes it the sanctioned escape hatch. **`acd-console-log-confined`** — the printer set is
CLOSED, declared with a reason per row (the two faces, the four `cli.launch` bodies,
prompt.mjs + terminal-ws.mjs, and the two deliberately-unrouted ladder doors), a RATCHET
that may only shrink (a stale row is a failure — it would silently license a re-print), and
a ban on `log = console.log` defaults in either retired shape.

Two existing gates moved with the shape rather than being weakened:
`acd-mesh-ui-no-core-import` and `acd-fleet-face-single-mutation-route` pinned
`./commands/mesh-assign.mjs` as the ONE sanctioned write door — the door is now
`./mesh-assignment.mjs` and their `commands/*` deny-lists have no carve-out left at all.

No behaviour change. Verified: arch sweep **714/714 across 225 files**, focused suites
210/210, BDD integration **124/124**, CLI byte smokes unchanged. (Standing red, pre-existing
at HEAD and unrelated — `memory-integration`'s real-index count assertion, 381 ≠ 405.)

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

## d3 — bridge facts and the durable outbox: ✅ DONE 2026-07-31

Two landings, in order.

**(1) The guard move (`src/effects/assignment-transitions.mjs`).** `updateAssignmentState`
is guard-free by design — "its callers own the transition rules" — and had three
callers, exactly one of which owned any: the control stream's apply handler, which grew
the T6 holder check and terminal-never-regresses because worker frames come through it.
The withdraw verb re-derived a weaker copy inline; the reclaim tick had none, so a race
between a settling worker frame and the tick could reclaim a just-settled row. The rules
now run ONCE, in front of the write, for every writer; the store writer is gate-pinned
reachable only from its own module and the seam. Deliberately no "same state is
idempotent" exception (at the frame door a repeat is indistinguishable from a stale
broadcast — the status-uplink outline pins it); withdraw answers its own repeat by
returning the settled row without asking for a write. The settle raises
`assignment.settled`, whose first reactor is the `record-item-branch` write that used to
be an inline line at the frame door.

**(2) The outbox (`src/effects/outbox.mjs`).** No second queue: a remote-locus step is
already a durable journal row, so the outbox is its delivery half.

| Property | Why it is the cure |
|---|---|
| Delivery ≠ completion | The step stays owed until the control node ACKs `(eventId, reactorKey)` — the async-RPC receipt the PRD asks for. A frame lost in flight, or a control that died mid-apply, redelivers. |
| An offline send is not an attempt | Being offline is the normal case. Burning the retry budget against nobody is exactly how the original defect lost the fact. |
| A DECIDED refusal ends the step | Retrying against a decision (not-holder, already-terminal) returns the same decision forever. |
| The bridge door re-decides nothing | It guards the vocabulary, appends into CONTROL's own journal (durable before executed), drains with `CONTROL_LOCI`, and replies. The fact settles through the same transition, so a non-holder is refused identically at both doors. |

**What rides it:** a TERMINAL report (done/failed) is a FACT and goes durable — the nine
report sites in `mesh-worker-execution.mjs` plus the startup-reclaim broadcast in
`mesh-launcher.mjs`, which is the site STATE measured as fire-once. POSTURE
(accepted/running/needs-input/resumed) stays a best-effort status frame: the next tick
re-carries it and a lost one costs nothing. `assignment.reported` is its own event rather
than a reactor on `run.completed` — a run can complete `done` and still fail to push, and
"a done means the push succeeded" is the contract control depends on.

Tests: `test/mesh-effects-outbox.test.mjs` (8 lanes — the deferral, the sent-but-owed
step, the OFFLINE→online redelivery as an executable statement of the defect, the ack
vocabulary incl. duplicate/unknown acks, end-to-end through the real bridge door, the
door's three guarded refusals, and the same step running in place on a control node).
Gates: `acd-assignment-transition-seam` (4 proofs incl. the guard exercised over the whole
state matrix); `acd-assignment-status-authored-by-holder` reworked to prove T6 in its two
halves (the door PASSES the identity, the seam COMPARES it) rather than being weakened.

**Deploy note:** worker and control must move together — a worker on this build shipping
to an older control gets no ack, so its steps stay pending (nothing is lost, but the row
settles only once both sides are current).

## d4 — the cascade sweep: 🟡 PARTIAL 2026-07-31

**PAID — the `writeLock` bypasses.** `aof init` and `project migrate` wrote the WHOLE lock
document, so either one run against a workspace that already had work or planning
installed silently deleted the other's section. `mergeLock` (lock.mjs) is the read-merge
home: read, overlay only the keys this caller owns, write the union; absent/torn reads as
a fresh install rather than blocking one. Gate `acd-lock-read-merged` in two halves —
structural (no raw-text lock write anywhere in `src/`) and behavioural (work + planning
survive an init patch; absent and torn locks are fresh installs). Found mid-change by the
BDD lane, which is the argument for that lane: the first cut left `project-migrate`
without its import and two scenarios failed on `mergeLock is not defined`.

**PAID — port 1: publish-on-mutate is a `local`-locus reactor.** `withGlobalWorkPropagation`
is DELETED. Whether a mutation propagated its workspace used to be decided by whether that
command's author remembered to import the wrapper — three verbs did, every other mutation
did not, and nothing said so. `publish-projection` is now one reactor in `effects/table.mjs`
hung off three declared events, and a command can neither forget it nor opt itself out.

*The blocking design question, settled: **the face threads the warnings back.*** As a reactor
the publish warning arrives in the effects OUTCOMES, so the choice was to surface it there
(changing two verbs' `--json` shape) or thread it back onto the result. Threading wins on
three counts: d2's `work:run-complete` port ALREADY does exactly this, so the alternative
would have created a second convention for one fact — m42's own disease; `propagationWarnings`
is the established contract of all three verbs and a warning about a command's own consequence
belongs on its result; and the house rule is no behaviour change without a reason to document
one. The threading itself is a shared function — `threadPropagationWarnings(result, effects)`
in `global-work-publisher.mjs`, the ONE home — and run-complete's inline `.find()` copy died
into it. **The port is invisible on the wire:** run-start/feedback deliberately did NOT grow
an `effects` key (their cascade is asserted in the journal instead), and the CLI byte smoke
(both verbs, human + `--json`, mesh-off AND mesh-on, plus run-complete/run-retry) is
byte-identical against HEAD.

The seams that raise the events, since a fact must not be reachable without its consequence:

| Event | Seam | Mint/write sites routed through it |
|---|---|---|
| `run.started` | `effects/run-transitions.mjs` — `transitionRunStart` (wraps startRun/retryRun) | `work:run-start` (×2 edges), `work:run-retry`, the worker's two (`mesh-worker-execution.mjs`) |
| `feedback.recorded` | `effects/doc-transitions.mjs` — `transitionFeedbackAppended`, the THIRD seam (the record-doc store), which `appendFeedbackBullet` moved into | `work:feedback` — and with it the board's `POST /api/work/feedback`, which reaches the fact through the same door |
| `run.completed` | unchanged (d2) | unchanged |

`run.started` joins the vocabulary now because a real reactor wants it (the rule d2 set), and
ALL FOUR mint sites route through the seam — the d2 completeRun sweep's precedent — so the
event never lies about a mint that raised nothing. The three mint sites that never published
still don't: they pass no `workspace`, so `workspaceRoot` is null and the reactor skips
(deliberately verbatim from d2's worker sites; worker-side publishing stays d3's territory).
Whether a RETRY should propagate is a real open question and is deliberately not smuggled into
a mechanical port. The reactor reads its publisher injection seam from `ctx.publisherOptions`
(the command ctx the transition passes through) — what the retired wrapper forwarded; a
crash-recovery drain supplies none and opens its own, as the reactor contract requires.

Gates: **`acd-publish-on-mutate-ledgered`** (4 proofs — the wrapper is gone from `src/` as a
ratchet; `publishGlobalWorkSnapshot` is reachable only from the reactor plus the two sanctioned
NON-cascade publishers, `mesh repo publish` and the launcher's propagation tick; every
propagating event carries the publish reactor at `local` locus and it is ONE function for all
of them; and the threading contract proven end-to-end through `invoke()` with the publish
injected to fail). `acd-effects-ledger` grew the mint-reachability proof (`startRun`/`retryRun`
callable only from the store + the seam — completeRun's shape) and lists the new seam as an
event-raiser. `acd-board-write-isolation` FOLLOWED the writer to the seam and got stronger:
board-ui.mjs *and* commands/feedback.mjs now both write nothing at all.
`acd-assignment-run-store-mesh-blind`'s node-as-DATA proof accepts the seam spelling.
BDD: two `effects-ledger.feature` scenarios (the mint's journaled event + its publish step; the
record-doc write beside its event), asserted at the journal rather than the result envelope
because the wire did not change.

**REMAINING — three ports, in the order they should land:**

1. **The two reclaim halves unify** on one transition edge + shared cascade
   (`run-store.mjs`'s internal restart reclaim + `mesh-assignment-reclaim.mjs`).
2. **`stream.reindexed`** — insert/reindex mutates refs that key six stores and tells
   none; the Notion sidecar mis-binding is the visible symptom.
3. **Notion status sync → an `integration:notion` reactor**, deduped by contentHash.

## d5 — unchanged from the ROADMAP, now with its substrate named

- **d5** — FACT/PROJECTION classification per store; `aof doctor --explain <event>` renders the
  EFFECTS entry + journal state, `--converge` drains; the file-store reconciler scan closes the
  write-vs-append crash window `run-transitions.mjs` documents.

## Standing risks / notes

- **Pre-existing red on this control node** (verified by stash at HEAD, unrelated to wave (d)):
  `memory-integration`'s real-index count (381 ≠ 405); `mesh-worker-driver-session-id`'s two
  absent-session lanes (`undefined` where `null` is asserted); `mesh-reclaim-scheduler`'s two
  tick lanes (EBUSY unlinking `projection.sqlite` in Windows teardown).
- ~~`acd-bundle-manifest-hashes` RED~~ FIXED 2026-07-28: manifest regenerated
  (`scripts/generate-bundle-manifest.mjs`, 81 entries) at the operator's direction; gate green.
- The face's post-invoke sweep announces drained steps on stderr; stdout stays one document.
- `node:sqlite` prints an ExperimentalWarning on stderr in bare invocations (daemons/tests set
  `NODE_NO_WARNINGS=1`); cosmetic, pre-existing class (the projection uses the same driver).
