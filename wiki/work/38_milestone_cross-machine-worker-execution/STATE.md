---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 38 · Cross-machine worker execution & session presence — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-07-10` via `aof:add-milestone`. Origin: discovered live during the **milestone-36
  desktop-app UAT** — the fleet rendered a node `idle` while it was actively being worked on. Root cause
  traced (not assumed) to the run store + presence at the data source:
  - **Zero run records** existed in either repo — "current work" only counts *executed aof task-runs*
    (`running` run records via `startRun`); an editor/assistant **session** creates none.
  - The presence publisher (`src/mesh-launcher.mjs` `assembleCurrentPresenceRecord`) reads
    `listItems(ws.workDir)` for **one** workspace (the daemon's launch cwd). Verified: injecting a real
    `running` run into the cwd workspace DID surface in `mesh status` (`activeRuns:[…]`) and rendered in
    the desktop window — so the pipeline is sound; the gap is *what feeds it*.
  - Not-started: `session-presence`, `worker-repo-checkout`, `worker-worktrees`.
- **Refined `2026-07-10` via `aof:refine 38 --autonomous`** — Decide (RESEARCH + ARCHITECTURE + DESIGN +
  SECURITY) + graph-grounded break-down + Three-Amigos contracts, one review at the end. Now `in-progress`
  with **two** stories (see the breakdown decision below):
  - `00_story_session-presence` — contract authored (tasks 00–06).
  - `01_story_worker-repo-checkout` — contract authored (tasks 00–04); the `@manual` clone soak
    is gated on the SECURITY-approved auth mechanism.
- **Built + reviewed `2026-07-10` via `aof:continue 38`** — both stories built to green, then structural +
  behavioural + design-conformance review; confirmed fixes applied. Both stories now **`in-review`** (→ `done`
  at `aof:verify`). Serialized in the main tree (shared `mesh-launcher.mjs` + still-uncommitted m35 deps ruled
  out worktree isolation).
  - `00_story_session-presence` — **in-review**; tasks 00–05 `@executable` green (`aof session` CLI + session
    store, TTL reusing `isStale`, additive `sessions` presence key, cross-workspace aggregation = the "always
    idle" root fix, fleet reconciliation render, hook wiring); 6 fitness functions green. Task 06 `@uat`/`@manual`
    deferred to verify.
  - `01_story_worker-repo-checkout` — **in-review**; tasks 00–03 `@executable` green (clone-on-miss prefix:
    `config.mesh.repo.cloneUrl` source, scoped `meshCheckoutPath`, narrow `global_node_workspaces` upsert,
    `GIT_ASKPASS` credential scoping + redaction); F1/F2 security + `acd-worker-checkout-reuses-worktree` fitness
    green. Task 04 `@manual` clone soak deferred to verify (gated on SECURITY sign-off). Dev caught two real bugs
    in-flight: a `path.join` `..`-traversal escape (hardened with an `isUnderMeshCheckoutsRoot` gate) and a stale
    same-tick config re-check after clone (fixed with an in-memory marker overlay).
  - **Review verdicts:** architect (structural) — ADR-001/002/003, SECURITY F1/F2, ADR-005/006, fitness wiring
    all SOUND; QA (behavioural) — Story 01 fully faithful, Story 00 findings F1–F5 raised + fixed; designer
    (design conformance) — **CONFORMS** on a real headless-Chromium render (1280 + 390) of every row-3 state, no
    design gaps. Full suite `node scripts/test.mjs` exit 0 (0 not-ok); UI `tsc -b && vite build` green.

- **Verified `2026-07-12/13` via `aof:verify 38` — story-00 ACCEPTED, story-01 NOT; milestone stays `in-progress`.**
  The live soak found **six blockers** (F4, F6, F7, F8, F9, F11) that 2409 green assertions, 9 green fitness
  functions, a green `validate` and a CONFORMS design review had all missed — **the headline feature did not work at
  all**. All six were fixed at verify via four new `@bug` tasks (07/08/09/10) and re-verified live on the *installed*
  stack. See [VERIFICATION.md](VERIFICATION.md) and [RETROSPECTIVE.md](RETROSPECTIVE.md).
  - `00_story_session-presence` — **done**. SPEC objective (a) now holds in production, demonstrated live: a real
    Claude Code hook marks the node `working · aof (session)`; two repos show both; a graceful close drops the line;
    a **hard-killed** session self-expires via TTL (record still on disk, `end` never called) leaving `idle` with no
    ghost. `@uat` design conformance **CONFORMS**, 6/6 states witnessed on producer-fed renders. Suite 2441 ok / 0
    not ok; `cargo test` 79 passed; `validate` PASS.
  - `01_story_worker-repo-checkout` — **still `in-review` (unverified, NOT failed).** Its `@executable` lanes and
    security fitness functions are green, but the `@manual` two-machine private-clone soak (task 04) has **never been
    run** and the SECURITY **R1/R2/R4** operator sign-off is outstanding — so **SPEC objective (b) has never been
    demonstrated**. Deferred by operator choice. Given what the soak did to story-00's green lanes, its passing tests
    are not evidence.
  - **The milestone's own headline fix was broken (F11).** ADR-003's cross-workspace aggregation stored `work_dir`
    RELATIVE (`"./wiki/work"`), so it resolved against the daemon's launch cwd: it re-read ONE workspace N times,
    rendered one run as `running 2 runs`, silently destroyed every cross-workspace session, and **from an install dir
    resolved ZERO workspaces → permanently `idle`** — the exact bug the milestone exists to kill. It only looked
    fixed because every test and dev run launched from the repo.
  - **Graduated to ADRs:** **ADR-008** (the producer-fed-contract rule — the milestone's durable lesson, with three
    armed non-vacuous fitness functions); **ADR-004 amended** (its "both UIs share one projection function" premise
    was structurally false — the desktop is Rust). DESIGN §Surface 1 rewritten to bind the surfaces production
    actually mounts.

- **Story 02 added + refined `2026-07-13` (`aof:add-story` + `aof:refine 38/02 --autonomous`) — at the user's
  direction, to close the mesh network in THIS milestone rather than defer the credential-mint automation.**
  `02_story_clone-credential-mint` turns the static `AOF_MESH_CLONE_TOKEN` PAT into a **config-driven mint
  provider** (`env-token` default | `github-app`) that mints a per-repo, `contents:read`, ~1h installation token —
  closing SECURITY **T4** by construction. Decide docs produced: **RESEARCH §3** (measured: `node:crypto` signs
  the App JWT, zero new deps; the mint API shapes; the **`x-access-token`** username question — App tokens likely
  tolerate username==token but it is NOT GitHub-documented, so the shim is made prompt-aware), **SECURITY T8–T11 +
  R7/R8** (App key at rest, over-scoped-mint, no-silent-fallback; the **attestation swap** — per-clone scope/TTL
  moves from operator sign-off to code-enforced; the operator now attests only that the App is installed
  least-privilege), and **ADR-010** (the provider abstraction; Gap A — repo resolved control-side from the
  committed `cloneUrl`, never the worker's frame; installation-id auto-resolved; the prompt-aware askpass). Six
  task contracts authored (00–04 `@executable` over injected signer/http seams + fake key; 05 `@manual` real-App
  soak). Developer feasibility seat: all six correctly tagged, every seam either exists or is a small named
  addition — **no contract contradicts the real code** (the inverse of this milestone's F1/F4/F6–F9/F12 pattern).
  Fitness functions F5/F6/F7 spec'd, authored at build (a detector over the not-yet-built provider would be
  vacuous — the ADR-008 lesson). **Milestone now accepts only when all THREE stories are done.**

- **Deferred soaks resumed `2026-07-16` (`aof:verify 38`, operator-initiated) — provisioning a real
  GitHub App for the `github-app` credential path.** Operator chose to run story-01 task 04
  (private-clone soak) + story-02 task 05 (real-App-mint soak) together against a real second worker
  node (online) and a real private repo. See
  [provisioning/github-app-setup.md](provisioning/github-app-setup.md) for the setup runbook (App design,
  governance Q&A, status) — a provisioning trail, not a verification record; the soak's own evidence
  lands in VERIFICATION.md once it runs. **Status: App not yet created; awaiting App ID + private-key
  path handback.**

- **`aof mesh repo publish` taught to auto-detect `cloneUrl` from `git remote get-url
  origin` `2026-07-16`, at the operator's direction, during the live soak.** The
  operator rejected hand-editing config and rejected a proposed dedicated `set-clone-url`
  verb as needless ceremony ("check if it exists first, then add it if it doesn't").
  Fixed in `src/commands/mesh-repo.mjs`: check the existing committed `cloneUrl` first
  (never overwritten), else derive it from the repo's own git remote via an injectable
  exec seam, silent/non-fatal on any detection failure. **A real bug found in the same
  pass:** a detected `https://` remote can carry the operator's own embedded username,
  which `git clone`'s verbatim use of `cloneUrl` would feed straight past the askpass
  shim's `x-access-token` answer — fixed by stripping URL userinfo before persisting
  (scp-style `git@host:path` left alone, it's a service-account convention not a
  personal credential). Seven new tests; full suite re-run clean. See
  [stories/01_story_worker-repo-checkout/STORY.md](stories/01_story_worker-repo-checkout/STORY.md)
  for the full account.

