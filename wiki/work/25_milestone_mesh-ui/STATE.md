---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 25 · Mesh UI — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (the fleet-surface chunk — Phase 1).
- **Refined `2026-07-01` by `aof:refine 25`** (Decide + Break-down). [ARCHITECTURE.md](ARCHITECTURE.md)
  authored (ADR-001…004 + a Fitness Functions section) and [DESIGN.md](DESIGN.md) authored (the `aof mesh ui`
  binding checklist + a paste-ready mock brief, Appendix A). Broken into **3 graph-grounded stories** —
  `00_story_work-ui-rename`, `01_story_fleet-status`, `02_story_fleet-ui` (see the SPEC `## Stories`). No
  RESEARCH needed — the presence/relay/registry realities are known from the m22/23/24 codebase; no blocking
  empirical unknown.
- **Contracts authored `2026-07-02` by `aof:refine 25 --autonomous`** (the cascade: every story's Three Amigos
  fanned out in parallel — PO Scenarios inline, `aof-qa` Examples/tables + browser-lane design, `aof-developer`
  feasibility). **12 task features** landed (00 → 3, 01 → 3, 02 → 6); **15 QA feasibility flags all resolved**
  with source-checked developer verdicts. All three stories → `in-progress`. See each STORY.md `## Tasks` for
  the per-story list + the dev-locked literals. `aof work validate` → PASS (exit 0).
- **Test-suite state at Contract close (honest):** `node scripts/test.mjs` exits 1 with **exactly 3 failures,
  ALL milestone-24 WIP** — `arch/relay-auth-gate-checked` (RED until m24 story 02 adds the relay auth-gate) and
  `arch/enroll-git-argv-no-shell` ×2 (`ENOENT` on the not-yet-built `src/commands/mesh-revoke.mjs`). Milestone
  24 is `in-progress`, so these are expected-red on the shared tree — **unrelated to this m25 refine**, which
  changed no source (only `.feature` + record `.md`). **Every m25 arch-test is GREEN**, incl. `arch/25 ADR-001`
  (the board/ui rename XOR gate, green on both sides) and `arch/mesh-bijection`. The m25 gates flip correctly
  when the m25 code lands; the m24 reds clear when m24 finishes building.
- **Built + reviewed `2026-07-02` by `aof:continue 25`** (Build → Review, orchestrated — one `aof-developer` per
  story). All three stories built to green: `node scripts/test.mjs` → **exit 0, 1836 ok, 0 not ok** (baseline 1812
  + the fleet-status, fleet-ui + CLI-face traceability tests); `npm --prefix ui run build` clean (the fleet
  `?mode=fleet` bundle ships in `ui/dist`). **Stories 00 / 01 / 02 → `in-review`.** The tree's baseline was already
  green (the m24 WIP that STATE recorded as 3 expected-red at Contract close has since landed) — so m25 built on a
  clean suite. **Serialised 00 → 01 → 02 on the shared working tree** (a build-environment constraint, NOT a logical
  dependency — see Feedback): the two "independent" stories share `scripts/test.mjs` wiring and story 01 integrates
  with the **untracked** m24 `mesh-registry.mjs` a git worktree can't see, so parallel worktrees weren't viable; 02
  genuinely sequences after both (its drill target + its aggregate). Review verdicts:
  - **architect — STRUCTURALLY SOUND.** All four ADRs honoured; every m25 fitness gate is a genuine (non-vacuous)
    lock; the frozen `/api/work` envelope (`board-ui.mjs` / `setup-ui.mjs` / `board-serve.mjs`) is byte-identical;
    the stale `terminal-ws.mjs:52` comment was caught + renamed. **One MEDIUM semantic finding — F1 (below).**
  - **QA — PASS with gaps.** Coverage honest + source-true literals. Gap fixed at review: the `aof mesh ui`
    **CLI verb** had no spawn-level coverage (announce line / busy-port refusal / default-4181 bind were only tested
    in-process) — added `test/mesh-ui-cli-face.test.mjs`. Nits F3/F5 addressed / noted; F4 (locality) is the
    browser-lane gap below.
  - **designer — CONFORMS** (rendered live at 390 / 768 / 1280 via Playwright against a planted fleet fixture, judged
    against the DESIGN binding checklist — surface 1 — since `mocks/mesh-ui.png` is still **owed**). The load-bearing
    **node-presence ramp** (live teal-filled / stale muted-hollow / no-presence dashed, stale ≠ destructive) is exactly
    right; read-only + responsive reflow conform. **2 data-blocked gaps (below).**
  - Confirmed review fixes applied (a follow-up `aof-developer` pass, suite still green): the QA CLI-spawn coverage,
    the cosmetic `sess·—` dangling stub, the F3 render-count assertion tightening, and the duplicate empty-state string.

