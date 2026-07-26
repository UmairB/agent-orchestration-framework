---
name: aof-refine
description: Refine a work item — break a milestone into independent stories, or author a story's task features (Three Amigos), producing ARCHITECTURE/DESIGN/RESEARCH as needed. With --autonomous, cascade the whole item (break down + author every contract) and stop once for a single review at the end.
---

<!-- aof-generated: true; aof-runtime: codex -->

Use this skill when the user asks for `$aof-refine <item ref - NN or slug> [--autonomous] [--solo]`, or asks to run the AOF `aof:refine` procedure in Codex.

Where this procedure mentions `$ARGUMENTS`, use the text the user supplied after the skill name.
Where it mentions Claude slash command `/aof:refine`, treat that as this Codex skill invocation.

<objective>
Deepen a work item: break a milestone into **independent** stories (the doc-producing stage), or
author a story's task `.feature` files via Three Amigos.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`, `work.tags`. Parse `$ARGUMENTS` into the item
**ref** (`NN` / `NN/SS` / slug) and an optional **`--autonomous`** flag. Resolve the ref by running
`aof work find "<ref>" --json` (folder-name lookup — never glob `**/*.md`).
</config>

<process>
Dispatch on the item's `type`. **`--autonomous`** changes only *where you stop*, not *what you
produce* — without it each stage stops at its review gate; with it (see the block after the dispatch)
refine cascades through every sub-stage of the item and stops once, at the end, for a single review.

- **spike / chore — refuse, no Three-Amigos, no break-down (ADR-003).** Neither type is a refine
  target: both are **top-level drivers that group no stories** (ADR-001) and carry **no task
  contract** to author — a spike's deliverable is a recorded finding (`SPIKE.md` `## Finding`), a
  chore's is a ticked `## Definition of Done` checklist, neither a `.feature`. There is nothing here
  to Decide (no ARCHITECTURE/DESIGN/RESEARCH fork — the item itself frames its own question/intent),
  nothing to Break down (it groups no stories), and no Contract to author (no Three Amigos, no
  `tasks/`). **Decline and redirect:** report that this type has nothing to break down or contract for,
  and point at the item's own record doc as the next step instead — a spike is worked directly (fill
  `## Investigation` / `## Finding`) and closed with `aof:verify <ref>`; a chore is worked directly
  (tick `## Definition of Done`) and closed the same way. Create **no `stories/` folder and no task
  `.feature` file** under the item — refine is a strict no-op on disk for these two types.

- **milestone — Decide + Break-down:**
  1. **Decide** (only for genuine open questions; skip what it lacks): blocking unknown →
     `aof-researcher` → `RESEARCH.md`; non-trivial decision → `aof-architect` → ADRs in
     `ARCHITECTURE.md` + fitness-function arch-tests (move any invariant out of features); UI →
     `aof-designer` → `DESIGN.md`.

     **UI / designer path — elicit a mock, or make the binding checklist mandatory (ADR-003).** When the
     milestone has UI and `aof-designer` authors `DESIGN.md`, **elicit mocks from the user at refine**:
     ask, per surface, whether they have a mock (an image / a local HTML export from Figma / claude.ai
     design / a screenshot). This gives the read-only designer a baseline it can actually `Read` at review
     time (the root cause being fixed: m03's mock was a remote `claude.ai/design` link the read-only
     designer could not open). For each surface:
     - **An existing mock is committed under the milestone's `mocks/` dir** — `wiki/work/NN_milestone_<slug>/mocks/<surface>.png`,
       committed as a locally-readable artifact. Export any remote design into `mocks/` and commit the
       file; never leave a remote design-tool link as the sole reference.
     - **The committed mock is referenced from `DESIGN.md` as the conformance source of truth** for that
       surface — a locally-readable artifact, never a remote-link-only reference.
     - **With no mock, the binding checklist is mandatory and is the source of truth** — `aof-designer`
       fills the surface's mandatory binding checklist in `DESIGN.md` (layout regions in order, the
       components each region holds, the states empty/loading/error/populated, the design ramp each uses)
       so the surface still has a baseline the review can judge against (rather than an INCONCLUSIVE on a
       missing baseline). A surface with neither a committed mock nor a checklist has no baseline.

     **Recall prior lessons first (before authoring ADRs/stories).** Role-scoped, run unconditionally
     (memory may be off — see below): the **architect**, before writing an ADR, runs `aof work memory
     recall "<the decision in a few words>" --area architecture --block`; the **PO**, before the
     break-down, runs a recall keyed to the milestone's domain — `aof work memory recall "<milestone
     objective keywords>" --item <ref> --block`. Read the returned block and acknowledge any surfaced
     **near-miss** relevant to a decision — honoured, or consciously departed from, in `ARCHITECTURE.md`
     (or `STATE.md`). An **empty block means nothing to surface** (memory may be off) — proceed
     unchanged.
  2. **Break down** (with `aof-architect`): partition into **independent** stories — minimise
     cross-story coupling to maximise parallelism. For each, create `stories/<SS>_story_<slug>/`
     (`STORY.md`, `parent:` this milestone) and list it in the milestone `SPEC.md` `## Stories`.

     **Ground boundaries in the codebase graph first.** Run unconditionally (a silent no-op when graphify
     is absent — mirrors the memory-recall hook above): **before** drawing any story boundary, build the
     codebase graph fresh — `aof graph build src` (the repo source root, where call/dependency coupling
     lives; read back the `builtAt`/`egress`/counts the `BuildResult` returns so freshness is visible) —
     then run `aof graph impact <the candidate modules / files at each boundary>` to get the **exact**
     dependents + dependencies of each from the graph's edges (deterministic — not the fuzzy
     similarity-seeded `graph query`, which you may still use for open-ended "what's the god-node here"
     exploration). Draw boundaries that **follow the real call/dependency coupling** `graph impact`
     reports — a boundary that cuts a file away from the modules that import it is a bad cut — and **cite
     the graph-derived coupling** in the breakdown rationale / `ARCHITECTURE.md`. **Advisory only:** YOU
     draw the partition using your own judgment — the graph informs it, never auto-rewrites it; no graph
     output feeds a gate or work-mutation. If
     `aof graph build` returns the structured `graphify-missing` miss, note the graph is unavailable and
     draw boundaries from reading the source exactly as before — no block, no crash, no noise.

