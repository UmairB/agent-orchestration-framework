---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 36 · Mesh Desktop App — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-07-09` via `aof:add-milestone`.
- **Refined + broken down `2026-07-09` via `aof:refine 36 --autonomous`** → 4 stories, all contracts authored
  (Three Amigos) in the same pass. Decide stage produced RESEARCH.md, ARCHITECTURE.md (4 ADRs + 5 fitness
  functions, green), DESIGN.md (2 surfaces + binding checklists). Milestone → `in-progress`.
  - `00 supervisor-core` — not-started (foundation)
  - `01 tray-presence` — not-started (depends 00)
  - `02 node-work-view` — not-started (depends 00)
  - `03 cli-install-run` — not-started (seam; task 03 = milestone `@uat` acceptance)
- **Build started `2026-07-09` via `aof:continue 36`.** Toolchain confirmed present (Node 22, cargo 1.93).
  Fanned out foundation stories `{00, 03}` first (file-disjoint), then `{01, 02}`.
  - `00 supervisor-core` — **in-review.** `app/desktop/` Cargo workspace + `crates/core` (`mesh-desktop-core`):
    `resolve` (trusted co-located spawn) + `status` (corrected-shape deserialize) + `poll` + `supervision`
    (pure seams). `cargo test` **23/0**; the 5 fitness functions **green now that `.rs` exists**. Tasks 00/01
    `@executable` ticked; 02/03 `@manual`. A guard-if-present **cargo lane** is wired into `scripts/test.mjs`.
  - `03 cli-install-run` — **in-review.** `src/commands/mesh-desktop.mjs` (`aof mesh desktop install|run`,
    outside the bijection) + `cli.mjs` dispatch + 3 `@executable` test modules (**19/0**). Verb spelling fixed:
    `aof mesh desktop install` / `aof mesh desktop run`. Tasks 00/01/02 ticked; 03 `@uat`.
  - `01 tray-presence` / `02 node-work-view` — **in-review.** One developer (shared `mesh-desktop-core`).
    Added `icon`/`tray_menu`/`view_model`/`render_state`/`read_only_inventory` (pure Rust, cargo-tested) +
    a real **Tauri v2 shell** (`crates/app`) that compiles clean (excluded from the fast test workspace) +
    `app.js` wired to the Rust-authoritative IPC view-model with a browser fixture fallback. `@executable`
    tasks ticked (01: 00/01; 02: 00/01/02); the real tray/window run + ambient residency + visual gate are
    `@manual`/`@uat`.
- **Reviewed `2026-07-09` (build Review gate).** Architect **SOUND** (no ADR breaches) · QA **PASS** · Designer
  **CONFORMS** (both surfaces, all four window states, both themes — every binding-checklist region + standing
  design-gap rule). **5 confirmed fixes applied + re-verified green:** (1) JS↔Rust view-model drift aligned
  (stale-first precedence; `v`-prefix on the IPC path); (2) added `node_rows()` multi-node mapping + a "none
  dropped / running+idle coexist" test; (3) de-tautologised the this-node dot assertion; (4) added a
  guard-if-present `cargo check (app/desktop shell)` lane so the excluded Tauri bin can't silently rot;
  (5) dropped an inert adversarial-input local. `cargo test` **67/0**; `node scripts/test.mjs` **GREEN**
  (2234 ok / 0 not-ok; both cargo lanes ok).
- **⚠ Watch-items for `aof:verify` (from the review — not defects):**
  - The IPC **poll loop is not wired yet** (story-00 `@manual` watchdog): a REAL Tauri run today returns the
    `None` view-model → renders the **loading skeleton**, not the node list. **Scope the `@uat` to "tray icon
    appears, window opens, menu items present,"** NOT "the fleet renders" — the live fleet render arrives with
    story 00's `@manual` poll/watchdog.
  - **Complete the design state-matrix at verify:** the designer judged 4 window states + tray in both themes
    (CONFORMS) but wasn't handed `restarting`/`stopped` control-bar pills, the **worker-node** window/tray
    (omits the server control), the tray empty/loading/error headers, or the three **tray icon-badge** states.
    Render these for the full `@uat` design gate.
- **Full suite `node scripts/test.mjs` GREEN** through the whole milestone build + review (0 not-ok; cargo
  test + cargo check shell lanes both ok).
- **F1 re-wire `2026-07-09` via `aof:continue 36` (resolves the `aof:verify` blocker).** The Tauri shell is no
  longer a scaffold: a new `app/desktop/crates/app/src/supervisor.rs` engine (own multi-thread tokio runtime on
  a background thread) wires all **six F1 items** to real OS effects, and `main.rs` was rewritten to drive it —
  (1) a live `mesh status --json` poll on a 3s cadence feeding `last_good_status` + the four-state render
  selection (keep-last-good on a miss); (2) a role-driven `tokio::process` watchdog per child — jittered-backoff
  restart on a genuine crash, named clean-exit-1 (`ui-build-missing`/`EADDRINUSE`/launcher-already-running)
  **surfaced not restart-stormed**, off the core's `supervision` seams; (3) the Windows **Job-Object
  `KILL_ON_JOB_CLOSE`** reaper (`win32job`, windows-target-scoped) with every child assigned, so Quit/crash
  reaps the tree; (4) `WindowEvent::CloseRequested` → `prevent_close`+`hide` and `RunEvent::ExitRequested`
  `code.is_none()` → `prevent_exit` for ambient residency (Quit the only true exit); (5) Start/Stop driving the
  real local children (tray menu **and** window control-bar buttons → engine commands, LOCAL supervision only);
  (6) `open-web-ui` → `opener::open_browser` at the running UI's `http://127.0.0.1:4181/`. The role/backoff/
  classification/render/tray-shape decisions are still **all computed by the cargo-tested pure core** — the
  engine makes none of its own. `app.js` now reflects the live local-process signals + re-polls on cadence.
  - **Green:** `cargo check (app/desktop shell)` clean (0 warnings) · `cargo test` core **67/0** · **all 5
    `acd-desktop-*` fitness functions** still armed + green against the new `.rs` (single `mesh status` path,
    {status,serve,ui} allow-list, trusted co-located spawns) · **full `node scripts/test.mjs` GREEN (0 not-ok;
    both cargo lanes ok)** — the external **F2** (`mesh-ui-global-scope` `Project:` line) has since resolved on
    the branch, so the shared gate is clean.
  - **Review gate — PASS.** Architect **CONFORMS** (graph-grounded: `app/desktop/` still zero source edges; no
    ADR-001/002/003/004 breach; Job Object / seam / trusted-spawn / single-data-path all honoured by the code,
    not just the greps). QA **PASS** (no blocker/major; role-latch, ambient residency, keep-last-good, restart-vs-
    clean-exit all traced correct). **2 confirmed fixes applied + re-verified green:** (a) `last_clean_exit` is
    now exposed through `IpcViewModel` + shown in the footer, so the clean-exit reason is *surfaced* (ADR-002 d2),
    not just captured (both reviewers flagged); (b) folded a redundant second mutex-lock in the poll into the
    single locked update (QA-04). Declined-with-rationale residue → verify: open-web-ui "running"=spawned-not-
    yet-port-bound (self-corrects; a ~1s window), the role-latch not re-arming on a runtime control→worker→control
    flip (out of SPEC's steady-role scope), the `std::Mutex`-across-`await` latent footgun (not currently tripped),
    and the error-banner "retrying every 5s" copy vs the real 3s cadence (design `@uat` copy).
- **✅ ACCEPTED `2026-07-10` via `aof:verify 36`.** Full **live cross-machine UAT** run + operator-signed:
  Windows control node (`umairs-msi`, running the desktop app) + macOS worker (`umairs-mac-mini`, mesh via
  CLI) over Tailscale — install → tray icon → mesh server + `aof mesh ui` up and kept up across a crash →
  window renders the live two-node fleet, terminal closed. All `@manual` runtime lanes **run + observed**
  (poll render, real supervision + crash→restart, Job-Object reap with no orphans, ambient hide-to-tray,
  Start/Stop real spawn, Open-web-UI). Seven UAT defects fixed inline + re-confirmed (F-UAT1–7); the shared
  `@executable` gate green (**2321 ok / 0 not-ok**) after de-flaking one gate test (F2 — a `launchFleet`
  arg-slot bug, not a code regression); GAP-1 set a standing design rule; **F-IDLE** ("idle while working")
  root-caused at the data source and **deferred to milestone 38** (presence-input capability gap, not an m36
  render defect). `aof work validate` **PASS**. All four stories → `done`, milestone → `done`. Findings +
  sign-off in [`VERIFICATION.md`](VERIFICATION.md); lessons in [`RETROSPECTIVE.md`](RETROSPECTIVE.md).

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- **Framing decisions (`aof:add-milestone`, user-confirmed):**
  - **Supervise, don't reimplement** — the Rust app spawns + watchdogs the *existing* `aof` mesh
    server/relay and `aof mesh ui`; no mesh logic is ported to Rust.
  - **Native tray window** — the app renders its own simple node/work view (to user-provided designs),
    *and* still launches the web `aof mesh ui` (openable in a browser). Not a webview-embed, not
    launcher-only.
  - **Windows first** — the Windows taskbar/tray is the named target; macOS/Linux tray deferred, Rust
    core kept portable.
- **Owed at refine:** user-provided designs → DESIGN.md (spawn `aof-designer`); native shell tech choice
  (e.g. Tauri vs egui + `tray-icon`) is an ARCHITECTURE decision, not settled at framing. **Both resolved at
  refine ↓.**

- **Refine decisions (`aof:refine 36 --autonomous`, 2026-07-09):**
  - **Mocks — user is generating them.** At the mandatory UI-path elicitation the user chose to **author the
    mocks themselves NOW** from a handover prompt (not "no mock → checklist only", not a pre-existing file).
    Commit target scaffolded at `mocks/` (`node-work-window.png`, `tray-menu.png`). DESIGN.md references both
    paths as the conformance source of truth AND carries the mandatory binding checklist as the standing
    baseline until they land — so no surface is baseline-less. ✅ **RESOLVED `2026-07-09`:** the user
    generated the mocks via claude.ai design and exported `mocks/AOF Mesh - standalone.html`; both
    `mocks/node-work-window.png` + `mocks/tray-menu.png` are now committed (rendered from the implemented UI,
    which realizes that design 1:1). The design MCP import was blocked (non-interactive session → no
    `/design-login`); imported via the user's standalone export instead.

- **UI layer implemented `2026-07-09` (start of the build — stories 01/02 surface).** `app/desktop/ui/`
  (`index.html` + `styles.css` + `app.js` + `tray.html`) — the WebView node/work window (all four states,
  light+dark) + the tray menu, vanilla HTML/CSS/JS with the design's exact tokens. `app.js`'s
  `mapStatusToView()` is story 02's `status-render-model`, coded against the corrected `mesh:status` shape;
  read-only; two ramps separate. Fitness functions still green (the UI is non-`.rs`, so the guard-if-present
  Rust checks stay dormant). **Still to build (`aof:continue 36`):** the Rust supervisor core (story 00),
  the Tauri shell + IPC replacing the fixtures (stories 01/02), the CLI verbs (story 03).
  - **Native shell = Tauri v2 (ADR-001), user-delegated to the architect.** The user chose "let the architect
    decide"; the architect picked Tauri v2 (web-native mock handoff + first-party bundler/single-instance +
    shared fleet-view vocabulary) over egui, with **reversal cost stated as MODERATE, cheapest before story
    02** — surfaced here for the veto review. egui is the recorded escape hatch (the supervisor core ports
    unchanged).
  - **No standalone SECURITY.md** (ADR-004 recommendation) — the whole security surface is local process
    spawn, fully covered by ADR-004 + `acd-desktop-trusted-spawn`. Flip only if the app ever opens a socket /
    accepts remote input / gains a fleet-mutation affordance (all out of scope).

