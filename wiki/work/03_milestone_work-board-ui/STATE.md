---
doc: state
---
# 03 · Work Board UI — State

## Progress

- [x] `00_story_work-list-json` — built, `in-review`. `aof work list [--json]` emits the locked flat
  seven-field contract (ADR-002) via the new exported `listStream(workDir)`; human listing + scope. All
  `@executable` scenarios green; `acd-work-list-contract` green.
- [x] `01_story_work-board` — built, `in-review`. `/api/work*` API (`list`/`doc`/`validate`/`next`/`feedback`)
  in `src/board-ui.mjs` + the one-screen React board/detail/actions surface; feedback append is the board's
  sole write (ADR-004). All endpoint `@executable` scenarios green; `acd-board-write-isolation` green. The
  rendered-UI scenarios are `@manual` (await dev-server verification at `aof:verify`).
- [x] `02_story_agent-terminal` — built, `in-review`. `node-pty@1.1.0` + `ws@8` at `/ws/terminal` + xterm
  dock + the ported `CliProvider` seam (MIT-attributed); honest-degrade on a missing provider. The headless
  `@executable` lanes green; `acd-terminal-server-only`, `acd-vibeyard-attribution`, `acd-board-single-server`
  green. A2 `pty.spawn` smoke PASS (VERIFICATION). Live stream (A4 `@uat`) + real provider present/missing
  (A7 `@manual`) pending.

