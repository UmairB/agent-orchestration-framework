// Traceability wiring for 348 auto-resume — the session-limit park gate and the
// deterministic re-entry face (work:resume).
//
// WHY THIS SUITE EXISTS. On voice-vox milestone 348 three API session limits cost
// 6h18m of dead run. The vocabulary had no word for that failure, so every kill was
// recorded as `runtime_offline`: retryable, but carrying no reset time, so nothing
// could distinguish "retry now" from "retry at 1:10am" and nothing could tell an
// operator what was waiting to come back. These tests pin the three properties that
// close it — the reason is FIRST CLASS, the record carries WHEN, and a retry before
// then is REFUSED rather than burning an attempt into a still-limited window.
//
// Exercises the REAL store + the REAL in-process registry against temp fixture repos
// (mkdtemp → build → run → rm in finally). The clock is INJECTED everywhere (`now`),
// never read, so nothing here is time-of-day flaky.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { parseResumeAfter, retryReadiness, retryRun, startRun, completeRun, readRuns, isRetryable } from "../src/run-store.mjs";

const FROZEN_KEYS = ["runId", "itemRef", "state", "attempt", "outcome", "sessionId", "brief", "createdAt", "updatedAt", "failureReason", "heartbeatAt", "retryOf", "reclaimedAt", "node", "resumeAfter"];

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-session-limit-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8",
  );
  return { repo, workDir };
}

async function buildMilestone(workDir, { number = "348", slug = "ar-gate", status = "in-progress" } = {}) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    `---\ntype: milestone\nnumber: ${number}\nslug: ${slug}\nstatus: ${status}\ntitle: "Gate"\ncreated: 2026-08-05\nupdated: 2026-08-05\n---\n# ${number}\n`,
    "utf8",
  );
  return { ref: number, dir };
}

async function ctxFor(repo) {
  return { workspace: await loadWorkspace(repo) };
}

