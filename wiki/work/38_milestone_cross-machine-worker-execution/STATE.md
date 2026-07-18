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

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `node scripts/test.mjs` exit 0, 0 not-ok (2495 ok; tasks 00–05 story 00, 00–03 story 01, **00–04 story 02**)
- [x] Fitness functions green — the 6 story-00 + F1/F2/`acd-worker-checkout-reuses-worktree` story-01 + **F5 `acd-clone-app-key-not-relayed` / F6 `acd-minted-token-scoped-single-repo` / F7 `acd-clone-credential-provider-config-driven` story-02** arch-tests (armed at build, non-vacuous)
- [ ] `@manual` signed off — story-00 task 06 soak + story-01 task 04 private-clone soak + **story-02 task 05 real-App-mint soak**; closed at `aof:verify 38`
