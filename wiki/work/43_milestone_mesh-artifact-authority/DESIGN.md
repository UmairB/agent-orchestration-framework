---
doc: design
---
<!--
  Milestone DESIGN.md — how should it look and feel, and why.
  Owner: designer. Layout / component / visual intent only.
  UI BEHAVIOUR (what happens when you click) lives in task .feature files — cross-referenced below,
  not specified here.
-->
# 43 · Mesh artifact authority — Design

## Intent

This milestone has **one** UI surface obligation, from the "Staleness, never eviction" scope bullet:
cached rows carry `syncedAt` + the reporting node; past the window they are **marked stale, never
deleted**, and the board renders a **stale badge** plus a **Resync** action that requests a fresh push
from the owning node.

The experience to create is **calm, honest degradation**. The cache becomes the one read surface, so
every fact on the board is now *a copy of something another machine said at some instant*. Two things
follow, and they are the whole design:

1. **The reader must always be able to tell how old the copy is and who authored it** — provenance
   stops being an incident-response detail and becomes an always-on part of reading an item.
2. **Stale must never read as broken.** The row past the window is still the mesh's only readable
   copy of that work (STATE: "a TTL that evicts would destroy the mesh's only readable copy"). A red
   badge would say "this is wrong"; the truth is "this is late". This is the same distinction milestone
   25 already locked for node presence — *"a stale node has lost liveness, not data … painting it red
   would over-alarm a normal degraded state"* (`25/DESIGN.md` §Component choices) — and this milestone
   inherits that judgement rather than re-litigating it.

