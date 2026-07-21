---
description: Insert a milestone at a target position — scaffold NN_milestone_slug at --at P and re-index every item ≥ P up by one, keeping the stream valid. The placement twin of add-milestone.
argument-hint: <short milestone description> at <position P>
allowed-tools: [Read, Grep, Glob, Bash, Write, Task, AskUserQuestion]
---
<objective>
Frame a new milestone at a **specific position** `P` in the stream — not appended at the tail. The
placement twin of `aof:add-milestone`: it scaffolds the SAME `NN_milestone_slug/` folder (SPEC + STATE,
spine only), but slots it at `P` and re-indexes every pre-existing item that was `≥ P` up by exactly
one. Use when work discovered mid-flight belongs *beside* related items in the roadmap.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve refs with `aof work find` /
`aof work next --json` — never hand-glob `**/*.md`.
</config>

<process>
For: "$ARGUMENTS"
1. **Resolve slug + position.** Slug = kebab from the description. Target position `P` = the `at <P>`
   the caller gave (the number the new milestone should occupy).
2. **Placement + re-index is MECHANICAL — the CLI, never hand-edited.** Run
   `aof work insert-milestone "<slug>" --at <P> --json`. This scaffolds the folder at `P` from
   `.aof/templates/work/milestone/` (the SAME templates `add-milestone` uses) AND renumbers every item
   `≥ P` up by one, rewriting `depends`/`parent`/frontmatter so nothing dangles — leaving
   `aof work validate` green. **Never** renumber folders or rewrite references by hand (ADR-002).
3. **Count-gated confirmation (ADR-004).** If the CLI reports the shift needs confirmation (many items
   must move — a costly re-order), surface the count to the user and re-run with `--yes` once they
   confirm. When only a handful shift it proceeds automatically. `--yes` carries autonomous intent.
4. **Frame the prose into the scaffolded SPEC.** The CLI writes a spine only. Author `## Objective` and
   `## Scope` (in/out) into the new `SPEC.md` — ask only the framing questions you can't infer. If
   `work.agents.productOwner == "agent"`, spawn `aof-product-owner`; else inline.
5. Frame ONLY — no stories, no conditional docs, no code (absence is information).
</process>

<progress_tracking>
The milestone lands at `status: not-started` in `SPEC.md` frontmatter, occupying position `P`. Its
`## Stories` list is the checklist that drives it to done — populated by `aof:refine`.
</progress_tracking>

<output>
Report the path + position + objective, and confirm `aof work validate` is green after the re-index.
Next: `aof:refine <P>` to break it into stories.
</output>
