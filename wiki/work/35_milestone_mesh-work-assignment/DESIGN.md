---
doc: design
---
# 35 · Mesh Work Assignment — UI Design Contract

No mock was provided at refine time, and this is an autonomous refine. Per the design-review
policy (mirroring milestone 34's convention — see `wiki/work/34_milestone_global-mesh-work-store/DESIGN.md`,
whose header reads "This checklist is the binding review baseline"), **this binding checklist IS
the conformance source of truth** for the one UI surface this milestone touches. There is **no
committed `mocks/` mock** for milestone 35; the read-only design review at verify time judges the
rendered fleet view against the checklist below (region-by-region), not against a mock image. Fill
gaps against THIS document; do not return INCONCLUSIVE-on-missing-baseline.

## The one surface this milestone touches

`aof mesh ui` — the read-only **fleet mission-control** SPA (`ui/src/fleet/Fleet.tsx`, served by
`src/mesh-ui-serve.mjs`). Milestone 35 adds **one thing** to it: the **assignment lifecycle
affordance**, rendering a dispatched work item advancing `assigned → accepted → running → done/failed`
as its worker picks it up and runs it.

**Non-negotiable framing (state it, then honour it):**
- **This surface adds NO interactive control.** It is strictly READ-ONLY lifecycle DISPLAY — no
  assign control, no accept/revoke button, no form. The existing page has exactly two interactions
  (the drill-in link + the `⟳` refresh); milestone 35 adds **zero** new ones.
- **The assign verb is CLI-only** (`aof mesh assign <ref> --to <nodeId>`). The UI never dispatches;
  it only reflects what the CLI dispatched. "The form offers node X" would be a task-feature outcome
  of the CLI command, not a design concern for this surface.
- **Updates ride the existing 5s poll** (`POLL_MS = 5000`, `Fleet.tsx:45`). There is **no UI
  WebSocket / SSE** — the control↔worker WebSocket of the SPEC is a *backend* transport; the browser
  never opens one. An assignment therefore advances "live" via the silent 5s re-poll of the
  store-backed `GET /api/mesh/status` (within the milestone-34 presence bound + one poll), reusing the
  keep-last-good idiom (`Fleet.tsx:85-103`) so a silent poll **never** flips to a full-screen
  loading/error branch.

**Data note (buildable, not invented):** the assignment record is a milestone-35 *backend* addition
to the milestone-34 global store; the UI reads it from the SAME single `/api/mesh/status` aggregate
(ADR-002/ADR-003 — one command, no second read — `api.ts:176-184`). This checklist fixes the
*display* contract (state label, target nodeId, relative time, degraded note). The exact wire field
names on `GlobalWorkItem` / `GlobalNode` (`api.ts:91-120`) are the backend stories' to freeze; the
review judges what those fields *render as*, per the ramp table below.

---

## 1 · Layout regions, in order

The page shell and region order are UNCHANGED (`Fleet.tsx:140-179` / `GlobalScopeView` `:322-338`).
Milestone 35 attaches inside two existing cards; it introduces no new region.

1. **Top bar / scope control** (`TopBar` `:194-248`) — the `✦ aof · Mesh · <group>` mark, the
   always-visible Global/Local `ScopeControl` (`:256-276`), the `◷ legend` (`:280-299`), and the
   `⟳ refreshed …` poll affordance. **Change: the Legend gains an "Assignment" key** (a third block
   below "Node liveness" and "Run state"), one row per lifecycle state, so the new ramp is
   self-documenting exactly as the two existing ramps are.
2. **Workspaces summary** (global scope, `WorkspacesSummary` `:349-369`) — unchanged.
3. **Milestones region** (`MilestonesList` `:375-399`) — holds the `GlobalMilestoneCard` grid. **This
   is the PRIMARY attachment point.** See region-component §2.
4. **Nodes region** (global: `GlobalNodePanel` `:508-549`; local: `NodesRegion` → `NodeCard`
   `:591-632`) — holds the per-node cards. **This is the SECONDARY attachment point.**
5. **Boards region** (local scope, `BoardsRegion` `:670-691`) — unchanged.
6. **Diagnostics region** (`DiagnosticsRegion` `:554-570`) — unchanged (assignment health is not a
   store-error class; a *reclaimed/failed* assignment surfaces on its own card, not here).

---

## 2 · The components each region holds — including the NEW assignment affordance

### 2a · Primary: the assignment lifecycle chip in `GlobalMilestoneCard`

**Where it renders:** the card's **attention row** — the bottom border-topped row at
`Fleet.tsx:471-477`, which today holds the `attention` span (`◔ N in review` / `✓ accepted` / a muted
`·`, computed at `:421-426`) beside the `Open board →` label. The assignment chip renders in the
**left slot of that row**, replacing the muted `·` placeholder when the item carries an assignment,
and sitting BEFORE the existing in-review / accepted attention token when both apply (assignment
first — it is the more actionable state). It never displaces the `Open board →` label (that stays
right-aligned, `:475`).