- **story — Contract (Three Amigos):** author the task `.feature` files under `tasks/`: PO writes the
  headline Scenarios; `aof-qa` writes the Examples tables; `aof-developer` checks feasibility. **Litmus**
  every line; tag each scenario (one verification — `@executable`/`@manual`/`@uat` — +
  layer/refinement/domain from `work.tags`); defect-origin → `@bug` + `@finding-<id>`. List the tasks
  in `STORY.md` `## Tasks`.

  **Gate check (before authoring):** resolve each entry in the story's `depends:` (`aof work find <dep>
  --json`). If any is a **`uat`** session that is **not `done`**, surface it loudly: this story
  implements that gate's findings, so the gate stays **open** until these amendments are built *and*
  its findings verified — it is closed later with `aof:verify <uat-ref>`, **never** by hand-ticking it
  done. This is expected (you refine amendments while the gate is open); the flag exists so the loop
  isn't forgotten. Tag each amendment scenario with the originating finding's `@finding-<id>` so the
  fix traces back to the UAT finding it closes.

**`--autonomous` — cascade, review once at the end.** Drive the item to *fully refined* without pausing
at each intermediate gate (the framework's balance is review-stops vs. autonomous runs — refining
story-by-story is needless friction once the breakdown is trusted):

- **milestone** → run Decide + Break-down, then immediately author **every** resulting story's Contract,
  fanning out the Three Amigos in parallel (the stories are independent by construction). Take
  **documented default decisions** for non-critical open questions (record them in `STATE.md`); **stop
  early only** for a genuine blocking unknown or an unsafe/irreversible decision — a real gate, never
  routine breakdown or contract authoring.
- **story** → author its full Contract (already a single stage).
- **spike / chore** → the refuse/redirect above applies unchanged; `--autonomous` has nothing to
  cascade (no sub-stage exists for either type).

Produce the whole tree, then hand back **one** consolidated review (the breakdown + all contracts).
Still **doc-producing only**: stop before any build.
</process>

<progress_tracking>
- Created stories start `status: not-started` and are listed (unchecked) in the milestone
  `SPEC.md` `## Stories`.
- Created tasks are unchecked boxes in `STORY.md` `## Tasks`.
- Set the refined item's `status` → `in-progress` once it has its breakdown / contract. Bump `updated:`.
- **spike / chore** — refine touches nothing: no `status` change, no `stories/`, no `tasks/`.
</progress_tracking>

<output>
**Default** — report what was produced + what's still open.
**`--autonomous`** — present the full refined tree (the milestone breakdown + every story's authored
contract) as a single review surface, calling out any default decisions taken and anything still open.
**spike / chore** — report the decline (nothing to break down/contract) and point at `aof:verify <ref>`
as the type's own close path; produce nothing on disk.
Either way — Next: `aof:continue <ref>`. If a story feeds a `uat` gate, restate that the gate is
**still open** and is closed only by `aof:verify <uat-ref>` once these amendments verify — so it isn't
left dangling.
</output>