**Board visual rework `aof:refine`+`continue 03` (2026-06-20, on operator feedback).** The original
single-screen indented-tree board was reworked to an approved **two-level card design** (Claude-design
project `a1e976a1…`, `Work Board.dc.html`): VIEW 1 a milestone-card **overview grid** (glyph-ring status,
honest two-segment progress bar, story dots, summary chips, Acceptance-gates strip); VIEW 2 a
five-lane **status board** scoped to one milestone (read-only derived buckets — NOT a draggable kanban),
with the existing detail panel + terminal dock. New `ui/src/board/{status.tsx,model.ts,Overview.tsx,
BoardLanes.tsx}`; `Board/DetailPanel/ActionsStrip/TerminalDock` restyled; `BoardTree.tsx` deleted; the
glyph-ring ramp maps to theme tokens (crimson in-review = `accent`). `api.ts` + the terminal `.mjs` +
vibeyard MIT notices untouched. Full suite green (622 ok), five fitness functions green, `ui/dist`
rebuilt, same-origin serve + `/ws/terminal` handshake re-confirmed. Operator review fixes applied
(detail/dock are board-view-only; no horizontal overflow; progress bar animated + honest done-vs-active).
DESIGN.md §1 + Default 1/3 rewritten to this model; `00_board-renders-stream.feature` `@manual` scenarios
revised (grid+lanes); **F-2** logged (the design wants counts/`depends`/findings the frozen ADR-002
contract doesn't carry — a superseding extension).

**Detail-panel doc model corrected (operator catch, same rework).** The panel was offering
milestone-level tabs (VERIFICATION/RETROSPECTIVE/Findings) on *stories* (which read "none") and dumping
a story's frontmatter as its "objective" + mislabelling its tasks checklist as "acceptance." Made the
panel **type-aware** per the ACD doc model: a **milestone** owns `SPEC·VERIFICATION·RETROSPECTIVE·
Findings`; a **story** owns only `STORY` (user story + tasks); frontmatter/comments stripped on render;
opening a milestone's board now **defaults selection to the milestone** (story view on click). DESIGN §2
+ `01_detail-shows-records.feature` rewritten to match; validate PASS, suite green.

**Terminal lifecycle fixes (operator asks).** (1) **Collapse no longer kills the session** — the
WS/PTY + xterm stay mounted-but-hidden while collapsed (scrollback preserved; only ✕ ends it); was the
DG-5 tear-down. (2) **Provider picker is claude-only** for now (codex/gemini paused via a UI-visible
list; the provider seam + server still support all three). (3) **Running PIDs are logged + persisted**:
the server logs the spawned pid and records each session (`pid·ref·provider·cwd·startedAt`) to
`.aof/terminal-sessions.json` via new `src/terminal-sessions.mjs` (register on spawn, unregister on end,
dead pids self-prune). Recording is gated by a `recordSessions` option — **on** for `aof work board`,
**off** for the asset-UI/test servers (so the suite's temp-dir teardown never races the write). 3 new
`terminal-sessions` unit tests; suite 636 ok; the write is operational `.aof/` state, outside ADR-004's
work-stream write-isolation (which scopes board-ui.mjs writes to STATE.md). DESIGN §4 updated. The pid
registry is the foundation for a future "open in terminal" / session-cleanup affordance.
**Deferred (2026-06-20):** true "continue the running session in the host terminal" requires
fanning the one server-side PTY out to a second client (attach-vs-spawn + broadcast) + an
`aof terminal attach <ref>` CLI — you can't re-attach a native terminal to a running process's PTY on
Windows, and the operator doesn't want a re-run. Web-only for now; the `.aof` session registry is the
lookup that feature would build on.

**The terminal dock is now a PERSISTENT shell element (operator catch — sync killed it).** Root cause:
the dock was rendered INSIDE the loading/error/overview/board conditional, so any board-content change
that re-evaluated that branch unmounted it → WS close → PTY killed. Two-part fix: (1) the ⟳ sync is a
**silent in-place refresh** (no loading/error flip — also better UX, no flash); (2) decisively, the
`<TerminalDock>` is rendered **OUTSIDE the conditional**, a direct child of `<main>` gated only by
`dockOpen` — so sync, a view switch, the loading state, or any re-render can no longer unmount it; only
✕ ends the session. (Same teardown class as the earlier collapse fix; this makes the dock immune to all
of them.)

**State-aware primary action (operator ask + ADR-006).** The detail panel's headline button is now
state-aware: it derives its label + the `aof` command from the item's derived status
(`not-started`/not-broken-down → Refine, broken-down/`in-progress` → Continue, `in-review` → Verify,
`blocked` → disabled, `done` → ad-hoc Run agent), and swaps to **View terminal** when a session is live
for the ref. Launching spawns the provider and **types the slash-command into the agent as ordinary PTY
input** on connect — so ADR-003's wire envelope + ADR-004 (board never shells out / writes) are
untouched (recorded as **ADR-006**, additive). New `ui/src/board/action.mjs` (+ `.d.mts`, matching the
`terminal/*.mjs` twin convention so the test runs on Node ≥20 — the developer's first cut was a `.ts`
relying on Node-22 type-stripping; converted); the dock now binds to its own session `ref`
(`dockRef`/`dockCommand`), not the live selection. 8 `board-action` unit tests; suite 633 ok; five
fitness functions green (terminal `.mjs` + envelope unchanged). DESIGN §2/§4 updated. Clicking **Verify**
on an in-review item now drives `/aof:verify` live — i.e. the `@uat` lane is now one click.

**Story tasks surfaced + markdown rendering (operator asks).** Added a read-only
`GET /api/work/tasks?ref=` endpoint (`src/board-ui.mjs` + a dependency-free Gherkin parser
`src/feature-parse.mjs`) that parses a story's `tasks/*.feature` (Feature title, scenarios,
`@executable`/`@manual`/`@uat` lane + counts); the story panel gained a **TASKS** tab. Doc bodies now
render as **markdown** (`marked@^18`, `ui/src/board/Markdown.tsx` + a `.md` stylesheet) instead of raw
`<pre>` (GFM tables render). 3 new `board-api/tasks` tests; suite 625 ok; `acd-board-write-isolation`
green (the endpoint is read-only). This resolves the **tasks** half of F-2 (residual: per-milestone
roll-up counts, gate `depends`, findings count). NOTE: the `aof work board` server caches `.mjs` routes
in memory — restart it after a server-side change (a stale server 404s new routes). The `@uat` lane is
unaffected and still pending.

**F-1 launch gap fixed `aof:continue 03` (2026-06-19, post-verify).** `aof:verify 03` surfaced blocker
**F-1**: no delivered launch path served the board same-origin, so the agent terminal's `/ws/terminal`
could not connect (vite proxied only `/api`; `serveSetupUi` served the dev `ui/` index, not the `ui/dist`
build). Fixed by a first-class `aof work board` command + `serveBoard()` (`src/board-serve.mjs`) that
serves the BUILT `ui/dist` through the existing single `serveSetupUi` server — `/api/work*`,
`/ws/terminal`, and the bundle now share one 127.0.0.1 origin (no second server/port; ADR-001 intact).
Authored as story-01 task `05_serve-board-same-origin.feature` (`@bug @finding-F1`); 4 new `@executable`
scenarios + the full suite green (622 ok). Re-verified end-to-end against the real build: `/` → built
index (`/assets/…`, not `/src/main.tsx`), bundle asset 200, `/api/work/list` 22 items, `/ws/terminal`
handshake OPEN — all same origin. Architect review PASS-with-concerns; the two confirmed cheap fixes
applied (honest `EADDRINUSE` degrade in `serveSetupUi`'s listen + `workBoardCommand`; `work board` default
port 4180 to avoid the 4177/4178 `assets ui` collision). A4 `@uat` live stream + story-01 rendered-UI
`@manual` are now PERFORMABLE (`aof work board`) — pending the human pass at re-`aof:verify`.

**Built + reviewed `aof:continue 03` (2026-06-19).** Stories serialised 00 → 01 → 02 (real coupling: the
shared `serveSetupUi` server, the one-screen shell embedding the dock, and the `listStream` serializer the
CLI + board both reuse). Full suite green (632 unit, integration green). Review gate ran four lenses —
architect (PASS), qa (PASS w/ concerns), designer (CONCERNS), automated craft (ship-able): confirmed cheap
fixes applied (handler try/catch hardening; Next made subordinate to Run-agent; a layout-only dock
drag-resize handle; not-started chip + connecting-dot ramp tweaks); the rest distilled below for retro.

Refined `aof:refine 03 --autonomous` (2026-06-19): Decide (RESEARCH + DESIGN in parallel → ARCHITECTURE)
→ break-down → all three contracts authored (Three Amigos fanned out per independent story). Decide used
`aof-researcher` (vibeyard reuse + node-pty/ws feasibility), `aof-designer` (the one-screen board +
detail + terminal-dock), and `aof-architect` (5 ADRs + 5 fitness functions + the partition rationale).
Doc-producing only — no build. **One review surface handed back at the end (this run).**

## Notes & decisions in flight

Default decisions taken on the autonomous pass (none warranted a stop — each is safe and reversible;
recorded here per the autonomous contract):

- **node-pty native dependency — feasible-as-is, documented default, NOT a blocker** (RESEARCH §2,
  ADR-003). `node-pty@1.1.0` (upstream Microsoft, N-API) **bundles a win32-x64 prebuilt** in its npm
  tarball — no node-gyp, no VS Build Tools, ABI-safe across Node 20/22/24. Explicitly **not** the
  homebridge fork (0.13.1 ships no win32-x64 prebuild) and **not** `@lydell/node-pty` (beta). The one
  residual is a routine build-time confirmation (A2): that the prebuilt `pty.node` actually loads + forks
  a PTY on this exact machine/Node — a `pty.spawn` smoke test resolves it when story 02 lands. Flagged
  for the operator because it is the milestone's highest-risk piece, even though the evidence (from the
  actual tarball) clears it.
