---
description: Verify and accept a work item — run the automated + agent-run checks, bring a human in only for genuine @uat acceptance, log/triage findings, capture process lessons in RETROSPECTIVE, sign off, mark done. A milestone is accepted once its stories are.
argument-hint: "<item ref> [--url <baseUrl>]"
allowed-tools: [Read, Grep, Glob, Write, Edit, Bash, Task, SlashCommand]
---
<objective>
Confirm a work item is truly done, then accept it. Run the automated suite and the agent-runnable
checks; pull the human in ONLY when a scenario genuinely needs one (`@uat`).
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`, `work.ui.baseUrl`. Parse `$ARGUMENTS` into the
**ref** and an optional **`--url <baseUrl>`**. Resolve the ref by running `aof work find "<ref>" --json`
(never glob `**/*.md`), then detect which verification lanes are in scope — `@executable`, `@manual`,
`@uat`. The **design-review base URL** = `--url` if given, else `work.ui.baseUrl` (may be absent — ACD
never boots the app; the project serves it).

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

   **Design conformance (UI items) — render → hand to the designer → spawn QA (ADR-001/002/003).** When
   the item has UI (a `DESIGN.md` / frontend surface), run the design-conformance review and log every
   divergence as a **design-gap** finding (step 3). The orchestration is the only party that bridges
   "run the browser" to "judge the result" — it renders, then hands the screenshot to the read-only
   designer to JUDGE. A green `@executable` suite does **not** prove design fidelity (the litmus keeps
   visual fidelity out of the `.feature`), so catch the drift here. The step:
   - **Render** each DESIGN surface via `npx playwright screenshot` against the base URL (`--url` if given, else `work.ui.baseUrl`) with the surface's `Route` appended — `npx playwright screenshot "<baseUrl><Route>" <out>.png`.
   - **Breakpoints.** Take the render at the defined breakpoints — the `390` / `768` / `1280` default (mobile / tablet / desktop), DESIGN-overridable per milestone (a surface's `DESIGN.md` may state its own widths).
   - **On-demand Playwright.** Playwright is invoked on-demand via `npx`; it is NOT a `package.json` dependency (browser availability is a build-time `@manual` confirmation, never a refine blocker or a hard dep).
   - **Hand off to the designer.** Spawn `aof-designer` to JUDGE the rendered screenshot they pass it (the ADR-001 hand-off) — give it the screenshot path(s) + the conformance baseline (the committed mock under `mocks/` and/or the binding checklist) and have it return the region-by-region verdict. Do NOT instruct the designer to run the browser itself — it has no `Bash`; it only judges the screenshot it is handed.
   - **Spawn QA.** Spawn `aof-qa` for the browser harness / regression / a11y — QA runs the Playwright harness, owns the `toHaveScreenshot` visual-regression that locks the designer-approved baseline, and the optional axe-core-via-Playwright a11y lane.
   - **Verdict.** The verdict is `CONFORMS` / `GAPS` / `INCONCLUSIVE`. It is `INCONCLUSIVE` when no base URL / screenshot is available or no baseline exists (no committed mock AND no binding checklist). A DESIGN surface with no renderable `Route` collapses to `INCONCLUSIVE` naming the missing `Route`. Name the missing baseline as the gap rather than inferring from component code — never read the component code and call it a `CONFORMS`/`GAPS` verdict; the honest answer is `INCONCLUSIVE` + "produce the missing baseline / render".
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
   **fold the just-written lessons into memory**: run `aof work memory ingest` so this milestone's
   `R<n>` entries + `ADR-NNN` blocks become recallable in the next milestone's `aof:refine`/`aof:continue`
   (a no-op when memory is off — safe to run always). Then **archive** the STATE `## Feedback (for retro)`
   section as part of the compaction — its lessons have graduated, exactly as durable decisions graduate
   into ADRs.
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
