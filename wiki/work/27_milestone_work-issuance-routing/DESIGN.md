---
doc: design
---
<!--
  Milestone DESIGN.md — how should it look and feel, and why.
  Owner: designer. Layout / component / visual intent only.
  UI BEHAVIOUR (what happens when you click) lives in task .feature files — cross-referenced below,
  not specified here.
-->
# 27 · Cross-Machine Issuance & Routing — Design

## Intent

This milestone adds **one** new UI element, and only one: the **issue / assign affordance** on the
existing `aof mesh ui` fleet surface (SPEC §Scope item 4 — "the `aof mesh ui` surface gains a
board-level issue / assign control"). It is the **first mutating control** ever to land on that
surface. Everything else on the fleet view is **UNCHANGED from milestone 25** — the two stacked regions
(Nodes, Boards), the three read-only ramps (node-presence, run-state, item-status-one-level-down), the
poll/refresh idiom, the top bar, the empty/loading/error states, the card idiom. This DESIGN.md
extends `25/DESIGN.md`; it does not restate or re-litigate it.

The operator question the affordance answers is: **"issue / target this work into the fleet, from
here."** From the control node an operator picks a board (or a queued/unowned item on it) and issues
work into the fleet; an eligible node picks it up via the mesh-aware `aof work next` (ARCHITECTURE
ADR-004). Under the hood the affordance POSTs `{ ref, to? }` to `POST /api/mesh/issue` → `mesh:issue`
(ADR-006 / ADR-002); the `--to` target is the discriminated union `{ kind: "any" | "node" |
"capability" }` (ADR-001). **What happens on click** — the resolve/write/push, the target
disambiguation, the pick-up — is UI BEHAVIOUR and lives in the story's task `.feature` files
(cross-referenced below), NOT here.

**It introduces zero new design system.** It reuses the m03/m25 kit VERBATIM: React 19 + Tailwind 4 +
the shadcn-style primitives in `ui/src/components/ui/` (`badge`, `button`, `card`, `input`, `label`,
`scroll-area`, `select`, `textarea`), the fixed theme ramp in `ui/src/index.css` (`primary` = teal,
`accent` = crimson, `destructive` = red, `secondary`/`muted` = grey, Inter body + `.mono` for
ids/refs, `--radius` = 0.5rem), lucide-react icons. **No new palette, no new component system, no new
modal framework.**

**Two binding rails carry the affordance's design:**
- *(the sanctioned relaxation)* **This is the FIRST write control on a surface that was strictly
  read-only.** So it must read *as an action* — a `button` from the kit, `primary`/teal for the issue
  action — clearly distinct from the read-only ramps around it. But it must NOT turn the calm
  mission-control dashboard into a busy "command console": everything else stays a read-only rail
  (drill-in is still a link; presence / run ramps unchanged; no bulk-select, no toolbar, no live
  action log). It is one quiet action per board, not a control panel. (`25/DESIGN.md`'s read-only rail
  EXPLICITLY deferred this affordance to "milestone 27" — this is it, arriving under ADR-006's pinned
  bounded-write flip.)
- *(control-node framing)* **The affordance is offered ONLY where `isControlNode(config)`** (ADR-006.3
  / ADR-001 — "issue from the control node," PRD §7.2 KF9). On a plain runner node the fleet view stays
  visually identical to m25's read-only surface: the affordance is **ABSENT** — not a
  disabled-greyed-out control that leaks the concept. The gate hides the control cleanly, so a non-hub
  node reads exactly as the calm read-only view it was.

---

## The data the affordance reads (all pre-existing; it renders nothing new of its own)

The affordance carries no fleet logic of its own — its target picker renders records the fleet view
ALREADY paints (the m22/R6 "a mechanic must have a real data source" discipline). Pinning each token's
source so the mock and the review know exactly what feeds the picker:

- **The board / item ref** — the board tile it sits on already renders `b.name` + `on <owner>` from
  the registry (`25/DESIGN.md` §Boards region). The affordance issues *that board's* ref (the ref
  `work:next` / `run-start` resolve; the item picked is a task-feature concern, ADR-002).
- **Node targets** — the **synced roster** the Nodes region ALREADY renders: each node card's mono
  `nodeId` + its **presence liveness** (live / stale / no-presence, the m23 node-presence ramp). The
  target picker's node list is this same roster (`mesh:status` → `nodes[]`), showing `nodeId` + its
  liveness dot so the operator targets a machine they can see is alive.
