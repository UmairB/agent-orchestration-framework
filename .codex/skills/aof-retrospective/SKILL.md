---
name: aof-retrospective
description: The retrospective session — triage a milestone's mistakes/blockers (from STATE feedback notes + VERIFICATION findings) and distil them into RETROSPECTIVE.md as carryable lessons. Called at the close by aof:verify, or run directly to backfill past milestones.
---

<!-- aof-generated: true; aof-runtime: codex -->

Use this skill when the user asks for `$aof-retrospective [ref | range - omit for all done milestones without one]`, or asks to run the AOF `aof:retrospective` procedure in Codex.

Where this procedure mentions `$ARGUMENTS`, use the text the user supplied after the skill name.
Where it mentions Claude slash command `/aof:retrospective`, treat that as this Codex skill invocation.

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

1. **Refresh observability (opt-in).** Run `aof work observe NN --write --if-enabled` — a
   deterministic **no-op unless `work.observability.enabled` is set**, so it is always safe to call
   unconditionally (the CLI decides, not you). When enabled it (re)writes
   `NN/observability/{report.md,agents.json}` — the per-agent time / token / **stall** record mined
   from the session transcripts. It re-reads every transcript and overwrites, so a partial run is
   never wrong, only less complete; the close's run (all stories done) is the authoritative snapshot.
2. **Gather the evidence** (read-only):
   - `STATE.md` → the `## Feedback (for retro)` running notes (if any), durable decisions, the closure
     record, carried follow-ups — anything recording a mistake / blocker / decision-with-hindsight.
   - `VERIFICATION.md` → the **Findings** (defects/gaps caught at review) + their triage — the richest
     source for an already-accepted milestone.
   - `observability/agents.json` (if present) → per-agent spend + `stalls`. A **stall** (an agent idle
     past the threshold — dropped connection / interrupt / machine-off) or a grossly outsized
     time/token consumer is a candidate **process lesson** (Kind: blocker | near-miss · Area: process),
     never a product finding.
   - Any recorded blocker stops.
3. **Triage.** Keep only what carries a **lesson** — a mistake, blocker, near-miss, or misunderstanding
   worth not repeating. A finding that was a clean catch with no process lesson is **not** a retro
   entry (it already lives in VERIFICATION). Dedup against any existing `R<n>` entries.
4. **Distil + write** `RETROSPECTIVE.md` (`doc: retrospective`). One `R<n>` per lesson — **append**,
   never renumber:
   - **Kind:** mistake | blocker | near-miss | misunderstanding · **Area:** code | architecture | contract | security | process
   - **Stage:** refine | build | verify · **Owner:** the role/lane · **Raised by:** who flagged it
   - **What happened** *(factual)* · **Why** *(root cause)* · **Lesson** *(what to do differently)* · **Refs:** the VERIFICATION `@finding-<id>` / ADR / commit / `observability/report.md` — **reference, never restate**
5. **Conditional.** If a milestone surfaced nothing worth a lesson, **write no doc** and say so
   (absence is information). Never manufacture entries to fill the page. The `observability/` folder
   (when the opt-in is on) is written regardless — it is a diagnostic, not a lesson doc.
</process>

<output>
Per milestone: created / updated / skipped-clean, with the `R<n>` count and a one-line digest of each
lesson; note whether an `observability/` snapshot was written (or skipped: opt-in off). Modify only
`RETROSPECTIVE.md` (the `observability/` folder is written by `aof work observe`, not by hand).
</output>
