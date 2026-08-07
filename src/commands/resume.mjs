// work:resume — the deterministic re-entry point after a run was killed by infra
// (348 auto-resume).
//
// WHY THIS EXISTS. When an API session limit kills the orchestrator, aof cannot
// restart it: the orchestrator IS the Claude Code session, and this CLI is a child
// of the thing that died. What aof CAN remove is the cost of coming back — measured
// on voice-vox 348, three kills cost 6h18m of dead run, and each restart then spent
// ten to twenty minutes with the orchestrator re-deriving state it had already
// established (worse, once: it re-authored a killed architect's work by hand instead
// of resuming its lineage, discarding a completed run).
//
// So this verb answers ONE question completely: **what should resume, and is it
// ready?** A sweep (no ref) reports every retryable failed run in the stream with
// its readiness; a ref RESUMES that item's lineage. It re-derives nothing — the
// classification, the ceiling and the park gate are all the run store's
// (retryReadiness), and the mint is the same transition run-retry uses. Two faces,
// one authority.
//
// It NEVER resumes work it cannot execute. A resumed run record means "an executor
// is on this"; minting one with nothing behind it would make the record lie, which
// is strictly worse than the failure it replaces. The sweep therefore REPORTS ready
// local runs (the caller re-enters) and only ACTS when asked for a ref.
import { resolveItem, resolveItemExact, requireLocalCheckout } from "./resolve.mjs";
import { commandError } from "../command-error.mjs";
import { readRuns, retryReadiness, isStale } from "../run-store.mjs";
import { transitionRunStart, transitionStaleRunsReclaimed } from "../effects/run-transitions.mjs";
import { listStreamCacheFirst } from "../work-read.mjs";
import { meshNodeIdOf } from "./mesh-gate.mjs";
import { lockContextFor } from "../item-lock.mjs";

// The liveness window a `running` run may go quiet for before it is treated as
// STRANDED rather than working (20/ADR-004's heartbeat rule; the resolved value is
// passed to the store, which reads no config).
const DEFAULT_HEARTBEAT_STALE_MS = 15 * 60 * 1000;

// The most recent terminal `failed` run on an item — the one a resume would target,
// resolved exactly as retryRun resolves its default prior (no second rule).
function latestFailed(runs) {
  return [...runs].reverse().find((run) => run.state === "failed") ?? null;
}

// One sweep row per item that has something resumable, or null. Pure over the runs
// it is handed plus the injected clock/ceiling/threshold.
//
// The order of the two cases below is load-bearing. A run left `running` OUTRANKS a
// prior failure, because a stranded run is the WORSE state: the milestone looks
// busy while nothing is driving it, which is exactly how 348 lost a night.
function readinessRow(ref, runs, { maxAttempts, nowMs, stalenessThreshold }) {
  const running = runs.filter((run) => run.state === "running");
  // Genuinely working — a recent heartbeat. Report it so the operator knows why the
  // item is not offered, but never as something to resume.
  if (running.some((run) => !isStale(run, nowMs, stalenessThreshold))) {
    const live = running.find((run) => !isStale(run, nowMs, stalenessThreshold));
    return { ref, runId: live.runId, attempt: live.attempt, maxAttempts, failureReason: null, sessionId: live.sessionId ?? null, resumeAfter: null, ready: false, state: "in-flight", readyAt: null, silentSince: live.heartbeatAt ?? live.updatedAt };
  }
  // STRANDED — `running` on disk, silent past the liveness window. This is the shape
  // an orchestrator killed mid-turn leaves behind: it never got to record its own
  // death, so nothing ever marked the run failed and nothing will. Resuming it means
  // reclaim-then-retry, which the ACT path below does in that order.
  const stranded = running[running.length - 1];
  if (stranded) {
    const exhausted = stranded.attempt >= maxAttempts;
    return {
      ref,
      runId: stranded.runId,
      attempt: stranded.attempt,
      maxAttempts,
      failureReason: null,
      sessionId: stranded.sessionId ?? null,
      resumeAfter: null,
      ready: !exhausted,
      state: exhausted ? "attempts-exhausted" : "stranded",
      readyAt: null,
      silentSince: stranded.heartbeatAt ?? stranded.updatedAt,
    };
  }

  const prior = latestFailed(runs);
  if (!prior) return null;
  const readiness = retryReadiness(prior, maxAttempts, nowMs);
  // A non-retryable failure is not "resumable work pending" — it is a finished,
  // judged failure. Reporting it here would put agent_error rows in a list whose
  // whole purpose is "what is waiting to come back".
  if (readiness.state === "not-retryable") return null;
  return {
    ref,
    runId: prior.runId,
    attempt: prior.attempt,
    maxAttempts,
    failureReason: prior.failureReason ?? null,
    sessionId: prior.sessionId ?? null,
    resumeAfter: prior.resumeAfter ?? null,
    ...readiness,
    silentSince: null,
  };
}

