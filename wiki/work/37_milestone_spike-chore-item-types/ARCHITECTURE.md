---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited. Shared by the stories.
  Behaviour (observable outcomes) lives in task .feature files; a structural invariant lives here as a
  FITNESS FUNCTION (an arch-test), never as a Gherkin scenario.
-->
# 37 · Spike & Chore Work-Item Types — Architecture Decisions

The work stream's item vocabulary is a closed enum — `milestone | story | task | uat` — anchored in one
focal file, [`src/work.mjs`](../../../src/work.mjs). This milestone adds two lightweight types, `spike`
and `chore`, **additively**: the existing four are untouched. The three decisions below resolve the forks
the SPEC left to refine (top-level-vs-nested, record-doc shape, verify path) and pin the structural
invariants each implies as fitness functions.

## Recalled prior-architecture context (acknowledged)

`work memory recall … --area architecture` surfaced **26/ADR-007** as the one relevant near-miss:

> *Mesh-aware `next` binds only the STORY walk — the `uat` and zero-story-milestone driver ready-returns
> were lease-BLIND; the fix applies the injected `candidacyView` at EVERY ready-return in `nextWork`.*

This is load-bearing for **ADR-001**, which reuses the `uat` driver machinery for spike/chore. That
machinery is now candidacy-aware at its ready-return (folded in by 27/ADR-004.3 — `nextWork` guards the
`uat` return and the zero-story return, `src/work.mjs:757-785`). ADR-001 **honours** 26/ADR-007 by routing
spike/chore through that *already-fixed* `uat`-shaped return — inheriting the candidacy guard for free —
rather than adding a fresh, unguarded ready-return that would re-open the exact lease-blindness that
retro flagged. This is called out as an explicit invariant of ADR-001's implementation (FF-3705).

The other recalled ADRs (13/ADR-004 import store, 05/ADR-006 ranking, 03/ADR-006 board launch, 21/ADR-002)
are context, not near-misses to honour here.

---

## ADR-001 — `spike` and `chore` are top-level DRIVERS, treated the `uat` way

**Status:** Accepted
**Date:** 2026-07-09

**Context.** The SPEC deferred to refine the question: are spike/chore **top-level drivers** (their own
`NN_` slot at the stream root, in the `depends` ordering graph) or **nested adhoc** items (inside a
milestone, like an adhoc task/story)? The forces: a spike naturally *gates* a build — de-risk an unknown
*before* committing to it, which is a `depends` edge into the milestone that consumes the finding. A chore
is *sequenced* housekeeping — "do this migration before that milestone", also a `depends` edge. Both want
to participate in ordering/gating. The codebase already has the exact shape they need: `uat` is a top-level
driver that carries `depends`, groups **no stories**, and is **itself** the actionable unit (running it is
the work — `src/work.mjs:36-39, 287-289, 757-769`). The alternative — nested-adhoc — would need a *new*
resolver path (adhoc items under a milestone are not modelled), a new parent-resolution rule, and would
put the item *outside* the top-level `depends` graph, defeating the gating motive.

**Decision.** `spike` and `chore` are **top-level drivers**, structurally the `uat` sibling:

- `ITEM_RE` (`src/work.mjs:39`) admits `spike` and `chore`, so `NN_spike_<slug>` / `NN_chore_<slug>`
  folders at the stream root are enumerated by `listItems`. The original four remain admitted.
- `isDriver` (`src/work.mjs:289`) returns **true** for `spike` and `chore` — they sit at the root, carry
  `depends`, and participate in the ordering/gating graph exactly like a milestone or uat (they become
  eligible `depends` targets in `driverNumbers`, and the acyclic-graph check covers them).
