---
description: Diagnose why a work item took as long as it did — run the transcript telemetry, then rank the causes by hours burned and name the fix for each. Read-only by default; runnable mid-run, not just at the close.
argument-hint: "<milestone ref> [--write]"
allowed-tools: [Read, Grep, Glob, Bash]
---
<objective>
Answer one question with evidence: **where did the time actually go, and what would give it back?**

The CLI owns the measurement. You own the causal story it cannot tell — reading the milestone's own
record to explain *why* the numbers look like that, then ranking the causes by hours and naming the
fix for each. The deliverable is a ranked diagnosis, not a data dump.
</objective>

<config>
Parse "$ARGUMENTS": a milestone ref (`NN`), optionally `--write`.

- **default** — report to the session only. Modify nothing.
- **`--write`** — additionally run `aof work observe NN --write` (drops `observability/{report.md,agents.json}`)
  and append the ranked diagnosis to the milestone's `RETROSPECTIVE.md` under `## Where the time went`,
  replacing any previous run of that section. Never edit `STATE.md` — feedback entries are
  `aof:feedback`'s lane.

**This is runnable mid-milestone.** A diagnosis at hour 4 is worth more than a post-mortem at hour 28.
Nothing here requires the item to be `done`.
</config>

<process>
1. **Measure — the CLI.** Run `aof work observe NN --json`. This is the deterministic lane; every
   number you report comes from it. Do **not** re-derive timings by reading transcripts yourself, and
   do not re-run it more than once. If `transcriptsFound` is false, say so and stop — there is nothing
   to diagnose. The fields that carry the diagnosis:
   - `summary` — `calendarSpanMs`, `activeUnionMs` (concurrency-aware real work), `realIdleMs`,
     `blockedOnHumanMs`, `deadAirMs`, `blockedAfterInfraKillMs`, `serializationCostMs`, `governancePct`.
   - `lostTime.infraKills` — platform terminations (API session/usage limit, overload), each with how
     many agents it killed, its reset time, and the gap that followed.
   - `lostTime.quietGaps` — every stretch where **nothing at all ran**, already discounted by agent
     work underneath it (`unattendedMs` is the honest figure, `ms` is the raw gap). `endedBy: "human"`
     means the run sat dead until someone typed; `endedBy: "run"` means nothing noticed it had stopped.
   - `concurrency.serialChains` — runs of one role that never overlapped, with `costMs` = the
     wall-clock a parallel run would have returned.
   - `tokenSplit` — build generation vs governance (contract authoring, review, design, research).
   - `agents[].diagnostics` — per-agent `toolchain` (% of active time waiting on tests, run count,
     worst run), `interleave` (the edit↔test rhythm), `hotFiles`, `repeatedCommands`, `grind`.
2. **Explain — the record.** Read the milestone's `STATE.md` (and `SPEC.md` for scope). The telemetry
   says *what* happened; the record says *why it was allowed to*. Look specifically for: `depends`
   edges added mid-run for build order, sequencing notes ("not parallel-safe in one working tree"),
   escalations that blocked on a human, review verdicts that forced a fix round, and any feedback
   entries already captured. Quote the record when it names its own cause — a sequencing note that
   explains a serial chain is stronger evidence than your inference.
3. **Rank by hours, not by severity.** Order the causes by wall-clock burned, largest first. A cause
   that cost 6h outranks one that cost 20m however annoying the latter was. State each cause's cost
   from the CLI numbers.
4. **Attribute honestly.** Three distinctions the report depends on, and the most common way this
   command goes wrong is blurring them:
   - **Idle ≠ lost.** An orchestrator quiet while a developer builds is idle *by design*. Only
     `unattendedMs` — where nothing at all was running — is lost time. Never quote a raw gap as waste.
   - **Stalled ≠ grinding.** A long `durationMs` with small `activeMs` is a frozen agent (a watchdog
     problem). A long `activeMs` with high `toolchain.pctOfActive` is a working agent waiting on a
     slow suite (a test-scope problem). They have opposite fixes — never merge them.
   - **Mechanism ≠ work.** Infra kills and hand-restarts are the harness failing, not the milestone
     being hard. Separate them so the operator can see how much of "it took all day" was neither
     thinking nor building.
5. **Name the fix per cause.** Each ranked cause gets one concrete, actionable change — a config, a
   command, an agent-instruction, or a scoped piece of work. "Be faster" is not a fix. If a cause has
   no fix available today, say that plainly rather than inventing one.
6. **Sanity-check before reporting.** The buckets should roughly reconcile: `activeUnionMs` +
   `realIdleMs` ≈ `calendarSpanMs`, and the lost-time figures should not exceed `realIdleMs`. If they
   do not reconcile, report the discrepancy rather than papering over it — a broken measurement is
   itself a finding.
</process>

<output>
Lead with a short table: calendar span, real active time, lost time, agent count, output tokens. Then
the **ranked causes**, largest cost first — for each: a one-line claim, the numbers that prove it
(quoted from the CLI), the record's own explanation where there is one, and the single fix.

Close with the fixes gathered into a build order, each carrying the hours it returns, so the operator
can decide how far down the list is worth going.

Rules:
- **Every number comes from `aof work observe`.** Never estimate a duration by eye.
- **Report what the data supports, not what would make a better story.** If the run was mostly
  efficient and simply large, say that — a milestone that was genuinely hard is a valid answer, and
  manufacturing a villain wastes the operator's next hour.
- Name agents by their task description, not their id.
- Modify nothing unless `--write` was passed.
</output>
