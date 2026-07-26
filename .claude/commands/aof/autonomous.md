---
aof-generated: true
description: Run a range of milestones end-to-end, unattended — driven by `aof work next`: refine → build → verify each item in dependency order, gating on `aof work validate`. Stops only for a genuine human gate (@uat), a blocker, or an unsafe ambiguity. Resumable.
aof-invocation: /aof:autonomous
aof-runtime: claude
---

<objective>
Drive a contiguous range of milestones to **accepted** with no human in the loop. The `aof` CLI picks
what's next (`aof work next`, dependency-aware) and gates each item (`aof work validate`); this command
runs the refine → build → verify loop on whatever it returns, until the range is done. Hand control
back only when a human is genuinely required or an item can't be safely advanced.
</objective>

<config>
Read `.aof/aof.config.json` → `work.agents`, `work.autonomous.maxAttempts` (default `3`),
`work.autonomous.heartbeatStaleMs` (the restart-reclaim staleness threshold, default 15 min),
`work.codeReview.autoComplete`. Parse "$ARGUMENTS":

- **range** — `NN-MM` (inclusive) or a single `NN`, passed straight to `aof work next <range>`.
- **--ship** — after a milestone is accepted, run `aof:code-review <NN>` (opens the PR; merges only if
  `work.codeReview.autoComplete`). Default off — autonomous builds + accepts but doesn't open/merge PRs.
- **--max-attempts N** — override the per-item fix-loop cap.

Ordering, done-skipping, and the structural gate are delegated to the CLI — you never pick the order
or hand-glob the stream.
</config>

<process>
**Reclaim orphaned runs first (restart-time backstop).** Before anything else, recover any run a previous
crash left wedged. Over the range's items, a stale `running` run — one whose `heartbeatAt` is older than
`work.autonomous.heartbeatStaleMs` (seen via `aof work run-status <ref>`) — is an orphan. The
**`work:run-start` path performs the reclaim**: it force-fails a stale orphan (`runtime_offline`, so the
recovered run stays *retryable*) and rolls its item back `in-progress → not-started` before minting the
resumed run — so a crashed item re-enters the ready pool and is offered again by `aof work next`. This is
a backstop SCAN at loop start, never a daemon, poll, or network sweep.

**Print the plan first** — run `aof work next <range> --json` and list the range's milestones (and
their stories) with current `status`. Then **loop**: ask the CLI for the next item, act on it, repeat.

Loop until `aof work next <range> --json` returns `state: "done"`:

1. **Ask what's next.** `aof work next <range> --json` → `{ state, ref, type, status, … }`:
   - **`done`** → the range is complete. Finish.
   - **`blocked`** → a dependency isn't met (`waitingOn`). **Stop** and report it.
   - **`ready`** → act on `ref` (step 2). It already respects `depends` and skips `done` work, so you
     never choose the order yourself.