- **⚠ Retro flag (corrected data contract) — carry to `aof:retrospective`.** The refine brief assumed the
  FLATTER `mesh:status` shape (`{ nodes }` with `activeRuns`/`localId` flat on each node). RESEARCH §3 measured
  the REAL shape: `{ nodes, boards, isControlNode }` with `presence.activeRuns`/`aofVersion` **nested**,
  `node.local` (boolean), `node.stale`. ADR-004 codes against the measured shape. **The corrected contract
  lives in RESEARCH/ARCHITECTURE, not the framing** — the developer must code stories 00/02 against
  `presence.activeRuns` / `node.local` / `node.stale` / `isControlNode`, NOT the brief's flatter assumption.

## Feedback (for retro) — ARCHIVED (graduated to RETROSPECTIVE.md at `aof:verify 36`, 2026-07-10)

<!-- Compacted at Accept: the build-time developer feedback + the F1 near-miss + the review residuals
     were distilled into RETROSPECTIVE.md (R1–R5, GAP-1, the per-file-`node --test` house-convention
     question, and the Findings ledger). See [`RETROSPECTIVE.md`](RETROSPECTIVE.md); this section's
     blow-by-blow is intentionally archived. -->

- Distilled lessons: **R1** (a `@manual`/`@uat` tag is a verification lane, not a licence to defer the
  implementation — the F1 near-miss, twin of [02/R5] + [34/R1]); **R2** (confirm at the source — the
  workspace-cleanup / F-UAT6 / piped-exit-0 mis-steps); **R3** (a flake that only fails under load is a
  gate defect — the F2 `launchFleet` arg-slot fix, resolving [34/R7]); **R4** (code the measured contract,
  not the framing sketch); **R5** (presence needs a live-session feed — F-IDLE → m38); **GAP-1** (cadence
  numbers are never literal copy). Open house-convention question (per-file `node --test` runnability) +
  the F1-build review residuals (spawn-vs-port-bound readiness, `std::Mutex`-across-`await` footgun) also
  carried to RETROSPECTIVE.md.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — all 4 stories: cargo 67/0 (core) + node mesh-desktop verb suite + 5/5 fitness armed & non-vacuous; **full suite 2321 ok / 0 not-ok (2026-07-10)**