- `nextWork` (`src/work.mjs:724`) treats them the **`uat` way, NOT the milestone way**: the item *is* the
  actionable unit — a ready-return at the driver itself, no drill-into-stories (they group none, so the
  milestone path would find zero stories and mis-classify them as "needs break-down"). Concretely, the
  `if (driver.type === "uat")` branch generalises to `if (driver.type === "uat" || driver.type === "spike"
  || driver.type === "chore")` (or an `itemIsTheWork(driver)` predicate) — returning `ready(driver, …)`
  through the **same candidacy-aware return** that guards the uat branch (see FF-3705 / the recall above).

**Alternatives considered.**
- *Nested adhoc (spike/chore inside a milestone).* Rejected: no adhoc-item resolver path exists; it would
  add a new parent rule *and* remove the item from the top-level `depends` graph, defeating the gating
  motive. **Explicitly deferred, out of scope** (may be revisited if adhoc-under-milestone is ever wanted).
- *A brand-new `nextWork` branch with its own fresh ready-return.* Rejected: it would re-introduce the
  26/ADR-007 lease-blindness (a new ready-return that forgets the `candidacyView` guard). Reusing the
  `uat`-shaped, already-guarded return is the safe cut.

**Consequences.** Spike/chore inherit driver ordering/gating and the mesh-aware candidacy guard for free.
`nextWork` gains one predicate, not a new walk. The one risk — a fresh unguarded ready-return — is
structurally forbidden by FF-3705. Nested-adhoc remains a clean future extension (additive again).

**Invariant.** Spike/chore are drivers (FF-3702) and `nextWork` never drills them into stories nor labels
them "needs break-down"; their ready-return is the candidacy-guarded `uat`-shaped one (FF-3705).

---

## ADR-002 — Record-doc shapes: one self-contained doc per type, no separate STATE

**Status:** Accepted
**Date:** 2026-07-09

**Context.** A milestone/uat carries a heavy record surface (SPEC/STORY/SESSION + a separate STATE.md +
ARCHITECTURE/DESIGN/RESEARCH). Spike and chore are, by their nature, minimal-ceremony: a spike's whole
deliverable is a **recorded finding**; a chore's is a **ticked checklist**. Forcing STATE.md, `tasks/`, and
`.feature` onto them would re-import the ceremony the SPEC exists to escape. `recordDoc` (`src/work.mjs:278`)
already maps type → record-doc filename (`milestone→SPEC.md`/`AOF.md`, `story→STORY.md`, `uat→SESSION.md`);
extending it is the natural seam.

**Decision.** Each type is a **single self-contained record doc**; `recordDoc` maps `spike→SPIKE.md`,
`chore→CHORE.md`, and neither gets a separate `STATE.md`.

- **`SPIKE.md`** (RESEARCH-shaped). Frontmatter: `type: spike`, `number`, `slug`, `title`, `status`,
  `owner`, `created`, `updated`, `depends`, `timebox`. Body sections: `## Question` (the unknown / risk),
  `## Timebox`, `## Investigation` (throwaway-prototype notes), `## Finding` (**the deliverable** — the
  recorded finding/decision; "done" = this is filled and the unknown is resolved), `## Outcome / Next`
  (what it unblocks). No `tasks/`, no `.feature`.
- **`CHORE.md`**. Frontmatter: `type: chore` + the standard identity (`number`, `slug`, `title`, `status`,
  `owner`, `created`, `updated`) + `depends`. Body sections: `## Intent` (what housekeeping + why),
  `## Definition of Done` (**a checklist** of concrete checkable items — the close criterion; closes when
  all boxes are ticked), `## Notes` (optional). No `tasks/`, no `.feature`, no user story, no acceptance
  scenarios.
- **No separate STATE.md** for either (unlike milestone/uat) — the record doc is the whole doc.

`validateWork`'s folder↔frontmatter branch (`src/work.mjs:602-626`) handles these as **native** shapes: the
generic `else` branch already validates `type`/`number`/`slug`/`status`/`created`/`updated`/`parent`
against the folder, and spike/chore carry all of those with `parent` absent (they are drivers, depth-0,
`parent` null — mirrors uat). So the native branch needs **no per-type special-casing**; it just needs the
two types admitted to `ITEM_RE` upstream. The only care point: `recordDoc` must return the right filename
*before* validate reads meta, and the `missing-or-empty-record-doc` finding must key off `SPIKE.md`/
`CHORE.md`.