The surface introduces **no new design system**. It is built from the fixed theme ramp in
[ui/src/index.css:3-25](../../../ui/src/index.css#L3) (`primary` teal, `accent` crimson, `destructive`
red, `secondary`/`muted` grey, `--radius: 0.5rem`, Inter + a `.mono` utility at
[:68-72](../../../ui/src/index.css#L68)) and from primitives that already exist in the built board and
fleet. It adds exactly **one new vocabulary** — the freshness ramp below — and nothing else.

**Three binding rails:**

- **Stale is `muted`/`secondary`, never `destructive`.** `destructive` on these surfaces is already
  spoken for: `blocked` items ([status.tsx:59-67](../../../ui/src/board/status.tsx#L59)) and `failed`
  runs ([runs.mjs:94](../../../ui/src/board/runs.mjs#L94)). A stale cache row is neither.
- **Never assert what is not known.** A missing `syncedAt` yields "unknown", not "stale"; an in-flight
  Resync does not clear the badge; the badge clears only when a genuinely fresher copy lands. The board
  earned this rule the hard way — it once rendered `not-started` over a live remote run
  ([board-mesh-execution.mjs:1-24](../../../src/board-mesh-execution.mjs#L1)) and "No runs yet" over a
  worker's real run history ([DetailPanel.tsx:771-777](../../../ui/src/board/DetailPanel.tsx#L771)).
- **One Resync door per item.** The affordance is a repair of *the view*, not a work-stream verb, and
  it exists only while there is something to repair.

## Conformance source of truth

> **NO MOCK WAS ELICITED.** This refine ran `--autonomous` with no operator present, so no mock could
> be requested, generated or committed. There is **no `mocks/` directory** for milestone 43. Per
> **07/ADR-003** ([07/ARCHITECTURE.md:163-203](../07_milestone_design-conformance/ARCHITECTURE.md#L163)),
> that makes the **binding checklist under each surface below the mandatory conformance source of
> truth** — it *is* the baseline the design-conformance review judges the built surface against, not a
> supplementary rubric. Every surface this milestone touches carries one; none is left with neither a
> mock nor a checklist (which would make its review `INCONCLUSIVE`).
>
> If a mock is produced later it lands under `wiki/work/43_milestone_mesh-artifact-authority/mocks/` as
> a committed, locally-readable artifact (never a remote design-tool link) and becomes the visual
> source of truth, with these checklists remaining the region-by-region rubric that makes it checkable.

- **Mocks directory:** none committed (autonomous refine, no mock elicited).
- **No-mock rule (in force here):** the binding checklists below are mandatory and are the source of truth.

## Render breakpoints

- **1280** (desktop — the primary judgement width; the board is a desktop workbench with a fixed
  ~382px detail column, `03/DESIGN.md` §2).
- **768** (tablet).
- **390** (mobile) — and **360** additionally for the fleet surface, because the fleet's existing
  width findings (DESIGN GAP D1, [index.css:30-36](../../../ui/src/index.css#L30);
  [Fleet.tsx:179-185](../../../ui/src/fleet/Fleet.tsx#L179)) were measured at 360–414px and the badge
  must survive that squeeze. The badge's **degraded forms** (below) are what the 390/360 renders judge.

**Render routes.** Board: `/?mode=board` with the item in the hash (e.g. `/?mode=board#43/03`) —
served on an **ephemeral** per-workspace port that changes on every daemon restart
([Board.tsx:47-51](../../../ui/src/board/Board.tsx#L47)), so the base URL must be supplied to the
render at capture time and never hard-coded. Fleet: `http://127.0.0.1:4181/?mode=fleet&scope=global`
(fixed port).

---

## What the surfaces already receive — the constraint this design is written against

Read before specifying anything, because it bounds what can be rendered and names a real data gap the
story must close:

| Fact | Where it lives today | Consequence for this design |
|---|---|---|
| The board's per-item wire shape is seven contract fields + `execution?` + `fromWorker?` + `reportedBy?` | [api.ts:6-43](../../../ui/src/board/api.ts#L6) | **There is no `syncedAt` on the wire at all.** |
| `work_items` has no provenance columns — `workspace_id, ref, type, slug, status, title, parent, source_path` | [global-work-store.mjs:173-183](../../../src/global-work-store.mjs#L173) | The *row* cannot say who reported it or when. |
| `work_item_docs` / `work_item_runs` **do** carry `node_id` + `updated_at` | [:267-284](../../../src/global-work-store.mjs#L267) | Per-**artifact** provenance already exists and is renderable today. |
| `reportedBy` is set only on worker-**inserted child rows**, never on merged rows | [board-worker-stream.mjs:140](../../../src/board-worker-stream.mjs#L140) vs [:159-161](../../../src/board-worker-stream.mjs#L159) | Attribution is currently accidental and partial. |
| `/api/work/list` is a straight pass-through of `work:list` | [board-ui.mjs:44-56](../../../src/board-ui.mjs#L44), [list.mjs:49](../../../src/commands/list.mjs#L49) | The envelope is the one place to add freshness. |
| The staleness predicate already exists mesh-wide: `now − t > threshold`, strict `>` | [mesh-presence.mjs:398-408](../../../src/mesh-presence.mjs#L398) (imports `isStale` from `run-store.mjs`), default at [:412-419](../../../src/mesh-presence.mjs#L412) | Reuse it. Two staleness predicates that can disagree about the same instant is a defect, not a variant. |

**Design's data ask (for `43_story_staleness-and-resync` / ARCHITECTURE, stated once here):** every row
and every artifact the read surface serves must carry `syncedAt` (ISO) + `reportedBy` (node id), and the
list envelope must carry the configured `stalenessSeconds`. Without the window on the wire the legend
cannot state it and each surface would hard-code its own threshold — the exact "two predicates" defect
above. Nothing else new is needed; everything else below renders from facts that already exist.

---

## The freshness ramp — the ONE new vocabulary

The product has **four** read-only ramps today, each a deliberately distinct primitive so a reader
always knows which question they are reading the answer to:

1. **item-status** — the glyph ring / chip / dot, one source ([status.tsx:31-77](../../../ui/src/board/status.tsx#L31)).
2. **run-state** — a dot+label pill ([runs.mjs:90-96](../../../ui/src/board/runs.mjs#L90), rendered at [DetailPanel.tsx:655-681](../../../ui/src/board/DetailPanel.tsx#L655)).
3. **node-presence** — a bare dot + relative-age label ([Fleet.tsx:1086-1114](../../../ui/src/fleet/Fleet.tsx#L1086)).
4. **assignment-lifecycle** — the run-pill primitive reused verbatim ([Fleet.tsx:1233-1302](../../../ui/src/fleet/Fleet.tsx#L1233)).

**Cache-freshness is the fifth, and it answers a question none of the four ask: "how old is the copy I
am reading, and who wrote it?"** It qualifies *the data*, not the work — so it gets its own primitive
and must never be merged with the four above.

### The three states

| State | Predicate | Rendered |
|---|---|---|
| **fresh** | `now − syncedAt ≤ stalenessSeconds` | **no badge** — freshness is the norm; the age is stated on the provenance line only. ("Absent, not false" — the discipline at [Fleet.tsx:1050-1057](../../../ui/src/fleet/Fleet.tsx#L1050).) |
| **stale** | `now − syncedAt > stalenessSeconds` (strict `>`, the shared `isStale` shape) | the **badge** (below) + the `stale ·` prefix on the provenance line + the Resync affordance. |
| **unknown** | `syncedAt` absent / unparseable | **no badge**, and the provenance line degrades to an explicit `synced time unknown · from <node>`. A *fact slot* degrades to "unknown" (the DESIGN GAP D2 lesson, [Fleet.tsx:931-939](../../../ui/src/fleet/Fleet.tsx#L931)); an *assertion* is withheld. |

### Rendering 1 — the badge (a dashed-outline pill)

```
◌ stale · 12m ago
```

- **Classes (pinned):**
  `inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-muted-foreground/45 bg-transparent px-2 py-0.5 text-[11px] font-semibold text-muted-foreground`
- **Why a dashed outline.** Every existing pill in the product is solid-filled or solid-bordered —
  the status chip ([status.tsx:206](../../../ui/src/board/status.tsx#L206)), the kit `Badge`
  ([badge.tsx:10](../../../ui/src/components/ui/badge.tsx#L10)), the run/assignment chips
  ([DetailPanel.tsx:662](../../../ui/src/board/DetailPanel.tsx#L662),
  [Fleet.tsx:1250](../../../ui/src/fleet/Fleet.tsx#L1250)), the type/lane chips
  ([DetailPanel.tsx:154](../../../ui/src/board/DetailPanel.tsx#L154), [:495](../../../ui/src/board/DetailPanel.tsx#L495)).
  **A dashed pill is unclaimed**, so it can never be mistaken for one of them. And dashed is *already*
  the house's "degraded / not-yet / absent" primitive: the `not-started` ring
  ([status.tsx:121](../../../ui/src/board/status.tsx#L121), same `border-dashed border-muted-foreground/45`
  literal), the no-presence dot ([Fleet.tsx:1096](../../../ui/src/fleet/Fleet.tsx#L1096)), every
  doc-absent and empty placeholder ([DetailPanel.tsx:436](../../../ui/src/board/DetailPanel.tsx#L436),
  [:779](../../../ui/src/board/DetailPanel.tsx#L779), [BoardLanes.tsx:281](../../../ui/src/board/BoardLanes.tsx#L281)).
  The connotation is already learned; this reuses it in pill form.
- **Why `text-[11px]`, not `text-xs`.** It must be quieter than the status chip it sits beside
  (`text-xs font-semibold`, [status.tsx:206](../../../ui/src/board/status.tsx#L206)). The hierarchy is
  **status > freshness**: what the item *is* outranks how old the copy is. `text-[11px]` is the
  established second tier (the type chip, [DetailPanel.tsx:154](../../../ui/src/board/DetailPanel.tsx#L154)).
- **Why `◌` (U+25CC).** Unclaimed — the product's glyph set is `○ ◐ ◔ ! ✓ ✦ ◷ ♥ ▸ → ↻ ⟳ ✕`. It is the
  dashed ring in glyph form, so the mark and the border say the same thing. It is decorative in the
  accessibility tree; the **word `stale` is what carries the meaning** (see §Accessibility). If the font
  stack cannot paint `◌`, the badge degrades to the word alone — **never** to a glyph that collides with
  the status ramp.
- **No motion, ever.** Motion in this product means "something is happening now": the in-flight pulse
  dot ([BoardLanes.tsx:227-236](../../../ui/src/board/BoardLanes.tsx#L227)), the `running` run chip's
  pulse ([DetailPanel.tsx:674](../../../ui/src/board/DetailPanel.tsx#L674)), the `.aof-pending` shimmer
  ([index.css:79-99](../../../ui/src/index.css#L79)). Staleness is the *absence* of something happening.
  The freshness ramp adds no animation and therefore no new `prefers-reduced-motion` surface.

**Three forms, and a pinned yield order** (the m38 DG-13/DG-19 lesson: width priority is a *yield*
order of discrete whole drops, never a shrink factor and never a paint order —
[Fleet.tsx:562-607](../../../ui/src/fleet/Fleet.tsx#L562)):

| Form | Text | Used where |
|---|---|---|
| **full** | `◌ stale · 12m ago` | detail-panel header, overview milestone card |
| **short** | `◌ stale` | lane card; any surface where the full form does not fit |
| **minimal** | `◌` alone | only when the short form cannot fit (fleet card at 360px). Becomes `role="img"` with the full sentence as `aria-label`. |

The badge **never** carries the node id — the `title` and the provenance line carry it. This is the
region-5 lesson applied pre-emptively: a chip that spends its width on a long node id truncates the
thing it exists to say.

### Rendering 2 — the label (provenance-line form)

On a provenance line the same ramp renders as **text, not a pill** — exactly the m25 presence-label
form (`stale · ${age}`, [Fleet.tsx:1104-1114](../../../ui/src/fleet/Fleet.tsx#L1104)):

```
stale · synced 12m ago · from umairs-mac-mini
synced 4s ago · from aof-control (this node)
synced time unknown · from aof-wsl
```

`mono text-[11px] text-muted-foreground` — the type/tone of the existing mesh-provenance box
([DetailPanel.tsx:170](../../../ui/src/board/DetailPanel.tsx#L170)).

**One badge per item context.** The badge attaches to the status-chip cluster (or the lane-card meta
line); provenance lines use the label form. The two never both appear for the same record — that is how
the ramp stays one vocabulary in two primitives, the same way `status.tsx` emits a ring, a chip and a
dot from one source.

### One source module

Like `status.tsx` (ring/chip/dot), `runs.mjs` (the run ramp) and `assignments.mjs` (the assignment
ramp), the freshness ramp must be **one pure, framework-free, headless module**
(`ui/src/board/freshness.mjs`) emitting the state, both renderings' text, and the tooltip sentence,
with **`now` passed in and no clock of its own** — the `runs.mjs` contract verbatim
([runs.mjs:1-11](../../../ui/src/board/runs.mjs#L1)). The board and the fleet import the same module,
so the two surfaces cannot disagree about whether a given row is stale.

### The threshold crossing — exactly what the user sees

- **The predicate is evaluated against a live clock, not against fetch time.** This is load-bearing:
  the board only re-polls its list while something is executing
  ([Board.tsx:183-188](../../../ui/src/board/Board.tsx#L183)), so a *settled* stale item would otherwise
  never grow its badge until a manual `⟳ sync`. The 1-second cosmetic clock tick already exists and is
  the mechanism — [DetailPanel.tsx:563-596](../../../ui/src/board/DetailPanel.tsx#L563) ("keeps the
  relative timestamps live without re-fetching"), [Fleet.tsx:72](../../../ui/src/fleet/Fleet.tsx#L72),
  [:144-147](../../../ui/src/fleet/Fleet.tsx#L144). The badge therefore appears **within one second of
  the crossing, with no network activity**.
- **At the boundary, nothing moves and nothing flashes.** The badge appears in the gap immediately to
  the **left of the status chip**, which keeps its right-edge anchor; the ring, ref, type chip, title
  and tag are untouched; the provenance line was already present and its age simply continues counting
  (`10m ago` → `11m ago`), gaining its `stale ·` prefix in the same tick. There is no animation, no
  colour change to any existing element, no toast, no reflow of the row.
- **The reverse crossing is equally silent.** When a fresher copy lands the badge disappears and the
  line resets to `synced just now · from <node>`. **The disappearance is the confirmation** — there is
  no "refreshed!" flourish.

---

## Surfaces

### 1 — The board's item surfaces (`/?mode=board`) — badge, provenance, and the Resync action

The primary surface, and the one the SPEC bullet names ("the board renders a stale badge and a Resync
action"). Three regions of the existing board are touched; **no new screen, panel, dock or column is
introduced.**

- **Committed mock:** none (see §Conformance source of truth). The binding checklist below is the
  source of truth.

#### 1a — The lane card (badge only)

The lane card is `ring · mono ref · tag pill` / `title` / a meta line that holds either the in-progress
barber bar or the short status text ([BoardLanes.tsx:237-251](../../../ui/src/board/BoardLanes.tsx#L237)).
It has **no status chip**, so the global "immediately left of the status chip" rule needs its local
form: **the badge sits at the right end of the meta line** (`ml-auto`), opposite the short-status text
or the barber bar. Short form (`◌ stale`); full sentence in `title`.

**No Resync here, and this is structural, not a preference:** the lane card *is* a `<button data-card>`
([BoardLanes.tsx:216-224](../../../ui/src/board/BoardLanes.tsx#L216)) and an HTML `<button>` may never
nest another interactive element — the m38 ADR-012 lesson, recorded verbatim at
[Fleet.tsx:512-518](../../../ui/src/fleet/Fleet.tsx#L512). The same applies to the overview milestone
card ([Overview.tsx:92](../../../ui/src/board/Overview.tsx#L92)). A non-interactive `<span>` badge is
fine inside both.

#### 1b — The overview milestone card (badge only)

Row 1 is `ring · mono ref · "milestone" · ml-auto status chip`
([Overview.tsx:98-105](../../../ui/src/board/Overview.tsx#L98)). The `ml-auto` moves from the chip's
span onto a **cluster** span holding `badge + chip` in that order, so the chip keeps its exact current
position. Full form (`◌ stale · 12m ago`); if row 1 cannot fit it, the uppercase `milestone` label
yields first (it is redundant with the card's context), then the badge drops to short, then minimal.

**`uat` gate bars carry no badge** ([Overview.tsx:178-220](../../../ui/src/board/Overview.tsx#L178)) —
gates are local acceptance items with no cached provenance. Absent, not "fresh".

#### 1c — The detail panel (badge + provenance + Resync) — the item's one Resync door

The panel header is `ring · mono ref · type chip · ml-auto status chip` / title / the mesh-provenance
box / `slug · primary action` ([DetailPanel.tsx:150-238](../../../ui/src/board/DetailPanel.tsx#L150)).

- **Badge:** row 1, `ml-auto` cluster becomes `badge + status chip` (chip keeps its right anchor).
  Full form.
- **The provenance box widens.** Today it renders only when `item.execution` exists
  ([:169-223](../../../ui/src/board/DetailPanel.tsx#L169)). It must now render for **every**
  cache-published item, because "which node authored this" is a first-class fact of this milestone, not
  an execution detail. It becomes two lines inside the same
  `mono … rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px]` box:
  - **line 1 — execution facts (unchanged):** `running on <node>` / `waiting for your input on <node>` /
    `last run <state> on <node>` · `branch <b>` · `open terminal →` · `watch on the fleet →`. Renders
    only when `item.execution` exists, exactly as today.
  - **line 2 — provenance/freshness (new):** `[stale · ]synced <age> · from <node>[ (this node)]`,
    followed — **only when stale** — by the Resync button and its message slot.
- **Where the box does NOT render:** a workspace that is not mesh-enabled shows no provenance region at
  all. Per-workspace presence of the region; per-item always-on content within it. This preserves the
  board's plain local default, the same discipline the execution overlay already keeps
  ([api.ts:17-22](../../../ui/src/board/api.ts#L17), [board-mesh-execution.mjs:17-24](../../../src/board-mesh-execution.mjs#L17)).
- **`(this node)`** marks a row the control node itself published — under this milestone the control is
  simply one more writer into the cache (STATE: "the cache has one read surface and many writers"). It
  is the plain clause `(this node)` here, matching the box's mono type; the fleet keeps its existing
  bordered `this node` tag ([Fleet.tsx:1010-1015](../../../ui/src/fleet/Fleet.tsx#L1010)).

**The Resync action.**

- **Affordance type:** a small bordered **button**, using the m38 assign-action shape verbatim, because
  that is this codebase's established quiet action at `text-[11px]` scale *and* it already carries the
  disabled/acknowledgement discipline this action needs:
  - at rest — `rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary`
    ([Fleet.tsx:839](../../../ui/src/fleet/Fleet.tsx#L839));
  - in-flight / acknowledged — the **same box** with the primary tint **dropped**:
    `border-border bg-muted … text-muted-foreground` ([Fleet.tsx:838](../../../ui/src/fleet/Fleet.tsx#L838)).
    Same padding, same height, same type — only the label and tint change.
  - The inner label span reserves a **constant width sized to the longest label it ever reads**
    (`Resyncing…`) in every state, so a label swap can never reflow the row — DG-13 clause 1
    ([Fleet.tsx:832-843](../../../ui/src/fleet/Fleet.tsx#L832)).
  - It is **not** teal-filled. Teal fill is the item's single headline action (`▸ Run agent` /
    Continue, [DetailPanel.tsx:321](../../../ui/src/board/DetailPanel.tsx#L321)); `03/DESIGN.md`
    documented-default 6 makes that exclusivity binding. Resync is subordinate to it.
- **Placement:** the last control on the provenance line, inside the box that makes the staleness
  claim. Not in the footer actions strip: that strip is *work-stream verbs on the item*
  (feedback / validate / next, [ActionsStrip.tsx:78-109](../../../ui/src/board/ActionsStrip.tsx#L78)),
  whereas Resync repairs *the view*, and it must appear and disappear with the claim it repairs.
- **Rendered only while the row is stale.** A fresh row has nothing to repair, and this restraint is
  the visual expression of the milestone's own rule — Resync is "the first sanctioned pull … and it is
  operator-initiated … directive 4's 'unless something is wrong' carve-out" (STATE, 2026-08-01). An
  always-present pull button would contradict the architecture on screen.
- **Glyph `⟳`, not `↻`.** `⟳` already means "fetch the data again" here (`⟳ sync`,
  [Board.tsx:348-355](../../../ui/src/board/Board.tsx#L348); `⟳ refreshed Ns ago`,
  [runs.mjs:43-45](../../../ui/src/board/runs.mjs#L43); `⟳ Retry`,
  [Fleet.tsx:1407](../../../ui/src/fleet/Fleet.tsx#L1407)), while `↻` means "re-run the work"
  ([DetailPanel.tsx:722](../../../ui/src/board/DetailPanel.tsx#L722)). Resync fetches; it does not re-run.

**Resync states — and the honest answer for an offline owner.**

| State | Button | Message slot (to its right) | Badge / line |
|---|---|---|---|
| **idle** | `⟳ Resync`, primary-tint outline, enabled | empty | badge shown; line reads `stale · synced 12m ago · from <node>` |
| **in-flight** | `Resyncing…`, muted tint, `disabled`, `aria-busy="true"` | empty | **unchanged** — the row is still stale until a fresher copy lands. Claiming otherwise is the same lie class the board already paid for. |
| **accepted** (the request reached the owner) | `Requested`, muted tint, disabled, held for **exactly one poll interval**, then decaying to idle with nothing left over | `waiting for <node> to push` (muted) | unchanged |
| **landed** (a fresher `syncedAt` arrives) | back at idle — and then **removed**, because the row is no longer stale | empty | **badge clears**; line resets to `synced just now · from <node>` |
| **no answer** (accepted, but nothing landed inside the watch window) | back to `⟳ Resync`, enabled — retryable | `no answer from <node> — still showing the 12m-old copy` (**muted**) | unchanged |
| **owner unreachable** (the request could not be delivered) | back to `⟳ Resync`, enabled | `owner <node> unreachable — showing the 12m-old copy` (**muted**), and the line gains a persistent `· owner unreachable` clause | unchanged |
| **refused** (no owning node recorded; a coded control-side refusal) | back to `⟳ Resync`, enabled | `no owning node recorded` / `resync refused — <code>` (**destructive**), outcome-first, full server text in `title` | unchanged |

Five decisions inside that table, each with a reason:

1. **The button reports the CALL; the provenance line reports the DATA.** `Requested` means the request
   went out. Only the age resetting and the badge clearing prove a fresh push actually landed. This is
   the m38 F22 lesson verbatim — *"It reports the CALL; region 5 reports the ASSIGNMENT"*
   ([Fleet.tsx:694-707](../../../ui/src/fleet/Fleet.tsx#L694)) — and it is exactly why a success toast
   would be wrong here: a toast would confirm the click and let the operator believe the data is fresh.
2. **The acknowledgement hold is exactly one poll interval.** The reason is structural: *"a hold of
   exactly one poll interval is what guarantees there is never a moment between the click and a
   confirmation in which the surface says nothing"* ([Fleet.tsx:64-71](../../../ui/src/fleet/Fleet.tsx#L64)).
   One number, not two.
3. **Acknowledgements decay; facts persist.** `Requested` decays after one poll interval. `owner
   <node> unreachable` is a fact about the world and stays on the line until a fresher copy lands or a
   later Resync succeeds.
4. **Muted for "the world did not answer"; destructive for "the request was rejected".** This is the
   design's tone rule, and it is the m25 stale rationale extended: an unreachable owner cost us
   *nothing* — the cached copy is intact and still the only readable one — so painting it red would
   over-alarm precisely the condition this milestone exists to normalise. A refusal, by contrast, is a
   fault we own, and reads `destructive` like every other coded refusal on these surfaces
   ([Fleet.tsx:850](../../../ui/src/fleet/Fleet.tsx#L850)).
5. **Resync is always clickable while stale — it is never pre-disabled on presence.** The tempting
   alternative is to grey it out when the owner has no live presence, but (a) the board's wire shape
   carries no presence at all ([api.ts:6-43](../../../ui/src/board/api.ts#L6)), so that would need a
   second data feed this milestone does not add; (b) presence lags by design, so "stale presence" ≠
   "unreachable"; and (c) one rule for both surfaces beats a rule that forks by surface. **Attempt, then
   report** is the honest shape — which is why the unreachable row above is a first-class designed
   state rather than an error path.

**The in-flight state must be bounded.** No indefinite spinner: after the bound the surface reports a
terminal outcome from the table above. Design default: **10s** for the request round trip, and a
**watch window of 3 poll intervals** for the pushed copy to arrive. ARCHITECTURE may set the exact
numbers; it may not leave them unbounded, and the UI must render the timeout as a terminal state.

**The doc-body region (per-artifact provenance).** A doc can be older than the row that names it —
`work_item_docs` carries its own `node_id` + `updated_at`
([global-work-store.mjs:267-275](../../../src/global-work-store.mjs#L267)). So the doc body region gains
a **single quiet provenance line at its top**, above the rendered markdown (before the reader reads it,
not after), in the label form: `stale · synced 2h ago · from <node>`. No second badge, no second Resync
— the header's one door serves the item and its artifacts.

**`RemoteContentNotice` is retired for anything the cache can serve.** Its copy — *"this board bridges
the item list, not its documents or runs … Open the fleet to watch that node"*
([DetailPanel.tsx:786-807](../../../ui/src/board/DetailPanel.tsx#L786)) — becomes false the moment the
cache is the read surface: the body is here. The body renders; the provenance line says whose it is.
The notice survives only as the genuine **cache-miss** state, reworded to the m03 absent-not-error
convention: a dashed placeholder reading `No cached SPEC yet — <node> has not reported one.`

#### Binding checklist (mandatory — this IS the baseline)

**Layout regions, in order:**

1. **Lane card** (VIEW 2 lanes) — `ring · ref · tag` / title / **meta line**.
2. **Overview milestone card** (VIEW 1 grid) — **row 1 cluster** (`ring · ref · "milestone" · [badge][chip]`) / title / progress / story dots / footer.
3. **Detail panel header** — **row 1 cluster** (`ring · ref · type chip · [badge][chip]`) / title / **provenance box** / `slug · primary action`.
4. **Provenance box** — line 1 execution facts (unchanged) / **line 2 provenance + Resync + message slot**.
5. **Doc body region** — **provenance line (top)** / rendered markdown.

**Components each region holds:**

1. Lane card meta line → existing short-status text **or** barber bar (left) + **stale badge, short form, `ml-auto`** (right). No interactive element (the card is itself a `<button>`).
2. Overview row 1 → existing ring/ref/`milestone` label + **`ml-auto` cluster: stale badge (full form) then status chip**, chip right-anchored.
3. Detail header row 1 → existing ring/ref/type chip + **`ml-auto` cluster: stale badge (full form) then status chip**, chip right-anchored.
4. Provenance box line 2 → **provenance label** (`[stale · ]synced <age> · from <node>[ (this node)][ · owner unreachable]`) + **`⟳ Resync` button** (stale only) + **message slot** (`mono min-w-0 shrink truncate text-[10.5px]`, full text in `title`, `aria-live="polite"`, always present in the DOM).
5. Doc body → **provenance label** (one line, `mono text-[11px] text-muted-foreground`) above the existing rendered markdown.

**States (empty / loading / error / populated) per region:**

- **Lane card / overview card / detail header (badge):**
  *loading* — no badge (freshness is never asserted before it is known);
  *empty* (non-mesh workspace, or `syncedAt` unknown) — no badge;
  *error* (list fetch failed) — no badge; the existing page-level error line owns the failure ([Board.tsx:359-365](../../../ui/src/board/Board.tsx#L359));
  *populated-fresh* — no badge;
  *populated-stale* — the badge in its widest fitting form, `title` carrying the full sentence.
- **Provenance box line 2:**
  *loading* — the line is absent until the first list response (never a skeleton that could be mistaken for content);
  *empty* — non-mesh workspace: the whole box is absent. Mesh workspace, no `syncedAt`: `synced time unknown · from <node>`; no node either: `synced time unknown · reporting node unknown` (explicit unknowns, never an omitted row — DESIGN GAP D2);
  *error* — a failed Resync renders in the message slot per the state table (destructive for a refusal, muted for an unreachable/no-answer owner); it never replaces the line or hides the cached facts;
  *populated* — `[stale · ]synced <age> · from <node>[ (this node)]`, plus the Resync button when stale.
- **Resync button:** *idle · in-flight · accepted · landed · no-answer · unreachable · refused* exactly as the state table above; never rendered when the row is fresh; never left in-flight unbounded.
- **Doc body provenance line:**
  *loading* — the existing `.mono "Loading SPEC..."` line, no provenance line ([DetailPanel.tsx:412](../../../ui/src/board/DetailPanel.tsx#L412));
  *empty* — dashed placeholder `No cached SPEC yet — <node> has not reported one.` (absent, not error);
  *error* — the existing `accent` line, reserved for a genuine cache read failure ([:425](../../../ui/src/board/DetailPanel.tsx#L425));
  *populated* — the provenance line then the rendered markdown.

**Design ramp each uses:**

- **Colour:** the badge and every provenance label use **`muted-foreground` on transparent** with a
  dashed `muted-foreground/45` border — the *degraded* ramp. `primary` appears only on the Resync
  button's at-rest tint. `destructive` appears **only** on a coded refusal message. `accent` is
  untouched. No new token, no hex.
- **Type:** badge `text-[11px] font-semibold`; provenance labels `mono text-[11px]`; message slot
  `mono text-[10.5px]` (the established message-slot size, [Fleet.tsx:850](../../../ui/src/fleet/Fleet.tsx#L850));
  Resync `text-[11px] font-semibold`. Strictly below the `text-xs` status chip.
- **Spacing/shape:** badge `rounded-full px-2 py-0.5 gap-1`; Resync `rounded-md px-2.5 py-1`; cluster
  gap `gap-1.5` (the header cluster idiom); box padding unchanged (`px-2 py-1.5`).
- **Time:** every relative age is `relativeTime` from [runs.mjs:26-39](../../../ui/src/board/runs.mjs#L26)
  — one formatter for the whole product (`just now` / `Ns ago` / `Nm ago` / `Nh ago` / `yesterday` / `Nd ago`).
- **Motion:** none.

---

### 2 — The fleet global milestone card (`/?mode=fleet&scope=global`) — badge + on-demand attribution

The fleet's milestone card already reuses the board's card language (ring, chip, progress, story dots)
and carries the assignment chip and the assign affordance
([Fleet.tsx:453-678](../../../ui/src/fleet/Fleet.tsx#L453)).

- **Committed mock:** none for this milestone's delta. Milestone 25's committed
  `25_milestone_mesh-ui/mocks/mesh-ui.png` remains the baseline for everything *already* on this
  surface; the checklist below is the mandatory baseline for the freshness delta only.
- **Badge:** row 1's `ml-auto shrink-0` chip span becomes a `shrink-0` cluster of `badge + chip`
  ([Fleet.tsx:526-533](../../../ui/src/fleet/Fleet.tsx#L526)). **Yield order at 360px:** the uppercase
  `milestone` label ([:529](../../../ui/src/fleet/Fleet.tsx#L529)) drops **whole** first; then the badge
  goes full → short → minimal. Discrete drops, never a shrink factor, never overprinting — DG-13's sixth
  clause ("no two elements may occupy the same pixels") applies here unchanged.
- **Attribution is on-demand here** (the badge's `title` / `aria-label`), not a new line. Reason: region
  5's geometry is fitness-locked (`test/fleet-assign-row-geometry.test.mjs`, asserted from
  [Fleet.tsx:790-792](../../../ui/src/fleet/Fleet.tsx#L790)), the workspace strip above already carries
  workspace identity in full ([:399-419](../../../ui/src/fleet/Fleet.tsx#L399)), and the node panel
  already answers "is that machine alive" with the presence ramp.
- **No Resync on the fleet.** The SPEC assigns the action to *the board*; one door per item is the
  coherent answer, and it belongs on the surface that also shows *what* is stale (the documents). The
  fleet's honest answer to a stale card is the drill-in it already has. *(Reversible by the PO; the cost
  is the locked row geometry above.)*

#### Binding checklist (mandatory)

- **Layout regions (in order):** top bar (unchanged) → Workspaces strip (unchanged) → **Milestones grid
  → milestone card row 1** → title → progress → story dots → footer/attention row (unchanged) → assign
  rows (unchanged) → terminal view (unchanged) → Nodes panel (unchanged) → Diagnostics (unchanged).
- **Components:** milestone card row 1 holds `StatusRing · mono ref · "milestone" label · ml-auto
  shrink-0 cluster { stale badge, status chip }`. Nothing else on this surface changes.
- **States:** *loading* — the existing region placeholders, no badge
  ([Fleet.tsx:1361-1381](../../../ui/src/fleet/Fleet.tsx#L1361)); *empty* — the existing dashed
  placeholders, no badge; *error* — the existing page-level accent + Retry, no badge; *populated-fresh*
  — no badge; *populated-stale* — the badge in its widest fitting form per the yield order, `title`
  carrying `Last synced from <node> at <time> (<age>)`.
- **Ramp:** identical to surface 1 (`muted-foreground`, dashed, `text-[11px]`, `relativeTime`, no
  motion). The badge must remain visually distinct from the node-presence dot, the run chip and the
  assignment chip on the same page — which the dashed-pill primitive guarantees.

---

### 3 — The legends (board `◷ status legend`, fleet `◷ legend`) — a new ramp documents itself

A new read-only vocabulary that is not in the legend is a vocabulary the operator must guess. Milestone
35 set the precedent exactly: the fleet legend gained the assignment block as a third ramp *"so the new
ramp is self-documenting exactly as the two existing ramps are"*
([Fleet.tsx:316-349](../../../ui/src/fleet/Fleet.tsx#L316)).

- **Committed mock:** none; this checklist is the baseline.
- The **board** legend ([Board.tsx:456-479](../../../ui/src/board/Board.tsx#L456)) today paints the five
  real `StatusRing`s + labels. It gains a divider and a **`Freshness`** block below them, painting the
  **real badge component** beside its label (the legend must mirror the painted ramp 1:1 — the rule its
  own comment states).
- The **fleet** legend gains the same block as its **fourth** section, after Assignment.
- **Rows (both):** `◌ stale — no fresh copy for over <window>` and `(no badge) — synced within the
  window`. The window is rendered in words from the configured `stalenessSeconds` on the wire; if the
  wire does not carry it, the row degrades to `◌ stale — no fresh copy inside the staleness window`
  (never a guessed number).

#### Binding checklist (mandatory)

- **Layout regions (in order):** *board legend* — the five status rows → divider → **Freshness block
  (heading + 2 rows)**. *Fleet legend* — Node liveness → Run state → Assignment → **Freshness (heading +
  2 rows)**.
- **Components:** an uppercase `text-[11px] font-semibold tracking-wide text-muted-foreground` heading
  (the existing legend heading, [Fleet.tsx:327](../../../ui/src/fleet/Fleet.tsx#L327)) + one row per
  state, each pairing the **real rendered badge** with its label.
- **States:** the legend is a hover popover with only two states — *closed* (the `◷ …` trigger) and
  *open* (the panel). It has no loading/error/empty state; it renders from the ramp module, never from
  fetched data, so it is correct before any data arrives.
- **Ramp:** identical tokens to the badge itself; popover chrome unchanged
  (`rounded-md border border-border bg-card p-2 shadow-lg` on the board;
  `bg-popover text-popover-foreground` on the fleet).

---

## Accessibility requirements (expected to be honoured)

The automated a11y lane is **opt-in per 07/ADR-004** and is currently **off** in this repo — `.aof/aof.config.json`'s
`work.tags.domains` lists no `a11y` entry ([:28-38](../../../.aof/aof.config.json#L28)) and there is no
`work.ui.a11y` block. These requirements therefore bind the **design-conformance review and a `@uat`
visual review** regardless; if the lane is switched on, axe-core-via-Playwright (QA-owned) checks them
mechanically at **WCAG 2.1 AA**, ADR-004's documented default.

1. **The badge is never colour-only.** Meaning is carried by the literal word **`stale`** plus the `◌`
   glyph plus (in the full form) the age. Colour and the dashed border add emphasis and carry nothing
   unique — the m03/m25 "colour and label always travel together" rule, applied to a ramp whose whole
   point is a threshold. The dashed border at `/45` alpha is **decorative**: no meaning may depend on it
   (it would not clear the 3:1 non-text contrast bar, and it does not need to).
2. **Contrast.** `--color-muted-foreground` = `hsl(218 9% 38%)` ([index.css:16](../../../ui/src/index.css#L16))
   on `--color-card` white / `--color-background` `hsl(210 18% 96%)` clears 4.5:1, which is the bar that
   applies — the badge is small text at 11px, so the large-text exemption does not.
3. **Accessible naming.**
   - Full/short badge: real text, so **no `role`**, no `aria-hidden` on the text; the `◌` glyph is
     `aria-hidden="true"` (the status-ring convention, [status.tsx:160](../../../ui/src/board/status.tsx#L160),
     [:177](../../../ui/src/board/status.tsx#L177)); a `title` carries the full sentence
     `Last synced from <node> at <local time> (<age>) — past the <window> staleness window`.
   - **Minimal (glyph-only) badge:** must become `role="img"` with that same sentence as `aria-label`
     — a bare `◌` with no accessible name is exactly the failure the `role="img" aria-label` pattern
     already prevents on `StatusRing` ([status.tsx:118-123](../../../ui/src/board/status.tsx#L118)).
4. **The Resync control names its object.** `aria-label="Resync <ref> from <node>"` — the established
   naming pattern (`aria-label={\`Assign ${ref} to a worker node\`}`,
   [Fleet.tsx:802](../../../ui/src/fleet/Fleet.tsx#L802); `aria-label="Sync work stream"`,
   [Board.tsx:352](../../../ui/src/board/Board.tsx#L352)). A bare "Resync" is not a sufficient name on a
   panel that shows one item among many.
5. **A real busy state.** While in flight: `aria-busy="true"` **and** `disabled` **and** the visible
   label changed to `Resyncing…`. A disabled button whose label did not change is a silent state and is
   not acceptable — the visible and the programmatic state must agree.
6. **Outcomes are announced; the threshold crossing is not.** The message slot is an
   `aria-live="polite"` region **present in the DOM at all times** (a live region created at the moment
   of the message is unreliably announced) — it is already a reserved, constant-width slot in the row
   geometry, so this costs no layout. The badge's own appearance is a passive state change and must
   **not** be in a live region: announcing every item that ages past the window would be an unprompted
   interruption.
7. **Focus.** The Resync button follows the provenance text it acts on in DOM order, is keyboard
   reachable, and shows a visible focus indicator built on the existing `--color-ring` token
   ([index.css:23](../../../ui/src/index.css#L23)). Do not remove the UA outline without replacing it.
8. **Target size.** The Resync hit target must be **≥24×24 CSS px** (WCAG 2.2 SC 2.5.8) — at
   `text-[11px] py-1` it lands around 22px, so it needs `py-1.5` or an explicit `min-h`, achieved
   **without** changing its visual weight or the row's height rhythm.
9. **No motion, so no motion trap.** The ramp adds nothing to animate; `prefers-reduced-motion`
   ([index.css:101-105](../../../ui/src/index.css#L101)) gains no new surface.
10. **The badge must not be the only signal of its own state.** It always coexists with the provenance
    line's `stale ·` prefix in the panel, so a reader who misses a small pill still meets the fact in
    prose.

---

## Documented defaults (decided here, not blocking)

The PO can override any of these; they exist so the build has no open question.

1. **Stale is `muted`/`secondary`, never `destructive`** — degraded freshness, not data loss. Inherited
   from 25/DESIGN's node-presence judgement, for the same reason.
2. **Fresh renders nothing.** No "fresh"/"live" pill. Freshness is the norm; only the deviation earns a
   mark. (The age is always available on the provenance line.)
3. **The badge sits immediately to the LEFT of the status chip, which keeps its right-edge anchor** —
   so nothing moves at the threshold and the m03 header baselines stay intact. Where there is no status
   chip (the lane card), it takes the right end of the meta line.
4. **One badge per item context; provenance lines use the label form.** One ramp, two renderings, one
   source module (`freshness.mjs`), `now` passed in.
5. **The freshness state is computed against a 1s clock tick, not against fetch time** — otherwise a
   settled board never grows a badge.
6. **Resync exists only while stale, exactly once per item, on the board's detail panel.** It is a
   repair of the view, not a work-stream verb, and not a fleet control.
7. **The button reports the call; the provenance line reports the data.** No success toast — the badge
   clearing and the age resetting are the confirmation that a push actually landed.
8. **Acknowledgements decay after exactly one poll interval; facts persist.** `Requested` decays;
   `owner <node> unreachable` stays until superseded.
9. **Muted = the world did not answer. Destructive = the request was rejected.** The single tone rule
   for every Resync outcome.
10. **Attempt, then report — Resync is never pre-disabled on presence.** One rule for every surface;
    the unreachable outcome is a designed state, not an error path.
11. **The in-flight state is bounded** (design default 10s request / 3 poll intervals watch window) and
    always terminates in one of the table's outcomes.
12. **`RemoteContentNotice` is retired for cache-servable content**; it survives only as the reworded
    cache-miss placeholder.
13. **The staleness window is ONE configured number, on the wire, shared by every surface and stated in
    the legend.** Two predicates that can disagree about the same instant is a defect.

---

## Behavioural outcomes (cross-reference)

The user-visible BEHAVIOUR belongs in task scenarios on `43_story_staleness-and-resync` (and its
neighbours), NOT here. This design fixes the look/feel; the features fix what happens. Referenced by
intended name:

- **A cached row past the staleness window is marked stale and is never deleted** — see
  `tasks/stale-marks-never-evicts.feature`.
- **The list envelope carries `syncedAt` + the reporting node per row/artifact, and the configured
  staleness window** (the data ask above) — see `tasks/cached-rows-carry-provenance.feature`.
- **Resync requests a fresh push from the owning node, and the row updates when it lands** — see
  `tasks/resync-requests-fresh-push.feature`.
- **Resync against an offline/unreachable owner reports the condition and keeps the cached copy** —
  see `tasks/resync-owner-unreachable.feature`.
- **A doc body is served from the cache and attributed to the node that reported it** (retiring the
  "lives on another node" notice) — see `tasks/cached-doc-attribution.feature` on
  `43_story_cache-read-surface`.
- **`@uat` visual review — the freshness ramp reads as degraded, not broken, and is never colour-only**
  (a person judges the badge, the legend and the four Resync outcomes at 1280/768/390) — see
  `tasks/staleness-visual-review.feature`.
