---
description: Verify and accept a work item — run the automated + agent-run checks, bring a human in only for genuine @uat acceptance, log/triage findings, capture process lessons in RETROSPECTIVE, sign off, mark done. A milestone is accepted once its stories are.
argument-hint: <item ref>
allowed-tools: [Read, Grep, Glob, Write, Edit, Bash, Task, SlashCommand]
---
<objective>
Confirm a work item is truly done, then accept it. Run the automated suite and the agent-runnable
checks; pull the human in ONLY when a scenario genuinely needs one (`@uat`).
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve the ref by running
`aof work find "$ARGUMENTS" --json` (never glob `**/*.md`), then detect which verification lanes are in
scope — `@executable`, `@manual`, `@uat`.

The ref may be a **milestone**, a **story**, or a **uat session**. A uat session (`type: uat`) is a
cross-milestone acceptance gate: its record doc is its own `SESSION.md` (not a milestone
`VERIFICATION.md`), and the scenarios in scope are the `@manual`/`@uat` ones across the milestones it
accepts (its `depends:` list). Run those milestones' `@executable` suite + fitness functions first as
an integrated **regression sweep** (green) before the manual/human lanes. The same steps below apply —
just write to `SESSION.md` and read scenarios across the accepted span.
</config>

<process>
Record results in the milestone `VERIFICATION.md` (or, for a uat session, in its `SESSION.md` — its
`## Live / environmental checks`, `## Findings`, `## Sign-off / verdict`). **Write only the sections
that have content** — no empty "None" placeholders (absence of a section is information).

1. **Automated + agent-run (always; no human).** Run the `@executable` suite + fitness functions and
   confirm green. For each `@manual` scenario (agent-runnable — run a command, hit an endpoint, inspect
   state), spawn `aof-developer` (or run inline) to execute it and record procedure + result + a
   `verifies →` pointer under **## Verification evidence**. Never restate the outcome.
2. **Human acceptance — only if `@uat` scenarios exist.** Spawn `aof-qa` to broker it: **stop and
   prompt the user** to perform each `@uat` procedure, then record their result + sign-off under
   **## User sign-off**. Skip this step entirely when there are no `@uat` scenarios (most
   technical/foundational milestones — so the user is not pestered for nothing).
3. **Findings.** Log each defect/gap found in either step under **## Findings** (id, observed, type,
   severity, triage, routed-to, status). Triage (PO): **blocker** → new `@bug` (+ `@finding-<id>`)
   task scenario + fix (back to `aof:continue`); **non-blocker** → defer to backlog; **design-gap** →
   `aof-designer` sets the `DESIGN.md` rule first. Findings live in `VERIFICATION.md`, never in a task folder.
4. **Gate.** Run `aof:validate <ref>`; require **PASS**.
5. **Retrospective (conditional).** Run `aof:retrospective <ref>` — the retrospective session: it
   triages the milestone's STATE `## Feedback (for retro)` notes + the VERIFICATION findings + any
   blocker stops, and distils the lessons into `RETROSPECTIVE.md` (no doc if the run was clean). Then
   **archive** the STATE `## Feedback (for retro)` section as part of the compaction — its lessons
   have graduated, exactly as durable decisions graduate into ADRs.
</process>

<progress_tracking>
Accept only when validate passes and **no blocker finding is open**:
- **Story** — set `STORY.md` `status: done`; tick its box in the milestone `SPEC.md` `## Stories`.
- **Milestone** — set `SPEC.md` `status: done` **only when ALL its stories are done**; then **compact**
  `STATE.md` (graduate durable decisions into ADRs / the next SPEC; archive the blow-by-blow).
- **UAT session** — set `SESSION.md` `status: done` once every check has a result and **no blocker
  finding is open**; record the verdict in `## Sign-off / verdict`. Accepting it **unblocks** anything
  that `depends:` on it (`aof work next` advances past the gate).
- Bump `updated:` on every record you touch; record the **## Accept decision** (for a uat session, the
  **## Sign-off / verdict**) in the record doc.
</progress_tracking>

<output>
Report the verification evidence, any human sign-offs, findings (with triage + routing), the validate
result, and the accept decision.
</output>
