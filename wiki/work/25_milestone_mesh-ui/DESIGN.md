---
doc: design
---
<!--
  Milestone DESIGN.md — how should it look and feel, and why.
  Owner: designer. Layout / component / visual intent only.
  UI BEHAVIOUR (what happens when you click) lives in task .feature files — cross-referenced below,
  not specified here.
-->
# 25 · Mesh UI — Design

## Intent

The **fleet surface** — the "one mission-control view of the whole fleet" (PRD §7.1/§7.2 KF7). With
nodes publishing identity (m22), live presence over the relay (m23), and a group roster (m24), this
milestone finally **renders** them: `aof mesh ui` is the **read-only** web view that sits *on top of*
the per-stream work UIs and answers one operator question — **"what is my whole fleet doing right
now?"** Which nodes are alive, what each is running, and every board being worked on across the group,
each drillable into its own `aof work ui`.

It is deliberately a **sibling of `03/DESIGN.md`** (the work board) and `21/DESIGN.md` (run
observability), and must read as one product family. It introduces **zero new design system**: it
reuses the m03 kit (React 19 + Tailwind 4 + the shadcn-style primitives in `ui/src/components/ui/`:
`badge`, `button`, `card`, `input`, `label`, `scroll-area`, `textarea`; `lucide-react` icons) and the
**fixed theme ramp** in `ui/src/index.css` — `primary` = teal, `accent` = crimson, `destructive` =
red, `secondary`/`muted` = neutral grey, Inter body + a `.mono` utility for identity/refs, `--radius`
= 0.5rem. It reuses, verbatim in style, **two established ramps** it does not re-invent:
- the m03 **glyph-ring status ramp** (`ui/src/board/status.tsx`) — the item-status vocabulary; and
- the m21 **run-state dot + label chip** (`queued`/`running`+pulse/`done`✓/`failed`/`cancelled`) —
  the run vocabulary, **surfaced fleet-wide here exactly as m21 built it per board**.

The feeling to hit is the same **calm IDE / mission-control**, not a monitoring SaaS: dense but calm,
monospace where node ids / refs / timestamps appear, one window, no marketing chrome. Because the mesh
is **single-group / trusted-operator** (m24 A3), there is still **no auth UI, no tenant switcher, no
account menu** on this surface — that stays off the screen.

**Three binding rails (two carried from m03/m21, one new to the fleet):**
- *(carried)* **Read-only — the surface renders, it never mutates.** No issue / assign / route / revoke
  affordance is on this screen; those arrive in **milestone 27**. `aof mesh ui` reads the group
  registry (m24) + presence (m23) + per-board run state (m21) and **writes nothing** (SPEC §Out of
  scope). It is a strictly stronger form of the m03 "status is derived, never user-set" rail: here the
  surface has *no* mutating control at all.
- *(carried)* **Reuse the existing kit / tokens + the two established ramps** — no new palette, no new
  design system; the glyph-ring stays item-status, the dot+label chip stays run-state, and the two are
  **never merged** (m21 ADR-002).
