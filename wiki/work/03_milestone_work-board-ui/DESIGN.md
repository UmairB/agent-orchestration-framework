---
doc: design
---
<!--
  Milestone DESIGN.md — how should it look and feel, and why.
  Owner: designer. Layout / component / visual intent only.
  UI BEHAVIOUR (what happens when you click) lives in task .feature files — cross-referenced below,
  not specified here.
-->
# 03 · Work Board UI — Design

## Intent

A single-user, localhost operator console for *driving the ACD work loop without leaving the
browser*. The user is the person running aof on their own machine (the developer/operator of the
work stream). They want to (1) **see** the whole milestone → story → task stream and where each
item stands, (2) **act** on a selected item — read its docs/findings, add feedback, validate,
ask for the next thing to do — and (3) **run the agent** (Claude Code / Codex / Gemini) against
that item in an in-app terminal, watching it work.

The feeling to hit: a **calm IDE**, not a project-management SaaS. It is a workbench — dense,
keyboard-reachable, monospace where identity/refs/logs appear, one window, no marketing chrome.
Because it is localhost single-user, there is **no auth, no tenant switcher, no account menu** —
that surface area stays off the screen.

This milestone designs WITH the existing aof UI kit (React 19 + Tailwind 4 + the shadcn-style
primitives already in `ui/src/components/ui/`: `badge`, `button`, `card`, `input`, `label`,
`scroll-area`, `textarea`; `lucide-react` icons; `dnd-kit` available). It introduces **no new design
system** and reuses the shell language already established in `ui/src/main.tsx` — a left rail plus
content panes, `bg-sidebar` rail, `text-primary`/`text-accent` status lines, a `fixed bottom-4
right-4` toast. The theme ramp is fixed in `ui/src/index.css`: `primary` = teal, `accent` = crimson,
`secondary`/`muted` = neutral grey, `destructive` = red, `--radius` = 0.5rem, Inter body + a `.mono`
utility for monospace.

---

## Overarching layout — two levels, one screen

