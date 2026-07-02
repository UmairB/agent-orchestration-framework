---
doc: design
---
<!--
  Milestone DESIGN.md — how should it look and feel, and why.
  Owner: designer. Layout / component / visual intent only.
  UI BEHAVIOUR (what happens when you click) lives in task .feature files — cross-referenced below,
  not specified here.
-->
# 21 · Board Run Observability — Design

## Intent

The board names the next pipeline stage but never shows what actually *ran*. Once milestone 19 records
each run as durable derived state, the board can finally make the **run** visible — per work item, its
**run history**, its **current run's state**, and a quiet **rerun** affordance. The operator's question
this milestone answers is "what has the agent done on this item, and what is it doing right now?" — added
to, never replacing, the m03 board's "where does each item stand?".

This is a **read-mostly observability** layer, not a control surface. It extends the existing operator
console (the calm IDE of milestone 03) with **zero new design system**: it reuses the m03 kit and the
fixed theme ramp in `ui/src/index.css` — `primary` = teal, `accent` = crimson, `destructive` = red,
`secondary`/`muted` = neutral grey, Inter body + a `.mono` utility, `--radius` = 0.5rem. It reuses the
m03 surfaces wholesale: the type-aware tab row in `ui/src/board/DetailPanel.tsx`, its TASKS-tab bordered
row idiom, the glyph-ring status ramp in `ui/src/board/status.tsx`, the `load({silent})` poll/refresh
idiom + the `runAgent(ref, command)` → `TerminalDock` launch in `ui/src/board/Board.tsx`, and the dock's
connection-state dot+label ramp in `ui/src/board/TerminalDock.tsx`. This DESIGN.md is a **sibling of
`03/DESIGN.md`** and must read as one.

**Three surfaces, two binding rails carried from m03 + two new ones:**
- *(carried)* **Status is derived, never user-set** (no drag-to-restatus) — nothing here edits item
  data/status inline. The board's only write stays the m03 feedback bullet (ARCHITECTURE ADR-002).
- *(carried)* **Reuse the existing kit/tokens** — no new palette, no new design system.
- *(new)* **Run-state vocabulary ≠ item-status vocabulary.** The run lifecycle (`queued → running →
  done | failed | cancelled`) is rendered as a **dot + label chip**, never as the glyph-ring. The
  glyph-ring stays the item-status vocabulary. The two are read-only ramps shown together, never merged
  (ARCHITECTURE ADR-002 — the run-state ramp is never folded into item frontmatter).
- *(new)* **Observability is poll/refresh, not push.** A `⟳` refresh affordance over the existing
  read-mostly board — no live-tail / websocket / event-stream chrome (ARCHITECTURE ADR-001; SPEC §Out of
  scope).

---

## Surfaces

> All three surfaces share one conformance source of truth: the committed, locally-readable mock
> **`wiki/work/21_milestone_board-run-observability/mocks/work-board-runs.dc.html`** — a self-contained
> HTML export of the approved claude.ai/design "Work Board — Runs" mock (plain divs + inline styles + two
> `@keyframes`). It is the **visual source of truth** the design-conformance review renders against; the
> prose + binding checklists below are the durable spec. It is referenced by this path (a locally-readable
> artifact, never a remote-link-only reference) so the read-only designer/review can open it directly.

### 1 — The run history view (a new type-aware "RUNS" tab)

- **Mockup:** `wiki/work/21_milestone_board-run-observability/mocks/work-board-runs.dc.html` — the RUNS
  tab body (its `tab:'runs'` default state), specifically the **History** section (the
  `<!-- History -->` block: the `{ ref, runs[] }` rendered newest-first as bordered rows) and the
  **RUNS · empty state** inset (the dashed-border "No runs yet" card).
- **Route:** the board view's detail column (~382px), a new tab on the existing type-aware tab row in
  `ui/src/board/DetailPanel.tsx`. The hash carries the selected `ref` for deep-linking (unchanged).

