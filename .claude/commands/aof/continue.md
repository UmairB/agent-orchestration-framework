---
aof-generated: true
description: Execute/resume a work item — build its tasks to green, then structural + behavioural review. For a milestone, runs the full autonomous cascade to completion.
aof-invocation: /aof:continue
aof-runtime: claude
---

<objective>
Build a work item's tasks until every `@executable` scenario is green, then review — keeping status
current as you go. Continuing a MILESTONE means continuing the whole milestone: every story, driven
to done — never one slice.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Resolve the ref by running
`aof work find "$ARGUMENTS" --json` (folder-name lookup — never glob `**/*.md`; the folder name is the
index). Items nest by scope: `milestone/ → stories/<story>/ → tasks/<task>.feature`.
</config>

<process>
Dispatch on the item's `type`:

- **milestone** — the whole milestone, to completion: run `/aof:autonomous <NN>` (the SlashCommand
  tool) and stop when it hands back. The autonomous loop is the ONE implementation of
  "drive an item refine → build → verify until done" (it fans out independent stories, gates each on
  `aof work validate`, and stops only for a genuine human gate or blocker) — never re-implement a
  partial fan-out here: a milestone continue that builds one slice and parks is the exact defect this
  delegation removes (operator, 2026-07-26).
- **story** — Build → Review:
  1. Read the milestone's ADRs/DESIGN + the story's task features. If tasks are thin/untagged, stop and
     send the user to `aof:refine <ref>`.
  2. **Build** — (orchestrated) spawn `aof-developer` to implement code + `@executable` step defs until
     every task's `@executable` scenarios/rows are green and fitness functions pass; else inline. Flag,
     don't change, a wrong scenario — and note any blocker or contract problem in the milestone's
     `STATE.md` `## Feedback (for retro)` section (distilled into `RETROSPECTIVE.md` at `aof:verify`).

     **Recall prior gotchas first.** Before building, the developer runs (unconditionally — memory may
     be off) `aof work memory recall "<milestone domain / story keywords>" --kind near-miss --block` and
     considers the surfaced gotchas, recording at `aof:verify` (in `VERIFICATION.md`) any that shaped the
     build. An **empty block means nothing to surface** (memory may be off) — proceed unchanged.
  3. **Review** — `aof-architect` (structural) + `aof-qa` (behavioural) + **`aof-designer` (design
     conformance, when the story has UI)** + an automated craft pass; apply confirmed fixes.

     **Design conformance (when the story has UI) — render → hand to the designer → spawn QA
     (ADR-001/002/003).** Catch design-gaps here (at build) — far cheaper than at the `aof:verify` gate
     or a cross-milestone UAT. The orchestration renders, then hands the screenshot to the read-only
     designer to JUDGE (it is the only party that bridges "run the browser" to "judge the result"):
     - **Render** each DESIGN surface via `npx playwright screenshot` against the base URL (`--url` if given, else `work.ui.baseUrl`) with the surface's `Route` appended — `npx playwright screenshot "<baseUrl><Route>" <out>.png`.
     - **Breakpoints.** Take the render at the defined breakpoints — the `390` / `768` / `1280` default (mobile / tablet / desktop), DESIGN-overridable per milestone (a surface's `DESIGN.md` may state its own widths).
     - **On-demand Playwright.** Playwright is invoked on-demand via `npx`; it is NOT a `package.json` dependency.
     - **Hand off to the designer.** Spawn `aof-designer` to JUDGE the rendered screenshot they pass it (the ADR-001 hand-off) — give it the screenshot path(s) + the conformance baseline (the committed mock under `mocks/` and/or the binding checklist) and have it return the region-by-region verdict. Do NOT instruct the designer to run the browser itself — it has no `Bash`; it only judges the screenshot it is handed.
     - **Spawn QA.** Spawn `aof-qa` for the browser harness / regression / a11y — QA runs the Playwright harness, owns the `toHaveScreenshot` regression, and the optional axe-core-via-Playwright a11y lane.
     - **Verdict.** The verdict is `CONFORMS` / `GAPS` / `INCONCLUSIVE`. It is `INCONCLUSIVE` when no base URL / screenshot is available or no baseline exists (no committed mock AND no binding checklist). A DESIGN surface with no renderable `Route` collapses to `INCONCLUSIVE` naming the missing `Route`. Name the missing baseline as the gap rather than inferring from component code — never read the component code and call it a `CONFORMS`/`GAPS` verdict; the honest answer is `INCONCLUSIVE` + "produce the missing baseline / render".
- **task** — build that single task to green, then review.
</process>

<progress_tracking>
Status is the source of truth — update it as you go (the PO is the single writer of milestone SPEC/STATE):

- **Task** — done when its `@executable` feature is green. Tick its box in the parent `STORY.md` `## Tasks`.
- **Story** — set `STORY.md` frontmatter `status`: `in-progress` when build starts, `in-review` once built
  and under review. (`done` is set later, at `aof:verify`.)
- **Milestone** — `SPEC.md` `status: in-progress` while any story is active; record notable events in
  `STATE.md`. Tick a story's box in the milestone `SPEC.md` `## Stories` when that story reaches `done`.
- Bump `updated:` on every record you touch.
</progress_tracking>

<output>
Report what landed, each task's green-status, and the review verdicts. Stop at the Review gate.
Next: `aof:verify <ref>`.
</output>
