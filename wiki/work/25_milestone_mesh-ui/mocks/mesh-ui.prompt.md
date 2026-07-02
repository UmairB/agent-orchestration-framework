# Generation brief — `mesh-ui.png`

Paste the block below into your design tool to generate the fleet surface mock. When it's done, export
it and commit it beside this file as **`mesh-ui.png`** — DESIGN.md then treats that image as the
conformance source of truth for `02_story_fleet-ui` (replacing the interim binding checklist).

Assumes familiarity with aof and its existing UI family (the m03 work board + m21 run observability).
This brief covers only the one new deliverable: the `aof mesh ui` read-only fleet surface.

---

**Design one screen: `aof mesh ui` — the read-only "fleet mission-control" view.**

**Purpose.** This is the single screen that answers one operator question: *"what is my whole fleet
doing right now?"* — which machines (nodes) are alive, what each is running, and every project board
being worked on across the group, each drillable into its own work board. It sits **on top of** the
per-stream work boards; it is a roster/overview, never a board itself.

**Hard constraint — strictly read-only.** It renders state and nothing else. There is **no** control on
the screen that mutates anything (no assign / issue / route / revoke / start / stop), no terminal, no
editable field, no login / account menu / settings. Those live one level down (the work board) or in a
later milestone. Keep them off the screen entirely. The only two interactions are **drill into a board**
(a link out) and **refresh** (re-poll).

**Visual family (match exactly — do not invent a palette; this is part of an existing product):**
- Light theme. **teal = primary** (alive / active / good) · **crimson = accent** (needs eyes) ·
  **red = destructive** (failure only) · **neutral grey = secondary/muted** (quiet / degraded / idle).
- ~8px corner radius, card surfaces with subtle borders and low shadow, small uppercase section labels.
- Monospace for machine ids / refs / timestamps; Inter for everything else.
- Cards, never rows of text — each node and each board is sized up as a whole.

**Layout — one window: a slim top bar over two stacked regions.**

1. **Top bar (slim).** Left: a `✦ aof` mark · "Mesh" · the group name (e.g. `umair-fleet`). Right: a
   quiet legend affordance · a `⟳ refreshed 4s ago` refresh label. No nav, no account menu.

2. **NODES region (first).** An uppercase `NODES` label + a summary line (`3 nodes · 2 live · 1 stale`),
   then a responsive grid of **node cards**. Node-card anatomy, top → bottom:
   - **presence dot** + the machine **id** (monospace, e.g. `mac-studio`) + a right-aligned version chip
     (e.g. `v0.9`);
   - a **presence line** — one of: **live** (teal filled dot + `♥ 4s ago`) · **stale** (grey hollow dot
     + `stale · 2m ago`) · **no presence** (faint dashed dot + `no presence`);
   - **what it's running** — `running 2 runs` / `running 1 run` / `idle`;
   - a quiet **capability footer** — runtimes + skill count (e.g. `claude · 12 skills`).
   - Mark exactly one card subtly as **"this node"** (the machine you're on) — a quiet label, not a
     colour change.
   Show all three presence states across the cards so the ramp reads at a glance (several live, one
   stale, one no-presence).

3. **BOARDS region (below).** An uppercase `BOARDS` label + a summary line (`4 boards · 2 running`),
   then a responsive grid of **board tiles**. Board-tile anatomy:
   - the **board name** (e.g. `let-shield`) + a quiet **`on mac-studio`** owner label (which machine
     works it);
   - a **run-state chip** for the board's current run (see the run vocabulary below);
   - an **`Open board →`** drill-in link, bottom-right (an affordance out to that board's own work board
     — a link, not an embedded panel).
   Show at least one **running** board and one **done** board.

**Three distinct status vocabularies — keep them visually separate (this is the load-bearing part):**
- **Node liveness** — the presence dot + age label (live / stale / no-presence). Teal = live, grey =
  stale, faint dashed = no presence. **A stale machine is a quiet degraded state, NOT an alarm — never
  paint it red.**
- **Run state** — the dot + label chip on a board: `queued` (grey) · `running` (teal dot + soft pulse) ·
  `done` (teal dot + ✓) · `failed` (red dot) · `cancelled` (grey dot). **Red appears only for a failed
  run.** A running board carries the pulsing teal dot — the one motion on the screen.
- (There is a third "item-status" ring vocabulary elsewhere in the product — do **not** put it on this
  screen. This screen is nodes + boards only.)

**States to include (as insets / variants so the build has a reference):**
- **populated** — the main state above (a few nodes, a few boards, mixed liveness + run states);
- **empty fleet** — a dashed-border placeholder: *"No nodes in the group yet — run `aof mesh invite` /
  `aof mesh join` to enrol a machine."*;
- **loading** — a quiet `Loading fleet…` line;
- **error** — a crimson line + a `Retry` affordance (*"Could not load the mesh: …"*).

**Deliver:** one full-screen mock of the **populated** state (top bar + Nodes region + Boards region),
the node-card and board-tile anatomy with their per-state variants, and the empty / loading / error
insets.

---

### Note for our records (not part of the paste-in brief)

Two board run-chip tokens are currently **data-blocked** (verify finding **F1** + design-gap A): the
locked `mesh:status` aggregate carries only board run *ids*, so a per-run **`#attempt`**, a truncated
**`sess·…`**, and a terminal **`done · 2d ago`** age have no live data source yet. Two ways to close it,
pick one before this mock becomes binding:
- **Aspirational mock (recommended):** draw the full m21 chip (attempt + session + terminal age) as the
  north star; F1's `ADR-005` then enriches the aggregate (owner-presence read + m21 `work:run-status`
  join) to feed it.
- **Reduced mock:** draw only `running` (pulse) / `idle` / last-terminal-state, matching today's thin
  aggregate, and amend the DESIGN checklist to a reduced fleet chip.

The brief above is written for the **aspirational** target. If you'd rather lock the reduced chip, say
so and I'll trim the run-state paragraph accordingly.
