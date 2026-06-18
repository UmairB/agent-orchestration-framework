---
description: Execute/resume a work item — build its tasks to green, then structural + behavioural review. For a milestone, fans out its independent stories.
argument-hint: <item ref>
allowed-tools: [Read, Grep, Glob, Bash, Edit, Write, Task]
---
<objective>
Build a work item's tasks until every `@executable` scenario is green, then review — keeping status
current as you go. For a milestone, fan out its independent stories in parallel.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve the ref by running
`aof work find "$ARGUMENTS" --json` (folder-name lookup — never glob `**/*.md`; the folder name is the
index). Items nest by scope: `milestone/ → stories/<story>/ → tasks/<task>.feature`.
</config>

<process>
Dispatch on the item's `type`:

- **milestone** — fan out: spawn one `aof-developer` per **independent** story (worktree-isolate when
  they touch shared files); serialise only where a real dependency forces it. Run the story flow for each.
- **story** — Build → Review:
  1. Read the milestone's ADRs/DESIGN + the story's task features. If tasks are thin/untagged, stop and
     send the user to `aof:refine <ref>`.
  2. **Build** — (orchestrated) spawn `aof-developer` to implement code + `@executable` step defs until
     every task's `@executable` scenarios/rows are green and fitness functions pass; else inline. Flag,
     don't change, a wrong scenario — and note any blocker or contract problem in the milestone's
     `STATE.md` `## Feedback (for retro)` section (distilled into `RETROSPECTIVE.md` at `aof:verify`).
  3. **Review** — `aof-architect` (structural) + `aof-qa` (behavioural) + an automated craft pass; apply
     confirmed fixes.
- **task** — build that single task to green, then review.
</process>

<progress_tracking>
Status is the source of truth — update it as you go (the PO is the single writer of milestone SPEC/STATE):

- **Task** — done when its `@executable` feature is green. Tick its box in the parent `STORY.md` `## Tasks`.
- **Story** — set `STORY.md` frontmatter `status`: `in-progress` when build starts, `in-review` once built
  and under review. (`done` is set later, at `aof:verify`.)
- **Milestone** — `SPEC.md` `status: in-progress` while any story is active; record notable events in
  `STATE.md`. Tick a story's box in the milestone `SPEC.md` `## Stories` when that story reaches `done`.
- Bump `updated:` on every record you touch.
</progress_tracking>

<output>
Report what landed, each task's green-status, and the review verdicts. Stop at the Review gate.
Next: `aof:verify <ref>`.
</output>