- [x] Fitness functions green — 5/5 armed + green with the Rust subtree present
- [x] `@manual` / `@uat` — **ACCEPTED at `aof:verify 36` (2026-07-10).** Full live cross-machine UAT, operator-signed. See [`VERIFICATION.md`](VERIFICATION.md).

- **✅ `aof:verify 36` (2026-07-10) → ACCEPTED; all 4 stories `done`, milestone `done`.** The prior
  (2026-07-09) blocker **F1** (scaffold-only Tauri shell) was re-wired to a real supervisor runtime and,
  at this verify, **run end-to-end live across two machines** (Windows control + macOS worker over
  Tailscale) and operator-accepted. `@manual` lanes run + observed (poll render, real supervision +
  crash→restart, Job-Object reap no-orphans, ambient hide-to-tray, Start/Stop real spawn, Open-web-UI).
  Seven UAT defects fixed inline + re-confirmed (F-UAT1–7). **F2** (the shared-suite red) was diagnosed at
  this verify as a **flaky test** (a `launchFleet` arg-slot bug — the prior "RESOLVED 2026-07-09" note was
  wrong; it recurred under load) and de-flaked → suite **2321 ok / 0 not-ok**. **GAP-1** set a standing
  design rule (copy fix deferred). **F-IDLE** ("idle while working") root-caused at the data source →
  deferred to **milestone 38** (presence-input capability gap, not an m36 render defect). Design
  conformance CONFORMS with a low-priority residual (worker-node desktop-window variant + full pill matrix
  not each re-rendered live — the app is Windows-only, control-node path fully exercised). `aof work
  validate` **PASS**. Findings + sign-off → [`VERIFICATION.md`](VERIFICATION.md); lessons →
  [`RETROSPECTIVE.md`](RETROSPECTIVE.md).
