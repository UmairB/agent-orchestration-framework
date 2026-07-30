---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 42 · Structural overhaul — one home, one door, no silence — State

## Progress

- **2026-07-30 (ninth pass): work:init / work:update onto the route table (the
  pure-outcome pair).** One module (commands/init-update.mjs) carries both; the
  retired reportNotInstallable becomes render LINES. The refusal decision: the
  guarded / not-initialised message now ends the STDOUT document with cli.exit
  gating 1 (the packages:install normalisation precedent — previously stderr);
  the --json refusal doc keeps its exact retired shape ({ guarded|
  notInitialized, manifest, message } — smoked byte-identical, incl. the full
  init→guarded→update cycle). The work bijection spawn proof adopts [0,1] for
  `update` (a coded one-document refusal is a clean probe — the mesh-gate
  precedent). cli.mjs 1,038 → 921 lines; parseOptions callers left: the
  orchestrator/delegation trio, planning init, top-level init, meshCommand's
  usage parse. Fixed en route (pre-existing at HEAD, verified by stash):
  work-init's codex pin still expected `[--solo]` in the refine argument-hint —
  removed from the bundle long ago; red on every machine. Verified: arch sweep
  709/709, BDD 120/120 (a new command-spine scenario pins the normalised
  refusal + retired json shape).

- **2026-07-30 (eighth pass): the CLI-only batch, first half — find/observe/
  headroom/provision onto the route table.** `work:find` (bare-array --json +
  the read-miss split: no-match prints on stdout and exits 1 on the human face,
  `[]` at 0 under --json — a faceCtx-aware cli.exit), `work:observe`
  (spec.workspace:false; documented change: skipped `--if-enabled --json` now
  emits `{ skipped:true }` instead of nothing), `work:use-headroom` /
  `work:unuse-headroom` (the cores' injectable `log` becomes a collector — the
  install hint rides the result as `notes`, keeping the transcript order AND
  the new --json face one-document; the first paid instalment of the
  confine-console.log owed item), `project:provision` (class B: route + spec;
  projectProvisionCli deleted — its best-effort workspace load fed nothing, the
  run only ever read ctx.env). cli.mjs 1,185 → 1,038 lines; remaining
  parseOptions callers: work init/update, the orchestrator/delegation trio,
  planning init, top-level init, meshCommand's usage parse. Verified: full arch
  sweep 709/709, BDD 119/119 (three new command-spine scenarios), byte smokes
  of every migrated path incl. the provision missing-tool refusal identical.

