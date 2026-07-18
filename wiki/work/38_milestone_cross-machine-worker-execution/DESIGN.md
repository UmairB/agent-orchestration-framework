---
doc: design
---
<!--
  Milestone DESIGN.md — answers ONE question: how should it look and feel, and why?
  Owner: designer (aof-designer). Captures INTENT + RATIONALE (why this state reads as a peer of the
  existing ones), NOT pixel specs. UI BEHAVIOUR (what the hook contract dispatches, TTL numbers, the
  session↔run reconciliation rule) is a task-feature / ARCHITECTURE outcome, cross-referenced below,
  not specified here.

  CORRECTION LOG (kept visible on purpose — the corrections ARE the lesson):
  - 2026-07-12 — §Correction 1. §Surface 1 originally named `NodeCard` (ui/src/fleet/Fleet.tsx) as the
    conformance baseline and enumerated its four-row anatomy. That component is NEVER MOUNTED by the
    web app. Caught by the design-conformance review of the live render.
  - 2026-07-12 — §Correction 2. The checklist (S1/S7/S9, written by the designer the same day) modelled
    reconciliation as PER-NODE: "run wins, the session never renders." Reality is PER-WORKSPACE. The
    live fleet falsified it. The current-work region is a bounded STACK of 1–2 lines, not one line.
  Both wrong texts are struck through, not deleted.
-->
# 38 · Cross-machine worker execution & session presence — Design

## Intent

This milestone changes **one thing you can see**: the **current-work region** on a fleet node — the
region that today reads either `idle` (muted) or `running N runs` (primary), derived solely from
`presence.activeRuns`. The milestone adds a **live coding-assistant session** as a first-class presence
signal, so a node being actively worked on — an editor open on a repo, no aof task-run — no longer reads
the lie `idle`. It gains a new state in the same region: **`working · <repo> (session)`**.

That region renders on **two real surfaces** (see §Surface 1): the **web** fleet node card and the
**Rust/Tauri desktop** node row. Nothing else on either surface changes — every other row is **carried
forward verbatim**. It is deliberately built as a **peer of the existing run-state signal**, not a fourth
vocabulary: it reuses the run-state ramp's tokens (`primary` for active, `muted` for absent) and the
whole surface's "colour AND label always travel together" rail (m25 DESIGN §Documented-defaults 1). The
reader must be able to tell **idle vs running vs working** at a glance, in the same idiom, **on both
surfaces**.

> ~~"This milestone touches **one** visual surface: the **fleet NodeCard's status line** (row 3) in
> `ui/src/fleet/Fleet.tsx`."~~ — **WRONG, corrected 2026-07-12.** `NodeCard` is not mounted (§Correction 1).
> ~~"This is a **one-line**, one-new-state change."~~ — **WRONG, corrected 2026-07-12.** The region is a
> bounded stack of **1–2 lines** (§Correction 2). It is a **one-REGION** change.

**Binding rails (carried from m25, honoured here):**
- **Read-only — the surface renders, it never mutates.** The session signal is a rendered fact off the
  presence aggregate; the card gains no control. (m25 read-only rail, unchanged.)
  > **Story 04 (2026-07-18) carves out ONE deliberate exception to this rail** — the fleet's first
  > mutation affordance, the assign-to-node control on the work-item card (ADR-012). It does **not**
  > overturn the read-only posture; the surface stays a monitor and the carve-out reads as a quiet,
  > subordinate control. See **§Surface 2**.
- **Reuse the existing ramps / tokens — invent no fleet-local vocabulary.** The `working` state reads
  in the **run-state ramp's** two tokens it already touches: **active work = `primary`** (the same
  emphasis `running N runs` carries), **no work = `muted`** (the same `idle` reads). It does **not**
  introduce a new colour, a new dot, or a session-specific accent. The `(session)` qualifier and the repo
  name are the label that distinguishes it — never colour alone.
- **Self-expiring liveness, never a stuck "working."** A session past its TTL is dropped by the
  presence aggregate before it reaches the card (mirroring m23 heartbeat staleness). The card renders
  **only what the aggregate hands it** — it never recomputes session liveness and never shows a
  "working" the aggregate no longer asserts. An expired session ⇒ the region falls back to `idle`.

---

## Correction 1 — the checklist named a component production never mounts

**Kept on purpose. This is a lesson of the milestone, not an embarrassment to bury.**

This DESIGN originally pinned its conformance baseline to **`NodeCard`** (`ui/src/fleet/Fleet.tsx`) and
enumerated **its** four-row anatomy. The build and the build-time design review were then both aimed at
`NodeCard`.

**`NodeCard` is never mounted by the web app.** `Fleet.tsx:167` branches
`isGlobalStatus(status) ? <GlobalScopeView/> : <NodesRegion/>`, and `src/mesh-ui-serve.mjs` serves
**both** `?scope=global` and `?scope=local` from `queryGlobalMeshStatus`, whose payload always carries a
`workspaces` array — so `isGlobalStatus()` is **always true**, `GlobalScopeView` → **`GlobalNodePanel`**
(`Fleet.tsx:537`) is **always** what renders, and `NodesRegion` → `NodeCard` is dead in every scope.

- **`NodeCard` is NOT a conformance surface.** It must never again be named as the baseline.
- **A checklist that enumerates the wrong anatomy is worse than no checklist** — it lets a reviewer tick
  four rows against a six-row card and return a confident CONFORMS. That is exactly what happened, and a
  synthetic fixture kept it plausible.
- **The desktop was never in this doc at all** — an entire rendering surface, in another language,
  invisible to the design. It is §Surface 1b now.

---

## Correction 2 — reconciliation is PER-WORKSPACE, not per-node (and the region is a stack)