- **One server, two surfaces** (ADR-001). The board's HTTP API (`/api/work*`) and the terminal WebSocket
  (`/ws/terminal`, via `ws@8` `noServer`/`server.on('upgrade')`) share the single existing
  `http.createServer` (`setup-ui.mjs`) on one 127.0.0.1 port — no second server, no second port, no auth
  surface (localhost single-user). The disjoint namespaces are what decouple stories 01 and 02.
- **Locked `work list --json` contract = flat array** (ADR-002). Per item exactly
  `{ ref, type, slug, status, title, parent, dir }`; the board derives the tree from `parent`. Frozen as
  the breakdown seam — story 01 binds to a fixture of it. Chosen flat (not nested) to keep the CLI emit a
  thin pass over the existing `listItems` and the fixture easy to snapshot.
- **Board is read-mostly; the feedback append is its only write** (ADR-004). Status is DERIVED, never
  written (dnd-kit is layout-only — no drag-to-restatus); validate/next are in-process calls to
  `validateWork`/`nextWork` (no CLI shell-out); the sole mutation is one attributed bullet under a
  milestone/story's STATE `## Feedback (for retro)`.
- **vibeyard is reused as a recipe, not a package, under MIT attribution** (ADR-003, RESEARCH §1). We port
  the `pty.spawn` lifecycle + the `CliProvider` interface + the terminal-pane wiring, replacing the
  Electron IPC carrier with `ws`; every adapted file carries vibeyard's MIT copyright notice (a binding
  licence obligation + the `acd-vibeyard-attribution` fitness function).
- **DESIGN ramp onto a 3-variant Badge** (DESIGN Default 1). The kit's `Badge` has only
  `default`/`secondary`/`destructive`; the five ACD statuses map by meaning (done=teal, blocked=red, the
  three active/pending states share grey, disambiguated by label + glyph). The designer chose not to fork
  the design system to add amber/blue — the PO is the most likely override point if richer status colour
  is wanted.
