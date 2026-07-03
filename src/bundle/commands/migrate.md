---
description: Migrate a source folder into a managed milestone — runs `aof migrate` (the mechanical CLI) first, then agent inference fills only what the scan marked not recoverable, with an architect review of delivered work at migrate time.
argument-hint: <source folder> [--dry-run]
allowed-tools: [Read, Grep, Glob, Bash, Edit, Write, Task]
---
<objective>
Convert an existing source folder INTO a managed milestone under `work.dir`, enriched by inference.
The division of labour is load-bearing: `aof migrate` (the CLI) is the MECHANICAL FLOOR —
deterministic, read-only recovery, scaffold, slot allocation, gap-derived findings, validation; this
command is the INFERENCE CEILING — agent passes that fill ONLY the seam the CLI hands off. Inference
never grows into the CLI, and nothing the agent writes may state what the source never stated.
</objective>

<config>
Read `.aof/aof.config.json` → `work.dir`, `work.agents`. Parse "$ARGUMENTS": the <source folder>
plus any flags (e.g. `--dry-run`) — every flag passes through to the CLI unchanged.
</config>

<process>
1. **Mechanical floor — the CLI runs FIRST.** As the first act, before any agent pass, run
   `aof migrate $ARGUMENTS --json` (the mechanical CLI; the flags in `$ARGUMENTS` pass through to it
   unchanged). The CLI does everything mechanical: read-only recovery of the source, the scaffold at
   the next free slot under `work.dir`, gap-derived findings, and the honest-absence markers. Do not
   pre-read the source or write anything before the CLI has run.
2. **Consume the CLI's `--json` result to resolve the produced item.** On success the envelope is
   `{ milestoneRef, dir, status, storyCount, taskCount, findingCount, ... }` (`dir` is cwd-relative)
   — `dir`/`milestoneRef` name the produced item the lanes below enrich. The `--json` result is the
   ONLY way the agent lane finds its target — never glob `work.dir` for it, and no pre-existing
   managed item changes.
   - **A refusal or error ends the command.** A refusal (the envelope's `code` is
     `"nothing-recoverable"`) or a source-read error surfaces as `{ ok:false, error, code }` with
     exit 1 — report it and STOP:
     no agent pass runs, nothing is written under `work.dir`. Inference never resurrects an empty
     source.
   - **A `--dry-run` ends the flow after the preview.** The CLI previews what WOULD be produced and
     writes nothing; report the preview and stop — no agent pass writes anything.
3. **Inference lane — fill ONLY the hand-off seam.** The CLI's honest-absence markers
   ("_Not recoverable_") ARE the hand-off: the agent lane fills what the CLI marked not recoverable —
   never re-doing the mechanical floor, never rewriting recovered content. A README-recovered
   objective stands byte-verbatim even when a PRD could "improve" it.
   - **Where inference looks** — the intent the mechanical scan cannot read as such: PRD docs
     (e.g. `docs/*prd*.md`), `.planning/**` trees, a plain `ARCHITECTURE.md` by name at the source
     root. Ground the stated intent into the produced SPEC's objective/scope; every piece of
     grounded content names its source document (e.g. "grounded from docs/prd.md").
   - **Non-fabrication rule (absolute):** everything the agent writes must trace to real source
     content — no line states what the source never stated. When inference finds nothing, honest
     absence stands: keep the CLI's "_Not recoverable_" markers byte-intact and record that the
     inference pass ran and found nothing as an appended line to the produced STATE.md's migration
     preamble (the line right after "Migrated from a source folder on …") — NEVER in the SPEC and
     NEVER in `## Findings`.
   - **Write boundary:** confine every agent write to the produced item's folder under `work.dir`
     (the `dir` the `--json` result named). The source folder stays byte-untouched — the CLI's
     read-only source rule survives into the agent lane.
4. **Architect review of delivered work — at migrate time.** Only when the CLI produced a
   non-`not-started` item (delivered work present): review the source's delivered work per
   `work.agents.mode` — any value other than `"solo"` → orchestrated: spawn `aof-architect` to
   review; `"solo"` → the main session plays the role inline. The CLI's gap-derived rows in the
   produced STATE.md `## Findings` are the floor the review builds on: the architect's rows upgrade
   or extend the gap-derived rows into grounded structural findings — never duplicated, never
   fabricated (no finding the delivered work does not actually exhibit). Each finding names what is
   wrong, where in the delivered work it shows, and what addressing it entails — actionable at
   `aof:continue` without re-deriving the review. **No delivered work → no review lane runs**, and
   no findings section is invented to look reviewed.
5. **Validate.** After enrichment the produced item must still pass `aof work validate` — run
   `aof work validate <milestoneRef>` and fix any structural regression the enrichment introduced
   (fixes stay within the produced item's folder).
</process>

<output>
Report the CLI's mechanical result (ref, dir, status, counts), what the inference lane filled (each
grounded addition naming its source document) or that honest absence stands, the review verdict (or
that no delivered work meant no review), and the final `aof work validate` result.
Next: `aof:refine <milestoneRef>` to author real task contracts, or `aof:continue <milestoneRef>`.
</output>
