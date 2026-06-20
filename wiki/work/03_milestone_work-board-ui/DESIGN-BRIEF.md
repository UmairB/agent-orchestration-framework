# Design Brief — the aof Work Board (visual rework)

> A self-contained brief for a designer with **no prior context**. Read top to bottom; the
> glossary at the end defines every project-specific term. Your job is the **board's visual
> language** — a more visual, card-based way to see and evaluate work items. Everything you
> need to start is here.

---

## 1. The 60-second orientation

You are designing the main screen of a **local developer tool** called **aof**. It runs on the
developer's own machine (localhost, single user — no login, no accounts, no multi-tenant anything).

aof helps a developer run a software project as a structured stream of work using a method called
**ACD**. The work is organised as a tree:

```
milestone  →  story  →  task
```

- A **milestone** is a chunk of product (e.g. "Work Board UI").
- A **story** is an independent slice of a milestone (a user story).
- A **task** is a single testable behaviour (written as a Gherkin `.feature` file).
- A special **UAT session** can sit alongside milestones as a cross-cutting acceptance gate.

Each item has a **status** that the system **derives** automatically from the project's real state
(tests passing, reviews done, dependencies met). **The user never sets status by hand.** This one
fact shapes a lot of the design (see Constraints).

The tool you're redesigning — the **Work Board** — is the screen where the developer **sees** this
whole tree, **opens** an item to read its details, **acts** on it (add a note, validate, ask "what's
next"), and **runs an AI coding agent** against it in an embedded terminal.

---

## 2. The problem we're asking you to solve

The board today renders the work tree as an **indented text outline** — rows of `ref · type ·
status-chip · title`, nested by depth. It's correct and dense, but it reads as **a wall of text**.
It's hard to size up a single work item *as a whole* at a glance, or to scan the board and feel
where the project stands.

**We want a more visual, card-based board** — where a work item is a **digestible card** you can
evaluate as a unit (its status, its progress, its shape, what needs attention), not a line of text
you have to parse.

We are **not** asking for a draggable kanban (we deliberately rejected that — see Constraints). We're
asking for a richer, more scannable, more visual representation of the same derived structure.

**Deliverable:** a redesign of the board surface (and how it composes with the rest of the screen) —
mocks + rationale. Details in §7.

---

## 3. What exists today (the current screen)

It's **one screen**, composed of four regions. The board is the left column; selecting a board item
drives the right-hand detail; an agent terminal docks across the bottom.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  [✦] AOF   Work Board                                          ◷ status legend   ⟳ sync     │  top bar
├──────────┬───────────────────────────────────────────────────────────────────────────────┤
│          │  ITEM DETAIL                                                                     │
│  BOARD   │  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  (tree)  │  │ 03/02 · story · agent-terminal        [in-review]        ▸ Run agent      │   │
│          │  │ ───────────────────────────────────────────────────────────────────────│   │
│ ▾ 00 …   │  │ [ STORY | VERIFICATION | RETROSPECTIVE | Findings(2) ]   ← doc tabs       │   │
│   00/00  │  │   <rendered doc body / findings list>                                    │   │
│ ▾ 03 …   │  │                                                                          │   │
│   03/01  │  │ ── actions ──────────────────────────────────────────────────────────── │   │
│ ▸ 04 …   │  │ [ + Add feedback ]  [ ✓ Validate ]  [ → Next ]      <result strip>        │   │
│          │  └─────────────────────────────────────────────────────────────────────────┘   │
├──────────┴───────────────────────────────────────────────────────────────────────────────┤
│  ▣ TERMINAL   provider: (•claude ○codex ○gemini)   item: 03/02   ● running    ⌃ ⌄ ✕         │  dock
│  ┌────────────────────────────────────────────────────────────────────────────────────┐   │
│  │  xterm viewport …                                                                    │   │
│  └────────────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Board (left):** the work tree as an indented outline. Each row: a disclosure caret (if it has
  children), a type glyph, a monospace `ref`, the title, and a status chip. One row is selected at a
  time; selection drives the detail panel. **← this is the region we want reimagined as cards.**
- **Item detail (right):** the selected item's identity header + a tab switcher across its
  documents (SPEC/STORY, VERIFICATION, RETROSPECTIVE, Findings), with the chosen doc rendered below.
- **Actions strip (bottom of detail):** three buttons — Add feedback, Validate, Next — whose results
  render inline.
- **Agent terminal (bottom dock):** a collapsible/resizable terminal where an AI agent (Claude
  Code / Codex / Gemini) runs against the selected item; the header has a provider picker, the target
  item's `ref`, and a connection-state indicator (idle → connecting → running → exited).

The detail panel, actions, and terminal are **working and accepted** — your rework is primarily the
**board region** and **how it composes** with them. You may propose changes to the composition if a
card board demands it, but the detail/terminal behaviours are fixed.

---

## 4. What you are visualizing — the work item

Every board item is one object with these fields (this is the literal data the board receives):

| field    | meaning                                                                 | example                         |
|----------|-------------------------------------------------------------------------|---------------------------------|
| `ref`    | stable id; milestones `NN`, stories `NN/SS`                              | `03`, `03/02`                   |
| `type`   | `milestone` · `story` · `task` · `uat`                                   | `story`                         |
| `slug`   | short kebab name                                                         | `agent-terminal`                |
| `status` | **derived** — one of 5 (below)                                           | `in-review`                     |
| `title`  | human title                                                             | `The agent terminal`            |
| `parent` | the parent item's `ref` (null at the top level — the only tree edge)     | `03`                            |
| `dir`    | where the item lives on disk (used to load its docs)                     | `…/03_milestone_work-board-ui`  |

### The 5 statuses (the status ramp)

| status        | meaning                                       |
|---------------|-----------------------------------------------|
| `not-started` | exists, no work begun — quiet/low-emphasis    |
| `in-progress` | actively being built                          |
| `in-review`   | built, under review (not yet accepted)        |
| `blocked`     | cannot proceed — needs attention              |
| `done`        | finished and accepted                         |

### "A work item as a whole" — what richer info a card could surface

A row today shows only `ref + title + status`. But behind each item there's much more you *could*
surface visually to make it evaluable at a glance:

- **Progress** — a milestone is "done" only when all its stories are done (e.g. *2 of 3 stories
  done*); a story is built when all its task `.feature`s pass. A progress ratio / bar is natural.
- **Shape** — how many stories / tasks it contains; whether it has design, architecture, research
  docs; whether it has open **findings** (defects/gaps logged during verification).
- **Dependencies** — milestones/UAT gates can depend on others; a blocked item is *waiting on* a
  specific other item.
- **Type** — milestone vs story vs task vs UAT-gate read very differently and could look different.
- **Records** — each item carries documents (objective/spec, verification results, retrospective,
  findings). The detail panel shows these; a card might preview their presence/health.

You don't have to show all of this — part of the design problem is choosing **what makes an item
evaluable at a glance** and what stays in the detail panel.

### Real example content (the actual current stream — design against this)

```
00  milestone  done         Work CLI                         (3/3 stories done)
01  milestone  done         ACD Asset Bundle + work init      (3/3 done)
02  milestone  done         Planning Init                     (3/3 done)
03  milestone  in-progress  Work Board UI                     (3 stories in-review)  ← you are here
04  milestone  not-started  Round-trip Proof                  (no stories yet)
05  milestone  done         Work Memory                       (4/4 done)
   05/00 story done   Memory seam — verbs + backend selection
   05/01 story done   Local backend — source parsers → derived index
   05/02 story done   Local backend — recall/brief ranking + scope filters
   05/03 story done   Memory hooks — recall at decision points, ingest at Accept
```

A real board has a handful of milestones, each with a few stories, each with a few tasks — tens of
items, not hundreds. Density matters but it is not a 10,000-row problem.

---

## 5. Who uses it & the feeling to hit

- **User:** one developer/operator running aof on their own machine. Technical, comfortable with
  monospace, refs, and logs. Wants a **calm workbench / IDE**, not a project-management SaaS.
- **Feeling:** dense but calm, keyboard-reachable, one window, no marketing chrome. Monospace where
  identity/refs/logs appear. Because it's localhost single-user there is **no auth, no account menu,
  no tenant switcher** — keep that surface off the screen.

---

## 6. Hard constraints (the rails — please design within these)

1. **Status is DERIVED — never user-set.** No dragging cards between status columns to change state;
   no "mark as done" control. The board *reflects* status, it never *edits* it. (A classic kanban's
   core gesture is forbidden. A status-grouped *read-only* layout is fine; a draggable one is not.)
2. **One screen, single-user, localhost.** No routing/pages, no login, no account/tenant UI.
3. **Reuse the existing design system — introduce NO new one.** Build with what's already in the
   codebase (see §8). Same colours, same component primitives, same fonts. You may compose them
   in new ways; don't invent a parallel kit or a new palette.
4. **The board composes with the detail panel + the agent terminal.** Selecting a board item still
   drives a detail view and is the target for "Run agent." If your card model changes the
   composition (e.g. detail becomes an expanded card, or a card opens an overlay), say so explicitly
   — but the detail content and the terminal dock must remain reachable.
5. **Hierarchy must remain legible.** milestone → story → task is the spine of the data; whatever the
   visual (cards, groups, nested cards, expandable cards), the parent/child relationship has to read.

---

## 7. What's open (your canvas) & what to deliver

**Open questions for you to answer with the design:**

- What is a **card**? One per work item? Per milestone with stories inside? What does a card surface
  at a glance (status, progress, type, counts, findings, the title) and what stays in detail?
- The **board layout**: a grid of cards? swimlanes by milestone? status-grouped columns (read-only)?
  expandable milestone cards that reveal story cards? Something else?
- How **selection / detail / terminal** coexist with cards (inline expand vs side panel vs overlay).
- How **progress** and **needs-attention** (blocked, open findings) are visualised so the board is
  scannable at a glance.
- The board's **empty / loading / error** states.

**Deliverables:**

- Mocks for the **board** (populated) + the **card** (its anatomy and its per-status variants).
- The **status ramp** treatment (how the 5 statuses read — by colour, label, glyph, shape).
- How the board **composes** with the detail panel + terminal dock (a full-screen mock, even rough).
- The **empty / loading / error** states.
- A short rationale: what a card surfaces and why, and how hierarchy + derived-status are honoured.

Rough is fine (ASCII, Figma, Excalidraw, hand sketch). We'll iterate.

---

## 8. The design system you must work within

This is a **React 19 + Tailwind CSS 4** app using a small **shadcn-style** component kit that already
exists in the codebase. Use these; don't add a new framework.

**Theme ramp (fixed):**
- `primary` = **teal** · `accent` = **crimson** · `secondary` / `muted` = **neutral grey** ·
  `destructive` = **red**
- corner radius `--radius` = `0.5rem`
- Body font **Inter**; a `.mono` utility for monospace (used for refs/ids/logs)
- There is a light shell; the terminal viewport is the one intentionally **dark** surface.

**Available component primitives** (`ui/src/components/ui/`):
`badge` (only 3 variants: `default`/teal, `secondary`/grey, `destructive`/red), `button`, `card`,
`input`, `label`, `scroll-area`, `textarea`. Icons: **lucide-react**. A drag library (**dnd-kit**) is
available **for layout only** (pane/card resize, never to change status).

> Note on the badge: because it has only 3 colour variants, the current design maps 5 statuses onto
> them by *meaning* (done=teal, blocked=red, the three "active/pending" share grey, disambiguated by
> label + icon). If your card model wants richer status visuals (rings, bars, shapes), that's welcome
> — just build it from the existing tokens/components, not a new palette.

---

## 9. Glossary

- **aof** — the local developer tool you're designing for.
- **ACD** — the working method aof implements: work as a derived, contract-driven stream.
- **work stream** — the whole tree of items (milestones → stories → tasks, plus UAT gates).
- **milestone** — a chunk of product; contains stories.
- **story** — an independent slice of a milestone (a user story); contains tasks.
- **task** — a single testable behaviour, written as a Gherkin `.feature` file.
- **UAT session / gate** — a cross-cutting human-acceptance checkpoint that can sit alongside
  milestones and block what depends on it.
- **derived status** — status computed from real project state (tests/reviews/deps), not set by hand.
- **ref** — an item's stable id (`03`, `03/02`).
- **finding** — a defect or gap logged against an item during verification (some block acceptance).
- **record docs** — the markdown each item carries (objective/spec, verification, retrospective,
  findings) — shown in the detail panel; a card could hint at their presence/health.
- **agent terminal** — an embedded terminal that runs an AI coding agent (Claude Code / Codex /
  Gemini) against the selected item.

---

*Source of truth for the current design intent (deeper detail, if useful):
`wiki/work/03_milestone_work-board-ui/DESIGN.md`. The product scope:
`…/SPEC.md`. This brief is the orientation; that DESIGN.md is the current (pre-rework) spec.*