**Anatomy of the assignment chip** (one line, wraps as a unit, never colour-alone):

```
  <mark> <label> → <nodeId>  ·  <relative-time>   [· <note> when degraded]
   │      │          │            │                  │
   │      │          │            │                  └ degraded note: "reclaimed" (only when set) — SUPPLEMENTARY provenance; MAY truncate to the chip's `title` tooltip when the row cannot fit it without clipping `Open board →`, but stays present in the DOM/tooltip (never dropped from the model)
   │      │          │            └ relativeTime(assignedAt|acceptedAt|startedAt|endedAt) — runs.mjs
   │      │          └ the target worker nodeId (mono), the dispatch destination
   │      └ the lifecycle label (see ramp §4) — ALWAYS paired with the mark/colour
   └ the state mark (dot / pulsing dot / ✓ / ! — see ramp §4)
```

- It **mirrors the run-state chip primitive** (`RunStateChip` `:744-770`): a `rounded-md border`
  pill, `dot`/`✓` glyph + label, using the SAME `runChipClasses(token)` token→class map
  (`:730-742`) so `primary` / `destructive` / `muted` / `secondary` read byte-identically to the
  board's run chip. This keeps ONE chip vocabulary across the product.
- The `→ <nodeId>` and `· <relative-time>` are chip-adjacent mono text (like the board tile's
  `on <owner>` line, `:709-711`), not inside the pill, so the pill itself stays the run-chip shape.
- **Behaviour, not design** (cross-reference, do not restate): *that* the worker begins running in an
  isolated worktree is the SPEC's execution outcome; the UI merely shows the resulting `running`
  chip. That belongs in a task `.feature`, not here.

### 2b · Secondary: assignments-held on `NodeCard` / `GlobalNodePanel`

**Where it renders:** `NodeCard`'s **"what it's running" row** (`row 3`, `Fleet.tsx:622-625`, today
`idle` / `running N runs`). Assignments this node HOLDS by state are summarised on/next to this row,
so a worker card reads "what has been dispatched TO me" alongside "what I'm running." For the global
`GlobalNodePanel` card the equivalent slot is a new muted line between the `last seen` line
(`:528-530`) and the fabric-address line (`:537-539`).

**Anatomy (node-side, a compact summary, not per-item chips):** a single muted line —
`assignments: N running · N accepted · N assigned` (only non-zero states listed; all-zero → the row
is **omitted**, not shown as "0 assignments", matching the "absent, not false" idiom used for the
`local` tag `:605-609` and never-beat presence). A node holding a `failed`/`reclaimed` assignment
shows `· 1 failed` in the destructive token so a degraded dispatch is visible on the worker too
("degraded states must be visible" discipline).

---

## 3 · The states: empty / loading / error / populated (for the assignment affordance)

- **Empty** (no assignment for this item / node): the affordance shows **nothing new** — the
  `GlobalMilestoneCard` attention row keeps its existing muted `·` placeholder (`:421`), and the
  `NodeCard` assignments line is **omitted** entirely (§2b). Absence reads as "not dispatched," never
  as an error or a zero-count. No empty-state copy is added for a single un-dispatched item.
- **Loading** (first paint, or a poll in flight): reuse the **keep-last-good** idiom verbatim
  (`Fleet.tsx:85-103`). First paint shows the existing whole-page `LoadingState` (`:829-849`) whose
  region placeholders already reserve the layout; a **silent 5s re-poll never flips** the populated
  cards to loading — an in-flight poll leaves the last-good assignment chip in place and only the
  `⟳ refreshed …` freshness label stops advancing (`:110-117`). No spinner appears on a chip.
- **Error** (the `/api/mesh/status` endpoint fails): the existing page-level `ErrorState`
  (`:859-880`) handles it — an accent pill + `⟳ Retry`, naming the global mesh store path. The
  assignment affordance adds **no error state of its own**; a failed *silent* poll is surfaced
  quietly (freshness label stalls), never as a torn card (`:95-102`).
- **Populated — one appearance per lifecycle state.** Each renders the chip anatomy of §2a with the
  exact label / mark / token / motion fixed by the ramp in §4:
  - **assigned** — dispatched, worker has not yet acknowledged.
  - **accepted** — worker acknowledged over the mesh channel, worktree not yet running.
  - **running** — worker is executing in its isolated worktree (the ONLY state that pulses).
  - **done** — the assignment's run completed successfully.
  - **failed** — the run failed, OR the assignment was **reclaimed** (worker went offline mid-run /
    setup failed / operator revoked). A reclaimed assignment reads with the **failed token** plus the
    trailing `· reclaimed` note (§2a), so a degraded transition is never silent.

