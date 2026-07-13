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
   render of the surfaces production actually mounts** — §Surface 1a (web) and §Surface 1b (desktop).
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
- **A `@uat` visual-review scenario for the new region** — a person judges, on **both** surfaces (web +
  Rust desktop):
  1. a **running** node **beside** a working node (peer emphasis witnessed, not asserted);
  2. a **working-session** node (`working · <repo> (session)`);
  3. a **two-repo** node (one prefix, one qualifier, alphabetical);
  4. a **run + cross-workspace session** node (two lines, run first — the other workspace's session is
     **not** hidden);
  5. an **expired-session** node (falls back to `idle`, muted — no stuck `working`, no ghost).
  Hand this to the developer/product-owner as a candidate task `.feature`.