- **Capability targets** — the **runtimes + skills** the node cards ALREADY render in their capability
  footer (m22 node record → `runtimes[]` `claude`/`codex`/`gemini` + `N skills`). The picker offers
  these advertised capabilities as targets (a `--to codex` routes to any node whose descriptor carries
  `codex` — ADR-003). The picker reuses the fleet's own capability vocabulary; it invents no new list.
- **The "control node" fact** — `isControlNode(config)` (ADR-001 / ADR-006.3). This is the ONE new
  fact the surface reads to decide whether to OFFER the affordance at all. It is a gate, not a rendered
  token.

The affordance **writes** exactly one thing (a directive, via `POST /api/mesh/issue` → `mesh:issue`);
it reads the roster/capabilities purely to build the picker.

---

## Surfaces

> **Conformance source of truth.** The BASE fleet surface's visual truth is the committed m25 mock
> **`wiki/work/25_milestone_mesh-ui/mocks/Mesh.dc.html`** (+ its `mesh-ui.png`) — the fleet view is
> visually UNCHANGED here except for the new affordance, so that file remains the baseline for
> everything the affordance sits among. **For the NEW affordance itself there is no fresh committed
> mock this autonomous pass** (mock policy below) — so per ACD ADR-003 the **mandatory binding
> checklist** in §"Binding checklist" IS the interim baseline the design-conformance review judges the
> built affordance against. A fresh committed mock for the affordance (a `mocks/*.png` or `.dc.html`)
> would strengthen conformance and is a **recommended, non-blocking follow-up** (documented default 6).

### 1 — The issue / assign affordance on `aof mesh ui` (the one new UI element)

- **Mockup:** none new this pass. Baseline for the surrounding surface: the m25 `Mesh.dc.html`;
  baseline for the affordance itself: the binding checklist below (ADR-003 interim baseline).
- **Where it lives:** on the **BOARDS region's board tile**, on the **existing second row** of the
  tile — the row that today holds `[run-state chip] … [Open board →]` (`Mesh.dc.html` lines 96-99).
  The `[assign ▸]` control sits **to the left of the `Open board →` drill-in link**, so the tile's
  action row reads left→right: *state (read) · issue (write) · open (navigate)*. This matches the m25
  ASCII, which pinned it exactly there (`voice-vox ▸ — queued 21/03 [assign ▸]`). It is
  **per-board-tile** (documented default 1) — the board is the natural issuance target, and one quiet
  control per tile keeps the density calm. It is **absent entirely on a non-control node** (the gate).

- **ASCII — the affordance ON the m25 fleet layout (control node; only the BOARDS region shown, the
  rest is unchanged m25):**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [✦] aof  Mesh · umair-fleet                    ◷ legend   ⟳ refreshed 4s ago    │   ← m25, unchanged
