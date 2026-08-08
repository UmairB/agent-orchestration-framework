# Observability — milestone 45

_Generated 2026-08-08 13:09Z · stall threshold 10m00s · 2 agent run(s) across 2 session(s)._

This folder is auto-derived from Claude Code session transcripts. It is a
diagnostic, not a work record — safe to delete or `.gitignore`.

## Summary

- **Calendar span** (first agent start → last agent end): **477h39m**
- **Real active time** (concurrency-aware, excl. stalls): **30m17s**
- **Real idle time** inside the span: **477h09m** ⚠️
- **Sum of per-agent active time** (if run serially): 30m17s
- **Total output tokens** (generation): **75.7k**
- **Blocked waiting for a human**: **14h39m** (3% of the span)
- **Dead air** (main thread quiet, nothing driving, no human asked): **36m48s** (0% of the span)
- **Infra kills** (API session/usage limit, overload): **1**, costing **0s** of the wait above


## Lost time — why the run stopped

**Infra kills.** The run was terminated by the platform, not by the work. Nothing restarts a
dead orchestrator, so each of these costs whatever it took a human to notice.

| at | agents killed | resets | gap that followed |
|----|---------------|--------|-------------------|
| 2026-08-07 20:47Z | — | — | resumed promptly |

**Waits for a human.** The run stopped and stayed stopped until the operator typed. Nothing
here is work — it is the cost of having no way back in without a person.

| from | nothing running for | after an infra kill? | restarted with |
|------|---------------------|----------------------|----------------|
| 2026-08-07 21:09Z | **12h22m** | no | Fix inline now, and then re-verify |
| 2026-08-08 09:51Z | **1h29m** | no | Go ahead |
| 2026-08-08 11:59Z | **46m58s** | no | Nothing is over to me. You are capable of signing this off yourself. You have wsl as worker node to test with |

**Dead air.** The main thread went quiet with no human asked and nothing driving, then the run
woke on its own. Each of these is a window a stall watchdog would have closed.

| from | nothing running for | woke on |
|------|---------------------|---------|
| 2026-07-19 13:45Z | **21m00s** | tool_result |
| 2026-07-19 13:28Z | **15m48s** | tool_result |

## Concurrency — waves and serial chains

- **2 wave(s)** of agent activity across the span.
- **Parallelism factor:** 1.00× (sum of active ÷ wall-clock active). 1.00× means strictly one-at-a-time.

## Agents (ranked by active work time)

| active | wall-clock | tool-wait | out tok | turns | model | agent | task |
|--------|-----------|-----------|---------|-------|-------|-------|------|
| 25m21s | 25m21s | — | 56.2k | 73 | opus | aof-designer | Design conformance verdict on 24 renders |
| 4m56s | 4m56s | — | 19.4k | 42 | opus | aof-qa | Behavioural review of F-38.05 story-05 |

## Why slow — per-agent diagnostics

Where each agent's active time went (model generation vs waiting on the toolchain), and the loop signals behind it.

### aof-designer — Design conformance verdict on 24 renders 
- **Time split:** model generation 25m19s · toolchain wait 0s (0% of active)

### aof-qa — Behavioural review of F-38.05 story-05 
- **Time split:** model generation 4m31s · toolchain wait 0s (0% of active)
- **Error-ish tool results:** 1

## Where the generation went — build vs governance

- **Build** (aof-developer): **0** (0%)
- **Governance** (contract authoring, review, design, research): **75.7k** (**100%**)

| role | out tok | share |
|------|---------|-------|
| aof-designer | 56.2k | 74% |
| aof-qa | 19.4k | 26% |

> ⚖️ **Governance took 100% of the generation.** Worth checking that depth was priced with the operator before the run, not discovered after it.

## Token detail

| agent | out | input | cache-create | cache-read | model |
|-------|-----|-------|--------------|------------|-------|
| aof-designer | 56.2k | 146 | 1564.2k | 6668.2k | claude-opus-5 |
| aof-qa | 19.4k | 5.4k | 465.6k | 2476.8k | claude-opus-4-8 |

_Sessions: 1d576ebe-b72b-428e-8098-045f74122131, ad539a61-b4d8-483d-a8c8-bfd4d3669669_