- *(new)* **Node liveness is its own ramp — a fresh/stale presence signal, distinct from both the
  glyph-ring and the run chip.** A node's heartbeat **staleness** (`now − heartbeatAt >
  stalenessSeconds`, the m20 `isStale` strict-`>` shape, m23 story 00) is a **third** read-only
  vocabulary — rendered as a presence dot + a relative-age label (`♥ 4s` / `stale 2m`), so a reader can
  tell node-liveness from item-status from run-state at a glance.
- *(new)* **Visibility is poll / relay-presence, not a push event stream.** A `⟳` refresh over a
  read-mostly view — no WebSocket log-tail / event-stream chrome on the client (PRD §7.3; SPEC §Out of
  scope). Presence itself arrives ≤5s over the relay and ≤30s over git (m23 KR1); the *UI* reflects it
  on the same non-tearing poll/refresh idiom the board already uses (`load({silent})`).

---

## The data the fleet surface renders (read-only, all pre-existing)

The surface is a **thin face** — it carries no fleet logic of its own; it renders three already-shipped
records through registered read commands. Pinning the data source per region (the m22/R6 "a mechanic
must have a real data source" discipline) so the mock and the review know exactly what each token is:

- **Nodes** — the **group roster** (m24 `mesh:registry` / `readRegistry` → `roster[{ nodeId,
  admittedAt, boards[] }]`) joined with each node's **node record** (m22 → `runtimes[]`, `skills[]`) and
  its **presence record** (m23 story 00 → `{ heartbeatAt, activeRuns[], aofVersion }`) + the derived
  **`stale`** flag. This is exactly the `mesh:status` shape (`{ nodes: [ { nodeId, presence?, stale,
  runtimes?, skills? } ] }`, `src/commands/mesh-identity.mjs`) the CLI mirror renders — the web view and
  the CLI read **one** command.
- **Boards** — the registry's **registered boards** (m24 `roster[].boards` / registry `boards[]`), each
  joined with its **per-board run state** (m21 `work:run-status` → `{ ref, runs[] }`, from which the UI
  selects the current/in-flight run and its run-state chip — "running ♥4s"). A board **drills into its
  own `aof work ui`** via that board's own git (a link/affordance, not an embed — SPEC).
- The surface **writes none of it**. Every field is rendered; the only interactions are *navigate*
  (drill into a board) and *refresh* (re-poll).

---

## Surfaces

> **Conformance source of truth.** The `aof mesh ui` surface's visual source of truth is the committed,
> locally-readable mock **`wiki/work/25_milestone_mesh-ui/mocks/mesh-ui.png`** — a self-contained image
> the user will generate from the brief in **Appendix A** and commit at that path. DESIGN.md treats that
> committed file as the **conformance source of truth for the surface once it lands** — a
> locally-readable artifact the read-only designer/review opens directly, **never a remote-link-only
> reference**. **Until the mock lands, the mandatory binding checklist below (surface 1) is the interim
> baseline the design-conformance review judges against** (ADR-003): the mock is the visual truth; the
> checklist makes it *checkable*. The prose + the ASCII wireframe are the durable spec; the build output
> is what the review renders against.

### 1 — `aof mesh ui` — the read-only fleet surface (the one genuinely new visual surface)

- **Mockup:** `wiki/work/25_milestone_mesh-ui/mocks/mesh-ui.png` (to be generated from Appendix A and
  committed; the binding checklist below is the interim baseline).
- **Route:** the fleet view is served by `aof mesh ui` (a thin face over the registered read commands,
  the m03/m08 one-server / thin-face discipline). It is a **read-only** page — no selection-drives-mutation,
  no terminal dock, no actions strip (those are the work UI's, one level down). A board tile's drill-in
  is a **link/affordance out to that board's own `aof work ui`**, not an embedded board.

- **Overarching layout — one screen, two content regions under a slim top bar.** The top bar echoes the
  board's (`✦ aof · Mesh · <group> · ◷ legend · ⟳ refreshed Ns ago`) so the two surfaces read as one
  product. Below it, **two stacked regions**: the **Nodes** region (the fleet's machines + their live
  presence) and the **Boards** region (every board being worked on across the group). Both are
  card-grids in the m03 card idiom — read-only, scannable "evaluate-as-a-whole" tiles, never rows of raw
  text.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [✦] aof  Mesh · umair-fleet                    ◷ legend   ⟳ refreshed 4s ago    │
├──────────────────────────────────────────────────────────────────────────────┤
│  NODES            3 nodes · 2 live · 1 stale                                    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                     │
│  │ ● mac-studio   │  │ ● linux-box    │  │ ○ old-laptop   │  ← node cards       │
│  │   ♥ 4s ago     │  │   ♥ 9s ago     │  │   stale · 2m   │  ← presence ramp    │
│  │ running 2 runs │  │ running 1 run  │  │ idle           │  ← activeRuns       │
│  │ claude · 12 sk │  │ codex · 12 sk  │  │ claude · 8 sk  │  ← runtimes/skills  │
│  └────────────────┘  └────────────────┘  └────────────────┘                     │
│  BOARDS           4 boards · 2 running                                          │
│  ┌────────────────────────────┐  ┌────────────────────────────┐                 │
│  │ let-shield        on mac-…  │  │ voice-vox-web    on linux-… │  ← board tiles │
│  │ ● running  ♥ 4s   #5 sess…  │  │ ○ done     2d ago           │  ← run chip    │
│  │                Open board → │  │                Open board → │  ← drill-in    │
│  └────────────────────────────┘  └────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **The three read-only ramps on this surface (never confused, each its own primitive):**
  1. **Node-presence ramp (NEW here — a presence dot + relative-age label).** A node reads **live** vs
     **stale** by `now − heartbeatAt > stalenessSeconds` (m23 story 00, the m20 `isStale` strict `>`).
     Rendered as a coloured dot + a `♥ Ns ago` / `stale · Nm` label onto the existing tokens: **live** =
     `primary`/teal filled dot + `♥ Ns ago` (fresh heartbeat); **stale** = `secondary`/muted hollow dot
     + `stale · Nm ago` (aged past threshold — quiet, not alarming: a stale node lost *liveness, not
     data*, m23 KR5 — so `secondary`, **not** `destructive`); **no-presence** = a dashed/muted dot +
     "no presence" (a node record with no heartbeat yet — the m23 "no-presence / unknown liveness,
     `stale:false`" locked rule — absent, not an error). Colour **and** label travel together (never
     colour alone — the m03 status-chip rationale). This ramp is a *third* vocabulary, deliberately not
     the glyph-ring (item-status) and not the run chip (run-state).
  2. **Run-state ramp (REUSED from m21, verbatim in style — a dot + label chip).** A board's current run
     reads through m21's `queued` (grey) · `running` (teal **+ pulse**) · `done` (teal **+ ✓**) ·
     `failed` (red) · `cancelled` (grey) chip — one source, the same chip m21 emits per board, now shown
     at the group level ("running ♥4s" fleet-wide). The `running` **pulse** is the one motion on screen =
     "something is happening now."

     > **Fleet reduction — ADR-005 / finding F1 / design-gap A (build reconciliation).** The FLEET tile
     > carries only the **reduced running / idle** signal: a board's run state is derived from its **owner
     > node's synced `presence.activeRuns`** — the ONLY fleet-durable run source (a peer board's own run
     > records never sync here; there is no board→workspace map). So the fleet tile honestly shows
     > **running** (the owner has ≥1 active run) or **no active run** ("No runs yet") — NOT the full
     > terminal ramp, and a node owning several boards paints them all "running" together. The richer
     > per-board ramp (`done`/`failed`/`queued`/`cancelled` + `#attempt` + `sess·…`) is a **drill-in**
     > concern — it renders in that board's own `aof work ui` (one level down), where the board's run
     > records ARE local. The committed mock's terminal chips (`done`/`failed`/`queued`) are therefore
     > **aspirational for the fleet tile**; the reduced chip is the conformance target for the fleet
     > surface. (See ARCHITECTURE ADR-005.)
  3. **(referenced, one level down)** the m03 **glyph-ring** item-status ramp — it is **not** re-rendered
     on this surface (the fleet view shows *nodes* and *boards*, not individual milestone/story items);
     it appears when the operator drills into a board's `aof work ui`.

