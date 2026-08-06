---
doc: design
---
<!--
  Milestone DESIGN.md — how should it look and feel, and why.
  Owner: designer. Layout / component / visual intent only.
  UI BEHAVIOUR (what happens when you click) lives in task .feature files — cross-referenced below,
  not specified here.
-->
# 45 · UI app shell & path routing — Design

## Intent

This milestone has **one new visual surface** — the **app shell**, the chrome the four routed surfaces
mount inside — plus the **`/` landing placeholder** that occupies the shell's content region until
milestone 49 replaces it with the terminals grid.

The routed surfaces themselves are **out of scope visually**. `<Fleet>`, `<Board>` and the config editor
`<App>` render exactly as they do today, inside the shell. **This document designs the frame, not the
pictures in it.**

The experience to create is **one application where there were three pages**. The SPEC's success
condition is blunt and it is also the design brief: *"an outsider cannot tell what changed except that
the address bar now means something and the three pages know about each other."* Two things follow, and
they are the whole design:

1. **The shell adds navigation and takes nothing away.** The only thing an operator gains is the ability
   to move between surfaces and to see which one they are on. Everything else on screen stays where it
   is, at the size it is, in the colour it is.
2. **The shell owns the frame; each surface keeps its own semantics.** The shell knows about *routes*.
   It does not know what a scope is, what a repo filter is, what a work item is, or what a terminal is.
   The moment it does, every surface's vocabulary has to be re-litigated in shell chrome — and milestones
   46, 47 and 49 all queue behind it.