- **The tab set gains RUNS (type-aware, per the ACD doc model).** RUNS is added at the level that owns
  runs — both milestones and stories have a `runs/` log (m19 ADR-002), so RUNS appears on both:
  - **milestone →** `SPEC · VERIFICATION · RETROSPECTIVE · RUNS · Findings` (RUNS sits before Findings).
  - **story →** `STORY · TASKS · RUNS` (RUNS sits last, after the tasks checklist).
  - **uat →** unchanged (`Findings` only — a uat gate has no run log).
  The tab is rendered by the same `-mb-px border-b-2 … text-xs font-semibold` tab idiom already in
  `DetailPanel.tsx`; the active tab carries `border-primary text-primary`, exactly as the existing tabs.

- **Layout & interaction (the RUNS body, top → bottom):**
  - A pinned **Current-run strip** at the top (surface 2 — designed there).
  - A **History** section: a small uppercase `History` section label with a right-aligned mono count line
    (`N prior runs · newest first`), then a **vertical list of bordered rows, newest-first**. Each row:
    - the **attempt number** (`#5`) — mono, weight 700, the row's leading identity token;
    - a **run-state chip** (dot + label — surface 2's ramp), showing the run's terminal/last state;
    - a **mono, truncated session id** (`sess·9f2e…`) — quiet grey, the run's correlation handle;
    - a right-aligned **relative timestamp** (`12m ago` / `1h ago` / `yesterday` / `2d ago`).
  - The outcome, when terminal, reads through the **state chip itself** — `done` (teal ✓), `failed`
    (red), `cancelled` (grey) ARE the terminal outcome; a separate outcome token is not added (the chip
    is the outcome; keep the row scannable). The chip is the single state/outcome signal per row.
  - **Empty state:** a **dashed-border** card — a dashed grey ring glyph + "No runs yet" + "This item
    hasn't been run." (mock's RUNS · empty state inset). This mirrors the m03 *doc-absent* convention (a
    dashed-border placeholder, NOT an error) — an item with no runs is **absent, not broken** (m19's
    `readRuns` returns `[]`, never an error).

- **Component choices + WHY:**
  - **Mirror the TASKS-tab bordered-row idiom, NOT a table.** Each run is a `rounded-md border border-border
    p-3`-class row, exactly the `TasksTab` section idiom in `DetailPanel.tsx` — a run history is a short,
    scannable list read against the item, the same shape as the tasks list it sits beside, so the two
    read as one family. A dense table would break the panel's calm card rhythm.
  - **Attempt number leads (mono), not the runId.** The frozen schema's `runId` is an opaque correlation
    id; the **attempt** (`#5`) is the human-meaningful ordinal the operator counts by. The runId is not
    shown (it is the chip's `title`/correlation handle if needed); the **truncated `sessionId`** is the
    one mono id shown, because it is the handle that ties a row to a terminal session.
  - **Newest-first.** The current/most-recent run is the operator's first interest; history descends.
  - **`brief` is opaque — never rendered.** The board treats `brief` as opaque (m19 ADR-003; ARCHITECTURE
    ADR-001) — it is the agent's, not shown in any row.

- **Data:** the RUNS body renders `work:run-status`'s `{ ref, runs: RunRecord[] }` (ARCHITECTURE
  ADR-001), read through `/api/work/run-status?ref=` (a new `workApi.runStatus(ref)` client mirroring the
  existing `workApi.tasks(ref)` shape in `ui/src/board/api.ts`). The fields rendered are exactly the m19
  frozen schema's: `attempt`, `state`, `outcome` (folded into the chip), `sessionId` (truncated mono),
  `createdAt` (relativised to "Ns ago") — with `runId`/`itemRef`/`updatedAt` available but unshown and
  `brief` opaque. The board renders these nine fields; it **writes none of them**.