- **Mock landed + F1/design-gaps closed + conformance rendered `2026-07-02`** (design hand-off + `aof:verify 25`
  continuation). The owed `aof mesh ui` mock arrived (committed [mocks/Mesh.dc.html](mocks/Mesh.dc.html) + the
  `mesh-ui.png` render, the m21 `.dc.html` family convention) and the fleet surface was brought to conformance:
  - **[ADR-005](ARCHITECTURE.md) authored — F1 closed.** A board's `activeRuns` now reads its **owner node's
    synced `presence.activeRuns`** (the only fleet-durable run source), superseding ADR-002's dead
    `<workDir>/<slug>/` read. `mesh:status` re-authored (`src/commands/mesh-identity.mjs`), and the two locked
    contracts re-authored to the owner-presence seam (`01/tasks/00_boards-projection` + `01/tasks/01_mesh-status-render`
    + their traceability tests; `02_graceful-degradation`'s "work stream absent" scenario re-pointed to
    "owner has no presence"). Consequence pinned: the fleet chip is the **reduced running/idle** signal; the full
    m21 terminal ramp is a drill-in concern (**design-gap A** resolved — DESIGN surface 1 annotated).
  - **Design-gap B closed.** `mesh:status` now emits an additive `local` marker (pure read off
    `config.mesh.nodeId`) on the local node + its boards, so the **THIS NODE** tag renders and the task-03
    drill-in is the real local→link / peer→honest-hint split (previously under-implemented — no locality signal).
  - **Fleet UI conformed** (`ui/src/fleet/Fleet.tsx` rewrite + `ui/dist` rebuilt): top-bar group chip, `· N offline`
    summary, two-dot presence, THIS NODE tag, `not enrolled · no skills` footer, stacked board owner, centered
    empty/loading/error. `node scripts/test.mjs` → **exit 0, 1836 ok / 0 not ok** (F1 re-author kept the suite green).
  - **Live conformance render — CONFORMS.** Served `aof mesh ui` against a planted 5-node/6-board fixture
    (mac-studio = THIS node) and rendered at 390 / 768 / 1280 via Playwright. The node region + three-ramp
    discipline (teal live / grey-hollow stale / dashed no-presence — stale never red) + THIS NODE tag + responsive
    reflow all match the mock; the boards region conforms to the **reduced** chip (running/idle) per ADR-005 (the
    mock's terminal chips are aspirational for the fleet tile — drill-in only).

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- The **`aof work board` → `aof work ui` rename** is a deliberate ACD change to milestone 03's registered
  command + its frozen-envelope fitness functions — **not a drive-by edit** (PRD §8). It must land after
  milestone 21's run-observability extension to the same board (hence `depends: 21`), so the rename
  carries 21 forward rather than forking the surface.
- ~~Open for refine: how the rename touches the milestone-03 envelope while keeping its fitness functions +
  the milestone-08 bijection / no-UI-core-import guards green; the `aof mesh ui` layout; whether the fleet view
  is its own face or an extension of the work UI.~~ **Resolved at refine:**
  - **The rename is envelope-safe** because the board is a **CLI-only serve verb, NOT a registered command**
    (confirmed against source) — `board-ui.mjs`'s 6 frozen `/api/work` routes are untouched, so
    `acd-board-single-server` / `acd-board-write-isolation` / `acd-work-ui-no-core-import` /
    `acd-work-command-route-coverage` all carry forward **green, unchanged**. The rename is a `cli.mjs` surface
    edit proven complete by the new `acd-work-ui-rename-complete` (XOR form) — [ADR-001](ARCHITECTURE.md).
  - **The fleet data model is ONE registered command** — `mesh:status` extended to nodes + presence + boards +
    active runs; both the CLI mirror and the web UI consume it through the registry (no second data path);
    degrades gracefully when the m24 `readRegistry` seam is absent — [ADR-002](ARCHITECTURE.md).
  - **The fleet view is its OWN thin serve-face** (`aof mesh ui`), a sibling to `aof work ui` — NOT an
    extension of the work UI. It reaches fleet data only through the registry and drills into a board via that
    board's own `aof work ui` — [ADR-003](ARCHITECTURE.md).
- **Reconciliation — the frozen `/api/work` envelope is EIGHT routes, not six** (surfaced by the story-00
  developer feasibility read, confirmed against `board-ui.mjs`): 7 GET
  (`list`:44 / `doc`:52 / `tasks`:62 / `run-status`:68 / `validate`:82 / `doctor`:95 / **`next`**:114) + POST
  **`feedback`**:126. ADR-001 decision 2 and the original SPEC/STORY prose say "six (list/doc/tasks/validate/
  doctor/run-status)" — a prose ~~undercount~~ that omits `next` + `feedback`, both m03 routes under the same
  frozen prefix. **ADR-001 is immutable (superseded-not-edited), so the correction lives here + in the corrected
  SPEC/STORY prose;** the story-00 task-01 feature already asserts all eight. No behaviour changes — the count
  was always eight on the tree; only the record's tally was wrong.
