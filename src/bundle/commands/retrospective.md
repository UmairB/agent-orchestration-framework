---
description: The retrospective session — triage a milestone's mistakes/blockers (from STATE feedback notes + VERIFICATION findings) and distil them into RETROSPECTIVE.md as carryable lessons. Called at the close by aof:verify, or run directly to backfill past milestones.
argument-hint: "[ref | range — omit for all done milestones without one]"
allowed-tools: [Read, Grep, Glob, Bash, Edit, Write]
---
<objective>
Produce (or refresh) a milestone's `RETROSPECTIVE.md` — the distilled lessons from how execution
actually went. The same session the close runs, made standalone so you can **backfill** milestones
accepted before they had a retro.
</objective>

<config>
Parse "$ARGUMENTS":
- a **ref** (`NN`) or **range** (`NN-MM`) → resolve via `aof work find <NN> --json` / iterate the range;
- **omitted** → every milestone that is `done` and has **no** `RETROSPECTIVE.md` yet (backfill mode).
</config>

<process>
For each target milestone NN:

1. **Gather the evidence** (read-only):
   - `STATE.md` → the `## Feedback (for retro)` running notes (if any), durable decisions, the closure
     record, carried follow-ups — anything recording a mistake / blocker / decision-with-hindsight.
   - `VERIFICATION.md` → the **Findings** (defects/gaps caught at review) + their triage — the richest
     source for an already-accepted milestone.
   - Any recorded blocker stops.
2. **Triage.** Keep only what carries a **lesson** — a mistake, blocker, near-miss, or misunderstanding
   worth not repeating. A finding that was a clean catch with no process lesson is **not** a retro
   entry (it already lives in VERIFICATION). Dedup against any existing `R<n>` entries.
3. **Distil + write** `RETROSPECTIVE.md` (`doc: retrospective`). One `R<n>` per lesson — **append**,
   never renumber:
   - **Kind:** mistake | blocker | near-miss | misunderstanding · **Area:** code | architecture | contract | security | process
   - **Stage:** refine | build | verify · **Owner:** the role/lane · **Raised by:** who flagged it
   - **What happened** *(factual)* · **Why** *(root cause)* · **Lesson** *(what to do differently)* · **Refs:** the VERIFICATION `@finding-<id>` / ADR / commit — **reference, never restate**
4. **Conditional.** If a milestone surfaced nothing worth a lesson, **write no doc** and say so
   (absence is information). Never manufacture entries to fill the page.
</process>

<output>
Per milestone: created / updated / skipped-clean, with the `R<n>` count and a one-line digest of each
lesson. Modify only `RETROSPECTIVE.md`.
</output>
