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
  - 2026-07-23 — §Correction 3. V10 (authored the same day) enumerated the terminal assignment states
    as "done / failed / reclaimed". `withdrawn` and `stale` fell through and read `waiting for output`
    forever. An ENUMERATION was the wrong instrument: the m35 chip ramp already decides terminal-ness
    and already owns the words. V10 now derives both from `assignmentChip(row)`. WITNESSED render F.
  All three wrong texts are struck through, not deleted.
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
  > **Story 06 (2026-07-19) carves out a SECOND exception — a READ one, not a mutation** — the read-only
  > terminal-VIEW that mirrors a worker's live PTY onto the fleet face (ADR-014). The fleet face previously
  > served NO terminal upgrade; it now serves a server→browser mirror. It adds NO write path: read-only IN
  > FACT and IN LOOK. See **§Surface 3**.
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

## Correction 3 — a state ENUMERATION in V10 leaked two terminal states (2026-07-23)

**Kept on purpose, and note again who was wrong: the designer, in a rule authored hours earlier.**

V10 (written at the first render pass) said the honest-empty copy applies to an assignment in a terminal
state **"(`done` / `failed` / `reclaimed`)"**. The fleet's assignment vocabulary has more terminal states
than that: **`withdrawn`** (operator-stopped, ADR-001) and **`stale`** both end an assignment, and both
fell through the list — so a withdrawn or stale assignment's terminal-view would sit on
`waiting for output` **forever**, which is the exact lie V10 exists to kill, at two new addresses. The
developer spotted the hole and correctly **refused to invent copy for them**.

**The enumeration was the wrong instrument.** `ui/src/fleet/assignments.mjs` (the m35 §4 ramp) ALREADY
decides which states are terminal and ALREADY owns the words for them: `withdrawn` reads as **`failed`**,
`reclaimed`/`stale` read as **`failed` + a `· reclaimed` note**, and an unrecognised state degrades to
`unknown`. A second, hand-maintained list of terminal states in the terminal-view is a **second
vocabulary for one fact** — the fourth-ramp mistake S5/A8 exist to prevent — and it drifts the moment a
state is added, which is precisely what happened within a day.

**V10 is corrected to derive BOTH terminal-ness and the wording from `assignmentChip(row)`.** No list.
The `TERMINAL_ASSIGNMENT_STATES` set is deleted. **WITNESSED render F (2026-07-23):** a `done` card reads
`no live output — assignment done`, a `stale`+`reclaimedAt` card reads `no live output — assignment
failed · reclaimed` — the SAME words the same card's assignment chip and node summary use.

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

> **Story 06 addendum — 2026-07-19, updated 2026-07-23.** Story 06 opens carve-out #2 on the read-only
> fleet face — a **READ-ONLY terminal-VIEW** that mirrors a worker's live PTY (ADR-014). It is a DIFFERENT
> surface from §Surface 1 (node card) and §Surface 2 (work-item card): a NEW live-stream view. Its binding
> checklist is authored below as **§Surface 3**, and **§Surface 3 BECOMES the conformance baseline
> `aof:verify` judges the terminal-view against.** No mock is owed (binding-checklist-only).
> ~~"**NO browser surface was built this pass** — story 06's three `@executable` tasks (00–02) delivered
> the BACKEND only …; the on-screen terminal-view is deferred to the `@manual` soak (task 03). Absent a
> built component AND a handed render, the terminal-view's verdict is **INCONCLUSIVE**."~~ —
> **SUPERSEDED 2026-07-23.** That text was CORRECT on 2026-07-19 and is kept because the INCONCLUSIVE it
> produced is the discipline working, not a failure. **Task 04 built the on-screen view**
> (`ui/src/fleet/terminal-view/FleetTerminalView.tsx` + `stream.mjs` + `view-state.mjs`, mounted from
> `ui/src/fleet/Fleet.tsx`), five real 1280px renders were handed to the designer across three passes, and
> §Surface 3's verdict moved INCONCLUSIVE → GAPS → **CONFORMS on all witnessed states, with a NOT-ASSESSED
> residue owed** — see its Review status.

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
| **run + cross-workspace session** | TWO lines: `running N run(s)` **over** `working · <repo> (session)` | both `primary` | a run in workspace A **and** a live session in workspace B. A's own session is subsumed; B's renders. The run line reads **first**. **NEW.** |
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

> **Addendum 2026-07-23 (story 06 / task 04).** The work-item card now has a **SEVENTH** region: §Surface 3's
> **read-only terminal-VIEW**, mounted as a further sibling **below** the assign affordance row
> (`Fleet.tsx` — `<AssignAffordance/>` then `<FleetTerminalView/>`). **A1's phrase "at the card FOOT" is
> therefore superseded**: the affordance is still a *sibling below the Open-board button and outside its
> clickable region* (A1's intent, unchanged and still binding), but it is no longer the last thing on the
> card. Confirmed in the 1280px renders of 2026-07-23. A1 is otherwise unchanged.

### The binding rules (A1–A11)

| # | Binding rule | |
| --- | --- | --- |
| **A1** | **Placement — its own row at the card FOOT, below the Open-board footer, on its own `border-t` divider.** The affordance is a **sibling** of the Open-board button, never nested inside it (an HTML `<button>` may not nest an interactive control). All five carried-forward regions render **verbatim**; the affordance adds height, it never displaces them. *("at the card FOOT" superseded 2026-07-23 — the terminal-view sits below it; the sibling/outside-the-button rule stands.)* | |
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

> **Note 2026-07-23 (a).** The renders handed for §Surface 3 DO show the affordance row (one-node roster,
> `umairs-msi` preselected, `Assign →` at rest) on all three milestone cards, but they were produced to
> exercise the TERMINAL states, not the affordance's own state axis (no empty roster, no multi-node roster,
> no in-flight/refused state, no freshly-minted `assigned` chip). §Surface 2's verdict therefore **stays
> INCONCLUSIVE**: a partial incidental frame is not the render this checklist owes. One observation is
> recorded from those pixels as **DG-11** (the footer attention cluster truncates to `a…`).
>
> **Note 2026-07-23 (b) — THE PRE-FIX PIXELS OF `Assign →` ARE VOID. See DG-12.** Until 2026-07-23 an
> unlayered `button,input,select,textarea{font:inherit}` in `ui/src/index.css` outranked every Tailwind
> utility layer, so **every `<button>` in the app silently ignored its own `text-*`/`font-*` classes**.
> Measured in the built bundle: `Assign →` computed **16px/400** while asking for `text-[11px] font-semibold`
> — it now computes 11px/600. **A2 is a rule about a button's WEIGHT** ("low-emphasis tint, not a solid
> filled button that shouts"), and smaller-but-bolder is a genuinely different quiet/found balance from
> larger-but-lighter. Any impression of the affordance formed from a pre-fix frame — including the
> incidental ones in note (a) — **must not be carried into §Surface 2's verdict.** The render this
> checklist owes must be taken **after** the CSS fix.

---

## Surface 3 — the fleet terminal-VIEW mirror (NEW — story 06, 2026-07-19)