**Also kept on purpose — and note who was wrong: the designer, in this checklist, on the same day.**

S1/S7/S9 as first written bound a **per-node** model: *"the line reads exactly one of three states"*,
*"run + session ⇒ `running N runs`, **never** the session"*, *"must not change card height."* A live,
producer-fed render (FRAME A) falsified all three: `umairs-msi`, with a real run in the `aof` workspace
and a live session in the `pay-guard-portal` workspace, renders **two stacked lines** —
`running 1 run` above `working · pay-guard-portal (session)` — and the card grows by one line.

**The build is right; the checklist was wrong.** A node hosts **N workspaces**. A run in `aof` and an
editor open on `pay-guard-portal` are **two different pieces of work on one machine**, not competing
claims about one piece. Enforcing the old S7 literally would **suppress the `pay-guard-portal` session** —
the card would hide that a human is working in it, **reintroducing the exact lie of omission this
milestone exists to kill, at a new address.** (The projection is even named `fleetCurrentWorkLines` —
*plural*. The code knew; the doc did not.)

**Evidence it is per-workspace, from the pixels as a set:** FRAME A (run live) shows only
`pay-guard-portal` — the `aof` workspace's own session is subsumed by its run. FRAME B, minutes later,
run complete, shows `working · pay-guard-portal, aof (session)` — the `aof` session reappears the moment
its run ends. Same node, same sessions; the only variable is the run.

The corrected rules are **S1 / S6 / S7 / S9 / S11** below.

---

## Conformance source of truth — binding checklist, NO new mock

> **There is NO new mock for this milestone.** At refine the user chose **binding-checklist-only**.
> The **binding checklist below (§Surface 1) is the conformance source of truth** the
> design-conformance review judges against — there is no `mocks/` PNG to land and none is owed.
> The **baseline is the CURRENT render of the surfaces production actually mounts**: (a) the web
> `GlobalNodePanel` card, (b) the Rust desktop node row. A handed screenshot is judged region-by-region
> against §Surface 1; absent a handed render the honest verdict is INCONCLUSIVE naming the missing render
> (never a guess from the component code).
>
> ~~"The **baseline is the CURRENT `NodeCard` render**…"~~ — **WRONG, corrected 2026-07-12. See §Correction 1.**

> **Story 04 addendum — 2026-07-18.** Story 04 adds the fleet's FIRST mutation affordance — an
> **assign-to-node** control on the **work-item (milestone) card** (a DIFFERENT card from §Surface 1's
> node card). §Surface 1 PREDATES it and does not describe it. Its binding checklist is authored below as
> **§Surface 2**, and **§Surface 2 BECOMES the conformance baseline `aof:verify` judges the assign
> affordance against.** No mock is owed (binding-checklist-only, as for §Surface 1). Absent a handed
> render, the assign affordance's verdict is **INCONCLUSIVE** — see §Surface 2 Review status.

---

## The data the current-work region renders (read-only, additive)

A thin projection of the presence aggregate — it carries no session logic of its own. Pinning the data
source (the m22/R6 "a mechanic must have a real data source" discipline):

- **`activeRuns`** — the frozen m23 field (`PresenceRecord.activeRuns: string[]`, `ui/src/fleet/api.ts`)
  — the in-flight run ids, **aggregated across all of the node's workspaces**. Non-empty ⇒
  `running N run(s)`. **Unchanged.**
- **The session signal** — an **ADDITIVE field alongside `activeRuns`** on the presence record (the
  architect fixes its exact wire shape in `ARCHITECTURE.md`; design against the **concept**: a node's set
  of **live coding-assistant sessions**, each naming the **workspace/repo** it is open on, already
  TTL-filtered by the presence publisher so the card only ever sees live ones).
- **Reconciliation is PER-WORKSPACE (corrected — §Correction 2).** Within a workspace, a running task-run
  **subsumes that workspace's session** (the run is the stronger claim about the *same* work). Sessions in
  workspaces **without** a run are **NOT suppressed** — they still render, on their own line. This
  consumes the ARCHITECTURE reconciliation verdict (SPEC open question "session ↔ run reconciliation");
  the design's job is only to say how it reads.
  > ~~"When a node has both a running task-run AND a live session, the run wins the line — it reads
  > `running N runs`, not the session."~~ — **WRONG, corrected 2026-07-12.** That is per-NODE. It would
  > hide real work.
- **Workspace `work_dir` is resolved ABSOLUTE.** (F11: a relative `work_dir` made the aggregate re-read
  ONE workspace N times — one run rendered `running 2 runs`, and every cross-workspace session was
  silently destroyed.) The correctness of this whole region depends on it. Behaviour/ARCHITECTURE, noted
  here because the design is unrenderable without it.
- The card **writes none of it.** The only facts are rendered; there is no interaction added.

---

## Surface 1 — the current-work region — the one changed region, on TWO real surfaces

**One design rule, two implementations**, because the two surfaces are written in two languages. Both are
conformance surfaces. Both are judged.

### The shared rule (governs BOTH surfaces — this is the binding part)