- **Dev-locked contract decisions (durable — candidates to graduate at Accept):**
  - **Fleet aggregate shape (story 01):** the `mesh:status` `boards` entry is `{ ref, owner, activeRuns }` —
    `ref` = board slug, `owner` = single nodeId (first-wins on a shared board, per `admitNode` insertion order),
    `activeRuns` = running run ids. Enumerated as the **union** `registry.boards[] ∪ every roster[].boards[]`
    (never-drop); an ownerless board **omits** `owner` (not `null`, the m23 never-beat idiom); a non-local board
    resolves runs via THIS node's local work stream (`readActiveRuns(listItems(ws))`, ENOENT→[]).
  - **Fleet face (story 02):** new `src/mesh-ui-serve.mjs` on default port **4181** (clears assets-ui 4177/4178
    + board 4180), **reusing `ui/dist` with `?mode=fleet`** + the board's `ui-build-missing` friendly-refusal
    guard; a failed silent re-poll **keeps last-good** (m03 `load({silent})`); the peer drill-in is an
    honest-locality hint (no peer serve-URL exists on the tree) attributed to the owner node.
  - **The rename (story 00) is FAITHFUL** — each usage surface keeps its own port-hint shape (`[--port]`
    top-level, `[--port 4180]` in the work help); ADR-001 pins the verb, not a shape normalisation.
- **Build constraints pinned at Contract (owed at build, not blockers):**
  - The boards projection must own its **own** `readRegistry` try/catch **+ shape-guard** — `readRegistry`
    tolerates only ENOENT today; a parseable-wrong or unparseable registry currently *throws* (`mesh-registry.mjs`
    `JSON.parse` sits outside its try/catch). Without this guard the fleet read would crash on a torn registry.
  - The stale `aof work board` comment at `src/terminal-ws.mjs:52` rides the story-00 rename diff (it is code,
    not operator-facing prose, so out of the story-00 task-02 `@docs` sweep — no test catches it; a reviewer must).
