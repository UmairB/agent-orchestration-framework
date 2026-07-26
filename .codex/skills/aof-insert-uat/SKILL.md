---
name: aof-insert-uat
description: Insert a UAT session at a target position — scaffold NN_uat_slug at --at P and re-index every item ≥ P up by one, keeping the stream valid. The placement twin of add-uat.
---

<!-- aof-generated: true; aof-runtime: codex -->

Use this skill when the user asks for `$aof-insert-uat <short session description> at <position P> [accepting NN[,NN…]]`, or asks to run the AOF `aof:insert-uat` procedure in Codex.

Where this procedure mentions `$ARGUMENTS`, use the text the user supplied after the skill name.
Where it mentions Claude slash command `/aof:insert-uat`, treat that as this Codex skill invocation.

<objective>
Frame a **UAT session** at a **specific position** `P` in the stream — not appended at the tail. The
placement twin of `aof:add-uat`: it scaffolds the SAME self-contained `NN_uat_slug/` folder
(SESSION + STATE) that `depends:` on the milestones it accepts, but slots it at `P` and re-indexes
every pre-existing item that was `≥ P` up by exactly one. A uat session is an acceptance **gate** — it
delivers no new behaviour and groups no stories. Don't confuse it with the `@uat` *tag*.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve refs with `aof work find` /
`aof work next --json` — never hand-glob `**/*.md`.
</config>

<process>
For: "$ARGUMENTS"
1. **Resolve slug + position + scope.** Slug = kebab. Target position `P` = the `at <P>` the caller
   gave. The accepted milestones (`--depends`) are either given explicitly (`accepting 01,02,03`) or
   default to the delivered span below `P`; each must resolve to a real milestone.
2. **Placement + re-index is MECHANICAL — the CLI, never hand-edited.** Run
   `aof work insert-uat "<slug>" --at <P> [--depends <a,b,…>] --json`. This scaffolds from
   `.aof/templates/work/uat/` (the SAME templates `add-uat` uses) with the resolved `depends:`, AND
   renumbers every item `≥ P` up by one, rewriting `depends`/`parent`/frontmatter so nothing dangles —
   leaving `aof work validate` green. The `--json` envelope echoes the created identity + resolved
   `depends` (ADR-006). **Never** renumber or rewrite by hand (ADR-002).
3. **Count-gated confirmation (ADR-004).** If the CLI reports the shift needs confirmation (many items
   must move), surface the count and re-run with `--yes` once the user confirms. A handful proceeds
   automatically.
4. **Frame the prose into the scaffolded SESSION.** Author `## Scope` (the accepted milestones —
   referenced, never restated), `## Plan`, and the remaining sections into the new `SESSION.md` — ask
   only the framing questions you can't infer. **Frame ONLY** — no checks executed, no findings, no
   sign-off (that's `aof:verify`).
</process>

<progress_tracking>
The session lands at `status: not-started` in `SESSION.md`, occupying position `P`. Running it and
flipping it to `done` — which unblocks anything that `depends:` on it — is `aof:verify <P>`.
</progress_tracking>

<output>
Report the path + position + the milestones it accepts, and confirm `aof work validate` is green after
the re-index. Next: `aof:verify <P>` to run the session and record acceptance.
</output>