- **2026-07-30 (seventh pass): the LAST launcher verbs onto the seam — every
  serve verb in the CLI is a registered Command now.** `graph:serve` (probe =
  `mcpServeProbe`, the MCP identity/protocol/tool descriptors off the commands'
  own frozen schemas; launch = the serveStdio loop), `work:ui` (probe =
  `boardUiProbe`; launch = the board body, byte-identical announces/refusals —
  proven by the stdio tools/list + SIGTERM smokes), `assets:ui` (probe = ports +
  editor URL; launch = the setup-UI body including the `--no-serve`/`--dry-run`
  not-started print and the DEV-ONLY vite re-exec, moved whole — still through
  assetBase, so acd-sea-safe-asset-base needed no edit). The assets and graph
  group ladders are unknown-verb shims only; cli.mjs 1,313 → 1,185 lines (the
  commit message for 9d3a9b2 says 1,150 — written before measuring; this is the
  measured figure). Gate
  deltas: work/graph bijection argsFor map the probe spawns; `work:ui` joins
  route-coverage's BOARD_DEFERRED (the verb IS the door into the board);
  `acd-launcher-seam` pins all five riders; `acd-work-ui-rename-complete`
  reworked to the one-door form (board ladder | ui ladder | routed work:ui —
  exactly one, board's forever banned). One new command-spine scenario pins all
  three probes. Verified: full arch sweep 709/709, BDD integration 116/116,
  probe + launch smokes byte-identical. d1's remaining tail is now ONLY the
  low-priority CLI-only verbs + project provision's face copy, then the
  parseOptions/helpText end-state.

- **2026-07-30 (sixth pass): THE LAUNCHER SEAM designed + landed — d1 wave-3 tail
  part 2 COMPLETE; every registered mesh verb now rides the route table.** The
  blocked design question ("where does a long-lived foreground body live for a
  routed command?") is answered with ONE optional adapter: `cli.launch(options)`,
  consulted by the generic face after spec-parse — `null` falls through to the
  probe/invoke path; a function is the launcher body, awaited until process end
  (cli.argv runs first, so the positional discipline governs both doors; the body
  owns workspace posture / announces / friendly refusals / shutdown, and lives in
  the command's module). **The probe rule is FACE POLICY: `--json` never launches**
  — checked before the seam is consulted, so every launcher verb's machine face is
  its non-blocking probe and no bijection spawn-probe can hang on a serve by
  construction. Landed on it: **mesh:serve** (route ["mesh","serve"] at last — the
  "route would swallow --serve" objection died with the seam; daemon body moved
  whole into commands/mesh-serve.mjs), **mesh:ui** (new registered command:
  `meshUiProbe` run — port/scope/projectDir/uiBuildPresent/relayConfigured — +
  the fleet-server launch body in commands/mesh-ui.mjs; the serveMeshUi call site
  with its LITERAL mirror/input-push keys moved with it). **mesh desktop
  install/run turned out NOT to be launcher verbs** (one-shot: install copies,
  run spawns DETACHED and returns) — landed as plain class A three-word routes
  mesh:desktop-install / mesh:desktop-run with ctx-injectable env/spawnFn/artifact
  seams kept for the white-box tests; the desktop no-verb/unknown-verb shim joins
  the repo shim in meshCommand. DELETED from cli.mjs: meshUiCommand +
  MESH_UI_FLAGS, meshServeDaemonCommand, the ui/serve/desktop dispatch branches
  (cli.mjs 1,520 → 1,313 lines). Documented contract changes: `mesh serve --serve
  --json` is now the probe document; launcher/desktop verbs adopt the face's loud
  refusals (`Unknown flag "--x" for mesh:<verb>` / `unknown-flag`; stray
  positionals refused). Gates moved with the shape:
  `acd-desktop-verbs-outside-bijection` → **`acd-launcher-seam`** (shims
  ladder-only + unregistered; every cli.launch command keeps a runnable probe;
  the face's json-before-launch guard pinned + self-checked);
  `acd-mesh-ui-global-default` structural half + `acd-terminal-stream-transport-
  wired` inv.7 now read commands/mesh-ui.mjs; the mesh bijection argsFor maps
  ui/desktop-install/desktop-run. Verified: full arch sweep + focused face/mesh
  suites green, BDD integration 115/115 (four NEW command-spine scenarios pin the
  probe rule, the mesh:ui probe, the desktop three-word route and the desktop
  shim), launch-path smoke byte-identical (announce lines, EADDRINUSE refusal,
  SIGTERM clean exit). **Fixed en route (ALL pre-existing at HEAD, verified by
  stash — the Windows-authored-fixture/stale-pin class):** mesh-desktop-fixture
  seeded a mode-0644 "runnable" app (every already-installed scenario refused
  desktop-not-runnable on macOS); mesh-ui-global-scope's raw-symlink tmpdir broke
  the Project:-line identity compare (realpath, the assign-fixture precedent);
  mesh-identity-cli-face pinned a hostname-dependent roster (the machine's
  self-healed record collided with the seeded "umair-desktop" only on the author
  machine) and demanded `skills` on the six-key m34 self descriptor;
  mesh-identity-status-commands leaked node records across tests through the
  shared process-level AOF_GLOBAL_HOME (per-fixture homes now, the
  mesh-ui-global-scope idiom). Also fixed: the wave-3 tail's OWN commit left
  `acd-assignment-target-not-connected-loud` red — a mesh-assign.mjs COMMENT
  reading "({ ok:false, error, code })" trips the gate's raw-source (comment-
  blind) codeless-literal scan; reworded to the `code,` form the sibling comment
  uses. Full arch sweep 709/709 after both. Remaining in d1: `graph serve` / `work ui` /
  `assets ui` onto the same seam when their families migrate, the low-priority
  CLI-only verbs, then the parseOptions/helpText end-state; plus the PRD's
  import-inversion/cycle/console.log items.

- **2026-07-30 (check-in): waves 1+2 committed (5 commits, pushed, UNMERGED) + three residuals
  found while auditing what was logged.** Commits: bundle-manifest regen, the spine face + BDD
  harness, the effects ledger + d2 sweep, the 43-verb route-table migration, the wave-(d) ledger
  docs. The audit found three items no doc carried, now in
  [WAVE-D-MIGRATION.md](WAVE-D-MIGRATION.md) §"Owed from waves 1+2": (1) `test/integration/cli.ps1`
  — a SECOND, hand-kept step-ladder runner over the same features — is BROKEN by the restructure
  (its switch knows 6 of the now-8 features and throws on the rest) and still wired to
  `npm run test:integration:ps`; an operator decision (delete vs teach) is owed. (2)
  `work:doctor --strict` lost its only pin when the gate moved into `cli.exit` — the bijection
  accepts [0,1] and the BDD `doctor --strict` scenarios drive `project doctor`, so a regression
  would be silent. (3) Dead pre-route compat in four `faceCtx` readers. **Caveat on the history:**
  the five commits are organised for review by leg; only the branch TIP is suite-verified (the
  spine commit's feature files exercise commands that register in the later refactor commit), so
  squash-merge unless bisectability is wanted.

- **2026-07-28 (fifth pass): d1 WAVE-2 COMPLETE — the whole work family + the top-level
  faces onto the route table.** 21 more registered verbs carry `cli.route` + `cli.spec`
  (class B — the commands' adapters were already the truth; only the doors moved): `work
  list/validate/next/doctor/feedback`, `run-start/run-status/run-retry`,
  `continue/refine/verify` (the phase-door factory routes itself), the `insert-*` family +
  `promote-gap`, `work upgrade` (top-level `aof upgrade` delegates through `runCommandFace` —
  the sanctioned two-spellings form), `import milestone`, `migrate` (one-word route), and the
  four-word notion routes (`work integrations notion sync-work/associate`, usage refusals now
  thrown from the argv adapters before invoke). DELETED: `runVerbCli`, `workInsertCli`, and
  every work-family face copy (`workListCommand`, `workValidateCommand`, `workDoctorCommand`,
  `workNextCommand`, `workFeedbackCommand`, the run wrappers, `upgradeCommand`,
  `migrateCommand`, `importMilestoneCommandCli`, `notionSyncWorkCli`, `notionAssociateCli`);
  the import/notion group ladders are unknown-shims. Face growth: `faceCtx` reaches
  `cli.json`/`cli.exit` (work:doctor's --strict advisory gate + strict-aware json summary;
  work:validate's findings→exit-1 gate), and the ONE --json error envelope carries a
  structured `shifted` count when present (work-insert-cli-confirm-envelope's pinned
  contract, now the face's). 43 routes derive collision-free.
  `acd-migrate-command-cli-bijection` moved to the route-or-ladder form. Verified: focused
  arch+unit 143/0 (route-derived, work/migrate/graph/mesh bijections incl. the spawn probe of
  every work:* verb, cli-face-contract byte-pins, insert confirm envelope + count gates,
  work-list, upgrade dry-run/apply, migrate-core, notion associate/dry-run/parser, validate
  staleness, effects-ledger, silent-catch, work-list-contract); full BDD integration suite
  green (spawn mode). cli.mjs 2,472 → 1,990 lines (3,419 at wave start).

- **2026-07-28 (fourth pass): d1 WAVE-1 COMPLETE — the tail (`assets apply` + `packages
  install`) through the spine.** The two big flows are registry Commands
  (`commands/assets-apply.mjs`, `commands/packages-install.mjs`) on the pure-outcome write-verb
  idiom: run() executes and returns a mode-discriminated outcome (validation-failed / dry-run /
  strict-failed / applied; dry-run / installed), the render reproduces the retired transcript
  byte-for-byte and in order. Helper moves with them: `runtimesForApply` → assets-apply.mjs;
  `formatFriendlyApplyAction`/`successMarker`/`relativeDisplayPath` → render-plan.mjs (still
  imported by the inline work-init/work-update/planning-init faces); the
  frameworkInstall/installFromLock machinery → packages-install.mjs; `printValidationResult` /
  `printAdapterWarnings` / `strictAdapterWarningsFailed` retired onto validate-shared.mjs +
  cli.exit. Two documented normalisations on `packages install` (both previously unasserted):
  the terminal "Framework install/replay failed for …" summary now ENDS THE STDOUT DOCUMENT
  instead of riding a thrown error to stderr (the transcript would be lost under the pure model —
  pinned in `packages.feature`), and non-dry-run `--json` emits one structured document.
  `interactiveInstallCommand` deleted (dead, zero callers). The packages ladder is now an
  unknown-subcommand shim; assets keeps only `ui` (launcher idiom). NEW BDD pins: the failure
  summary on stdout, the `--json` error envelope for an unknown package, from-lock-without-lock
  refusal. Verified: full BDD integration suite green (spawn mode, incl. packages/adapter-policy
  byte contracts), focused arch+unit 96/0 (route-derived, effects-ledger, bijection,
  status-rollback, unified-lock, planning-lock, silent-catch, frameworks, clean, config-editor,
  planning-init), child-process smoke green. cli.mjs 2,749 → 2,472 lines.

- **2026-07-28 (third pass): d1 WAVE-1 LARGELY COMPLETE — 14 more verbs through the spine.**
  The assets/packages/project families are registry Commands end-to-end except the two big flows:
  `assets show/add/remove/use/unuse/validate/clean`, `packages show/add/remove/validate`,
  `project validate/doctor/migrate` — inline handlers deleted, byte-identical renders, flag
  vocabularies declared per command. The face grew its two missing adapters: ASYNC `cli.argv`
  (assets:add completes a missing kind/id interactively in the argv adapter — prompting is face
  domain; run() stays headless for board/MCP) and `cli.exit(result)` (validate/doctor findings
  gate exit 1 through the face — commands no longer touch process.exitCode). Helper homes:
  `spine/flags.mjs` (runtime-flag interpretation, one home), `formatApplyAction` →
  render-plan.mjs, `packageDiagnostics` → packages.mjs, `commands/validate-shared.mjs` (one
  validation-report engine under project:validate / assets:validate / packages:validate).
  NEW BDD: `config-family.feature` (8 scenarios — exit gates, --json envelopes, ref-verb
  refusals, legacy migration); the legacy features (lifecycle/packages/dsl/adapter-policy) now
  drive the migrated commands directly. cli.mjs 3,419 → 2,749 lines. Wave-1 tail recorded in the
  plan: `assets apply` + `packages install` (helper-module moves), `assets ui` (launcher), `init`.

- **2026-07-28 (second pass): d2 CODE-COMPLETE (the sweep) + the folder home + the manifest fix.**
  Operator direction ("regenerate; proper folder structure; continue with the next leg"):
  - **Folder home for the new approach:** the spine and ledger moved off flat `src/` into their
    own folders — `src/spine/face.mjs` (the ONE generic face + route table) and `src/effects/`
    (`table.mjs` the vocabulary, `journal.mjs` the storage, `dispatch.mjs` the topology,
    `run-transitions.mjs` the seam). Every importer, gate and doc reference moved with them; the
    `acd-effects-ledger` caller scans now pin repo-relative paths.
  - **The d2 SWEEP:** all 7 worker-side `completeRun` sites in `mesh-worker-execution.mjs`
    (withdraw pre-spawn / live-PTY / direct, the execution bracket's settle, the startup
    ghost-record reclaim, terminal-resume settle + its generic-catch) now settle through
    `transitionRunComplete` — the fact cannot land without its durable `run.completed` event, and
    a FAILED worker run rolls the primary checkout's item back to not-started via the DECLARED
    reactor (the "8 call sites, exactly 1 does the rollback" measurement is dead: it is now 0
    inline sites, 1 ledger entry). Worker sites deliberately pass no workspace (publish reactor
    skips — worker-side publish is d3 `settle-assignment` territory; avoids re-opening the
    phantom-worktree-workspace class). New gate tooth: `completeRun(` is callable ONLY from
    `run-store.mjs` + the transition seam. Suites green post-sweep: bracketing, withdraw,
    retention, reclaim, push-before-remove, liveness, completion-detection, needs-input (44
    tests), + the 4 route/ledger/rollback/bijection gate files (14), + integration 98/0.
    **d2's only remaining item is the LIVE kill-drill** (needs deploy + operator restarts).
  - **Bundle manifest regenerated** (operator call) — `acd-bundle-manifest-hashes` green; the
    arch board is back to zero standing failures.

- **2026-07-28: WAVE (d) LEGS d1+d2 — INFRASTRUCTURE LANDED, FIRST MIGRATIONS PROVEN (uncommitted
  working tree on `fix/worker-completion-and-milestone-cascade`; operator reviews/commits).** The
  spine and the ledger exist and carry real traffic:
  - **d1 (spine):** `src/spine/face.mjs` — the ONE generic CLI face (per-command `cli.spec` flag
    vocabularies replacing the global boolean allow-list for migrated verbs; the ONE `--json` error
    envelope `{ ok:false, error, code }` + exit-code policy; loud `unknown-flag` refusals) and the
    registry-derived route table (`cli.route` on the Command, longest-prefix dispatch in `run()`
    BEFORE the legacy ladder). Six verbs migrated as the worked examples of each class:
    `assets:list` / `packages:list` / `project:show` (class A — unregistered inline → Command;
    `packageSummaries` moved cli.mjs → packages.mjs), `work:doc` / `work:tasks` (class B — face
    copies deleted), `work:run-complete` (class C — the cascade port). Byte-identical output where
    asserted (`cli-face-contract` green untouched).
  - **d2 (ledger):** `effects/journal.mjs` (per-node `journal.sqlite`: events + per-reactor steps,
    one-transaction append, `busy_timeout` from birth — the projection's lock-storm lesson),
    `effects.mjs` (the closed vocabulary; `run.completed` → `rollback-status`@checkout +
    `publish-projection`@local, array order = cascade order), `effects/dispatch.mjs` (locus-routed
    drain; failures → `effect-failed` degrade + retry under an attempts ceiling, never silent;
    per-reactor outcomes ride the result envelope; journal-less ephemeral fallback so behaviour
    never gates on the ledger's health), `run-transitions.mjs` (`transitionRunComplete` — the run
    store's ONLY event-raiser; write-then-append, reconciler = d5). The face sweeps pending steps
    after every routed invoke — **the crash-window property (kill between transition and settle →
    the next drain pays) is pinned at unit level (`acd-effects-ledger`) and black-box
    (`effects-ledger.feature`)**; the LIVE kill-drill on the soak stays owed.
  - **Tests restructured integration/BDD-first** (the operator's finding: `test/integration` was
    unmaintained since ~May — why everything felt brittle): convention-resolved step modules
    (feature basename ↔ steps module, no central map), a declarative step registry + shared
    grammar, `command-spine.feature` (7 scenarios — the contract every migrated verb inherits) and
    `effects-ledger.feature` (4 scenarios incl. crash recovery), README with the
    migrate-with-a-scenario policy. Full integration suite 98/0 in BOTH spawn and in-process modes.
  - **Gates moved with the shape they assert:** `acd-work-command-cli-bijection` accepts
    route-table OR ladder (registry-derived); `acd-status-rollback-bounded` now requires
    run-complete to reach the rollback THROUGH the ledger (and forbids the direct call);
    NEW `acd-command-route-derived` (collision-free, resolvable, spec'd, no-second-door) and
    `acd-effects-ledger` (vocabulary shape, appendEvent only from the transition seam, the
    crash-window pin). Arch sweep 706/707 — the one red is PRE-EXISTING
    (`acd-bundle-manifest-hashes`: commit `2546a06` edited `aof-architect.md` without regenerating
    the bundle manifest; operator call — regenerate or amend, untouched by this work).
  - **The plan for the rest** — every remaining verb (3 waves), the 7 worker-side `completeRun`
    sites, d3–d5 — is [WAVE-D-MIGRATION.md](WAVE-D-MIGRATION.md), with the per-class migration
    rituals.

- **2026-07-27: SCOPE EXTENDED — wave (d), command spine & effects ledger.** The operator's
  command-layer review ("side effects not happening is the biggest problem with this codebase") +
  two full codebase maps found item 0's disease one level deeper than waves (a)–(c) reached: write
  seams have one home now, but **cascade seams have none** — `completeRun` has 8 call sites and
  exactly 1 does the status rollback; global publish is a per-command import decision
  (`work:feedback` publishes, `work:insert-milestone` doesn't); reindex renumbers refs that key six
  stores and tells none of them; the coupling rules live only in comments. The design was argued to
  rest in-session (command/event model; locus-per-effect routing over node-role; facts-over-the-
  bridge with directives + read-only queries as the only RPC; durable per-node journal with
  idempotent, event-id-deduped reactors; CLI sync-drain / daemon tick-drain) and is recorded as
  [PRD-command-spine-effects-ledger.md](../../planning/PRD-command-spine-effects-ledger.md).
  Execution home is THIS milestone — ROADMAP wave (d), legs d1–d5, all 🔴 NOT BUILT. SPEC gains the
  matching acceptance bullet ("one ledger per consequence") and scope wave.

- **2026-07-26 (evening): ALL ROADMAP ITEMS DONE** — see [ROADMAP.md](ROADMAP.md) for the per-item
  ledger with commits and measurements. Waves (a), (b) and (c) landed in one inline day at the
  operator's direction; two scope decisions recorded (--follow + self-restart → deferred backlog;
  comment-mass reduction → enforced convention). Remaining: LIVE verification (operator restarts on
  both machines + a real dead-run drill) — caveats, not open work. `status:` stays `in-progress`
  until the live drill passes; acceptance is `aof:verify 42`'s call.

- Framed 2026-07-26 from TECH_DEBT.md items 0–7 (operator direction: rewrite-to-a-designed-shape
  over further adhoc fixes). Operator direction (2026-07-26 pm): implement INLINE, outside the aof
  agent ceremony — this STATE is the running record.
- **Wave (a) / item 5 DONE (2026-07-26): the arch gate runs at ZERO standing failures** — 694 pass /
  0 fail across all 219 arch files (was 8 standing failures in 3 files). Retired with their dead
  subjects: `acd-sync-root-set` (src/mesh-sync.mjs eliminated by 33/ADR-002) and
  `acd-claim-relay-independent` (lease/claim path superseded by m35 assignments) — both were also
  imported-but-never-registered in scripts/test.mjs, a red gate nobody ran; the run-complete
  lease-release test inside `acd-fleet-reclaim-guarded` retired for the same reason (its three live
  siblings kept). `acd-command-namespace`'s member counts are now DERIVED (declared vs rendered),
  never hard-coded — the count treadmill (21 → red → 23 → red) is gone.
- **Wave (a) / item 2 largely DONE (2026-07-26):** `src/mesh-log.mjs` (JSONL sink, size-rotated,
  tolerant reader) wired into mesh-serve (warning tee + build-stamped daemon-started) and mesh-ui;
  `mesh:logs` registered + `aof mesh logs [proc] [--tail N]` — the derived bijection gate covered
  the new verb with no edit (item 5's payoff, first use). Deferred within item 2: remote-node read
  + --follow. Daemons pick the sink up at the next operator restart.
- **Wave (a) / m38-F26 DONE (2026-07-26):** `writeText`'s failure path now reclaims its own temp
  (error still propagates), and `sweepStaleTempFiles` (age-gated, never touches a live writer's
  fresh temp) runs at mesh-serve startup over presence/ + nodes/, logging reclaims to the sink.
  Measured + reclaimed live on the control node: 42 orphans in presence/, 6 in nodes/ (the earlier
  0-counts were plain `ls` hiding dotfiles — measurement lesson recorded). Mac clean.
- **Wave (a) / item 3 ratchet ARMED (2026-07-26):** `acd-no-new-silent-catch` — the true baseline is
  94 sites / 29 files (comment-only catch bodies count: a comment is documentation, not a runtime
  signal), pinned as a per-file shrink-only allowlist; any NEW silent catch fails the build. The
  sweep (emit into the item-2 sink) shrinks it file-by-file — remaining within item 3.
- **Wave (b) / item 7 leg 1 DONE (2026-07-26): the PTY liveness probe.** The observed killer (run
  39ec5149: agent vanished ~11 min in, no onExit delivered, assignment `running` 25+ min) is closed
  at the source — the driver signal-0s the child pid every 15s and settles `failed/agent_died`
  through the same idempotent finish() as every outcome; the existing caller path then reports
  run-complete + assignment-status failed upstream. Pid-guarded (fakes without pid unchanged),
  interval injectable. Remaining item-7 legs: worker STARTUP reclaim of own `running` records, and
  the control-side question of why dual-staleness reclaim never fired during those 25 minutes.
- Next: item 7 legs 2–3; then F23/F24 presence home; then item 4 identity home; item 3's sweep
  (94 → 0) interleaves as files get touched.

## Notes & decisions in flight

- **2026-07-26 (pre-refine) — INHERITED BLOCKER from m38's close: F23, the presence record is rebuilt
  field-by-field at THREE seams and only two know its current shape.** Found and measured at
  `aof:verify 38` (see [38's VERIFICATION.md](../38_milestone_cross-machine-worker-execution/VERIFICATION.md)
  finding **F23**); routed here at the operator's direction so m38 could close, because the defect is
  exactly wave (b)'s thesis — **one home for one derivation** — not another m38 point fix.
  - **The defect.** [`fabricLivenessFor`](../../../src/commands/mesh-identity.mjs#L212-L221) (m33/ADR-002.1)
    synthesises a pseudo presence record for every fabric-**Online** peer carrying only the original m23
    four keys (`nodeId, heartbeatAt, activeRuns, aofVersion`). Its `heartbeatAt` is `now`, so it **always**
    wins `mergePresence` — anything it omits is not merged around, it is destroyed. m38/ADR-001's additive
    fifth key `sessions` is therefore dropped for every remote node, on every tick.
  - **Consequence.** The Rust desktop's only fleet-data command is `aof mesh status --json`
    ([poll.rs](../../../app/desktop/crates/core/src/poll.rs#L20-L22)) and its `current_work()` reads
    `presence.sessions` — so a worker being actively worked on reads **`idle`** on the desktop fleet. The web
    fleet (`/api/mesh/status`, presence read straight off disk) is unaffected.
  - **Measured** (isolated `AOF_GLOBAL_HOME`, real publishers, real `mesh:status` invoke, `ctx.fabricPeers`
    injected): `online:true` → `sessions` **ABSENT** → renders `idle`; `online:false` → `sessions` present →
    renders `working · aof (session)`. **The feature works only while the fabric believes the node is offline.**
  - **What wave (b) owes it.** One home for the presence record's shape, so `assemblePresenceRecord`,
    `applyPresenceFrame` (taught the fifth key by m38's F18) and `fabricLivenessFor` cannot disagree — plus the
    fitness function that pins *every additive presence key survives the fabric-liveness merge* (RED without the
    fix). Field-by-field rebuilds are whitelists, and a whitelist silently drops what it was never told about:
    this same key was destroyed at two different seams, eight days apart, by two separate blockers.
  - **Also inherited (non-blocking, same class):** m38's **F24** — a node descriptor's `workspaces[]` is the
    *publisher's* single workspace stamped onto every node in the roster
    ([global-node-registry.mjs](../../../src/global-node-registry.mjs#L74-L104)), so both live node cards
    advertise `C:\WINDOWS\system32` (the macOS worker included) while the SQLite membership table correctly
    holds four per node — and after `ac361f8`'s cwd-phantom gate an install-dir-launched daemon can no longer
    refresh its node record to correct it. This is debt item 4's (workspace identity) live bite.
  - **And m38's F26** — the atomic presence/node publish leaks its temp file: 39 orphaned `.tmp-*` files in
    `~/.aof/mesh/presence/` + 6 in `nodes/`, newest from the running daemon (two `aof` processes publish
    concurrently; a lost rename race leaves the temp behind and nothing sweeps it). Wave (a)'s "no silence"
    territory.

- 2026-07-26 (pre-refine): the one-door rule gained its EXECUTION-SCOPE leg (operator-found
  defect: a story's Continue ran locally while its milestone ran on a worker — the door looked up
  execution by exact ref, but runs/branches/worktrees are recorded at the TOP-LEVEL item). One rule
  in one home (`executionScopeRef`/`resolveScopedExecution`, board-mesh-execution.mjs) consumed by
  BOTH the continue decision (now pure + unit-tested; third answer `running` = watch, don't
  restart; remote dispatch always at scope ref) and the row overlay (story rows inherit execution →
  the affordance disables Continue with "Running on <node>"). Wave (b) must generalise this scope
  rule to refine/verify when they get their doors.
- 2026-07-26 (pre-refine): debt item 1's core was paid down — `aof.exe` is now a payload-first
  launcher (sea-entry bootstrap; verified `import()` of external ESM works inside this SEA recipe),
  install-local defaults to a payload file-copy deploy (`--sea` only for launcher/release builds),
  BUILD_ID stamped + surfaced (`--version`, daemon startup lines), `.bak` pruning. Remaining for
  wave (c): remote build-id in `aof mesh status`. Refine should fold this in, not re-plan it.
- 2026-07-26 (pre-refine): debt item 6's doc/run legs were paid down ahead of the milestone —
  projection schema v5 (`work_item_docs`/`work_item_runs`), the worker's `worktree-content` frame,
  and the `work:doc`/`work:run-status` projection fallback. Unit-verified only; live two-machine
  verification pending (needs deploy + operator restarts). The board's embedded console leg remains
  for wave (b). Refine should fold this into the wave-(b) story rather than re-planning it.

- Sequencing is load-bearing, not stylistic: wave (a) (logs, no-silent-catch, green gate) is the
  verification substrate — without it, no later rewrite's success is observable. Do not reorder.
- The soak stays up throughout; any stage that would require stopping both nodes needs a re-think
  before it needs a schedule.

## 2026-07-27 — the live-soak day (branch `fix/worker-completion-and-milestone-cascade`, UNMERGED)

The first full day of running the overhauled system against milestone 18 on let-shield. Every
defect below was found LIVE by the operator, root-caused from the durable stores/logs, fixed on the
branch, and verified (698/0 arch + focused behavioral suites per commit). **Main is untouched at
`54f6bbf` — the branch is pushed and awaits the operator's review/merge (standing rule: no pushes
to main without explicit signoff).**

### Governing process rules established (operator, verbatim intent)
- NO pushing/merging to main without explicit operator signoff. Work lands on feature branches.
- No test-running ceremony while a live problem is unfixed — diagnose at the source first.
- The operator drives; SSH to the Mac worker is `umairb@umairs-mac-mini` with key `~/.ssh/aof_mesh`
  (now pinned in `~/.ssh/config`); read/cleanup over SSH is fine, NEVER daemon starts (no login
  session → unauthenticated `claude`).

### The commit ledger (in order, each measured-defect-driven)
| Commit | What / why (measured trigger) |
|---|---|
| `1b50d75` | Completion is DECLARED or tree-quiet. The 5-min parent-transcript silence window truncated `/aof:continue 18` at ~15 min for the SECOND day (background developers write `<sessionId>/subagents/*.jsonl`, which the watch never read). Idle clock now spans the whole session tree; `AOF_DIRECTIVE_COMPLETE` sentinel (producer+detector, the NEEDS_INPUT pairing) settles declared completions in 10s; undeclared end_turn out-waits 15 min. |
| `ba3256f` | A MILESTONE continue = the autonomous cascade. Operator: "continue xy should be a continuation of the entire milestone." `ASSIGNMENT_PHASES` += `autonomous`; the continue door resolves the dispatch target's TYPE (local-then-streamed) and maps milestone→`/aof:autonomous <ref>`; bundle continue.md's milestone branch now DELEGATES to /aof:autonomous (one loop implementation). |
| `c6a3217` | A worker resolves a descriptorless workspace through its mesh checkout — killed the every-5s `workspace-workdir-unresolvable` spam that filled 259/260 of the remote log ring and destroyed its diagnostic value. |
| `c2358d7` | Source-mode build stamp carries the git hash (`source c2358d7+dirty`) — a pulled-but-not-restarted worker was invisible (ran 74-min-stale code through a whole test). |
| `858af5e` | The board list re-fetches while work is in flight — the execution overlay (incl. the sessionId the mirror needs) rides /api/work/list, which loaded exactly once; the operator had to hard-refresh to be OFFERED the terminal. |
| `8cdf975` | The INVISIBLE STOP: a session parked on an unanswered AskUserQuestion is `tool_use`-pending, so both detectors read "still working" — the assignment showed `running` for 28+ min while waiting on a human. `HUMAN_INPUT_TOOL_NAMES` detection → needs-input, declared. |
| `e165abe` | `phaseRunsOnItemBranch` — ONE home for "phase runs on the item's existing branch". The dispatch tick hand-spelled `continue\|\|verify`, so the first `autonomous` dispatch carried NO baseBranch → fresh worktree off main → NONE of the refined stories → the session tried to re-refine/re-scope a bare milestone. THE day's worst defect. |
| `3ce8737` | Dispatch + worktree-base DECISIONS durably logged (tick logs `<command> on <branch>`; worker logs `worktree on EXISTING branch …`); log entries carry their own level. The wrong-base dispatch was diagnosable only by inference because both decisions were unrecorded. |
| `1b59cee` | (a) WITHDRAW REACHES ITS HOLDER: withdraw DOWN-frame (tick, once-guarded) → worker kills the live PTY (`onPtyLive` registry) + settles the run record `cancelled`; pre-spawn + post-settle guards. (b) Failure codes durable: `reportAssignmentFailure` → sink/ring; codes on the code-less frames; control logs received failed frames WITH code (`onAssignmentFailure` peek). (c) Board dead-tab banner (ephemeral board ports die with every restart; the tab clicked into the void). |
| `9817f6b` | Startup reclaim settles the stranded run RECORD (`failed/runtime_offline`) — the ghost family's last member, measured within the hour of (a) shipping. Every terminal path now settles its record: withdraw→cancelled, startup→failed/retryable, bracket→done/failed. |
| `97dde09` | **TERMINAL RESUME** (operator quick-fix, same hour): `aof mesh terminal-resume <sessionId> [--node]` — control resolves the session's assignment from the store, pushes a `terminal-resume` envelope over the loopback relay (the input lane's IPC), the serve router DOWN-frames the holder, and the worker spawns `claude --resume <sessionId>` in the assignment's RETAINED worktree. The new PTY's frames are stamped with the RESUMED session id, so the EXISTING tuple (the row's own — an open dock tab stuck `connecting…`) comes back to life, mirrored AND typeable. Outside the execution bracket by design (no run record, no status frames — terminal rows never regress); idempotent; dead-pid probed; end-marker + registry sweep on exit. Loud refusals: `session-unknown`, `relay-unconfigured` (off the control node). Requires BOTH sides on ≥ this commit: the control serve's router (else the envelope is silently kind-dropped) and the worker handler. |
| `5c03269` | **INTERACTIVE WORKER TERMINALS** (Next-work #1; T14 read-only operator-overridden). Input path: dock keystroke → tuple-bound `/ws/terminal-view` (mesh-ui wraps bytes with THE SOCKET'S OWN tuple; content-blind, 32 KB-bounded, clean-degrading) → loopback relay → serve SELF-subscribed router (`mesh-terminal-input.mjs`, reusing the mirror's subscriber machinery whole) → `terminal-input` DOWN-frame over the admitted stream → worker writes ONLY the live PTY whose CAPTURED sessionId matches (`liveSessionInputs`, bound at capture, swept at settle incl. the generic-catch path). **Plus the lane that makes it useful:** a pending AskUserQuestion no longer parks ~10s in — it reports `code: needs-input` immediately (persisted, schema v7 additive `code` column, verbatim-per-frame so an answer clears it), keeps the PTY alive for the answer, and parks only after the LONG 15-min window (resume-later is now the fallback, not the only path; the SENTINEL needs-input keeps its fast park — that turn deliberately ended). Board: `Answer on <node>` affordance + amber "waiting for your input" line; dock remote badge `remote · <node>` (interactive). Gate DELIBERATELY rewritten: `acd-fleet-terminal-mirror-read-only` → `acd-fleet-terminal-input-constrained` (pins tuple-bound entry, session-exact delivery, pure mirror/bridge, fleet-page-stays-monitor — plants incl. content-routed handler, first-live-PTY fallback, the old absence itself). Focused 89/0; arch 698/0 across 221 files. |

### The incident ledger (what actually happened live)
1. **The duplicate-run wall** (root cause of "Continue does nothing"): withdrawn run `0015`'s
   record stayed `running` in the checkout → the run store's duplicate-run guard refused every new
   `startRun` for item 18 in ~2s, with the failure code visible NOWHERE off the worker's tty.
   Hand-cleared via the door (`aof work run-complete 18 --outcome failed --reason runtime_offline`
   over SSH), then fixed structurally (`1b59cee`, `9817f6b`).
2. **The wrong-base run** (`2977de1d`): dispatched `/aof:autonomous 18` with no baseBranch
   (`e165abe`'s trigger); the session, seeing a bare milestone, burned 28 min re-refining and asked
   an AskUserQuestion about re-scoping — invisible on the board (`8cdf975`'s trigger). Withdrawn;
   its junk local branch + 8 older stale worktrees/branches cleaned on the Mac (only
   `aof/mesh/18-73ab17b2…` remains, matching origin); its phantom workspace registration
   (`fe4dc90dc42b04cd`, 61 junk work items published from inside the worktree) pruned via
   `scripts/prune-projection.mjs --apply`.
3. **Board dead tabs**: board servers ride EPHEMERAL ports and die with each daemon restart; two
   rounds of "button does nothing" were stale tabs (old bundle + dead port). Fixed forward
   (`858af5e` + banner in `1b59cee`); a stale tab from BEFORE the deploy still can't warn (old JS)
   — one hard reopen from the fleet was required post-deploy.

### Deploy state (as of this entry)
- Control (umairs-msi): `payload 1b59cee.20260727T122954` running. `9817f6b` is committed/pushed
  but NOT deployed — it is a restart-time fix; picks up at the next natural install+restart.
- Mac (umairs-mac-mini): `source 1b59cee+dirty` running (operator pulled + restarted). `9817f6b`
  pending its next pull + restart.
- LIVE NOW: run `0017` (assignment `00858ddc`, session `89d1f151`) running `/aof:autonomous 18 on
  aof/mesh/18-73ab17b2…` — the first run with every fix live on both machines. A session monitor
  in the driving session watches the assignment row.
- **2026-07-27 (later): `5c03269` (interactive terminals) INSTALLED as `payload 5c03269+dirty` —
  RESTART THE DESKTOP APP PROMPTLY.** Schema v7 is an in-place additive migrate, but the guard is
  one-directional: the first NEW-payload process to open the store (the desktop's own status poll
  does this within seconds) stamps it v7, after which the still-running OLD daemons' per-tick /
  per-request store OPENS refuse ("newer than this build supports") until restart — long-held
  handles keep working, so no corruption, but dispatch/reclaim ticks + board reads degrade in the
  window. Mac: `git pull` the branch + operator restart (its own store migrates then).

### MISSING TESTS (write these before/while merging — today's code shipped under fire)
- [ ] `createMeshWorkerWithdrawHandler` — all three paths: live-PTY kill (flag consumed by the
      bracket → record `cancelled`), no-live-session direct settle (the measured case), and
      idempotence (absent/terminal record = logged no-op). Fixture: temp checkout + item + running
      run record with `brief.assignmentId`.
- [ ] `settleStrandedRunRecords` — stranded dir → record settled `failed/runtime_offline`; absent
      record no-op; one entry's fault never blocks the next.
- [ ] The execution bracket's withdraw guards — pre-spawn (never spawn a withdrawn run) and
      post-settle (record → cancelled, NO status frame sent).
- [ ] Driver `onPtyLive` — registered on spawn, kill routes to `term.kill()`, registry cleared on
      settle AND on the generic-catch path.
- [ ] `reportAssignmentFailure` → `onLog` routing (level warn, code preserved) + the codes now on
      previously code-less failed frames (`workspace-load-failed`, `assignment-ref-unresolved`,
      `assignment-execution-failed`).
- [ ] Control's `onAssignmentFailure` peek — a failed frame reaches the sink with its code; a
      non-failed frame doesn't; a sink fault never crashes the accept loop.
- [ ] Worker-stream-client `onWithdraw` registration + kind dispatch (mirror the onDirective lane).
- [ ] `resolveDirectivePhase` STREAMED-row fallback branch (local branch covered in
      board-mesh-execution.test.mjs; the streamed-type path is not).
- [ ] Board UI: `serverGone` banner (3 silent failures / TypeError action) and the in-flight list
      re-poll effect — no React harness exists; decide headless extraction vs a component test.
- COVERED today (for the fresh session's orientation): completion tree-quiet + declared sentinel +
  pending-question lanes (mesh-worker-completion-detection), autonomous mapper/phase set + door
  type resolution + baseBranch-for-every-non-refine-phase + withdraw-notify tick once-guard
  (mesh-assignment-directive, board-mesh-execution), checkout descriptor fallback
  (mesh-workspace-workdir-absolute), source git stamp (build-info).

### OPEN FINDING (2026-07-27 evening) — worker-terminal INPUT: bytes reach the pty, claude does not react

**Status: UNRESOLVED after ~15 restart cycles — frozen by operator-invoked stop; do NOT resume
cycle-debugging. The next step requires claude-side visibility (its own debug logging / an
instrumented build on the worker), not another aof deploy.**

What is PROVEN (each with its instrument, all on the branch):
- The full input path delivers: dock keystroke → tuple-bound `/ws/terminal-view` → relay →
  serve router → stream DOWN-frame → worker handler → registry write → **the correct pty**
  (pid-stamped delivery breadcrumbs matched the live claude's pid exactly; a bogus-session
  probe logs a miss, the real session never does).
- The pty layer works inside the daemon (in-daemon `cat` self-test: input + echo OK).
- The claude term's OUTPUT flows (boot renders reach the mirror through the whole
  fabric→loopback→mirror chain).
- The claude term ignores typed bytes AND SIGWINCH resize jiggles — no repaint, ever.
- One success exists: run 0021 (~90s old) visibly cycled prompt history from dock keystrokes
  before its stream died — so the whole loop CAN work; what distinguishes 0021 is unknown.
- Falsified along the way: restart races (real, fixed), dead reconnect loops (real, fixed —
  keepalive both ends), fire-and-forget CLI lying (real, fixed — confirm-at-source), the
  stale-sentinel park (real, fixed — post-resume baseline), daemon-wide pty death (cat test),
  node-pty/node-25 (fresh-process test), IDE-attachment as the input killer (env scrubbed —
  a REAL hygiene/security fix, `4974c82`, but input stayed dead), load-window timing
  (FALSIFIED — probes at +3 and +5 minutes on run 0025: zero echo both times).

Debug scaffolding still in the tree (remove once resolved): per-write delivery breadcrumbs
with pid, post-write SIGWINCH jiggle, in-daemon cat self-test at resume.

### Residual defects / deferred work (known, not yet built)
- **THE structural debt (operator: "insanely brittle"; scoped, ~half-day):** work lives on
  per-assignment branches (`aof/mesh/<ref>-<assignmentId>`) that only the `global_item_branches`
  side table remembers — every consumer must remember to consult it (today's wrong-base dispatch
  is what forgetting looks like). Cure: ONE derivable branch per item (`aof/mesh/<ref>`), side
  table demoted to cache; plus run-settled DOC changes landing on the default branch so main-based
  reads (local continue, `work next`, validate, the board's local rows) stop lying about refined
  items.
- ~~**Terminal INPUT path**~~ **BUILT (`5c03269`, unit-verified; live two-machine verification
  pending both restarts).** Exactly the mapped design, plus one recorded decision the mapping
  didn't cover: the pending-AskUserQuestion park had to move to the LONG window (the ~10s park
  would have killed the very session the operator was about to type into — the input path alone
  was useless against it). Live verification checklist: dock `Answer on <node>` on a real pending
  question → typed answer lands in the worker PTY → code clears on the row → run continues.
- ~~needs-input runs have no board affordance yet~~ BUILT in `5c03269` (`code` persisted schema v7;
  `Answer on <node>` primary action + amber "waiting for your input" panel line).
- A pre-deploy board tab cannot warn (old bundle) — inherent; only hurts once per UI deploy.
- `stream-frame-refused` message template misnames non-descriptor refusals (says "no registered
  descriptor" for `assignment-status-already-terminal`).
- ~~Transient~~ **CONTINUOUS** `ERR_SQLITE_ERROR: database is locked` warnings (measured
  2026-07-27 post-restart: every ~5s) — the projection runs `journal_mode: delete` with NO
  busy_timeout, and the desktop status poll + the board's in-flight list re-poll + the serve
  daemon's write ticks now collide every cycle. Wants `PRAGMA busy_timeout` + WAL. Write ticks
  retry next cycle so no data is lost, but any tick can silently skip a beat.
- **Dead-tuple mirror reads `connecting…` forever** (measured 2026-07-27: the operator opened
  the terminal on a stale `running` row after both restarts): the terminal-view upgrade accepts
  any tuple, the in-memory mirror was wiped by the control restart, the session's PTY died with
  the worker restart — so no byte ever arrives and the dock never leaves `connecting…`. The
  OPERATOR REMEDY now exists (`aof mesh terminal-resume <sessionId>`, `97dde09` — the dead tuple
  revives in place); the UX half still wants an honest "no live stream for this session" answer
  (route-side grace-window close, or a board affordance that offers the resume directly).
- **Worker startup-reclaim frames are fire-once** (measured 2026-07-27: the Mac worker restarted
  in the ~3-min window while the control was ALSO down; its `failed/daemon-restarted` report for
  run 0017's stranded worktree died on the dead connection, and the control row read a stale
  `running` for 35+ min — the dual-staleness reclaim rightly refuses to fire while the node's
  stream is LIVE and heartbeating). Wants the startup reclaim re-armed on RECONNECT, not only on
  daemon start.
- The Mac's launch workspace (`f693d197…`, its aof clone) streams snapshots the control refuses as
  `unknown-workspace` every reconnect — harmless noise, but noise.
- let-shield's INSTALLED bundle still has the old continue.md (`aof work update` there pending);
  only affects hand-typed `/aof:continue` — the mesh dispatch types `/aof:autonomous` directly.
- `aof mesh assign` lacks `--workspace` (cwd-derived; the withdraw this morning initially targeted
  the WRONG workspace silently from the aof cwd).

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
