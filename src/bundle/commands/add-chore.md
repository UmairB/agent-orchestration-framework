---
description: Create a chore — a top-level housekeeping driver that scaffolds a self-contained NN_chore_slug/CHORE.md. Groups no stories, carries no .feature; its deliverable is a ticked checklist. Resolved later by aof:verify.
argument-hint: "<the housekeeping to do> [depends NN[,NN…]]"
allowed-tools: [Read, Grep, Glob, Write]
---
<objective>
Frame a **chore**: a self-contained `NN_chore_slug/CHORE.md` folder. A chore is a top-level DRIVER
(the `uat` shape, ADR-001) — it delivers no new behaviour and groups no stories; it exists to sequence
housekeeping (a migration, a config tidy-up, a cleanup discovered mid-build) *before* whatever depends
on it. It gates the stream: downstream work that `depends:` on it waits until it is `done`. A chore is
created **ad-hoc, in the moment the need is found** — it never falls out of `aof:shatter` (that's a
milestone/spike-only concern, ADR-004).
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve refs with `aof work find` /
`aof work next --json` — never hand-glob `**/*.md`.
</config>

<process>
For: "$ARGUMENTS"
1. **Number + folder.** Next top-level `NN` = max `NN` across `work.dir` + 1, zero-padded. Slug =
   kebab (e.g. `tidy-config`). Folder: `<work.dir>/<NN>_chore_<slug>/`.
2. **Scope (`depends:`).** Leave `depends: []` unless this chore itself needs a prior driver resolved
   first. If given explicitly (`depends NN,NN`), use those; each must resolve to a real driver
   (`aof work validate` enforces this).
3. **Scaffold** (template: `.aof/templates/work/chore/CHORE.md`): frontmatter (`type: chore`, `number`,
   `slug`, `title`, `status: not-started`, `owner`, `created`/`updated`: today, `depends: [...]`);
   `## Intent` (what housekeeping + why, one or two sentences); `## Definition of Done` (a checkbox
   list of concrete checkable items — the close criterion, always include `aof work validate` green);
   `## Notes` (optional).
4. Ask only the framing questions you can't infer (the intent, the checklist items).
5. **Frame ONLY** — no boxes ticked yet (that's the chore running, then `aof:verify`). No `tasks/`, no
   `.feature`, no user story — a chore carries no behavioural contract.
</process>

<progress_tracking>
The chore starts at `status: not-started` in `CHORE.md` frontmatter. Doing the work (ticking
`## Definition of Done` boxes) and flipping it to `done` — which unblocks anything that `depends:` on
it — is `aof:verify <NN>`: confirms every box is ticked **and** `aof work validate` is green (no
regression). No `.feature`, no behavioural verify.
</progress_tracking>

<output>
Report the path + the intent. Next: do the housekeeping, tick the checklist, then `aof:verify <NN>`.
</output>