- **The NODES region.**
  - **Layout:** a summary line (`N nodes · N live · N stale`) + a responsive card grid, one **node card**
    per roster member.
  - **The node card (anatomy, top→bottom):** (1) the **presence dot** + a mono **`nodeId`** (the node's
    stable identity, m22) + a right-aligned **`aofVersion`** provenance chip; (2) the **presence-age
    line** — `♥ Ns ago` (live) / `stale · Nm ago` (stale) / "no presence" — the node-presence ramp;
    (3) **what it's running** — a count of `activeRuns` (m23 presence, the in-flight run ids read from
    the run records: "running 2 runs" / "idle" when empty); (4) a quiet **capability footer** —
    `runtimes` (claude/codex/gemini) + `N skills` (m22 node record). Task counts / run *history* are
    **not** shown on the node card (that lives in the drilled-in `aof work ui`, m21).
  - **THIS node** (the machine the operator is on) is marked with a subtle "this node" tag so the
    operator can orient — a quiet label, not a colour change (identity, not status).

- **The BOARDS region.**
  - **Layout:** a summary line (`N boards · N running`) + a responsive card grid, one **board tile** per
    registered board (m24 registry `boards[]` / `roster[].boards`).
  - **The board tile (anatomy):** (1) the **board name/slug** + a quiet **"on `<nodeId>`"** owner label
    (which node is working it — the roster join); (2) the **run-state chip** (m21) showing the board's
    current/in-flight run — `● running ♥ 4s` (with `#attempt` + truncated `sess·…` when running), else
    the most-recent terminal chip (`○ done · 2d ago`); (3) an **`Open board →`** drill-in affordance — a
    link out to that board's own `aof work ui` (SPEC: a link, **not** an embed). Clicking navigates to
    the per-stream board; it does **not** open a panel on the fleet surface.
  - A board with a `running` run carries the m21 **in-flight pulse dot** treatment (teal, pulsing) so
    active boards are visible at a glance across the fleet.

