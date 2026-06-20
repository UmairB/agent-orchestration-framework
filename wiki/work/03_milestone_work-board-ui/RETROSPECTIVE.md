---
doc: retrospective
ref: "03"
---
# 03 · Work Board UI — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never renumber.
Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE. This milestone
was **not clean**: it had one genuine **blocker stop** (F-1, the missing same-origin launch path — the
headline terminal couldn't be exercised at `@uat`), a **major mid-milestone rework** (the operator's
text-tree → card/lanes redesign, with the `@uat` paused until the visual direction settled), and a long
tail of review-gate findings. The lessons below come from that blocker, the VERIFICATION findings
(F-1/F-2, DG-1/DG-3/DG-7), and the STATE `## Feedback (for retro)` notes (now archived). The deferred
backlog items (DG-1, DG-7, the F-2 contract extension, the next-item scenario fixes) stay as findings in
VERIFICATION — they are routed work, not lessons; what carries forward is below.

## R1 — A feature whose value is only observable when *served* must ship its same-origin launch path as a first-class task, or it goes green-but-unexercisable

- **Kind:** blocker · **Area:** integration/launch · **Stage:** build→verify · **Owner:** developer · **Raised by:** aof:verify (F-1)
- **What happened:** every code lane for the agent terminal was green — the protocol-shape `@executable`
  suite, the A2 `pty.spawn` smoke, and the A7 missing-provider end-to-end run against the real server —
  yet the milestone's headline (`@uat`: Run agent → watch the dock stream) **could not be performed**,
  because no delivered command served the board same-origin: `aof assets ui` started vite whose proxy
  forwarded only `/api` (no `/ws`, no `ws:true`) and hardcoded `VITE_AOF_UI_MODE=assets`, while
  `serveSetupUi`'s static root served the **dev** `ui/index.html` (`/src/main.tsx`), not the built
  `ui/dist`. The WS (`window.location.host`) and the relative `api.ts` fetches both need one origin that
  routes `/api/work*` AND `/ws/terminal` AND the bundle — and nothing wired that.
- **Why:** the story contracts specified the terminal's *behaviour* (protocol, spawn, degrade) but not
  its *delivery* — "how the operator actually opens this same-origin" fell between the stories and was
  only discovered at the human gate, as a blocker.
- **Lesson:** when a feature's value is "see it running," the serving/launch path is part of the
  deliverable — author it as an explicit task with its own `@executable` coverage, don't let it be an
  afterthought caught at `@uat`. Resolved same-session via `aof:continue 03`: a first-class `aof work
  board` command + `serveBoard()` (`src/board-serve.mjs`) serving `ui/dist` through the one
  `serveSetupUi` server, pinned by story-01 task `05_serve-board-same-origin.feature` (4 `@executable`
  scenarios) + an end-to-end real-build probe. (Positive counterpart: R6 — make the `@uat` performable
  before the human shows up.)
- **Refs:** F-1 (VERIFICATION); ADR-001; `src/board-serve.mjs`; `05_serve-board-same-origin.feature`.

## R2 — A scenario asserting a state only reachable under a scope or a specific format must name it in the step, or the test passes by quietly supplying what the prose omits

- **Kind:** near-miss · **Area:** contract · **Stage:** refine→build · **Owner:** qa · **Raised by:** aof-qa (test-case design / review gate)
- **What happened:** `04_next-item.feature`'s blocked scenarios say an *unscoped* `aof work next`, but
  `nextWork` returns the first *ready* driver before any blocked one, so the fixture (04 depends on 03;
  03 not done) yields `03 ready`, never `blocked` — the endpoint test had to silently pass `?scope=04`
  to produce the blocked state the scenario asserts. A sibling drift: the same feature asserts the
  `waitingOn` list contains `"03"`, but `nextWork` pushes `String(dep)` → `"3"` (un-zero-padded), which
  the board renders raw.
- **Why:** the scenario's asserted state was reachable only under a scope (and a value-format) the step
  text didn't state, so the green test proved a path the scenario doesn't actually describe.
- **Lesson:** if a `.feature` step's outcome is only reachable under a scope/flag or a specific value
  format, put it in the Given/When — never let the binding test inject a `?scope=` (or assume a format)
  the scenario omits. Flagged-not-changed (the scenarios are wrong, not the impl); the fix (state the
  scope explicitly, or make the fixture's blocked driver genuinely first-actionable; pad or assert the
  un-padded driver number) is routed to refine.
