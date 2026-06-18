---
description: Refine a work item — break a milestone into independent stories, or author a story's task features (Three Amigos), producing ARCHITECTURE/DESIGN/RESEARCH as needed. With --autonomous, cascade the whole item (break down + author every contract) and stop once for a single review at the end.
argument-hint: <item ref — NN or slug> [--autonomous]
allowed-tools: [Read, Grep, Glob, Write, Edit, Bash, Task]
---
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

- **milestone — Decide + Break-down:**
  1. **Decide** (only for genuine open questions; skip what it lacks): blocking unknown →
     `aof-researcher` → `RESEARCH.md`; non-trivial decision → `aof-architect` → ADRs in
     `ARCHITECTURE.md` + fitness-function arch-tests (move any invariant out of features); UI →
     `aof-designer` → `DESIGN.md`.
  2. **Break down** (with `aof-architect`): partition into **independent** stories — minimise
     cross-story coupling to maximise parallelism. For each, create `stories/<SS>_story_<slug>/`
     (`STORY.md`, `parent:` this milestone) and list it in the milestone `SPEC.md` `## Stories`.

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

Produce the whole tree, then hand back **one** consolidated review (the breakdown + all contracts).
Still **doc-producing only**: stop before any build.
</process>

<progress_tracking>
- Created stories start `status: not-started` and are listed (unchecked) in the milestone
  `SPEC.md` `## Stories`.
- Created tasks are unchecked boxes in `STORY.md` `## Tasks`.
- Set the refined item's `status` → `in-progress` once it has its breakdown / contract. Bump `updated:`.
</progress_tracking>

<output>
**Default** — report what was produced + what's still open.
**`--autonomous`** — present the full refined tree (the milestone breakdown + every story's authored
contract) as a single review surface, calling out any default decisions taken and anything still open.
Either way — Next: `aof:continue <ref>`. If a story feeds a `uat` gate, restate that the gate is
**still open** and is closed only by `aof:verify <uat-ref>` once these amendments verify — so it isn't
left dangling.
</output>