- **Component choices + WHY:**
  - **Cards over rows, reusing the m03 card idiom** — a node / board is evaluated *as a whole* (is it
    alive? what's it running? open it?), the same scannability argument m03 made for work items; a text
    roster would be the wall-of-text the board rework rejected. Built from the kit + tokens, no new
    system.
  - **Three distinct ramps, three primitives** — the load-bearing distinction. Node-liveness
    (dot + age), run-state (dot+label chip, m21), and item-status (glyph-ring, m03, one level down) must
    **never be confusable**, so each keeps its own primitive. A reader always knows which of "is the
    machine alive / is the run going / where does the item stand" they are reading.
  - **Stale is `secondary`, not `destructive`** — a stale node has lost *liveness, not data* (m23 KR5);
    the fleet degrades cleanly to git-only. Painting it red would over-alarm a normal degraded state.
    Red (`destructive`) on this surface is reserved for a genuinely `failed` run chip (m21).
  - **Drill-in is a link, never an embed** — the fleet view sits *on top of* the work UIs; embedding a
    board would fork the m03 surface and blur the read-only boundary. `Open board →` hands off to that
    board's own `aof work ui` (unchanged, surface 3).
  - **No dock / no actions strip / no selection-mutation** — this surface has no mutating control by
    design (read-only; m27 adds issue/assign). Keeping those regions *off the screen* is the visual
    statement that the fleet view renders and never drives.

- **Binding checklist (regions in order → component → states) — the interim baseline until
  `mocks/mesh-ui.png` lands (ADR-003):**
  1. **Top bar:** `✦ aof · Mesh · <group>` (left) · `◷ legend` (the three-ramp legend) · right-aligned
     `⟳ refreshed Ns ago` poll/refresh affordance (click re-polls in place; **no** push/stream chrome).
  2. **Nodes region:** an uppercase `NODES` label + a summary line (`N nodes · N live · N stale · N offline`
     — the fourth `offline` segment counts no-presence nodes; folded in at verify per the design-conformance
     judge), then a responsive **node-card grid**.
     - **Node card:** presence **dot** + mono `nodeId` + `aofVersion` chip (row 1) · presence-age line
       (row 2, node-presence ramp) · `activeRuns` count ("running N runs" / "idle") (row 3) · capability
       footer (`runtimes` + `N skills`) (row 4) · a "this node" tag on the local node.
  3. **Node-presence ramp (must be this mapping):** live = `primary`/teal filled dot + `♥ Ns ago` ·
     stale = `secondary`/muted hollow dot + `stale · Nm ago` · no-presence = dashed/muted dot + "no
     presence". Colour **and** label always together. (Stale is `secondary`, **not** `destructive`.)
  4. **Boards region:** an uppercase `BOARDS` label + a summary line (`N boards · N running`), then a
     responsive **board-tile grid**.
     - **Board tile:** board name/slug + "on `<nodeId>`" owner label (row 1) · **run-state chip** (m21
       ramp — current/in-flight run; `#attempt` + `sess·…` when running) (row 2) · `Open board →` drill-in
       link (row 3). A `running` board carries the m21 in-flight pulse dot.
  5. **Run-state ramp (must be this mapping, m21 verbatim):** queued = grey dot · running = teal
     (`primary`) dot **+ pulse** · done = teal (`primary`) dot **+ ✓** · failed = red (`destructive`) dot ·
     cancelled = grey (`secondary`) dot. Colour **and** label together; **never** merged with the
     glyph-ring or the node-presence ramp.
  6. **States (the whole surface):**
     - *loading* — a `.mono` "Loading fleet…" line (the m03 loading idiom).
     - *error* — an `accent` line + Retry ("Could not load the mesh: …"), mirroring the board's error
       line. (A failure to reach the registry/relay is an error state on the *page*, distinct from a
       *stale node* — a stale node is normal degraded liveness, rendered, not an error.)
     - *empty fleet (no roster)* — a dashed-border placeholder: "No nodes in the group yet — run
       `aof mesh invite` / `aof mesh join` to enrol a machine." (the m03 empty-stream convention — a
       dashed placeholder, NOT an error; mirrors `mesh:status`'s "No nodes in the mesh roster.").
     - *nodes, no boards* — the Nodes region populated + the Boards region showing a dashed "No boards
       registered in the group yet" placeholder (absent, not an error).
     - *populated* — the two card grids as described.
     - *per-node degraded* — a **stale** node still renders (its card shows `stale · Nm`, its
       last-known `activeRuns`), because the fleet degrades to git-only visibility; staleness is a
       rendered state, never a dropped card or an error.

### 2 — `aof mesh status` — the CLI mirror (a `@cli` textual baseline, not a visual mock)

`aof mesh status` is the **terminal-text mirror** of the fleet view — the same `mesh:status` read the
web surface renders, in one-line-per-node text. It is **`@cli`, not `@uat`**: its conformance baseline
is this textual-shape spec (columns + staleness), **not** a screenshot mock. No `mocks/` artifact is
owed for it.

- **Textual shape (the live human render, `src/commands/mesh-identity.mjs`).** One line per node — its
  `nodeId`, then its liveness derived from presence + the stale flag:
  ```
  mac-studio — live
  linux-box — live
  old-laptop — stale
  new-peer — no presence
  ```
  Rendered from the same `{ nodes: [ { nodeId, presence?, stale } ] }` shape; **`live`** when a presence
  record with a `heartbeatAt` exists and is not stale, **`stale`** once it ages past
  `stalenessSeconds`, **`no presence`** for a node record with no heartbeat yet (the m23 locked rule).
  An empty roster renders the explicit line **"No nodes in the mesh roster."** (not an error).
- **The `--json` face** is the stable machine shape (`{ nodes: [...] }`) the web surface consumes — the
  CLI text render and the web view are **two faces of one command** (m08 thin-face discipline), so the
  columns above and the fleet cards render the *same* facts.
- **Columns / staleness baseline (what the CLI render must carry):** `nodeId` (identity) · a liveness
  token (`live` / `stale` / `no presence`) derived from `heartbeatAt` age vs `stalenessSeconds`. The
  web surface adds `activeRuns` count, `runtimes`/`skills`, and the boards region on top of these same
  facts; the CLI stays terse (one line per node). *(Boards + per-board run state are a fleet-view
  enrichment; the current `mesh:status` render is node-centric — a boards column in the CLI, if wanted,
  is a task-feature outcome, cross-referenced below, not a design mock.)*
- This section exists so the CLI render has a **baseline the review can judge** (the textual layout +
  the staleness tokens); it is not a visual-fidelity surface.

### 3 — `aof work ui` — visually UNCHANGED from milestone 03 (stated explicitly so no new baseline is expected)

The `aof work board → aof work ui` **rename** (SPEC move 1) is a **command rename only** — the
per-stream board surface is **visually identical** to milestone 03's board (its overview grid, status
lanes, detail panel, actions strip, and terminal dock, plus milestone 21's RUNS tab / current-run
strip / rerun affordance). **This milestone introduces no visual change to that surface and owns no new
mock for it.** Its conformance source of truth remains **`03/DESIGN.md`** (+ its committed
`Work Board.dc.html` mock) and **`21/DESIGN.md`** (+ its `work-board-runs.dc.html` mock).

