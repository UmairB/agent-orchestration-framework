---
aof-generated: true
description: Scan the work stream chronologically — recent items to catch up on delivery, or filter by type / status / milestone.
aof-invocation: /aof:recent
aof-runtime: claude
---

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
