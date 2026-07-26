---
name: aof-add-spike
description: Create a spike — a top-level de-risk driver that scaffolds a self-contained NN_spike_slug/SPIKE.md. Groups no stories, carries no .feature; its deliverable is a recorded finding. Resolved later by aof:verify.
---

<!-- aof-generated: true; aof-runtime: codex -->

Use this skill when the user asks for `$aof-add-spike <the unknown / risk to de-risk> [timebox 1d|2d|…] [depends NN[,NN…]]`, or asks to run the AOF `aof:add-spike` procedure in Codex.

Where this procedure mentions `$ARGUMENTS`, use the text the user supplied after the skill name.
Where it mentions Claude slash command `/aof:add-spike`, treat that as this Codex skill invocation.

<objective>
Frame a **spike**: a self-contained `NN_spike_slug/SPIKE.md` folder. A spike is a top-level DRIVER
(the `uat` shape, ADR-001) — it delivers no new behaviour and groups no stories; it exists to resolve
one unknown *before* a dependent milestone can be committed. It gates the stream: downstream work that
`depends:` on it waits until it is `done`. Don't confuse it with `aof:refine`'s in-milestone researcher
(a question scoped inside one milestone) — a spike is worth its own roadmap slot.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve refs with `aof work find` /
`aof work next --json` — never hand-glob `**/*.md`.
</config>

<process>
For: "$ARGUMENTS"
1. **Number + folder.** Next top-level `NN` = max `NN` across `work.dir` + 1, zero-padded. Slug =
   kebab (e.g. `de-risk-mesh-routing`). Folder: `<work.dir>/<NN>_spike_<slug>/`.
2. **Scope (`depends:`).** A spike is usually a *dependency*, not a dependent — leave `depends: []`
   unless the spike itself needs a prior milestone/spike/chore resolved first. If given explicitly
   (`depends NN,NN`), use those; each must resolve to a real driver (`aof work validate` enforces this).
3. **Scaffold** (template: `.aof/templates/work/spike/SPIKE.md`): frontmatter (`type: spike`, `number`,
   `slug`, `title`, `status: not-started`, `owner`, `created`/`updated`: today, `depends: [...]`,
   `timebox`: the given box or a sensible default); `## Question` (the unknown, framed as a real
   question); `## Timebox` (the box + stop condition); `## Investigation` (empty — filled as the spike
   runs); `## Finding` (empty — the deliverable); `## Outcome / Next` (empty — what it unblocks).
4. Ask only the framing questions you can't infer (the question itself, the timebox).
5. **Frame ONLY** — no investigation started, no finding recorded (that's the spike running, then
   `aof:verify`). No `tasks/`, no `.feature` — a spike carries no behavioural contract.
</process>

<progress_tracking>
The spike starts at `status: not-started` in `SPIKE.md` frontmatter. Running it (the investigation,
recording `## Finding`) and flipping it to `done` — which unblocks anything that `depends:` on it — is
`aof:verify <NN>`: confirms `## Finding` is filled and the unknown is resolved. No scenario run, no
"tests green" — the investigation code is throwaway.
</progress_tracking>

<output>
Report the path + the question this spike answers. Next: run the investigation, record the finding,
then `aof:verify <NN>`.
</output>
