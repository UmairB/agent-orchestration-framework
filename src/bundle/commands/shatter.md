---
description: Shatter a planning PRD into a series of framed milestone SPECs — the one batch session that lays out the roadmap and authors cross-milestone `depends` edges. Consumes a planning PRD (whatever produced it); never writes product strategy itself. One-directional — PRD → SPECs, never back.
argument-hint: "[PRD path — omit to auto-discover PRD-*.md]"
allowed-tools: [Read, Grep, Glob, Write, Edit, Bash, Task, AskUserQuestion, SlashCommand]
---
<objective>
Turn a planning PRD into the milestone roadmap: the product-owner reads the PRD, identifies the
milestone-sized chunks, and writes one framed `SPEC.md` per milestone — each linking back to the PRD
as its origin. Because this is the single session that sees every new milestone at once, it is also
**the moment cross-milestone `depends` edges are authored** (the cheap, batch authoring point — never
inferred later by traversal).
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
2. **Identify the milestones.** Partition the initiative into framed, independently-deliverable
   milestones. Number them as the next contiguous block in `work.dir` — continue the timeline, never
   renumber existing items. Confirm the partition with the user (`AskUserQuestion`) only for a genuine
   boundary ambiguity.
3. **Write one `SPEC.md` per milestone** from the milestone template — `Objective`, `Scope` (in/out),
   an **empty `## Stories`** ("to be broken down"), and `## Dependencies`. **Frame only; do not break
   milestones into stories** — that's `aof:refine <NN>`, per milestone, later.
4. **Stamp origin.** Each SPEC's frontmatter carries `origin:` pointing at the PRD it was shattered
   from — so every milestone is traceable to its source. (Deeper provenance — which planner/sha wrote
   the PRD — lives with the PRD / planning layer, not here.) Reference the PRD; never restate it.
5. **Author `depends` (why this command owns it).** This batch session sees all the new milestones at
   once, so set the cross-milestone edges now — **backward-only** (a milestone depends only on
   lower-numbered items, never forward; a backward edge to an *existing* milestone is fine, a forward
   one is never authored). Put the **edge** in frontmatter `depends: [NN, …]` and the **rationale** in
   the `## Dependencies` prose (edge = machine, prose = why; don't restate the number list in both).
   **Omit `depends` where a milestone is independent** — absence means parallel-eligible.
6. **Check the graph.** Self-verify the new `depends` edges all resolve and the graph is **acyclic**;
   then run `aof:validate` over the new milestones for the structural (folder ↔ frontmatter) checks.
   Fix or flag before finishing.
</process>

<guardrails>
- **One-directional: PRD → SPECs, never back.** After the shatter the SPECs are the delivery source of
  truth; the PRD is a historical upstream artifact, referenced for origin, **not** kept in lockstep.
  Never edit the PRD to match the SPECs — that recreates the drift ACD exists to defend against.
- **Consume, don't plan.** This command adapts a PRD into ACD's model; it never writes product
  strategy/discovery — that surface is bought (pm-skills).
- **Frame, don't break down.** Milestones get objective + scope + an empty `## Stories`; the story
  break-down is `aof:refine <NN>`.
- **`depends` is authored here, never inferred later.** No command traverses the built stream to
  backfill edges — this is the cheap moment to set them.
</guardrails>

<output>
Report: the PRD consumed (+ provenance), the milestones created (numbers + titles), the `depends`
graph (edges + their rationale), and the validate result. Next: `aof:refine <NN>` to break each
milestone into stories, or `aof:autonomous <range>` to build the lot.
</output>