async function expectCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a rejection with code ${code}, got none`);
  assert.equal(caught.code, code, `expected code ${code}, got ${caught.code} (${caught.message})`);
  return caught;
}

export const runSessionLimitResumeTests = [
  {
    name: "session-limit/parse: the three REAL 348 kills resolve to the right absolute instant, across the BST/GMT boundary",
    run: async () => {
      // Every row is a kill this milestone actually took, with the platform's own
      // words and the wall-clock instant it arrived. Getting "1:10am" wrong by a day
      // is a four-hour early resume into a still-limited window.
      const rows = [
        ["1:10am (Europe/London)", "2026-08-05T21:05:00.000Z", "2026-08-06T00:10:00.000Z", "BST: already past today ⇒ tomorrow, −1h to UTC"],
        ["8:10pm (Europe/London)", "2026-08-05T16:58:00.000Z", "2026-08-05T19:10:00.000Z", "BST: still ahead today"],
        ["2:40pm (Europe/London)", "2026-08-06T11:06:00.000Z", "2026-08-06T13:40:00.000Z", "BST: still ahead today"],
        // The SAME words in winter must NOT give the same offset — this is the row
        // that fails if a fixed offset is ever substituted for real zone maths.
        ["1:10am (Europe/London)", "2026-01-15T21:05:00.000Z", "2026-01-16T01:10:00.000Z", "GMT: no offset"],
        ["12:30am (America/New_York)", "2026-08-05T21:05:00.000Z", "2026-08-06T04:30:00.000Z", "EDT −4"],
        ["20:10 (UTC)", "2026-08-05T16:58:00.000Z", "2026-08-05T20:10:00.000Z", "24-hour form"],
        ["2026-08-06T01:00:00.000Z", "2026-08-05T21:05:00.000Z", "2026-08-06T01:00:00.000Z", "an explicit ISO instant passes through"],
      ];
      for (const [words, now, expected, why] of rows) {
        const parsed = parseResumeAfter(words, { now });
        assert.equal(parsed.resumeAfter, expected, `"${words}" seen at ${now} ⇒ ${expected} (${why})`);
        assert.ok(parsed.source === "clock" || parsed.source === "iso", `"${words}" is read, not guessed`);
      }
    },
  },
  {
    name: "session-limit/parse: an unreadable reset parks conservatively and SAYS it guessed — it never throws on the failure path",
    run: async () => {
      // This runs while the run is already dying. A throw here would lose the
      // failure record itself, which is strictly worse than a wrong park.
      for (const bad of [null, undefined, "", "gibberish", "resets soon", "3:00pm (Not/AZone)", "99:99pm (UTC)"]) {
        const parsed = parseResumeAfter(bad, { now: "2026-08-05T21:05:00.000Z" });
        assert.equal(parsed.source, "fallback", `${JSON.stringify(bad)} falls back`);
        assert.equal(parsed.resumeAfter, "2026-08-05T22:05:00.000Z", "the default park is one hour on");
        assert.match(parsed.note, /no readable reset/, "the guess is DECLARED — a fallback must never read as an authority");
        assert.notEqual(parsed.source, "clock", "a fallback is never reported as a read reset");
      }
    },
  },
  {
    name: "session-limit/classify: session_limit is retryable as a class, and the clock gate is a SEPARATE pure function",
    run: async () => {
      assert.equal(isRetryable("session_limit"), true, "the platform stopping us is infra, not a bad agent output");
      assert.equal(isRetryable("agent_error"), false, "the closed table is otherwise unchanged");

      const parked = { failureReason: "session_limit", attempt: 1, resumeAfter: "2026-08-06T00:10:00.000Z" };
      assert.deepEqual(
        retryReadiness(parked, 3, Date.parse("2026-08-05T21:06:00.000Z")),
        { ready: false, state: "parked", readyAt: "2026-08-06T00:10:00.000Z" },
        "one minute after the kill: parked, and it says until when",
      );
      assert.deepEqual(
        retryReadiness(parked, 3, Date.parse("2026-08-06T00:11:00.000Z")),
        { ready: true, state: "ready", readyAt: "2026-08-06T00:10:00.000Z" },
        "one minute after the reset: ready",
      );
      // The ceiling and the classification still outrank the clock.
      assert.equal(retryReadiness({ ...parked, attempt: 3 }, 3, Date.parse("2026-08-06T00:11:00.000Z")).state, "attempts-exhausted");
      assert.equal(retryReadiness({ failureReason: "agent_error", attempt: 1 }, 3, 0).state, "not-retryable");
      // NO REGRESSION: a failure with no park stamp is ready immediately, which is
      // exactly today's behaviour for every pre-348 record and reason.
      assert.deepEqual(
        retryReadiness({ failureReason: "runtime_offline", attempt: 1, resumeAfter: null }, 3, 0),
        { ready: true, state: "ready", readyAt: null },
        "an unparked retryable failure is ready at once (the fourteen-key record's behaviour, unchanged)",
      );
    },
  },
  {
    name: "session-limit/record: run-complete stamps the park onto the record, and only for session_limit",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        const item = await buildMilestone(workDir);
        const ctx = await ctxFor(repo);

        await invoke("work:run-start", { ref: "348", sessionId: "sess-1", now: "2026-08-05T20:28:00.000Z" }, ctx);
        const failed = await invoke(
          "work:run-complete",
          { ref: "348", outcome: "failed", reason: "session_limit", resumeAfter: "1:10am (Europe/London)", now: "2026-08-05T21:05:00.000Z" },
          ctx,
        );
        assert.equal(failed.failureReason, "session_limit");
        assert.equal(failed.resumeAfter, "2026-08-06T00:10:00.000Z", "the park rides the SAME →failed edge that records the reason");
        assert.equal(failed.resumeAfterSource, "clock", "the park is marked as READ from the platform's words, not guessed");
        assert.match(failed.resumeAfterNote, /Europe\/London/, "the provenance names the zone it resolved in");

        // The stamp is on disk, in the frozen key order — not just in the envelope.
        const [onDisk] = await readRuns(item);
        assert.deepEqual(Object.keys(onDisk), FROZEN_KEYS, "the persisted record carries the fifteen frozen keys, in order");
        assert.equal(onDisk.resumeAfter, "2026-08-06T00:10:00.000Z");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "session-limit/record: every OTHER reason is byte-unchanged — no park stamp, retryable immediately",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        await buildMilestone(workDir);
        const ctx = await ctxFor(repo);
        // Even when a caller passes --resume-after by mistake, a non-session_limit
        // failure must not park: this path is load-bearing for the reclaim flow.
        await invoke("work:run-start", { ref: "348", now: "2026-08-05T20:28:00.000Z" }, ctx);
        const failed = await invoke(
          "work:run-complete",
          { ref: "348", outcome: "failed", reason: "runtime_offline", resumeAfter: "1:10am (Europe/London)", now: "2026-08-05T21:05:00.000Z" },
          ctx,
        );
        assert.equal(failed.resumeAfter, null, "only session_limit parks — every other reason keeps today's semantics");
        const retried = await invoke("work:run-retry", { ref: "348", now: "2026-08-05T21:06:00.000Z" }, ctx);
        assert.equal(retried.attempt, 2, "an unparked retryable failure still resumes at once");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "session-limit/gate: a retry before the reset is REFUSED retry-parked and mints nothing; after the reset it resumes on lineage",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        const item = await buildMilestone(workDir);
        const ctx = await ctxFor(repo);
        await invoke("work:run-start", { ref: "348", sessionId: "sess-1", now: "2026-08-05T20:28:00.000Z" }, ctx);
        await invoke(
          "work:run-complete",
          { ref: "348", outcome: "failed", reason: "session_limit", resumeAfter: "1:10am (Europe/London)", now: "2026-08-05T21:05:00.000Z" },
          ctx,
        );

        const before = (await readRuns(item)).length;
        const refusal = await expectCode(
          () => invoke("work:run-retry", { ref: "348", now: "2026-08-05T21:06:00.000Z" }, ctx),
          "retry-parked",
        );
        assert.match(refusal.message, /parked until 2026-08-06T00:10/, "the refusal names the instant it becomes ready");
        assert.equal((await readRuns(item)).length, before, "a refused retry mints NOTHING — the whole point is not to burn an attempt");

        // After the reset: the lineage resumes, carrying the session forward.
        const resumed = await invoke("work:run-retry", { ref: "348", now: "2026-08-06T00:11:00.000Z" }, ctx);
        assert.equal(resumed.attempt, 2, "attempt + 1");
        assert.equal(resumed.sessionId, "sess-1", "the prior session is carried — a resume, never a fresh start");
        assert.equal(resumed.state, "running");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "session-limit/gate: --force overrides the park, but NOT the ceiling or the classification",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        await buildMilestone(workDir);
        const ctx = await ctxFor(repo);
        await invoke("work:run-start", { ref: "348", now: "2026-08-05T20:28:00.000Z" }, ctx);
        await invoke(
          "work:run-complete",
          { ref: "348", outcome: "failed", reason: "session_limit", resumeAfter: "1:10am (Europe/London)", now: "2026-08-05T21:05:00.000Z" },
          ctx,
        );
        const forced = await invoke("work:run-retry", { ref: "348", force: true, now: "2026-08-05T21:06:00.000Z" }, ctx);
        assert.equal(forced.attempt, 2, "the operator override resumes before the stated reset");

        // …but force is ONLY the park override. A ceiling refusal still refuses.
        await invoke("work:run-complete", { ref: "348", outcome: "failed", reason: "session_limit", now: "2026-08-05T21:10:00.000Z" }, ctx);
        await expectCode(
          () => invoke("work:run-retry", { ref: "348", force: true, maxAttempts: 2, now: "2026-08-05T23:00:00.000Z" }, ctx),
          "attempts-exhausted",
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "session-limit/resume: the sweep reports what is waiting and when, and never invents work it cannot execute",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        await buildMilestone(workDir, { number: "348", slug: "ar-gate" });
        await buildMilestone(workDir, { number: "349", slug: "other" });
        const ctx = await ctxFor(repo);

        // 348 dies on a session limit; 349 dies on a bad agent output.
        await invoke("work:run-start", { ref: "348", now: "2026-08-05T20:28:00.000Z" }, ctx);
        await invoke(
          "work:run-complete",
          { ref: "348", outcome: "failed", reason: "session_limit", resumeAfter: "1:10am (Europe/London)", now: "2026-08-05T21:05:00.000Z" },
          ctx,
        );
        await invoke("work:run-start", { ref: "349", now: "2026-08-05T20:28:00.000Z" }, ctx);
        await invoke("work:run-complete", { ref: "349", outcome: "failed", reason: "agent_error", now: "2026-08-05T21:05:00.000Z" }, ctx);

        const parked = await invoke("work:resume", { now: "2026-08-05T21:06:00.000Z" }, ctx);
        assert.equal(parked.resumed, false, "a bare sweep REPORTS; it never acts");
        assert.deepEqual(parked.pending.map((row) => row.ref), ["348"], "a judged agent_error is not 'waiting to come back'");
        assert.equal(parked.pending[0].state, "parked");
        assert.equal(parked.pending[0].readyAt, "2026-08-06T00:10:00.000Z");
        assert.deepEqual(parked.ready, [], "nothing is offered as actionable while it is still parked");

        const ready = await invoke("work:resume", { now: "2026-08-06T00:11:00.000Z" }, ctx);
        assert.deepEqual(ready.ready, ["348"], "after the reset the sweep names exactly what to resume");
        assert.equal(ready.pending[0].state, "ready");

        // And the ACT face resumes the lineage through the same store authority.
        const resumed = await invoke("work:resume", { ref: "348", now: "2026-08-06T00:12:00.000Z" }, ctx);
        assert.equal(resumed.resumed, true);
        assert.equal(resumed.attempt, 2);

        // An item whose run is now in flight is not offered again — resuming it
        // would be refused duplicate-run, and offering an impossible action is
        // exactly the "confidently wrong next step" this command exists to remove.
        const after = await invoke("work:resume", { now: "2026-08-06T00:13:00.000Z" }, ctx);
        assert.deepEqual(after.ready, [], "an item with a running run is not offered for resume");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "session-limit/stranded: an orchestrator killed mid-turn records NOTHING — the sweep still finds it, and resuming reclaims then retries",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        const item = await buildMilestone(workDir);
        const ctx = await ctxFor(repo);

        // The 348 overnight shape: a run starts, the session limit kills the main
        // thread mid-turn, and NO run-complete ever happens. The record is left
        // `running` for ever — the state the sweep was originally blind to, which is
        // worse than useless: it reported "nothing to resume" over stranded work.
        await invoke("work:run-start", { ref: "348", sessionId: "sess-1", now: "2026-08-05T21:00:00.000Z" }, ctx);
        const [live] = await readRuns(item);
        assert.equal(live.state, "running");
        assert.equal(live.failureReason, null, "a killed session records no outcome — that is the whole problem");

        // Inside the liveness window it is WORKING, not stranded. Offering to resume
        // here would fight a live agent.
        const soon = await invoke("work:resume", { now: "2026-08-05T21:05:00.000Z" }, ctx);
        assert.equal(soon.pending[0].state, "in-flight", "a recent run is working, not stranded");
        assert.deepEqual(soon.ready, [], "a live run is never offered for resume");

        // Three hours later, silent past the heartbeat window: STRANDED and offered.
        const later = await invoke("work:resume", { now: "2026-08-06T00:00:00.000Z" }, ctx);
        assert.equal(later.pending[0].state, "stranded");
        assert.equal(later.pending[0].silentSince, "2026-08-05T21:00:00.000Z", "it says how long nothing has been driving it");
        assert.deepEqual(later.ready, ["348"], "the operator is given exactly one thing to do");

        // Acting on it reclaims the stranded run FIRST (it has no terminal state, so
        // a bare retry would refuse no-retryable-run) and then resumes its lineage.
        const resumed = await invoke("work:resume", { ref: "348", now: "2026-08-06T00:01:00.000Z" }, ctx);
        assert.equal(resumed.resumed, true);
        assert.equal(resumed.attempt, 2, "the resume is on the SAME lineage, not a fresh start");
        assert.equal(resumed.sessionId, "sess-1", "the killed session is carried forward");
        assert.deepEqual(resumed.reclaimed, [live.runId], "the stranded run was reclaimed, and the resume says so");

        const runs = await readRuns(item);
        assert.equal(runs.length, 2, "reclaim + resume, not a duplicate mint");
        assert.equal(runs[0].state, "failed");
        assert.equal(runs[0].failureReason, "runtime_offline", "a crashed host is infra — the reclaimed run stays retryable");
        assert.ok(runs[0].reclaimedAt, "reclaimedAt distinguishes a reclaimed failure from a reported one");
        assert.equal(runs[1].retryOf, runs[0].runId, "the lineage is linked");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "session-limit/stranded: a stranded run at the attempt ceiling is reported, not offered",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        const item = await buildMilestone(workDir);
        const ctx = await ctxFor(repo);
        await invoke("work:run-start", { ref: "348", now: "2026-08-05T21:00:00.000Z" }, ctx);
        // Drive the lineage to the ceiling, then strand the last attempt.
        await invoke("work:run-complete", { ref: "348", outcome: "failed", reason: "runtime_offline", now: "2026-08-05T21:01:00.000Z" }, ctx);
        await invoke("work:run-retry", { ref: "348", now: "2026-08-05T21:02:00.000Z" }, ctx);
        await invoke("work:run-complete", { ref: "348", outcome: "failed", reason: "runtime_offline", now: "2026-08-05T21:03:00.000Z" }, ctx);
        await invoke("work:run-retry", { ref: "348", now: "2026-08-05T21:04:00.000Z" }, ctx);

        const swept = await invoke("work:resume", { now: "2026-08-06T00:00:00.000Z" }, ctx);
        assert.equal(swept.pending[0].attempt, 3, "the stranded run is the third attempt");
        assert.equal(swept.pending[0].state, "attempts-exhausted", "the ceiling outranks strandedness");
        assert.deepEqual(swept.ready, [], "a genuinely-failing item halts instead of looping — 20/ADR-002 unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "session-limit/compat: a fourteen-key record (no park stamp) reads forward and resumes exactly as it does today",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        const item = await buildMilestone(workDir);
        // A genuine pre-348 record, written straight to disk with no resumeAfter.
        const legacy = {
          runId: "20260805T202800000Z-0000",
          itemRef: "348",
          state: "failed",
          attempt: 1,
          outcome: "failed",
          sessionId: "sess-legacy",
          brief: {},
          createdAt: "2026-08-05T20:28:00.000Z",
          updatedAt: "2026-08-05T21:05:00.000Z",
          failureReason: "runtime_offline",
          heartbeatAt: null,
          retryOf: null,
          reclaimedAt: null,
          node: null,
        };
        assert.equal(Object.keys(legacy).length, 14, "the fixture IS a genuine fourteen-key record (non-vacuous)");
        await mkdir(path.join(item.dir, "runs"), { recursive: true });
        await writeFile(path.join(item.dir, "runs", `${legacy.runId}.json`), JSON.stringify(legacy, null, 2), "utf8");

        const [normalized] = await readRuns(item);
        assert.deepEqual(Object.keys(normalized), FROZEN_KEYS, "it normalizes to the fifteen keys");
        assert.equal(normalized.resumeAfter, null, "absence is benign");

        // No park stamp ⇒ no gate ⇒ resumes immediately, as it always has.
        const resumed = await retryRun(item, { maxAttempts: 3, now: "2026-08-05T21:06:00.000Z" });
        assert.equal(resumed.attempt, 2);
        assert.equal(resumed.sessionId, "sess-legacy");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "session-limit/store: the park survives a direct store round-trip (the command layer is not the only writer)",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      try {
        const item = await buildMilestone(workDir);
        await startRun(item, { sessionId: "sess-1", now: "2026-08-05T20:28:00.000Z" });
        await completeRun(item, {
          outcome: "failed",
          failureReason: "session_limit",
          resumeAfter: "2026-08-06T00:10:00.000Z",
          now: "2026-08-05T21:05:00.000Z",
        });
        const [record] = await readRuns(item);
        assert.equal(record.resumeAfter, "2026-08-06T00:10:00.000Z", "the store persists the stamp it is handed");
        await expectCode(() => retryRun(item, { maxAttempts: 3, now: "2026-08-05T21:06:00.000Z" }), "retry-parked");
        const resumed = await retryRun(item, { maxAttempts: 3, now: "2026-08-06T00:11:00.000Z" });
        assert.equal(resumed.attempt, 2);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