2. **Act on the ready item** by its type/state — the per-item `refine → build → verify` loop (exactly
   the manual sequence, automated):
   - **milestone with no stories** → `aof:refine NN` to break it into independent stories + the
     conditional docs (RESEARCH / ARCHITECTURE / DESIGN, SECURITY / COMPLIANCE per surface). Take
     **documented default decisions** for non-critical questions (record in `STATE.md`); **stop** for
     any that can't be safely defaulted.
   - **story whose tasks aren't authored/tagged** → `aof:refine NN/SS` (Three Amigos — PO outcome, QA
     cases, dev feasibility).
   - **story with tasks, not done** → `aof:continue NN/SS` (code + `@executable` green; `aof-architect`
     + `aof-qa` review — the automated gate autonomous clears without a human). Then **drive to the
     gate**: `aof work validate NN/SS` (exit 0); on findings/red, spawn `aof-developer` to fix **within
     the locked contract** — never edit a scenario/fitness function to force green; if one is
     wrong/infeasible, **stop**. Re-validate up to `maxAttempts`; on exhaustion, **stop**. Then
     `aof:verify NN/SS` (automated + `@manual` lanes); if the story has any **`@uat`** scenario,
     **stop** for human sign-off.
   - **milestone with all stories done** → `aof:verify NN` to record acceptance + compact `STATE.md`.
     With **--ship**, then `aof:code-review NN`.
   - **uat session (ready)** → it's a cross-milestone human acceptance gate. Run `aof:verify NN` to
     drive the automated lanes (the integrated regression sweep + agent-runnable `@manual` across the
     accepted milestones), then **stop** for the human `@uat` sign-off — never self-sign a session.

   **Track each item's processing as a run, and recover infra failures (resilience).** Wrap the work on a
   ready item in a run so a crash is detectable and recoverable: `aof work run-start <ref>` when you begin
   the attempt, `aof work run-complete <ref> --outcome done` on success, or `--outcome failed --reason
   <runtime_offline|timeout|agent_error>` when it fails. On a **failed** run, let the store DECIDE
   resume-vs-fresh — do **not** re-reason the failure table in prose; ask the verb and follow its coded result:
   - try `aof work run-retry <ref>` — on success it **resumed** the prior session on the same lineage (an
     infra failure: `runtime_offline`/`timeout`), and the retry counts against `work.autonomous.maxAttempts`;
   - if it returns **`not-retryable`** (an `agent_error` — you judged the output bad), start **fresh** with
     `aof work run-start <ref>` instead, so a poisoned session is never replayed;
   - if it returns **`attempts-exhausted`**, the ceiling is hit — hand back on the EXISTING **`maxAttempts`
     exhausted** stop (a genuinely-failing item halts instead of looping).
   A reclaim, an infra resume, a status rollback, and a `duplicate-run` rejection are all handled **in-loop**
   — they recover the cascade; none is a new hand-back (the `<stop_conditions>` set below is unchanged).

   **Anti-loop — skip self-triggering hand-offs.** The cascade's multi-agent hand-offs must never re-trigger
   their own work. The store records the FACTS (each run's `retryOf` lineage + `brief.initiator`); you apply
   the POLICY: before a hand-off, read the candidate's `brief.initiator` and run lineage from the run records
   and **decline** a hand-off whose initiator is the agent it would trigger, or that would re-trigger its own
   lineage. A genuine hand-off to a *different* agent / a fresh lineage proceeds normally — skip only
   self-triggers, never the legitimate cascade. If a slipped self-trigger still reaches the store, its
   `duplicate-run` guard refuses the second non-terminal run — treat that rejection as an in-loop event
   (continue), not a hand-back.

3. **Loop.** Confirm the working tree is committed, then go back to step 1. Re-running
   `aof:autonomous <range>` resumes — `aof work next` skips `done` work and returns the first open item.
</process>

<stop_conditions>
Hand control back — with a checkpoint stating **where** it stopped, **why**, and **how to resume** — on
any of:

- a **`@uat`** human-acceptance gate (a `@uat` scenario, or a **uat session** item — its sign-off is human);
- a **`blocked`** result from `aof work next` (a dependency isn't `done` — report its `waitingOn`);
- a **wrong/infeasible scenario or fitness function** (locked contract — it can't be edited to pass);
- an **open decision that can't be safely defaulted** (e.g. an irreversible scope/architecture choice);
- **`maxAttempts` exhausted** on the validate gate (don't thrash).

Re-running `aof:autonomous <range>` resumes: `aof work next` skips `done` work, so it picks up at the
first open item.

Whenever you stop on a **blocker** or a **wrong/infeasible contract**, append a feedback note to that
milestone's `STATE.md` `## Feedback (for retro)` section before handing back (the same thing
`aof:feedback` does) — a stop should leave a learnable trace; the retrospective session distils it
into `RETROSPECTIVE.md` at the close.
</stop_conditions>

<progress_tracking>
- Status is the source of truth **and** the resume index (it's what `aof work next` reads): a story is
  complete at its `STORY.md` `status: done`, a milestone at `SPEC.md` `status: done` (only when all its
  stories are).
- The PO is the single writer of each `STATE.md`; record the run's per-item outcome there (accepted /
  stopped-because-X). Bump `updated:`.
- Never mark a story or milestone `done` with an open blocker finding or a red scenario.
</progress_tracking>

<output>
Report the range processed: per item, the action taken and its end state (accepted / stopped + why).
End with the first item still needing a human (if any) and the exact command to resume.
</output>