- **Cross-milestone note:** milestone **24 (group-enrollment) is `in-progress`** — it authors the
  `readRegistry` roster the fleet view reads. Story 01 is designed **absence-tolerant** (single-node fleet when
  the seam is absent), so refine/build here is **not blocked** on 24 landing; the boards projection fills in
  once 24's registry ships.
- **Default decision (documented):** no `security`/`compliance` lens spawned — the fleet view is **read-only**,
  rendering already-git-synced records over a `127.0.0.1` same-origin server (the board's isolation model);
  issuing/assigning work is out of scope (m27). No new threat surface ([ADR-004](ARCHITECTURE.md)).

- **Build-review findings (2026-07-02) — carried to `aof:verify` for triage:**
  - **F1 (architect, MEDIUM — semantic; the one that needs a decision):** story 01's per-board `activeRuns`
    resolves via `boardWorkDir(ws, slug) = path.join(ws.workDir, slug)` — a `<workDir>/<slug>/` stream that has
    **no producer in real usage** (aof items are direct children of `workDir`; `registerBoard` mints group-level
    project slugs — separate repos — never a subdir of this node's stream). So the boards `activeRuns` column is
    **dead-`[]` in production** (the tests pass only because the fixture invents that layout); the NODES half shows a
    node's real run count (from presence) while the same aggregate's BOARDS half shows every board idle — the two
    halves disagree, defeating "every board being worked on" (SPEC Objective). **A contract / data-model problem, not
    a mechanical bug:** the contract's own dev-locked note (`readActiveRuns(listItems(ws))`) is *undifferentiated*
    (all local boards share the one stream), and the cleaner option — a board's `activeRuns` = its **owner node's
    `presence.activeRuns`** (already git-synced fleet-wide, already read in `mesh:status`) — was **explicitly rejected**
    by the graceful-degradation dev note. **Owed at verify: a superseding `ADR-005`** pinning the board→run-source
    resolution (recommend the owner-presence read — it works for peer boards too and invents no directory), which
    likely re-authors `01/tasks/00_boards-projection`'s activeRuns scenarios. Not a merge-blocker for the read-only
    render, but blocks `done`. **RESOLVED `2026-07-02` — [ADR-005](ARCHITECTURE.md):** board `activeRuns` = the
    owner's synced `presence.activeRuns` (a real fleet-durable producer, reachable for peer boards). `mesh:status` +
    `00_boards-projection` + `01_mesh-status-render` (+ their tests) + `02_graceful-degradation`'s run-seam scenario
    re-authored; suite green (1836 ok). The reduced fleet chip is the pinned consequence (design-gap A).
  - **Design gap A (designer + F1 sibling): the fleet run chip is thinned.** The aggregate carries only board run
    *ids*, so the tile chip shows `running` but no `#attempt` / `sess·…` and can never show a terminal `done · Nd` /
    `failed` — DESIGN checklist items 4/5 assume the richer m21 chip. The cosmetic `sess·—` stub was fixed at review;
    the payload decision (enrich the aggregate with the m21 per-board `work:run-status` join **vs** amend DESIGN to
    pin a *reduced* fleet chip) is owed — resolve alongside F1 (same aggregate-enrichment lever). **RESOLVED
    `2026-07-02` — reduced fleet chip (ADR-005):** the full per-board terminal ramp is not fleet-synced, so the fleet
    tile carries the reduced running/idle signal and the full ramp is a drill-in concern. DESIGN surface 1 annotated.
  - **Design gap B (designer + QA F4): no "this node" tag + no local-vs-peer drill-in split.** The aggregate carries
    no `local` marker, so story 02 renders the honest-locality copyable `aof work ui` hint **uniformly** (a safe
    superset; the `@executable` "no `/api/work` on drill-in" scenario IS covered). The architect confirmed this an
    **acceptable read-only degradation** (m27 owns adding locality with its issue/assign authz) — but DESIGN's "this
    node" tag + the live-vs-hint drill-in stay **unverified** in the machine lane (an `@ui` browser-lane gap). A
    follow-up task-feature (add `local: true` to the read → render the quiet "this node" label) is owed if we want
    the tag before m27. **RESOLVED `2026-07-02`:** `mesh:status` emits an additive `local` marker (pure read off
    `config.mesh.nodeId`) on the local node + its owned boards; the fleet UI renders the "this node" tag and the
    real local→link / peer→honest-hint drill-in split (the task-03 two-case split, previously under-implemented).
  - **Downstream test edits (story 01, reviewed sound):** two `mesh:status` consumers
    (`test/mesh-identity-status-commands.test.mjs`, `test/mesh-node-staleness-status.test.mjs`) asserted the
    over-strict whole-object `deepEqual(result, { nodes: [] })`; the sanctioned additive `{ nodes, boards }` (ADR-002)
    necessarily broke it. Relaxed to `nodes`-half + additive `boards: []` — architect + QA both confirmed **no
    coverage lost** (strictly more precise). The features never pinned the whole-object shape.

## Feedback (for retro) — GRADUATED at accept

<!-- Compacted `2026-07-02` at accept: the three lessons below graduated to RETROSPECTIVE.md (R1 —
     runtime-producer feasibility / F1; R2 — reconcile DESIGN vs the registered-command shape at refine;
     R3 — graph-independence ≠ worktree-parallel) and into memory (`aof work memory ingest`). Retained
     below as history; the carryable form is RETROSPECTIVE.md. -->

- **CONTRACT/DATA-MODEL — the boards `activeRuns` source was locked before a real producer existed (F1).** The
  Three-Amigos dev-verdict "LOCKED, buildable via the local-work-stream seam" held *for the test fixtures* but the
  seam (`<workDir>/<slug>/`, or the undifferentiated `listItems(ws)`) has no runtime producer — the per-board running
  count is dead-`[]` in production. **Lesson:** when a contract locks a read against a data source, the feasibility
  check must confirm a **runtime producer** for that source, not just that a white-box fixture can plant it —
  "buildable" ≠ "buildable against real data." The correct source (the owner's synced `presence.activeRuns`) was on
  the tree the whole time and was reasoned away. Fix owed: `ADR-005` + likely a boards-projection re-author.
- **DESIGN vs DATA — the DESIGN checklist (run chip, "this node" tag) assumed an aggregate richer than the locked
  `mesh:status` shape.** DESIGN was authored to the *intended* fleet view; the ADR-002 aggregate (`{ ref, owner?,
  activeRuns }`) is thinner. The two were locked in separate refine passes and never reconciled, so the build could
  only degrade. **Lesson:** reconcile the DESIGN binding checklist against the *actual* registered-command shape at
  refine (an "every rendered token has a real field on the command" pass), not discover the gap at the build render.
- **BUILD-ENVIRONMENT — "independent" stories weren't parallelisable here.** 00 ∥ 01 was the graph-clean partition,
  but the shared `scripts/test.mjs` wiring file + story 01's dependence on the **untracked** m24 `mesh-registry.mjs`
  (invisible to a git worktree) forced a serial 00 → 01 build on the one working tree. **Lesson:** graph-independence
  is necessary but not sufficient for parallel fan-out — a shared test-wiring file and untracked cross-milestone
  substrate are real serialisation constraints an orchestrator must weigh. (No harm; just slower than the SPEC's
  parallel projection implied.)

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `node scripts/test.mjs` exit 0, 1836 ok / 0 not ok (2026-07-02)
- [x] Fitness functions green — all m25 gates (rename XOR, single-data-command phases 1+2, the three mesh-ui face guards) + the carried board guards
- [x] `@manual` signed off — [VERIFICATION.md](VERIFICATION.md): design-conformance **CONFORMS** (designer, 5 renders @ 390/768/1280 + empty/no-boards) + QA browser-lane **PASS** (read-only / drill-in split / refresh / no-stream). F1 + design-gaps A/B **resolved** (ADR-005 + `local` marker). **Milestone ACCEPTED `2026-07-02`** — no `@uat` scenarios exist, so no human gate.