- **`03_story_per-org-credential-scoping` ADDED `2026-07-16` at the operator's explicit direction, mid
  live-soak provisioning — locked into THIS milestone's scope, not deferred.** Surfaced when the operator
  asked how the mesh scales to repos in more than one GitHub org: ADR-010 resolves the
  `mintCloneCredential` provider (App identity) exactly ONCE, globally, from the control node's own
  config — one App/token for the whole mesh regardless of org — while `cloneUrl` is already resolved
  per-workspace (Gap A). Operator's ruling, verbatim: *"this will be fixed in this milestone. No
  bullshit."* Decision taken this session (mine to make, per the operator): **continue the in-flight live
  soak now** (the single-org path being provisioned is not invalidated by the future fix — the control
  node's own workspace stays the fallback case in both designs, same as Gap A already does for
  `cloneUrl`), **and lock the fix in as a new story now** rather than a note only. See
  [ARCHITECTURE.md](ARCHITECTURE.md)'s ADR-010 "Known limitation" section and
  [stories/03_story_per-org-credential-scoping/STORY.md](stories/03_story_per-org-credential-scoping/STORY.md).
  Mirrors exactly how story-02 itself was added mid-milestone. **Milestone now accepts only when all FOUR
  stories are done.** Owed at refine: an ADR (extend ADR-010 or a new one — architect decides) + a
  SECURITY review pass (a per-org secret's resolution/configuration authority is changing). Not yet
  refined or built — the live soak takes priority while the App creation is mid-flight; `aof:refine 38/03`
  is the next step once the soak's evidence is captured.

- **GitHub App created + wired `2026-07-16` — installed on the one target repo only** (App ID and
  install details recorded privately, not in this public repo). Operator's design ruling for story-03,
  given verbatim: *"assume singular apps, but allow for overrides."* Confirmed at this session:
  `loadWorkspace` (`src/work.mjs:176-180`) already merges the GLOBAL `~/.aof/aof.config.json` `mesh`
  config as the base with each project's own LOCAL `mesh` config layered on top (local wins) — so the
  "singular default, local override" shape already exists for whichever workspace happens to be the
  daemon's own launch dir; story-03's job is extending the SAME shape to the workspace an assignment
  actually TARGETS (today fixed to the launch workspace only). Wired the App as the GLOBAL default
  accordingly: `mesh.repo.credential.provider = "github-app"` + `githubApp.appId` + `.privateKeyPath`
  added to the operator's global `aof.config.json` (not the `aof` repo's own local config). See
  [provisioning/github-app-setup.md](provisioning/github-app-setup.md) for the full trail, including an
  incident note (a private-key Read slipped through before the `.claude/settings.json` deny rule took
  effect — closed: generic deny rule fixed, key relocated out of Dropbox, no lasting exposure given the
  App's own one-repo/read-only installation scope).

- **Story 02 VERIFIED + ACCEPTED `2026-07-16` (`aof:verify 38/02`).** `@executable` tasks 00–04 green
  (40 assertions, 0 not-ok, stable over three full-suite runs) + all three fitness functions
  (`acd-clone-credential-provider-config-driven` / `acd-clone-app-key-not-relayed` /
  `acd-minted-token-scoped-single-repo`) green and non-vacuous; producer-fed throughout (real `node:crypto`
  RS256 signer, real bare-repo clone, real askpass spawn, real `startLauncher` wiring). `aof work validate 38`
  PASS. SECURITY **T4** closed by construction. Task 05 `@manual` real-App soak is the milestone's deferred
  human gate — NOT run at story level; closed at `aof:verify 38`. STORY.md `done`; SPEC `## Stories` box
  ticked. The one suite `not ok` was the **known pre-existing `reclaim-scheduler/06` flake** (EBUSY
  temp-SQLite unlink race, already routed to a stabilisation chore) — not a story-02 defect. See
  [VERIFICATION.md](VERIFICATION.md) → "Story-02 · clone-credential-mint". **Milestone stays `in-progress`:
  2 of 3 stories done — story-01's two-machine private-clone soak (task 04) is still unrun.**

- **Built + reviewed `2026-07-18` via `aof:continue 38` — the THREE independent roots (03, 04, 07) built to green,
  reviewed, and moved to `in-review` (→ `done` at `aof:verify`).** Fanned out per the milestone dispatch: story 04
  worktree-isolated (its own fleet-face + UI surface), stories 03 → 07 serialised in the main tree (both edit
  `mesh-clone-credential-provider.mjs`). Their dependents (05→06 terminal chain, 08 memory-syncback) are the NEXT
  `aof:continue 38` pass. Each `@executable` lane + fitness function is green; every `@manual` soak stays deferred
  to `aof:verify`.
  - **03 · per-org-credential-scoping** (`55ab259`) — **in-review**. Tasks 00–02 `@executable` green + `acd-cross-org-key-isolation`
    (4 invariants, non-vacuous). App identity resolves per-assigned-workspace via a new `createResolveWorkspaceAppIdentity`
    seam (mirrors ADR-010 Gap A); cross-org isolation is STRUCTURAL (a null-resolved own identity throws
    `github-app-mint-failed`, never borrows a sibling org's key); default key dir code-enforced at
    `<meshRoot>/credentials/github-app-<appId>.pem` (appId slugged, never sync-scoped). Story-02 provider tests updated
    to the new deps shape, re-verified green. Task 03 `@manual` two-org soak deferred.
  - **04 · ui-driven-assignment** (`9939629`, merged `0f998d9`) — **in-review**. Tasks 00–03 `@executable` green +
    `acd-fleet-face-single-mutation-route` (4 invariants + a behavioural half over the real `serveMeshUi`); `npm run ui:build`
    green. The fleet face gains its FIRST mutation route — `POST /api/mesh/assign` wrapping `assignWork` verbatim,
    loopback + same-origin + `application/json` admission, verb-code→coded-non-200 mapping, nothing minted on a gate miss.
    Five inherited m25/27/34/35 read-only fitness tests WIDENED-not-weakened to the one sanctioned exception (the
    m27/ADR-006 "SUPERSEDED IN PLACE" precedent). Task 04 `@manual` real-UI soak deferred.
  - **07 · durable-worker-pushback** (`6330afe`) — **in-review**. Tasks 00–02 `@executable` green over a REAL local bare
    origin (incl. non-ff / unreachable / pre-receive-declined push failures that RETAIN the worktree) +
    `acd-write-token-scoped-to-push` + the two-seam rewrite of `acd-minted-token-scoped-single-repo`. Real branch
    `aof/mesh/<itemRef>-<assignmentId>` (not detached), push BEFORE force-remove; a SEPARATE `createGithubAppPushMintProvider`
    mints a single-repo `contents:write` token ONLY at push time (clone stays `contents:read`), pulled over a NEW
    `write-credential-request`/`write-credential` frame pair gated T6/F15/F16 exactly like the clone pull (built to satisfy
    the pre-existing F12 guard — the dev caught + reverted a shared-helper refactor that would have made story-03's
    `acd-cross-org-key-isolation` vacuous). Task 03 `@manual` real-GitHub push soak deferred; re-opens SECURITY T9/T15.
  - **Review verdicts (build gate):** **architect (structural) — all three GO**; ratified story-07's write-credential-pull
    wire as ADR-015 decision-3's "own frame-pair" option (T6/F15/F16 verbatim, push-seam-only single-repo mint) and wrote
    an **ADR-015 AMENDMENT** (ratification, no decision changed); all fitness functions confirmed non-vacuous (CRLF-safe,
    landing-asserted). **QA (behavioural) — all three GO, the F1–F8 producer-fed pattern ABSENT** (every task drives the
    real seam, every Examples row exercised, real records/git-ordering/mint-scope asserted, not a convenient proxy).
    **Designer (design conformance, story 04 UI) — INCONCLUSIVE** (honest: no committed mock and the §Surface 1 binding
    checklist predates story 04) → authored **DESIGN.md §Surface 2**, the assign-affordance binding checklist that BECOMES
    the baseline for `aof:verify`'s render+judge (owed at verify); deferred design-gaps DG-3/4/5 recorded.
  - **Confirmed review fixes applied:** architect should-fix — corrected two stale `mesh-worker-execution.mjs` comments that
    claimed the write-credential wire was "NOT built" (it is: `mesh-launcher.mjs` supplies it as a literal F12-guarded key);
    architect nit — anchored `acd-write-token-scoped-to-push`'s push-before-remove detector to the awaited CALL (was matching
    the earlier function DEFINITION, masking a force-remove inserted between); QA nit F-04-B — corrected an over-claiming test
    name ("live + stale" → "known-but-stale", since `assignableNodeOptions` is liveness-agnostic). All re-verified green (17 ok).
  - **Integrating full suite `node scripts/test.mjs`: 2839 ok / 1 not-ok; `cargo test` 79 passed.** The sole `not ok` is a
    **PRE-EXISTING, non-deterministic memory-extraction flake** (`memory-integration: status … lesson/adr split sums to record
    count`) — proven IDENTICAL at the pre-work baseline `e61ee07`, driven by LLM (`claude-cli`) free-text record-kind extraction
    (kinds like `"defect (process + integration)"` that are neither lesson nor adr); NOT a story-03/04/07 regression (the memory
    subsystem is untouched). Same class as the reclaim-scheduler/coordination-launcher timing flakes — route to the same
    stabilisation chore. **Milestone stays `in-progress`: stories 05, 06, 08 not yet built.**

- **Built + reviewed `2026-07-19` via `aof:continue 38` — the LAST THREE `@executable` stories (05 → 06 → 08) built to green,
  reviewed, and moved to `in-review` (→ `done` at `aof:verify`). All NINE stories are now built.** Serialised 05 → 06 → 08 in the
  main tree (06 hard-depends on 05's interactive terminal; 08 shares `scripts/test.mjs` with both AND its frame-vocabulary
  enumeration must include 06's new `terminal-frame` kind — so parallel worktrees would have collided on `scripts/test.mjs` and
  risked a stale enumeration, this milestone's own recurring failure mode). A **concurrent `aof:verify 41` session** was live in the
  same working tree during the pass (authoring `src/bundle/commands/insert-*.md` + editing `scripts/test.mjs`); the operator
  confirmed it complete before 06/08 were dispatched. Each story's `@executable` lanes + fitness function are green; every `@manual`
  soak stays deferred to `aof:verify`.
  - **05 · terminal-driven-worker-execution** — **in-review**. Tasks 00–03 `@executable` green (42 assertions: interactive `claude`
    PTY via the `terminal-providers` seam replacing `claude -p`; whole command typed into PTY stdin; `NEEDS_INPUT` sentinel → third
    `needs-input` outcome NOT re-mapped to `done`; needs-input RETAINS the worktree; `session_id` captured/surfaced) +
    `acd-worker-driver-no-headless-print` (30 assertions, 5 CRLF plants each landing-asserted — it hit + fixed the exact `\n`-needle-vs-CRLF
    near-miss this milestone is scarred by). Dev caught a **broad-blast hazard**: swapping the bounded `claude -p` default for an unbounded
    interactive PTY makes ANY test that reaches the worker driver without a `spawnRuntime` override HANG (real `claude` on PATH) — it
    audited all 19 unoverridden call sites and patched the 2 unsafe pre-existing story-01 tests. Task 04 `@manual` subscription soak deferred.
    **Review fast-follow `2026-07-19` (`aof:continue 38/05` re-review — architect + QA + craft, all producer-fed):** three CONFIRMED
    detector defects on the real interactive path (invisible to the single-chunk `@executable` fakes) caught + FIXED — (1) `containsNeedsInputSentinel`
    was an unanchored `buffer.includes("NEEDS_INPUT")` that false-fired + `term.kill()`ed a healthy run whose output merely NARRATED the token →
    now matched only as a whole `\n`-terminated line; (2) `extractSessionIdFromOutput`'s `/^\s*(\S+)/` truncated the id when marker+value straddled
    two `onData` chunks (a truncated non-null id reads as valid → wrong `claude --resume`) → now requires a whitespace-terminated token (`(?=\s)`),
    degrading to null + re-extract on an in-flight tail; (3) the shared fake-pty fixture's `dispose()` was a no-op → now truly unsubscribes.
    +2 hermetic regression tests (both FAILED pre-fix), story-05 focused runner now **23/23 green**; story-06 fixture consumer re-run 5/5, no regression.
  - **06 · worker-terminal-streaming** — **in-review**. Tasks 00–02 `@executable` green (59/59 focused: PTY bytes ride the FROZEN
    `mesh-relay.mjs` envelope as an opaque `terminal-frame` kind, byte-unchanged, driven through the REAL `serveRelay()`; a read-only
    `/ws/terminal-view` carve-out on the REAL `serveMeshUi` fleet face — in-memory ephemeral mirror, session-gated, unresolvable-dropped,
    3-way multiplex) + `acd-fleet-terminal-mirror-read-only` (non-vacuous, structural + behavioural, no mesh→PTY input path). Task 03
    `@manual` two-machine stream soak deferred.
  - **08 · worker-verified-memory-syncback** — **in-review**. Tasks 00–01 `@executable` green (task 00: 7 tests, frame-vocabulary Outline
    over the REAL builders + a real `graphify-out/graph.json` proven untracked via `git add -A`; task 01: 5 tests over a REAL local checkout +
    REAL `git merge` + REAL `runMemory` ingest/recall on the **`local` backend** — absent-before/recallable-after by specific record id,
    deterministic-by-construction against the known LLM-extraction flake) + `acd-memory-index-never-on-mesh` (non-vacuous, verified by a LIVE
    plant on real `control-stream-server.mjs`; frame enumeration COMPLETE — includes story-06 `terminal-frame` + story-07 `write-credential`).
    Task 02 `@manual` end-to-end mesh soak deferred.
  - **Review verdicts (build gate):** **architect (structural) — all three GO, MUST-FIX none**; adjudicated story-06's flagged findings and
    wrote an **ADR-014 AMENDMENT** (RATIFICATION, no decision changed) recording that ADR-014's grounding is STALE — it cited `serveRelay`/`relayMode`
    (which has NO production call site since the m33 fabric-native redesign moved to `control-stream-server`/`worker-stream-client`) and two modules
    DELETED at m33 (`mesh-presence-subscriber`/`mesh-presence-cache`, commit `f3a4283`) — and naming what's owed at the task-03 soak (wire `relayMode()`
    into the control launcher OR pivot the bridge onto `control-stream-server`). Confirmed all 3 new fitness functions sound + non-vacuous and stories
    03/04/07 invariants intact. **QA (behavioural) — 05 GO-WITH-FIXES, 06 GO-WITH-FIXES, 08 GO**; the F1–F8 producer-fed pattern is ABSENT from the test
    CONSTRUCTION (every lane drives a real seam), but QA elevated TWO producer-WIRING gaps (see Feedback F-38.05/F-38.06 below). **Designer (design conformance,
    story-06 UI) — INCONCLUSIVE** (honest: story 06's `@executable` scope shipped the BACKEND route only — `grep terminal-view` in `ui/` = 0 matches, the
    fleet mounts no terminal component; the on-screen render is the task-03 soak's deliverable) → authored **DESIGN.md §Surface 3** (binding checklist V1–V9 +
    states table) as the verify render+judge baseline; deferred design-gaps DG-6/7/8 recorded.
  - **Confirmed build-gate fix applied:** the integrating full suite caught ONE real story-06 regression the architect's regression pass missed —
    `acd-mesh-ui-single-server.test.mjs`'s m25/ADR-003 sub-assertion blanket-forbade `new WebSocketServer(`, but story 06's `/ws/terminal-view` uses
    `new WebSocketServer({ noServer:true })` which rides the ONE `http.createServer` via `server.on("upgrade")` and stands up NO second listener. WIDENED-not-weakened
    (the m27/ADR-006 SUPERSEDED-IN-PLACE precedent story 04 set): permit EXACTLY the one `noServer` read-only terminal-VIEW carve-out, still forbid any port/server-bound
    WSS or a second listener; verified the widened test still trips on a planted violation. Also applied the architect's one-line doc nit (the F12 `acd-clone-credential-pull-not-pushed`
    freeze baseline now notes ADR-013's additive `command` key is absent-is-benign, not a regression).
  - **Integrating full suite `node scripts/test.mjs`: 2883 ok / 9 not-ok; `cargo test` (desktop) green.** After the arch/25 widen fix the residual is **8 not-ok, EVERY one
    pre-existing or external to stories 05/06/08:** the known `memory-integration` LLM-extraction flake; **five `doctor/00`+`doctor/01` failures that are a NEW date TIME-BOMB**
    (`test/doctor-coherence-completeness.test.mjs` hardcodes `updated: "2026-06-19"` and pins no `now`, so as of today `2026-07-19` — exactly 30 days — the fixtures cross the
    stale window and emit an unexpected `stale-updated` finding; the doctor subsystem is untouched by this milestone); the known `global-work-propagation/03` propagation-tick timing
    flake (confirmed PASSES clean in isolation this session); and `bundle-asset-manifest-complete/00` (`46 !== 42`) from the concurrent `aof:verify 41` session's uncommitted
    `insert-*.md` bundle assets. None is a story-05/06/08 regression. **Milestone stays `in-progress`: all nine stories built, but 05/06/08 (and 01/03/04/07) remain `in-review`
    pending their `@manual` soaks + accept at `aof:verify 38`.**

- **⛔→✅ SOAK-BLOCKER F-38.05 CLOSED `2026-07-19` via `aof:continue 38/05` — the producerless sentinel/session_id seam is now PRODUCER-WIRED** (raised at the `aof:verify 38/05` DECLINE the same day; the story stays `in-review`, its `@executable` lanes now producer-honest). Architect-first (rewrote ADR-013 decision-3/4 as an AMENDMENT + rewrote the `acd-worker-driver-no-headless-print` fitness function), then developer built the two missing producers, then architect + QA review (both **GO**):
  - **session_id** — replaced the phantom `AOF_SESSION_ID:` PTY-marker scan (`extractSessionIdFromOutput`/`SESSION_ID_MARKER`, both RETIRED) with a **transcript-dir watch**: `defaultWatchTranscriptSessionId` reuses `work-observe.mjs`'s `projectSlug`/`claudeProjectsDir`, snapshots `<claudeProjectsDir(worktreeCwd)>/*.jsonl` before spawn and resolves the FIRST NEW `<session_id>.jsonl` basename — deterministic, ZERO model cooperation (Claude Code itself is the producer). Never-throws, abort-aware, bounded by an (injectable) max-wait; degrades to `null` (task-03 Examples unchanged).
  - **NEEDS_INPUT** — gave the sentinel a real producer home (ADR-013 amendment, **option C**): a worker-scoped `--append-system-prompt NEEDS_INPUT_INSTRUCTION` on the interactive launch (`resolveInteractiveDriverLaunch`). Worker-only BY CONSTRUCTION — the human `/ws/terminal` route calls `resolveProvider` directly and never touches `resolveInteractiveDriverLaunch`, so it can never false-fire on a human session (why not the shared `/aof:*` bundle). Detection (`containsNeedsInputSentinel`, hardened whole-line) UNCHANGED — the amendment adds the missing PRODUCER, not a detector.
  - **Fitness REWRITTEN** — invariant 4 now pins the transcript-watch producer (was `extractSessionIdFromOutput`); **NEW invariant 6** pins the NEEDS_INPUT producer's existence, so a revert to producerless trips CI. This is the SCOPE FINDING's fix: *a fitness function must pin the PRODUCER's existence, not the consumer's current shape.* Confirmed non-vacuous against the final source (invariants 4 & 6 go RED when the capture/producer is removed).
  - **Review: architect GO** (fitness non-vacuous, transcript-watch sound, no cross-story regression — story-06 bridge `onOutputChunk(chunk, capturedSessionId)` still fed, story-07 push path intact, invariant-5 retention holds, ADR faithful). **QA GO** (every Examples row producer-fed, the injected watch seam at the real seam, session_id surfaced on the done + needs-input frames asserted, no over-claim of efficacy) + one coverage gap CLOSED at review (a hermetic real-temp-fs test of `defaultWatchTranscriptSessionId` — snapshot-excludes-preexisting / deadline-null / abort-null; NOT `@manual`, the fs is fakeable with no real `claude`). Story-05 focused lanes + fitness: **27 ok / 0 not-ok**, isolated, stable across runs.
  - **Still deferred to the task-04 `@manual` subscription soak (un-`@executable`, unchanged):** NEEDS_INPUT real EFFICACY (does a live `claude` obey the `--append-system-prompt` and emit the sentinel), and the session_id snapshot-race CAPTURE RATE on a real fast session (a transcript written before the first poll tick would land in the snapshot → null; in-contract null-degrade, worktree is freshly created per-assignment so the dir starts empty). Both are the soak's to measure — the `@executable` build proves DETECTION + producer WIRING, never efficacy.

- **⛔→✅ SOAK-BLOCKER F-38.06 CLOSED `2026-07-19` via `aof:continue 38/06` — the terminal STREAM transport is now PRODUCER-WIRED via a HYBRID; story 06 stays `in-review`, now genuinely soak-ready.** F-38.06 (raised at the `aof:verify 38` pass) was: story 06's `@executable` lanes were green against the in-process `serveRelay()` broker, but NO production call site pushed a `terminal-frame` over any live transport — inert on a real deploy. Closed architect-first, then developer, then a three-lens review (architect/QA/security) that caught THREE further defects green tests never would — the milestone's `green ≠ working` thesis, validated three more times on one story:
  - **The transport BRIDGE (hybrid — ADR-014 amendment `2026-07-19`).** The architect first pinned option (a) (start the `mesh-relay` broker as a production role, reusing the as-built push/subscribe seams). The orchestration review then found AT SOURCE that `serveRelay` binds **LOOPBACK ONLY** (`mesh-relay.mjs:622` `listen(port,"127.0.0.1")`) — structurally unreachable cross-machine — so (a) could never carry a frame between two machines (the whole SPEC objective). Revised to a HYBRID: the **cross-machine leg (worker→control) rides the FABRIC** (`worker-stream-client.sendTerminalFrame` → `control-stream-server` branches `terminal-frame` BEFORE `applyStreamFrame` into an `onTerminalFrame` sink, never store-persisted); the **same-machine leg (control→the separate `aof mesh ui` process) rides a LOOPBACK `serveRelay` broker** on the known `servicePort` — serveRelay's loopback bind, which DISQUALIFIED it cross-machine, is exactly what QUALIFIES it for the local hop. New anti-inertness fitness `acd-terminal-stream-transport-wired` pins the producer wiring (inv.5 fabric send, inv.6 control-stream branch + known non-ephemeral port + never store-persisted, inv.7 fleet loopback subscribe), RED-until-wired.
  - **F17 (security — cross-node spoofing, Medium/High-adjacent — FIXED).** The ADR CLAIMED the routing identity is the connection-bound `nodeId` re-stamped control-side, but `mesh-launcher.mjs` pushed the RAW frame → the mirror routed by the worker's SELF-DECLARED `frame.nodeId`. An admitted worker could send `{kind:"terminal-frame", nodeId:"<victim>", …}` up its OWN socket and inject bytes onto ANOTHER node's fleet card. Fixed: `onTerminalFrame: (frame, { nodeId }) => push({ ...frame, nodeId })` re-stamps the connection identity; pinned by a new security fitness `acd-fleet-terminal-frame-connection-identity` (RED-until-fixed) + SECURITY.md T14 block / F8 / residual R9.
  - **F-38.06b (config footgun — Medium — HARDENED).** `config.mesh.relay.url` was overloaded (its port/path ALSO drive the fabric control-stream endpoint, host substituted per-peer), so an operator setting it to the control node's FABRIC address would silently aim the relay legs at the control-stream server (wrong protocol → clean-degrade to no frames, NO error). Hardened: a shared `loopbackRelayUrl(config)` forces the relay dial's host to `127.0.0.1` (the ONLY correct value — the wrong degree of freedom removed by construction); both transport factories dial it; pinned by a fitness clause (RED-if-reverted).
  - **QA coverage gaps closed:** the `sendTerminalFrame` best-effort discipline (off the reconnect/`markDropped` path) + the driver `onOutputChunk(chunk, capturedSessionId)` producer link now have behavioural coverage; the stale "not wired" comment in `mesh-worker-execution.mjs` corrected; a `@manual` backpressure/live-tail scenario added to the task-03 soak (deferred `wireTerminalBridge` retirement — scanned by a fitness, non-blocking).
  - **Final gate:** architect PASS (as-built matches the pinned hybrid; F17 re-stamp + force-loopback confirmed at source); fitness sweep **39/0 GREEN + non-vacuous**, no invariant weakened, no cross-story regression, registration de-duped/clean; ADR-014 amendment + SECURITY.md current. **Story 06 stays `in-review`, now genuinely soak-ready** — the task-03 `@manual` two-machine stream soak (real cross-machine fabric leg + loopback control→UI hop + T14 on-screen-credential inspection + backpressure) is the milestone's deferred human gate, closed at `aof:verify 38`. **Milestone stays `in-progress`.**

- **⛔→✅ BLOCKER F-38.06c CLOSED `2026-07-23` via `aof:continue 38/06` — the fleet now RENDERS the terminal-view, and the review found TWO more producer gaps beneath it (both also closed). Story 06 stays `in-review`, now genuinely soak-ready.** F-38.06c (raised at the `aof:verify 38` pass the same day) was: the transport was wired (F-38.06) and the mirror fed, but `grep terminal-view ui/` = **0 matches** — a reachable producer with no consumer surface, so the task-03 soak was structurally unrunnable. Closed via a new `@bug @finding-F-38.06c` task 04 (the story-00 tasks-07–10 precedent), built then three-lens reviewed (architect/QA/designer) — and the review caught two defects a green suite never would, the milestone's `green ≠ working` thesis validated twice more on one story.
  - **The break was THREE LINKS deep, not one — confirmed at source before building.** ADR-013 said the `session_id` is "surfaced on the assignment record"; it was surfaced NOWHERE a browser could read. **(1) PERSIST** — the worker sends it, but `control-stream-server.mjs:231-232` read only `runId` and `global_assignments` had no column. **(2) SURFACE** — `projectAssignment` carried eight keys, none the join key. **(3) RENDER** — no `ui/` component. All three built: an idempotent PRAGMA-checked `ALTER TABLE` (the `clone_url` precedent, migrates a real pre-existing DB in place), an additive `sessionId` on the read shape + `WorkAssignment`, and `ui/src/fleet/terminal-view/` (framework-free `.mjs` + `.d.mts` helpers, thin `FleetTerminalView.tsx` consumer) mounted on the work-item card.
  - **⛔→✅ F-38.06d (QA, MUST-FIX; architect ADR-013 invariant 7) — the join key arrived only when the run ENDED.** `sendAssignmentStatus(…,"running",{runId})` (`mesh-worker-execution.mjs:1448`) carried no sessionId, because it is first resolved at `:1466` — *after* `await spawnRuntime(...)` returns. Every frame carrying it was terminal. So for the whole LIVE run the row was NULL → the card rendered **no terminal at all**; the id landed only once the stream was dead. Fixed: an `onSessionIdCaptured` hook fires a second `running` frame (`{runId, sessionId}`) from the transcript-watch resolution, wired as a literal key at the production `createHandler({...})` call site (F12 discipline). Ordering made load-bearing — `finish()` now awaits the watch chain unconditionally, so a slow live frame can never land after `done` and resurrect a finished assignment.
  - **⛔→✅ F-38.06e (QA, MUST-FIX; architect ADR-014 invariant 8) — `ENDED` was unreachable from a real session end.** The terminal-frame envelope carried only `{sessionId, bytes}` and the route unsubscribed on the BROWSER's close, so after a worker exited an open view sat on `streaming`/`live`/`pulse` **forever** — V9's exact forbidden state. Architect chose mechanism **(a)**: an end marker **inside the opaque `signal` on the EXISTING kind** (a new kind would need a branch at three kind-switching hops, each a place a refactor re-inerts the seam; inside `signal`, `routingKey` routes it and **inv.4 holds by construction**), produced from `finish()` — the driver's single settle point for all three outcomes — and answered by the ROUTE **closing the socket**, never an in-band marker (a worker's own PTY output could otherwise FORGE an end, closing the operator's view at will and defeating the T14 on-screen-secret inspection). `control-stream-server.mjs` untouched: zero new control-path branches. The browser needed no change — the fix makes the existing reducer *reachable*, which is why the V9 lane is now driven END-TO-END (real producer → envelope → mirror → route → a real browser socket) rather than by a reducer call.
  - **New armed fitness `acd-terminal-view-live-observable`** (F17-shaped, RED-until-fixed): clause (a) pins ADR-013 inv.7's live report, clause (b) pins ADR-014 inv.8's end-of-stream. Both now GREEN against the real source, both self-checks green regardless of tree state (11 hand-written plants, each asserting it LANDED before tripping) — so each goes RED again if its producer is reverted.
  - **Design conformance — §Surface 3 CONFORMS on all witnessed states (was INCONCLUSIVE since `2026-07-19`, GAPS at first post-build judgement).** Judged across FIVE real 1280 renders; all three gaps (GAP-1/V11 overprint, GAP-2/V12 hierarchy, GAP-3/V10 honest-empty copy) fixed against real pixels; V10's derivation cross-checked end-to-end (the terminal bar, the attention-row chip, and the node summary all read the SAME `assignmentChip(row)`, so they agree in the pixels). **NOT a bare whole-surface CONFORMS — a NOT-ASSESSED residue is owed at `aof:verify`:** the collapsed at-rest default (every render was driven OPEN), V8 at byte level (EVIDENCE-GAP-1, a harness node-naming gap), V5 (inherently the soak's), the `disconnected` state, and mirror-rebuilt-empty. New deferred design-gaps DG-9/10/11/12 recorded (DG-12 = the app-wide CSS bug).
  - **Review verdicts:** **architect GO-WITH-FIXES** — ADR-013 + ADR-014 amendments written (invariants 7 and 8); migration proven safe on a genuinely legacy DB; F17 confirmed still holding (the tuple's trust split is asymmetric and that is what makes it safe — the `nodeId` half is control-authored and re-stamped, the `sessionId` half worker-reported but holder-gated, so a worker can at worst mis-point its OWN card at another session on its OWN node); NOT extending the frozen `assembleAssignmentRecord` ratified as correct (the freeze is on the MINT shape, where a sessionId could only ever be null). **QA NO-GO → resolved** — raised both blockers; every Examples row producer-fed, the one synthesized row honestly labelled (`target_node_id` is `NOT NULL`, so no real store row can lack a node). **Designer GAPS → resolved** — judged from three real 1280 renders; authored **V10/V11/V12**; closed DG-6, decided DG-7/DG-8, raised DG-9/10/11.
  - **Designer re-judged the post-fix renders — GAP-1 (V11) and GAP-2 (V12) CLOSED against real pixels; a V10 rework then followed.** GAP-1: the `stream ended` bar no longer overprints — the byte pane is `flex-1` and the message a flow sibling below it, keeping the panel's TOTAL height constant (the designer bound that constant-height property into V11 — a bar added below a full-height pane would jump every sibling card in the stretched grid row the instant a socket closed). GAP-2: root-caused to the unlayered CSS reset (below), not papered over. The designer then issued **§Correction 3**: V10's honest-empty copy had been built from a **hand-maintained three-state list** (`done`/`failed`/`reclaimed`) that **leaked `withdrawn` and `stale`** — both terminal, both would sit on `waiting for output` forever, the exact lie V10 exists to kill, at two new addresses. Reworked to derive terminal-ness AND wording from `assignmentChip(row)` (the m35 §4 ramp that already owns both) — no second vocabulary — plus the V11 chip/bar split (header chip = the short `no live output`; viewport bar = the reason `no live output — assignment <label>[ · reclaimed]`). Built, 20-assertion lane green with explicit anti-leak guards on `withdrawn`/`stale`, and **witnessed on a fresh 1280 terminal-state render** (a `done` card and a `stale`+`reclaimedAt` card — the render V10 was previously owed).
  - **A craft fix with app-wide reach, found by chasing designer GAP-2 to its root:** `ui/src/index.css` carried a hand-written **UNLAYERED** `button,input,select,textarea{font:inherit}`. Tailwind v4 puts every utility in `@layer utilities`, and unlayered CSS outranks any layer — so **every `<button>` in the app was silently ignoring its own `text-*`/`font-*` classes** (the terminal-view toggle computed 16px/400 while asking for `text-[11px] font-semibold`, which is why it read louder than the stream identity it belongs to). Tailwind's own preflight already ships the identical rule inside `@layer base`, so the duplicate was deleted, not moved. **§Surface 1 and §Surface 2 were design-judged WITH the broken rendering — a designer re-look is owed there** (recorded as a debt, not fixed here).
  - **Final gate:** story-06 focused surface + fitness **60/0 GREEN** (incl. the V10 §Correction-3 lane), both blocker lanes (`acd-terminal-view-live-observable` a+b) verified independently by the orchestration — not on the sub-agents' reports; `npm run ui:build` (`tsc -b && vite build`) green; five real 1280 renders taken and judged (§Surface 3 CONFORMS on all witnessed states). **Story 06 stays `in-review`** — the task-03 `@manual` two-machine stream soak is the milestone's deferred human gate, closed at `aof:verify 38`. **Milestone stays `in-progress`.**
  - **⚠️ Routed OUT of this story (pre-existing, blocks nothing here but dilutes the RED-arming technique):** four arch tests still REGISTERED in `scripts/test.mjs` read `src/mesh-sync.mjs`, **deleted at m33** — `acd-sync-root-set`, `acd-claim-relay-independent`, `acd-fleet-reclaim-guarded` (+ `acd-command-namespace` from the concurrent m41 changeset). They are permanently red and were masked because the full suite crashes earlier on the `:4182` EADDRINUSE. **A RED that hides in a field of REDs pins nothing** (the architect's caveat) — route to the same stabilisation chore as the reclaim-scheduler/doctor/memory flakes.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- **Framing decisions (PO, user-confirmed):**
  - **Session presence is assistant-agnostic, hook-fed.** The signal comes from a coding assistant via
    hooks calling `aof session start|ping|end` — Claude Code first (`.claude/settings.json`), but the
    `aof session` contract is the seam so any tool can integrate. TTL-based liveness so a crashed
    session self-expires (never a stuck "working").
  - **Presence must aggregate across ALL a node's workspaces**, not the daemon's launch cwd — this is a
    real correctness fix, not just additive (a packaged tray app launched from the install dir reads an
    empty workspace today → permanently `idle`).
  - **Worker self-provisioning off the assignment** — repo checkout (location from a new global-config
    key) + a per-assignment worktree. NOT a general remote-command channel (out of scope).
- **Owed at refine → RESOLVED `2026-07-10`:**
  - **Auth transmission for a private-repo clone** → `RESEARCH.md` (measured) + `SECURITY.md` (threat model).
    Measured default: **`GIT_ASKPASS` + a control-minted, per-clone, short-lived, single-repo token**, scoped
    to a per-invocation `env` NEVER merged into worker ambient env (fallback: deploy key + `GIT_SSH_COMMAND`).
    Measured footguns the fitness functions now guard: `git clone --config http.extraHeader` persists the raw
    credential to `.git/config`; `execFile` inherits the full parent env into the spawned agent child (so a
    credential in ambient env would leak to `claude -p`). Pinned in ADR-005 + `acd-worker-clone-*`. The
    `@manual` clone soak stays gated on the SECURITY sign-off.
  - **Session ↔ run reconciliation** → **ADR-004**: the concrete task-RUN wins the primary "current work"
    line; a live session is the FALLBACK `working · <repo> (session)` only when no run exists; per-workspace,
    so a node working N repos shows N lines. One pure projection shared by desktop (36) + web (25).
  - **Presence-schema ADR** → **yes, ADR-001**: the live-session signal is an ADDITIVE fifth key (`sessions`)
    on the FROZEN m23 record; the four m23 keys keep byte-order, absent-is-benign (`sessions: []`). Plus
    **ADR-003** fixes the single-launch-cwd scope (aggregate across `global_node_workspaces`), **ADR-002**
    (session record + TTL reuses `isStale`), **ADR-006** (worker-worktrees subsumed by m35 → 2 stories),
    **ADR-007** (the graph-grounded partition). 5 fitness-function arch-tests added + wired into `test.mjs`.

- **Breakdown decision (PO, autonomous default taken):** 3 framed story seeds → **2 stories**.
  `worker-worktrees` was folded away (ADR-006) — milestone 35 already shipped the full worktree machinery
  (`mesh-worktree.mjs`) and a worker handler that already creates a per-assignment worktree, so there is zero
  net-new worktree work; the checkout story reuses it verbatim. This is a documented default (no data lost —
  nothing is deleted), surfaced for the end-of-refine review rather than gated.
- **Design baseline (user-chosen at refine):** binding-checklist-only (no new mock). `DESIGN.md`'s mandatory
  binding checklist against the existing fleet NodeCard is the conformance source of truth; a design review
  without a handed screenshot is INCONCLUSIVE, never guessed. At build the design conformance was NOT left
  INCONCLUSIVE — the built `ui/dist` was served with a fixture presence payload exercising every row-3 state
  and rendered via headless Chromium (1280 + 390); the designer judged the handed screenshot **CONFORMS**.
- **Build discovery — ADR-004 subsumption relocated (review fix F1, ratify at verify):** the fleet render helper
  originally keyed the "a run subsumes a same-workspace session → ONE line" rule off `activeRuns[].workspaceId`,
  but the FROZEN m23 `activeRuns` is a bare `string[]` (no workspace attribution). So in production a run + a
  live session in the SAME workspace rendered TWO lines (an ADR-004 violation) — masked because the reconciliation
  fitness function was fed attributed run OBJECTS, a shape the producer (`readActiveRuns` → run-id strings) never
  emits. **Fix:** the subsumption moved UPSTREAM into `assembleCurrentPresenceRecord` (`mesh-launcher.mjs`), which
  loops per-workspace and therefore genuinely holds the run↔workspace attribution; it drops a live session whose
  workspace has an active run before publish (the same "the assembler derives which live sessions to surface"
  discipline it already applies for TTL). The presence record stays at the frozen FIVE keys; `ui/src/fleet/runs.mjs`
  is now a pure projection over `{ activeRuns: string[], pre-subsumed sessions[] }`. This is a small refinement to
  where ADR-004's reconciliation lives (assembler vs fleet-model) — flag for architect ratification at `aof:verify`.

- **Refine `2026-07-18` (`aof:refine 38 --autonomous`) — stories 03–08 fully contracted; documented default decisions
  taken (autonomous mandate, all within the operator's stated direction — none a blocking/unsafe gate).** Authored
  ADR-011–016 (one per story) + SECURITY T12–T15 (+ T9 re-opened) + 24 task `.feature` files. The defaults taken,
  recorded here so they can be revisited at build/verify:
  - **03 (ADR-011):** builds ADR-010's "Known limitation" **option 2** (one GitHub App PER ORG), not one App installed
    across orgs — org is the isolation boundary. *Build-owed:* the App-key **filename convention** within the code-enforced
    default dir `<meshRoot>/credentials/` is unpinned (per-org keys need distinct filenames, e.g. keyed by `appId`); task-02
    asserts only the non-sync **prefix**, so pin the filename/keying at build (aof-qa flag).
  - **04 (ADR-012):** endpoint `POST /api/mesh/assign {ref,nodeId}`; admission = **loopback-bound + same-origin
    local-admission, no auth token this story** — a networked multi-operator fleet face would need a real auth gate
    (explicitly out of scope). The exact 4xx numbers for gate misses are a build mapping (the contract pins the *code*,
    not the number). ADR-012 grounded on the seam's history: m27/ADR-006 shipped a fleet-face write route later RETIRED,
    m35/ADR-007 deferred UI-assign — this is the third pass (carry to retro).
  - **05 (ADR-013):** ONE long-lived interactive `claude` **per assignment**; terminal-state via an explicit
    **`NEEDS_INPUT` sentinel** → a new third outcome `needs-input` (done/failed/needs-input). *Build-owed:* confirm the
    empty-string `session_id ""`→absent equivalence (task-03 QA-added boundary, not pinned by the ADR).
  - **06 (ADR-014):** terminal-VIEW route is **read-only** (server→browser); indicative shape `/ws/terminal-view?nodeId=&sessionId=`
    and relay `kind: "terminal-frame"` are indicative (scenarios assert *properties*, not literal identifiers, so a
    Three-Amigos naming choice won't invalidate them). Read-WRITE control deferred to Phase 2.
  - **07 (ADR-015):** branch `aof/mesh/<itemRef>-<assignmentId>` (sanitized); **"done" = pushed branch** + optional/manual
    PR (NOT merged, NOT auto-PR by default); two-token widening (clone stays `contents:read`, separate `contents:write`
    token minted only at push time). *Build-owed:* the push/write mint MUST be a SEPARATE exported function/module (not a
    widened branch of the clone provider) so the rewritten two-seam `acd-minted-token-scoped-single-repo` can key each
    body to its own mint (aof-qa flag). **T15 watch (aof-security):** a `contents:write` token is the first repo-MUTATING
    credential in this milestone + needs the operator to widen the App installation to `contents:write` — put the
    App-installation-widening attestation (T8/R7 extended) explicitly on the `aof:verify` checklist before this ships.
  - **08 (ADR-016):** sync-back TRIGGER = documented **MANUAL** `git pull` + `aof work memory ingest` on the control node
    after the worker branch merges (auto re-ingest on merge / `done`-with-record-doc-change = the richer future option).

## Feedback (for retro)

<!-- Mistakes, blockers, contract problems surfaced during build/review. Distilled into RETROSPECTIVE.md at aof:verify. -->

- **Reconciliation fitness fed a shape the producer never emits (F1, architect + QA).** `acd-session-run-reconciliation`
  and the task-04 render test were authored against attributed run OBJECTS while the ADR-001-frozen `activeRuns` is a
  bare `string[]` — so a green arch-test masked a real per-workspace-subsume violation in production. **Lesson:** a
  projection/reconciliation fitness function MUST be exercised with the ACTUAL upstream wire shape, especially when an
  ADR-001-style freeze prevents the producer from ever emitting a richer shape. (Fixed this milestone: subsumption
  relocated to the assembler; tests fed the production shape.)
- **The node test suite does not type-check the fleet TS — a UI build break stayed green (craft gap).** The new
  `ui/src/fleet/runs.mjs` shipped without its `.d.mts` companion (the house pattern: `assignments.d.mts` / `scope.d.mts`),
  so `node scripts/test.mjs` (which exercises `runs.mjs` via node:test directly) passed while `tsc -b && vite build`
  FAILED (implicit-any). **Lesson:** the craft/build gate must run the UI build (`npm run ui:build`), not only the node
  suite, whenever a `.mjs` helper is consumed from `.tsx`. (Fixed: added `ui/src/fleet/runs.d.mts`.)
- **Coverage gaps where the green was weaker than the contract (F2–F5, QA).** Several `@executable` tests dropped
  Examples rows or asserted a weaker property than the feature: task-02 fed pre-filtered arrays and never exercised
  `readLiveSessions`' TTL projection; task-03 aggregate dropped the `listItems`-throws isolation + 3-workspace + expired
  rows and asserted only a derived `overall` boolean; task-05 dropped the loud-coded-refusal `outcome` column; task-03
  credential asserted only the frame surface. **Lesson:** a traceability test must cover EVERY Examples row and assert
  the feature's stated property, not a convenient proxy. (All restored/strengthened this milestone.)
- **A security probe leaked a test token into the operator's REAL keychain (security, at verify).** During the
  first credential review, a `git credential approve` probe persisted a fake entry (`host=example.invalid`) into the
  real Windows Credential Manager; security caught it, erased it with `git credential reject`, and disclosed it.
  **Lesson: a security probe that exercises the live credential helper MUST redirect to a fake helper
  (`GIT_CONFIG_GLOBAL`), never the machine's real one.** (This is the F14 defect class — ambient machine
  credentials — biting the review OF F14.)
- **`test/mesh-reclaim-scheduler.test.mjs` case 06 is FLAKY (scheduler timing, pre-existing, NOT this milestone).**
  Fails ~1/5 in isolation, a different sub-case each time. It means the "N ok / 0 not ok" baseline is **not reliably
  reproducible** — a real gap for any gate that trusts a single green run. Route to a stabilisation chore.
- **A second, previously-undocumented timing flake found `2026-07-16`:
  `mesh-coordination-launcher/03 the healthy launcher refreshes this node's durable presence on each propagation
  tick`.** Failed once in a full-suite run (2580 ok / 1 not-ok) but passed cleanly 3/3 times re-run in isolation —
  confirmed NOT a regression from the same-session `mesh-repo.mjs` change (unrelated subsystem, deterministic in
  isolation). Same class as the reclaim-scheduler flake — a propagation-tick timing test racing under full-suite
  load. Route to the same stabilisation chore rather than opening a second one.
- **ADR-008 must generalise from PAYLOADS to COLLABORATORS (architect, at verify).** ADR-008 was written about
  producer-fed *payloads*. **F12 is the identical defect at the dependency-injection seam** — `cloneCredential` was a
  collaborator **whose only supplier was a test** (`workerExecutionOptions`, documented as a test-injection spread),
  so production silently got `null` and the worker could only ever clone a PUBLIC repo. "Fed by its real producer"
  must cover **wiring**, not just data. Armed as a fitness invariant: *every credential-shaped option the handler
  consumes must be a literal key at the production call site, never reachable only through the test spread.*
- **A fitness-function plant that silently no-ops makes the self-check VACUOUS (architect, at verify).** While
  writing the ADR-009 guard, the architect's planted defects failed to match — **the tree is CRLF and the needles
  were `\n`** — so three of four "self-checks" passed green while proving nothing. *This milestone's own defect class
  attacking the fitness function written to prevent it.* **House convention now: an arch-test plant must assert it
  LANDED (`notEqual(planted, source)`) before asserting the detector trips.**
- **⛔⛔ THE MILESTONE'S DEFINING LESSON — ONE defect class, FIVE times (F1, F4, F6, F7, F8): a component
  exercised against a FIXTURE shaped to its own convenience, never against its ACTUAL PRODUCER.** Every
  `@executable` lane, all 9 fitness functions, `validate`, and even the design-conformance **CONFORMS** verdict
  were green — while the milestone's headline feature was **inert end-to-end**. The live soak at `aof:verify`
  was the ONLY thing that caught it, and it caught it at the very first step.
  - **F1** — the reconciliation fitness test fed attributed run *objects*; the producer emits a bare `string[]`.
  - **F4** — the session CLI was coded AND tested against a hook payload carrying `workspace`/`repo`; Claude Code
    sends `cwd`. **The milestone's own RESEARCH.md §2.2 had already captured the real field set** — the contract
    (task-05:33) contradicted its own research, and nobody cross-checked.
  - **F6** — the card's render test fed a hand-built presence record; the real `/api/mesh/status` route carries no
    presence at all, so the web card is permanently `idle` (and always has been, even for `running N runs`).
  - **F7/F8** — the DESKTOP (a **Rust** app — the surface whose own m36 UAT raised this bug!) never learned about
    `sessions` at all, and mis-reads `activeRuns` as objects (F8 = F1's exact twin, in Rust).
  - **Also falsified: ADR-004's premise** that "both UIs consume the SAME projection function" — the desktop is
    Rust and structurally *cannot* import a JS projection. The rule is shareable; the implementation is not.
  - **THE RULE THIS MILESTONE EARNS (carry it forward):** *wherever we do not own the producer — a vendor hook
    payload, an HTTP route, a cross-language surface — the contract test MUST be fed a REAL CAPTURED payload from
    that producer. A "wiring" test that inspects a command string, and a render test fed a hand-built record,
    prove nothing about production.* Corollary: **a green suite is not evidence a feature works** — only a
    producer-fed path is. Budget the live soak EARLY, not as a closing formality.
- **⛔ BLOCKER at verify (F4) — the same F1 failure class, recurring at the HOOK seam; the milestone's headline
  feature was inert in production while every lane was green.** `aof:verify 38`'s live task-06 soak found that the
  shipped hook wiring can NEVER write a session record: `.claude/settings.json` fires the BARE `aof session ping`,
  but `mesh-session.mjs` resolves the workspace as `options.workspace ?? identity.payload?.workspace` — a payload
  field **Claude Code never sends** (its hook payload carries `cwd`, not aof's `workspace`/`repo`). Every real
  hook fires, exits 1 (`session-arg-missing-workspace`), and writes nothing — so a node being actively worked on
  still reads `idle`, the EXACT bug m38 exists to fix. It stayed green because task-00's tests drive the CLI with
  **explicit flags** and task-05's test only **string-inspects the composed hook command** — the JOINT (bare hook
  + real payload → record) was never tested. **Lesson (generalise F1, don't just fix it): F1's rule — "exercise the
  ACTUAL upstream wire shape" — was applied only to the reconciliation projection, when it is a rule about EVERY
  seam with a foreign producer. Wherever we do not own the producer (a vendor hook payload, an editor, a forge),
  the contract test MUST be fed a REAL captured payload, not a hand-authored one shaped to the consumer's
  convenience. A "wiring" test that asserts the command STRING without ever executing it end-to-end proves
  nothing.** (Routed back to `aof:continue` as a `@bug` + `@finding-F4` scenario; see VERIFICATION.md F4.)
- **Contract wrinkle — task-00 unsatisfiable Scenario-Outline row (dev-flagged; QA-confirmed sound handling).**
  `00_session-cli-record.feature`'s "the tuple is the key" Outline row 1 (`tuple-a == tuple-b`) carries an unsatisfiable
  clause (`ending tuple-a leaves tuple-b intact` cannot hold when the tuples are the same record). The dev did NOT edit
  the `.feature`; it asserted the row's satisfiable claim (record-count idempotency) and flagged it. **Action:** amend the
  `.feature` at next refine to scope the "leaves intact" clause to the distinct-tuple rows only (or split the Outline).
- **Story 02 built + reviewed `2026-07-16` (`aof:continue 38/02`) — all four review lenses GO, no production defect.**
  The `github-app` provider mint shipped producer-fed, not fixture-fed (the milestone's defining lesson, correctly answered):
  the JWT is signed by the REAL `node:crypto` RS256 signer and verified with `createVerify`; "no credential at rest" runs a
  REAL `cloneRepoForWorkspace` against a REAL local bare repo; the prompt-aware askpass is a REAL spawn with real prompt argv;
  task-00 drives the REAL `startLauncher` control wiring with NO `controlStreamServerOptions` override (the F12 literal-key
  path genuinely producer-fed). Reviews returned only LOW test-strength + hardening items, all applied: QA F-QA1/2/3 (assert
  the token/JWT redaction half, all three authz gates for the new provider, non-vacuous no-fallback), craft R1/R2/R3 (ssh-port
  never leaks into the GHES apiBaseUrl, `LC_ALL/LANG=C` pins English askpass prompts, `.json()` faults become the coded refusal),
  and a dead-constant dedup. F5/F6/F7 armed non-vacuously (CRLF-safe synthesized plants, landing-asserted).
- **Blocker (infra, NOT this story) — `scripts/test.mjs` binds a HARDCODED `127.0.0.1:4182` unconditionally, so two
  concurrent full-suite runs on one machine collide (EADDRINUSE crashes the whole run).** This bit the parallel developer +
  security fix passes: each `node scripts/test.mjs` crashed at the same real-server test while the other held the port. **Lesson:**
  the suite is not concurrency-safe on a single host; an early real-listen test should bind an EPHEMERAL/`:0` port (or read one
  from env), not a fixed 4182 shared with the live `aof mesh serve` daemon. Route to a stabilisation chore (alongside the
  pre-existing `mesh-reclaim-scheduler` case-06 timing flake, which fired once here and cleared on a clean re-run).
- **Fitness invariant over-claimed what its detector enforced (F5, security, at review).** SECURITY.md's F5 prose + the F5
  test header advertised coverage of the mint-time App JWT (T11), but the plant strategy + `KEY_NEEDLE` covered only the private
  key — the doc read as pinned while CI was not. No live leak (the JWT only rides `Authorization: Bearer` → fetch), but the
  detector under-enforced its stated invariant. Fixed at review (added the `jwt` needle + `mesh-launcher.mjs` to F5's scan set).
  **Lesson:** when a fitness invariant names multiple secrets ("key AND JWT"), the plant strategy must enumerate a plant per
  secret, or the prose must be narrowed to exactly what the needle matches.
- **Story 03's tasks 00/01 read as contradictory side-by-side unless the fixture is read carefully (developer, at build).**
  Task 00's Scenario 3 ("ws-c carries NO credential override of its own") resolves to the LAUNCH default (`app-launch`);
  task 01's Scenario Outline ("ws-noapp has no `githubApp.appId` at all") resolves to `null` and THROWS. Same input SHAPE
  ("no appId configured"), opposite outcomes — genuinely confusing on a first read. Reconciled: they are NOT the same
  fixture. Task 00's world has a configured launch default to fall through TO; task 01's world (three real orgs, isolation
  the point of the feature) configures NO launch default at all, so the SAME "absent override -> fall through to launch"
  code path resolves to nothing there, because there is nothing to fall through to — never a special-cased "defect"
  branch. **Lesson:** when a later task's Background implicitly assumes a DIFFERENT baseline fixture than an earlier
  task's (here: "does the launch workspace itself have a default App configured?"), say so explicitly in the feature's
  Background/Given — an implementer has to reverse-engineer the reconciling fixture shape from two features read
  together, which is fragile at scale.
- **Build-owed decision closed: the App-key filename convention within `<meshRoot>/credentials/` is `github-app-<appId>.pem`**
  (appId sanitized to a filesystem-safe slug — no path separator can escape the directory), falling back to the bare
  `github-app.pem` when no appId is configured (the pre-multi-org singular default, unchanged). Covered by dedicated tests
  in `test/mesh-clone-credential-app-key-default-dir.test.mjs` (two orgs' keys coexist as distinct files; a hostile appId
  stays contained; the no-appId fallback). Flagged by aof-qa at refine (STATE.md line ~222); pinned at build per this note.
- **`createGithubAppMintProvider`'s deps shape changed from static `{ appId, privateKey, installationId }` to a required
  `resolveWorkspaceAppIdentity(workspaceId)` seam (ADR-011).** This is a BREAKING change to story 02's own provider
  factory signature — the three existing story-02 test files that called it directly with static deps
  (`mesh-clone-credential-github-app-mint.test.mjs`, `mesh-clone-credential-app-key-not-relayed.test.mjs`,
  `mesh-clone-credential-mint-failure-loud.test.mjs`) were updated (not left to rot) to supply
  `resolveWorkspaceAppIdentity: async () => ({ appId, privateKey })` in place of the old static keys — same scenarios,
  same assertions, re-verified green. Named here per the R1(m20) near-miss discipline ("a guard on a shared spine seam
  silently invalidates prior-milestone tests — enumerate them, don't let them rot").
- **Story 07 (developer, at build) — F12's guard (`acd-clone-credential-pull-not-pushed`) generalises AUTOMATICALLY the
  moment a new credential-shaped collaborator exists, whether or not a task named its wire.** None of story 07's three
  `@executable` tasks (00-02) named a control<->worker frame-pair for the write credential — task 02's own Background
  scopes it to "the real clone-mint + push-mint functions ... no real GitHub, no network" — so the build's first pass
  supplied `requestWriteCredential` as an injected-only seam (mirroring how `requestCloneCredential` is injected
  directly in most story-01 task tests, with the wire itself proven separately in story-01's own dedicated task 05).
  The pre-existing, ALREADY-ARMED `acd-clone-credential-pull-not-pushed` (F12) immediately red-lit: its guard scans
  EVERY `credential`/`token`/`secret`-shaped option name `createMeshWorkerExecutionHandler` destructures and demands
  each be a LITERAL key at `mesh-launcher.mjs`'s production call site — `requestWriteCredential` matched that pattern
  on name alone. **Fixed, not routed around:** built the write-credential PULL wire in full — a NEW, DISTINCT frame
  pair (`write-credential-request`/`write-credential`, never reusing the clone frame kind), `applyWriteCredentialRequestFrame`
  (`control-stream-server.mjs`, the IDENTICAL SECURITY T6 holder/F15 workspace-match/F16 active-state gates as the clone
  credential PULL, applied unchanged to the write grant), `client.requestWriteCredential` (`worker-stream-client.mjs`,
  the identical bounded-wait/correlation shape), and the literal-key wiring at both the control and worker branches of
  `mesh-launcher.mjs` (`resolveWriteCredentialProvider`, mirroring but never sharing code with `resolveCloneCredentialProvider`).
  **Lesson (generalise F12 further): a story that adds ANY new credential-shaped option to a handler F12 already
  guards inherits the OBLIGATION to wire it to a real producer, even when the story's own tasks never named the wire
  mechanism explicitly — budget it, don't discover it as a surprise red fitness function after the behavioural work is
  "done."**
- **Story 07 (developer, at build) — a "shared plumbing" refactor across two mint functions silently made a
  DIFFERENT, PRE-EXISTING fitness function (`acd-cross-org-key-isolation`, story 03/ADR-011) vacuous.** The first pass
  at `createGithubAppPushMintProvider` (the write mint) factored the identity/JWT/installation-resolution steps it
  shares with `createGithubAppMintProvider` (the clone mint) into a shared internal helper, reasoning that neither
  helper ever touches the requested SCOPE (the one thing SECURITY T15/T9 cares about) so sharing it was "safe." It
  was NOT safe: `acd-cross-org-key-isolation` structurally scans `createGithubAppMintProvider`'s OWN function body
  text for the literal `resolveWorkspaceAppIdentity(workspaceId)` call, the `identity == null` throw, and an
  outer-scope cache check — moving that logic into a helper function removed it from the scanned span, and three of
  that fitness function's assertions started failing (caught immediately by the focused-harness re-run, never
  shipped). **Fixed: reverted to a FULLY INDEPENDENT `createGithubAppPushMintProvider`** — no shared helper with the
  clone mint at all, the identity/JWT/installation-resolution steps duplicated inline (a small amount of code
  duplication, deliberately accepted). **Lesson: before factoring "harmless-looking" shared plumbing out of a
  function an existing STRUCTURAL (source-text-scanning) fitness function already scans, check what that detector's
  anchors actually require to be INSIDE that function's own body — a refactor that is behaviourally identical can
  still be structurally invisible to a text-scanning detector.**

- **⛔ SOAK-BLOCKER F-38.05 (QA, at build review of story 05) — the `NEEDS_INPUT` / `AOF_SESSION_ID:` PRODUCER is UNWIRED;
  the milestone's defining green-≠-working risk, at the sentinel seam.** ADR-013 decision-4 says *"the driver PROMPT
  instructs the agent … to emit an explicit `NEEDS_INPUT` sentinel."* As built, the worker types ONLY `brief.command`
  into the PTY — no preamble/prompt instructs a real `claude` to emit either marker; the strings exist only as
  consumer-side scanners. Consequence: in production the `needs-input` outcome (task 02) can never fire and `session_id`
  (task 03) is always `null`. The `@executable` lanes are green because the TEST emits the marker the real producer is
  never instructed to emit — the F4 pattern (consumer coded for a payload the producer never sends). NOT fixed this pass
  DELIBERATELY: RESEARCH §4.3 measured `session_id` only from `claude -p`'s JSON output (interactive-mode capture is
  UNMEASURED), and the sentinel's real efficacy is exactly what the task-04 `@manual` soak exists to measure — building
  a speculative producer now risks shipping a wrong mechanism. **Owed at `aof:verify 38` task-04 soak: author the driver
  prompt preamble (ADR-013 decision-4) + measure how an interactive session surfaces its `session_id`, BEFORE running the
  soak.** **Lesson: shipping the CONSUMER half of a foreign-producer contract with NO producer at all is the same green-lane
  inertness this milestone keeps re-learning — budget the producer + its soak, don't defer both silently.**
  **Addendum (`2026-07-19` continue-review): the consumer half is now LINE-ANCHORED (see story-05 review fast-follow above) —
  when the producer preamble is authored at the soak it MUST emit the sentinel as `NEEDS_INPUT` alone on its own line, and the
  id as a newline-terminated `AOF_SESSION_ID:<id>` line, or detection will (correctly) not fire.**
  **CLOSURE (`2026-07-19` `aof:continue 38/05`) — F-38.05 fixed; this addendum's `AOF_SESSION_ID:` mechanism is SUPERSEDED.** The
  session_id producer is no longer a PTY marker at all — it is the transcript FILENAME (a **transcript-dir watch**, `defaultWatchTranscriptSessionId`),
  which needs ZERO model cooperation (Claude Code writes the transcript regardless), so the fragile "the model must print a marker line"
  premise is gone. NEEDS_INPUT keeps a sentinel, but now has a real producer: a worker-scoped `--append-system-prompt` (its real efficacy is
  still the task-04 soak's to measure). **The DURABLE lesson (architect, at build — carry to the retro / graduate to an ADR): a fitness
  function must pin the PRODUCER's EXISTENCE, not the consumer's current SHAPE. `acd-worker-driver-no-headless-print` invariant 4 had
  required the phantom marker path and invariant 3 asserted an empty argv — so its GREEN was part of why F-38.05 shipped inert AND a barrier
  to the fix. The rewritten fitness (invariant 4 = transcript-watch producer wired; NEW invariant 6 = the NEEDS_INPUT producer exists) now
  goes RED if either producer is removed. This is ADR-008's producer-fed rule turned back on the FITNESS FUNCTION itself: the arch-test that
  guards a foreign-producer seam must assert the producer is present and wired, or its green masks "green ≠ working" at exactly the seam it
  was written to protect.**
- **F-38.05c (QA, continue-review of story 05 — NON-BLOCKING, deferred): a command-less directive can HANG the driver.**
  The handler degrades a blank `directive.command` to `null` by design (`mesh-worker-execution.mjs:1116`) and the driver then
  types nothing; if the PTY also never exits and never emits the sentinel, `driveInteractiveClaudeSession` never settles — no
  terminal frame, worktree never cleaned. Hermetically reproducible (`command:null` + a non-exiting fake PTY). NOT fixed this
  pass: the fix is a watchdog/idle-timeout whose bound + terminal outcome is a design choice entangled with the "genuinely-stuck
  real session" case the task-04 soak owns. **Owed: either reject a command-less directive upstream, or design a driver
  idle/exit watchdog — decide at the task-04 soak alongside the producer.**
- **⛔ SOAK-BLOCKER F-38.06 (QA + architect, at build review of story 06) — the terminal STREAM is unwired in production
  AND rides a transport production never starts.** `mesh-relay.mjs`'s `serveRelay()`/`relayMode()` have NO production
  call site (the m33 fabric-native redesign moved the live worker↔control transport to
  `control-stream-server.mjs`/`worker-stream-client.mjs`); `mesh-launcher` does not wire `onOutputChunk` to any push
  transport, and `aof mesh ui` (`cli.mjs`) never passes `terminalMirror`/`startTerminalRelaySubscriber` — so the mirror
  never receives a live frame. The `@executable` lanes are honestly green against the REAL in-process `serveRelay()`
  broker, but the SPEC objective (watch a worker's live terminal from the control node) is inert on a real two-machine
  deploy. Architect adjudicated **sound-as-built at the `@executable` scope, owed at the task-03 soak** and wrote the
  **ADR-014 AMENDMENT** naming the resolution: wire `relayMode()` into the control launcher OR pivot the bridge onto
  `control-stream-server`/`worker-stream-client`. The dev deliberately did NOT wire a transport to a broker no role starts.
  **Owed at `aof:verify 38` task-03 soak.**
- **ADR-014 was authored against a STALE `graphify` grounding (architect, at review — retro-worthy).** Its
  codebase-graph grounding block cited `serveRelay`/`relayMode` as "a persistent cross-machine mesh transport [that]
  already exists" (no production call site) and two modules `mesh-presence-subscriber`/`mesh-presence-cache` as "the
  existing in-memory-cache subscriber" (both DELETED three milestones earlier at m33/`f3a4283`). The grounding was not
  re-verified against the live tree at authoring time. **Lesson: when an ADR's grounding cites specific modules/seams as
  "existing," build the graph FRESH and run `graph impact` on those exact names before ratifying — a decision that rides a
  retired transport ships a feature green in-process but inert on a real deploy (this is the ROOT of F-38.06).**
- **Broad-blast lesson (story-05 dev, at build): replacing a bounded default with an UNBOUNDED one is a whole-SUITE
  hazard, not just the story's own tests.** Swapping the worker driver's `claude -p` (bounded one-shot) default for a real
  interactive `claude` PTY silently changed EVERY pre-existing test that reached the driver without a `spawnRuntime`
  override from "slow but bounded" to "hangs forever" (real `claude` on PATH). Two pre-existing story-01 tests hung; the
  dev audited all 19 unoverridden call sites and patched the 2 unsafe ones. **Lesson: when you change a production DEFAULT,
  audit every caller of that default across the whole suite, not just the story's new tests.** (This also bit two review
  agents that ran a driver test and STALLED — the review harness must never run a worker-execution test.)
- **F-QA3 (QA, refine nit — NON-BLOCKING): story-08 task-01's "an off-topic query recalls nothing new" scenario is not a
  universal recall guarantee.** `rankRecords` (`src/memory/local-retrieval.mjs`) has no relevance floor, so a `lesson`'s
  type-boost tiebreaker fills the default `--limit 5` window regardless of content match when the corpus has ≤5 records.
  The dev's handling was FAITHFUL + intent-preserving (a realistic 5-baseline-lesson corpus, deterministic by stable-sort,
  no `.feature` edit). **Owed at next refine: amend the `.feature`'s `Then`/`Given` to state the corpus precondition, OR
  raise a separate enhancement to give `recall` a relevance floor.** Same class as the deferred task-00 unsatisfiable-outline
  nuance — route the same way.
- **A date-blind fixture is a TIME-BOMB in the baseline (found at this pass's integrating suite — infra, NOT this
  milestone).** `test/doctor-coherence-completeness.test.mjs` (+ `doctor-freshness-structural`) hardcode
  `updated: "2026-06-19"` and pin no `now`, so they use the real clock — as of `2026-07-19` (exactly the 30-day stale
  window) five `doctor/00`+`doctor/01` cases flip to failing on an unexpected `stale-updated` finding. The doctor
  subsystem is untouched by m38. **Route to the stabilisation chore (alongside `mesh-reclaim-scheduler/06`,
  `mesh-coordination-launcher/03`≡`global-work-propagation/03`, the `memory-integration` LLM-extraction flake, and the
  hardcoded `:4182` port): a date-sensitive fixture must pin `now`, never read the wall clock.**

- **⛔ SOAK-BLOCKER F-38.06 (the transport-reachability class — the milestone's `green ≠ working` thesis at a THIRD seam) + the three defects its review surfaced.** Story 06's terminal stream was green against an in-process broker but INERT on a real deploy (no production call site fed a frame). Distilled lessons (carry forward / graduate to ADRs):
  - **A cross-machine transport ADR must include an explicit BIND-ADDRESS / reachability check at source — the call/dependency graph does NOT surface it.** The architect first chose option (a) grounded in the import graph (which shows coupling), but the KILLING fact — `serveRelay` binds loopback (`listen(port,"127.0.0.1")`) while the fabric transport binds the fabric self-address — is a runtime networking property no import graph reveals. Green fitness + green lanes said "wired"; the feature could not cross machines.
  - **A producer-wiring fitness can flip GREEN on an inert feature if it pins the WRONG transport (unreachable for that leg).** The first `acd-terminal-stream-transport-wired` pinned "the relay push is wired" and went green on option (a) — unreachable cross-machine. Arming a producer-wiring fitness is NECESSARY but not SUFFICIENT: it must pin the transport actually REACHABLE for the leg, or it green-lights inertness (F-38.05 in a new dress).
  - **F17 — a STATED control that reads as implemented but whose wiring drops it (the identity re-stamp), with green fitnesses whose "clean" baselines ENCODED the vulnerable form.** The ADR + a green behavioural test both said the routing id is the connection-bound nodeId; production pushed the raw self-declared frame → cross-node spoofing. Lesson: an "identity re-stamp" invariant needs an END-TO-END fitness (the id REACHING the consumer is the connection id, exercised THROUGH the mismatch), never merely "the sink is HANDED it" — an arg the consumer is free to ignore.
  - **A config field that silently breaks a feature on its most INTUITIVE value is a footgun; remove the wrong degree of freedom by CONSTRUCTION (force-loopback) rather than document it.** `config.mesh.relay.url` was overloaded (control-stream endpoint + relay dial); a fabric-hosted value (the natural choice) silently killed the terminal legs with no error. Fixed by forcing the relay dial to loopback — the only correct value — not by a doc note.
  - **A structural (source-text-scanning) detector must extract the FUNCTION BODY, not the param-list default braces — else it matches `options = {}` and self-passes vacuously.** The architect's persist-check caught this in its own non-vacuous self-check (the milestone's own defect class attacking the fitness written to prevent it).

- **⛔ SOAK-BLOCKER F-38.06c (`aof:verify 38`, `2026-07-23`) — the SAME class at a FOURTH seam: a reachable producer with NO CONSUMER SURFACE.** The transport was wired (F-38.06) and the mirror fed, but `grep terminal-view ui/` = **0 matches** — no panel to watch, so task 03's soak was structurally unrunnable. Built at `aof:continue 38/06`; the build then found the break was **three links deep, not one**, and the review found **two more producer gaps underneath that**. Distilled lessons (carry forward):
  - **"Surface X on the record" is not a decision until you name WHERE a reader reads it.** ADR-013 said the `session_id` is "surfaced on the assignment record"; confirmed at source, it was surfaced NOWHERE a browser could read — the control node read only `runId` off the assignment-status frame (`control-stream-server.mjs:231-232`), `global_assignments` had no column, and `projectAssignment` carried eight keys none of which was the join key. **A join key needs its whole persist→surface→render chain named in the ADR, or each link silently assumes another link owns it.**
  - **⛔⛔ A producer that emits the key only at the END of the thing it identifies is inert for the ONLY window that matters (F-38.06d, QA, confirmed at source).** `sendAssignmentStatus(…,"running",{runId})` (`mesh-worker-execution.mjs:1448`) carries NO sessionId, because `sessionId` is first resolved at `:1466` — *after* `await spawnRuntime(...)` returns, i.e. after the session has already ended. Every frame that carries it (`needs-input`/`done`/`failed`) is terminal. So for the entire LIVE run the row is NULL → no `sessionId` on the read shape → the card renders **no terminal at all**; the id lands only once the stream is dead. **The lesson generalises past this bug: for a LIVE-view feature, "is the key produced?" is the wrong question — the right one is "is it produced DURING the window the view is meant to be watched?"** The task-04 lanes missed it by handing the persist lane a frame the TEST built: the real builder was used, the real *sequence* was not. **Producer-fed must mean producer-SEQUENCED, not merely producer-shaped.**
  - **A state a real producer can never drive is a consumer with no producer, at the STATE axis (F-38.06e, QA, confirmed at source).** The terminal-frame envelope carries only `{ sessionId, bytes }` — there is **no end-of-stream kind**, and the route unsubscribes on the BROWSER's close, never the session's end. So `ENDED` is unreachable from a real session end: after the worker exits, an open view sits on `streaming`/`live`/`pulse` **indefinitely** — DESIGN §Surface 3 V9's exact forbidden state ("a dead stream must not masquerade as a live one"). It passed because the V9 row was satisfied by calling the reducer directly. **F-38.05's defect class, relocated to the state machine.**
  - **A design render built on a hand-seeded fixture can only judge the CHROME, never the FEATURE (the ordering trap).** The `streaming live` render that produced this pass's design verdict required hand-seeding a `sessionId` the production sequence cannot yet emit (F-38.06d). The component's own treatment was genuinely judged; **the scenario it depicts cannot occur in production today.** This is the precise shortcut that produced this milestone's first false CONFORMS — recorded so the re-render after the fix is understood as the real gate, not a formality.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `node scripts/test.mjs` exit 0, 0 not-ok (2495 ok; tasks 00–05 story 00, 00–03 story 01, **00–04 story 02**)
- [x] Fitness functions green — the 6 story-00 + F1/F2/`acd-worker-checkout-reuses-worktree` story-01 + **F5 `acd-clone-app-key-not-relayed` / F6 `acd-minted-token-scoped-single-repo` / F7 `acd-clone-credential-provider-config-driven` story-02** arch-tests (armed at build, non-vacuous)
- [ ] `@manual` signed off — story-00 task 06 soak + story-01 task 04 private-clone soak + **story-02 task 05 real-App-mint soak**; closed at `aof:verify 38`
- [x] `@executable` lanes green (build `2026-07-18`) — stories **03** (00–02), **04** (00–03), **07** (00–02); fitness `acd-cross-org-key-isolation` / `acd-fleet-face-single-mutation-route` / `acd-write-token-scoped-to-push` + rewritten `acd-minted-token-scoped-single-repo`
- [x] `@executable` lanes green (build `2026-07-19`) — stories **05** (00–03, 42 assn), **06** (00–02, 59 focused), **08** (00–01); fitness `acd-worker-driver-no-headless-print` / `acd-fleet-terminal-mirror-read-only` / `acd-memory-index-never-on-mesh` (all non-vacuous, landing-asserted); `acd-mesh-ui-single-server` WIDENED for the ADR-014 read-only `/ws/terminal-view` carve-out. Integrating suite 2883 ok / 8 not-ok (all pre-existing/external — see Progress `2026-07-19`)
- [x] F-38.06 build closure (`aof:continue 38/06`, `2026-07-19`) — story **06** terminal-stream transport PRODUCER-WIRED (hybrid: fabric worker→control + loopback control→UI); new fitness `acd-terminal-stream-transport-wired` (inv.5/6/7 + F-38.06b loopback-dial clause) + security fitness `acd-fleet-terminal-frame-connection-identity` (F17); +`sendTerminalFrame`/driver-`onOutputChunk` behavioural coverage. Fitness sweep **39/0**, no cross-story regression, registration clean
- [x] F-38.06c build closure (`aof:continue 38/06`, `2026-07-23`) — story **06** task 04 `@executable` green: the fleet RENDERS the terminal-view (persist → surface → render, all three links built); the review's two further blockers **F-38.06d** (join key reported only at run END — ADR-013 inv.7) and **F-38.06e** (`ENDED` unreachable from a real session end — ADR-014 inv.8) both fixed and pinned by the new armed fitness `acd-terminal-view-live-observable` (both clauses green, RED-if-reverted). Story-06 focused surface + fitness **52/0**; `ui:build` green; post-fix 1280 render confirms V11/V12. App-wide craft fix: the unlayered `button{font:inherit}` that defeated every button's own `text-*`/`font-*` utility (a §Surface 1/2 designer re-look is owed)
- [ ] `@manual` signed off — story-03 task 03 two-org soak + story-04 task 04 real-UI soak + story-05 task 04 subscription soak (**F-38.05 CLOSED `2026-07-19` via `aof:continue 38/05` — producer built; soak now measures real-`claude` efficacy of the `--append-system-prompt` NEEDS_INPUT + the transcript-watch capture rate**) + story-06 task 03 stream soak (**F-38.06 CLOSED `2026-07-19` via `aof:continue 38/06` — hybrid transport wired (fabric worker→control, loopback control→UI); F17 spoofing + F-38.06b config footgun fixed; fitness sweep 39/0. Soak now measures real cross-machine efficacy + T14 on-screen-credential inspection**) + story-07 task 03 push soak + story-08 task 02 end-to-end mesh soak; all closed at `aof:verify 38`
