---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 20 · Autonomous Run Resilience — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the six in-scope mechanics: retryable-vs-non-
> retryable failure classification with an attempt ceiling; resume-vs-fresh session semantics; liveness via
> a heartbeat + a restart-time orphan-reclaim scan; status rollback on a blocker; dedup + anti-loop guards;
> and conformance to the existing `aof:autonomous` stop conditions — plus the hard `SPEC §Out of scope`:
> NO server/daemon/Postgres/WebSocket-hub, NO agent execution, NO new runtimes, and the run-lifecycle
> CONTRACT itself is milestone 19 — this milestone only CONSUMES it) and `STATE.md` (the three open contract
> questions — how resume-vs-fresh maps onto the run/session id, the heartbeat-file format + reclaim-scan
> cadence, and where the dedup/anti-loop guards live relative to the `aof:autonomous` skill — plus the
> load-bearing **milestone-26 forward-note**: m26 generalises the restart-time backstop scan into a FLEET
> orphan scan and makes `aof work next` mesh-aware, so the heartbeat + reclaim scan must walk run records
> **by path with no single-node assumption** — the one genuine seam `26 → 20`). Prior art:
> `PRD-work-run-orchestration.md §Prior-art (a)–(g)` — the Multica runner-resilience mechanics being lifted:
> retryable vs non-retryable + the 2-attempt ceiling (a); resume-on-infra / fresh-on-rejection (b);
> heartbeat + missing-after-N + backstop reclaim (c); structured brief (f); status rollback (g); dedup +
> anti-loop (e).
>
> **The foundation this milestone CONSUMES and never re-litigates: milestone 19 (work-run-lifecycle).**
> This milestone adds resilience mechanics ON TOP of m19's durable run state, inheriting wholesale:
> `19/ADR-001` (the CLOSED transition table `queued → running → done | failed | cancelled` — `queued` is
> representable + its outbound edges legal+validated, but m19 ships **no verb that mints it**; that producer
> is THIS milestone's dedup/scheduler); `19/ADR-002` (the derived per-run-file layout `runs/<run-id>.json`,
> the `runsDir`/`runRecordPath` **path seam**, and the **write-scope guard** — run-store / `run-*` write
> ONLY under `runs/`); `19/ADR-003` (the FROZEN 9-key run-record schema + the three `work:run-*` commands;
> `attempt` is explicitly RESERVED for THIS milestone's attempt-ceiling/retry mechanic; `brief` is OPAQUE +
> growable). It also APPLIES, never re-litigates, milestone 08: `08/ADR-001` (the one in-process command
> core), `08/ADR-002` (the frozen `{ id, input, run, cli } → result` contract; basis-neutral results;
> path-display a face adapter), `08/ADR-003` (the WRITE `resolveItemExact` vs READ `resolveItem`
> distinction), `08/ADR-004` (the registry-derived CLI bijection, generalised by `15/ADR-005`). ADRs below
> cite these as `19/ADR-00n` / `08/ADR-00n` / `SPEC §…` / `STATE §…` / `PRD §…`.
>
> The seam (confirmed against the codebase graph, `aof graph build src` → **1061 nodes / 2872 edges**, built
> at author time 2026-06-30; `aof graph impact` re-run at author time, cited below as **actual** structure,
> not inferred):
> - `aof graph impact src/run-store.mjs` → imported by **exactly the 3 run commands**
>   (`run-start`/`run-complete`/`run-status`); imports **nothing**. It is the **spine** — the `work.mjs`-
>   analogue centre of a high-fan-in star. Every new mechanic here (classification, ceiling, retry-lineage,
>   heartbeat, reclaim, dedup, atomic-persist, schema extension) flows only into the run commands.
> - `aof graph impact src/command-core.mjs` → imported by the **4 faces** (`board-ui`, `cli`,
>   `graph-mcp-server`, `memory/graphify-backend`); imports all **19** `commands/*` + `work.mjs`. The
>   **additive door** — one import + one `COMMANDS` entry per new command, the precedent already visible in
>   the m09/m12/m13/m15/m17/m18/m19 additions.
> - `aof graph impact src/work.mjs` → imported by **15** modules; imports `fs.mjs` + `workspace.mjs`. The
>   item-frontmatter authority — **but it exports only READERS today**
>   (`listItems`/`recordDoc`/`parseFrontmatter`/`findWork`/`listStream`/`validateWork`/`nextWork`). So the
>   status-rollback write is the **first programmatic item-status mutation in the codebase** and a genuinely
>   new seam — and it CANNOT live in run-store (the write-scope guard forbids run-store / `run-*` from
>   writing anything but `runs/`).
> - `aof graph impact src/fs.mjs` → `writeText(filePath, content, {dryRun})` is the atomic temp+rename seam;
>   imported by **15** modules but **NOT yet by run-store** — that gap IS `19/R2(a)`.
> - `aof graph impact src/board-ui.mjs` → imports **only** `command-core.mjs` + `work.mjs`. There is **no
>   edge from this milestone's work into the board face** — confirming the board stays untouched (m21).
>
> **The lessons milestone 19's retrospective hands forward — picked up here, not re-discovered:**
> - **`19/R2(a)`** — `run-store.mjs:persist()` writes per-run files with a NON-ATOMIC `writeFile`; route it
>   through the atomic temp+rename seam `src/fs.mjs:writeText` (ADR-007 below). **`19/R2(b)`** — `seq` is a
>   sequential read-then-write counter, so two interleaved `startRun` calls mint the same `runId`; own
>   concurrent minting in the dedup/scheduler (ADR-006). **Preserve the `compactStamp` UTC-`Z`
>   `toISOString()` assumption** — every persisted transition/increment keeps passing a UTC `Z`-form `now`,
>   never a non-UTC clock.
> - **`19/R1`** — when an ADR adds a command-core command, enumerate ALL the registry-derived gates the
>   registration arms: the CLI bijection (`acd-work-command-cli-bijection`) AND the `/api/work`
>   route-coverage (`acd-work-command-route-coverage`) AND the `command-core/00 exactly-the-known-work-
>   commands` allow-list. The board face is OUT of scope (m21), so the new verbs take the precedented
>   carve-out — the m15-doctor `WORK_IDS` widening + a `BOARD_DEFERRED` carve-out mirroring the existing
>   `run-*` / `notion:*` exclusion (ADR-003 below states how each gate is satisfied).
> - **`19/R4`** — a selection/ambiguity scenario must pin the UNAFFECTED sibling too (informs the
>   fitness-function framing: reclaim touches ONLY stale runs, leaving live siblings byte-unchanged).
>
> **Prior-lesson recall** (`aof work memory recall … --area architecture --block`, re-run per house
> discipline before each ADR): surfaced `07/ADR-004` + `16/ADR-002` (a new capability lands in an
> **additive, CLOSED block** — the one reviewed extension; honoured by ADR-001's additive-keys choice over a
> schema rewrite); `06/ADR-003` (a degrade contract is a **single pure resolver** two stories share —
> honoured by ADR-002's pure classification table, the `isLegalTransition` sibling); `03/ADR-004` (the board
> is read-mostly, status is DERIVED and never written — a deliberate **departure** acknowledged in ADR-005:
> the status-rollback write is a NEW, non-board actor and the first programmatic item-status mutation, so it
> needs its own bounding fitness function rather than inheriting the board's never-write discipline);
> `15/R3` + `10/R2` (an invariant grep must scan the whole **module family** it governs and **follow the
> function, not the file** — honoured by the write-scope/status-bounding fitness framing). No prior lesson
> contradicted; the one conscious departure (`03/ADR-004`) is recorded in ADR-005.

## ADR-001: The resilience metadata extends the run record as ADDITIVE top-level keys — a single reviewed extension that SUPERSEDES `19/ADR-003`'s "exactly nine keys" freeze; not the opaque `brief`, not a sidecar

**Status:** Accepted
**Date:** 2026-06-30

**Context.** The classification/retry/heartbeat mechanics need to record more than `19/ADR-003`'s frozen
nine keys: a **`failureReason`** (the classification input — `runtime_offline`/`timeout`/`agent_error`/
`null`), a **liveness timestamp** (the heartbeat instant, ADR-004), and a **retry-lineage link** (which run
this run resumes/derives from, ADR-003). `19/ADR-003` froze the schema as "EXACTLY these nine keys, in this
order" — but deliberately reserved two growth seams for this milestone: `attempt` ("milestone 20's
attempt-ceiling/retry mechanic increments + caps it") and the OPAQUE `brief` ("m20 + the skills populate
it … so its inner shape can grow with ZERO schema churn"). The structural question is WHERE the new
metadata lives, weighed against the m26 forward-stability discipline (`STATE §Forward note` — keep it
partition-ready, m26 reuses these records under `runs/<node>/`).

**Decision.** The resilience metadata lands as **additive top-level keys on the run record** — a single,
documented, reviewed extension that **SUPERSEDES the `19/ADR-003` "exactly nine keys" freeze** with a new
frozen key set. The `brief` stays OPAQUE (it carries workspace/initiator/resources/skills per
`PRD §Prior-art (f)` — operator/skill-shaped data, not store-interpreted control fields); resilience
control fields the store READS and BRANCHES on (classification, liveness, lineage) must be first-class
typed keys, not buried in an object the store contractually never reads.

**The extended run-record schema (frozen 2026-06-30 — SUPERSEDES `19/ADR-003`; the original nine keys are
UNCHANGED in name, order, and meaning; the four new keys append after them):**

```jsonc
// wiki/work/NN…/runs/<run-id>.json — a derived run record (19/ADR-002). Persisted
// AS-IS by src/run-store.mjs via the atomic seam (ADR-007); never an authoritative
// copy of item state (19/ADR-002).
{
  "runId":         string,      // 19/ADR-003 — unchanged. STABLE + lexically SORTABLE; the filename stem.
  "itemRef":       string,      // 19/ADR-003 — unchanged. "20" | "20/01".
  "state":         string,      // 19/ADR-003 — unchanged. queued|running|done|failed|cancelled (the machine).
  "attempt":       number,      // 19/ADR-003 RESERVED, now LIVE — 1-based attempt count for THIS lineage;
                                //   a resume (ADR-003) increments it; the ceiling (ADR-002) caps it.
  "outcome":       string|null, // 19/ADR-003 — unchanged. null until terminal; then EQUALS state.
  "sessionId":     string|null, // 19/ADR-003 — unchanged. a resume CARRIES the prior sessionId (ADR-003);
                                //   a fresh start does NOT.
  "brief":         object,      // 19/ADR-003 — unchanged. OPAQUE; persisted verbatim, store never reads it.
  "createdAt":     string,      // 19/ADR-003 — unchanged. ISO-8601 UTC-Z; the runId timestamp source.
  "updatedAt":     string,      // 19/ADR-003 — unchanged. ISO-8601 UTC-Z; bumped on every persisted change.
  // ── new in milestone 20 (additive; the four resilience keys) ──────────────────────────────────────────
  "failureReason": string|null, // null while non-terminal / on a clean done. On a FAILED run, one of the
                                //   CLOSED set runtime_offline | timeout | agent_error (ADR-002) — the
                                //   classification input the retry decision branches on.
  "heartbeatAt":   string|null, // ISO-8601 UTC-Z; the last liveness stamp of a `running` run, null until
                                //   first beat / on a terminal run. The reclaim scan reads it (ADR-004).
  "retryOf":       string|null, // null for a first/fresh run; else the runId this run RESUMES — the retry-
                                //   lineage link (ADR-003). Same item, same lineage, attempt incremented.
  "reclaimedAt":   string|null  // ISO-8601 UTC-Z; set when the orphan-reclaim scan force-failed a stale
                                //   `running` run (ADR-004). null otherwise. Distinguishes a reclaimed
                                //   failure from an operator/agent-reported one for audit.
}
```

All four new keys default `null` so a milestone-19 record (nine keys) reads forward-compatibly — a missing
key is treated as `null` (the foundation's "absence is benign" discipline, `19/ADR-002`). The keys are
**partition-ready unchanged**: they are scalar fields on a per-run file, so the m26 `runs/<node>/` path
delta touches none of them (`STATE §Forward note`).

**Alternatives considered.**
- *Ride the metadata inside the opaque `brief`* — **rejected**: `19/ADR-003` froze `brief` as an object the
  store **persists verbatim and never reads**. Classification/liveness/lineage are fields the store READS
  and BRANCHES on (the ceiling check, the reclaim scan, the resume decision). Putting control flow behind a
  contractually-never-read object either breaks that contract (the store now reads `brief`) or forces the
  classification/reclaim logic out of the store into a face — collapsing the single-authority discipline
  (ADR-002). The `brief` carries operator/skill-shaped data; resilience control fields are store-shaped.
- *A sidecar liveness/lineage file (e.g. `runs/<run-id>.meta.json`)* — **rejected**: it splits one run's
  truth across two files (a torn-write and prune-consistency hazard: prune the record but orphan the
  sidecar), and it is NOT partition-ready in the same clean way (m26 would now path-partition two file
  families). One record file per run, extended in place, keeps the derived-log properties (rebuildable /
  prunable / partition-ready) intact. (The heartbeat liveness stamp lives ON the record, not in a separate
  heartbeat file — see ADR-004, which rejects the sidecar-heartbeat alternative for the same reason.)
- *Keep the nine-key freeze and add a parallel `work:run-meta` store* — **rejected**: a second store of
  per-run state duplicates the spine, re-introduces the derived/authoritative ambiguity `19/ADR-002`
  resolved, and has no consumer the single record file does not already serve.

**Consequences.** `19/ADR-003`'s "exactly nine keys" freeze is formally superseded by this thirteen-key
frozen set; the original nine are byte-meaning-stable, the four new keys append. `buildRecord` in
`src/run-store.mjs` is extended to emit the four new keys (all `null` at start); `applyTransition` preserves
them on a transition unless the transition sets them (a fail sets `failureReason`; a reclaim sets
`reclaimedAt`). The record stays a derived artifact — extending the schema changes NO item frontmatter
(the derived-record invariant, `19/ADR-002`, still holds). Story **00 · resilience-core** builds this.

**Invariant.** The run record carries exactly the thirteen frozen keys; the four new keys are scalars (no
nested control object), default `null`, and a missing key reads as `null`. Its structural teeth ride on
the per-run-file partition-ready guard (`19`'s `acd-run-partition-ready`, still green) and the
derived-record guard (`19`'s `acd-run-record-derived`, still green — the schema extension must not make the
record an authoritative copy). No NEW fitness function is needed for the key set itself beyond what ADRs
002/004 assert over the fields; the *behaviour* (a real record round-trips the new keys byte-equivalent) is
a story-00 `.feature`.

## ADR-002: Retryable-vs-non-retryable classification + the attempt ceiling is a CLOSED table evaluated by a PURE function in `run-store.mjs` — the `isLegalTransition` sibling

**Status:** Accepted
**Date:** 2026-06-30

**Context.** `SPEC §Scope` (Retryable vs non-retryable classification) + `PRD §Prior-art (a)`: infra
failures (`runtime_offline`/`timeout`) should auto-retry; an agent rejection (`agent_error`) should NOT —
bounded by an **attempt ceiling**. This is the same shape as `19/ADR-001`'s transition table: a small,
closed decision the store and the commands must share ONE authority for, so a face cannot improvise it. The
recall surfaced `06/ADR-003` (a degrade contract is a single pure resolver two stories share) — the exact
precedent to apply here.

**Decision.** The classification is a **CLOSED table** evaluated by a **PURE function** in
`src/run-store.mjs`, sitting beside `isLegalTransition` (`19/ADR-001`) as its sibling. Two pure functions:

```
RETRYABLE / NON-RETRYABLE (the closed failureReason classification):
  runtime_offline  → retryable        (infra: the runtime/agent host was down)
  timeout          → retryable        (infra: the run exceeded its bound without a verdict)
  agent_error      → NON-retryable     (the agent ran and produced a rejected/bad output)
  (any other value, or null)          → NON-retryable  (fail closed — an unknown reason never auto-retries)

isRetryable(failureReason) → boolean        // pure; the ONLY classification authority
shouldRetry(record, maxAttempts) → boolean  // pure: isRetryable(record.failureReason)
                                            //       && record.attempt < maxAttempts
```

The ceiling `maxAttempts` is read from config `work.autonomous.maxAttempts` (default **3** — the value the
`aof:autonomous` skill already reads and its `--max-attempts` flag already overrides; see `autonomous.md`
`<config>`). `shouldRetry` is pure over `(record, maxAttempts)` — the store and the retry command pass the
resolved ceiling in; the store never reads config itself (config resolution stays at the face/command edge,
the `08/ADR-002` basis-neutral discipline). `agent_error` halting at the ceiling — or immediately, being
non-retryable — is how the attempt ceiling "halts a genuinely-failing item instead of looping"
(`SPEC §Objective`).

**Alternatives considered.**
- *Classify in the command (or the `autonomous.md` skill), not the store* — **rejected**: it splits the
  authority the same way classifying transitions in a face would (`19/ADR-001` rejected exactly this). The
  retry command, a future reclaim path, and any future face must all reach the SAME verdict; one pure store
  function guarantees it. The skill DECIDES whether to retry (it drives the loop) but it must ASK the store
  (`work:run-retry` consults `shouldRetry`), not re-derive the table in prose.
- *An open/extensible classification map in config* — **rejected for this milestone**: the three reasons are
  the lifted Multica set (`PRD §Prior-art (a)`); a config-driven map invites per-project drift in a safety
  decision (what auto-retries) and has no consumer. Adding a reason later is an additive edit to the closed
  table (the `19/ADR-001` "reserve in the closed set" discipline) — reversible without rework.
- *Make the ceiling a fixed constant (2, as Multica)* — **rejected**: the `aof:autonomous` skill already
  surfaces `work.autonomous.maxAttempts` (default 3) and a `--max-attempts` override; hard-coding would
  fork the operator's existing control. Reuse the existing config seam.

**Consequences.** `src/run-store.mjs` gains `isRetryable` + `shouldRetry` (pure, beside `isLegalTransition`).
`work:run-retry` (ADR-003) consults `shouldRetry`; the `aof:autonomous` skill calls the command rather than
reasoning the table itself (ADR-006). The classification reads `record.failureReason` (ADR-001's new key).
Story **00 · resilience-core** builds the table + functions.

**Invariant.** The classification is a closed table and a pure function: `isRetryable`/`shouldRetry` take
only their arguments, read no clock/fs/config, and `runtime_offline`/`timeout` → retryable while
`agent_error`/unknown/null → non-retryable; `shouldRetry` additionally fails closed at
`attempt >= maxAttempts`. Its teeth are a fitness function (the table is closed + the function is pure —
arch-test below). The *behaviour* (a real `timeout` run auto-retries; a real `agent_error` does not; the
ceiling halts an item) is a story `.feature`, NOT a fitness function.

## ADR-003: Resume-vs-fresh is a verb distinction — `work:run-retry` RESUMES the prior session on the same lineage (carries `sessionId`, increments `attempt`, sets `retryOf`); `work:run-start` always starts FRESH

**Status:** Accepted
**Date:** 2026-06-30

**Context.** `SPEC §Scope` (Resume-vs-fresh session semantics) + `PRD §Prior-art (b)`: an auto-retry on an
infra failure must **resume the prior session** (continue where it left off — the runtime, not the work, was
the problem); a **manual rerun starts fresh** ("you judged the output bad — don't replay poisoned state").
`STATE §Notes` lists this as an open contract question: how resume-vs-fresh maps onto the run/session id.
`19/ADR-003` already froze `work:run-start` to mint a FRESH run (attempt 1, `sessionId` as supplied) and
reserved `attempt`/`sessionId` for this milestone's lineage mechanic.

**Decision.** Resume-vs-fresh is a **verb distinction**, not a flag on one verb:

```
COMMAND            input                          resolver          kind   semantics
work:run-start     { ref, sessionId?, brief? }    resolveItemExact  WRITE  19/ADR-003 UNCHANGED — a FRESH run:
                                                                            new runId, attempt 1, retryOf null,
                                                                            sessionId as supplied (or null). The
                                                                            manual-rerun / first-run path.
work:run-retry     { ref, runId?, brief? }        resolveItemExact  WRITE  RESUME the prior run's lineage: a NEW
                                                                            run record, but attempt = prior.attempt+1,
                                                                            sessionId = prior.sessionId (carried),
                                                                            retryOf = prior.runId. Pre-checked by
                                                                            shouldRetry (ADR-002) — a non-retryable
                                                                            or ceiling-exhausted prior → a coded
                                                                            error (not-retryable / attempts-exhausted),
                                                                            NO new run minted.
```

`work:run-retry` resolves the prior run (a supplied `runId`, else the item's most-recent terminal `failed`
run — 0 → `no-retryable-run`, the single-running-run resolution mirror of `19`'s `completeRun`), consults
`shouldRetry(prior, maxAttempts)` (ADR-002), and on a yes mints a new run that **carries the prior
`sessionId` forward** and links `retryOf = prior.runId` with `attempt = prior.attempt + 1`. A fresh start
(`work:run-start`) is untouched from `19/ADR-003` — it never carries a prior session. The sharp rule lives
in the verb the operator/skill chooses: retry ⇒ resume; start ⇒ fresh.

**`19/R1` — the registry-derived gates this NEW command arms, and how each is satisfied** (the same
enumeration `19/ADR-003` should have done for the original three):
1. **CLI bijection** (`acd-work-command-cli-bijection`) — `work:run-retry` is registry-derived-covered for
   presence (it carries a `cli` adapter, gets an `aof work run-retry` dispatch branch, and `--json` runs
   clean). Story **01 · resilience-commands** adds the `argsFor("run-retry")` case to the test's switch
   (which throws on an unmapped sub) — a fixture with a retryable `failed` run so the retry exits 0.
2. **`/api/work` route-coverage** (`acd-work-command-route-coverage`) — the board face is m21
   (`SPEC §Out of scope`). `run-retry` joins the existing `BOARD_DEFERRED` set
   (`{run-start, run-complete, run-status}`) — the precedented carve-out mirroring the `notion:*`
   exclusion; the entry comes out when m21 wires the board route, with no further edit.
3. **`command-core/00 exactly-the-known-work-commands`** — `work:run-retry` is added to the `WORK_IDS`
   allow-list (the m15-doctor / m19-run-* widening precedent), so the "exactly the known work ids" assertion
   stays honest.

(Status rollback is NOT a new `work:run-*` verb on this list — it is the seam ADR-005 places in
`work.mjs`, reached by the reclaim/complete path, not a standalone command. So it arms none of these three
gates.)

**Alternatives considered.**
- *A `--resume` flag on `work:run-start`* — **rejected**: it collapses two opposite session policies into
  one verb (`08/ADR-004` wants one crisp verb per operation), and it muddies `19/ADR-003`'s frozen
  fresh-start contract. Two verbs mirror the established `feedback` (write) vs `doc` (read) split — the
  semantics are in the verb name, legible to the skill and the operator.
- *Resume by mutating the prior run record in place (increment its `attempt`, keep its `runId`)* —
  **rejected**: it destroys the audit trail (`PRD §Prior-art (a)` "Issue ≠ Task" — every trigger is a NEW
  run) and would mean a retried run is not lexically sortable as a later run. A new run with `retryOf`
  preserves the lineage AND the per-run audit.
- *Carry the session via the opaque `brief`* — **rejected**: `sessionId` is already a first-class frozen key
  (`19/ADR-003`); the resume policy reads/writes it directly. `retryOf` is the new lineage link (ADR-001),
  not brief content.

**Consequences.** `src/run-store.mjs` gains a `retryRun(item, { runId, maxAttempts, brief })` that resolves
the prior, checks `shouldRetry`, and mints the lineage-linked run (carrying `sessionId`, setting `retryOf`,
incrementing `attempt`) — reusing `startRun`'s mint path so the atomic-persist + dedup guards apply
uniformly. `src/commands/run-retry.mjs` is a thin WRITE wrapper (`resolveItemExact`). Story **01 ·
resilience-commands** builds the command + CLI face + the three gate satisfactions.

**Invariant.** A retry RESUMES (carries the prior `sessionId`, `attempt = prior + 1`, `retryOf =
prior.runId`); a fresh start does NOT (it never carries a prior session and always sets `retryOf = null`).
Its teeth are a fitness function (a retry record carries the prior `sessionId` + a `retryOf` link; a
`run-start` record carries neither — arch-test below). The *behaviour* (a real infra-failed run resumes its
session and completes; a manual rerun starts a fresh session end-to-end) is a story `.feature`.

## ADR-004: Liveness is a `heartbeatAt` stamp ON the run record (not a sidecar file); the restart-time orphan-reclaim scan walks run records BY PATH with no single-node assumption (the `26 → 20` seam) and force-fails only STALE `running` runs

**Status:** Accepted
**Date:** 2026-06-30

**Context.** `SPEC §Scope` (Liveness + orphan reclaim) + `PRD §Prior-art (c)`: a heartbeat marks a live run;
a restart-time backstop scan reclaims a crashed run's in-flight work. `SPEC §Out of scope` is emphatic:
liveness is a **heartbeat file/stamp**, reclaim is a **restart-time scan — NOT a network poll or server
sweep**. `STATE §Notes` lists the heartbeat-file format + reclaim cadence as an open question. The
**load-bearing `STATE §Forward note`**: m26 generalises this exact scan into a **fleet orphan scan** and
makes `aof work next` mesh-aware — so the scan must **walk run records by path with no single-node
assumption** (the one genuine seam `26 → 20`).

**Decision.** Liveness is the **`heartbeatAt` ISO-UTC stamp on the run record** (ADR-001's key), bumped on
the running run as the operator's session reports progress — NOT a separate heartbeat file. A run is
**stale** when `state === "running"` AND `now - heartbeatAt > stalenessThreshold` (or `heartbeatAt` is null
AND `now - updatedAt > stalenessThreshold` — a run that never beat). The threshold is read from config
`work.autonomous.heartbeatStaleMs` (a documented default — **the missing-after-N reclaim semantics of
`PRD §Prior-art (c)`**; pure over the passed-in value, the store never reads config — `08/ADR-002`).

The **orphan-reclaim scan** is a pure-ish store function `reclaimStaleRuns(items, { now, stalenessThreshold })`
that:
1. **Walks run records BY PATH** — it iterates the `runsDir(item)` of each supplied item and reads each
   `runs/<run-id>.json` via the existing `readRuns` seam (`19/ADR-002`). It takes the **list of items to
   scan as an argument** and bakes in NO single-node / single-directory assumption — so m26's fleet scan
   passes a wider item set (and, with its `runs/<node>/` path delta, the wider path) with **no rewrite**,
   exactly the `26 → 20` seam the forward-note demands.
2. For each **stale `running`** run: applies the **`running → failed`** transition via the existing
   `applyTransition` (a LEGAL edge — `19/ADR-001`), setting `failureReason = "runtime_offline"` (a crashed
   host is infra, so a reclaimed run is RETRYABLE per ADR-002) and `reclaimedAt = now` (ADR-001's key,
   distinguishing a reclaimed failure from an operator-reported one).
3. **Triggers the status rollback** (ADR-005) for the reclaimed run's item — a reclaimed `running → failed`
   leaves the stream honest by rolling the item `in-progress → not-started`.

Reclaim runs at **restart time** (the start of an `aof:autonomous` loop / the `work:run-start` path picks it
up) — a backstop SCAN, never a daemon/poll (`SPEC §Out of scope`). It touches ONLY stale `running` runs:
a live `running` run (fresh `heartbeatAt`), a `queued` run, and every terminal run are left **byte-
unchanged** (`19/R4` — pin the unaffected sibling).

**Alternatives considered.**
- *A sidecar `runs/<run-id>.heartbeat` file (the "heartbeat file" the PRD/SPEC mention literally)* —
  **rejected**: it splits one run's truth across two files (the same prune-consistency + torn-write hazard
  ADR-001 rejected the metadata sidecar for) and doubles the m26 path-partition surface. A stamp on the
  record is the SPEC's "heartbeat file marks a live run" satisfied with one file — the run record IS the
  heartbeat file. ("Heartbeat file" in the SPEC is the contrast with a network heartbeat, not a mandate for
  a *separate* file.)
- *Bake the single-item scan into `reclaimStaleRuns()` (scan one item's `runs/`)* — **rejected**: it would
  force m26 to rewrite the scan into a fleet walk (the exact rework the forward-note exists to prevent).
  Taking the item list as an argument makes the fleet version a caller change, not a store change.
- *Reclaim transitions a stale run to `cancelled`* — **rejected**: `cancelled` is an operator/agent
  decision; a crash is an infra FAILURE. `running → failed` with `failureReason = runtime_offline` keeps the
  run RETRYABLE (ADR-002) — a reclaimed run can resume, which is the whole point ("a run orphaned by a crash
  is reclaimed, not left wedged", `SPEC §Objective`). Both edges are legal (`19/ADR-001`); the failed edge
  is the correct semantics.
- *A wall-clock TTL with no heartbeat (just `updatedAt` age)* — **rejected as the sole signal**: a long but
  healthy run would be falsely reclaimed. `heartbeatAt` distinguishes "slow but alive" from "crashed"; the
  `updatedAt` fallback covers only a run that never beat at all.

**Consequences.** `src/run-store.mjs` gains a `heartbeat(item, runId, { now })` (bumps `heartbeatAt` via
`applyTransition`'s persist path — a no-state-change update) and `reclaimStaleRuns(items, opts)` (the
path-walking scan). Reclaim REACHES the status-rollback seam (ADR-005) — the one place the store touches an
item indirectly, by calling the rollback writer that lives OUTSIDE the store (the write-scope guard forbids
the store itself writing frontmatter; the scan ORCHESTRATES, the rollback writer in `work.mjs` WRITES). The
`aof:autonomous` skill invokes reclaim at restart (ADR-006). Story **00 · resilience-core** builds the
heartbeat + scan; the rollback it triggers is built in story **01** (ADR-005).

**Invariant.** The reclaim scan walks run records by path (takes the item list as an argument; no
single-node assumption baked in) and force-fails ONLY stale `running` runs via the legal `running → failed`
edge, setting `failureReason = runtime_offline` + `reclaimedAt`; every non-stale and every terminal run is
left byte-unchanged. Its teeth are a fitness function (reclaim transitions only stale `running` runs, only
via legal edges, leaving siblings untouched — arch-test below). The *behaviour* (a real crashed run is
reclaimed on the next restart and its item rolled back) is a story `.feature`.

## ADR-005: Status rollback is the FIRST programmatic item-frontmatter write — a NEW writer in `work.mjs` (`rollbackItemStatus`), bounded `in-progress → not-started|blocked`, NEVER `→ done`, status-field-only, via the atomic `writeText` — explicitly OUTSIDE run-store's `runs/`-only guard

**Status:** Accepted
**Date:** 2026-06-30

**Context.** `SPEC §Scope` (Status rollback on blocker) + `PRD §Prior-art (g)`: a blocked/failed run rolls
the item status back so the stream is left honest. The PRD writes this as `in_progress → todo`; aof's CLOSED
item-status vocabulary (`work.mjs:23`) is `not-started | in-progress | blocked | in-review | done` — there
is **no `todo`**, so the PRD's `in_progress → todo` maps to aof's **`in-progress → not-started`** (a
genuine blocker may instead roll `→ blocked`). The graph confirms `work.mjs` is the item-frontmatter
authority (15 inbound edges) **but exports only READERS** — so this is the **first programmatic item-status
mutation in the codebase**. The recall surfaced `03/ADR-004` ("the board is read-mostly; status is DERIVED
and never written; the feedback append is the board's ONLY mutation") — a deliberate **departure** to
acknowledge: that discipline governs the BOARD face; this is a different, non-board actor.

**Decision.** A NEW writer **`rollbackItemStatus(item, toStatus, { now })`** in `src/work.mjs` — the first
item-frontmatter mutator — bounded hard:
- it may set status ONLY from `in-progress` to **`not-started`** (the `todo` map) or **`blocked`** (a
  genuine blocker), and it **NEVER** sets `→ done` (rolling forward to done is the one move a failure/
  blocker rollback must never make — that would falsely accept un-done work);
- it touches **ONLY the frontmatter `status` field** of the item's record doc (resolved by the existing
  `recordDoc(item)` — `SPEC.md`/`STORY.md`/`SESSION.md`); it rewrites no body, no other frontmatter key;
- it writes via the atomic **`src/fs.mjs:writeText`** temp+rename seam (the same atomicity ADR-007 routes
  the run record through — a rollback is the one frontmatter write resilience makes, so it must be atomic);
- it lives in `work.mjs` **by design OUTSIDE run-store** — the `19/ADR-002` write-scope guard forbids
  run-store / `run-*` writing anything but `runs/`, and `work.mjs` is already the item-frontmatter authority
  (where `recordDoc`/`parseFrontmatter` live). The reclaim scan (ADR-004) and the failed-run path CALL this
  writer; they do not write frontmatter themselves.

**Departure from `03/ADR-004`, acknowledged.** The board's "status is DERIVED, never written" holds for the
read-mostly board FACE. This rollback is a different actor — the resilience reclaim/failure path leaving the
stream honest — and it is a deliberate, bounded write of status, the first in the codebase. It does not
contradict the board discipline (the board still never writes status); it adds a new, narrowly-bounded
writer the board face does not use. The bounding fitness function (below) is the teeth that keep this write
from becoming a general status mutator.

**Alternatives considered.**
- *Put the rollback in run-store* — **rejected**: it directly breaks the `19/ADR-002` write-scope guard
  (run-store writes only `runs/`). The derived/authoritative split is the point — a run record explaining
  "how it got there" must never be the thing that writes the authoritative status; a separate authority
  (`work.mjs`) writes it.
- *A new `work:run-rollback` command (a standalone verb)* — **rejected for this milestone**: the rollback is
  a CONSEQUENCE of a failed/reclaimed run, not an independent operator action — it is reached by the reclaim
  scan and the failed-run path, not invoked alone. A standalone verb would arm the three `19/R1` gates for
  no consumer. (If a future milestone wants an operator-facing rollback verb, it is purely additive — wrap
  this writer.) The writer is a `work.mjs` export the reclaim/failure path calls, not a registered command.
- *Roll back to `blocked` always (never `not-started`)* — **rejected**: a transient infra failure that
  reclaims a run should return the item to the ready pool (`not-started`, so `aof work next` re-offers it),
  not park it as `blocked` (which implies an unmet dependency a human must clear). `not-started` is the
  `in_progress → todo` map; `blocked` is reserved for a genuine blocker. Both are allowed targets; `done` is
  the one forbidden target.
- *Rewrite via a YAML library / general frontmatter writer* — **rejected (scope + risk)**: the codebase has
  no frontmatter WRITER, and a general one is a far larger surface than this milestone needs. A minimal,
  status-field-only rewrite (read record doc → replace the `status:` line → atomic `writeText`) is the
  smallest seam, and the bounding fitness function keeps it minimal.

**Consequences.** `src/work.mjs` gains its first writer, `rollbackItemStatus` — imported by the
failed-run/reclaim path. Because it lives in `work.mjs` (not run-store), it does NOT widen the run-store
write-scope guard; instead it gets its OWN bounding fitness function. The reclaim scan (ADR-004) and the
`work:run-complete --outcome failed` path call it. Story **01 · resilience-commands** builds the writer + its
wiring (it is the command/seam layer, beside the new verbs).

**Invariant.** `rollbackItemStatus` writes status ONLY `in-progress → not-started` or `in-progress →
blocked`, NEVER `→ done`; it touches only the frontmatter `status` field (no body, no other key); and it
writes via the atomic `writeText` seam. Its teeth are a dedicated bounding fitness function — and per
`15/R3` + `10/R2` it scans the whole module family that could write item frontmatter and follows the writer
function, not just one file (arch-test below). The *behaviour* (a real blocked/reclaimed run rolls its item
to not-started and `aof work next` re-offers it) is a story `.feature`.

## ADR-006: Dedup ("no duplicate non-terminal run per item") is where `19`'s reserved `queued` state finally gets a producer and where concurrent `runId` minting (`19/R2b`) is fixed; anti-loop is split — a guard the run records ENABLE in the store + skill-layer guidance in `autonomous.md`

**Status:** Accepted
**Date:** 2026-06-30

**Context.** `SPEC §Scope` (Dedup + anti-loop guards) + `PRD §Prior-art (e)`: no duplicate queued run per
item; multi-agent hand-offs skip self-triggers and cannot loop. `STATE §Notes` lists "where the dedup/
anti-loop guards live relative to the `aof:autonomous` skill" as an open question. `19/ADR-001` reserved
`queued` as representable-but-never-minted, explicitly handing its producer to THIS milestone's dedup; and
`19/R2(b)` hands forward the concurrent-`runId`-mint gap (`seq` is a read-then-write counter — two
interleaved `startRun` calls mint the same id) for this milestone to own.

**Decision.**
- **Dedup is a store guard: "no duplicate NON-TERMINAL run per item."** Before minting a run (both
  `startRun` and `retryRun`), the store checks the item has no existing non-terminal run (`queued` or
  `running`) — if it does, it rejects with a coded `duplicate-run` (no second run minted). This is where
  `19`'s reserved `queued` state gets its producer: a future enqueue path mints a `queued` run, and dedup
  guards against a second non-terminal run for the same item. ("Non-terminal" — `queued`|`running` — is the
  correct generalisation of the PRD's "no duplicate queued run"; in the single-operator model the in-flight
  state is `running`, and dedup forbids a second.)
- **Concurrent `runId` minting (`19/R2b`) is fixed by the mint path.** The `seq` counter's read-then-write
  race is closed by making the mint **collision-safe**: the persist goes through the atomic `writeText`
  (ADR-007) using a **write-if-absent / retry-on-collision** mint (if the minted `runId` file already exists,
  bump `seq` and retry) so two interleaved mints get distinct ids rather than the second silently
  overwriting the first. The dedup check + collision-safe mint together own the concurrency `19/R2(b)`
  deferred here.
- **Anti-loop is SPLIT by altitude.** The part the run records ENABLE lives in the store/command core: a
  hand-off run records its `retryOf`/lineage + `brief.initiator` (ADR-001/`19/ADR-003`), so a self-trigger
  (an agent triggering a run whose initiator is itself, or a run that would re-trigger its own lineage) is
  detectable from the records — a guard the store data makes possible. The part that is JUDGMENT — how the
  cascade's multi-agent hand-offs sequence and when a hand-off is a self-trigger — is **skill-layer guidance
  in `autonomous.md`** (the loop driver), NOT command-core logic. The store provides the FACTS (lineage,
  initiator); the skill applies the POLICY (skip self-triggers, don't loop).

**Alternatives considered.**
- *Dedup at the skill layer (the `autonomous.md` loop checks before triggering)* — **rejected as the sole
  guard**: the store is the only place that sees all runs atomically; a skill-layer-only check races (two
  loop iterations, or a manual trigger alongside the loop). The store guard is the authority; the skill may
  ADDITIONALLY avoid triggering, but the store is the backstop.
- *Put anti-loop entirely in the command core* — **rejected**: "the cascade's hand-offs cannot loop" is a
  multi-agent sequencing policy that depends on the skill's orchestration (which agent hands to which), not
  a single-run invariant. Forcing it into the store would bake cascade topology into the run mechanic. The
  store enables the guard (records the lineage/initiator); the skill applies it. (Mirrors `11/ADR-002`'s
  "prompt-wiring over the existing commands" altitude split — the deterministic mechanic in the store, the
  judgment in the skill.)
- *Fix `19/R2(b)` with a lock file / mutex* — **rejected**: a lock file is a daemon-shaped construct the
  single-operator file model avoids (`SPEC §Out of scope`). A write-if-absent atomic mint (the temp+rename
  seam already gives atomicity) closes the race without a lock.

**Consequences.** `src/run-store.mjs` gains the dedup guard in the mint path (`startRun`/`retryRun` reject a
second non-terminal run with `duplicate-run`) and the collision-safe mint (closing `19/R2b`). `autonomous.md`
gains the anti-loop guidance (skip self-triggers; the run lineage is the signal). Story **00 ·
resilience-core** builds the store guards; story **02 · resilience-skill** updates `autonomous.md`.

**Invariant.** Dedup yields no duplicate non-terminal run per item (a second mint while a `queued`/`running`
run exists is rejected `duplicate-run`, minting nothing); the mint is collision-safe (two interleaved mints
get distinct `runId`s). Its teeth are a fitness function (no duplicate non-terminal run — arch-test below).
The anti-loop POLICY is skill guidance (NOT a fitness function — it is judgment, like `11`'s prompt-wiring);
the store FACTS it relies on (lineage/initiator on the record) are covered by ADR-001/003's key invariants.

## ADR-007: The run-record persist routes through the atomic temp+rename seam `src/fs.mjs:writeText` — closing `19/R2(a)`; the UTC-`Z` `compactStamp` assumption is preserved

**Status:** Accepted
**Date:** 2026-06-30

**Context.** `19/R2(a)` (carried-forward, owner = milestone 20): `src/run-store.mjs:persist()` writes per-run
files with a NON-ATOMIC `node:fs/promises.writeFile`, so a process killed mid-write leaves a torn file. The
read side already TOLERATES a torn file (`readRuns` skips an unparseable record — `19`'s craft fix), but
that only MASKS the gap; the resilience promise ("resumable rests on durable state", `SPEC §Objective`)
requires the WRITE be durable. `src/fs.mjs:writeText` is the atomic temp+rename seam (writes `.tmp-…` then
`rename`-with-retry) that **15 modules already use but run-store does NOT** (the graph confirms). `19/R2`
also flags the `compactStamp` UTC-`Z` assumption to preserve.

**Decision.** `run-store.mjs:persist()` is routed through `src/fs.mjs:writeText(path, content)` — replacing
the raw `writeFile`. The `mkdir(runsDir, { recursive: true })` stays (writeText also mkdir's its dirname, so
this is belt-and-braces, harmless). Every run-record write (start, transition, retry-mint, heartbeat bump,
reclaim) goes through this one atomic seam — a kill mid-write leaves the PRIOR file intact (the rename is
atomic), never a torn file. The `compactStamp` UTC-`Z` `toISOString()` assumption is **preserved**: every
new persist path (the heartbeat bump, the reclaim force-fail, the retry mint) passes a UTC `Z`-form `now`
(the injected ISO-string clock or `new Date().toISOString()`), never a non-UTC clock — keeping the sortable
`runId` stamp + the new ISO-UTC keys (`heartbeatAt`/`reclaimedAt`) consistent.

**Alternatives considered.**
- *Add a bespoke atomic-write helper in run-store* — **rejected**: `src/fs.mjs:writeText` already IS the
  codebase's atomic seam (temp+rename with EACCES/EPERM rename-retry, used by 15 modules). A second
  implementation is duplication and a second thing to get right on Windows (the rename-retry handles a
  Windows file-lock race). Reuse the proven seam — which also makes run-store finally couple to `fs.mjs`
  like its 15 peers (the graph showed it was the lone non-consumer).
- *Leave persist non-atomic and rely on the read-side tolerance* — **rejected**: that is exactly the masking
  `19/R2` says is a latent gap HERE. The whole milestone is durability; a non-atomic write of the durable
  record is the wrong foundation under it.

**Consequences.** `src/run-store.mjs` imports `writeText` from `src/fs.mjs` (closing the one missing edge the
graph flagged) and `persist` becomes a one-line `await writeText(runRecordPath(item, record.runId),
JSON.stringify(record, null, 2))`. No schema/command/face change. Story **00 · resilience-core** makes the
change.

**Invariant.** No raw `writeFile`/`appendFile` of a run record exists in `run-store.mjs` — every run-record
write goes through the atomic `writeText` seam, and every persist path passes a UTC-`Z` `now`. Its teeth are
a fitness function (persist is atomic — no raw `writeFile` of a run record; source-grep — arch-test below).
The *behaviour* (a kill mid-write leaves a recoverable store) is asserted structurally (the seam is atomic)
+ exercised by the existing read-tolerance and a story `.feature`.

## ADR-008: This milestone adds NO new stop conditions — it CONFORMS to the existing `aof:autonomous` stops (`@uat`, blocker, unsafe ambiguity); resilience makes those stops RELIABLE, it does not add any

**Status:** Accepted
**Date:** 2026-06-30

**Context.** `SPEC §Objective` + `SPEC §Scope` (Conformance to the existing stop conditions): the loop "still
stops only on a genuine human gate (`@uat`), a blocker, or unsafe ambiguity; resilience makes those stops
*reliable*, it does not add new ones." `autonomous.md` `<stop_conditions>` already enumerates the stops
(a `@uat` gate; a `blocked` result; a wrong/infeasible contract; an undefaultable decision; `maxAttempts`
exhausted). This is a CONSTRAINT on the whole milestone, recorded as an ADR so no resilience mechanic
silently invents a new hand-back.

**Decision.** The resilience mechanics map ONTO the existing stops, adding none:
- the **attempt ceiling** (ADR-002) feeds the existing `maxAttempts exhausted` stop — it does not add a new
  one; it makes that stop FIRE reliably (a genuinely-failing item halts instead of looping);
- **status rollback** (ADR-005) leaves the stream honest for the existing `blocked`/`next` machinery — a
  rolled-back item re-enters the ready pool or shows `blocked`, both already understood by `aof work next`;
- **reclaim** (ADR-004) recovers an orphaned run so the loop can RESUME — it does not stop the loop, it
  prevents a silent wedge;
- **dedup/anti-loop** (ADR-006) prevent a runaway, which is reliability, not a new gate.

The `aof:autonomous` skill (ADR-006, story 02) gains the resilience calls (reclaim-at-restart, retry-on-
infra-failure, the anti-loop guidance) but its `<stop_conditions>` set is UNCHANGED.

**Alternatives considered.**
- *Add a "run reclaimed" or "ceiling hit" stop* — **rejected**: a reclaim is a RECOVERY (resume, don't
  stop); a ceiling hit is the EXISTING `maxAttempts exhausted` stop. Adding new stops would contradict
  `SPEC §Objective` ("does not add new ones") and fragment the operator's mental model of when the cascade
  hands back.

**Consequences.** Story **02 · resilience-skill** updates `autonomous.md` to CALL the new commands within the
existing loop + stop set; it does NOT add a `<stop_conditions>` entry. No fitness function — this is a
conformance constraint over a skill markdown file (judgment, like `11`'s prompt-wiring); it is asserted by
review (the `autonomous.md` stop set is unchanged) + a story-02 `.feature` that the loop still stops only on
the three gates.

**Invariant.** `autonomous.md`'s `<stop_conditions>` set is unchanged by this milestone (no new stop). This
is a review-asserted conformance constraint, not an arch-test (it governs skill prose); story 02's
`.feature` exercises that the hardened loop stops only on `@uat`/blocker/unsafe-ambiguity.

## ADR-009: The `failureReason` PRODUCER is split store + command — the store writes it on a `→ failed` transition (`completeRun`/`applyTransition`, story 00), the CLI surfaces it via `work:run-complete --reason` (story 01); ratifying the Contract-stage default ADR-001/002 left open

**Status:** Accepted (ratified at Accept, 2026-06-30 — was a documented Contract-stage default)
**Date:** 2026-06-30

**Context.** ADR-001 froze `failureReason` as a run-record key and ADR-002 built the closed classification
table over it, but **no ADR named who SETS** `timeout` / `agent_error` on a failed run — ADR-004 named only
the reclaim path's `runtime_offline`. The Three-Amigos feasibility check (Contract stage, `aof:refine 20
--autonomous`) surfaced the gap: five task features depend on a failed run carrying a reason, yet the
PRODUCER was unspecified. It was taken as a documented, reversible default (`STATE §Notes`) — additive, not
a stop — with a candidate ADR-009 to ratify it at Accept **if it proved durable**. It did: shipped and
verified green (`04_run-complete-reason.feature`, `run-resilience-acceptance/03`), so the default is ratified
here as a first-class ADR (the retrospective lesson is `20/R2`).

**Decision.** The `failureReason` producer is **split by altitude**, mirroring the store-mechanic /
command-edge split the rest of the milestone follows:
- **Store half (story 00).** `completeRun` / `applyTransition` gain an optional `failureReason`, written
  **verbatim** on a `→ failed` transition (and only then). The store does NOT validate it against the closed
  set — closed-set safety stays with the classifier failing closed (ADR-002: an unknown/`null` reason →
  non-retryable), NOT a store rejection. A non-failed outcome leaves `failureReason` `null` (ADR-001).
- **Command half (story 01).** `work:run-complete` gains `--reason`, extending the EXISTING milestone-19
  command — so it arms **no** `19/R1` registry gate (no new verb). A `--reason` on a non-failed outcome is
  ignored (the store writes `null`); a re-fail with no `--reason` preserves the prior `failureReason`
  (`failureReason ?? record.failureReason`).

**Alternatives considered.**
- *Have the store validate `failureReason` against the closed set on write* — **rejected**: it duplicates
  the classifier (ADR-002) and splits the closed-set authority. The store persists verbatim; the pure
  classifier is the single authority that decides retryability and fails closed on anything unrecognised.
- *A dedicated `work:run-fail` verb* — **rejected**: it arms the three `19/R1` gates for no new consumer;
  `--reason` on the existing `run-complete --outcome failed` is the additive, gate-free seam.

**Consequences.** `src/run-store.mjs` (`completeRun`/`applyTransition`) writes the reason on `→ failed`;
`src/commands/run-complete.mjs` adds `--reason`. The reclaim path (ADR-004) is the store's OTHER producer
(it sets `runtime_offline` directly). No new fitness function — the behaviour is pinned by
`04_run-complete-reason.feature` (`@executable`); the no-`--reason`-preserves branch is an open hardening
follow-up (VERIFICATION `@finding-F-20-02`).

**Invariant.** `failureReason` is written ONLY on a `→ failed` transition (store) — verbatim, unvalidated —
and surfaced ONLY through `work:run-complete --reason` (command) and the reclaim path's `runtime_offline`;
a non-failed outcome leaves it `null`. Asserted behaviourally by `04_run-complete-reason.feature`, not a
fitness function (the producer is a write-path behaviour, not a structural invariant over the module).

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is the correct state now: the new store functions, the run-retry command, and the
     rollbackItemStatus writer do not exist yet; the tests reference them so they fail cleanly until the
     owning story lands. The "From" column names the story (per the partition below) that BUILDS the test.
     Per 15/R3 + 10/R2 every source-grep fitness function scans the whole MODULE FAMILY it governs and
     follows the FUNCTION, not a single file. -->

| Invariant | Enforced by (arch-test, name + what it asserts) | State now | From |
|---|---|---|---|
| **Classification table is closed + the function is pure.** `runtime_offline`/`timeout` → retryable; `agent_error`/unknown/`null` → non-retryable; `shouldRetry` fails closed at `attempt >= maxAttempts`; `isRetryable`/`shouldRetry` read no clock/fs/config (ADR-002). | `test/arch/acd-run-retry-classification.test.mjs` — import `isRetryable`/`shouldRetry` from `run-store.mjs`; assert the full closed table (each reason → expected boolean, unknown + null → false); assert `shouldRetry(record, max)` is true iff `isRetryable(record.failureReason) && record.attempt < max` and false at the ceiling; **purity** by source-grep of the function bodies (no `Date`/`readFile`/`process`/`loadWorkspace`), the `06/ADR-003` pure-resolver discipline. | RED until `run-store.mjs` exports `isRetryable`/`shouldRetry` | **00 · resilience-core** |
| **Retry RESUMES the prior session on the same lineage; a fresh start does NOT.** A `work:run-retry` record carries `sessionId = prior.sessionId`, `attempt = prior.attempt + 1`, `retryOf = prior.runId`; a `work:run-start` record carries `retryOf = null` and never a prior session (ADR-003). | `test/arch/acd-run-retry-resumes-lineage.test.mjs` — via the store: start a run with a sessionId → fail it (`failureReason` retryable) → retry; assert the retry record's `sessionId`/`attempt`/`retryOf` are the lineage values; assert a separate `startRun` record has `retryOf: null` and an independent (or null) session. Also assert a non-retryable / ceiling-exhausted prior → a coded error and **no new run minted** (the `19/R4` unaffected-sibling pin: the prior record is byte-unchanged). | RED until `run-store.mjs` exports `retryRun` + `run-retry.mjs` exists | **00 · resilience-core** (store) / **01 · resilience-commands** (command path) |
| **Reclaim transitions ONLY stale `running` runs, ONLY via the legal `running → failed` edge, and walks by path.** `reclaimStaleRuns(items, …)` force-fails a stale `running` run (`failureReason = runtime_offline`, `reclaimedAt` set), leaves every live/queued/terminal run byte-unchanged, takes the item list as an argument (no single-node assumption), and uses `applyTransition` (a legal edge) (ADR-004). | `test/arch/acd-run-reclaim-stale-only.test.mjs` — fixture items with a mix: a stale `running` run, a fresh-heartbeat `running` run, a `queued` run, a terminal run; run `reclaimStaleRuns` with a `now`/threshold; assert only the stale one became `failed` (with `runtime_offline` + `reclaimedAt`), the others are **byte-identical** (`19/R4`); source-grep asserts the scan takes an item-LIST arg (no hard-coded single dir) and transitions via `applyTransition`/`isLegalTransition` (the `26 → 20` path-walk seam). | RED until `run-store.mjs` exports `reclaimStaleRuns`/`heartbeat` | **00 · resilience-core** |
| **Status-rollback write-scope + status-bounding.** `rollbackItemStatus` (in `work.mjs`) writes status ONLY `in-progress → not-started` or `in-progress → blocked`, NEVER `→ done`; touches only the frontmatter `status` field; writes via the atomic `writeText`; and it is the ONLY item-frontmatter status writer (ADR-005). | `test/arch/acd-status-rollback-bounded.test.mjs` — (a) behavioural: fixture item `in-progress`; `rollbackItemStatus` → `not-started` and → `blocked` succeed (record-doc body + all other frontmatter byte-unchanged save the `status:` line); a `→ done` (or a from-state ≠ `in-progress`) is rejected, writing nothing. (b) source-grep over the **whole module family that could write item frontmatter** (`work.mjs` + any `commands/*` / `run-*`), following the writer function: the only status-field write is `rollbackItemStatus`, it never targets `done`, and it goes through `writeText` (per `15/R3` + `10/R2` — scan the family, follow the function). | RED until `work.mjs` exports `rollbackItemStatus` | **01 · resilience-commands** |
| **Persist is atomic — no raw `writeFile` of a run record.** Every run-record write in `run-store.mjs` goes through the atomic `src/fs.mjs:writeText` temp+rename seam; no raw `writeFile`/`appendFile` targets a `runs/<id>.json` (ADR-007, closing `19/R2a`). | `test/arch/acd-run-persist-atomic.test.mjs` — source-grep `run-store.mjs` (call-form, comments discounted): `persist` calls `writeText`; there is **no** `writeFile`/`appendFile` of a run-record path; assert `run-store.mjs` imports `writeText` from `./fs.mjs` (the previously-missing edge). | RED until `run-store.mjs` routes `persist` through `writeText` | **00 · resilience-core** |
| **Dedup yields no duplicate non-terminal run per item.** The mint path (`startRun`/`retryRun`) rejects a second non-terminal (`queued`/`running`) run for an item with `duplicate-run`, minting nothing; the mint is collision-safe (two interleaved mints get distinct `runId`s) (ADR-006, owning `19/R2b`). | `test/arch/acd-run-dedup-no-duplicate.test.mjs` — via the store: a `running` run exists → a second `startRun`/`retryRun` rejects `duplicate-run` and writes no second file; the first record is byte-unchanged. Plus a collision check: two mints at the same injected `now` produce distinct `runId`s (the seq/collision-safe mint), one file each. | RED until `run-store.mjs` adds the dedup guard + collision-safe mint | **00 · resilience-core** |
| **The new command's registry-derived gates (`19/R1`) are each satisfied.** `work:run-retry` is CLI-bijection-covered (a `cli` adapter + an `aof work run-retry` dispatch branch + a clean `--json` + an `argsFor("run-retry")` case), is in the `WORK_IDS` allow-list, and is in `BOARD_DEFERRED` for the `/api/work` route-coverage (board is m21) (ADR-003). | EXTEND the three existing registry-derived arch-tests: `acd-work-command-cli-bijection.test.mjs` (add the `argsFor("run-retry")` case — its switch THROWS on an unmapped sub, so this is required, `19/R1`); `command-core-contract.test.mjs` (add `work:run-retry` to `WORK_IDS`); `acd-work-command-route-coverage.test.mjs` (add `run-retry` to `BOARD_DEFERRED`). | RED (the `argsFor` switch throws on `run-retry`; the `WORK_IDS` allow-list mismatches) until story 01 registers `work:run-retry` + extends the three tests | **01 · resilience-commands** |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 19's / 08's split):
     - The CLASSIFICATION table, the RETRY-LINEAGE shape, the RECLAIM stale-only + legal-edge + path-walk
       guard, the STATUS-ROLLBACK bounding, the ATOMIC persist, the DEDUP no-duplicate, and the new
       command's registry gates are true STRUCTURAL invariants over the store's pure functions, the record
       shape, the write surface, and the registry/dispatch → arch-tests (this table). They are the
       milestone's load-bearing structural deliverable.
     - The OBSERVABLE behaviours are story .feature files, NOT here:
         · a cascade interrupted by an infra failure RESUMES its session and completes (ADR-003/004 end-to-end);
         · a rejected output triggers a FRESH-session rerun (run-start, not run-retry);
         · the attempt ceiling HALTS a genuinely-failing item instead of looping (ADR-002 end-to-end);
         · a run orphaned by a crash is RECLAIMED on the next restart and its item rolled back (ADR-004/005 e2e);
         · the hardened loop still STOPS only on @uat / blocker / unsafe-ambiguity (ADR-008 conformance).
       These exercise the real seam, the real filesystem, and the real CLI/skill (mirroring 19's
       "a real run start→complete survives a restart is a .feature, not a fitness function").
     - Anti-loop POLICY (ADR-006) and the no-new-stop CONFORMANCE (ADR-008) are skill-layer JUDGMENT over
       autonomous.md (like 11's prompt-wiring), asserted by review + a story-02 .feature — NOT fitness
       functions; the store FACTS anti-loop relies on (lineage/initiator) are covered by ADR-001/003. -->

## Story break-down rationale

<!-- Informs the PO's break-down; does NOT itself create stories. The partition follows the real
     call/dependency coupling the codebase graph reports, not inferred coupling. -->

The PO will partition milestone 20; the recommendation below follows the **real call/dependency coupling**
the codebase graph reports (`aof graph build src` → **1061 nodes / 2872 edges**, built at author time
2026-06-30; `aof graph impact` re-run at author time — cited as **actual** structure, not inferred).

**The two natural shapes, weighed.**

- **By-layer (the `19` precedent — a clean single-direction chain).** A resilience-core story (everything in
  `run-store.mjs` + the atomic-persist fix + the schema extension) → a resilience-commands story (the
  `work:run-retry` verb + the `rollbackItemStatus` seam in `work.mjs`, registered/wired through the command
  core) → a resilience-skill story (`autonomous.md` consuming the new commands + the anti-loop guidance).
  Coupling is single-direction: commands depend on the store; the skill depends on the commands. This is
  **grounded in the graph**: `run-store.mjs` is the spine (`aof graph impact src/run-store.mjs` → imported
  by EXACTLY the 3 run commands, imports nothing), so every new mechanic there is a dependency ROOT the
  commands and skill consume.

- **By-concern (more parallel but concurrent edits to the spine).** e.g. retry-lineage | liveness+reclaim |
  rollback | dedup+anti-loop as four parallel stories. The graph shows why this is the worse cut: ADRs 001,
  002, 003, 004, 006, 007 ALL land in `run-store.mjs` (the spine), and ADR-005 + the new command land in
  `work.mjs` + `command-core.mjs`. Four concern-stories would all edit `run-store.mjs` concurrently —
  **file-level contention on the single spine** (worktree-isolation merge pain), and the schema extension
  (ADR-001) + atomic-persist (ADR-007) + dedup (ADR-006) are entangled in the same `persist`/mint path, so
  they cannot truly proceed in parallel. The parallelism is illusory; the spine serialises them anyway.

**Recommendation: by-layer, THREE stories** (the `19` precedent extended by one, because this milestone has
a skill-consumption layer `19` did not). The cut follows the graph's dependency direction and minimises
cross-story coupling to a single forward chain.

- **00 · resilience-core** — all the `src/run-store.mjs` mechanics: the schema extension (ADR-001), the
  classification table + ceiling (ADR-002), the `retryRun` lineage mint (ADR-003, store side), the
  `heartbeat` + `reclaimStaleRuns` path-walking scan (ADR-004), the dedup guard + collision-safe mint
  (ADR-006), and the atomic-persist fix (ADR-007). **Owns fitness functions:** classification-closed-pure,
  retry-resumes-lineage (store side), reclaim-stale-only, persist-atomic, dedup-no-duplicate. **Dependency
  direction:** the ROOT — depends on nothing in this milestone (it consumes only `19`'s store + `fs.mjs`).
  *Grounded:* `run-store.mjs` is imported by exactly the 3 run commands and imports nothing — the spine; it
  must be frozen before the commands/skill can build or test.

- **01 · resilience-commands** — the `src/commands/run-retry.mjs` verb (ADR-003) registered into
  `src/command-core.mjs` + its CLI face, the three `19/R1` gate satisfactions (CLI-bijection `argsFor`,
  `WORK_IDS`, `BOARD_DEFERRED`), and the `rollbackItemStatus` writer in `src/work.mjs` (ADR-005) wired into
  the failed-run/reclaim path. **Owns fitness functions:** status-rollback-bounded, the new-command
  registry gates, retry-resumes-lineage (command path). **Dependency direction:** depends ONLY on story 00
  (the store functions it wraps). *Grounded:* `command-core.mjs` is the additive door (one import + one
  `COMMANDS` entry — the m09–m19 precedent); `work.mjs` is the item-frontmatter authority where the first
  status writer belongs (NOT the store — the write-scope guard).

- **02 · resilience-skill** — `src/bundle/commands/autonomous.md` (and its generated copy) consuming the new
  commands: reclaim-at-restart, retry-on-infra-failure within the existing loop, the anti-loop guidance
  (ADR-006 skill side), and the no-new-stop conformance (ADR-008). **Owns NO fitness function** (it is
  skill-layer judgment, asserted by review + `.feature`s — the `11` prompt-wiring altitude). **Dependency
  direction:** depends on story 01 (the commands it drives). *Grounded:* the skill is the loop driver above
  the command core; it couples DOWN to the registered commands, never sideways into the store.

**The board face stays untouched (milestone 21), confirmed by the graph.** `aof graph impact
src/board-ui.mjs` reports it imports ONLY `command-core.mjs` + `work.mjs` — there is **no edge from any of
this milestone's work into `board-ui.mjs`**. The new `work:run-retry` verb takes the precedented
`BOARD_DEFERRED` carve-out (joining `19`'s `run-*`); surfacing run history / reclaim / a rerun affordance on
the board is m21 (`SPEC §Out of scope`). The partition wires only the CLI + skill faces.

The coupling is **advisory**: it informs why core-first (00 → 01 → 02) is the right cut (the call graph's
dependency direction + the spine-contention argument against by-concern), but the PO draws the final
partition. The graph confirms — it does not dictate.