- **Refs:** `04_next-item.feature`; `src/work.mjs` `nextWork` (:453); STATE `## Feedback (for retro)`.

## R3 — A frozen breakdown seam decouples stories but becomes a recurring drag once the consuming design outgrows it; extend it with a superseding ADR, never by bolting fields onto the serializer

- **Kind:** near-miss · **Area:** architecture/contract · **Stage:** refine→verify · **Owner:** architect · **Raised by:** aof-architect + craft (F-2)
- **What happened:** ADR-002 froze `aof work list --json` as a flat 7-field array
  (`ref,type,slug,status,title,parent,dir`) — the seam that let all three stories build in parallel. But
  the approved card/lanes redesign then wanted data the contract deliberately doesn't carry: per-milestone
  **task counts**, the acceptance gate's **`depends`/"waiting on X"**, and the detail **Findings count**.
  The same root surfaced three times — **F-2** (the redesign's fidelity gaps), **DG-1** (Findings count
  is a hardcoded `"Findings (0)"`), and the uncomputable **gate→milestone association** (`model.ts` keys
  on `uat.parent`, which `listStream` always sets `null`; the gate's `depends` edge isn't in the seven
  fields). The build degraded **honestly** (counts omitted, gates strip absent, Findings `0`) — nothing
  faked — but full fidelity is blocked on the contract.
- **Why:** a read-model frozen early to decouple the partition met a UI that kept evolving past it; the
  data the design grew to need was, by design, not in the seam.
- **Lesson:** a frozen read-model is the right call for decoupling parallel stories, but when an
  early-frozen seam meets an evolving UI, budget for a **contract-extension** as its own work — the honest
  path is a *superseding ADR-002* (richer fields or a sidecar read-only endpoint), never adding fields to
  `listStream`, which would trip `acd-work-list-contract`. Partly discharged: the **tasks** half is now a
  separate read-only `GET /api/work/tasks` (no contract change); the roll-up counts / `depends` /
  Findings-count remainder is routed to `aof-architect` at refine.
- **Refs:** ADR-002; F-2, DG-1 (VERIFICATION); `src/work.mjs` `listStream`; `ui/src/board/model.ts`;
  `GET /api/work/tasks` (`src/board-ui.mjs`, `src/feature-parse.mjs`).

## R4 — Visual fidelity cannot live in a `.feature` (the litmus is right to keep it out), so the board's visual language needs an operator-mocked design pass *before* the UI scenarios are authored

- **Kind:** rework · **Area:** design · **Stage:** verify→refine→build · **Owner:** designer · **Raised by:** user (UAT walkthrough)
- **What happened:** the milestone's single biggest change — the original indented text-tree board
  reworked to the two-level card **overview grid** + five-lane **status board** — did not come from any
  contract or `@executable` failure. It came from a UAT walkthrough where the operator found the
  text-tree "hard to digest as a whole," supplied mocks, and the `@uat` was **paused mid-milestone** until
  the visual direction settled. The `@executable` suite stayed green throughout — correctly, because the
  litmus keeps visual fidelity out of the `.feature`; the suite never had an opinion on whether the board
  *read well*.
- **Why:** a green behavioural suite proves the data and the actions, never the visual language — and the
  visual language was under-invested up front, so the drift only surfaced when a human looked at it.
- **Lesson:** for UI milestones, settle the operator's visual direction (real mocks, a genuine DESIGN.md
  pass on the board's visual language) **before** authoring the rendered-surface `@manual`/`@uat`
  scenarios — late visual rework is the default failure mode otherwise, because the contract can't catch
  it. Discharged this run: DESIGN §1 + the rendered-board scenarios were rewritten to the card/lanes
  model and re-reviewed (design-conformance CONCERNS, only non-blocking gaps), then accepted at `@uat`.
- **Refs:** DESIGN §1; STATE `## Feedback (for retro)` (the rework note); `00_board-renders-stream.feature`.

## R5 — A fitness function asserts the presence of what should exist, not the absence of what shouldn't; an invariant of the form "X exists nowhere outside Y" needs whole-surface scope plus a negative assertion