**This is the milestone's SECOND fleet-face carve-out — a READ one, not a mutation — and the conformance
baseline for story 06's on-screen render.** Authored 2026-07-19; it did not exist before this pass.
`aof:verify 38` judges the terminal-view **region-by-region against V1–V12 and the terminal-view States
table** below. **There is no mock** (binding-checklist-only, as §Surface 1/§Surface 2).

> ~~"**NO browser surface was built this pass.** Story 06's three `@executable` tasks (00–02) delivered the
> BACKEND only … **Confirmed at source:** grep `terminal-view` across `ui/` = **0 matches** … There is
> **no `ui/` terminal-view component**. The on-screen rendering is part of the deferred `@manual` soak
> (task 03). Absent a built component AND a handed render, the verdict is **INCONCLUSIVE**."~~ —
> **SUPERSEDED 2026-07-23, and kept: it was TRUE when written, and the INCONCLUSIVE it forced is the
> discipline working.** The remedy it named has been carried out.

**BUILT 2026-07-23 (story 06 / task 04, BLOCKER F-38.06c).** The on-screen view now exists:
- `ui/src/fleet/terminal-view/FleetTerminalView.tsx` — the thin React consumer (xterm + FitAddon, the
  board dock's wiring with the INPUT half deliberately not ported; `disableStdin: true`).
- `ui/src/fleet/terminal-view/stream.mjs` — framework-free (nodeId, sessionId) resolution + the V1 header
  model (`terminalStreamHeader`, `readOnlyLabel`).
- `ui/src/fleet/terminal-view/view-state.mjs` — the framework-free state ramp
  (`waiting for output` / `streaming` / `stream ended` / `disconnected` / `no live output`), whose
  terminal-assignment copy derives from `assignmentChip(row)` (§Correction 3).
- Mounted from `ui/src/fleet/Fleet.tsx` on the **work-item (milestone) card**, as a sibling **below** the
  §Surface 2 assign affordance row (see §Surface 2's 2026-07-23 addendum).

**Governs:** the fleet view at `?mode=fleet` — the **read-only terminal-VIEW** that mirrors a worker's live
PTY byte stream, fed by the `/ws/terminal-view` route (`src/mesh-ui-serve.mjs`) over the in-memory ephemeral
mirror (`src/mesh-terminal-mirror.mjs`). **This is NOT §Surface 1's node card and NOT §Surface 2's work-item
card** — it is a NEW live-stream view, discovered by resolving an assignment's (nodeId, sessionId) via the
ADR-013 `session_id` (opening an assignment's card resolves its stream and subscribes).

**The binding rail this carves out (a READ carve-out, NOT a mutation):** m25 / §Surface-1 pinned a read-only
rail; §Surface 2 (story 04) carved out ONE mutation (assign). Story 06 carves out a NEW READ surface — the
fleet face, which previously served NO `/ws/terminal` and destroyed every upgrade (ADR-006), now serves a
server→browser terminal-VIEW. **This does NOT add a second mutation.** The terminal-view is read-only IN
FACT (ADR-014 invariant 1 / SECURITY T14): server→browser only, no mesh→PTY input path. Read-WRITE control
(keystrokes from the fleet) is a Phase-2 concern, structurally absent. **The design consequence: the view
must READ as view-only** — no input box, no send control, no type-into cursor — so the operator is never
misled into believing a keystroke reaches the worker.

### The terminal-view's anatomy — regions, in order (what a reviewer ticks against)

**Region 0 — placement + disclosure.** The view is a **per-card panel** on the work-item card, a sibling
BELOW the §Surface 2 affordance row, **collapsed by default** behind a `Watch terminal →` toggle. Regions 1
and 2 render **always** (collapsed or open); region 3 renders only when opened. A card whose assignment
carries **no resolvable (nodeId, sessionId) tuple renders NO panel at all** — not an empty frame, not a
disabled toggle (ADR-014 invariant 4 / V1). Judged against **V12**.

1. **Stream-identity header** — WHICH stream this is: the `nodeId` + the resolved assignment/session (the ADR-013 `session_id`, surfaced as the human assignment/ref it belongs to where possible, not a raw id alone). The operator must never be in doubt whose terminal they are watching. Judged against **V1**.
2. **READ-ONLY posture indicator** — an explicit, quiet `read-only` / `view only` marker so the view-only posture is legible by LABEL, not merely by the absence of an input box. Judged against **V2/V6**. The **state chip** sits here too: the short state word, never the long reason (V11).
3. **The live terminal byte stream** — the worker's `/ws/terminal` PTY output rendered as terminal text, in the SAME terminal rendering idiom the board-side `TerminalDock` already uses (mono, xterm-style) — no fleet-local terminal chrome. Live-tail-forward from subscribe; the mirror is ephemeral, so there is no disk scrollback. Judged against **V3/V4/V7**. Its **non-live message bar** (waiting / ended / disconnected / no-live-output) is judged against **V11**.
4. **NO input region** — there is NO text input, NO send button, NO keystroke-capturing cursor affordance. The row a read-write terminal would spend on an input box is **absent, not disabled** (a greyed input would falsely promise "coming soon" and invite the mis-read that you could type). Judged against **V2/V5**.

### The binding rules (V1–V12)

| # | Binding rule | |
| --- | --- | --- |
| **V1** | **The view always names its stream.** The header identifies the (nodeId, sessionId) being mirrored, resolved to the human assignment/ref where possible (ADR-013 `session_id`). A terminal with no visible owner is forbidden — the operator must know whose output this is at a glance. | ADR-013 |
| **V2** | **Read-only IN FACT and IN LOOK — no input affordance exists.** No text input, no send/submit control, no type-into cursor. The absence is structural (mirrors ADR-014 invariant 1: no mesh→PTY input path) and must be VISIBLE as read-only — the surface reads as a monitor, never as an attachable shell. | **load-bearing** · T14 |
| **V3** | **Reuse the existing terminal rendering — invent no fleet-local terminal vocabulary.** The bytes render in the board `TerminalDock`'s terminal idiom (mono, xterm-style), not a new fleet-specific terminal chrome, colour, or frame. | mirrors S5 |
| **V4** | **Live-tail-forward off an EPHEMERAL mirror — no fabricated backlog.** The mirror is in-memory and never a system of record (ADR-014); the view shows the live tail from the moment it subscribes. It must NOT fabricate scrollback, replay from disk, or imply durable history — kill the mirror and the view is empty, not wrong. | ADR-014 |
| **V5** | **A keystroke does NOT reach the worker — proven, not asserted.** The read-only-in-fact expectation: typing while the view is focused produces NO terminal-input frame toward the worker PTY. This is the load-bearing invariant the `@manual` soak proves LIVE (task 03) — the view may not even accept focus-to-type; if it does, the keystroke is inert. | T14 · ADR-014 inv.1 |
| **V6** | **Colour AND label travel together (read-only posture).** The read-only state is signalled by an explicit label (V2's marker), never by colour/icon alone — the same m25 rail §Surface 1 S4 pins. | m25 rail |
| **V7** | **Empty / rebuild-starts-empty is an HONEST state, not a spinner-forever nor an error.** Before any byte arrives — a fresh subscribe, or the mirror rebuilt empty — the view shows an honest waiting/empty state (e.g. `waiting for output` / `no live output yet`), NOT an infinite spinner, NOT a fabricated line, NOT a red error. An empty mirror is the NORMAL cold-start, not a failure. | |
| **V8** | **Multiplex is keyed by (nodeId, sessionId); streams NEVER cross-wire.** Multiple workers/sessions are multiplexed by (nodeId, sessionId) — the view for one stream renders ONLY that stream's bytes; a frame with no resolvable (nodeId, sessionId) is dropped, never bled into an unrelated view (ADR-014 invariant 4). Opening a second assignment's terminal shows a SEPARATE stream, correctly labelled (V1). | ADR-014 inv.4 |
| **V9** | **Stream-ended is legible — no frozen pretend-live.** When the session ends or the stream drops, the view says so (e.g. `stream ended` / `disconnected`) rather than freezing on the last frame as if still live. A dead stream must not masquerade as a live one — the same anti-ghost discipline §Surface 1 S8 pins for expired sessions. | mirrors S8 |
| **V10** | **`waiting` may only be said while output is still POSSIBLE — and the REASON is spoken in the m35 ramp's own words.** A stream whose assignment has reached a terminal state and has produced no bytes must never read `waiting for output`. **Terminal-ness AND the wording both come from `assignmentChip(row)` (`ui/src/fleet/assignments.mjs`) — never from the raw `state` string and never from a hand-maintained list:** chip label `done` or `failed` ⇒ terminal ⇒ the view reads **`no live output — assignment <chip.label>`**, plus the chip's own trailing ` · <note>` when it carries one (`· reclaimed`). Every other label — including the forward-compat `unknown` — is NOT terminal and keeps `waiting for output` (we may not assert output is impossible for a state we do not recognise). **Resolution stays tuple-only** (never state-filtered — a filter would hide a real stream, the A3/"membership not liveness" discipline); it is the LABEL that must tell the truth, not the routing. ~~"a TERMINAL state (`done` / `failed` / `reclaimed`)"~~ — **corrected 2026-07-23, §Correction 3: the enumeration leaked `withdrawn` and `stale`. WITNESSED render F.** | **NEW 2026-07-23** · mirrors S8 · A8 |
| **V11** | **A non-live message must never overprint the frame it describes — and never costs the CARD height.** The message is chrome, not output: the byte pane is `flex-1` in a column and the message is a **flow sibling bar BELOW it** (`border-t border-[#1e2a44]`, `bg-[#0f1629]`), so xterm refits into the smaller box and no glyph is ever covered. **The panel's TOTAL height is unchanged** — the bar is paid for out of the byte pane, never by growing the card (a card that grew when a stream ended would reflow every sibling in its stretched grid row, DG-9). The dead frame may be dimmed (`opacity-60`), but the LABEL always carries the meaning (V6 — dimming never travels alone). **The header state chip carries the STATE in the ramp's short vocabulary** (`waiting for output` · `streaming` · `stream ended` · `disconnected` · `no live output`); **the BAR carries the reason** (`no live output — assignment failed · reclaimed`). A chip that grows into a full sentence wraps the header and pushes the toggle out of its hierarchy (V12). Top-left placement is kept **only** for the empty-pane states (`waiting`, and `no live output` when zero bytes arrived), where nothing can be overprinted. | **NEW 2026-07-23** · mirrors V6/V9 |
| **V12** | **Disclosure: per-card, collapsed by default, identity ALWAYS on.** One card = one stream. The panel is collapsed behind a `Watch terminal →` toggle (the board's `→` action idiom); regions 1–2 (identity + `read-only`) render **even when collapsed**, so the posture is legible BEFORE the operator opens anything and no socket is opened until they do. **The toggle is the QUIETEST element in the header** — the reading order is identity > `read-only` marker > state > toggle; a toggle that outweighs the stream's own name inverts a monitor into a control. A card with no resolvable tuple renders **no panel at all**. | **NEW 2026-07-23** · resolves DG-8/DG-7 |

RATIONALE for **V2/V5** (the rules the review exists to enforce): a worker terminal that LOOKS interactive
but silently swallows keystrokes is a worse lie than no terminal — the operator would believe they answered
a `needs-input` prompt when nothing reached the worker. Read-write is Phase-2; until then the honest surface
is a MONITOR that visibly cannot type, and the "does a keystroke reach the worker" question is un-fakeable,
so it is the soak's central assertion (task 03).

RATIONALE for **V3/V4**: the fleet already borrows the board's terminal rendering; a second terminal
vocabulary would be the fourth-ramp mistake §Surface 1 S5 exists to prevent. And the mirror is DERIVED
liveness, not data (ADR-014) — presenting it as durable scrollback would tell the operator the fleet
remembers what it explicitly does not.

RATIONALE for **V7/V9**: the mirror's ephemerality means empty-on-cold-start and empty-on-rebuild are the
DESIGNED normal, not errors; and a stream that ended must read as ended, mirroring the milestone's core
anti-lie discipline (never show a liveness the source no longer asserts, §Surface 1 S8).

RATIONALE for **V10**: `waiting for output` is a PROMISE. On a live assignment it is honest — bytes are
plausibly next. On a finished one it is the same species of lie as a stuck `working`: the surface asserts
an expectation the source can no longer meet, and the operator sits watching a window that will never move.
The fix is copy, not routing — **never filter the stream away** (that would hide a real captured session
and repeat DG-5's mistake of throwing information away at the moment of choosing). And the copy is
**borrowed, not minted**: the m35 chip ramp already decides that `withdrawn` reads `failed` and that
`reclaimed`/`stale` read `failed · reclaimed`. A terminal-view that spelled those states its own way would
be a second assignment vocabulary on one card — A8's rule, at a new address (§Correction 3).

RATIONALE for **V11**: the ended message and the last frame occupy the same pixels, so the reader loses
both — the state message AND the final output line, which is precisely the line they came to read. Chrome
that destroys the content it annotates is worse than no chrome. Two further constraints make the flow-bar
the right answer rather than an overlay: an absolute overlay still covers the newest line (measured), and
a bar that ADDED height would make every sibling card in the stretched row jump at the moment a stream
ends. Paying for the bar out of the byte pane costs ~29px of tail **only in the dead states**, where no
further bytes are coming and the operator's need has shifted from watching to reading the last lines.

RATIONALE for **V12**: a permanently-open 192px black viewport on every assigned card would convert the
fleet from a monitor you scan into a wall of terminals you cannot scan (the DG-3 concern, one order of
magnitude louder), and would open N sockets on page load for streams nobody is watching. Collapsed-by-
default with the identity + `read-only` label always visible gives the operator the FACT (this card has a
watchable, read-only stream, and whose it is) at monitor cost, and the BYTES only on request. The
multi-pane "wall" (RESEARCH §4.3/§4.5) remains future work, deliberately.

### States (the terminal-view's own state axis — the story-06 state set)

| State | Chip (header) | Bar (below the bytes) | When |
| --- | --- | --- | --- |
| **no stream** | *(no panel at all — no header, no toggle, no empty frame)* | — | the assignment carries no `sessionId` (or no `targetNodeId`): a half-tuple resolves to nothing (ADR-014 inv.4) |
| **collapsed (at rest)** | *(no state chip)* — identity + `read-only` + `Watch terminal →` only; **no socket open** | — | the default for every resolvable stream |
| **empty / cold-start** | `waiting for output` | *(top-left placement, empty pane)* | subscribed, no byte received yet; OR the mirror was rebuilt (starts empty) |
| **streaming (live)** | `streaming` (pulsing dot) | — (full-height byte pane) | frames flowing for this (nodeId, sessionId) |
| **multiplexed** | each open stream is its OWN correctly-labelled view; no cross-wiring | | ≥2 (nodeId, sessionId) streams open |
| **ended / disconnected** | `stream ended` / `disconnected` | `stream ended` / `disconnected`, frame dimmed | session ended or the stream dropped |
| **terminal-state assignment, no bytes** | `no live output` | `no live output — assignment <m35 chip label>` (+ `· reclaimed`) | the stream resolves but its assignment is terminal per `assignmentChip` (V10). **Witnessed render F** |
| **unresolvable** | the view is not shown / the frame is dropped — never bled into another card | | a frame with no resolvable (nodeId, sessionId) (ADR-014 inv.4) |

### Design ramp for the terminal-view

- **Terminal bytes = the board `TerminalDock` rendering idiom** (mono, xterm-style) — reused, not reinvented (V3).
- **Read-only posture = an explicit quiet marker + the ABSENCE of any input affordance** — legible by label, not colour alone (V2/V6).
- **Empty / ended = honest text states**, never a spinner-forever or a red error for the NORMAL cold-start/ended cases (V7/V9), never overprinting the bytes, and never growing the card (V11). A genuine transport failure is the existing fleet read-failure token (`destructive`), reused — no terminal-local error primitive.
- **Terminal-assignment wording = the m35 assignment ramp's own labels** (V10) — borrowed, never minted.
- **No new fleet-local terminal chrome, colour, badge, or "streaming" accent.** The review flags any
  terminal-view-specific primitive as a gap (mirrors S5/A9).

### RATIONALE

- **Why a read-only MONITOR that visibly cannot type (not a disabled interactive shell):** read-write is
  Phase-2 (ADR-014). A terminal that looks attachable but is inert teaches the operator to distrust the
  surface — worse than showing nothing. The honest move is a view that IS a monitor and SAYS so.
- **Why reuse the board terminal idiom (V3):** the fleet already renders a terminal (board-side); a second
  terminal look would be a fourth vocabulary. One terminal idiom, spoken on two surfaces.
- **Why empty is normal, not an error (V7):** the mirror is ephemeral and never a system of record — a
  cold or rebuilt mirror is EXPECTED to be empty; painting that as a failure would lie about the design.

### Review status — Surface 3 — **CONFORMS on all witnessed states; NOT-ASSESSED residue owed** (2026-07-23; three render passes)

**The verdict moved INCONCLUSIVE (2026-07-19) → GAPS (first two passes) → CONFORMS-on-witnessed (this pass).
All three gaps — GAP-1, GAP-2, GAP-3 — are CLOSED against real pixels.** What remains is NOT a divergence: it
is a set of states never put in frame (the collapsed default, `disconnected`, mirror-rebuilt-empty, V8 at
byte level) plus the inherently non-pixel V5 — recorded **NOT ASSESSED** per §Default-10, never assumed. A
single fresh frame of the collapsed default is the one thing between this and an unqualified whole-surface
CONFORMS.

> **The 2026-07-19 INCONCLUSIVE, retained:** *no browser surface was built this pass, no mock pre-existed,
> and no render was handed.* `grep terminal-view` across `ui/` returned 0 matches. The honest verdict was
> INCONCLUSIVE naming the missing input — **not** a CONFORMS/GAPS inferred from the relay/mirror/route code.
> **The remedy it demanded (build the view, render it, judge the pixels) has been carried out**, which is
> the only reason a verdict is possible today.

**Judged from FIVE real 1280px renders** of the **built `ui/dist`** fleet at `?mode=fleet&scope=global`,
served against a fixture `/api/mesh/status` and a fixture `/ws/terminal-view`, driven in headless Chromium
over CDP — the terminals were opened by a real click and real bytes really streamed. The orchestration
rendered; the designer judged. Renders:

- **A — empty / cold-start** (socket open, zero bytes sent).
- **B — streaming live AND multiplexed** (milestone 38 → `umairs-mac-mini`, milestone 39 → `umairs-thinkpad`, both open).
- **D — stream ended** (server closed the socket cleanly). *First pass.*
- **E — stream ended, after the GAP-1 / GAP-2 fixes.** *Second pass, same day.*
- **F — two TERMINAL-STATE cards** (`done`; `stale`+`reclaimedAt`), each with a captured session and zero bytes. *Third pass — V10.*

In A/B/D/E the THIRD card (milestone 40) holds an assignment with **no `sessionId`** (no panel). In F,
cards 38 and 39 carry captured sessions on TERMINAL assignments; card 40 stays `assigned`, no panel.

#### Region ledger

| Region | Verdict | Evidence |
| --- | --- | --- |
| **0 · placement + disclosure** | **CONFORMS (open half) · NOT ASSESSED (collapsed half)** | All renders: the panel is a sibling below the assign row, inside the card's content box, on the card's own `mt-3` rhythm. Cards with no `sessionId` render **no panel at all** — no header, no toggle, no empty frame. The **collapsed at-rest** presentation — the DEFAULT every operator sees — is in **none** of the five captures (all show `Hide terminal`). See NOT ASSESSED. |
| **1 · stream-identity header** | **CONFORMS** | A/B/D/E/F: `38 → umairs-mac-mini · session 5f3c1e00-ab90-4d21-9f7a…` and `39 → umairs-thinkpad · session 7e21aa10-cd34-4a55-8b0c…`. Human ref + node + session, never a raw id alone. |
| **2 · read-only posture marker + state chip** | **CONFORMS** *(GAP-2 closed at render E)* | `READ-ONLY` pill in neutral zinc in **every** state, beside a dot+label state chip. Render F: the chip reads the short `● no live output` on both terminal-state cards, does not wrap, and the toggle stays on-row — the hierarchy holds. |
| **3 · live byte stream + message bar** | **CONFORMS** *(GAP-1 closed at render E; GAP-3 witnessed at render F)* | A: empty. B: live tail in the dock idiom. E: `stream ended` on a flow bar below a refitted pane, dead frame dimmed, last line legible. F: `no live output — assignment done` / `no live output — assignment failed · reclaimed`, top-left over an empty pane (nothing to overprint). |
| **4 · NO input region** | **CONFORMS — witnessed ABSENT** | All renders: below the byte area the panel simply ends. No input box, no send control, **no disabled input**, no prompt row, no caret in the empty viewport. Absent, not disabled — exactly V2's "structural absence." |

#### Rule ledger (V1–V12)

| Rule | Ruling | What I saw |
| --- | --- | --- |
| **V1** | **CONFORMS** | Every open terminal names its stream with the human ref + node + session. The negative half is witnessed too: a card with no `sessionId` renders **no terminal at all** — never a guessed session, never an anonymous terminal. |
| **V2** | **CONFORMS** | Explicit `READ-ONLY` label in all states; no input affordance of any kind, disabled or otherwise. |
| **V3** | **CONFORMS** | The chrome is the board `TerminalDock`'s, reused: same `▣ TERMINAL` lockup, same `#0f1629` / `#1e2a44` / `#0b0f14` values, same dot+label state ramp. The message bar uses those same two tokens — **no new primitive minted.** **The wide, letter-spaced glyphs are NOT scored** — see NOT ASSESSED / ARTIFACT. |
| **V4** | **CONFORMS** | Render A is the proof: a subscribed socket with zero bytes shows an **empty** viewport — no fabricated backlog. Render F's terminal-state cards likewise show zero fabricated scrollback behind the `no live output` message. |
| **V5** | **NOT ASSESSABLE FROM A RENDER (by nature)** | "Does a keystroke reach the worker" is not a pixel fact. Closed by the task-03 `@manual` soak + the structural `acd-fleet-terminal-mirror-read-only` fitness. |
| **V6** | **CONFORMS** | Posture by LABEL, not colour; every state ships dot **and** text. Render E's dimmed dead frame is an *additional* cue behind a label that still carries the meaning — dimming does not travel alone. |
| **V7** | **CONFORMS** | Render A: `waiting for output`, muted, **static** dot. No spinner, no motion, no red, no fabricated line. Motion is reserved for `streaming` (render B: pulsing `primary` dot). |
| **V8** | **SPLIT — header-level CONFORMS · byte-level NOT ASSESSABLE FROM THESE RENDERS** | Render B shows two views open at once, each headed with its OWN tuple, plus a third card with no tuple and no panel. But **both viewports show byte-identical text** (the fixture's node-naming lines had scrolled out of the pane). **EVIDENCE-GAP-1**, a harness gap, still open. |
| **V9** | **CONFORMS — GAP-1 CLOSED at render E** | The header chip AND the bar both read `stream ended`, the frozen frame is dimmed, and the last output line survives. A dead stream cannot be mistaken for a live one, and reading it costs nothing. |
| **V10** | **CONFORMS — WITNESSED render F, and CORRECTED §Correction 3** | Card 38 (`done`) → header `● no live output`, bar `no live output — assignment done`. Card 39 (`stale`+`reclaimedAt`, chip degrades to `! failed`, node summary `1 failed`) → header `● no live output`, bar `no live output — assignment failed · reclaimed`. **Both bars use the SAME words the same card's assignment chip and node summary use** — the derivation from `assignmentChip(row)` is witnessed end-to-end, not asserted. The leak is closed: `stale`/`withdrawn` no longer sit on `waiting for output`. |
| **V11** | **CONFORMS** | Render E witnesses the ended-state bar + constant-total-height; render F witnesses the chip/bar SPLIT (chip = short state `no live output`, bar = full reason). The chip stays in-family and never wraps the header. |
| **V12** | **CONFORMS in "identity always on" + hierarchy · NOT ASSESSED in its collapsed half** | GAP-2 closed at render E; the toggle is the lightest header element (measured 11/400, class `text-[11px] text-zinc-400`, no `font-semibold`). The collapsed frame was never captured. |

#### The gaps — ALL CLOSED

**GAP-1 · region 3 · the non-live message overprinted the frozen frame — CLOSED 2026-07-23 (render E).**
- **Was:** render D painted `stream ended` unbacked over `  Reading STORY.md + task features..`; neither
  was readable (inherited from `TerminalDock`'s ERROR overlay, which in the dock only ever fires over an
  effectively empty pane).
- **Now:** the byte pane is `flex-1` in a `flex flex-col` and the message is a **flow sibling bar** below it
  (`border-t border-[#1e2a44] bg-[#0f1629]`), so xterm **refits** into the smaller box. Render E: the last
  line (`18 modules)`) is fully legible and `stream ended` sits below it in the dock's own tokens; the dead
  frame is dimmed to `opacity-60`.
- **The 163px bytes + 29px bar trade is RATIFIED**, and the reason is bound into V11: **192 = 163 + 29 keeps
  the panel's TOTAL height constant**, so a stream ending causes **no reflow** of the card or its stretched
  grid-row siblings. The cost is paid only in the dead states, exactly when no more bytes are coming and the
  operator's need has shifted from watching to reading the tail. The developer **measured** that the
  absolute-overlay option still covered the newest line (last row y 162–184 under a 29px bar) and took
  V11's other named treatment rather than papering over it — the correct response to a two-treatment rule.
- **Accepted, not a gap:** `stream ended` appears twice (header chip + bar). The two serve different reading
  moments, and with V10 in place the two strings deliberately diverge (chip `no live output`, bar
  `no live output — assignment failed`).

**GAP-2 · region 2 · the toggle was the loudest thing in a read-only monitor's header — CLOSED
2026-07-23 (render E); root cause found, not papered over; the residual is now also clean.**
- **Root cause:** an unlayered `button,input,select,textarea{font:inherit}` in `ui/src/index.css` outranked
  every Tailwind utility layer — **every `<button>` in the app silently ignored its `text-*`/`font-*`
  classes**. The toggle computed **16px/400**. Tailwind's preflight already ships the identical rule inside
  `@layer base`, so the duplicate was deleted (not patched around). This is the app-wide **DG-12**.
- **Now:** measured header `lockup 11/600 | identity 11/400 | read-only 10/600 | state 11/400 |
  toggle 11/400` — the toggle is the lightest element, the reading order V12 asks for, confirmed in render E.
- **The residual I flagged is CLOSED (coordinator confirmed at source 2026-07-23):** the built component's
  toggle class is `text-[11px] text-zinc-400` with **no** `font-semibold` — the `font-semibold removed`
  text is prose in a code comment, not in the class string. Class and computed value agree at 11/400. The
  hierarchy is right by construction, not by accident. No action.

**GAP-3 · region 3 copy · `waiting for output` on a stream that can never produce output — CLOSED
2026-07-23 (render F), via §Correction 3.**
- Implemented at the presentation layer only; routing stays tuple-only. **V10 as first written enumerated
  three terminal states and leaked `withdrawn` and `stale`** — the enumeration was replaced by a derivation
  from `assignmentChip(row)` (§Correction 3), the `TERMINAL_ASSIGNMENT_STATES` set deleted, `withdrawn` and
  `stale` explicitly guarded (20 assertions green, per the developer). Render F witnesses both terminal-state
  cards reading `no live output — assignment …` in the m35 ramp's own words. Closed.

**EVIDENCE-GAP-1 · V8 byte-level · the harness cannot prove no-cross-wiring. STILL OPEN (harness, not build).**
- Prefix **every** emitted line with the node short name (e.g. `[mac-mini] … worker heartbeat`), or capture
  within the first frames, then re-hand render B. Until then V8's byte-level half stays NOT ASSESSED — the
  structural tuple-keying evidence in `stream.mjs` is a CODE fact, and this review does not accept code in
  place of pixels.

#### NOT ASSESSED — do not infer (the honest residue)

- **The collapsed at-rest presentation** — the state EVERY operator sees by default, and it is in none of
  the five captures (all were driven open). A render of a resolvable card **collapsed** is owed: it is the
  only way to judge V12's own default, the header's wrap behaviour without the state chip, and whether a
  dark strip on every assigned card is quiet enough for a monitor. **This is the one frame between the
  surface and an unqualified CONFORMS.**
- **V8 at byte level** — see EVIDENCE-GAP-1.
- **V5 (a keystroke cannot reach the worker)** — not a pixel question; owed by the task-03 `@manual` soak.
- **The `disconnected` (transport-failure) state** — never rendered. Its `destructive` token, and whether a
  genuine failure reads distinctly from a clean `stream ended`, are unjudged.
- **The mirror-rebuilt-empty half of V7** — render A proves cold-start-empty; a rebuilt-mid-stream mirror
  was not staged.
- **THE GLYPH WIDTH IS A PROBABLE ARTIFACT, NOT A DESIGN FACT.** The terminal text renders wide and
  letter-spaced in all captures with bytes (B/D/E). Positive evidence it is headless font substitution: the
  component requests the **same** stack the board dock requests
  (`var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)`), the headless container has none of
  those, and in the *same* capture the DOM's own mono text (`C:/Source/umair/aof`, `fabric addr:`, the node
  ids) renders at normal width — the distortion appears only inside xterm's measured character cells.
  **This is NOT scored against V3.** (Render F's message text is DOM, not xterm, and renders at normal
  width — corroborating the diagnosis.)
- **390 / 768 breakpoints** — carried forward from §Surface 1/2: unrenderable for this page. **This verdict
  covers 1280 alone.**

#### What's owed at `aof:verify`

- **A re-render** covering: (a) the **collapsed** default (V12) — the last unwitnessed state of this
  surface; (b) render B re-shot with per-line node naming (EVIDENCE-GAP-1); (c) ideally the `disconnected`
  state.
- The **`@manual` outsider soak** (task 03) — a REAL worker's live terminal in the REAL fleet view, routed
  to the correct node/session; **a keystroke does NOT reach the worker** (V5); live multiplex across two
  workers (V8); no on-screen secret (T14). Still the un-fakeable human gate.

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

### Debt note — 2026-07-23 — these frames were judged under a global button-type bug (DG-12)

**The S1–S11 verdicts above STAND.** The current-work region is plain `text-[13px]` spans, not a
`<button>`, so the unlayered `font:inherit` rule that broke every button in the app (DG-12) could not have
touched the pixels those rulings rest on — including S3's peer-emphasis claim, whose two labels are both
spans in one card.

**What IS owed is a CONTEXT re-look, not a re-judgement.** On those frames every button on the page —
the card's own `Open board →` wrapper, the scope toggle, `legend` — rendered at **16px/400** instead of its
specified type. Design conformance for a region is partly a claim about its **relative prominence among its
neighbours**, and the neighbours have now changed weight. **One fresh 1280 frame of `GlobalNodePanel` is
owed at `aof:verify`**, to confirm the current-work region still reads as the region these verdicts
describe — e.g. that it has not been quietly out-shouted by a now-correctly-semibold `Open board →`. Cheap,
and it closes the honest doubt rather than carrying it silently.

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
  the render, against A2.** *(2026-07-23: the terminal-view chose progressive disclosure for its own,
  heavier panel — V12. That is a precedent for this decision, not a decision of it. Note also that the
  affordance's true weight has only been visible since the DG-12 CSS fix.)*

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

### DG-6 — the terminal-view has NO built UI and NO render; the whole on-screen surface is deferred (NEW, m38 / story-06) — **CLOSED 2026-07-23**

- **Observed (confirmed at source):** story 06 delivered the BACKEND only — relay bridge, in-memory mirror,
  read-only `/ws/terminal-view` route. There is **no `ui/` terminal-view component** (grep `terminal-view`
  in `ui/` = 0 matches; `Fleet.tsx` has no terminal reference). §Surface 3 is therefore authored from
  ADR-014 intent, **un-rendered** — a baseline with nothing on screen to judge against yet.
- **Why it matters:** an INCONCLUSIVE with no render is the honest verdict, but it must be CLOSED — skipping
  the render+judge leaves the read-only-in-fact (V2/V5), empty/rebuild-starts-empty (V7), multiplex (V8) and
  stream-ended (V9) claims **unwitnessed**, exactly the "confident CONFORMS on an unseen surface" trap
  §Correction 1 exists to prevent.
- **The correct answer (developer builds; designer judges):** build the on-screen terminal-view component,
  render it in the V7 / streaming / multiplex / ended states, and judge region-by-region against **V1–V9**.
- **Resolution:** closed at `aof:verify 38` via the task-03 `@manual` soak + a render pass handed to the
  designer. ~~**Deferred — the render is the missing input.**~~ — **CLOSED 2026-07-23.** The component was
  built (task 04) and five real renders were handed and judged across three passes; V1/V2/V3/V4/V6/V7/V9/
  V10/V11 and the multiplex header are now **witnessed**, three gaps were found and fixed against the pixels,
  and V5 + V8-at-byte-level + the collapsed default remain the honest residue. The lesson stands: **the
  render is what converts a checklist into a verdict** — and this milestone got the stronger form of it, a
  render that *changed the build three times*, corrected a rule (§Correction 3), and exposed an app-wide CSS
  bug no test had caught (DG-12).

### DG-7 — read-only legibility: absence-of-input is not self-evidently "read-only" (NEW, m38 / story-06, load-bearing-adjacent) — **DECIDED 2026-07-23**

- **Observed (structural, from ADR-014 + §Surface 3 intent — NOT a render verdict):** a terminal that
  renders live output but silently ignores keystrokes can be mistaken for a BROKEN interactive shell. V2
  pins that the read-only posture must be legible by an explicit marker, but the exact treatment (a `read-only`
  badge vs. a banner vs. a non-typeable cursor state vs. the view simply not accepting focus) is the open
  half of the rule.
- **Why it matters:** the worse-than-no-terminal lie — the operator believes they answered a `needs-input`
  prompt when nothing reached the worker (the whole reason V5 is the soak's central un-fakeable assertion).
- **The correct answer (designer owns it):** an explicit read-only affordance; **pick the treatment at the
  render, against V2.** — **PICKED 2026-07-23, at the render: a persistent quiet `read-only` pill in the
  stream-identity header (rendered even when the panel is collapsed), plus xterm `disableStdin` and NO input
  row at all (absent, not disabled).** Not a banner (too loud for a monitor), not a fake/greyed cursor
  (a promise of "coming soon"). Bound in **V12**; the pill is witnessed in all five renders.
- **Resolution:** a DESIGN.md rule picking the treatment **plus a `@uat` scenario** (a person tries to type,
  confirms the view says read-only, and confirms nothing reaches the worker). **Rule DECIDED; the `@uat`
  scenario remains owed at the soak.**

### DG-8 — the multiplex disclosure model is unpinned: how the fleet shows MORE than one worker terminal at once (NEW, m38 / story-06) — **DECIDED 2026-07-23**

- **Observed (structural):** ADR-014 routes by (nodeId, sessionId) and pins "opening an assignment card
  resolves its stream", and V8 pins the no-cross-wire invariant — but the DISCLOSURE model for N
  simultaneous streams (one-at-a-time per card vs. tabbed vs. a herdr-style multi-pane wall — RESEARCH
  §4.3/§4.5) is a design decision the backend does not settle.
- **Why it matters:** herdr's whole value is watching several workers at once; a one-at-a-time model may be
  honest but under-delivers the operator's stated end-state (STORY §Background).
- **The correct answer (designer owns it):** **pick the multiplex disclosure model** — per-card single
  stream for this story (with the multi-pane wall noted as future work), OR a wall now — and **state it, not
  leave it implicit.** — **PICKED 2026-07-23: per-card, one card = one stream, collapsed by default behind
  `Watch terminal →`, identity + `read-only` always on.** Bound as **V12**. N cards may be open at once
  (render B proves two side by side), so the operator can still watch several workers — but the board is not
  a wall by default. **The multi-pane wall is explicitly future work.**
- **Resolution:** a DESIGN.md rule + a `@uat` scenario (a person opens two workers' terminals and judges the
  presentation). **Rule DECIDED; the `@uat` scenario remains owed.**

### DG-9 — one open terminal inflates every sibling card in its grid row (NEW, m38 / story-06, from the pixels)

- **Observed (renders A/B/D/E/F):** the milestone cards sit in a stretched 3-column grid (the S9 rail:
  siblings match height so the row stays clean). Opening ONE terminal grows its card by ~250px, and the grid
  grows **every** card in that row with it — a card with no terminal (milestone 40) carries ~300px of dead
  white space in every capture.
- **Why it matters:** it is the S9 rail behaving as designed, but at a scale S9 never contemplated (S9
  budgeted for ONE extra text line, not a 192px viewport). At 2–3 open terminals per row the board becomes
  mostly whitespace, which erodes exactly the scan-ability the read-only monitor exists for.
- **Related, and already handled:** V11's constant-total-height clause keeps a stream *ending* from adding
  yet another reflow on top of this. The open/close reflow itself is unaddressed.
- **The correct answer (designer owns it):** decide between (a) accepting the stretch (simple, keeps row
  integrity — the current behaviour), (b) letting an open terminal card break the stretch (`items-start` on
  the grid, so siblings keep their natural height), or (c) promoting an opened stream out of the card grid
  entirely into a docked pane — which is the door to DG-8's multi-pane wall. **Judge it against a render of
  a board with ONE terminal open and several rows of cards**, which is not in the current set.
- **Resolution:** a DESIGN.md rule + a `@uat` scenario (a person opens one terminal on a full board and
  judges whether the board is still scannable). **Deferred.**

### DG-10 — the identity line spends its width on a raw session UUID (NEW, m38 / story-06, small)

- **Observed (renders A/B/D/E/F):** the header reads `38 → umairs-mac-mini · session 5f3c1e00-ab90-4d21-9f7a…`
  — the raw 36-char UUID consumes most of the identity line and still truncates mid-token, and it is the
  one part of the line that carries no discriminating power for a human (`38 → umairs-mac-mini` already
  identifies the stream uniquely on this board).
- **Why it matters:** V1 is satisfied (the stream IS named, and never by a raw id ALONE), so this is a
  polish finding, not a violation. But a mid-token ellipsis reads as "data was lost", and the noisiest text
  in the region is the least useful. It also competes for the header width that V11's chip vocabulary and
  V12's toggle both need.
- **The correct answer (designer owns it):** render the **short session** (`session 5f3c1e00`, the first
  segment — the same 8-char idiom the fixture and the mirror logs already use) and keep the FULL id in the
  existing `title` tooltip, which the component already sets. The human ref + node stay the primary
  identity.
- **Resolution:** developer changes `sessionLabel` in `ui/src/fleet/terminal-view/stream.mjs`; re-render.
  Small; does not block the verdict. **Deferred.**

### DG-11 — the work-item card's attention cluster truncates to `a…` (NEW, m38 / story-04 surface, from the story-06 pixels)

- **Observed (all renders, all three cards):** region 5's footer attention cluster renders as a single
  character plus an ellipsis — `a…` — beside the run/assignment chip. Whatever fact it is carrying is
  unreadable.
- **Why it matters:** a label truncated to one character is not a quiet label, it is noise: it costs layout
  width, draws the eye, and tells the operator nothing. §Surface 2 A8 pins the cluster as where the
  assignment ramp SPEAKS; here it says nothing.
- **The correct answer (designer owns it):** the cluster must either render a legible minimum (the chip's
  own label, wrapping or dropping the least-load-bearing element first) or **drop the element entirely**
  when it cannot render legibly — never a one-character stub. Same discipline as S6's "trailing truncation
  is acceptable" rail: truncation is acceptable **while the label is still readable.**
- **Note:** a **§Surface 2** finding seen incidentally in §Surface 3's renders; NOT part of the
  terminal-view verdict. May also be an artifact of the fixture's narrow footer content — confirm against a
  producer-fed, post-DG-12 render before acting. **Deferred.**

### DG-12 — an unlayered CSS rule made EVERY button in the app ignore its own type classes (NEW 2026-07-23, app-wide, cross-milestone)

- **Observed (measured in the built bundle, found while root-causing GAP-2):** `ui/src/index.css` carried a
  hand-written **unlayered** `button,input,select,textarea{font:inherit}`. Tailwind v4 places all utilities
  in `@layer utilities`, and **unlayered CSS outranks any layer** — so every `<button>` in the app silently
  ignored its `text-*` and `font-*` classes and inherited the body type instead. Tailwind's preflight
  already ships the identical rule inside `@layer base`; the duplicate was deleted (not patched around).
- **Measured before → after:** terminal-view toggle 16px/400 → 11px/400 · `Assign →` 16px/400 → 11px/600 ·
  board `ActionsStrip` buttons 16px/400 → 14px/500 · `DetailPanel` tabs → 11px/600.
- **Why it matters to DESIGN, not just to CSS:** a design-conformance verdict is a claim about pixels, and
  **every verdict taken on a button-bearing surface before 2026-07-23 was taken under this bug.** The
  affected claims are specifically those about a control's **weight, size and relative prominence** —
  which is exactly what the fleet's "quiet, subordinate carve-out" rail (A2) is made of. Nothing here is
  *wrong* yet; it is *unverified*, and that must be said out loud rather than assumed away.
- **The debt, named honestly:**
  - **§Surface 1 (m38):** verdicts **STAND** — the current-work region is spans, not buttons. **Owed: one
    fresh 1280 frame** to confirm the region's relative prominence among now-correctly-typed neighbours
    (see the §Surface-1 debt note).
  - **§Surface 2 (m38):** already INCONCLUSIVE; the debt is sharper because **A2 is a rule about a button's
    weight**. Pre-fix impressions of `Assign →` are **void**; the owed render must be post-fix.
  - **§Surface 3 (m38):** unaffected — its only pre-fix button finding was GAP-2, which is what exposed the
    bug, and it has been re-rendered post-fix (renders E and F).
  - **Other milestones' surfaces** (board `ActionsStrip`, `DetailPanel` tabs, m25 chrome): **NOT m38's to
    re-judge.** Recorded here so the debt is not lost with this milestone.
- **The correct answer (designer owns it):** (a) treat this as the trigger for a **one-frame re-look of every
  surface with a binding rule about control weight**, tracked in the milestone that owns each surface; and
  (b) a standing rule — **global element resets belong in `@layer base`, never unlayered**, because
  unlayered CSS silently outranks the utility classes the design is written in.
- **Resolution:** a DESIGN.md rule (b, above) **plus a `@uat` visual-review pass** over the re-rendered
  surfaces. Not a code patch alone — the patch is already in; the *judgement* is what is owed. **Deferred to
  the owning milestones.**

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
   render of the surfaces production actually mounts** — §Surface 1a (web) and §Surface 1b (desktop),
   §Surface 2 (the story-04 assign affordance on the work-item card), and §Surface 3 (the story-06 read-only
   terminal-view).
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
13. **The fleet terminal-VIEW is a READ carve-out, not a mutation — read-only IN FACT and IN LOOK.** The
    fleet face gains a server→browser terminal-VIEW (story 06 / ADR-014) but adds NO write path: NO input
    box, NO send control, NO type-into cursor (the input region is **absent, not disabled**). Read-write
    terminal control is Phase-2, out of scope. The bytes reuse the board terminal idiom (no fleet-local
    terminal vocabulary); the mirror is ephemeral, so empty-on-cold-start / rebuild-starts-empty is the
    NORMAL state, not an error, and a stream that ends reads as ended. **(§Surface 3, V2/V4/V5/V7/V9.)**
    **Witnessed 2026-07-23** in five real renders — the `read-only` label, the absent input row, the empty
    cold-start, the reused dock idiom and the honest terminal-state copy are no longer asserted, they are seen.
14. **The terminal-view is disclosed PER CARD, collapsed by default; its identity and `read-only` label are
    NOT.** One card = one stream, opened on request behind `Watch terminal →` (so no socket opens for a
    stream nobody watches), while the stream-identity header and the `read-only` marker render always — the
    posture is legible before the bytes are. The multi-pane wall is future work. **(§Surface 3 V12; resolves
    DG-7's treatment and DG-8's model.)**
15. **State messages are CHROME: they never overprint the output they describe, never grow the card, and
    the chip says the STATE while the bar says the REASON.** A message painted over the frozen frame
    destroys both facts; a bar that adds height reflows every sibling card in a stretched row at the moment
    a socket closes; a chip that grows into a sentence wraps the header and demotes the identity. And
    `waiting` may only be said while output is still possible — a perpetual `waiting for output` on a
    finished assignment is the same species of lie as a stuck `working`. **(§Surface 3 V10/V11, witnessed
    renders E and F.)**
16. **A design verdict is only as good as the stylesheet that produced it.** When a global style bug is
    found (DG-12: an unlayered `font:inherit` that made every `<button>` ignore its own type classes), every
    verdict taken under it is **named and re-looked**, not silently assumed to survive. The corollary rule:
    **global element resets belong in `@layer base`, never unlayered** — unlayered CSS outranks every
    Tailwind layer, so it silently beats the utility classes the design is written in. *(This is
    §Correction 1's lesson in a new register: a review is only as true as the thing it was pointed at.)*
17. **A terminal-view never mints assignment vocabulary — it speaks the m35 ramp's words.** Terminal-ness
    and wording both come from `assignmentChip(row)`, so `withdrawn`, `reclaimed` and `stale` inherit the
    right copy without a second list to maintain. **(§Correction 3, V10; A8's rail at a new address;
    witnessed render F.)**

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
- **The worker's live PTY streams cross-machine into the fleet terminal-view, routed by (nodeId, sessionId),
  and a fleet-side keystroke does NOT reach the worker** (story 06; ADR-014 / SECURITY T14) — the BEHAVIOUR
  (relay bridge over the frozen envelope, in-memory ephemeral mirror, read-only route, multiplex by
  (nodeId, sessionId), unresolvable-frame drop) is proven by tasks 00–02's `@executable` over the fake
  relay/PTY/mirror seams + the `acd-fleet-terminal-mirror-read-only` fitness; the VISUAL fidelity of the
  on-screen terminal-view is **§Surface 3**, judged **2026-07-23 — CONFORMS on all witnessed states** (see
  its Review status).
- **The terminal-view's empty-state copy is assignment-state aware, in the m35 ramp's own words** (V10) —
  a small task-feature outcome, WITNESSED render F: the view asks `assignmentChip(row)` whether the
  assignment is terminal (label `done`/`failed`) and, if so, reads `no live output — assignment <label>`
  (+ the chip's `· note`), in the BAR; the header chip reads the short `no live output`. **The stream
  resolution itself does NOT change** (tuple-only; never state-filtered), and there is **no hand-maintained
  list of terminal states** (§Correction 3).
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
  **Must be judged on a post-DG-12 build** — pre-fix pixels of `Assign →` are void.
- **A `@uat` visual-review scenario for the terminal-view** (story 06; §Surface 3, DG-7/DG-8) — a person
  judges: (a) the view NAMES its stream (V1) and reads as read-only, and a typed keystroke does NOT reach
  the worker (V2/V5 / DG-7); (b) the empty/cold-start and rebuild-starts-empty states are honest, not
  spinner-forever (V7); (c) two workers multiplexed, correctly labelled, no cross-wiring (V8 / DG-8); (d) a
  stream that ends reads as ended (V9). Hand this to the developer/product-owner as a candidate task
  `.feature`.
- **A `@uat` visual-review scenario for the terminal-view's DISCLOSURE and its state messages** (story 06;
  §Surface 3, V10/V11/V12, DG-9) — a person judges, on a **full board**: (a) at rest, with every panel
  collapsed, the board still reads as a MONITOR you can scan, and each collapsed panel still says whose
  stream it is and that it is read-only; (b) with one terminal open, the board is still scannable (DG-9);
  (c) on stream end, **both** the `stream ended` bar **and** the last output line are readable, and the card
  does not change height (V11); (d) a **done** and a **stale/reclaimed** assignment's view read
  `no live output — assignment …` in the m35 ramp's own words, not a perpetual `waiting for output` (V10 —
  witnessed render F; the `@uat` confirms it live). Hand this to the developer/product-owner as a candidate
  task `.feature`.
- **A `@uat` visual-review pass over every surface with a binding rule about CONTROL WEIGHT, re-rendered
  after the DG-12 CSS fix** — the fleet node card's neighbours (§Surface 1), the assign affordance
  (§Surface 2 / A2), and the board surfaces owned by other milestones (`ActionsStrip`, `DetailPanel` tabs).
  The patch is already in; the **judgement** is what is owed.
</content>
