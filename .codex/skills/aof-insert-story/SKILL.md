---
name: aof-insert-story
description: Insert a story at a target position under a milestone — scaffold SS_story_slug at --at P and re-index sibling stories ≥ P up by one, keeping the stream valid. The placement twin of add-story.
---

<!-- aof-generated: true; aof-runtime: codex -->

Use this skill when the user asks for `$aof-insert-story <story description> at <position P> under milestone <NN>`, or asks to run the AOF `aof:insert-story` procedure in Codex.

Where this procedure mentions `$ARGUMENTS`, use the text the user supplied after the skill name.
Where it mentions Claude slash command `/aof:insert-story`, treat that as this Codex skill invocation.

<objective>
Frame a new story at a **specific local position** `P` inside a milestone's `stories/` — not appended
at the tail. The placement twin of `aof:add-story`: it scaffolds the SAME `SS_story_slug/`
(STORY.md + empty `tasks/`), but slots it at `P` under the owning milestone and re-indexes every
sibling story that was `≥ P` up by exactly one. Use for a story discovered mid-flight that belongs
*beside* related siblings, not after everything added later.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve refs with `aof work find` /
`aof work next --json` — never hand-glob `**/*.md`.
</config>

<process>
For: "$ARGUMENTS"
1. **Resolve slug + position + parent.** Slug = kebab. Target local position `P` = the `at <P>` the
   caller gave (the `SS` the new story should occupy). Parent milestone `NN` = the `under <NN>` — a
   story is always nested (required `parent`, ADR-006).
2. **Placement + re-index is MECHANICAL — the CLI, never hand-edited.** Run
   `aof work insert-story "<slug>" --at <P> --under <NN> --json`. This scaffolds from
   `.aof/templates/work/story/` (the SAME template `add-story` uses), resolving the `parent:` line to
   `NN`, AND renumbers every sibling story `≥ P` up by one, rewriting references so nothing dangles —
   leaving `aof work validate` green. **Never** renumber or rewrite by hand (ADR-002).
3. **Count-gated confirmation (ADR-004).** If the CLI reports the shift needs confirmation (many
   siblings must move), surface the count and re-run with `--yes` once the user confirms. A handful
   proceeds automatically.
4. **Best-effort `## Stories` update.** The CLI updates the milestone `SPEC.md` `## Stories` checklist
   where it recognises the bullet form and honestly reports `skipped` otherwise (Tier 2, ADR-003). If
   it reports `skipped`, add the new story's bullet to `## Stories` by hand.
5. **Frame the prose into the scaffolded STORY.** Author `## User story` (a real "so that") into the
   new `STORY.md` — ask only what you can't infer. If `work.agents.productOwner == "agent"`, spawn
   `aof-product-owner`; else inline. No task features — `aof:refine <ref>` authors them. Design the
   story **independent** of siblings.
</process>

<progress_tracking>
The story lands at `status: not-started` in `STORY.md`, occupying local position `P` under `NN`, and
appears as an unchecked box in the milestone `SPEC.md` `## Stories`. Its own `## Tasks` list tracks it.
</progress_tracking>

<output>
Report the path + position + user story, and confirm `aof work validate` is green after the re-index.
Next: `aof:refine <NN>/<P>`.
</output>