| # | Binding rule | |
| --- | --- | --- |
| **S1** | **The current-work region is a bounded STACK of 1–2 lines** — an optional `running N run(s)` line, then an optional `working · <repos> (session)` line. If neither: **exactly one** `idle` line. Never zero lines, never three. *(corrected — §Correction 2)* | |
| **S2** | **Exact label.** Prefix `working · ` (the middle-dot separator the surface already uses), then the repo **short name**(s), then a **single** trailing ` (session)` qualifier | |
| **S3** | **Token.** Active work — **running OR working-session** — is **`primary`** (`font-semibold text-primary`, or the desktop's equivalent active token). No work — `idle`, including the stale-expired fallback — is **`muted`**. **`working` is the PEER of `running`: identical weight, identical colour.** | |
| **S4** | **Colour AND label always travel together.** The state is never signalled by colour alone; the labels are distinct and the token only reinforces active-vs-quiet | m25 rail |
| **S5** | **No new primitive.** NO session-specific colour, dot, chip, badge, icon, accent, background, or pill. The session state is **plain text in the existing region**, in the existing tokens | **load-bearing** |
| **S6** | **All un-subsumed repos show on ONE session line** — comma-joined under **one** `working ·` prefix and **one** trailing `(session)`. **Order is deterministic: alphabetical by repo short name** (an unstable order makes the line reshuffle between polls and any snapshot test flaky). Trailing truncation on a narrow card is acceptable (same idiom as the capability footer). *(order rule added — §Correction 2)* | |
| **S7** | **Run wins its OWN WORKSPACE.** A run subsumes the session **of the same workspace** — that session does not render. Sessions in **other** workspaces still render on the session line. A node may therefore show a run line AND a session line together. *(corrected — §Correction 2)* | ARCHITECTURE |
| **S8** | **Expired session ⇒ `idle`, never a stuck `working`.** The aggregate TTL-filters; the surface renders only what it is handed and shows no "was working" ghost — **even while a dead session record still sits on disk** | |
| **S9** | **Bounded growth, row integrity preserved.** The region may grow from one line to two; the card grows with it and the grid stretches its siblings to equal height, so the **row** stays clean and the footer stays anchored by its top border. The region is **capped at two lines by construction** (runs collapse to one line, sessions to one) — it can never grow unboundedly with workspace count. *(corrected — §Correction 2)* | |
| **S10** | **ONE rule, N implementations, IDENTICAL string.** JS `fleetCurrentWorkLines()` and Rust `current_work()`/`display()` **must render the identical string for the identical payload.** A Rust app cannot import a JS projection, so the rule is duplicated by necessity — the *duplication is permitted, the divergence is not.* **Enforced by contract test, not by screenshot** (`test/arch/acd-captured-producer-fixture.test.mjs`) | |
| **S11** | **Reconciliation is PER-WORKSPACE, never per-node.** Work is a property of a *workspace*, not of a *machine*. The region must never suppress real work in workspace B because workspace A has a run | **new — §Correction 2** |

RATIONALE for **S5** (the rule the review exists to enforce): a dot/badge here would invent a fleet-local
**session vocabulary** and risk being read as a *fourth* ramp. The region is already plain text lines
(`idle` / `running N runs`); the honest, in-idiom move is a **third label in the same region**, not a new
primitive. The fleet's three-ramp discipline (node-liveness · run-state · item-status-one-level-down)
must survive this milestone intact.

RATIONALE for **S10**: the same fact now renders from two codebases. If they drift, the fleet tells two
different truths about one node depending on which window you look at. The strings are the contract — and
a string contract is checked by a **test**, not by a human squinting at two screenshots.

RATIONALE for **S11**: see §Correction 2. Suppressing a cross-workspace session to honour a node-level
rule is the same lie (`idle` while a human is working) the milestone was opened to kill.

---

### Surface 1a — WEB · the `GlobalNodePanel` node card

**Governs:** the web app at `?mode=fleet` in **both** `scope=global` and `scope=local` — this card is
what production mounts in every scope (§Correction 1). **Component:** `GlobalNodePanel`,
`ui/src/fleet/Fleet.tsx:537`.

**The card's real anatomy — SIX regions, in order** (this is what a reviewer ticks against):

1. **Identity line** — presence **dot** + mono `nodeId` + **role badge** (`WORKER` / `CONTROL`). *Carried forward verbatim.*
2. **Host line** — the machine host (`Umairs-MSI`, `Umairs-Mac-mini.local`). *Carried forward verbatim.*
3. **Presence-age line** — `last seen Nd ago` / `never seen`. *Carried forward verbatim.* (**Node liveness** — a separate ramp from current-work; the two must never merge. Its vocabulary differs from the m25 `PresenceLabel` ramp; see **DG-1** — not m38's to fix.)
4. **CURRENT-WORK REGION — THE CHANGED REGION.** **1–2 text lines**, `text-[13px]`, same typographic slot. Renders via `nodeCurrentWork(node)` → **`fleetCurrentWorkLines(node.presence ?? {})`** (*plural — see §Correction 2*). Judged against **S1–S11** and the States table.
5. **Fabric line** — `fabric addr: …`. *Carried forward verbatim.* (Sits one line lower when the region shows two lines — **expected**, see S9.)
6. **Capabilities footer** — `claude, codex` / `no capabilities`, over a top border. *Carried forward verbatim.* (Phrasing differs from the other card's; see **DG-1**.)

> ~~"the NodeCard keeps its four-row anatomy exactly: Row 1 identity (… `this node` tag + `aofVersion`
> chip) · Row 2 presence-age (dot `md` + `PresenceLabel`: `♥ Ns` / `stale · Nm` / `no presence`) · Row 3
> current-work · Row 4 capability footer (`runtimes · N skills`)."~~ — **WRONG, corrected 2026-07-12.**
> That is `NodeCard`'s anatomy, and `NodeCard` never renders (§Correction 1). A reviewer handed the real
> card and this list will tick **four rows against six** and return a false CONFORMS. **It did.**

---

### Surface 1b — DESKTOP · the Rust/Tauri node row

**Governs:** the desktop app (`app/desktop/`). **It is NOT React** — a Rust/Tauri app rendering its own
node rows from `app/desktop/crates/core/src/view_model.rs` (`current_work()` → `display()`).
**This surface was absent from this design entirely until 2026-07-12** — a whole rendering surface, in a
different language, invisible to the doc. It is also the surface whose own UAT raised the milestone's bug
(F7/F8). *A design that cannot see a surface cannot govern it.*

**The row's real anatomy, in order:** presence dot → `nodeId` → `this node` chip → role badge → version →
**CURRENT-WORK LABEL (the changed region)**. All but the last are *carried forward verbatim*.

Judged against **S1–S11**, and against **S10** specifically: it must emit the **byte-identical string** the
web emits for the same payload. **S10 is verified by contract test, not by screenshot** — see §Review status.

---

### States (the current-work region — the milestone's state set, BOTH surfaces)

The generic UI-state axis (empty / loading / error / populated) is owned surface-wide by m25 DESIGN
§Surface-1 States and is **unchanged**. What this milestone adds is the **populated state set for the
current-work region**:

| State | Region reads | Token | When |
| --- | --- | --- | --- |
| **idle** | `idle` | `muted` | no active runs AND no live session. **Unchanged baseline.** |
| **running** | `running N run(s)` | `primary` | ≥1 running task-run. Correctly pluralised (`running 1 run`). **Unchanged baseline.** |
| **working-session** | `working · <repo> (session)` | `primary` | ≥1 live session, no run in that workspace. **NEW.** |
| **two-repos** | `working · repoA, repoB (session)` | `primary` | live sessions in ≥2 workspaces without runs. One `working ·` prefix, comma-joined, **alphabetical**, `(session)` **once**. **NEW.** |
| **run + cross-workspace session** | TWO lines: `running N run(s)` **over** `working · <repo> (session)` | both `primary` | a run in workspace A **and** a live session in workspace B. A's own session is subsumed; B's renders. The run line reads **first**. **NEW — §Correction 2.** |
| **stale-expired** | `idle` | `muted` | a session past its TTL. Dropped by the aggregate before the surface sees it — **never a stuck `working`**, no ghost, **even while the dead session record is still on disk.** |

Notes binding the review:
- **The `working` prefix is fixed:** `working · ` (the middle-dot the fleet already uses — region
  summaries `N nodes · N live`, the diagnostics strip), then the repo name(s), then ` (session)`.
- **The repo renders as its SHORT NAME** (`aof`, `pay-guard-portal` — not a path, not a slug).
  > ~~"the repo's short name **(mono-adjacent identity)**"~~ — **clarified 2026-07-12.** That parenthetical
  > was being read as a *font* binding. **It is not.** It is the rationale for choosing the short name. The
  > region is **one token, one font** (S3/S5) — a mono span inside it would itself be a new typographic
  > primitive and is **forbidden**. The current render is **CORRECT**.
- **working is a PEER of running** — same `primary` emphasis, same weight, same colour. **Proven in
  FRAME A**, both labels in one card, one image. Not asserted: witnessed.

### Design ramp for the changed region

Draws from the **run-state ramp's tokens already in play** — it invents nothing:
- **active work (running OR working-session) = `primary`** — the same token `running N runs` already uses.
- **no work (idle, incl. stale-expired fallback) = `muted`** — the same token `idle` already uses.
- **Colour AND label always travel together** — never colour alone (S4).
- **No new dot, chip, badge, icon, or accent for the session** (S5). The node-presence ramp and the
  run-state ramp stay their own primitives. **The review flags any session-specific primitive as a gap.**

---

## Surface 2 — the work-item card's "assign to node" affordance (NEW — story 04, 2026-07-18)

**This is the milestone's first MUTATION affordance and the conformance baseline for story 04.** Authored
2026-07-18; it did not exist before this pass. `aof:verify 38` judges the assign affordance **region-by-region
against A1–A11 and the affordance States table** below. **There is no mock** (binding-checklist-only, as
§Surface 1). Absent a handed render the verdict is **INCONCLUSIVE** (see Review status).

**Governs:** the web app at `?mode=fleet` (global scope), the **work-item (milestone) card** —
`FleetMilestoneCard`, `ui/src/fleet/Fleet.tsx`. **This is NOT §Surface 1's node card.** §Surface 1 governs
the `GlobalNodePanel` node card and its current-work region; the assign affordance lives on the *work-item*
card in the milestone list. The two are different cards, so the affordance does **not** crowd the
current-work region directly — its crowding risk is on the **work-item card's own anatomy** (see **DG-3**).

**The binding rail this DELIBERATELY carves out:** m25 / §Surface-1 pinned a **read-only** rail — "the
surface renders, it never mutates." Story 04 (ADR-012) is the **sanctioned single exception**: ONE write
route, ONE affordance. The design consequence is a constraint, not a licence — **the affordance must read as
a QUIET, subordinate carve-out on a surface that is still a monitor first**, never turning the board into a
control panel (A2).

### The work-item card's anatomy — SIX regions, in order (what a reviewer ticks against)

1. **Identity line** — `StatusRing` + mono `ref` + `milestone` type tag + right-aligned `StatusChip`. *Carried forward verbatim.*
2. **Title** — the item title (`h3`). *Carried forward verbatim.*
3. **Progress row + track** — `<label> · done/total` + the progress bar. *Carried forward verbatim.*
4. **Story dots + count** — the per-story status dots and `N stories`. *Carried forward verbatim.*
5. **Footer** (top-bordered) — mono workspace name · **attention cluster** · right-aligned `Open board →`. The **attention cluster is where the resulting `assigned` chip appears** (the m35/story-03 `AssignmentChip`), NOT in the affordance row. *Carried forward; the chip is the m35 ramp, unchanged.*
6. **ASSIGN AFFORDANCE ROW — THE NEW REGION.** A top-bordered row at the card FOOT, a **sibling BELOW** the Open-board button (never nested inside it): the **worker-node picker** (`<select>`), the **`Assign →` action**, and an **inline error slot**. Fed by `assignableNodeOptions(nodes)` (`ui/src/fleet/scope.mjs`) → `fleetApi.assign` (`ui/src/fleet/api.ts`). Judged against **A1–A11**.

### The binding rules (A1–A11)

| # | Binding rule | |
| --- | --- | --- |
| **A1** | **Placement — its own row at the card FOOT, below the Open-board footer, on its own `border-t` divider.** The affordance is a **sibling** of the Open-board button, never nested inside it (an HTML `<button>` may not nest an interactive control). All five carried-forward regions render **verbatim**; the affordance adds height, it never displaces them. | |
| **A2** | **Quiet, subordinate carve-out — the surface stays a monitor.** At rest the **picker is in the `muted` ramp** (`bg-muted`, `text-muted-foreground`); only the **action** carries a **LOW-emphasis `primary` tint** (primary text on a `primary/10` fill, `primary/40` border) — enough to be found, not a solid filled button that shouts on every card. The read-only rail is carved out by ONE affordance, not overturned. | **load-bearing** |
| **A3** | **Producer-fed picker — exactly the assignable roster.** Options are exactly the roster's node ids (`assignableNodeOptions`) — **no invented `any`/placeholder target, no dropped known node.** A stale-but-known node stays an option (the verb keys on membership, not liveness). *(the DATA is task 03's; the RULE "the picker shows exactly the assignable roster" is the design's checkable contract.)* | task 03 |
| **A4** | **Empty roster ⇒ DISABLED, not hidden, not phantom.** No worker node ⇒ the picker renders **disabled** with a single honest placeholder (`No worker nodes yet`) and the action **disabled**. Never a selectable option, never an invented `any` target, never a blank/crash. This is the affordance's own empty state. | |
| **A5** | **One node ⇒ preselected, still a picker.** A single-node roster preselects that node but stays a picker (not collapsed to static text) so the operator SEES the target before committing. | |
| **A6** | **Many nodes (live + stale) ⇒ all known nodes are options**, first preselected, deterministic order. Liveness does not filter the picker; it **should annotate** the option so the choice is informed — today it does not (**DG-5**, deferred, the open half of this rule). | |
| **A7** | **The action's transient states are all rendered.** `Assign →` (at rest) → `Assigning…` (disabled, in flight) → on success **no local chip** (the confirmation surfaces in region 5 via the existing 5s poll, A8); on a verb gate-miss an **inline `destructive` error** renders in the affordance row — never a silent no-op, never a 200-plus-phantom. | ADR-012 |
| **A8** | **The result is the m35/story-03 chip, VERBATIM — no new assign-result vocabulary.** The `assigned` confirmation is the existing `AssignmentChip` (`assigned` = **`muted` + a hollow dot + `→ <targetNodeId>`**), climbing the m35 §4 assignment ramp (assigned→accepted→running→done/failed). The affordance mints **no chip, badge, toast, or accent of its own.** | m35 §4 |
| **A9** | **No new colour primitive.** The affordance uses ONLY existing theme tokens — `muted` (picker), a `primary` tint (action), `destructive` (inline error) — the same tokens the card and the assignment ramp already speak. No fleet-local palette, no hex, no "assignable" accent. | mirrors S5 |
| **A10** | **Spacing/rhythm native to the card.** The row reuses the card's divider+padding idiom (`border-t border-border pt-3`, `mt-3`, `gap-2`, `text-xs`) — the SAME rhythm the footer uses — so it reads as a native region, not a bolted-on widget. | |
| **A11** | **Click isolation reads visually.** The affordance's controls must not trigger the card's Open-board navigation (they stop propagation), and must read as **clearly OUTSIDE** the Open-board clickable region (below its border) so the picker is never mistaken for part of the drill-in. | |

### States (the assign affordance's own state axis — the story-04 state set)

| State | Picker | Action | When |
| --- | --- | --- | --- |
| **empty-roster** | disabled · `No worker nodes yet` · muted | disabled | roster carries no worker node |
| **one-node** | single node preselected · muted | enabled `Assign →` | exactly one node |
| **many-nodes (live + stale)** | all known nodes · first preselected · muted | enabled `Assign →` | ≥2 nodes; stale nodes still offered |
| **assigning** | selection frozen · disabled | `Assigning…` · disabled | POST in flight |
| **refused** | selection kept | `Assign →` re-enabled + **inline `destructive` error** | verb gate-miss (unknown/ineligible node, already-active, unresolvable ref) |
| **assigned (confirmation)** | *(unchanged)* | *(unchanged)* | on success the **`assigned` chip appears in region 5** (footer attention cluster) after the 5s poll — the m35 ramp, muted hollow dot, `→ <node>` |

### Design ramp for the affordance

- **picker at rest = `muted`** — the surface is a monitor first; the control is quiet until engaged.
- **action = LOW-emphasis `primary` tint** — found, not shouting; never a solid filled primary on every card.
- **in-flight = disabled + `Assigning…`** — the action states itself; no spinner primitive is invented.
- **error = `destructive`, inline** — the same token every fleet read-failure uses.
- **result = the m35 assignment ramp, verbatim** (`assigned` = muted hollow dot). **The review flags any
  assign-result-specific primitive (badge / toast / accent) as a gap.**

### RATIONALE

- **Why a `<select>`, not a radio group or an always-expanded list:** the affordance sits on **every**
  milestone card and the roster is 0..N nodes. A `<select>` shows the full option set **on demand** in one
  row; a radio group would multiply each card's height by the roster size, permanently, on a dense board.
  The dropdown is the compact, in-idiom control — the picker earns its one row, no more.
- **Why quiet-at-rest (A2):** the read-only rail is a m25 binding rail; the fleet reads as a **monitor**. A
  solid primary button on every card converts the monitor into a control panel and invites mis-clicks on a
  scanning surface. The carve-out is deliberately **present but subordinate.**
- **Why the result reuses the m35 chip (A8):** the assignment lifecycle already owns a ramp. A fresh
  "just assigned" badge would be a **second vocabulary for one fact** — the very fourth-ramp mistake
  §Surface 1 S5 exists to prevent. One assignment ramp, spoken once.

### Review status — Surface 2 (2026-07-18) — **INCONCLUSIVE**

**INCONCLUSIVE — no render handed, and no baseline pre-existed this pass.** This checklist IS the baseline,
authored today; there is nothing to judge a screenshot against yet, and **no screenshot was handed** to this
pass. Per the ACD design-conformance contract the honest verdict is **INCONCLUSIVE**, and the remedy is to
**produce the render** and judge it region-by-region against **A1–A11 + the affordance States table** — NOT
to infer CONFORMS/GAPS from the component code. (Reading the code INFORMED this checklist and the DG findings
below; it is **not** a fidelity verdict.)

**What's owed at `aof:verify`:**
- A **render of the work-item card carrying the affordance**, from the **built `ui/dist`** served against a
  **fixture `/api/mesh/status`** with (a) an **empty roster** (A4), (b) a **one-node** roster (A5), (c) a
  **multi-node live+stale** roster (A6), and (d) an item with a **real minted `assigned` record** so region
  5's chip renders (A8) — screenshotted via **headless Chromium** (the cached `ms-playwright` build driven
  directly; `npx playwright` is policy-blocked — see work memory "design render via headless Chromium"). The
  **orchestration renders and hands the screenshots; the designer judges.** Running the browser is
  QA/orchestration's job, **not** the designer's.
- Judge **at 1280 only.** Carried from §Surface 1's NOT-ASSESSED note: **390 / 768 are effectively
  unrenderable** for this page — at 390px the milestone list makes the page ~20,000px tall, beyond Chrome's
  max canvas — so **1280 is the practical breakpoint**, and every Surface-2 verdict covers 1280 alone until a
  narrow-viewport strategy exists.
- The **`@manual` outsider soak** (story-04 task 04) — a person assigns a REAL item to a REAL node in the
  REAL UI and confirms the chip — remains the human gate, closed at `aof:verify 38`.

---

## Design-conformance review — status (2026-07-12, second pass)

Judged from **three live, producer-fed 1280px renders** of **Surface 1a** (`GlobalNodePanel`,
`?mode=fleet&scope=global`) — real Claude Code hook, real `aof session` CLI, a real `aof work run-start`
run record, real presence daemon, real `/api/mesh/status`. **No fixtures.** Frames judged as a set
(several states are mutually exclusive on one node and cannot share a frame).

### States-table ledger

| State | Status | Evidence |
| --- | --- | --- |
| **idle** | **WITNESSED — CONFORMS** | all frames; `peer-git`, `umairs-mac-mini` muted `idle` |
| **running** | **WITNESSED — CONFORMS** | FRAME A — `running 1 run`, `primary`, correctly pluralised |
| **working-session** | **WITNESSED — CONFORMS** | FRAME A — `working · pay-guard-portal (session)` |
| **two-repos** | **WITNESSED — CONFORMS** | FRAME B — `working · pay-guard-portal, aof (session)`: one prefix, comma-join, `(session)` once, no truncation at 1280 |
| **run + cross-workspace session** | **WITNESSED — CONFORMS** | FRAME A — two `primary` lines, run first; the `aof` session subsumed by its run while `pay-guard-portal`'s survives |
| **stale-expired** | **WITNESSED — CONFORMS** | FRAME C — `idle`, muted, **while the hard-killed session record is still physically on disk**. No ghost. The strongest frame of the three |

**All 5 (now 6) States rows are WITNESSED.** Previously 2 of 5.

### Rule ledger

- **S3 (peer emphasis) — WITNESSED, CONFORMS.** FRAME A puts `running 1 run` and
  `working · pay-guard-portal (session)` in the **same card, same slot, one image**, in **identical weight
  and identical primary token**. This was the claim I refused to infer; it is now proven.
- **S2, S4, S5, S6, S8 — CONFORMS** across all three frames. **S5 in particular: no session-specific
  chip, badge, dot, icon, accent or background in any state, including the two-line stack.**
- **S1, S7, S9 — the BUILD conforms; the CHECKLIST was wrong and has been corrected** (§Correction 2).
- **S10 — VERIFIED BY CONTRACT TEST, NOT BY SCREENSHOT.** `test/arch/acd-captured-producer-fixture.test.mjs`
  asserts the JS and Rust projections render the same line for the same captured payload, and is green.
  **This satisfies the designer** — a byte-identity claim is a test's job; a screenshot could only ever
  show it *looked* the same. The desktop pixel is **not** owed for S10.

### NOT ASSESSED — do not infer

- **390 / 768 breakpoints** — still unrenderable (at 390px the page is ~20,000px tall; the NODES region
  falls beyond Chrome's max canvas). **Every verdict here covers 1280 only.**
- **The desktop row's LOOK** (Surface 1b) — no render captured. S10 (the *string*) is closed by contract
  test; the desktop's *tokens, layout and two-line stack* are **unjudged**.
- **`running N runs` with N ≥ 2 across two real workspaces** — not witnessed (the F11 bug used to fake it).
- **Repo ORDER stability** on the session line — see DG-2. One frame cannot prove an order is deterministic.

---

## Deferred design-gap findings (recorded so they are not lost)

### DG-1 — one presence ramp, two vocabularies (pre-existing; deferred, NOT m38's to fix)

- **Observed:** the same node-liveness fact is spoken in **two vocabularies**. `GlobalNodePanel` renders
  `last seen 8d ago` / `never seen`; the m25-designed `PresenceLabel` ramp renders `♥ Ns` / `stale · Nm` /
  `no presence`. Likewise the capability footer reads `claude, codex` / `no capabilities` on one card and
  `runtimes · N skills` / `not enrolled · no skills` on the other.
- **The correct answer (designer owns it):** **one presence ramp, one vocabulary — the richer
  `♥ Ns` / `stale · Nm` / `no presence`** — on every surface, web and desktop. One capability-footer
  phrasing everywhere.
- **Resolution:** a DESIGN.md rule in the milestone that adopts it, **plus a `@uat` visual-review
  scenario**. Not a code patch alone.

### DG-2 — the session line's repo order is unbound (NEW, m38-adjacent, small)

- **Observed:** FRAME B renders `working · pay-guard-portal, aof (session)`. DESIGN never bound an order,
  and a single frame cannot prove the order is stable. If the projection emits map/insertion order, the
  line will silently reshuffle between polls (`aof, pay-guard-portal` ↔ `pay-guard-portal, aof`).
- **Why it matters:** a line that reorders under the reader's eyes is visual noise, and it makes the S10
  contract test and any future snapshot flaky for a reason that has nothing to do with the fact being told.
- **The correct answer (designer owns it, now bound as S6):** **deterministic alphabetical order by repo
  short name**, in **both** projections.
- **Action:** developer confirms `fleetCurrentWorkLines()` and Rust `current_work()` sort the repo list;
  add the sort if absent. Small; does not block the visual verdict.

### DG-3 — the affordance sits on EVERY milestone card, always-visible (NEW, m38 / story-04)

- **Observed (structural, from the checklist-vs-intent — NOT a render verdict):** `AssignAffordance` mounts
  unconditionally on **every** milestone card (`Fleet.tsx` renders it as a sibling on each card), so a
  picker + action row is permanently spent on every card whether or not the operator ever assigns from it.
  On a dense board this puts a control on a surface designed to be scanned (the read-only-monitor rail, A2).
- **Why it matters:** the read-only rail's whole value is that the fleet reads as a monitor at a glance; a
  permanent control on every card erodes that and adds a mis-click target to a scanning surface.
- **The correct answer (designer owns it):** decide between **always-visible-but-quiet** (A2 as written — acceptable
  if it stays subordinate) and **progressive disclosure** (reveal the affordance on card hover, reusing the
  card's existing `group-hover` idiom, so at rest the board stays a pure monitor). **A2 codifies the
  quiet-at-rest floor; the disclosure model is the open question.**
- **Resolution:** a DESIGN.md rule that picks the disclosure model, **plus a `@uat` visual-review scenario**
  (a person judges a full board of cards, not one card). Not a code patch alone. **Deferred — decided at
  the render, against A2.**

### DG-4 — action and confirmation are spatially + temporally disjoint (NEW, m38 / story-04)

- **Observed (structural):** the operator ACTS in region 6 (the card foot) but the `assigned` confirmation
  appears in region 5 (the footer attention cluster, above) **after the 5s poll** (A7/A8 — no bespoke
  refresh). Between the click and the poll there is **no local confirmation at the point of action** beyond
  the transient `Assigning…`; the result then materialises elsewhere on the card, seconds later.
- **Why it matters:** a feedback loop where the effect is displaced from the action, and delayed, reads as
  "did that work?" — the operator may re-click or assume failure. Good affordance design keeps the
  acknowledgement near the action and prompt.
- **The correct answer (designer owns it):** either (a) an **in-row transient success acknowledgement** in
  region 6 (e.g. `Assigned →` settling to muted) that hands off to the region-5 chip on the next poll, or
  (b) an explicit design decision that the region-5 chip after ≤5s IS the acknowledgement and the transient
  `Assigning…` bridges the gap — **stated, not left implicit.**
- **Resolution:** a DESIGN.md rule + a `@uat` scenario (a person clicks assign and judges whether the result
  is legible without re-checking). **Deferred.**

### DG-5 — the picker gives the operator no liveness cue (NEW, m38 / story-04, small)

- **Observed (structural):** the picker lists node ids as bare `<option>`s (A6) with **no liveness signal**,
  yet a **stale-but-known** node is a valid option (the verb keys on membership, not liveness). §Surface 1
  went to some length to make live-vs-stale legible in the presence vocabulary (`♥ Ns` / `stale · Nm`); the
  assign picker throws that away at the exact moment the operator is CHOOSING a target.
- **Why it matters:** the operator can dispatch to a node offline for days with zero visual warning, then
  discover it only via downstream behaviour. The picker should let them choose informed — while still
  ALLOWING the stale target (never a hidden filter, per A3).
- **The correct answer (designer owns it):** **annotate the option with liveness** in §Surface 1's presence
  vocabulary (e.g. `worker-b · stale`), never filter it out. Bound as the open half of **A6**; connects to
  **DG-1** (one presence ramp, one vocabulary).
- **Action:** developer adds the liveness annotation to the option label, sourced from the same `freshness`
  fact `nodePanelFacts` already carries; small; does not block the visual verdict. **Deferred.**

---

## Documented defaults (decided here, not blocking)

1. **The session state is a label in the existing current-work region, not a new primitive.** `idle` /
   `running N run(s)` / `working · <repo> (session)` share one region, one slot, and the run-state ramp's
   two tokens. No session dot/chip/badge. Rationale: avoid a fourth confusable ramp; keep the fleet's
   three-ramp discipline intact.
2. **Reconciliation is PER-WORKSPACE.** A run subsumes **its own workspace's** session; sessions in other
   workspaces still render, on a second line, and the run line reads first.
   ~~"The run wins the line; `working · <repo> (session)` renders only when there is a live session AND no
   active run."~~ — **WRONG, corrected 2026-07-12; see §Correction 2.** That rule would hide real work.
3. **Working is `primary` — a peer of running.** Same emphasis; `idle` stays `muted`. The label, not the
   colour, distinguishes a run from a session. **(Witnessed, FRAME A.)**
4. **A session past TTL falls back to `idle`, never a stuck `working`** — even while its record is still on
   disk. The surface renders only what the aggregate hands it. **(Witnessed, FRAME C.)**
5. **All un-subsumed repos show on one comma-joined session line**, one `working ·` prefix, one trailing
   `(session)`, **alphabetical**; trailing truncation on a narrow card is acceptable.
6. **No new mock; the binding checklist is the conformance source of truth, judged against the CURRENT
   render of the surfaces production actually mounts** — §Surface 1a (web) and §Surface 1b (desktop), and
   now §Surface 2 (the story-04 assign affordance on the work-item card).
   ~~"…judged against the current NodeCard render."~~ — **WRONG, corrected 2026-07-12; §Correction 1.**
7. **`NodeCard` is NOT a conformance surface.** Unreachable in every scope (§Correction 1); never again a
   baseline, never evidence that the surface is correct.
8. **ONE rule, N implementations, identical string** (S10). Duplication permitted; divergence is not.
   **Byte-identity is proven by a CONTRACT TEST, not by a screenshot** — that is the right instrument, and
   a pixel is not owed for it.
9. **A checklist must name the surface a user actually sees, and say which scope it governs.**
   (§Correction 1 is why this default exists.)
10. **A verdict is only as good as the states in frame.** A review that never saw `running` has not proven
    `working` is its peer; a review that never saw an expired session has not proven there is no stuck
    `working`. Unwitnessed states are recorded **NOT ASSESSED**, never assumed.
11. **The current-work region is capped at TWO lines by construction** — runs collapse to one line,
    sessions to one. The card may grow by one line and the grid stretches its siblings to match; it can
    **never** grow unboundedly with workspace count. If a future change would add a third line, that is a
    new design decision, not an implementation detail. **(§Correction 2, S9.)**
12. **The fleet stays a monitor; the assign affordance is a QUIET carve-out, not a new posture.** The
    read-only rail is not overturned by story 04 — it is carved out by exactly one affordance, which reads
    subordinate at rest (muted picker, low-emphasis primary action) and reuses the m35 assignment ramp for
    its result. No new colour/chip/toast for "assignable" or "just assigned." **(§Surface 2, A2/A8/A9.)**

---

## Behavioural outcomes (cross-reference — NOT design)

The user-visible BEHAVIOUR is specified as task scenarios in the stories this milestone breaks down, NOT
here. This design fixes the look/feel; the features fix what happens.

- **Opening a coding assistant on a repo makes the node read `working · <repo>` within the heartbeat
  window; closing it returns the node to `idle`** (the `aof session start|ping|end` hook contract + TTL).
  The **TTL value, ping cadence and self-expiry timing** are behaviour/ARCHITECTURE, not design.
- **Presence aggregates active runs + live sessions across ALL of a node's registered workspaces**, with
  `work_dir` resolved **ABSOLUTE** (F11). Task-feature / ARCHITECTURE. The whole region is a lie without it.
- **The session↔run reconciliation rule** — decided in ARCHITECTURE; the design consumes its verdict
  (**per-workspace**, §Correction 2) and says how it reads.
- **The web and desktop projections agreeing byte-for-byte** — S10 is a design rule, but proving it is a
  **contract test**, not a screenshot: `test/arch/acd-captured-producer-fixture.test.mjs`. Green.
- **The repo list is sorted deterministically** (DG-2 / S6) — a small task-feature outcome in both
  projections.
- **The assign affordance's picker is producer-fed and its result closes the loop to the m35 chip** (story
  04; ADR-012 / ADR-008) — the DATA (roster options, minted record → chip) is proven by task 03's
  `@executable` over the real route/verb; the VISUAL fidelity is §Surface 2, judged at `aof:verify`.
- **The picker annotates target liveness** (DG-5 / the open half of A6) — a small task-feature outcome on
  the option label.
- **A `@uat` visual-review scenario for the new region** — a person judges, on **both** surfaces (web +
  Rust desktop):
  1. a **running** node **beside** a working node (peer emphasis witnessed, not asserted);
  2. a **working-session** node (`working · <repo> (session)`);
  3. a **two-repo** node (one prefix, one qualifier, alphabetical);
  4. a **run + cross-workspace session** node (two lines, run first — the other workspace's session is
     **not** hidden);
  5. an **expired-session** node (falls back to `idle`, muted — no stuck `working`, no ghost).
  Hand this to the developer/product-owner as a candidate task `.feature`.
- **A `@uat` visual-review scenario for the assign affordance** (story 04; §Surface 2, DG-3/DG-4) — a person
  judges, on a **full board of milestone cards**: (a) the affordance reads as a quiet carve-out, not a
  control panel (A2 / DG-3 disclosure); (b) the empty-roster, one-node and many-node picker states (A4–A6);
  (c) assigning a real item and confirming the result is legible without re-checking (A7/A8 / DG-4).