export const resumeCommand = {
  id: "work:resume",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      maxAttempts: { type: "number" },
      // The park override, forwarded verbatim to the store's gate (run-retry's flag).
      force: { type: "boolean" },
      // `now` (ISO-8601 UTC-Z) is an INJECTED clock for deterministic assertions —
      // a test input, never a CLI flag (the 22/R2 white-box idiom).
      now: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const now = input.now ?? new Date().toISOString();
    const nowMs = Date.parse(now);
    // The ceiling is resolved ONCE at this edge and passed down as data — the store
    // reads no config (08/ADR-002 basis-neutral), exactly as run-retry does.
    const maxAttempts = input.maxAttempts ?? ctx.workspace.config?.work?.autonomous?.maxAttempts ?? 3;
    const stalenessThreshold = ctx.workspace.config?.work?.autonomous?.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS;
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    const seamOpts = { lock: lockContextFor(ctx.workspace, ctx), journalOptions: ctx.effectsJournalOptions ?? {} };

    // ---- ACT: a ref resumes that item's lineage -----------------------------
    if (ref) {
      const item = await resolveItemExact(ctx, ref);
      if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
      requireLocalCheckout(item, ref);

      // RECLAIM FIRST. A run stranded `running` by a killed orchestrator has no
      // terminal state, so `retryRun` would find no failed prior and refuse
      // `no-retryable-run` — the honest-looking answer that is completely wrong
      // about what happened. The store's own scan settles it to failed /
      // runtime_offline / reclaimedAt (retryable per ADR-002), and the retry below
      // then resumes THAT lineage. The staleness rule is the store's; this command
      // only supplies the resolved threshold.
      const reclaimed = await transitionStaleRunsReclaimed([item], { now: input.now, stalenessThreshold }, seamOpts);
      // The store owns every refusal (no-retryable-run / not-retryable /
      // attempts-exhausted / retry-parked / duplicate-run) — they propagate coded
      // and untouched, and a refusal mints nothing. This command adds no gate of
      // its own: a second copy of the retry rules is exactly how the two faces
      // would drift apart.
      const { record } = await transitionRunStart(
        item,
        { mode: "retry", maxAttempts, now: input.now, node: meshNodeIdOf(ctx.workspace.config), force: Boolean(input.force) },
        seamOpts,
      );
      return { resumed: true, reclaimed: reclaimed.map((entry) => entry.record.runId), ...record };
    }

    // ---- SWEEP: what is waiting to come back, and when -----------------------
    const rows = await listStreamCacheFirst(ctx.workspace, {
      globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {},
    });
    const pending = [];
    for (const row of rows) {
      // Cache-answered rows carry no local `runs/` dir to read. Skipping them is
      // honest here (this node cannot resume another node's checkout anyway) and
      // is the same reach-through discipline run-status applies.
      if (!row.dir) continue;
      const item = await resolveItem(ctx, row.ref);
      if (!item?.dir) continue;
      const entry = readinessRow(row.ref, await readRuns(item), { maxAttempts, nowMs, stalenessThreshold });
      if (entry) pending.push({ ...entry, status: row.status ?? null, title: row.title ?? null });
    }
    // Ready first, then parked by how soon they wake — the order an operator acts in.
    pending.sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return String(a.readyAt ?? "").localeCompare(String(b.readyAt ?? ""));
    });
    return {
      resumed: false,
      now,
      maxAttempts,
      pending,
      ready: pending.filter((row) => row.ready).map((row) => row.ref),
    };
  },

  cli: {
    route: ["work", "resume"],
    spec: {
      usage: "aof work resume [<ref>] [--force] [--max-attempts N] [--json]",
      flags: {
        force: { type: "boolean", description: "resume a parked (session_limit) run before its stated reset" },
        maxAttempts: { type: "string", description: "override the retry attempt ceiling" },
      },
    },

    argv: (positionals, options) => ({
      ...(positionals[0] ? { ref: positionals[0] } : {}),
      ...(options.force ? { force: true } : {}),
      ...(options.maxAttempts != null ? { maxAttempts: Number(options.maxAttempts) } : {}),
    }),

    render(result) {
      if (result.resumed) {
        const reclaimed = result.reclaimed?.length
          ? `\nReclaimed ${result.reclaimed.join(", ")} first — it was left running by a killed session and had recorded no outcome.`
          : "";
        return `Resumed run ${result.runId} for ${result.itemRef} — state ${result.state} (attempt ${result.attempt}).${reclaimed}`;
      }
      if (result.pending.length === 0) {
        return "Nothing to resume — no retryable failed runs in the stream.";
      }
      const lines = [];
      for (const row of result.pending) {
        const when =
          row.state === "parked"
            ? `parked until ${row.readyAt}`
            : row.state === "attempts-exhausted"
              ? `attempts exhausted (${row.attempt}/${row.maxAttempts})`
              : row.state === "in-flight"
                ? `running (last seen ${row.silentSince})`
                : row.state === "stranded"
                  ? `STRANDED — running on disk but silent since ${row.silentSince}`
                  : "READY";
        const cause = row.state === "stranded" || row.state === "in-flight" ? "no terminal state recorded" : (row.failureReason ?? "unknown");
        lines.push(`  ${row.ref}  ${when}  — ${cause} (attempt ${row.attempt}/${row.maxAttempts}, run ${row.runId})`);
      }
      const head = `${result.pending.length} item(s) with a resumable run:`;
      // The re-entry instruction is the POINT of this command — an operator coming
      // back to a dead run should not have to work out the next move.
      const ready = result.ready;
      const tail = ready.length
        ? `\n\nResume now:\n${ready.map((r) => `  aof work resume ${r}`).join("\n")}`
        : "\n\nNothing is ready yet — re-run this command after the earliest readyAt above.";
      return `${head}\n${lines.join("\n")}${tail}`;
    },

    json: (result) => result,
  },
};