**Explicitly for the design-conformance review:** do **not** expect a new baseline, a new mock, or a
new binding checklist for `aof work ui`. If a fidelity judgement of the renamed board is needed, it is
judged against the **milestone-03 / milestone-21 baselines**, unchanged. The only thing the rename
touches visually is any place the *string* "Work Board" appears as a label — the surface, layout,
components, ramps, and states are carried forward verbatim. (The rename's real weight is on the
registered command + its frozen `/api/work` envelope + fitness functions — an ARCHITECTURE concern, not
a design one.)

---

## Documented defaults (decided here, not blocking)

These resolve open UI questions with a recorded default so the build is unambiguous; the PO can
override any of them.

1. **Three read-only ramps, three primitives — never merged.** Node-liveness = a presence dot + a
   relative-age label (`♥ Ns` / `stale · Nm`), onto `primary` (live) / `secondary` (stale) / muted
   (no-presence); run-state = the m21 dot+label chip (verbatim); item-status = the m03 glyph-ring
   (one level down, in `aof work ui`). A reader can always tell node-liveness from run-state from
   item-status. Stale is `secondary` (degraded liveness, not data loss), **not** `destructive`.
2. **The fleet view is READ-ONLY — no mutating control on the screen.** No issue/assign/route/revoke
   affordance (m27). The only interactions are *drill into a board* (a link to `aof work ui`) and
   *refresh* (re-poll). This is a stronger form of the m03 read-mostly rail: here there is no mutating
   control at all.