- **No SECURITY / COMPLIANCE doc** — proportionate ceremony. The server is 127.0.0.1-only, single-user,
  no auth surface, no regulated/personal data; the supply-chain consideration (node-pty/ws/xterm/vibeyard)
  is covered by the pinned versions + MIT-attribution decision in ADR-003. RESEARCH + DESIGN + ARCHITECTURE
  are the Decide docs warranted here.

Nothing left open as a blocker: no genuine blocking unknown surfaced and no unsafe/irreversible decision
was required, so the autonomous run cascaded through to a single review without an early stop.

## Feedback (for retro)

<!-- Raw process notes from the build + review gate — distilled into RETROSPECTIVE.md at aof:verify. -->

- `04_next-item.feature`'s blocked scenarios ("a blocked result names the unmet dependencies it waits on")
  are unsatisfiable **as written**: the step says an *unscoped* `aof work next`, but `nextWork` returns the
  first *ready* driver before a blocked one, so the named fixture (04 depends on 03; 03 not done) yields
  `03 ready`, never `blocked`. The endpoint test had to silently pass `?scope=04` to produce the blocked
  state. Wrong scenario — flag, don't change. Fix at refine: state the scope explicitly in the step, or make
  the fixture's blocked driver genuinely the first actionable one. — Raised by: qa   Refs: 03/01 tasks/04_next-item.feature; src/work.mjs nextWork
- No `@executable` coverage for a **multi-dependency** `waitingOn` (more than one unmet driver); the
  "names the specific drivers" promise is only exercised with a single unmet dep. — Raised by: qa   Refs: 03/01 tasks/04_next-item.feature
- The detail panel's **Findings** tab renders only the empty state ("No findings.", count 0) — populated
  findings rendering (count Badge + severity `StatusLine` rows, DESIGN §2) has **no task scenario**; the
  features only specify the empty case and there is no findings data source/endpoint. Genuinely out of the
  authored contract → route to refine, not a build defect. — Raised by: designer   Refs: DESIGN §2; 03/01 tasks/01_detail-shows-records.feature
- The terminal dock shipped from build with auto-reflow only and **no user drag-resize**; the `@uat`
  "drag the dock taller" (DESIGN §4) would have been unperformable. A layout-only top-edge resize handle was
  added during the review gate — cheaper here than discovering it at UAT. — Raised by: designer   Refs: DESIGN §4; 03/02 tasks/00_run-agent-terminal.feature
- ADR-004's "dnd-kit is wired to layout only" clause has **no enforcing fitness function** because dnd-kit is
  not yet imported anywhere in `ui/src` (more conservative than the ADR). If a future story wires drag, add
  an arch-test asserting no status mutation flows from a drag handler. — Raised by: architect   Refs: ADR-004
- Pre-existing repo-health bug found during this milestone's craft review (NOT introduced here): `validateWork`
  used a literal **NUL byte** as its dedup-key separator (committed in milestone 00, `2842461`), which made
  `src/work.mjs` register as a *binary* file to git/ripgrep. Replaced with `` (behaviour-preserving)
  since the board's `/api/work/validate` route depends on `validateWork`. — Raised by: developer (craft pass)   Refs: src/work.mjs validateWork
- The board's hierarchical **text-tree is hard to digest** — the operator wants a more **visual, card-based**
  representation so a work item can be evaluated **as a whole** at a glance, not read as a wall of text. NOT a
  draggable kanban (status stays derived — ADR-004); a richer visual board/card model. Needs a real DESIGN
  rework — the designer to spend more time on the board's visual language; **user will supply mocks + guidance**.
  Routes to `aof:refine 03` (designer revisits DESIGN.md §1 board surface). `@uat` is paused until the visual
  direction settles. — Raised by: user (UAT walkthrough)   Refs: DESIGN §1 board tree; 03/01 board surface

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green (story task features built — 55 headless assertions across the four
  milestone-03 modules; full `npm test` green)
- [x] Fitness functions green — `acd-board-single-server`, `acd-work-list-contract`,
  `acd-terminal-server-only`, `acd-vibeyard-attribution`, `acd-board-write-isolation`
- [ ] `@manual` / `@uat` signed off — node-pty `pty.spawn` smoke (A2) **PASS** (VERIFICATION.md); the
  end-to-end agent stream (A4 `@uat`) and a real provider present / missing-provider error state (A7
  `@manual`) **pending** at `aof:verify`; story 01's rendered-UI `@manual` scenarios pending dev-server
  verification
