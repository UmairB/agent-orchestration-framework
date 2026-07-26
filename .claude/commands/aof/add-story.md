---
aof-generated: true
description: Create a story — a self-contained folder (STORY.md + empty tasks/), optionally inside a milestone.
aof-invocation: /aof:add-story
aof-runtime: claude
---

<objective>
Create a story: a `STORY.md` (the user story) + an empty `tasks/`. Either nested inside a milestone's
`stories/`, or standalone at the top level.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`.
</config>

<process>
For: "$ARGUMENTS"
1. **Under a milestone** (`under milestone NN`): create inside that milestone's `stories/` as
   `<SS>_story_<slug>/` (`SS` = next local index there). **Standalone**: top-level
   `<work.dir>/<NN>_story_<slug>/` (next stream number).
2. Scaffold (template: `.aof/templates/work/story/STORY.md`): `STORY.md` frontmatter (`type: story`,
   `number`, `slug`, `title`, `parent: <milestone NN if nested, else omit>`, `status: not-started`,
   `owner: product-owner`, `created`/`updated`: today); `## User story` (real "so that"); `## Tasks`
   (empty); `## Notes`. Empty `tasks/`.
3. If nested, add this story to the milestone's `SPEC.md` `## Stories` list.
4. If `work.agents.productOwner == "agent"`, spawn `aof-product-owner`; else inline.
5. No task features — `aof:refine <ref>` authors them. Design the story **independent** of siblings.
</process>

<progress_tracking>
Story starts `status: not-started` in `STORY.md`. When nested, it appears as an unchecked box in the
milestone `SPEC.md` `## Stories`. Its own `## Tasks` list is what tracks its progress.
</progress_tracking>

<output>
Report the path + user story. Next: `aof:refine <ref>`.
</output>
