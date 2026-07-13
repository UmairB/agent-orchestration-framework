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

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `node scripts/test.mjs` exit 0, 0 not-ok (tasks 00–05 story 00, 00–03 story 01)
- [x] Fitness functions green — the 6 story-00 + F1/F2/`acd-worker-checkout-reuses-worktree` story-01 arch-tests
- [ ] `@manual` signed off — story-00 task 06 soak + story-01 task 04 private-clone soak; closed at `aof:verify 38`