3. **Drill-in is a LINK to `aof work ui`, never an embedded board.** The fleet view sits on top of the
   work UIs; `Open board →` hands off to that board's own surface (unchanged), it does not embed or
   fork it.
4. **Visibility is poll/refresh, surfaced as `⟳ refreshed Ns ago`.** No WebSocket log-tail / event-stream
   chrome on the client (PRD §7.3). Presence arrives ≤5s relay / ≤30s git underneath (m23 KR1); the UI
   reflects it on the m03 `load({silent})` non-tearing refresh. The affordance both shows freshness and
   triggers a manual re-poll.
5. **A stale / no-presence node is ABSENT-or-degraded, never an error.** A stale node renders with its
   `stale · Nm` label + last-known `activeRuns` (git-only degraded visibility); a never-beat node reads
   "no presence" (`stale:false`, the m23 locked rule). A *page-level* failure to reach the
   registry/relay is the only error state (an `accent` line + Retry). Node degradation ≠ page error.
6. **`aof work ui` is visually unchanged — no new mock, no new checklist.** Its baseline stays
   `03/DESIGN.md` + `21/DESIGN.md`. Only the command name and any "Work Board" label change.

---

## Behavioural outcomes (cross-reference)

The user-visible BEHAVIOUR is specified as task scenarios in the stories this milestone will break down
(`aof:refine 25`), NOT here. This design fixes the look/feel; the features fix what happens. Referenced
by intended name:

- **`aof mesh ui` renders every node in the group with its presence + stale flag + activeRuns** (from
  the roster + presence read) — see the fleet-surface story's `tasks/mesh-ui-renders-nodes.feature`.
- **`aof mesh ui` renders every registered board with its per-board run state and drills into `aof work
  ui`** (the m21 run-observability surfaced fleet-wide; the drill-in is a link to that board's own
  surface) — see the fleet-surface story's `tasks/mesh-ui-renders-boards.feature` and
  `tasks/board-drill-in.feature`.
- **A peer's change is reflected within KR1's bound** (≤5s over the relay / ≤30s over git) on the fleet
  view's poll/refresh — see the fleet-surface story's `tasks/fleet-reflects-peer-change.feature`
  (and the m23 KR1 measurement it rides).
- **`aof mesh status` renders nodes + staleness as one-line-per-node text** (and the `--json` face the
  web view consumes) — a `@cli` outcome; see the CLI-mirror story's `tasks/mesh-status-render.feature`.
- **`aof work board` is renamed to `aof work ui`** (the registered command + its frozen `/api/work`
  envelope carried forward; the surface visually unchanged) — a task-feature + ARCHITECTURE outcome, not
  design; see the rename story's `tasks/work-ui-rename.feature`, cross-referenced to the milestone-03
  board envelope + the milestone-08 bijection fitness functions.
- **The fleet view writes nothing / has no issue-assign affordance** (read-only; m27 adds it) — a
  task-feature outcome, not design; see the fleet-surface story's
  `tasks/fleet-view-is-read-only.feature`.

---

## Appendix A — Generation-ready mock brief for `aof mesh ui`

> **For the user:** paste the block below into your design tool (claude.ai design / Figma). It is
> self-contained. When the mock is generated, commit it at
> **`wiki/work/25_milestone_mesh-ui/mocks/mesh-ui.png`** — DESIGN.md then treats that committed file as
> the conformance source of truth for this surface (a locally-readable artifact, never a remote link).

---

**Design a single screen: the read-only "fleet mission-control" view of a local developer tool called
aof.**

**What it is.** aof runs a software project as a stream of work on a developer's own machine. Several
machines ("nodes") can form a small trusted **group** ("fleet") that share work over git + a relay.
This screen — `aof mesh ui` — is the **one read-only view of the whole fleet**: which machines are
alive, what each is running, and every project board being worked on across the group. It is
**read-only**: it shows state, it never has a button that changes anything. No login, no account menu,
no settings — single-user, single-group, localhost.

