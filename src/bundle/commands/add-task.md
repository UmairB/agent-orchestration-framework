---
description: Create a task — an adhoc standalone .feature, or a task inside an existing story.
argument-hint: <task description> [under story <ref>]
allowed-tools: [Read, Grep, Glob, Write, Edit]
---
<objective>
Create a task: a `.feature` whose scenarios are its acceptance criteria. Either nested inside a
story's `tasks/`, or standalone at the top level (adhoc fix).
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.tags`.
</config>

<process>
For: "$ARGUMENTS"
1. **Under a story** (`under story <ref>`): create `<story>/tasks/<MM>_<slug>.feature` (`MM` = next
   local index) and add it to the story's `STORY.md` `## Tasks`. **Standalone**: top-level
   `<work.dir>/<NN>_task_<slug>/` containing `<slug>.feature`.
2. Scaffold the `.feature` (template: `wiki/templates/task/example.feature`):
   - **No user story** — an optional one-line objective (`In order to … the system must …`).
   - Exactly one verification tag — `@executable` (default), `@manual` (an agent-runnable live/technical
     check the suite can't do yet), or `@uat` (genuinely needs a human to judge) — + layer/refinement/
     domain tags from `work.tags`. No `@milestone-NN`.
   - Background + Scenario(s) + a Scenario Outline + Examples (the case matrix).
   - Apply the **litmus test** (black-box observable) to every line.
3. Keep it independent of other stories' tasks.
</process>

<progress_tracking>
A task has no `status` field — it is **done when its `@executable` feature is green**. When nested,
it is an unchecked box in `STORY.md` `## Tasks`; tick it when green.
</progress_tracking>

<output>
Report the path + the scenarios drafted.
</output>
