---
description: Shatter a planning PRD into a framed roadmap — a milestone SPEC per deliverable chunk, plus a `spike` de-risk driver for any chunk that is a blocking unknown gating a milestone — the one batch session that lays out the roadmap and authors cross-milestone `depends` edges. Consumes a planning PRD (whatever produced it); never writes product strategy itself. One-directional — PRD → drivers, never back.
argument-hint: "[PRD path — omit to auto-discover PRD-*.md]"
allowed-tools: [Read, Grep, Glob, Write, Edit, Bash, Task, AskUserQuestion, SlashCommand]
---
<objective>
Turn a planning PRD into the roadmap of framed **drivers**: the product-owner reads the PRD, identifies
each chunk, and frames it as the right TYPE — a **milestone** for a deliverable-behaviour chunk (writing
one framed `SPEC.md`), or a **`spike`** for a chunk that is a *blocking unknown to de-risk before a
milestone can be committed* (writing a framed `SPIKE.md`, ADR-004). Each links back to the PRD as its
origin. Because this is the single session that sees every new driver at once, it is also **the moment
cross-milestone `depends` edges are authored** (the cheap, batch authoring point — never inferred later
by traversal), including the backward edge from a milestone to the spike that gates it.

**Spike only — never a `chore`.** A PRD describes what to *deliver* (→ milestones) and the unknowns
gating that delivery (→ spikes); it never describes the incidental housekeeping a team accrues while
building. Housekeeping has no PRD-level representation — a `chore` is created **ad-hoc via
`aof:add-chore`** in the moment the need is found, and does **not** fall out of shattering product
strategy (ADR-004).
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. The **only** input is the PRD — the seam
artifact. shatter is a `/work` command: it knows nothing about *how* the PRD was produced (which
planner, which plugins, whether they're installed) — it just consumes the document.

1. **Resolve the PRD** per the `discoverPrd(workspaceDir, explicitPath)` rule in
   `src/planning-prd.mjs`: an explicit "$ARGUMENTS" path always wins (even an unprefixed one), else
   auto-find a single `PRD-*.md` at the workspace root. `PRD-*.md` is an agent-honoured CONVENTION, not
   a tool-enforced path — so **never guess among other `*.md`**: zero or two-or-more `PRD-*.md` (and no
   explicit path) → **stop and ask** for one (pass its path, or produce one upstream with your planner
   first). Don't author product strategy here — that's upstream of the seam.
2. **Conditional.** Planning earns its place only when the work spans several milestones. A single
   milestone → `aof:add-milestone` directly; no PRD needed.
</config>

<process>
Spawn `aof-product-owner` (orchestrated) or run inline (per `work.agents.productOwner`) to **shatter**
the PRD:

1. **Read the seam, not the whole PRD.** Extract only ACD's input contract — the read-out the
   `readSeam(prd)` rule in `src/planning-prd.mjs` pins: the initiative's **objective(s)**, **scope**
   (in/out), and enough structure to identify **milestone-sized chunks**. The PRD's other sections are
   the planner's business — ignore them.
2. **Identify the drivers — and each one's TYPE.** Partition the initiative into framed, independently-
   deliverable units, and for each decide **milestone** vs **spike** (ADR-004):
   - **Deliverable behaviour** → a **milestone** (shatter's core job — objective + scope + stories).
   - **A blocking unknown that must be resolved *before* a milestone can be committed** → a **`spike`**
     de-risk driver: a top-level investigation the consuming milestone `depends:` on.
   - **Altitude — spike vs `aof:refine`'s researcher.** Frame a spike only when the unknown is big
     enough to *gate a milestone* — worth its own roadmap slot, a driver the milestone waits on. An
     unknown resolvable *inside* one milestone's own scope is **not** a spike — it is settled later by
     that milestone's `aof:refine` (its `aof-researcher → RESEARCH.md`), no top-level driver.
   Number every driver as the next contiguous block in `work.dir` — continue the timeline, never
   renumber existing items. Confirm the partition **and any milestone-vs-spike call** with the user
   (`AskUserQuestion`) only for a genuine boundary/type ambiguity.
3. **Frame each driver from its own template — milestone OR spike.**
   - **Milestone** → one `SPEC.md` from the milestone template — `Objective`, `Scope` (in/out), an
     **empty `## Stories`** ("to be broken down"), and `## Dependencies`.
   - **Spike** → a `NN_spike_<slug>/SPIKE.md` from the spike template (`.aof/templates/work/spike/`),
     frontmatter `type: spike` + `origin:` → the PRD: `## Question` (the unknown), `## Timebox`, and the
     empty `## Investigation`/`## Finding`/`## Outcome / Next` (filled when the spike runs, not now).
     **A spike groups no stories** — it is the actionable unit itself (ADR-001), so it has **no
     `stories/` and no `.feature`**.
   **Frame only; do not break anything down** — a milestone's stories are `aof:refine <NN>` later, and
   a spike is never broken down at all.
4. **Stamp origin.** Each driver's record doc (`SPEC.md` / `SPIKE.md`) frontmatter carries `origin:`
   pointing at the PRD it was shattered from — so every driver is traceable to its source. (Deeper
   provenance — which planner/sha wrote the PRD — lives with the PRD / planning layer, not here.)
   Reference the PRD; never restate it.
5. **Author `depends` (why this command owns it).** This batch session sees all the new drivers at
   once, so set the cross-driver edges now — **backward-only** (a driver depends only on
   lower-numbered items, never forward; a backward edge to an *existing* milestone is fine, a forward
   one is never authored). Put the **edge** in frontmatter `depends: [NN, …]` and the **rationale** in
   the `## Dependencies` prose (edge = machine, prose = why; don't restate the number list in both).
   **Wire each spike's gate:** the milestone that consumes a spike's finding carries the **backward-only**
   `depends: [<spike-NN>]` to it — so number the spike **below** the milestone it gates (a spike is a
   lower-numbered driver its consumer waits on), and the milestone's `## Dependencies` prose names *which
   finding* it waits on (the gate's why). A spike itself is usually a pure dependency (no forward
   `depends`). **Omit `depends` where a driver is independent** — absence means parallel-eligible.
6. **Check the graph.** Self-verify the new `depends` edges all resolve (a spike is a first-class
   `depends` target, ADR-001/FF-3702) and the graph is **acyclic**; then run `aof:validate` over the new
   drivers for the structural (folder ↔ frontmatter) checks. The validate **must report green before
   finishing** — a red validate blocks the report; fix the roadmap (or flag a genuine blocker) first.
</process>

<guardrails>
- **One-directional: PRD → SPECs, never back.** After the shatter the SPECs are the delivery source of
  truth; the PRD is a historical upstream artifact, referenced for origin, **not** kept in lockstep.
  Never edit the PRD to match the SPECs — that recreates the drift ACD exists to defend against.
- **Consume, don't plan.** This command adapts a PRD into ACD's model; it never writes product
  strategy/discovery — that surface is bought (pm-skills).
- **Frame, don't break down.** Milestones get objective + scope + an empty `## Stories` (the story
  break-down is `aof:refine <NN>`); a spike gets its `SPIKE.md` and **groups no stories at all** — it is
  the actionable unit itself (ADR-001), never refined or broken down.
- **Spike, never chore.** shatter frames only `milestone` and `spike` — the driver types a PRD implies
  (deliverable + de-risk). A `chore` is discovered-during-work housekeeping with no PRD-level
  representation; it is created ad-hoc via `aof:add-chore`, never shattered (ADR-004).
- **`depends` is authored here, never inferred later.** No command traverses the built stream to
  backfill edges — this is the cheap moment to set them.
</guardrails>

<output>
Report: the PRD consumed (+ provenance), the drivers created (numbers + titles, each tagged
**milestone** or **spike**), the `depends` graph (edges + their rationale, incl. each milestone→spike
gate), and the validate result. Next: `aof:refine <NN>` to break each milestone into stories (a spike
needs no refine — run the investigation, then `aof:verify <NN>`), or `aof:autonomous <range>` to build
the lot.
</output>
