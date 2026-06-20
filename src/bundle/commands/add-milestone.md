---
description: Create a new ACD milestone in the work stream — scaffold its self-contained folder (SPEC + STATE, spine only).
argument-hint: <short milestone description>
allowed-tools: [Read, Grep, Glob, Write, Task, AskUserQuestion]
---
<objective>
Frame a new milestone: a self-contained `NN_milestone_slug/` folder with its SPEC + STATE. Its
stories are added later by `aof:refine`.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`.
</config>

<process>
For: "$ARGUMENTS"
1. Next top-level number `NN` = max `NN` across `work.dir` + 1, zero-padded. Slug = kebab. Folder:
   `<work.dir>/<NN>_milestone_<slug>/`.
2. Scaffold (templates: `.aof/templates/work/milestone/`):
   - `SPEC.md` — frontmatter (`type: milestone`, `number`, `slug`, `title`, `status: not-started`,
     `owner: product-owner`, `created`/`updated`: today); `## Objective`; `## Scope` (in/out);
     `## Stories` (empty — "to be broken down"); `## Dependencies`.
   - `STATE.md` — frontmatter `doc: state`; `## Progress`; `## Notes & decisions`; `## Verification`.
3. Ask only the framing questions you can't infer (the objective, the scope boundary).
4. If `work.agents.productOwner == "agent"`, spawn `aof-product-owner` to author SPEC; else inline.
5. Frame ONLY — no stories, no conditional docs, no code (absence is information).
</process>

<progress_tracking>
The milestone starts at `status: not-started` in `SPEC.md` frontmatter. Its `## Stories` list is the
checklist that drives it to done — populated by `aof:refine`, ticked off as stories accept.
</progress_tracking>

<output>
Report the path + objective. Next: `aof:refine <NN>` to break it into stories.
</output>