**The feeling.** A calm developer IDE / mission-control dashboard, not a monitoring SaaS. Dense but
calm, one window, no marketing chrome. Monospace for machine ids, refs, and timestamps; a clean sans
(Inter) for everything else.

**The visual language (match it exactly — this screen is part of an existing product family, do not
invent a new palette):**
- Light theme. Colours: **teal = primary** (alive / active / good), **crimson = accent** (needs eyes),
  **red = destructive** (failure only), **neutral grey = secondary/muted** (quiet / degraded / idle).
- Corner radius ~8px. Card-based surfaces with subtle borders, low shadow. Small uppercase section
  labels. Monospace for ids/timestamps.
- Cards, not rows of text — each node and each board is a card you can size up as a whole.

**Layout — one screen, top bar + two stacked regions:**

1. **Top bar (slim):** left — a `✦ aof` mark + "Mesh" + the group name (e.g. "umair-fleet"). Right — a
   small legend affordance and a quiet "⟳ refreshed 4s ago" refresh label. No nav, no account menu.

2. **NODES region** (first): a small uppercase "NODES" label + a summary line ("3 nodes · 2 live · 1
   stale"), then a responsive grid of **node cards**. Each node card shows:
   - a **presence dot** + the machine's **id** (monospace, e.g. `mac-studio`) + a small version chip
     (e.g. `v0.9`);
   - a **presence line** — one of: **live** (teal filled dot + "♥ 4s ago"), **stale** (grey hollow dot
     + "stale · 2m ago"), or **no presence** (faint dashed dot + "no presence");
   - **what it's running** — e.g. "running 2 runs" or "idle";
   - a quiet footer — its runtimes + skill count (e.g. "claude · 12 skills").
   - Mark one card subtly as "this node" (the machine you're on).
   Show all three presence states across the cards so the ramp is visible (some live, one stale, maybe
   one no-presence).

3. **BOARDS region** (below): a small uppercase "BOARDS" label + a summary line ("4 boards · 2
   running"), then a responsive grid of **board tiles**. Each board tile shows:
   - the **board name** (e.g. `let-shield`) + a quiet "on `mac-studio`" owner label (which machine works
     it);
   - a **run-state chip** — a coloured dot + label for the board's current run: **running** (teal dot
     with a soft pulse + "running", plus a small "♥ 4s", an attempt "#5", and a truncated session
     "sess·9f2e…"), **done** (teal dot with a ✓ + "done · 2d ago"), **failed** (red dot + "failed"),
     **queued/cancelled** (grey dot). A running board's tile carries the pulsing teal dot.
   - an **"Open board →"** link (a drill-in to that board's own detailed view — just show it as a link
     affordance, bottom-right).
   Show at least one **running** board (with the pulse + attempt + session) and one **done** board.

**Three distinct status vocabularies — keep them visually separate (important):**
- **Node liveness** = the presence dot + age label (live/stale/no-presence). Teal = live, grey = stale
  (a stale machine is a quiet degraded state, NOT an alarm — do not paint it red), faint = no presence.
- **Run state** = the dot+label chip on a board (queued/running+pulse/done✓/failed/cancelled). Red is
  used ONLY for a failed run.
- (There is a third "item status" ring vocabulary elsewhere in the product — do NOT put it on this
  screen; this screen is nodes + boards only.)

**States to include in the mock (as insets or variants, so the build has a reference):**
- **populated** (the main state above — a few nodes, a few boards, mixed liveness + run states);
- **empty fleet** — a dashed-border placeholder card: "No nodes in the group yet — run `aof mesh
  invite` / `aof mesh join` to enrol a machine.";
- **loading** — a quiet "Loading fleet…" line;
- **error** — a crimson line + a "Retry" affordance ("Could not load the mesh: …").

**Do NOT include:** any button that changes state (assign, route, issue, revoke, start/stop) — this
screen is strictly read-only. No terminal, no editable fields, no login/account UI, no settings. Keep
those off the screen entirely.

**Deliver:** one full-screen mock of the populated state (top bar + Nodes region + Boards region), the
node-card and board-tile anatomy (with their per-state variants), and the empty/loading/error insets.