The surface introduces **no new design system and no new token**. It is built from the fixed theme ramp
at [ui/src/index.css:3-25](../../../ui/src/index.css#L3) (`primary` teal `hsl(174 72% 27%)`, `accent`
crimson, `destructive` red, `card`/`muted`/`secondary`/`border` greys, `--radius: 0.5rem`, Inter plus the
`.mono` utility at [:68-72](../../../ui/src/index.css#L68)) and from primitives that already exist in the
built board and fleet. It adds **zero new vocabularies**; every mark below is an existing one reused at a
new scale.

**Four binding rails:**

- **The shell never asserts a surface's meaning.** Chrome that renders a fleet control on the board — or
  a board legend on the config editor — is a lie the operator has to unlearn. Surfaces contribute their
  own controls into a named slot; the shell does not author them.
- **Nothing in the shell moves as you navigate.** Everything left of the surface slot — mark, wordmark,
  identity chip, nav — is byte-identical on every route, at every load state. This is the m43
  documented-default-3 rule ("the chip keeps its right-edge anchor so nothing moves at the threshold")
  applied to a bar instead of a row.
- **The address bar is the truth and is never rewritten behind the operator's back.** An unmatched path
  renders an in-shell not-found at the path they typed; it does not silently redirect. A milestone whose
  point is that URLs mean something cannot start by making one mean nothing.
- **Colour is never the only signal — including for "you are here".** The active nav item is marked by a
  rule (shape), a weight, and `aria-current`; colour is emphasis on top of three signals, not one of
  them.

---

## Conformance source of truth

> **The committed mock is `mocks/app-shell.png` — status: PENDING, operator-supplied.** The operator has
> stated a mock for the app shell will be supplied; it has **not landed yet**. When it lands it goes at
> [`mocks/app-shell.png`](mocks/app-shell.png), relative to this document, as a **committed,
> locally-readable artifact**.
>
> **Until it lands, the binding checklists in this document are the conformance baseline** — mandatory,
> and the thing a design-conformance review judges the built surface against, so a review that runs
> before the mock arrives has a baseline to judge and does not have to return `INCONCLUSIVE`.
>
> **When the committed mock lands, it supersedes these checklists wherever the two differ.** The mock is
> the visual source of truth; the checklist is what makes it *checkable* region by region. Where the mock
> is silent, the checklist still binds. Where they conflict, the mock wins and **this document is amended
> in the same change** — a checklist left contradicting a committed mock is a defect, not a nuance.
>
> **A remote design-tool link is never an acceptable substitute for the committed file.** Not
> `claude.ai/design`, not Figma, not a screenshot in a chat. The design-conformance reviewer is
> **read-only** and cannot open one — a baseline it cannot `Read` is not a baseline (07/ADR-003; the m03
> lesson; the same rule stated at
> [36/mocks/README.md:3-5](../36_milestone_mesh-desktop-app/mocks/README.md#L3)).

| Surface | Committed mock | Status | Interim baseline |
|---|---|---|---|
| **1 — the app shell** | `mocks/app-shell.png` | **PENDING (operator-supplied)** | §Surface 1's binding checklist |
| **2 — the `/` landing placeholder** | `mocks/app-shell.png` (the content region as drawn) | **PENDING (operator-supplied)** | §Surface 2's binding checklist |
| `<Fleet>` inside the shell | [25/mocks/](../25_milestone_mesh-ui/mocks/) — unchanged | committed | not re-baselined here |
| `<Board>` inside the shell | [21/mocks/](../21_milestone_board-run-observability/mocks/), 03's `Work Board.dc.html` — unchanged | committed | not re-baselined here |
| config editor `<App>` inside the shell | none, and none is needed — its views are untouched (SPEC "Out of scope") | n/a | n/a |

**Do not create `mocks/` with a placeholder image.** An empty or stand-in PNG is worse than an absent
one: a reviewer cannot tell it apart from a real baseline. The directory appears when the real file does.

---

## Render breakpoints and render targets

Three widths, plus one height constraint that is as binding as any of them.

- **1280** — the primary judgement width (desktop workbench; the board's fixed ~382px detail column
  assumes it, `03/DESIGN.md` §2).
- **768** — the desktop-app proxy. The Rust app's own window is **760×520**
  ([app/desktop/ui/styles.css:50](../../../app/desktop/ui/styles.css#L50)) and it opens this UI at
  `http://127.0.0.1:4181/?mode=fleet&scope=global`
  ([supervisor.rs:44](../../../app/desktop/crates/app/src/supervisor.rs#L44)). **The shell must not assume
  a wide viewport.**
- **390** — mobile. The fleet's existing width findings (DESIGN GAP D1,
  [index.css:30-36](../../../ui/src/index.css#L30)) were measured at 360–414px and the shell's bar must
  survive that squeeze without the page root growing a horizontal scrollbar.
- **520 tall (binding).** At the desktop window's height, **the shell's steady-state chrome must never
  exceed 88px** — 48px top bar plus at most one 40px surface bar — leaving ≥432px for content. **A third
  *bar* is a GAP, not a variant.** The notice rail is not a bar and is governed by the clause below.

### The chrome budget is a STEADY-STATE budget — and the notice rail is exempt, additive and bounded

*(Amended 2026-08-06, from QA's budget Outline row 5 in*
[`stories/03_story_app-shell-and-entry/tasks/01_shell-regions.feature`](stories/03_story_app-shell-and-entry/tasks/01_shell-regions.feature)*.
The original clause said "a third chrome **row** is a GAP" while also requiring the notice rail to push
rather than overlay — two rules that collide exactly when a board's server is gone. The defect was the
word "row"; the rule was always about **bars**.)*

**The 88px cap counts the two BARS only.** The notice rail is **not a bar**: it is a transient,
surface-contributed alert row, and it was designed from the start to push rather than overlay.

**Four clauses, and they are the settled answer:**

1. **The rail is exempt from the cap and additive to it.** While a notice stands, chrome = rail + bars,
   and the content region takes the dip. `--aof-shell-chrome-height` grows by the rail's **measured**
   height, so every surface sizing against it stays correct; only the budget *verdict* changes.
2. **The breach is REPORTED, never absorbed.** The layout model publishes a budget verdict an outsider can
   read. Forbidden: reserving a blank band against the rail; clamping the content region to preserve 432;
   letting a bar scroll away to make room.
3. **NOTHING yields to the rail** — not the surface bar, not the surface slot, not the nav. This is the
   m38 DG-20 lesson: an element that disappears only when a condition happens to be true makes **its own
   absence a second, accidental signal for that condition**. A scope control that vanished exactly when a
   server was gone would be a covert state indicator, which is strictly worse than a short page.
4. **The exemption is bounded, so it cannot run away.** At most **one** notice at a time, and the rail may
   never exceed **25% of the viewport height** (130px at 520 tall). Past that it scrolls **inside itself**
   (`overflow-y-auto`) with its first line pinned — the clause that says *what is wrong* stays visible.
   That is "clamp" applied to the pathological case only, **never** to the ordinary strip: truncating the
   sentence an alert exists to speak is forbidden, and clipped `role="alert"` content is an accessibility
   defect besides.

**Why the dip is the right thing to accept, rather than the thing to engineer away.** The rail's only
occupant today is the board's `serverGone` strip
([Board.tsx:410-421](../../../ui/src/board/Board.tsx#L410)), whose own text says *"Buttons on this tab do
nothing."* The surface underneath is already inert. The budget exists so an operator can still **see and
act on** ≥432px of their work; while the rail is up there is no work to act on, so defending that number
would be optimising the wrong thing — and every alternative pays for it by degrading a true signal
(clamping the message) or by turning an absence into a covert signal (yielding the slot). **An alert is
supposed to cost something.** The cost is bounded, it is transient, and it ends the moment the condition
clears — at which point the rail returns to exactly 0 and the verdict returns to *within*.

**The numbers the render must check.** The rail's height is content-driven and **measured**, never
assumed; the figures below are estimates from the strip's own `px-4 py-2 text-xs` ramp and its ~145
character sentence, and **the render is what confirms them**:

| Viewport | Strip wraps to | Rail ≈ | Chrome ≈ | Content ≈ | Verdict |
|---|---|---|---|---|---|
| 1280 × 520 | 1 line | 33px | 81px | 439px | within |
| **768 × 520** (the desktop window) | **~2 lines** | **~48px** | **~136px** | **~384px** | **breach — reported** |
| **390 × 520** | **~3 lines** | **~64px** | **~152px** | **~368px** | **breach — reported** |

QA's Outline models the breach at a 33px rail — the **one-line** case, which is the 1280 measurement.
**The realistic worst case at 768 and 390 is larger, because the sentence wraps**, and the render review
must judge the wrapped case and not only the one-line one. Neither exceeds the 25% bound, which is what
the bound exists for.

**Render targets** (the orchestration renders these and hands the reviewer the screenshots; the reviewer
does not run the browser):

- Fleet origin, fixed port: `http://127.0.0.1:4181/` (the landing) and `/fleet` (and `/fleet?scope=local`).
- Board origin: an **ephemeral** per-workspace port that changes on every daemon restart
  ([Board.tsx:47-51](../../../ui/src/board/Board.tsx#L47)) — the base URL must be supplied at capture
  time and never hard-coded.
- Config-editor origin: the `setup-ui` server's path for `<App>`.
- The unmatched path (any origin), e.g. `/nope`.
- **The board origin with `serverGone` standing**, at 768 and 390, so the rail's wrapped height and the
  reported breach are judged rather than modelled.

---

## The constraint this design is written against

Read before specifying anything. Everything in the right column was measured on 2026-08-06 and bounds
what the shell may do.

| Fact | Where it lives today | Consequence for this design |
|---|---|---|
| Four entry points selected by `?mode=` at the render root: `fleet`→`<Fleet>`, `board`→`<Board>`, `assets`→`<App>`, no-mode→`<App>` | [main.tsx:1261-1267](../../../ui/src/main.tsx#L1261) | There is **no shell, no router, no nav** to extend. All of it is new. |
| **No router library is installed** | [ui/package.json:11-32](../../../ui/package.json#L11) | The route table is the architect's; this document fixes the *regions*, not the paths. |
| `?scope=global\|local` is a live deep-link contract with a visible control | [fleet/scope.mjs:24-54](../../../ui/src/fleet/scope.mjs#L24), rendered at [Fleet.tsx:323-343](../../../ui/src/fleet/Fleet.tsx#L323); consumed by the desktop entry URL ([supervisor.rs:44](../../../app/desktop/crates/app/src/supervisor.rs#L44)) | It stays a **query param on `/fleet`**, never a path segment — see §The scope-control ruling. |
| The config editor carries **its own** `project \| global` two-way toggle, in the identical active treatment (`bg-primary text-primary-foreground`) | [main.tsx:245-256](../../../ui/src/main.tsx#L245) | A shell-level `Global \| Local` toggle would sit ~300px from a differently-meaning `project \| global` toggle. Decisive. |
| The fleet top bar is `sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4` | [Fleet.tsx:281](../../../ui/src/fleet/Fleet.tsx#L281) | This **is** the shell's top bar. It is not redesigned; it is promoted. |
| The board top bar is the same 48px bar **without** `sticky` | [Board.tsx:423](../../../ui/src/board/Board.tsx#L423) | Same bar, different scroll model — see the two content modes. |
| **Two different brand marks**: fleet paints a filled 24px tile (`grid h-6 w-6 rounded-md bg-primary text-primary-foreground ✦`), the board paints a bare `text-lg text-primary ✦` | [Fleet.tsx:283-285](../../../ui/src/fleet/Fleet.tsx#L283) vs [Board.tsx:425-427](../../../ui/src/board/Board.tsx#L425) | **Design gap DG-45-1** — one product, one mark. Resolved below. |
| **Two scroll models**: fleet is `min-h-screen flex-col` (page scrolls); board is `h-screen overflow-hidden` with descendants owning scroll | [Fleet.tsx:208](../../../ui/src/fleet/Fleet.tsx#L208) vs [Board.tsx:409](../../../ui/src/board/Board.tsx#L409), [:463](../../../ui/src/board/Board.tsx#L463) | The shell must offer **both**, named and declared per route. This is the m46 contract. |
| `z-50` is currently shared by three unrelated things: the board dispatch toast, the milestone-switcher listbox, and the fleet fullscreen terminal overlay | [Board.tsx:528](../../../ui/src/board/Board.tsx#L528), [BoardLanes.tsx:373](../../../ui/src/board/BoardLanes.tsx#L373), [FleetTerminalView.tsx:412](../../../ui/src/fleet/terminal-view/FleetTerminalView.tsx#L412) | **Design gap DG-45-2** — once a surface can go fullscreen inside a shell, a toast on the same rung paints unpredictably. The shell owns the ladder. |
| A fullscreen escape **already exists**: `createPortal` → `fixed inset-0 z-50 flex flex-col`, `role="dialog" aria-modal="true"`, exit control at `ml-auto` | [FleetTerminalView.tsx:402-424](../../../ui/src/fleet/terminal-view/FleetTerminalView.tsx#L402) | m46 inherits this idiom rather than inventing one. The shell formalises it as a named slot. |
| The board's `serverGone` strip is full-bleed and sits **above** the top bar | [Board.tsx:410-421](../../../ui/src/board/Board.tsx#L410) | The shell needs a notice rail above the bar, or the strip ends up sandwiched — and that rail is what the chrome-budget clause above governs. |
| The board hard-codes `http://127.0.0.1:4181/?mode=fleet` in that strip and in two DetailPanel links | [Board.tsx:416](../../../ui/src/board/Board.tsx#L416), [DetailPanel.tsx:212](../../../ui/src/board/DetailPanel.tsx#L212), [:798](../../../ui/src/board/DetailPanel.tsx#L798) | Cross-**origin** links are real here. The nav is not four in-app links. |
| `useGroupName()` = `?group=` else the literal `"fleet"` | [Fleet.tsx:1519-1527](../../../ui/src/fleet/Fleet.tsx#L1519) | The identity chip has a documented neutral default already. Keep it; never render a blank chip. |
| The page root is clamped `overflow-x: hidden` as a deliberate backstop (DESIGN GAP D1) | [index.css:27-36](../../../ui/src/index.css#L27) | The shell **must not remove it**. Scoped regions still scroll internally. |
| `StaleBadge.tsx` / `freshness.mjs` are shared by **both** `Board.tsx` and `Fleet.tsx` | [ui/src/board/StaleBadge.tsx](../../../ui/src/board/StaleBadge.tsx), [freshness.mjs](../../../ui/src/board/freshness.mjs) | Shared visual language across surfaces already exists and works. The shell reuses the ramp; it does not fork one. |
| The a11y lane is **opt-in and currently off** (`work.tags.domains` carries no `a11y`), but the a11y contract is test-enforced anyway | [test/arch/acd-a11y-config-schema.test.mjs:1-8](../../../test/arch/acd-a11y-config-schema.test.mjs#L1), [test/board-staleness-a11y.test.mjs:10-26](../../../test/board-staleness-a11y.test.mjs#L10) | §Accessibility below binds the design-conformance review and a `@uat` visual review regardless. |

**This design asks for no new data.** Everything the shell renders — the route table, the active route,
the origin's identity name — is already available or is the router's own state.

---

## The two design gaps this milestone closes

Both resolve as rules in this document plus a `@uat` visual-review scenario, not as a code patch alone.

### DG-45-1 — one product, one brand mark

The fleet and the board paint different `✦` marks in the same bar position (table above). The shell paints
**one**: the **fleet's filled 24px tile** —
`grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground`
with `✦` and `aria-hidden="true"` ([Fleet.tsx:283-285](../../../ui/src/fleet/Fleet.tsx#L283)).

Why that one: it is a **fixed 24px box**, so it survives the 390 squeeze without a type-size decision; it
is the mark the committed m36 desktop mocks and the m25 fleet surface both already read as "aof"; and a
bare glyph at `text-lg` changes optical size with the bar's type ramp, which a mark must not.

**Consequence, recorded so a reviewer does not log it as a regression:** the board's bar **gains** a
filled mark it did not have.

### DG-45-2 — the z-index ladder

`z-50` is currently three different things (table above). Under a shell that can put a surface fullscreen,
that is unpredictable paint order. **The shell owns the ladder, and every surface uses these rungs and no
others:**

| Rung | `z` | What sits here |
|---|---|---|
| content | auto | the mounted surface |
| **sticky chrome** | `z-10` | notice rail, top bar, surface bar, and in-surface sticky headers ([BoardLanes.tsx:181](../../../ui/src/board/BoardLanes.tsx#L181)) |
| **popover** | `z-20` | legends ([Fleet.tsx:360](../../../ui/src/fleet/Fleet.tsx#L360)), the nav disclosure, the milestone switcher |
| **dock** | `z-30` | reserved for the unified terminal control in its in-flow/docked position (m46) |
| **toast** | `z-40` | dispatch notices ([Board.tsx:528](../../../ui/src/board/Board.tsx#L528)), the config editor's message ([main.tsx:318](../../../ui/src/main.tsx#L318)) |
| **fullscreen** | `z-50` | the `shell:fullscreen` occupant — **the top rung, alone** |

An element that needs a rung not on this list is a GAP whose fix is to add the rung *here* first.

---

## The scope-control ruling — it stays inside `<Fleet>`

**Decision: `?scope=` and its `Global | Local` control remain owned by `<Fleet>`. The shell does not own
scope semantics — but it does own the *bar the control renders in*.**

The shell exposes one named region, the **surface slot**: a right-anchored (`ml-auto`) area of the top bar
into which the mounted surface contributes its own controls, in its own order. On `/fleet` that slot holds
today's `[Global | Local]` segmented control, then `◷ legend`, then the `⟳ refreshed Ns ago` button — so
the rendered fleet bar is the bar that ships today, plus the nav. On the board it holds `◷ status legend`
then `⟳ sync`. On the config editor and on `/` it is **empty**.

**Four reasons, each measured:**

1. **`?scope=` is a fleet contract end to end.** Server-side (`mesh-ui-serve` serves both scopes),
   client-side ([scope.mjs](../../../ui/src/fleet/scope.mjs)), and in the desktop app's entry URL
   ([supervisor.rs:44](../../../app/desktop/crates/app/src/supervisor.rs#L44)). Nothing on the board or the
   config editor reads it. A shell-owned control is therefore inert on **three of four** routes: either
   rendered-and-meaningless (a lie), or conditionally hidden (chrome that moves as you navigate — the exact
   thing binding rail 2 forbids).
2. **"Scope" is already taken on the config editor, meaning something else.** `<App>`'s sidebar carries a
   `project | global` two-way toggle in the *identical* active treatment
   ([main.tsx:245-256](../../../ui/src/main.tsx#L245)). A shell bar showing `Global | Local` directly above
   a sidebar showing `project | global` puts two identically-styled toggles, both called scope, both
   containing the word "global", within ~300px of each other. That is an operator misreading waiting to
   happen, not a nit.
3. **Milestone 47 puts the repo filter *beside* scope**, applied to every fleet region
   ([47/SPEC.md:46-49](../47_milestone_fleet-repo-filter/SPEC.md#L46)). Filters belong with the thing they
   filter. Hoisting them makes the shell grow a fleet-shaped API, and 47 then has to negotiate with 45's
   chrome to ship.
4. **The slot delivers the actual benefit of "put it in the top bar" — one 48px bar, not two — without the
   ownership cost.** And an outsider sees the fleet bar they already know, which is the milestone's own
   success condition.

**Consequences, stated plainly (this is what the ruling costs):**

- **The shell's top bar is deliberately non-uniform to the right of the slot and byte-identical to its
  left.** Bounded by two rules: (a) everything **left of** the slot is byte-identical on every route and
  never moves; (b) the slot is right-anchored, so its contents grow **leftward** and can never push the
  nav.
- **`?scope=` stays a query parameter, never a path segment** — `/fleet?scope=local`, not `/fleet/local`.
  It is a view filter on one surface, it must compose with m47's filter, and the SPEC's back-compat
  requirement ("the router carries it through untouched") is only expressible if it stays a param.
- **The `/fleet` nav item must carry the current `?scope=` when `/fleet` is the active route, and must not
  invent one when it is not.** That behaviour is a task scenario, not a design spec — cross-referenced
  below.
- **Milestone 47 inherits a slot, not a negotiation.** Its repo filter lands beside the scope control
  inside `<Fleet>`'s own contribution, with no change to this document.

---

## The shell's layout primitives — the contract milestone 46 depends on

[46/SPEC.md:108-110](../46_milestone_terminal-control-unification/SPEC.md#L108) says the unified terminal
control's "resize, fullscreen and viewport-responsive behaviour sit inside the shell's layout primitives".
These are those primitives. They are **named**, and a surface **declares** which it uses.

### 1 — `--aof-shell-chrome-height`

A CSS custom property the shell sets to the **measured** height of everything above the content region
(notice rail + top bar + surface bar). A height-constrained surface sizes itself
`calc(100dvh - var(--aof-shell-chrome-height))`.

- **A variable, not the constant 48.** The notice rail and the surface bar are both conditional, so `48px`
  is wrong in most combinations — and wrong by exactly the amount that makes a fitted terminal overflow.
- **`dvh`, not `vh`.** A mobile browser's collapsing URL bar changes the viewport; a terminal sized to `vh`
  overflows the moment it does.
- **It tracks the notice rail too.** When the rail is standing the variable grows by its measured height,
  so a terminal stays correctly sized straight through the breach the budget clause reports. The variable
  is the truth; the budget verdict is the commentary on it.

### 2 — Two content modes, declared per route

| Mode | Root | Content region | Who owns scroll | Used by |
|---|---|---|---|---|
| **`content:page`** | `min-h-dvh flex flex-col` | `flex-1` | the **page** (`html`/`body`) | `/` landing, `/fleet`, config editor |
| **`content:fixed`** | `h-dvh overflow-hidden flex flex-col` | `min-h-0 flex-1 overflow-hidden` | **descendants only** — never the region itself | the board, and (m49) the terminals grid |

`content:page` is what the fleet does today ([Fleet.tsx:208](../../../ui/src/fleet/Fleet.tsx#L208));
`content:fixed` is what the board does today ([Board.tsx:409](../../../ui/src/board/Board.tsx#L409),
[:463](../../../ui/src/board/Board.tsx#L463)). Neither is redesigned — both are named so the shell can host
both without either surface changing.

**Binding: a surface that hosts a terminal must be `content:fixed`.** A fitted xterm inside a page-scrolling
column has no stable height to fit to. This is the constraint behind m46's fit-vs-scale split.

**Scroll ownership is declared, never emergent.** Exactly one element owns scroll per axis per region, and
the checklist below names it. The page root keeps `overflow-x: hidden`
([index.css:27-36](../../../ui/src/index.css#L27)) — the shell must not remove D1's backstop.

### 3 — `shell:fullscreen` — how a surface escapes

One named portal target rendered at the document root. The contract:

- **The occupant is the existing idiom, verbatim**: `fixed inset-0 flex flex-col`, `role="dialog"`,
  `aria-modal="true"`, an `aria-label` naming the session, and an exit control at `ml-auto` in its own
  header ([FleetTerminalView.tsx:409-424](../../../ui/src/fleet/terminal-view/FleetTerminalView.tsx#L409)).
  m46 inherits it; it does not invent one.
- **The chrome is hidden, not overlaid.** Fullscreen means the top bar is *gone* — and so is the notice
  rail. A translucent overlay would put a light-theme bar behind a dark terminal.
- **Exactly one occupant at a time.** A second request replaces the first; occupants never stack.
- **Exit is `Esc` AND a visible control**, and that control sits at the same `ml-auto` position as the
  enter control, so the eye does not have to search for the way out.
- **Fullscreen is NOT a route.** It is a transient view state — a property of one control *instance*. It
  gets no path and no query param, it adds no history entry, and Back is never the way out. The address
  bar means "which surface", and only that.
- **Focus is trapped while fullscreen and returns to the enter control on exit** — the obligation the
  existing overlay's `aria-modal="true"` already claims.
- **The z rung is `z-50`, from the shell's ladder, and it is alone there** (DG-45-2).

---

## The navigation model

### Form — underline tabs, because that vocabulary is already this product's answer to this question

The nav is a horizontal row of **real `<a href>` links** inside `<nav aria-label="Surfaces">`, sitting in
the top bar after the identity chip, left of the surface slot.

The active marking reuses the **doc-tab idiom already in the product**
([DetailPanel.tsx:325-327](../../../ui/src/board/DetailPanel.tsx#L325)):

| State | Treatment |
|---|---|
| **active** | `border-b-2 border-primary text-primary font-semibold`, `aria-current="page"` |
| **inactive, available** | `border-b-2 border-transparent text-muted-foreground font-medium hover:text-foreground` |
| **inactive, unavailable from this origin** | `border-b-2 border-dashed border-muted-foreground/40 text-muted-foreground/60`, `aria-disabled="true"`, `title` naming what to run |

Each item is `-mb-px` so its rule sits flush on the bar's own `border-b border-border`, and each item fills
the bar's full height (a 48px hit target, not a padded text run).

**Why this and not the segmented pill.** The product already speaks both vocabularies and they mean
different things. A `bg-primary text-primary-foreground` segment means **"pick one filter value"** — that
is the fleet's scope control ([Fleet.tsx:332-336](../../../ui/src/fleet/Fleet.tsx#L332)) and the config
editor's project/global toggle ([main.tsx:251](../../../ui/src/main.tsx#L251)). An underline tab means
**"which of these sibling views am I looking at"** — exactly the nav's question, one level up. Reusing the
tab keeps the two vocabularies distinct; reusing the pill would put three teal-filled blocks in one 48px
bar (brand mark, active nav item, active scope segment) and make "you are here" compete with "you are
filtered to".

**Why real links, not buttons.** Middle-click, Ctrl-click and "copy link address" must work. A `<button>`
that calls `pushState` breaks all three — and the entire milestone exists so that the address is worth
copying.

### Which items, and in what order

The nav renders **one item per routed surface in the architect's route table, in that table's declared
order**. `ARCHITECTURE.md` did not exist in this folder when this document was authored (checked
2026-08-06), so this design deliberately fixes only what is stable under any table:

- **Item shape, active marking and yield order** — above and below.
- **The bar is designed for four items.** Five or more, or a label over **10 characters**, is a GAP whose
  fix is a shorter label or a table change — never a truncated nav label.
- **Provisional labels, to be replaced by the table's own names:** `Terminals` (`/`), `Fleet` (`/fleet`),
  `Board`, `Config`.

### Cross-origin honesty — the nav is not four in-app links

The four surfaces do **not** share one origin. `/` and `/fleet` are the fixed `:4181` fleet server; the
board is a per-workspace server on an **ephemeral** port; the config editor is the `setup-ui` origin. Some
nav items are therefore genuine cross-origin navigations, and some destinations are **not resolvable from
the origin you are on**.

- **An item that leaves the origin renders identically to one that does not.** Same shape, same marking.
  Port topology is not the operator's problem.
- **An item whose destination cannot be resolved from this origin must not render as a live link.** It
  takes the established honest-locality form the fleet already ships for peer boards
  ([Fleet.tsx:1381-1419](../../../ui/src/fleet/Fleet.tsx#L1381)): visibly present, marked unavailable,
  carrying in `title` what to run to get it (`aof work ui`) — **never a dead `href` that dead-ends here.**
- **It keeps its slot.** The nav must not reflow when a board appears or disappears.
- **The unavailable signal is not colour.** It is the **dashed** bottom rule — already this product's
  "not-yet / absent / degraded" primitive (the `not-started` ring at
  [status.tsx:121](../../../ui/src/board/status.tsx#L121), the no-presence dot at
  [Fleet.tsx:1096](../../../ui/src/fleet/Fleet.tsx#L1096), every dashed placeholder) — plus
  `aria-disabled="true"` plus the `title`.

### Responsive form — pinned by breakpoint, in whole discrete drops

The bar's width **is** the viewport width, so keying its form to the viewport is honest here. *(This is
the case m43's "the form is chosen by the SURFACE, not the viewport" rule explicitly is not: that rule
applies to a card in an `auto-fill` grid, whose width is viewport-invariant. A full-width bar is the
opposite case, and stating the distinction is the point.)*

| Width | Top bar (48px) | Surface bar (40px) | Steady-state chrome |
|---|---|---|---|
| **1280** | mark · `aof` · chip · divider · **nav, full labels** · `ml-auto` **surface slot** | absent | **48px** |
| **768** | mark · `aof` · chip · divider · **nav, full labels** | **present** — holds the surface slot | **88px** |
| **390** | mark · `aof` · chip · divider · **nav disclosure** (`<active label> ▾`) | **present** — holds the surface slot, wrapping within itself | **88px** |

The 390 disclosure is the **existing milestone-switcher trigger shape**
([BoardLanes.tsx:361-367](../../../ui/src/board/BoardLanes.tsx#L361)):
`flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-sm font-medium`
with a muted `▾`, `aria-haspopup="menu"`, `aria-expanded`. Its label is the **active surface's name**, so
"you are here" survives the collapse.

**Never, at any width:** a truncated nav label; a hidden active item; two rows of nav; a
horizontally-scrolling nav (the operator cannot see that there is more). Each is a GAP, and each is fixed
by taking the next whole drop in this table — not by a shrink factor. **And nothing in this table yields
to the notice rail** (§The chrome budget, clause 3).

---

## Surfaces

### 1 — The app shell (every route)

- **Committed mock:** [`mocks/app-shell.png`](mocks/app-shell.png) — **PENDING, operator-supplied.** Until
  it lands, the checklist below is the baseline; when it lands it supersedes the checklist wherever the two
  differ.

The shell is five regions. Four of them are chrome and one is the hole the surfaces mount in.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⚠ notice rail — full-bleed, conditional, zero-height when empty              │  R1
├──────────────────────────────────────────────────────────────────────────────┤
│ [✦] aof  ⟨group⟩ │ Terminals  Fleet  Board  Config │  [Global|Local] ◷ ⟳ 4s   │  R2 (48px)
│                                  ‾‾‾‾‾                    └─ surface slot ─┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ surface bar — conditional (≤768), holds the surface slot                     │  R3 (40px)
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  content region — the mounted surface. `content:page` or `content:fixed`.    │  R4
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
   overlay layer (R5): dock · toasts · shell:fullscreen — the shell's z ladder
```

**Notes on three regions that carry a real decision:**

**R1, the notice rail.** The board's `serverGone` strip ([Board.tsx:410-421](../../../ui/src/board/Board.tsx#L410))
is full-bleed and must sit **above** the chrome and push it down — the shell is the only thing that can
guarantee that. The strip renders unchanged
(`border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive`, `⚠` glyph +
sentence, `role="alert"`). The rail is **zero-height when empty** — never a reserved blank band, which
would cost every surface ~33px for a condition that is almost never true. Its height is **measured, never
assumed**; it is **exempt from and additive to** the 88px bar budget; it is bounded at one notice and 25%
of the viewport height; and **nothing yields to it** — see §The chrome budget for the full rule and the
numbers the render must check.

**R2's identity chip.** The chip is the **origin identity chip**, not strictly a group chip: it names what
the served origin can name — the group on the fleet origin (`?group=`, else the documented neutral `fleet`,
[Fleet.tsx:1519-1527](../../../ui/src/fleet/Fleet.tsx#L1519)); the workspace on a board origin; the config
name (`payload.name`, already rendered at [main.tsx:241](../../../ui/src/main.tsx#L241)) on the
config-editor origin. It renders in the existing chip form
(`mono rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground`,
[Fleet.tsx:289](../../../ui/src/fleet/Fleet.tsx#L289)) with **`min-w-[7ch] max-w-[18ch] truncate`** and the
full value in `title`. Three rules: it never renders blank (an empty chip reads as a loading state); while
the name is unknown it renders a **same-sized** `animate-pulse` block, never a collapsed chip that then
pushes the nav sideways; and it is a **label, not a control** — making it a workspace switcher is a
different milestone. The `ch` unit is honest here precisely because the chip is `mono`.

**R2's wordmark.** The bar renders **`aof` alone**. Today the fleet appends `Mesh`
([Fleet.tsx:287](../../../ui/src/fleet/Fleet.tsx#L287)) and the board appends `Work Board`
([Board.tsx:429](../../../ui/src/board/Board.tsx#L429)) — a route-varying second word. Under the shell the
**nav** names the route, so a second word would say it twice and would violate binding rail 2 by changing
as you navigate. Both words are retired from the bar. *(This is the third and last knowing visible change
to an existing surface — see below — and it is the one most likely to be overruled by the operator's mock,
since "how the brand reads" is exactly a mock's call.)*

**What visibly changes on the existing surfaces, and why each is unavoidable.** Recorded here so a
conformance reviewer can tell a designed change from a regression:

1. **The nav appears** on all four surfaces. Unavoidable — it is the milestone.
2. **One brand mark** (DG-45-1): the board's bare glyph becomes the filled tile.
3. **The wordmark loses its route word**: `Mesh` and `Work Board` are retired; the nav says it instead.

Everything else on `<Fleet>`, `<Board>` and `<App>` is untouched — same regions, same components, same
ramp, same copy.

#### Binding checklist (mandatory — this IS the baseline until `mocks/app-shell.png` lands)

**Layout regions, in order, and who owns scroll in each:**

| # | Region | Height | Scroll owner |
|---|---|---|---|
| **R1** | **Notice rail** — full-bleed, above everything, conditional | **measured** (exactly 0 when empty), capped at 25% of viewport height | none in the ordinary case — it **pushes**. Past the cap it owns its own vertical scroll and nothing else's |
| **R2** | **Top bar** | fixed **48px** (`h-12 shrink-0`) | **none** — it never scrolls out of view (`sticky top-0` in `content:page`; a fixed flex child in `content:fixed`) |
| **R3** | **Surface bar** — conditional (≤768, or a surface that declares one) | fixed **40px** | none |
| **R4** | **Content region** — the `<main>`, the one mount point | `flex-1` / `min-h-0 flex-1` | **`content:page`** → the page. **`content:fixed`** → descendants only, never the region |
| **R5** | **Overlay layer** — dock, toasts, `shell:fullscreen` | out of flow | n/a — the fullscreen occupant's own body owns its scroll |

**Components each region holds:**

- **R1** — zero or one full-bleed notice strip, contributed by the surface, `role="alert"`, `⚠` glyph +
  sentence + (optionally) one inline link. **Never more than one at a time** — that cap is load-bearing for
  the 25% bound. The sentence is never truncated; past the bound the rail scrolls inside itself with its
  first line pinned.
- **R2**, left → right, in this exact order: **skip link** (visually hidden until focused) · **brand mark**
  (filled 24px `✦` tile, `aria-hidden`) · **wordmark** `aof` (`text-sm font-bold tracking-tight`) ·
  **identity chip** (mono, min/max-width, truncating, `title`) · **divider** (`h-4 w-px bg-border`) ·
  **`<nav aria-label="Surfaces">`** (underline-tab items, or the disclosure at 390) · **`ml-auto` surface
  slot** (surface-contributed controls, empty on `/` and the config editor).
- **R3** — the surface slot only, when it has dropped out of R2. Same contents, same order, same
  components — the slot **moves**, its contents never change form. It does **not** disappear when the
  notice rail is standing.
- **R4** — exactly one mounted surface, or exactly one of the shell's three own states below.
- **R5** — at most one `shell:fullscreen` occupant; the dock; toasts. Rungs per DG-45-2.

**States — for the shell these are: no route matched / a surface still mounting / a surface that failed to
load / normal:**

- **empty ≡ NO ROUTE MATCHED.** R1–R3 render **exactly as on any other route**. R4 renders a **centred
  dashed placeholder** in the established empty language
  (`rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground`,
  [Board.tsx:458](../../../ui/src/board/Board.tsx#L458)) naming the path that did not match and pointing at
  the nav. Three binding clauses: **the URL is not rewritten** (binding rail 3); it is **not** `accent` or
  `destructive` (nothing failed — the path simply is not a surface); and **no nav item is marked active**
  (`aria-current` absent everywhere), because none is, and marking one would lie about where you are.
- **loading ≡ A SURFACE STILL MOUNTING.** The shell chrome paints **first** and does not move. Two
  sub-cases, and they must look different:
  - *the surface's code is not yet loaded* (split chunk in flight) → R4 shows the shell's own neutral mount
    placeholder: a single `animate-pulse` block in the `RegionPlaceholder` shape
    ([Fleet.tsx:1443-1450](../../../ui/src/fleet/Fleet.tsx#L1443)), `aria-busy="true"`,
    `aria-label="Loading <surface>"`;
  - *the surface is mounted and fetching its own data* → the shell shows **nothing**; the surface's own
    loading state owns R4 (the fleet's four `RegionPlaceholder`s; the board's
    `Loading work stream...` at [Board.tsx:445](../../../ui/src/board/Board.tsx#L445); the config editor's
    `Loading AOF...` at [main.tsx:223-225](../../../ui/src/main.tsx#L223)).
  - **Exactly one loading treatment on screen at a time.** The shell's is the outer one and yields the
    instant the surface mounts.
- **error ≡ A SURFACE THAT FAILED TO LOAD.** R1–R3 intact and **fully usable** — a failed surface must
  never trap the operator on it. R4 renders the page-error language the fleet already ships
  ([Fleet.tsx:1460-1481](../../../ui/src/fleet/Fleet.tsx#L1460)): the `accent` pill with its `!` mark, plus
  a `⟳ Retry`. It must be **distinguishable from a surface's own data error** — the shell's copy names the
  *surface* ("Could not load the Fleet view"), and Retry re-attempts the **mount**, not a fetch. **Never
  `destructive`**: a chunk that did not arrive is a retryable transport condition, not data loss (the m25
  stale rationale, inherited).
- **populated ≡ NORMAL.** R4 holds the mounted surface, rendering exactly as it does today. The shell adds
  no wrapper padding, no max-width and no background of its own inside R4 — every surface already sets its
  own (`px-4 py-7 sm:px-8`, `max-w-[1240px]`, [Fleet.tsx:421](../../../ui/src/fleet/Fleet.tsx#L421)).

**Design ramp each region uses** — every token named from
[ui/src/index.css:3-25](../../../ui/src/index.css#L3); **no new token, no hex, no new palette**:

| Region | Ramp |
|---|---|
| **R1 notice rail** | `destructive` at low alpha: `border-destructive/40 bg-destructive/10 text-destructive`, `text-xs`. The **only** `destructive` in the shell. |
| **R2 top bar surface** | `bg-card` (white) on the page's `bg-background` (`hsl(210 18% 96%)`), `border-b border-border` (`hsl(214 16% 78%)`), `px-4 gap-3` — verbatim [Fleet.tsx:281](../../../ui/src/fleet/Fleet.tsx#L281). |
| **R2 brand mark** | `bg-primary text-primary-foreground`, `rounded-md` (`--radius`), `h-6 w-6`, `text-sm font-bold`. |
| **R2 wordmark** | `text-sm font-bold tracking-tight text-foreground`. |
| **R2 identity chip** | `mono text-xs text-muted-foreground` on `bg-muted` with `border-border`, `rounded-md px-2 py-0.5`. |
| **R2 divider** | `h-4 w-px bg-border`. |
| **R2 nav** | `text-sm`; active `border-primary text-primary font-semibold`; inactive `border-transparent text-muted-foreground font-medium`; unavailable `border-dashed border-muted-foreground/40 text-muted-foreground/60`. Focus ring on `--color-ring`. |
| **R3 surface bar** | Same `bg-card` + `border-b border-border` as R2, one step shorter (40px), `px-4`. Visually a continuation of the bar, not a new band: **no** second background colour, **no** `bg-sidebar`. |
| **R4 content region** | Nothing of its own — `bg-background text-foreground` inherited from the root. Its three shell states use: dashed `border-border` + `text-muted-foreground` (not-found), `animate-pulse bg-muted` (mounting), `accent` pill + `primary` outline Retry (failed). |
| **R5 overlay** | The occupant's own ramp — the terminal surfaces stay dark (`#0b0f14` / `#0f1629`, [TerminalDock.tsx:287](../../../ui/src/board/TerminalDock.tsx#L287)); toasts keep `border-border bg-background shadow-lg`. |
| **Type** | Inter throughout; `.mono` ([index.css:68-72](../../../ui/src/index.css#L68)) for the identity chip and any id. Bar type is `text-sm`; chip and slot controls `text-xs`. Hierarchy: **wordmark > nav > chip > slot**. |
| **Motion** | **None.** The shell animates nothing — no route transition, no bar slide, no fade. Route changes are instant. The only motion is the existing `animate-pulse` on load placeholders, which already honours `prefers-reduced-motion` scoping conventions at [index.css:101-105](../../../ui/src/index.css#L101). |

---

### 2 — The `/` landing placeholder

- **Committed mock:** [`mocks/app-shell.png`](mocks/app-shell.png) — **PENDING, operator-supplied** (the
  content region as drawn). Until it lands, the checklist below is the baseline.

`/` is the terminals home's future address (milestone 49). Today it renders a placeholder, and the SPEC is
explicit that *"shipping a route with nothing behind it yet is correct here"*.

**It must not redirect to `/fleet`.** A redirect makes `/` mean nothing, which is exactly what this
milestone exists to stop. It must not look like an error (nothing failed), must not look like a loading
state (nothing is coming), and must not pretend to be a product surface.

**Form: one centred dashed placeholder card** in the house empty-state language — the same primitive as the
empty fleet ([Fleet.tsx:1483-1500](../../../ui/src/fleet/Fleet.tsx#L1483)) and the empty board
([Board.tsx:458-460](../../../ui/src/board/Board.tsx#L458)). Contents, top to bottom: the `✦` mark at
reduced opacity · a one-line heading naming what will live here (**"Live terminals"**) · a one-line
muted sub-line · a single row of destination links to the other surfaces.

**Copy names the thing, not the milestone number.** "Live terminals will appear here." — not "milestone 49
will build this". Internal scheduling is not product copy.

**A flagged regression risk, for the PO and the architect.** Today, **no `?mode=` renders the config
editor** ([main.tsx:1265](../../../ui/src/main.tsx#L1265)) — so on the `setup-ui` origin, `/` **is** the
config editor. If `/` becomes the landing on every origin, an operator running `aof ui` lands on a
placeholder instead of their editor. **Recommended answer:** `/` renders the landing on every origin, and
**each launcher URL is updated to point at its surface's own path** (`aof ui` → the config editor's path),
so nothing regresses — with the landing's nav as the recovery path if they do land there. This is a routing
decision, not a visual one; it is flagged here because the visible consequence lands on this surface. It is
settled by
[`stories/04_story_advertised-entry-points/tasks/00_servers-advertise-paths.feature`](stories/04_story_advertised-entry-points/tasks/00_servers-advertise-paths.feature)
and
[`stories/04_story_advertised-entry-points/tasks/02_desktop-entry-and-no-literals-left.feature`](stories/04_story_advertised-entry-points/tasks/02_desktop-entry-and-no-literals-left.feature).

#### Binding checklist (mandatory — this IS the baseline until the mock lands)

**Layout regions, in order, and who owns scroll:**

1. **R1–R3** — the shell's chrome, unchanged. Surface slot is **empty** on this route.
2. **Content region (R4)** — mode **`content:page`**; the page owns scroll (which it will never need to
   use — the card fits every documented breakpoint).
   1. **Placeholder card** — the only child, horizontally and vertically centred within the region.
      Regions inside the card, in order: **mark** → **heading** → **sub-line** → **destination row**.

**Components each region holds:**

- **Placeholder card** — `mx-auto max-w-md rounded-md border border-dashed border-border p-6 text-center`.
- **Mark** — the `✦` brand glyph at reduced opacity, `aria-hidden="true"`, decorative only.
- **Heading** — one `<h1>`, `text-sm font-semibold text-foreground`. It is the **one `h1` on the page** and
  the target the shell moves focus to on a route change.
- **Sub-line** — one sentence, `text-sm text-muted-foreground`, no second paragraph.
- **Destination row** — real `<a>` links to the other surfaces, `text-xs font-semibold text-primary
  hover:underline`, in the route table's order. An unreachable destination takes the **same** unavailable
  treatment as the nav (dashed, `aria-disabled`, `title` naming the command) — one rule, both places.

**States (empty / loading / error / populated):**

- **empty** — **the only steady state, and it is the populated one.** The card, as above.
- **loading** — **structurally absent, and this is stated rather than left blank**: the landing fetches
  nothing, so it must **never** render a skeleton. A skeleton here would promise data that is not coming —
  the "never assert what is not known" discipline inverted. If a future revision gives `/` a data source,
  this clause is amended in the same change.
- **error** — **structurally absent**: nothing can fail. A failure to load the landing's *code* is the
  shell's own error state (§Surface 1), not this surface's.
- **populated** — identical to empty. Until milestone 49 lands, **the landing has no populated state**, and
  saying so plainly is the honest answer.

**Design ramp:** `border-dashed border-border` + `text-muted-foreground` for the card (the house's
absent/not-yet primitive), `text-foreground` for the heading, `text-primary` for the destination links (the
same token the product already uses for links, [index.css:183-185](../../../ui/src/index.css#L183)).
`bg-background` inherited. **No `accent`, no `destructive`, no `primary` fill, no motion** — nothing here
is an error, a warning, or an action.

---

## Accessibility requirements (expected to be honoured)

The automated lane is **opt-in per 07/ADR-004 and currently off** in this repo
([acd-a11y-config-schema.test.mjs:1-8](../../../test/arch/acd-a11y-config-schema.test.mjs#L1);
[board-staleness-a11y.test.mjs:10-19](../../../test/board-staleness-a11y.test.mjs#L10) states the same for
its own surface). These requirements therefore bind the **design-conformance review and a `@uat` visual
review** regardless; if the lane is switched on, axe-core-via-Playwright (QA-owned) checks them at **WCAG
2.1 AA**. Persistent chrome above every surface is a *new* accessibility obligation — there was none
before — so several of these have no precedent to inherit.

1. **The nav is real links in a real landmark.** `<nav aria-label="Surfaces">` containing `<a href>`, never
   `<button>` + `pushState`. Middle-click, Ctrl-click and "copy link address" must all work.
2. **Exactly one `aria-current="page"`** — and in the not-found state, **none**. Never two.
3. **Active is never colour-only.** Three non-colour signals travel with it: the 2px bottom rule (shape),
   `font-semibold` vs `font-medium` (weight), and `aria-current` (programmatic). Colour is emphasis on top.
   **Contrast:** `--color-muted-foreground` `hsl(218 9% 38%)` and `--color-primary` `hsl(174 72% 27%)` both
   clear **4.5:1** on `--color-card` white at `text-sm`; the 2px `primary` rule clears the **3:1** non-text
   bar, so it is permitted to carry meaning.
4. **The unavailable item stays focusable.** `aria-disabled="true"` + `title`, but **not** removed from the
   tab order — an item skipped by the keyboard hides its explanation from exactly the users who need it. It
   is focusable and does not navigate.
5. **A skip link.** Visually hidden until focused, the **first** focusable element in the document,
   targeting the content region's `id`. WCAG 2.1 AA 2.4.1 — and the direct cost of the chrome this
   milestone introduces.
6. **One `banner`, one `main`.** The shell owns the single `<header>` banner and the single `<main>` (the
   content region). The routed surfaces' current top-level `<header>`s
   ([Fleet.tsx:281](../../../ui/src/fleet/Fleet.tsx#L281), [Board.tsx:423](../../../ui/src/board/Board.tsx#L423))
   are absorbed into the shell's bar — their contents become surface-slot contributions — so **no second
   banner survives**, and the board's root `<main>` ([Board.tsx:409](../../../ui/src/board/Board.tsx#L409))
   must not declare a second one.
7. **Route changes are announced.** A client-side navigation fires no page-load announcement, so a
   screen-reader user gets silence. On a route change, focus moves to the content region's heading (or the
   region itself, `tabIndex={-1}`). This has **no precedent in the existing code** because there is no
   client-side navigation today — it must be built, not inherited.
8. **Focus order follows visual order:** skip link → nav (route-table order) → surface slot → content. The
   visible focus indicator uses `--color-ring` ([index.css:23](../../../ui/src/index.css#L23)); do not
   remove the UA outline without replacing it.
9. **The nav disclosure at 390** declares `aria-haspopup="menu"` + `aria-expanded`, `Esc` closes it and
   returns focus to the trigger, and arrow keys move within it — inheriting the switcher pattern at
   [BoardLanes.tsx:362-363](../../../ui/src/board/BoardLanes.tsx#L362).
10. **The fullscreen occupant** traps focus, declares `aria-modal="true"` and an `aria-label` naming the
    session, and **returns focus to the enter control on exit**.
11. **Target size ≥24×24 CSS px** (WCAG 2.2 SC 2.5.8) for every nav item, the disclosure trigger and every
    slot control — achieved by making nav items fill the bar's 48px height, **not** by padding the text and
    growing the bar.
12. **The identity chip is a label, not a control** — non-interactive, with the full value in `title` when
    truncated. Never focusable, never a switcher in this milestone.
13. **The notice rail is never colour-only, and never clipped** — the `⚠` glyph plus the **full** sentence
    carry it, exactly as the board's strip already does
    ([Board.tsx:412-419](../../../ui/src/board/Board.tsx#L412)). `role="alert"` for a condition that
    **arrives**; never for one already present at mount. Past the 25% bound the rail scrolls rather than
    truncates — clipped `role="alert"` content is an accessibility defect, which is exactly why §The chrome
    budget rejects clamping the message as the answer to the budget breach.
14. **No motion means no motion trap.** The shell animates nothing, so
    `prefers-reduced-motion` ([index.css:101-105](../../../ui/src/index.css#L101)) gains no new surface.

---

## Documented defaults (decided here, not blocking)

The PO can override any of these — and the operator's committed mock supersedes any of them on sight. They
exist so the build has no open question.

1. **The scope control stays inside `<Fleet>`;** the shell owns the *bar*, via a right-anchored surface
   slot. `?scope=` stays a query param on `/fleet`, never a path segment.
2. **The shell's top bar is deliberately non-uniform to the right of the slot and byte-identical to its
   left.** The slot grows leftward and can never push the nav.
3. **One brand mark** (DG-45-1) — the fleet's filled 24px `✦` tile, on every route.
4. **The wordmark is `aof` alone.** `Mesh` and `Work Board` are retired from the bar; the nav names the
   route.
5. **The identity chip is the origin's identity**, mono, min/max-width, truncating, `title`-carrying, never
   blank, never a control.
6. **The nav is underline tabs of real links**, because that idiom already means "which sibling view am I
   on" in this product — while the filled segment already means "which filter value is picked".
7. **Nav form is pinned by breakpoint in whole discrete drops** (slot → surface bar at 768; nav →
   disclosure at 390). Never a truncated label, never a scrolling nav, never two nav rows.
8. **Cross-origin nav items render identically to in-origin ones; unresolvable ones render dashed and
   `aria-disabled` with a `title` naming the command** — the peer-board honest-locality pattern, reused.
9. **Two content modes, declared per route** (`content:page` / `content:fixed`), with scroll ownership
   declared and never emergent. A terminal-hosting surface is always `content:fixed`.
10. **`--aof-shell-chrome-height` + `dvh`**, never a hard-coded 48, and it tracks the notice rail too.
11. **`shell:fullscreen` is one named slot, one occupant, chrome hidden not overlaid, `Esc` + a visible
    control, and NOT a route** — no path, no query param, no history entry.
12. **One z ladder** (DG-45-2), `z-50` reserved for fullscreen alone.
13. **An unmatched path renders in-shell at the path typed, with no nav item active and no redirect.**
14. **The shell animates nothing.** Route changes are instant; there is no transition to design.
15. **The 88px chrome cap is a STEADY-STATE budget of two BARS**, so a 520px-tall desktop window keeps
    ≥432px of content, and **a third *bar* is a GAP** *(amended 2026-08-06)*. **The notice rail is exempt
    from that cap and additive to it** — bounded at one notice and 25% of viewport height, scrolling inside
    itself past that; **nothing yields to it**; and the breach it causes is **published, never absorbed**.
    The content dip while a server is gone is accepted deliberately: the surface underneath is already
    inert, and every alternative either degrades a true signal or turns an absence into a covert one.
16. **`/` is a placeholder card, not a redirect**, and it has no loading and no error state — stated
    explicitly rather than left blank.

---

## Open questions the operator's mock will settle

Listed so the review knows which rulings above are provisional and what it costs if the mock differs.

1. **The nav's form — underline tabs (ruled) vs a segmented pill vs a left rail.** This is the one open
   question with **structural reach**: a left rail changes the region order, the chrome-height budget, and
   both content modes. If the mock shows a rail, this document is rewritten, not patched.
2. **Whether the wordmark keeps a second word** (ruled: `aof` alone). Pure brand call — the most likely
   thing a mock overrules, and the cheapest to change.
3. **Whether a surface bar exists at 1280** (ruled: no — one bar). A mock with two bars at 1280 costs 40px
   of every surface's height at every width.
4. **Whether the identity chip is the group or the origin** (ruled: origin identity, group where known),
   and whether it is ever interactive (ruled: never, in this milestone).
5. **Whether `/` carries anything beyond the placeholder card** (ruled: card only). Recent sessions, a
   fleet summary, or a "start a session" affordance would each pull scope in from milestones 49/50.
6. **Dark mode / a dark shell.** The terminal surfaces are already dark (`#0b0f14` / `#0f1629`) and m49
   makes terminals the home screen. **If the mock shows a dark shell, that is a theme decision beyond this
   milestone's ramp** and must come back as its own design gap with its own token work — this milestone
   ships the light ramp that exists at [index.css:3-25](../../../ui/src/index.css#L3) and adds no token.
   *(Carried as its own Outline row in the `@uat` review feature.)*
7. **The exact route table.** `ARCHITECTURE.md` did not exist in this folder at authoring time
   (2026-08-06). The regions above are written to hold any four-entry table; the nav's labels and order
   follow it. A table with **more than four** entries, or a label over 10 characters, needs this document
   amended.

---

## Behavioural outcomes (cross-reference)

The user-visible BEHAVIOUR belongs in the task features, **not here**. This document fixes the look and
feel; the features fix what happens. *(Repointed 2026-08-06 at the real authored files; the placeholder
names this section carried before were never real paths.)*

**Story 01 — the route model**

- **The route table names exactly one surface for every path, and an unknown path is a 404 that keeps its
  address** (the shell's not-found state, §Surface 1) —
  [`stories/01_story_route-model/tasks/00_route-table.feature`](stories/01_story_route-model/tasks/00_route-table.feature).
- **Every legacy `?mode=` URL becomes its path, `mode` is the only thing removed, and the rewrite cannot
  loop** —
  [`stories/01_story_route-model/tasks/01_legacy-mode-redirect.feature`](stories/01_story_route-model/tasks/01_legacy-mode-redirect.feature).
- **`?scope=`, every parameter the router has never heard of, and the `#ref` fragment survive the rewrite
  intact** — the direct consequence of §The scope-control ruling —
  [`stories/01_story_route-model/tasks/02_query-and-fragment-passthrough.feature`](stories/01_story_route-model/tasks/02_query-and-fragment-passthrough.feature).

**Story 02 — static serve & history fallback**

- **The directory-traversal guard is ONE rule, so a request one origin refuses is refused the same way on
  the other** —
  [`stories/02_story_static-serve-history-fallback/tasks/00_one-traversal-guard.feature`](stories/02_story_static-serve-history-fallback/tasks/00_one-traversal-guard.feature).
- **A deep-linked or refreshed client path renders the app shell on every origin, and never swallows an API
  route** —
  [`stories/02_story_static-serve-history-fallback/tasks/01_history-fallback.feature`](stories/02_story_static-serve-history-fallback/tasks/01_history-fallback.feature).
- **A bundle file that does not exist stays a 404, so a broken deploy fails at its cause** —
  [`stories/02_story_static-serve-history-fallback/tasks/02_missing-asset-still-404s.feature`](stories/02_story_static-serve-history-fallback/tasks/02_missing-asset-still-404s.feature).

**Story 03 — the app shell & entry** (this document's own surface)

- **The entry mounts, translates a legacy address exactly once, renders the surface the route table names,
  and defines no surface of its own** —
  [`stories/03_story_app-shell-and-entry/tasks/00_entry-selects-a-surface.feature`](stories/03_story_app-shell-and-entry/tasks/00_entry-selects-a-surface.feature).
- **The five regions in one order, the chrome budget, the published chrome height, the two content modes,
  the one banner/`main`, DG-45-1 and DG-45-2** — the structural half of §Surface 1's checklist, **including
  the notice-rail budget rule amended above (its Outline row 5)** —
  [`stories/03_story_app-shell-and-entry/tasks/01_shell-regions.feature`](stories/03_story_app-shell-and-entry/tasks/01_shell-regions.feature).
- **The nav offers all four surfaces as real links, marks the active one by more than colour, carries the
  address's own parameters across a move, and never renders a destination it cannot reach as a live link** —
  [`stories/03_story_app-shell-and-entry/tasks/02_navigation.feature`](stories/03_story_app-shell-and-entry/tasks/02_navigation.feature).
- **An unmatched path renders inside the shell at the address the operator typed, and fullscreen is one
  shell-owned slot that is never a route** —
  [`stories/03_story_app-shell-and-entry/tasks/03_unmatched-path-and-fullscreen.feature`](stories/03_story_app-shell-and-entry/tasks/03_unmatched-path-and-fullscreen.feature).
- **`@uat` visual review — the shell reads as ONE application**, judged region by region against
  `mocks/app-shell.png` where committed and against this document's binding checklists everywhere else —
  [`stories/03_story_app-shell-and-entry/tasks/04_app-shell-visual-review.feature`](stories/03_story_app-shell-and-entry/tasks/04_app-shell-visual-review.feature).

**Story 04 — advertised entry points**

- **Every server-side door advertises the path it actually serves, losing neither the fleet's scope, the
  drill-in's fragment, nor the board-url body's shape** — where §Surface 2's flagged `aof ui` regression is
  settled —
  [`stories/04_story_advertised-entry-points/tasks/00_servers-advertise-paths.feature`](stories/04_story_advertised-entry-points/tasks/00_servers-advertise-paths.feature).
- **The three hard-coded board↔fleet cross-links become paths, each carrying its payload and its origin
  across the move unchanged** —
  [`stories/04_story_advertised-entry-points/tasks/01_in-app-cross-links.feature`](stories/04_story_advertised-entry-points/tasks/01_in-app-cross-links.feature).
- **(operator) the desktop app's door opens on a path, and every address this system ever handed out still
  opens what it always opened** —
  [`stories/04_story_advertised-entry-points/tasks/02_desktop-entry-and-no-literals-left.feature`](stories/04_story_advertised-entry-points/tasks/02_desktop-entry-and-no-literals-left.feature).