├──────────────────────────────────────────────────────────────────────────────┤
│  NODES            3 nodes · 2 live · 1 stale                                    │   ← m25, unchanged
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                           │
│  │ ● mac-studio │  │ ● linux-box  │  │ ○ old-laptop │        (node cards, m25)   │
│  └──────────────┘  └──────────────┘  └──────────────┘                           │
│  BOARDS           4 boards · 2 running                                          │
│  ┌────────────────────────────────┐  ┌────────────────────────────────┐         │
│  │ let-shield        on mac-studio │  │ voice-vox-web    on linux-box   │         │
│  │ ● running ♥4s   ⊕ assign  Open… │  │ ○ queued        ⊕ assign  Open… │  ← NEW: │
│  └────────────────────────────────┘  └────────────────────────────────┘  ⊕assign │
│      idle / gated-absent on a plain runner node ── the tile shows only          │
│      [run-state chip] … [Open board →]  (byte-identical to m25)                  │
└──────────────────────────────────────────────────────────────────────────────┘

  Open (picking target) — a small popover anchored to the [⊕ assign] button
  (NOT a full modal; the kit's Select/Popover primitive):
  ┌──────────────────────────────┐
  │  Issue into let-shield        │   ← title = the board ref (context)
  │  ┌──────────────────────────┐ │
  │  │ Target ▾                 │ │   ← ONE picker (ADR-002 single --to)
  │  └──────────────────────────┘ │
  │    ○ Any node        (default)│   ← { kind: "any" }  — untargeted
  │    ─ Nodes ───────────────────│
  │    ○ ● mac-studio    ♥ 4s     │   ← { kind: "node" }  — roster + liveness
  │    ○ ○ old-laptop    stale 2m │
  │    ─ Capabilities ────────────│
  │    ○ claude   ○ codex         │   ← { kind: "capability" } — runtimes
  │    ○ +12 skills…              │   ← + advertised skills
  │  ┌───────────┐  ┌───────────┐ │
  │  │  Cancel   │  │ Issue ▸   │ │   ← Issue = primary/teal button (the write)
  │  └───────────┘  └───────────┘ │
  └──────────────────────────────┘
```

- **Component choices + WHY:**
  - **A `button` from the kit for the trigger, labelled `assign` with a lucide `plus-circle` (⊕) /
    `send` icon — `primary`/teal.** It is the FIRST write control on this surface, so it must read as
    an action, not a read-only chip or a link. Teal (`primary`) is the kit's "active / go" colour and
    is already the surface's affirmative accent (live presence, running runs) — the issue action
    belongs to it. It is a `size="sm"`/`variant` that is quieter than a full CTA (a small pill, not a
    hero button) so a tile with an `assign` control still reads calm — it does NOT dominate the
    read-only run-state chip beside it. **Crimson (`accent`) is reserved for "needs eyes"** and is
    NOT used for the idle trigger; `accent` appears only on the **error** state (see states). We never
    invent a new colour for "write" — it rides the existing `primary`.
  - **A `Popover`/`Select` from the kit, anchored to the trigger — NOT a new modal system.** The
    target picker is a small popover (or the kit `select` if present) anchored to the `assign` button,
    the m25 "no modal / no dock" density preserved. It does not dim the page or stack a dialog layer;
    it is a light, dismissible surface — the calm-dashboard register, not a monitoring-SaaS command
    dialog. (`25/DESIGN.md`: "a small popover/select in the kit, not a new modal system.")
  - **ONE target picker, three grouped option kinds (Any · Nodes · Capabilities).** ADR-002 fixes a
    single `--to <node|cap>`; the picker mirrors that — one control, with **Any node** the default
    (untargeted `{ kind: "any" }`), a **Nodes** group (each `nodeId` + its liveness dot, straight from
    the Nodes region's roster), and a **Capabilities** group (the advertised `runtimes` + skills from
    the node cards' capability footer). Grouping (not two separate flags) matches ADR-002's data-driven
    single-`--to` disambiguation, and reuses the fleet's OWN vocabulary so the operator picks a target
    they can already see on screen.
  - **The confirm is a `primary`/teal `Issue ▸` button; Cancel is a quiet `variant="ghost"`/secondary.**
    Two buttons, kit-standard, the affirmative one teal. The picker only *stages* the target; `Issue`
    commits (POSTs). Escape / click-away / Cancel dismisses with no write (the read-only default is
    always one keystroke away).
  - **The gated-absent (non-control-node) rendering is a TRUE ABSENCE, not a disabled control.** On a
    plain runner node the board tile is byte-identical to m25: `[run-state chip] … [Open board →]`, no
    `assign` trigger at all. A greyed-out disabled button would leak "there is a hidden command here,"
    which contradicts ADR-006's control-node framing — the surface must simply *be* the read-only view
    on a non-hub node. (documented default 3.)
  - **The surface stays calm + honest.** The write control is the ONLY mutation; the drill-in stays a
    link, presence/run ramps are unchanged, there is no bulk action, no toolbar, no live command log.
    The affordance must not read as a monitoring-SaaS "command console" — it is one quiet
    per-board action.

- **Binding checklist (the mandatory interim baseline the design-conformance review judges the
  affordance against — ADR-003; regions in order → component → states → design ramp):**

  1. **Placement region (in tile order).** The affordance lives on the **BOARDS region → board tile →
     action row (row 2)**, between the read-only **run-state chip** (left) and the **`Open board →`**
     drill-in link (right). Reading order on the row: *run-state (read) · `assign` (write) · open
     (navigate)*. Nothing in the NODES region, the top bar, or the tile's row-1 (name/owner) changes.
     It is **per-board-tile** (default 1). No region-level "Issue work" button is added in v1 (default
     1 records both-considered; per-tile chosen).
  2. **Components it holds** (all from the existing kit — no new component):
     - **Trigger:** a `button` (`size="sm"`), label `assign` + a lucide `plus-circle`/`send` glyph
       (⊕/▸), colour `primary`/teal.
     - **Target picker:** a `Popover` (or kit `Select`) anchored to the trigger — a single `--to`
       picker with three grouped option kinds: **Any node** (default), **Nodes** (each `nodeId` + its
       node-presence dot/label, from the roster), **Capabilities** (advertised `runtimes` + `N
       skills`, from the node cards).
     - **Confirm / dismiss:** an `Issue ▸` `button` (`primary`/teal) + a `Cancel` (`variant="ghost"`/
       secondary) `button`; Escape / click-away also dismisses.
     - **Context label:** the picker titles with the board ref it will issue into ("Issue into
       `<board>`").
  3. **States (all six — the mandatory set):**
     - **idle / default** — the board tile shows the `[⊕ assign]` trigger in the action row (teal,
       quiet, `primary`); the picker is closed. The rest of the tile is m25-unchanged.
     - **control-node-gated-hidden** — on a node where `isControlNode(config)` is FALSE, the trigger is
       **absent entirely** (not disabled/greyed); the board tile is byte-identical to the m25 read-only
       tile. (ADR-006.3.)
     - **open / picking-target** — the anchored popover is open, target defaulting to **Any node**;
       Nodes + Capabilities groups populated from the fleet's own roster/capabilities; `Issue` +
       `Cancel` present. No page dim, no modal stack.
     - **submitting** — after `Issue`, the button reads a quiet in-flight state (the m03 loading idiom:
       a spinner / disabled `Issuing…` label on the `Issue` button, `primary`); the picker stays open,
       inputs disabled; NO page-level takeover.
     - **success** — a **quiet** confirmation: the picker closes and the tile shows a brief, calm
       acknowledgement (a `primary`/teal micro-note or `badge`, e.g. "issued ✓ — a node will pick it
       up"), consistent with the calm register — NOT a loud toast/banner. The directive is issued; the
       item is picked up by an eligible node (that pick-up is task-feature behaviour, not shown here).
       The tile then returns to idle.
     - **error** — the POST failed: an **`accent`/crimson** line + a **Retry**, mirroring the m25
       page-error idiom (`Mesh.dc.html` lines 138-142: crimson text + a teal Retry pill) but scoped to
       the picker/tile ("Could not issue: …"), not the whole page. `accent` is used HERE and only here
       (the "needs eyes" reservation). The read-only surface around it is unaffected.
  4. **Design ramp each element uses** (no new colour invented):
     - `assign` trigger + `Issue` confirm → **`primary`/teal** (the write action; teal is the kit's
       affirmative "go").
     - `Cancel` → **`secondary`/muted ghost** (quiet, recessive).
     - node liveness dots inside the picker → the **existing m25 node-presence ramp verbatim** (teal
       live / grey stale / faint no-presence) — reused, not redrawn.
     - **error** state → **`accent`/crimson** line + a teal Retry (the m25 error idiom).
     - **success** → a quiet **`primary`/teal** micro-acknowledgement (not `destructive`, not a loud
       banner).
     - `destructive`/red is NOT used by the affordance (no failure semantics on issuance; a failed
       POST is an `accent` retry, not a red alarm — mirroring how m25 keeps stale nodes off red).

---

## Documented defaults (decided here, not blocking — PO-overridable)

These resolve the open UI questions the brief flagged, with a recorded default so the build is
unambiguous; the PO can override any.

1. **Placement: per-board-tile, on the tile's existing action row — NOT a region-level button (v1).**
   Both were considered (the brief: "per-board-tile, a region-level 'Issue work' action, or both?").
   Chosen: **per-tile**, because the board is the natural issuance target (you issue *into a board*),
   the m25 mock pinned `[assign ▸]` on the tile, and one quiet control per tile preserves the calm
   mission-control density (a region-level "Issue work" button + a target-AND-board picker would be a
   second, heavier control the read-only dashboard does not need in v1). A region-level "Issue work"
   entry point is a clean, non-blocking follow-up if the PO wants board-agnostic issuance.
2. **The target picker is ONE control (Any · Nodes · Capabilities grouped), not two flags.** Mirrors
   ADR-002's single `--to <node|cap>` with data-driven disambiguation. **Any node** is the default
   (untargeted `{ kind: "any" }`) so the calm default is "issue into the fleet, let an eligible node
   claim it." Nodes + Capabilities are populated from the fleet view's OWN roster + capability footer —
   no new data, no new list.
3. **Control-node framing is a TRUE ABSENCE on a non-control node — never a disabled/greyed control.**
   `isControlNode(config)` gates whether the trigger renders at all (ADR-006.3). On a plain runner
   node the fleet view is byte-identical to the m25 read-only surface. This is the honest reading of
   "the affordance is offered only where the issuing hub sits" — a greyed control would leak the
   concept onto a surface that should read as pure read-only.
4. **The write control is the ONLY mutation — everything else stays a read-only rail.** Drill-in is
   still a link; the node-presence and run-state ramps are unchanged; there is no bulk-select, no
   toolbar, no live action log, no page-dimming modal. The affordance must not read as a
   monitoring-SaaS command console — it is one quiet per-board action on an otherwise-calm dashboard.
5. **Feedback is quiet + honest.** Submitting = a small in-flight `Issuing…` on the `Issue` button
   (m03 loading idiom); success = a quiet `primary`/teal micro-acknowledgement, then back to idle (NOT
   a loud toast); error = an `accent`/crimson line + Retry scoped to the picker/tile, mirroring the m25
   page-error idiom (crimson text + teal Retry). No new palette; `accent` is used only for the error.
6. **A fresh committed mock for the affordance is a recommended, non-blocking follow-up.** No new mock
   is elicited this autonomous pass (mock policy), so the mandatory binding checklist above IS the
   conformance baseline (ADR-003). A committed `mocks/*.png` or `.dc.html` for the affordance (the
   idle tile trigger + the open picker + submitting/success/error insets, drawn ON the m25 board tile)
   would strengthen conformance and is recommended as a follow-up — surfaced here as a documented
   default, not a blocker.

---

## Behavioural outcomes (cross-reference)

The user-visible BEHAVIOUR of the affordance is specified as task scenarios in the story this
milestone breaks down (`aof:refine 27` — story 02, the fleet-UI issue/assign integration, ARCHITECTURE
§Recommended story partition), NOT here. This design fixes the look/feel; the features fix what
happens. Referenced by intended name:

- **The `[assign ▸]` affordance POSTs `{ ref, to? }` to `POST /api/mesh/issue` and issues a directive a
  peer picks up** (the resolve → write → push → pick-up; ADR-002 / ADR-004 / ADR-006) — see the
  fleet-UI story's `tasks/fleet-ui-issue-affordance.feature`.
- **The affordance is gated behind `isControlNode(config)` — a non-control node's fleet view shows no
  issue control** (ADR-006.3) — a task-feature outcome (the gate's behaviour), see the fleet-UI
  story's `tasks/fleet-ui-issue-affordance.feature` (control-node scenario).
- **The target picker resolves `--to` as a node OR a capability against the synced roster** (ADR-002.3
  data-driven disambiguation; ADR-003 matcher) — see the CLI/routing story's
  `tasks/mesh-issue-command.feature` and `tasks/routing-pickup.feature` (the CLI is the shared
  contract the affordance's POST rides; the picker's node-vs-capability resolution is that same
  disambiguation surfaced in the UI).
- **A GET/read on the fleet face still mutates nothing; only `POST /api/mesh/issue` writes** (ADR-006 —
  the bounded-write flip; `acd-mesh-ui-write-isolation`) — a task-feature + fitness outcome, not
  design; see the fleet-UI story's `tasks/fleet-ui-issue-affordance.feature` and fitness #7.
- **A `@uat` visual-review of the affordance** — the design-conformance judgement of the built
  affordance against this DESIGN.md's binding checklist (idle trigger placement, the open picker, the
  gated-absent non-control-node tile, submitting/success/error ramps) — see the fleet-UI story's
  `tasks/fleet-ui-issue-affordance.feature` (`@uat` visual-review scenario), judged against the
  §"Binding checklist" baseline (and any committed affordance mock, if the recommended follow-up lands).
