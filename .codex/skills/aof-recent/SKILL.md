---
name: aof-recent
description: Scan the work stream chronologically — recent items to catch up on delivery, or filter by type / status / milestone.
---

<!-- aof-generated: true; aof-runtime: codex -->

Use this skill when the user asks for `$aof-recent [N] [--type milestone|story|task] [--status X] [--milestone NN]`, or asks to run the AOF `aof:recent` procedure in Codex.

Where this procedure mentions `$ARGUMENTS`, use the text the user supplied after the skill name.
Where it mentions Claude slash command `/aof:recent`, treat that as this Codex skill invocation.

<objective>
Catch up on the stream: the most recent items, or a filtered/grouped view. Read-only.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`.
</config>

<process>
1. Enumerate top-level items (folders `NN_type_slug`); read each record doc's frontmatter (`title`,
   `status`, `updated`). Descend into a milestone's `stories/` (and a story's `tasks/`) only when a
   `--milestone` or `--type` filter asks for the deeper level.
2. **Default** (no args): the last **N** items (N = 10) by `number` (creation order) — the
   catch-up-on-recent-delivery view. Columns: `NN` · type · title · status · updated.
3. **Filters / sorts:** a bare number → N; `--type milestone|story|task`; `--status <status>`;
   `--milestone NN` → that milestone's stories; sort by `updated` desc for recently *worked-on*
   (vs recently *created*).
</process>

<output>
A compact table. Modify nothing.
</output>