---

## 4 · The design ramp — the assignment lifecycle ramp table

The assignment ramp **mirrors the run-state `CHIP_RAMP`** (`ui/src/board/runs.mjs:90-96`) so the two
read as one family; colour AND label ALWAYS travel together (never colour alone), and **only
`running` carries motion**. Tokens are theme tokens (`ui/src/index.css:3-25`), never hexes, resolved
through the existing `runChipClasses(token)` map (`Fleet.tsx:730-742`).

| Lifecycle state | Label (verbatim) | Mark | Token | Colour (token) | Motion |
| --- | --- | --- | --- | --- | --- |
| assigned | `assigned` | a hollow dot | `muted` | muted grey | none |
| accepted | `accepted` | a filled dot | `secondary` | secondary grey (a touch darker than assigned — acknowledged, not yet live) | none |
| running | `running` | a pulsing dot | `primary` | teal (`--color-primary`) | **pulse** (`animate-pulse`, `:763`) |
| done | `done` | a `✓` | `primary` | teal (`--color-primary`) | none |
| failed | `failed` | a `!` mark | `destructive` | red (`--color-destructive`) | none |

**Notes making the ramp enforceable:**
- The progression `assigned → accepted → running` climbs the same brightness ramp the run chip uses
  (muted → secondary → teal), so an operator reads "warming up → live" at a glance. `done` reuses
  teal + `✓` byte-for-byte from the run chip's `done`; `failed` reuses `destructive` byte-for-byte.
- **`failed` uses a `!` mark, not a bare dot**, to distinguish it from any grey dot at a glance while
  still travelling with its red token and its `failed` label — colour+label+mark all agree.
- **Reclaimed / stale assignment** is NOT a sixth colour: it renders as **`failed` (destructive `!` +
  `failed` label)** with a trailing mono `· reclaimed` note. This honours "degraded states must be
  visible" — a worker that dropped an assignment mid-flight surfaces as a red, labelled, *noted*
  failure on the item card (and `· 1 failed` on the worker's node card, §2b), never as a silent
  reversion to `assigned` or a vanished chip. **Protected signal vs optional note:** the red `failed`
  chip (destructive token + `!` mark + `failed` label + `→ <nodeId>`) is the required visible degraded
  signal and MUST stay un-clipped at every breakpoint; the trailing `· reclaimed` note is supplementary
  provenance that MAY truncate to the chip's `title` tooltip when the attention row cannot fit it
  without clipping the protected `Open board →` drill-in, provided it stays present in the DOM/tooltip.
  A vanished chip, a colour-only render, or a silent reversion to `assigned` remains a GAP; the
  note-to-tooltip degradation does not.
- The **`done` ✓ glyph** reuses the run chip's ✓ treatment (`:754-760`) — a small filled circle with
  a `✓`, primary token — so "assignment done" and "run done" are visually the same success mark.
- **Legend parity:** the top-bar Legend (§1 item 1) gains an "Assignment" block listing these five
  rows (mark + label) so the ramp is discoverable in-product, exactly as "Node liveness" and "Run
  state" already are (`:285-296`).

---

## Review Notes (for the read-only design review at verify)

- Judge **region-by-region** against §1–§4: top bar (legend gains the Assignment block), the
  `GlobalMilestoneCard` attention row (assignment chip in the left slot), and the `NodeCard`/
  `GlobalNodePanel` assignments line — plus every lifecycle appearance in §4.
- **This surface must add NO interactive control** — verify there is no assign/accept/revoke button
  or form; the only interactions remain the drill-in + `⟳` refresh.
- The assignment chip must **reuse the run-chip primitive + tokens** (`runChipClasses`), not a new
  colour system — a fleet-local vocabulary is a GAP.
- **Colour never travels alone**: any state rendered by colour without its paired label/mark is a GAP.
- A **reclaimed/stale** assignment must render a **visible red `failed` chip** (destructive `!` +
  `failed` label + `→ <nodeId>`) un-clipped at every breakpoint — that chip is the protected degraded
  signal; a silently-dropped, colour-only, or vanished assignment (or a silent reversion to `assigned`)
  is a GAP. The trailing `· reclaimed` note is supplementary provenance and MAY degrade to the chip's
  `title` tooltip (never dropped from the model) — that degradation is NOT a GAP.
- The **committed mock is absent by design**; this checklist is the conformance baseline. A render
  (screenshot) of the populated fleet showing at least the `running` and a `failed`/`reclaimed`
  assignment is required for the review to reach CONFORMS/GAPS — absent a render, the honest verdict
  is INCONCLUSIVE naming the missing render, not a guess from code.