- **Binding checklist (regions in order → component → states):**
  1. **Tab (type-aware):** RUNS added — milestone = `SPEC·VERIFICATION·RETROSPECTIVE·RUNS·Findings`;
     story = `STORY·TASKS·RUNS`; uat = unchanged. Same `border-b-2` tab idiom; active = `border-primary
     text-primary`.
  2. **Current-run strip:** pinned at the top of the RUNS body (surface 2).
  3. **History section:** uppercase `History` label + right-aligned mono `N prior runs · newest first`.
  4. **Run row (per run, newest-first):** `border` row → `#attempt` (mono 700) · **run-state chip**
     (dot+label, surface 2 ramp) · truncated mono `sess·…` · right-aligned relative timestamp. Outcome
     reads through the chip; `runId`/`brief` not shown.
  5. **States:**
     - *empty* — dashed-border card: dashed ring glyph + "No runs yet" + "This item hasn't been run."
       (NOT an error).
     - *loading* — a `.mono` "Loading runs…" line (the panel's existing loading idiom).
     - *error* — an `accent` line ("Could not load runs: …"), mirroring the TASKS-tab error line.
     - *populated* — the Current-run strip + the newest-first history rows.

### 2 — The current-run state indicator (the dot + label chip)

- **Mockup:** `wiki/work/21_milestone_board-run-observability/mocks/work-board-runs.dc.html` — the
  **Current run** strip (the `<!-- Current run strip -->` block: the teal-bordered `#f7fffe` card with
  the pulsing `running` chip + `#5` + `sess·…` + the `⟳ refreshed 8s ago` affordance) AND the **lane-card
  in-flight dot** (the `inflightStyle` pulse dot on the `03/02` lane card, `@keyframes rpulse`).
- **Route:** rendered (a) pinned at the top of the RUNS body (surface 1), and (b) as a tiny pulse dot on
  the milestone/lane card in the board lanes (`ui/src/board/BoardLanes.tsx`).

- **The run-state ramp — a DOT + LABEL CHIP (deliberately NOT the glyph-ring).** The run lifecycle is a
  **different vocabulary** from the item-status glyph-ring, so it is rendered in a **different visual
  primitive** — a coloured dot + a text label in a token-tinted chip, the **same dot+label STYLE as the
  dock's connection-state indicator** in `TerminalDock.tsx` (`describeState` → dot class + label), with a
  run-lifecycle vocabulary instead of a connection vocabulary. Colour + label travel **together, never
  colour alone** (the m03 status-chip rationale). The ramp, onto the existing tokens:
  - `queued` → **muted/grey** dot + "queued" (`secondary`/`muted`) — reserved by m19 for m20's
    scheduler; renders quietly when present.
  - `running` → **teal** (`primary`) dot + "running", with a **subtle pulse** on the dot (the mock's
    `@keyframes rpulse` — a soft expanding ring, the same pulse the dock uses for a live session).
  - `done` → **teal** (`primary`) dot **with a ✓** + "done" — accepted/successful terminal.
  - `failed` → **red** (`destructive`) dot + "failed" — the one alarming terminal state.
  - `cancelled` → **grey** (`secondary`) dot + "cancelled" — a quiet, non-alarming terminal stop.
  This chip is reused identically by the History rows (surface 1) — one source emits the chip for both
  the current strip and the history list, exactly as `status.tsx` emits ring/chip/dot from one source.

- **Layout & interaction (the Current-run strip):** a teal-bordered, faintly teal-tinted card (the
  mock's `#f7fffe` on `#99f6e4`) under a small uppercase `Current run` label, holding:
  - **Top row:** the **run-state chip** (the latest/in-flight run's state) · the **attempt** (`#5`, mono)
    · the **truncated mono session** (`sess·9f2e…`).
  - **Bottom row:** the **`↻ Rerun`** affordance (surface 3) · a hint line · and a right-aligned
    **`⟳ refreshed Ns ago`** poll/refresh affordance.
  The "current run" is **not a second fetch** — it is the latest / in-flight element of the same `runs[]`
  the RUNS view already read (ARCHITECTURE ADR-001: the UI selects it — the single `state:"running"`
  record, else the most recent by `createdAt`). When there is no current/in-flight run, the strip shows
  the **most recent terminal run** with its terminal chip (the strip is always present when runs exist;
  it degrades to the empty-state card from surface 1 when there are none).

- **The lane-card in-flight pulse dot.** When an item has a `running` run, a **tiny teal pulse dot** sits
  on its milestone/lane card (the mock's `inflightStyle`: an 8px teal dot, top-right, `rpulse`
  animation) — so active runs are visible **from the board**, before opening the detail panel. It is the
  run-state ramp's `running` colour (teal) in dot-only form; it is **distinct from** the item-status
  glyph-ring on the same card (different position, different primitive) so the two never confuse. It
  appears only for `running`; no dot for queued/terminal states (the board surfaces *active* runs, not
  history).

- **The `⟳ refreshed Ns ago` poll affordance.** Observability is **poll**, not push (ARCHITECTURE
  ADR-001) — so the strip carries a quiet `⟳` glyph + a "refreshed Ns ago" relative label, a clickable
  refresh that re-fetches `/api/work/run-status` and updates the view **in place** (reusing the
  `load({silent})` non-tearing refresh idiom in `Board.tsx`, so a poll never unmounts the board subtree /
  a live terminal). There is **no** live-tail, websocket, or streaming-log chrome — the affordance reads
  as "this is a snapshot you can refresh", deliberately not "this is a live stream".

- **Component choices + WHY:**
  - **Dot + label chip, not the glyph-ring — the load-bearing distinction.** The run vocabulary and the
    item-status vocabulary must **never be confusable**, so they use different visual primitives: the
    glyph-ring (shape-carries-meaning) stays the item-status ramp; the run state is a dot+label chip
    (the dock's connection-state style). A reader can tell at a glance which ramp they are reading.
  - **Reuse the dock's dot+label ramp verbatim in style.** The dock already establishes "a coloured dot
    + a label = a lifecycle state" with a pulsing connecting/running dot; the run-state chip is the same
    style with the run vocabulary, so the app has one consistent "lifecycle = dot+label" language.
  - **Pulse = `running` only.** The pulse (the mock's `rpulse`) signals *live*; terminal states are
    static (a static dot), so motion on screen always means "something is happening now".
  - **The current run is the latest element of the same read — no second command/route.** One read
    serves history + current state (ARCHITECTURE ADR-001); the UI selects the current element. No
    `work:run-current`, no second fetch.

- **Binding checklist (regions in order → component → states):**
  1. **Current-run strip (in RUNS body):** teal-bordered tinted card under an uppercase `Current run`
     label.
     - **top row:** run-state **chip** (dot+label) · `#attempt` (mono) · truncated mono `sess·…`.
     - **bottom row:** `↻ Rerun` (surface 3) · hint line · right-aligned `⟳ refreshed Ns ago`.
  2. **Run-state ramp (must be this mapping):** queued = muted/grey dot · running = teal(`primary`) dot
     **+ pulse** · done = teal(`primary`) dot **+ ✓** · failed = red(`destructive`) dot · cancelled =
     grey(`secondary`) dot. Colour **and** label always together.
  3. **Lane-card in-flight dot:** an 8px teal pulse dot on a card whose item has a `running` run —
     distinct in position/primitive from the item-status glyph-ring; shown for `running` only.
  4. **Poll/refresh affordance:** a `⟳ refreshed Ns ago` label; click re-fetches in place (no push/stream
     chrome).
  5. **States:**
     - *queued* — grey dot + "queued" (renders if/when m20 mints queued runs).
     - *running* — teal pulsing dot + "running"; the lane-card pulse dot is lit.
     - *done* — teal ✓ dot + "done".
     - *failed* — red dot + "failed".
     - *cancelled* — grey dot + "cancelled".
     - *no current run* — the strip shows the most recent terminal run; if there are **no** runs at all,
       it degrades to surface 1's dashed empty-state card.

### 3 — The rerun affordance (a quiet re-launch, not a control)

- **Mockup:** `wiki/work/21_milestone_board-run-observability/mocks/work-board-runs.dc.html` — the
  **disabled `↻ Rerun`** button in the Current-run strip (the `<button … cursor:not-allowed disabled>↻
  Rerun</button>` + the "a run is in progress" hint), clearly subordinate to the header's primary
  `▸ Run agent`.
- **Route:** the bottom row of the Current-run strip (surface 2), inside the detail panel's RUNS view.

- **Layout & interaction:** a **quiet `↻ Rerun` secondary/outline button** in the Current-run strip,
  visually **subordinate** to the detail header's primary `▸ Run agent` action (the headline action stays
  the header's state-aware primary; Rerun is a smaller, quieter, outline affordance in the runs strip —
  the same subordinate relationship the m03 actions strip has to Run-agent). Pressing it **re-launches the
  agent terminal on the item** — it reuses the existing `runAgent(ref, command)` → `TerminalDock` launch
  in `Board.tsx` (a new *caller* of an existing launch path, not a new mechanism), resolving to the run
  verb. It does **NOT** edit data inline and the **board writes nothing** (ARCHITECTURE ADR-002 / m03
  ADR-006): the verb reaches the agent as ordinary typed PTY input inside the spawned session; the board
  observes the resulting run via surface 2's next poll.
  - **Disabled-while-running:** when a run is `running`, the button is **disabled with a hint** ("a run
    is in progress") — the mock's greyed `cursor:not-allowed` state. This uses the kit's
    `disabled:opacity-50 disabled:cursor-not-allowed` idiom already on the `PrimaryActionButton`. It is a
    re-launch affordance, **not** a destructive control — there is no confirm/danger styling (it is not
    red, not a kill); it is the quiet `↻` of "run it again", disabled only to avoid stacking a second
    live run on top of one already in flight.

- **Documented default — fresh now, resume later (no rework).** Today the affordance resolves to a
  **fresh** run (`work:run-start`); m20's fresh-vs-resume choice is a **later additive delta**
  (ARCHITECTURE ADR-002). The button is designed so a `fresh | resume` choice can be added **without
  rework**: the single `↻ Rerun` button is the slot — when m20 lands, it becomes a split/choice affordance
  (e.g. a primary `↻ Rerun` with a small caret revealing `↻ Resume`) in the **same position**, with no
  change to its subordinate weight, its disabled-while-running rule, or the no-write launch mechanism.
  Design it as one button now; reserve the room for a two-option control later.

- **Component choices + WHY:**
  - **Outline/secondary, deliberately subordinate.** The header's `▸ Run agent` is the headline
    (state-aware primary, teal). Rerun is a re-do of the *same* launch, scoped to the runs context, so it
    is quieter — an `↻` outline button, not a second primary. Two equally-loud launch buttons would
    confuse "the main thing to do" with "do that again".
  - **`↻` glyph, not a `▸`/danger icon.** `↻` reads "again/re-launch"; the primary's `▸` reads "go". The
    rerun is neither a fresh headline action nor a destructive one — `↻` carries exactly "re-run this".
  - **Reuse the existing launch path, add no board write.** It is a new caller of `runAgent` →
    `TerminalDock` (the m03 ADR-006 typed-PTY-input launch), so the rerun introduces **no new board
    write and no command-CLI shell-out** (ARCHITECTURE ADR-002) — the board's only write stays the m03
    feedback bullet.
  - **Disabled, not hidden, while running.** Keeping it visible-but-disabled (with a hint) preserves a
    stable layout and teaches the rule ("one run at a time"); hiding it would make the strip jump.

- **Binding checklist (regions in order → component → states):**
  1. **Rerun button (bottom row of the Current-run strip):** a quiet `↻ Rerun` **outline/secondary**
     button, subordinate to the header's primary `▸ Run agent`.
  2. **Hint:** a muted "a run is in progress" line beside it when disabled.
  3. **Mechanism:** re-launches via the existing `runAgent → TerminalDock` path (typed PTY input); the
     board writes nothing and shells out nothing.
  4. **States:**
     - *enabled (idle/terminal)* — actionable `↻ Rerun`; press re-launches the bound agent terminal.
     - *disabled (running)* — greyed `cursor-not-allowed` + the "a run is in progress" hint.
     - *forward-stable* — the single button is the slot for m20's `fresh | resume` choice (same position,
       same weight, same no-write mechanism); fresh is today's default.

---

## Documented defaults (decided here, not blocking)

These resolve open UI questions with a recorded default so the build is unambiguous; the PO can override
any of them.

1. **Run-state ramp = a dot + label chip (fixed here), distinct from the item-status glyph-ring.** The
   five run states read by **dot colour + label** onto the existing tokens — `queued` = muted/grey ·
   `running` = teal(`primary`) **+ pulse** · `done` = teal(`primary`) **+ ✓** · `failed` =
   red(`destructive`) · `cancelled` = grey(`secondary`). Colour **and** label always together (never
   colour alone). One source emits the chip for both the current-run strip and the history rows (the
   `status.tsx` one-source pattern). This is the **same dot+label STYLE as the dock's connection-state
   indicator**, a different vocabulary — and it is **never** rendered as the glyph-ring (which stays the
   item-status vocabulary) and never folded into item frontmatter (ARCHITECTURE ADR-002).
2. **Rerun defaults to a FRESH run; m20's resume is an additive delta.** Today `↻ Rerun` resolves to
   `work:run-start` (a fresh run). The single button is the slot for m20's `fresh | resume` choice, which
   slots in (e.g. a split caret) with no change to position, subordinate weight, the disabled-while-running
   rule, or the no-write launch mechanism (ARCHITECTURE ADR-002). No rework when m20 lands.
3. **Poll cadence = the existing `load({silent})` refresh, surfaced as `⟳ refreshed Ns ago`.** The RUNS
   view re-fetches `/api/work/run-status` on the board's existing non-tearing silent-refresh cadence (the
   `Board.tsx` `load({silent})` idiom — a silent refresh never unmounts the board subtree or a live
   terminal); the `⟳ refreshed Ns ago` affordance both shows freshness and triggers a manual re-fetch.
   **No** push/websocket/live-tail chrome — observability is poll (ARCHITECTURE ADR-001; SPEC §Out of
   scope).
4. **Lane-card in-flight dot = an 8px teal pulse dot, `running` only.** When an item has a `running` run,
   its milestone/lane card carries a small teal pulse dot (top-right, `rpulse`), distinct in position and
   primitive from the item-status glyph-ring — so active runs are visible from the board. No dot for
   queued/terminal runs (the board surfaces *active* runs, not history).
5. **A run with no history is ABSENT, not an error.** An item that has never run shows the dashed-border
   "No runs yet — this item hasn't been run." card (the m03 doc-absent convention), never an error
   (m19's `readRuns` returns `[]`). The RUNS tab still appears on every milestone/story.
6. **The chip is the outcome — no separate outcome token per row.** A terminal run's `outcome` reads
   through its state chip (`done` ✓ teal / `failed` red / `cancelled` grey); the row does not add a second
   outcome badge, keeping each history row scannable to its four tokens (`#attempt` · chip · `sess·…` ·
   when).

---

## Behavioural outcomes (cross-reference)

The user-visible BEHAVIOUR is specified as task scenarios in the two stories this milestone will break
down (`aof:refine 21`), NOT here. This design fixes the look/feel; the features fix what happens. The
two-story partition is advisory (ARCHITECTURE §Story break-down rationale): **00 · run-observability**
(read/render) and **01 · rerun-affordance**. Referenced by intended name:

- **The detail panel renders an item's prior runs from `/api/work/run-status`** (`#attempt`, run-state,
  truncated session, relative time — newest-first; empty → the dashed "No runs yet" card) — see story
  00's `tasks/runs-render-from-run-status.feature`.
- **The current / in-flight run is highlighted** in the pinned Current-run strip (and the lane card shows
  its in-flight pulse dot) — see story 00's `tasks/current-run-highlighted.feature`.
- **The RUNS view refreshes on poll in place, without tearing down a live terminal** (the `⟳ refreshed Ns
  ago` re-fetch over the `load({silent})` idiom) — see story 00's `tasks/runs-poll-refresh.feature`.
- **`↻ Rerun` spawns/reveals the bound agent terminal and the rerun shows up via the next poll** (the
  m03 ADR-006 typed-PTY-input launch; the board writes nothing), and **is disabled while a run is in
  progress** — see story 01's `tasks/rerun-launches-terminal.feature` and
  `tasks/rerun-disabled-while-running.feature`.
- **Which run verb the rerun resolves to (fresh `work:run-start` now; m20 fresh-vs-resume later)** — a
  task-feature outcome, not design; see story 01's `tasks/rerun-launches-terminal.feature` (and m20's
  later additive delta), cross-referenced to ARCHITECTURE ADR-002.
