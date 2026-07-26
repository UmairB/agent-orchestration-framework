---
aof-generated: true
description: Create a UAT session — a cross-milestone acceptance gate over the delivery so far. Scaffolds a self-contained NN_uat_slug folder (SESSION + STATE) that depends on the milestones it accepts. Run/accepted later by aof:verify.
aof-invocation: /aof:add-uat
aof-runtime: claude
---

<objective>
Frame a **UAT session**: a self-contained `NN_uat_slug/` folder with its SESSION + STATE. A uat
session is an acceptance **gate** — it delivers no new behaviour and groups no stories; it references
the existing scenarios of the milestones it accepts (`depends:`), re-runs what can be automated, and
brokers the human `@uat` lane. It **gates the stream**: downstream work that `depends:` on it waits
until it is `done`. Don't confuse it with the `@uat` *tag* (a per-scenario lane within one milestone).
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve refs with `aof work find` /
`aof work next --json` — never hand-glob `**/*.md`.
</config>

<process>
For: "$ARGUMENTS"
1. **Number + folder.** Next top-level `NN` = max `NN` across `work.dir` + 1, zero-padded. Slug =
   kebab (e.g. `alpha-acceptance`, `release-r1`). Folder: `<work.dir>/<NN>_uat_<slug>/`.
2. **Scope (`depends:`).** Determine which milestones this session accepts:
   - **Given explicitly** (`accepting 01,02,03`) → use those.
   - **Otherwise** → the delivered span: the contiguous run of milestones up to here whose acceptance
     this session gates (default to all milestones below `NN` that aren't themselves uat sessions).
   Confirm the span with the user if it's ambiguous; each entry must resolve to a real milestone
   (`aof work validate` enforces this).
3. **Scaffold** (templates: `.aof/templates/work/uat/`):
   - `SESSION.md` — frontmatter (`type: uat`, `number`, `slug`, `title`, `status: not-started`,
     `owner: qa`, `depends: [<the accepted milestones>]`, `created`/`updated`: today); `## Scope`
     (the accepted milestones — referenced, never restated; entry/exit criteria); `## Plan` (the
     automated regression sweep + agent-runnable `@manual` vs the human `@uat` lane); `## Live /
     environmental checks`; `## Acceptance judgment`; `## Findings`; `## Sign-off / verdict`.
   - `STATE.md` — frontmatter `doc: state`; `## Progress`; `## Notes & decisions in flight`;
     `## Feedback (for retro)`.
4. Ask only the framing questions you can't infer (the acceptance objective, the span boundary).
5. **Frame ONLY** — no checks executed, no findings, no sign-off (that's `aof:verify`). Absence is
   information.
</process>

<progress_tracking>
The session starts at `status: not-started` in `SESSION.md` frontmatter. Running it (re-run the
`@executable`/`@manual` lanes, broker `@uat`, log + triage findings, sign off) and flipping it to
`done` — which unblocks anything that `depends:` on it — is `aof:verify <NN>`.
</progress_tracking>

<output>
Report the path + the milestones it accepts. Next: `aof:verify <NN>` to run the session and record
acceptance.
</output>