> **Reworked 2026-06-20** from the original single-screen indented-tree board to a **two-level,
> card-based** model, on operator feedback that a text tree was hard to digest ("evaluate a work item
> as a whole, not a wall of text"). The visual source of truth is the approved Claude-design mock
> **`Work Board.dc.html`** (claude.ai/design project `a1e976a1…`) + its screenshots; this section is
> the durable spec. The two binding rails are unchanged: **status is derived, never user-set** (no
> drag-to-restatus), and the surface **reuses the existing kit/theme tokens** (no new design system).

The board is **two views** under one slim top bar (`✦ aof · Work Board · ◷ status legend · ⟳ sync`):

**VIEW 1 — Overview ("Work items"), the default.** A responsive **3-column grid of milestone cards**,
each a digestible unit (status glyph-ring · `ref` · status chip · title · a `done/total` progress bar ·
one dot per story coloured by its status · a footer with an attention note + "Open board →"). A
header carries summary chips (`✓ N done`, `◐ N active`, `! N blocked gate`). Below the grid, an
**Acceptance gates** strip lists the `uat` items (cross-cutting, red-tinted when blocked). No detail
column, no dock — the overview is its own full-width screen.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [✦] aof  Work Board                              ◷ status legend   ⟳ sync       │
├──────────────────────────────────────────────────────────────────────────────┤
│  Work items            6 milestones · derived       ✓4 done ◐1 active !1 gate   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                                 │
│  │◐ 03  MILE… │  │✓ 05  MILE… │  │○ 04  MILE… │   ← milestone cards (3-col grid) │
│  │ Work Board │  │ Work Memory│  │ Round-trip │                                 │
│  │ ▰▰▱ 0/3    │  │ ▰▰▰ 4/4    │  │ ▱▱▱ 0/0    │   ← honest progress bar         │
│  │ ● ● ●      │  │ ● ● ● ●    │  │ —          │   ← one dot per story            │
│  │ ◔3 review  │  │ ✓ accepted │  │ ·  Open →  │                                 │
│  └────────────┘  └────────────┘  └────────────┘                                 │
│  ACCEPTANCE GATES                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐ │
│  │ (!) U1  UAT GATE · BLOCKED   Acceptance — Work Board       waiting on 03 → │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

**VIEW 2 — Board (status lanes for one milestone).** Opening a card drills into a **five-lane
status board** scoped to that milestone — `not-started · in-progress · in-review · blocked · done` —
its stories bucketed by derived status (read-only; the lanes are derived buckets, NOT draggable
columns). A breadcrumb (`‹ Work items`) + a **milestone switcher** dropdown change focus (a milestone,
or "All milestones" for the full stream). A **fixed detail column (right, ~382px)** is selection-driven,
and the **terminal dock** spans the bottom.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [✦] aof  Work Board                              ◷ status legend   ⟳ sync       │
├──────────────────────────────────────────────────────────────────────────────┤
│ ‹ Work items / [● 00 · Work CLI ▾]                 3 stories · ◔0 review !0 blk │
├───────┬───────┬───────┬───────┬───────┬────────────────────────────────────────┤
│ NOT-  │ IN-   │ IN-   │ BLOCK │ DONE  │  ITEM DETAIL                           │
│ START │ PROG  │ REVIEW│       │  (3)  │  ✓ 00/00 · story        [done] ▸ Run    │
│       │       │       │       │ ▢00/00│  CLI scaffold                          │
│       │       │       │       │ ▢00/01│  [STORY|VERIF|RETRO|Findings(0)]       │
│       │       │       │       │ ▢00/02│  Objective / Acceptance / Records …    │
│       │       │       │       │       │  [+ feedback] [✓ Validate] [→ Next]    │
├───────┴───────┴───────┴───────┴───────┴────────────────────────────────────────┤
│ ▣ TERMINAL  provider:(●claude ○codex ○gemini)  item 00/00  ●running   ⌃ ⌄ ✕    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why two levels.** A milestone-grid answers "where does the whole project stand?" at a glance (the
operator's first question), and each card is evaluable as a whole. Drilling into a milestone gives its
stories the **full width** of the five status lanes — which is why the lanes live one level in, not in a
cramped left rail. *Status lanes* give the kanban legibility the operator asked for **without** a
kanban's drag-to-set-status gesture: the lanes are derived buckets, so the board can never lie about an
item's real state. The detail column + terminal dock keep the original "read the item, then watch the
agent run on it" workflow, now scoped to the drilled-in milestone.

**Selection is the single source of context.** In the board view exactly one item is selected; that
selection drives the detail column AND is the default target for Run-agent + the three actions. The
selected `ref` is echoed in the terminal dock header. (The URL hash, e.g. `/#03/02`, deep-links a
selection and opens its milestone's board.)

**Status is derived; no drag-to-restatus.** The lanes are computed buckets, never user-movable. dnd-kit
remains layout-only (it is not wired to any status mutation). This is a binding constraint (ADR-004 /
`acd-board-write-isolation`).

---

## Screens / surfaces

### 1 — The work board (overview grid → status lanes)

- **Mockup:** the approved Claude-design **`Work Board.dc.html`** (project `a1e976a1…`) + screenshots
  are the visual source of truth; the prose below + the ASCII in "Overarching layout" are the durable
  spec; the build output is what the design-conformance review renders against.
- **Route:** `/?mode=board` (one screen; the two views are app state, not separate routes — the hash
  carries the selected `ref` for deep-linking).

- **The status ramp — a GLYPH RING (shape carries meaning).** The five derived statuses read by
  **ring shape + colour + label**, mapped to the existing theme tokens (no new palette):
  - `not-started` → **dashed grey ring** (`muted`) — present but quiet.
  - `in-progress` → **teal conic-fill ring** (`primary`) — actively building.
  - `in-review` → **crimson ◔ ring** (`accent`) — "needs eyes," not yet accepted.
  - `blocked` → **solid red `!` disc** (`destructive`) — attention / cannot proceed.
  - `done` → **solid teal ✓ disc** (`primary`) — accepted.
  The same ring is reused on cards, lane cards, the detail header, and the switcher; a chip (label) and
  a small dot variant are derived from the same source (`ui/src/board/status.tsx`). A **status legend**
  in the top bar documents the mapping. (This supersedes the old 3-variant-`Badge` ramp.)

- **VIEW 1 — the milestone-card grid (overview).**
  - **Layout:** a responsive 3-column grid of milestone cards + a summary-chip header + an Acceptance
    gates strip. Full-width; no detail/dock here.
  - **The card (anatomy, top→bottom):** (1) status **ring** · mono `ref` · uppercase "MILESTONE" ·
    right-aligned status **chip**; (2) **title**; (3) **progress** — a `done / total` label + a bar that
    measures **acceptance**: **teal is reserved for `done`/accepted** stories (`done/total`), and the
    un-done remainder of an *in-progress* milestone shows a **muted (non-teal) moving shimmer** =
    "work in flight, not yet accepted". So the teal fill always equals "how many accepted": a
    0-done / 3-in-review milestone shows **no teal** + a grey shimmer (not a teal bar that looks
    finished); a done milestone is fully teal; a not-started one is a flat empty track; (4) one
    **dot per story** coloured by that story's status; (5) **footer** — story count · an attention note
    (`◔ N in review` if any, else `✓ accepted` for a done milestone, else `·`) · "Open board →".
    Clicking the card opens VIEW 2 focused on that milestone. **Task counts are NOT shown** (not in the
    `work list --json` contract — see Findings/F-2).
  - **Acceptance gates strip:** one wide bar per `uat` item (disc + mono ref + "uat gate"+`· blocked` ·
    title · status chip; a "waiting on N" label when cheaply derivable from `/api/work/next`). Rendered
    only when `uat` items exist.
  - **Summary chips:** `✓ N done`, `◐ N active`, and `! N blocked gate` (the last only when > 0).

- **VIEW 2 — the status lanes (one milestone).**
  - **Layout:** a five-column lane grid (`not-started · in-progress · in-review · blocked · done`)
    filling the content area, each lane independently scrollable with a **sticky header** (ring +
    status name + count pill); the blocked lane carries a faint red tint. A breadcrumb row
    (`‹ Work items`) + a **milestone switcher** (dropdown: "All milestones" + each milestone) sets the
    focus; a right-aligned scope count + `◔ review` / `! blocked` chips.
  - **Lane cards:** ring + mono `ref` + a small tag (`in 03` / `milestone` / `uat`) · title · a meta
    line (status-short, or an in-progress mini barber bar). The **selected** card gets a coloured
    1.5px border + soft shadow + tint. Clicking selects (drives the detail column).
  - **Bucketing:** focus = a milestone → its **stories** (+ a gate that accepts it) bucketed by status;
    focus = "all" → milestones, plus any in-review/blocked story, plus gates.
  - **Empty milestone:** a centred dashed-ring placeholder ("No stories in this milestone yet — it's
    scaffolded but not started").

- **Component choices + WHY:**
  - **Cards over rows** — the operator asked to evaluate an item *as a whole*; a card with ring +
    progress + dots + counts is scannable in one glance where a text row was a wall of text. Built from
    the kit (`Card`-like surfaces, theme tokens) — no new design system.
  - **Lanes one level in, not a left rail** — five status columns need width; scoping them to a single
    milestone (drilled-in) gives them the full content area, which is why the overview is a grid and the
    lanes live behind "Open board →".
  - **Derived buckets, never draggable** — the lanes give kanban legibility without a kanban's
    set-status gesture; status stays derived (ADR-004).

- **States (both views):** *loading* — `mono` "Loading work stream…"; *error* — `accent` line + Retry;
  *empty stream* — dashed-border "No work items yet — run `aof work init`…"; *empty milestone* — the
  placeholder above; *populated* — the grid / lanes as described.

### 2 — The item detail panel

- **Route:** the board view's right column (~382px, fixed); reflects the selected item. The hash
  carries the `ref` for deep-linking.
- **The doc switcher is TYPE-AWARE — this is the ACD doc model, not a styling choice (corrected
  2026-06-20).** Documents live at the level that owns them, so the tab set depends on the selected
  item's type:
  - **milestone →** `SPEC · VERIFICATION · RETROSPECTIVE · Findings`. These are the milestone's own
    records (a milestone owns the verification + retrospective for its whole span).
  - **story →** `STORY` + `TASKS`. STORY is the user story (`STORY.md`); TASKS lists the story's
    `tasks/*.feature` files — each Feature title + its scenarios with a **lane chip**
    (`@executable`/`@manual`/`@uat`) — read from the new read-only `GET /api/work/tasks?ref=` endpoint
    (the browser can't read disk; the server parses the `.feature` files with a lightweight Gherkin
    parser). A story does **NOT** have its own VERIFICATION/RETROSPECTIVE/Findings (those belong to its
    milestone); offering those tabs on a story (showing "none") was a bug and is removed.
  - **uat →** `Findings` (its `SESSION.md` carries the acceptance findings).
- **Milestone-default selection.** Opening a milestone's board selects the **milestone** by default, so
  the panel shows the milestone's status + SPEC/VERIFICATION/RETROSPECTIVE/Findings; clicking a story
  card switches the panel to that **story view** (user story + tasks). One item is selected at a time.
- **Layout & interaction:** a **header** (status glyph-ring · mono `ref` · type chip · status chip ·
  title · slug · primary **▸ Run agent**), the type-aware tab row, the rendered doc body, and the
  pinned **actions strip** (surface 3) at the foot. The body renders the doc as **rendered markdown**
  (via `marked` — headings, lists, code, GFM tables) with **frontmatter + HTML comments stripped** (the
  header already shows ref/type/status/title — never dump the frontmatter as "objective"; doc content is
  the operator's own local files, rendered as trusted). A milestone's SPEC tab leads with a small
  **Records** summary (which milestone docs exist). There is **no auto-extracted "Objective/Acceptance"**
  heuristic — it mislabelled the frontmatter and the tasks list.
- **The primary action is STATE-AWARE (ADR-006).** The header's primary button derives its label AND the
  `aof` command it runs from the item's derived status along the ACD lifecycle:
  `not-started` & not broken down → **Refine** (`/aof:refine`); `not-started` broken-down / `in-progress`
  → **Continue** (`/aof:continue`); `in-review` → **Verify** (`/aof:verify`); `blocked` → **disabled**
  ("waiting on …"); `done` → a quiet ad-hoc **Run agent** (interactive, no command). If a terminal
  session is already **live for this ref**, the button is **View terminal** (focus the dock, no
  duplicate). The board never *performs* the command — it spawns the agent and the command is **typed
  into it as ordinary PTY input** (the agent does the work); the board stays read-mostly (ADR-004), only
  ever *showing* the resulting VERIFICATION record + derived status.
- **Component choices + WHY:**
  - **Primary action = primary teal `Button`** (`▸` + the state-aware label), top-right of the header —
    the headline action; it targets the selected item, opens the terminal dock (surface 4), and (for a
    non-ad-hoc action) auto-types its `aof` command into the spawned agent.
  - **Findings** renders findings as `StatusLine`-style rows (`CheckCircle2`/`ShieldAlert`); the count
    is the **known gap** (parsing the milestone VERIFICATION.md `## Findings` — F-2/DG-1), so it
    currently reads `0 / none` rather than fabricating.
- **Binding checklist (regions in order → states):**
  1. **Header:** glyph-ring · mono `ref` · type chip · status chip · title · slug · the **state-aware
     primary action** (Refine/Continue/Verify/View terminal/Blocked, per ADR-006).
  2. **Tabs (type-aware):** milestone = SPEC·VERIFICATION·RETROSPECTIVE·Findings; story = STORY·TASKS
     (TASKS = its `tasks/*.feature` with lane chips, via `/api/work/tasks`); uat = Findings. First tab =
     the type's lead doc. Doc bodies render as markdown (`marked`).
  3. **Doc body:** rendered doc (frontmatter/comments stripped); milestone SPEC leads with Records.
  4. **Actions strip:** pinned at the foot (surface 3).
  5. **States:** *no selection* — centred "Select an item…"; *doc absent* — a dashed-border
     placeholder, NOT an error (e.g. a milestone with no VERIFICATION yet → "Not verified yet — run
     aof:verify"; a story with no STORY doc → "No story document yet"); *loading* — `.mono` line;
     *error* — `accent` line; *populated* — the doc; *findings-empty* — positive "No findings."

### 3 — The action affordances (feedback · validate · next)

- **Mockup:** *(part of the detail panel; ASCII strip below)*
- **Route:** `/` (the pinned actions strip at the foot of the item detail panel)
- **Layout & interaction:** A **horizontal action strip** pinned to the bottom of the detail panel,
  always referencing the *selected* item. Three buttons — **+ Add feedback**, **✓ Validate**, **→
  Next** — sit left; a **result region** to their right (or directly beneath the strip) surfaces each
  action's outcome inline. Results are **inline, not modal**: validate and next return structured
  data the user wants to read against the item, so they render in-place rather than in a toast that
  disappears. "Add feedback" opens a small inline compose surface (not a separate page).
  - **Add feedback** → reveals an inline composer: a `Textarea` + a `Send`-icon submit `Button`,
    appearing in the result region (a small `Card`-like panel). On submit it appends to the item's
    STATE `## Feedback (for retro)` log; on success the composer collapses and a confirmation
    `StatusLine ok` shows ("Feedback added"). The freshly-appended entries may render as a short list
    below.
  - **Validate** → runs the work-stream validator for the selected scope; the result region shows a
    `StatusLine ok` ("No issues") or a list of finding rows (path · problem), each an
    `accent`/`destructive` `StatusLine` — the exact `ValidationPanel` idiom from `main.tsx`.
  - **Next** → asks for the next actionable item; the result region shows the returned item's mono
    `ref` + a "Reveal in board" affordance that selects/scrolls-to it and pulses a highlight on its
    row. The three terminal states map to the ramp: `ready` → primary highlight on the row;
    `blocked` → `accent`/`destructive` line naming what it waits on; `done` → a positive "Stream
    complete" `StatusLine ok`.
- **Component choices + WHY:**
  - **Buttons:** Add feedback = `Button variant="outline"` (a compose/secondary verb); Validate =
    `Button variant="secondary"` (a check, neutral); Next = `Button` default/primary-ish but
    *visually subordinate to Run-agent* (Run-agent is the headline; Next is navigation). Icons:
    `Plus` (feedback), `CheckCircle2`/`ListChecks` (validate), `ArrowRight` (next) — all from the
    `lucide` set already imported.
  - **Compose surface = `Textarea` + `Button`** (the kit primitives), inline — reusing the exact
    Textarea idiom from `main.tsx` editors, so composing feedback feels like editing an asset body.
  - **Result region = `StatusLine` rows / a small inline `Card`**, NOT a toast for
    validate/next — their output is *content to read against the item*, so it must persist next to
    the item, not flash and vanish. A transient toast (`fixed bottom-4 right-4`, the existing
    pattern) is reserved for *fire-and-forget confirmations* only (e.g. "Feedback added") — a
    documented default below.
- **Binding checklist (regions in order → component → states):**
  1. **Action strip** (pinned, in detail panel foot): `[ + Add feedback ]` (outline) · `[ ✓ Validate ]`
     (secondary) · `[ → Next ]` (primary, subordinate to Run-agent). Each with a `lucide` icon.
  2. **Result region** (right of / below the strip): renders the active action's outcome inline.
  3. **Feedback composer:** `Textarea` + `Send` submit, revealed in the result region; collapses on
     success.
  4. **States (per action):**
     - *idle* — strip shown, result region empty/placeholder.
     - *composing* (feedback) — composer open.
     - *running* — the invoked button shows a busy/disabled state (`disabled:opacity-50`, the kit
       default) with a spinner glyph.
     - *success* — feedback: `StatusLine ok` + collapsed composer; validate: `StatusLine ok` or
       finding rows; next: revealed item / blocked line / "complete".
     - *error* — `accent`/`destructive` `StatusLine` with the error message (mirrors `main.tsx`'s
       `setMessage` error surfacing).

### 4 — The agent terminal pane (the headline)

- **Mockup:** *(ASCII below + the overarching wireframe is the source of truth)*
- **Route:** `/` (the bottom dock of the single-screen app)
- **Layout & interaction:** A **resizable, collapsible bottom dock** spanning the full content width,
  beneath board + detail. The dock has a **header bar** (chrome) and a **terminal viewport** (the
  xterm canvas — its inner rendering is xterm's, we design only the frame). The header carries, left
  to right: a terminal glyph + "Terminal" label, the **provider picker** (claude / codex / gemini),
  the **target item** echo (mono `ref` of the item the session is bound to), a **connection-state
  indicator** (a coloured dot + label), and dock controls (collapse/expand caret, resize affordance,
  close/kill ✕). Launching is the detail panel's **state-aware primary action** (surface 2) — pressing it
  binds a session to that item (the dock stays bound to **its own session `ref`**, independent of later
  board selection), opens the dock, starts the chosen provider, and (ADR-006) **auto-types the action's
  `aof` command** into the agent on connect (as ordinary input, once per session). A null/ad-hoc launch
  starts the interactive agent with nothing typed. A live session for the selected item surfaces as
  **View terminal** (re-reveal, no re-launch). **Interim: one session at a time** — launching on a
  *different* item replaces (kills) the running one; concurrent sessions (a tab per item) are roadmapped
  (`wiki/work/ROADMAP.md` §2, with the attach/multiplex work).
- **Running-session registry.** On spawn the server logs the PTY **pid** and records the session
  (`pid · ref · provider · cwd · startedAt`) to **`.aof/terminal-sessions.json`** (dropped on end;
  dead pids self-prune). A live PTY can't be migrated into a native terminal, so the pid is the handle
  for inspecting/cleaning up a session (and the basis for a future "open in terminal"). This is
  operational state in `.aof/` (alongside the config/lock), **not** a work-stream write — so it sits
  outside the board's write-isolation (ADR-004); recording is on for `aof work board`, off for the
  asset-UI/test servers.
- **Component choices + WHY:**
  - **Provider picker = a segmented `button` toggle** (the same `grid rounded-md border bg-background
    p-1` idiom as the doc switcher and scope toggle) — **radio-semantics, exactly one selected**.
    **Currently claude-only** (codex/gemini paused at the operator's request); the provider seam
    (`provider-picker.mjs` + the server) still supports all three, so re-enabling is just widening the
    visible list. NOT a dropdown — a consequential, exclusive choice belongs on screen.
  - **Connection-state indicator = a coloured dot + `Badge`/text label**, mapping the dock's lifecycle
    onto the theme ramp (documented states ramp): **idle** = muted/grey dot ("idle"); **connecting** =
    `secondary` with a pulsing dot ("connecting…"); **running** = `primary`/teal dot ("running");
    **exited** = `secondary` grey ("exited (code N)"), or `destructive`/`accent` red if it exited
    non-zero ("exited (1)"). Colour + label together (not colour alone), consistent with the board's
    status-chip rationale.
  - **Dock controls = `Button variant="ghost" size="icon"`** (`ChevronUp`/`ChevronDown` collapse,
    `X` kill) — the icon-button idiom already used in `main.tsx`. Resize via a draggable header edge
    (dnd-kit, layout-only).
  - **Terminal viewport = the xterm container** on a dark surface (terminals read best dark; this is
    the one place the app legitimately diverges from the light shell, and that's expected of a
    terminal). The chrome (header) stays in the app's light theme so the dock reads as part of the
    app, with a dark "screen" inset — the standard IDE terminal look.
- **Binding checklist (regions in order → component → states):**
  1. **Dock header (chrome):** terminal glyph + "Terminal" (left) · **provider picker** (segmented
     claude/codex/gemini, exactly-one-selected) · **target `ref`** echo (mono) · **connection-state
     indicator** (dot + label) · **dock controls** (collapse caret, resize, kill ✕) (right).
  2. **Terminal viewport:** the xterm canvas on a dark surface, fills the dock body, scrollable.
  3. **Provider ramp:** exactly one of claude/codex/gemini active; active = `bg-primary
     text-primary-foreground`.
  4. **Connection-state ramp (must be this mapping):** idle=muted/grey · connecting=`secondary`+pulse
     · running=`primary`/teal · exited(0)=`secondary` grey · exited(≠0)=`destructive`/`accent` red.
  5. **States (the dock itself):**
     - *collapsed* — one-line status strip only (header visible, viewport hidden). **The session keeps
       running** while collapsed (the WS/PTY + xterm stay alive, only hidden; scrollback preserved on
       expand) — only ✕ ends it. (Corrected 2026-06-20: collapse used to tear the session down.)
     - *idle* — expanded, viewport empty/"No session. Press Run agent on an item.", state dot grey.
     - *connecting* — spawning pty / opening WS; pulsing dot; viewport may show a connecting line.
     - *running* — live xterm output streaming; teal dot.
     - *exited* — process ended; exit code shown in the indicator; viewport retains the final
       scrollback; a Restart affordance offered.
     - *error* — failed to spawn/connect (provider missing, server down): `destructive` indicator +
       an inline error line in the viewport area.

---

## Documented defaults (decided here, not blocking)

These resolve open UI questions with a recorded default so the build is unambiguous; the PO can
override any of them.

1. **Status ramp = a glyph ring (reworked 2026-06-20).** The five statuses read by **ring shape +
   colour + label** mapped to the existing tokens — not-started=dashed grey (`muted`),
   in-progress=teal conic (`primary`), in-review=crimson ◔ (`accent`), blocked=red `!` disc
   (`destructive`), done=teal ✓ disc (`primary`). One source (`status.tsx`) emits the ring, a chip, and
   a dot. This supersedes the original 3-variant-`Badge` ramp (the kit's `accent` token supplies the
   crimson in-review colour, so no new palette is introduced). The progress bar reserves **teal for
   `done`/accepted only**; an in-progress milestone's un-done remainder is a muted (non-teal) shimmer,
   so the visual never overstates completion (teal fill = exactly how many stories are accepted).
2. **Validate & Next results are inline, not toasts.** Their output is content to read against the
   item, so it persists in a result region. Toasts (the existing `fixed bottom-4 right-4` pattern)
   are reserved for fire-and-forget confirmations ("Feedback added").
3. **Two views in one screen, selection-as-context, hash-deep-link.** No per-surface routes; the app is
   `/?mode=board` with two app-state views (overview grid ↔ a milestone's lane board). The selected
   item's `ref` is carried in the URL hash (e.g. `/#03/02`) so a render/review can deep-open a specific
   item (and it opens that item's milestone board) — navigation is selection/drill-driven, not
   route-driven.
4. **Terminal dock is dark-on-light.** The xterm viewport is dark (terminals read best dark); the
   dock chrome stays in the app's light theme. This is a deliberate, scoped divergence.
5. **No drag-to-restatus.** dnd-kit is layout-only (pane/dock resize). Status is derived, never set
   by the UI. Called out so it is not built.
6. **Run-agent is the single most prominent action**; Next is visually subordinate to it (Run-agent =
   primary in the detail header; Next = primary-ish but quieter in the action strip), reflecting that
   driving the agent is this milestone's headline over a read-only board.

---

## Behavioural outcomes (cross-reference)

The user-visible BEHAVIOUR is specified as task scenarios in the stories this milestone will break
down (`aof:refine 03`), NOT here. This design fixes the look/feel; the features fix what happens.
Referenced by intended name:

- **The board renders the full stream from `aof work list --json`** (milestones → stories → tasks,
  derived status, expand/collapse, select) — see the board story's `tasks/board-renders-stream.feature`.
- **Selecting an item loads its SPEC/VERIFICATION/RETROSPECTIVE + findings; tabs switch docs** — see
  the detail story's `tasks/detail-shows-records.feature`.
- **Add feedback appends to STATE `## Feedback (for retro)`** — see the actions story's
  `tasks/add-feedback.feature`.
- **Validate runs the work-stream validator and reports findings** — see the actions story's
  `tasks/validate-stream.feature`.
- **Next returns the next actionable item (ready/blocked/done) and reveals it on the board** — see the
  actions story's `tasks/next-item.feature`.
- **Run agent spawns the selected provider (claude/codex/gemini) via node-pty over WebSocket against
  the selected item; the dock streams idle→connecting→running→exited** — see the terminal story's
  `tasks/run-agent-terminal.feature` and `tasks/provider-picker.feature`.
- **Which providers are offered, and how a missing provider is reported** — a task-feature outcome,
  not design; see the terminal story's `tasks/provider-picker.feature`.