**Alternatives considered.**
- *A separate STATE.md per type.* Rejected: re-imports milestone ceremony; the record doc already holds the
  full (small) surface.
- *Reuse SESSION.md / SPEC.md filenames.* Rejected: distinct filenames make the type legible on disk and let
  `recordDoc` stay a pure type→filename map with no overloading.
- *A digest-style (`doc: digest`) frontmatter.* Rejected: digest is the AOF.md import shape (13/ADR-004);
  spike/chore are **native** authored items, held to the native schema, not the digest one.

**Consequences.** `recordDoc` gains two map entries; `validateWork` gains **nothing** structural (the
native branch already fits). On-disk, a spike/chore folder is one doc — trivially auditable. A chore/spike
with no `tasks/` and no `.feature` is *valid* — the type carries no behavioural contract (this is the
seam ADR-003's invariant guards).

**Invariant.** `recordDoc(spike)==='SPIKE.md'`, `recordDoc(chore)==='CHORE.md'` (FF-3703); a well-formed
spike/chore folder with **no `tasks/` and no `.feature`** validates clean (FF-3704a/b); a `CHORE.md`
carries a `## Definition of Done` section (FF-3706).

---

## ADR-003 — Verify path per type: skill-orchestrated, never through refine or behavioural `.feature`

**Status:** Accepted
**Date:** 2026-07-09

**Context.** `story`/`task` verify by *behaviour* (`.feature` scenarios, `@executable`/`@manual`) after a
Three-Amigos `aof:refine`. Neither fits spike/chore. A spike's deliverable is a **recorded finding**, not
green tests — its code is a throwaway prototype. A chore is **non-functional** housekeeping — no behaviour
to specify, only a checklist to tick without regressing the suite. Routing either through refine or through
`.feature` verification is a category error.

**Decision.** Verify dispatches on **type**, orchestrated by the **skills** (`aof:verify` / `aof:refine`),
NOT by the engine:

- **Spike → finding-recorded.** `aof:verify <spike-ref>` confirms `## Finding` in `SPIKE.md` is filled and
  the unknown is resolved. **No scenario run, no "tests green"** — the prototype code is throwaway.
- **Chore → checklist + validate-green.** `aof:verify <chore-ref>` confirms every `## Definition of Done`
  box is ticked **and** `aof work validate` is green (no regression). **No `.feature`, no behavioural
  verify.**
- **Both bypass `aof:refine`.** No Three-Amigos, no story break-down — spike/chore group no stories, so
  there is nothing to break down.
- **Board / Notion projection: minimal default.** Render with a **type label/badge**, no new per-type lane.
  Full per-type rendering is **deferred, out of scope** — recorded here as the taken default so refine did
  not leave it open.

**The engine's job is ONLY structural validity.** Story 00 must ensure `aof work validate` *passes* for a
well-formed spike/chore — they are **not held to story/task schemas**. Specifically: a chore having no
`tasks/` is valid; a spike having no `.feature` is valid. The per-type *lifecycle* (finding-recorded /
checklist-green, the refine bypass) is authored in the **skill bundle** (story 02), not in `src/work.mjs`.
The invariant behind this — "the type carries no behavioural contract; the folder validates clean without
`tasks/`/`.feature`" — is pulled OUT of any task feature and lives here as a fitness function (FF-3704a/b),
per the house rule that a structural assertion is a fitness function, never a Gherkin scenario.

**Alternatives considered.**
- *Chore as a full-lifecycle task (refine + `.feature`).* Rejected by the SPEC framing (user-flagged): the
  checklist model was chosen over full-lifecycle and over a bare log-and-close note.
- *Encode the per-type verify path in `src/work.mjs`.* Rejected: verify/refine are skill-orchestrated
  across the whole ACD flow; the engine stays a pure structural validator (keeps the 35-importer god-node
  free of lifecycle branching).
- *A per-type board lane now.* Deferred: a label/badge is enough for the minimal default; a lane is added
  only if projection demand appears (mirrors the SPEC's out-of-scope note).

**Consequences.** The engine change (story 00) is narrow and testable; the lifecycle change (story 02) is
skill-doc-only and cannot regress the engine. A spike/chore never enters the behavioural-verify or
refine machinery.

**Invariant.** A well-formed spike/chore folder validates clean with **no `tasks/`/`.feature`** (FF-3704a
spike, FF-3704b chore) — the structural half of the per-type verify path; the lifecycle half is skill-owned
and not an engine invariant.

---

## ADR-004 — `aof:shatter` frames the right roadmap driver per PRD chunk: `milestone` + `spike` (never `chore`)

**Status:** Accepted
**Date:** 2026-07-09
**Backs:** `stories/03_story_shatter-emits-spike/STORY.md`

**Context.** ADR-001/002/003 landed the two new driver *types* (vocabulary, record-doc shapes, verify
path). At refine, a fork surfaced that those three left open: **who frames these drivers at roadmap
scale?** A type nothing can *create* while authoring the roadmap is half-built — a spike that must be
hand-mkdir'd after the fact is not a first-class roadmap driver. `aof:shatter`
(`.claude/commands/aof/shatter.md`) is the one batch session that reads a planning PRD, identifies the
milestone-sized chunks, and authors the cross-milestone `depends` graph (steps 2–5). Today it frames
**milestones only**. But a PRD's chunks are not all deliverable behaviour: some are **blocking unknowns
that must be de-risked before a milestone can be committed** — and a spike is exactly the top-level
de-risk driver a milestone `depends` on (ADR-001). If shatter cannot emit a spike, every such unknown is
either force-fit into a milestone (defeating the point of a lightweight de-risk type) or dropped off-book.
Chore, by contrast, has **no PRD-level representation** (see the decision) — so the fork is milestone-vs-spike,
not a three-way one.

**Decision.** `aof:shatter` frames the right driver **TYPE per PRD chunk — `milestone` | `spike`** — not
milestones alone. Chore is **explicitly excluded** (below).

- A chunk that is **deliverable behaviour** → a `milestone`, framed exactly as today (shatter's core job,
  unchanged: objective + scope + empty `## Stories` + `## Dependencies`, `origin:` stamped).
- A chunk that is a **blocking unknown to de-risk *before* committing to a milestone** → a `spike` driver,
  framed from story 01's `SPIKE.md` template (as shatter reuses the milestone SPEC template today), with the
  dependent milestone's **backward-only** `depends` wired to it — the spike is a lower-numbered driver the
  milestone that consumes its finding depends on.
- **All existing shatter guardrails hold unchanged.** *Frame, don't break down*: a spike groups **no
  stories** (consistent with ADR-001 — the spike *is* the actionable unit). `depends` is authored **here**,
  backward-only, and the graph must be **acyclic + `aof work validate`-green before finishing** (steps 5–6).
  A spike participates in that same `depends` graph as a first-class driver target (ADR-001/FF-3702).

**Chore is excluded from shatter — and why.** A chore is **housekeeping *discovered during work*** — a
migration to do, config to tidy, a cleanup that surfaces mid-build. It is created **ad-hoc via
`aof:add-chore`** at the moment the need is found. It does **not** fall out of shattering **product
strategy**: a PRD describes what to *deliver* (→ milestones) and the unknowns gating that delivery
(→ spikes), never the incidental housekeeping a team accrues while building. Housekeeping has **no
PRD-level representation**, so shatter — a strict PRD → drivers consumer — never frames a chore. This keeps
ADR-004 an **application of ADR-001 narrowed to spike**: shatter emits the driver types a PRD actually
implies (deliverable + de-risk), and leaves the discovered-during-work type to its ad-hoc creation path.

**Altitude — WHICH de-risk mechanism (the crux worth recording).** shatter's spike and `aof:refine`'s
researcher both resolve unknowns, at **different altitudes** — pick by whether the unknown gates a
*milestone* or lives *inside* one:

| Unknown scope | Mechanism | Shape |
|---|---|---|
| **Gates a milestone** — big enough to warrant its own roadmap slot; the milestone can't be committed until it's resolved | **`aof:shatter` frames a `spike` driver** | a **top-level de-risk DRIVER** at the stream root, in the `depends` graph, that the dependent milestone `depends` on (ADR-001) — the finding lands in `SPIKE.md` |
| **Resolvable inside one milestone** — a question within a single milestone's own scope | **`aof:refine`'s Decide stage** — `aof-researcher → RESEARCH.md` | an **in-milestone** research artifact, no new top-level driver, no cross-milestone `depends` — resolved within that milestone's refine |

Rule of thumb: **gates-a-milestone / worth-its-own-slot → shatter frames a spike; resolvable-inside-one-milestone
→ refine's researcher.** The two never overlap: the spike is a driver a milestone waits on; the researcher's
finding is scoped to the milestone that already owns it.

**Alternatives considered.**
- *Keep shatter milestone-only; hand-create spikes after shattering.* Rejected: a de-risk driver you must
  mkdir after the roadmap is authored is not first-class, and it re-opens the exact "framed later, not at
  the batch authoring point" gap ADR-001's driver model + shatter's *`depends`-authored-here* guardrail
  exist to close. The batch session that sees every chunk at once is the cheap moment to frame the spike
  **and** wire its `depends`.
- *Let shatter also frame chores.* Rejected (this decision's rationale): a chore is discovered-during-work
  housekeeping with no PRD-level representation; framing one from product strategy is a category error. It
  belongs to `aof:add-chore`, ad-hoc.
- *A new shatter-owned spike mechanism distinct from ADR-001's driver.* Rejected: the spike shatter frames
  **is** the ADR-001 driver (same `SPIKE.md`, same `isDriver`, same candidacy-guarded return). ADR-004 adds
  no new type or machinery — it is purely *shatter now emits a type it already could validate*.

**Consequences.** shatter's skill doc gains a per-chunk type choice (milestone vs spike) and reuses the
`SPIKE.md` template — a **skill-doc change only**, touching no `src/`. `planning-prd.mjs` (the PRD seam
helper, `discoverPrd`/`readSeam`) is **unchanged**: it already reads the chunks structurally; classifying a
chunk as deliverable-vs-de-risk is the product-owner's judgment in the skill, not a parser rule. Graph note:
`aof graph impact src/planning-prd.mjs` returns **zero edges** (a standalone seam module consumed by the
shatter *skill*, not by source) — so there is **no source coupling** for this decision to disturb; the
decision surface is entirely the `.claude/commands/aof/shatter.md` skill doc. Spike/chore drivers remain
identical on disk regardless of who framed them (shatter or add-*), so nothing downstream branches on
provenance.

**Fitness-function verdict — no new FF (FF-3707 not warranted).** ADR-004 introduces **no new structural
code invariant** an arch-test could lock that is not already locked, for four reasons:
- *Spike is a driver carrying `depends`* — already **FF-3702** (`isDriver` true for spike) and **FF-3705**
  (its ready-return is the candidacy-guarded, `uat`-shaped one). Whether the spike was framed by shatter or
  by `aof:add-spike`, it is the same on-disk driver those FFs already govern.
- *shatter authors only backward-only, acyclic `depends`, validate-green before finishing* — already
  shatter's **own guardrails** (steps 5–6: `depends` backward-only, self-verify acyclic, `aof:validate`)
  plus the engine's acyclic-graph check that spike/chore inherit as drivers (ADR-001). Not a new invariant.
- *shatter frames a spike (from `SPIKE.md`) when a chunk is a blocking unknown, and never a chore* — this is
  a **skill-doc behaviour**, contract-tested by story 03's `@manual` `.feature` scenarios
  (`tasks/00_shatter-frames-spike.feature`). It is *observable skill behaviour*, not a structural
  source-grep/AST invariant — and per the house rule, a behaviour is a Gherkin scenario, not a fitness
  function. There is no source predicate to grep: `planning-prd.mjs` has zero edges and gains no code.
- *chore excluded from shatter* — an **absence of behaviour** in a skill doc; nothing structural to assert
  in source. (Were shatter's spike-framing ever encoded in `src/`, an FF might apply — but ADR-003 already
  keeps the engine a pure structural validator with the lifecycle skill-owned, so it never will be.)

The line ADR-004 leans on is already held by FF-3702, FF-3705, shatter's guardrails, and story 03's
behavioural `.feature`. **No FF-3707; the Fitness-functions table below is unchanged.**

**Invariant.** No new engine invariant. ADR-004 is an **application of ADR-001** (the spike shatter frames
*is* the ADR-001 driver — FF-3702/FF-3705 govern it) narrowed to spike; its shatter-side contract is a
behavioural one owned by story 03's `.feature`, not a structural fitness function.

---

## Fitness functions

Each ADR invariant is paired with an arch-test under `test/arch/`. **Red-until-built activation:** the
vocabulary does not exist yet, so every type-specific assert is **gated on the vocabulary having landed** —
each test reads `src/work.mjs`, and if `ITEM_RE`'s alternation does **not** yet contain `spike`/`chore` it
returns early **green** (inert), keeping the suite green today. The moment story 00 adds the two types to
`ITEM_RE`, the same predicate flips and the asserts **self-activate** — enforcing thereafter. This mirrors
the milestone-06 headroom "RED-until-built, self-activating on file existence" idiom
(`test/arch/acd-headroom-no-dependency.test.mjs`), gated here on the `ITEM_RE` alternation rather than on a
file's existence. The gate itself is asserted non-vacuous (FF-3701 checks the CURRENT four are admitted, so
the test is meaningful even while inert).

| # | Invariant | Enforced by (arch-test) | From | Active |
|---|---|---|---|---|
| FF-3701 | `ITEM_RE` admits `spike` and `chore` (and still the original four) | `test/arch/acd-spike-chore-vocabulary.test.mjs` (source grep of `ITEM_RE`) | ADR-001 | four-admitted assert live now; spike/chore assert self-activates |
| FF-3702 | `isDriver` is true for spike & chore | `test/arch/acd-spike-chore-are-drivers.test.mjs` (source grep of `isDriver` + behavioural: they appear as depth-0 drivers) | ADR-001 | red-until-built |
| FF-3703 | `recordDoc` maps spike→`SPIKE.md`, chore→`CHORE.md` | `test/arch/acd-spike-chore-record-doc.test.mjs` (calls exported `recordDoc`) | ADR-002 | red-until-built |
| FF-3704a | A well-formed **spike** folder with **no `.feature`** validates clean | `test/arch/acd-spike-no-feature.test.mjs` (builds fixture, runs `validateWork`) | ADR-002/003 | red-until-built |
| FF-3704b | A well-formed **chore** folder with **no `tasks/`** validates clean | `test/arch/acd-chore-no-feature.test.mjs` (builds fixture, runs `validateWork`) | ADR-002/003 | red-until-built |
| FF-3705 | `nextWork` returns spike/chore via the **candidacy-guarded, `uat`-shaped** ready-return — never a fresh unguarded return, never drilled-into-stories/"needs break-down" | `test/arch/acd-spike-chore-next-uat-shaped.test.mjs` (source: the item-is-the-work branch names spike & chore; behavioural: `nextWork` ready-returns the driver itself) | ADR-001 + 26/ADR-007 | red-until-built |
| FF-3706 | A `CHORE.md` record doc requires a `## Definition of Done` section (its close criterion) | `test/arch/acd-chore-dod-checklist.test.mjs` (fixture: a chore missing the section is flagged / the template carries it) | ADR-002/003 | red-until-built |

Notes on non-vacuity:
- FF-3701's "original four still admitted" assert is **live immediately** and independent of the gate, so
  the test cannot be vacuously green — if a future edit dropped `uat` from `ITEM_RE`, it goes RED now.
- FF-3705 is the retro-honouring guard: it fails RED if a fresh, non-candidacy-aware ready-return is added
  for spike/chore (the 26/ADR-007 regression). It asserts spike/chore ride the same branch the uat guard
  lives on.

---

## Story boundaries (partition ratified; graph-derived coupling cited)

**Graph grounding.** `aof graph build src` → **1803 nodes / 4582 edges**. `aof graph impact src/work.mjs`
→ **35 importers** (`cli.mjs`, `command-core.mjs`, `commands/validate.mjs`, `commands/next.mjs`,
`board-ui.mjs`, `global-work-store.mjs`, the memory backends, the mesh modules, …); it imports only
`fs.mjs`, `node-identity.mjs`, `workspace.mjs`. **`src/work.mjs` is the stream's god-node** — a single
focal file where `ITEM_RE`, `recordDoc`, `isDriver`, `validateWork`, and `nextWork` all live. This is
**actual** structure from the graph's edges, not inferred from reading.

**Implication (the load-bearing cut).** Because all five seams sit in one file, **only ONE story may edit
`src/work.mjs`**. A by-**type** split (a spike-story and a chore-story) would be a **bad cut**: both would
edit the same `ITEM_RE` and the same validators, colliding on the god-node. The safe cut is by **layer**,
following the real coupling — one story owns the engine file; the others add **sibling** files (commands,
templates, skill docs) that `src/work.mjs`'s 35 importers do not force them to touch.

**Ratified partition** (3 stories; 01 & 02 parallel after 00):

- **Story 00 — Vocabulary & structural validation.** Edits **`src/work.mjs` ONLY**: `ITEM_RE` (+spike,
  +chore), `recordDoc` (spike→`SPIKE.md`, chore→`CHORE.md`), `isDriver` (true for both), the `nextWork`
  item-is-the-work branch (uat-shaped, candidacy-guarded — ADR-001/FF-3705), and confirming the
  `validateWork` native folder↔frontmatter + depends-graph accept both types. **Foundational; 01 and 02
  depend on it.** This is the *only* story that touches the god-node — so nothing else collides on it.
- **Story 01 — Scaffold commands & templates.** Adds **sibling files only**:
  `.claude/commands/aof/add-spike.md` + `add-chore.md`, `.aof/templates/work/spike/SPIKE.md` +
  `.aof/templates/work/chore/CHORE.md`, delivered via the ACD asset bundle (milestone 01), mirroring
  `add-task`/`add-story`. **Depends on 00** (the templates must produce folders 00's validators accept).
  Touches **no** `src/work.mjs`.
- **Story 02 — Lifecycle & verify treatment.** Adds **skill + board files only**: the per-type verify path
  (ADR-003) in `aof:verify`, the refine/behavioural bypass in `aof:refine`, and the minimal board
  label/badge rendering. **Depends on 00.** Touches **no** `src/work.mjs`.

**Parallelism check (confirmed).** After 00 lands, 01 (bundle assets) and 02 (skill docs + board) are
**independent** — disjoint file sets, no shared edit target. Graph-wise: neither 01 nor 02 edits a node
that the other imports, and neither re-edits the `src/work.mjs` god-node 00 owns. The cut maximises
parallelism and **no two stories edit the same file**. Partition **ratified as proposed** — I would not cut
it differently; the graph makes the single-editor-of-the-god-node rule non-negotiable and the by-layer
split is the only one that respects it.