- **Kind:** near-miss · **Area:** architecture · **Stage:** build→verify · **Owner:** architect · **Raised by:** aof-architect + craft (structural review)
- **What happened:** two backstop gaps, both clean today but uncaught by CI: (1)
  `acd-board-write-isolation` greps only `board-ui.mjs`, so a *second* board-server work-stream write site
  introduced elsewhere (e.g. `terminal-ws.mjs`) would not trip the test — the invariant's intent ("the
  board's only work-stream write is the feedback append") is broader than its one-file scope; (2)
  ADR-006's guarantee that the derived command "travels ONLY as raw PTY input" rests on the **absence** of
  a `{type:'run'}` executing member in the wire envelope, but the envelope tests assert members that
  *exist*, never that no executing frame was added — so a regression that bolted one on would pass CI.
- **Why:** both invariants are negative ("nowhere," "no such member"), but the tests were written as
  positive checks scoped to where the property currently holds — they prove the right thing only as long
  as nothing moves.
- **Lesson:** when an invariant is "X exists nowhere outside Y," scope the grep to the whole surface (not
  the one file it lives in today) and add a **negative** assertion (the forbidden site/shape does NOT
  appear). Logged for the next structural pass (no build defect to fix); pairs with the ADR-004 dnd-kit
  note — when drag is eventually wired, add an arch-test asserting no status mutation flows from a drag
  handler.
- **Refs:** ADR-004, ADR-006; `test/arch/acd-board-write-isolation.test.mjs`; STATE `## Feedback (for retro)`.

## R6 — When a `@uat` scenario names an interaction, verify the affordance exists at the review gate, not at the human pass

- **Kind:** near-miss · **Area:** design/build · **Stage:** build→verify · **Owner:** designer · **Raised by:** aof-designer (design-conformance, review gate)
- **What happened:** the terminal dock shipped from build with auto-reflow only and **no user
  drag-resize** — so the `@uat` "drag the dock taller so the pane has more rows" (DESIGN §4) would have
  been **unperformable** when the human sat down to it. A layout-only top-edge resize handle was added
  during the review gate, before `@uat`.
- **Why:** the behavioural suite covered the resize *signal* (fit → exactly one resize), not the
  *operator gesture* the `@uat` requires — so the missing affordance was invisible until someone read the
  `@uat` step against the build.
- **Lesson:** at the structural/behavioural review, walk each `@uat` scenario against the built surface and
  confirm every named interaction has its affordance — cheaper to add at the gate than to discover the
  human pass can't proceed. The positive counterpart of R1: make the `@uat` performable before the human
  shows up. Confirmed paid off — the A4 `@uat` resize-reflow scenario passed at sign-off.
- **Refs:** DESIGN §4; `00_run-agent-terminal.feature` (resize `@uat`); STATE `## Feedback (for retro)`.

## R7 — A craft/structural pass over *touched* code earns its keep on green-suite-invisible defects: latent repo-health bugs and duplication across a frozen seam

- **Kind:** near-miss · **Area:** code · **Stage:** build→verify · **Owner:** developer · **Raised by:** automated craft pass (review gate)
- **What happened:** the craft pass found two things no `@executable` scenario could: (1) a **pre-existing
  repo-health bug** — `validateWork` used a literal **NUL byte** as its dedup-key separator (committed in
  milestone 00), which made `src/work.mjs` register as a *binary* file to git/ripgrep; not introduced
  here, but the board's `/api/work/validate` depends on `validateWork`, so it was fixed
  (behaviour-preserving). (2) **Duplication across a frozen seam** — ADR-003 freezes the wire envelope,
  yet `parseControl` is implemented twice (server `terminal-ws.mjs` + client `TerminalDock.tsx`) and the
  resize shape is re-implemented inline vs `resize.mjs`, so the "frozen" envelope is only as frozen as
  someone keeping two copies in sync.
- **Why:** behavioural scenarios assert outcomes over the current well-formed code; they never see file
  encoding, nor that two implementations of one frozen contract could drift apart.
- **Lesson:** budget a craft/structural pass over the code the milestone *touches* (not just the code it
  adds) — it surfaces latent repo-health bugs and seam-duplication a green suite is blind to. NUL-byte
  fixed this run; the `parseControl`/resize de-duplication (one shared `.mjs` both sides import) is routed
  as cleanup so a future envelope change can't silently diverge the two copies.
- **Refs:** ADR-003; `src/work.mjs` `validateWork`; `src/terminal-ws.mjs`; `ui/src/board/TerminalDock.tsx`;
  `ui/src/board/terminal/resize.mjs`.
