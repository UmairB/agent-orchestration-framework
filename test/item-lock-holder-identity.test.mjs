// Traceability wiring for milestone 43 / story 01 (the exclusive item lock), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/01_story_item-lock/
//     tasks/03_holder-admitted-by-identity-never-exemption.feature
//
// AC4 (+ AC8's behavioural residue): the guard ADMITS the holder by IDENTITY, never by
// exemption. A mint made UNDER an assignment carries that assignment's id and is
// admitted; a mint naming a DIFFERENT, a STALE (settled) or an UNKNOWN-but-recorded one
// is refused, as is a mint carrying none while a foreign assignment holds the scope.
// There is no "worker is exempt" branch and no operator flag that could become one.
//
// THE ALTITUDE, stated rather than implied. The feature's own FEASIBILITY note pins it:
// "there is deliberately NO operator command that passes an assignment identity to a
// mint; the only carriers are the worker's own dispatch sites … so the identity matrix
// below is driven through the DISPATCH, not through a flag". So the matrix is driven at
// the seam the worker's two mint sites call, with the SAME edge and the SAME
// `opts.lock` those sites pass (`mesh-worker-execution.mjs`), and the no-identity row —
// the one an operator can drive by hand — goes through the real `work:run-start`.
//
// RECORDED, not hidden (ADR-010 / FEASIBILITY §6.4): "admitted by identity" is vacuous
// CROSS-MACHINE — `global_assignments` is control-only, and a worker is admitted by an
// empty store. The terminal-id row below is therefore in-process-only, and the
// cross-machine proof is task 06's `@manual` soak.
import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import { invoke } from "../src/command-core.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { resolveItemExact } from "../src/commands/resolve.mjs";
import { transitionRunStart } from "../src/effects/run-transitions.mjs";
import { runStartCommand } from "../src/commands/run-start.mjs";
import { readRuns } from "../src/run-store.mjs";
import { mkdir } from "node:fs/promises";
import { loadWorkspace, findWork } from "../src/work.mjs";
import { meshWorktreePath } from "../src/mesh-worktree.mjs";
import { createMeshWorkerTerminalResumeHandler } from "../src/mesh-worker-execution.mjs";
import { assembleAssignmentRecord, insertAssignment } from "../src/assignment-record.mjs";
import { withMeshWorkerExecFixture, createStatusRecorder } from "./support/mesh-worker-exec-fixture.mjs";
import { createFakeWhich, createFakePtySpawn } from "./support/mesh-worker-terminal-fixture.mjs";
import { withItemLockFixture, seedActive, settle, withStore, refuse } from "./support/item-lock-fixture.mjs";

function waitFor(predicate, { timeoutMs = 5000, intervalMs = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      let done = false;
      try { done = predicate(); } catch { done = false; }
      if (done) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

const HOLDER = "aof-wsl";
const NOW = "2026-08-01T10:00:00.000Z";

// m43 / story 06 (ADR-005) — `resolveItemExact` moved onto the cache-first seam and its first
// parameter changed from a `workDir` STRING to the command `ctx` (it needs the whole workspace
// to reach the cache). The three call sites in this file were left on the old signature and
// threw `Cannot read properties of undefined (reading 'workDir')` inside `buildStreamView` —
// 9 of this suite's 21 lanes, RED and unattributed. Re-pointed at `fx.ctx`, which the fixture
// already builds (`item-lock-fixture.mjs:83-87`); nothing about what the lanes assert changes.
// (Found 2026-08-04 at the ADR-016 must-fix pass, and attributed by re-running at `6b4ab7f`,
// where this suite is 21/21 GREEN.)

// The worker's own mint, byte-for-byte as `mesh-worker-execution.mjs` issues it.
async function dispatchMint(fx, ref, assignmentId, { now = NOW } = {}) {
  const item = await resolveItemExact(fx.ctx, ref);
  return transitionRunStart(
    item,
    { now, node: HOLDER, brief: { assignmentId, itemRef: ref } },
    {
      lock: { workspaceId: fx.workspaceId, byAssignment: assignmentId, globalWorkStoreOptions: fx.ctx.globalWorkStoreOptions },
      journalOptions: fx.ctx.effectsJournalOptions,
    },
  );
}

// tearTheStore(fx) — replace the REAL database file with bytes SQLite refuses ("file
// is not a database"). The store is opened once first so the file (and its directory)
// genuinely exist: a MISSING store is a different case, and the correct answer to it is
// "mint freely", not a refusal.
async function tearTheStore(fx) {
  const store = await openGlobalWorkProjectionStore({ env: fx.env });
  store.close?.();
  const { databasePath } = globalMeshPaths({ env: fx.env });
  await writeFile(databasePath, "torn — not a sqlite database\n".repeat(64), "utf8");
}

async function lastPublishedAt(fx) {
  return withStore(fx, (store) =>
    store.db.prepare("SELECT value FROM projection_metadata WHERE workspace_id = ? AND key = 'lastPublishedAt'").get(fx.workspaceId)?.value ?? null);
}

export const itemLockHolderIdentityTests = [
  // ==========================================================================
  // Scenario: the holding assignment's own dispatch mints its run and the lock
  // does not stand in its way
  // ==========================================================================
  {
    name: "item-lock/03 identity: the holder's own dispatch mints its run, the record names asg-1 in its brief, and no item-locked-by-assignment is raised",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        const { record } = await dispatchMint(fx, "42", "asg-1");
        assert.equal(record.state, "running");

        const status = await invoke("work:run-status", { ref: "42" }, fx.ctx);
        assert.equal(status.runs.length, 1, "exactly one run, in state running");
        assert.equal(status.runs[0].state, "running");
        assert.equal(status.runs[0].brief?.assignmentId, "asg-1", "the run record names the identity that admitted it");
      }),
  },

  // ==========================================================================
  // Scenario Outline: only the assignment that actually holds the scope opens
  // the door
  // ==========================================================================
  ...[
    {
      label: "the holder itself — assignment asg-1 (active, covers scope 42)",
      identity: "asg-1",
      seed: async () => {},
      outcome: "admitted",
      code: null,
      runs: 1,
    },
    {
      label: "another item's active assignment — asg-2 (active, covers scope 43)",
      identity: "asg-2",
      seed: async (fx) => { await seedActive(fx, { assignmentId: "asg-2", itemRef: "43", node: HOLDER, state: "running" }); },
      outcome: "refused",
      code: "item-locked-by-assignment",
      runs: 0,
    },
    {
      label: "the holder's own id after it went terminal — asg-1 once its state is done",
      identity: "asg-1",
      seed: async (fx) => { await settle(fx, "asg-1", "done"); },
      outcome: "refused",
      code: "item-locked-by-assignment",
      runs: 0,
    },
    {
      label: "an assignment id that does not exist — asg-bogus (no such row)",
      identity: "asg-bogus",
      seed: async () => {},
      outcome: "refused",
      code: "item-locked-by-assignment",
      runs: 0,
    },
    {
      label: "no identity at all — a plain local mint (an operator's `aof work run-start 42`)",
      identity: null,
      seed: async () => {},
      outcome: "refused",
      code: "item-locked-by-assignment",
      runs: 0,
    },
  ].map(({ label, identity, seed, outcome, code, runs }) => ({
    name: `item-lock/03 identity: a mint for "42" carrying ${label} is ${outcome}${code ? ` (${code})` : ""}, leaving ${runs} run(s)`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });
        await seed(fx);

        const mint = identity == null
          ? () => invoke("work:run-start", { ref: "42" }, fx.ctx)
          : () => dispatchMint(fx, "42", identity);

        if (outcome === "admitted") {
          await mint();
        } else {
          const error = await refuse(mint);
          assert.equal(error.code, code);
        }
        const status = await invoke("work:run-status", { ref: "42" }, fx.ctx);
        assert.equal(status.runs.length, runs, `run-status reports ${runs} run(s)`);
      }),
  })),

  // ==========================================================================
  // The refusal payload is a CONTRACT, so it may never name a holder that does
  // not hold the scope. The DECISIONS below are the ones the matrix above pins
  // (a stale or foreign identity presented against a free ref is refused); what
  // is asserted here is that the five keys tell the truth about WHY.
  // ==========================================================================
  ...[
    {
      label: "a genuine but UNRELATED active id presented against a free ref",
      seed: async (fx) => { await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" }); },
      identity: "asg-1",
      ref: "43",
    },
    {
      label: "the presenting assignment's own id after it went terminal",
      seed: async (fx) => { await seedActive(fx, { assignmentId: "asg-1", itemRef: "43", node: HOLDER, state: "done" }); },
      identity: "asg-1",
      ref: "43",
    },
  ].map(({ label, seed, identity, ref }) => ({
    name: `item-lock/03 identity: ${label} is refused with a payload that names NO holder — nobody holds "${ref}", and the message says so`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seed(fx);

        const error = await refuse(() => dispatchMint(fx, ref, identity));
        assert.equal(error.code, "item-locked-by-assignment", "the decision is the one the matrix pins");
        assert.equal(error.itemRef, ref);
        assert.equal(error.scopeRef, ref);
        assert.equal(error.assignmentId, identity, "the payload names the identity that was PRESENTED");
        assert.equal(error.holderNode, null, "…and no holder, because nobody holds this scope");
        assert.equal(error.state, null, "…and no holder state — a terminal state here would contradict `every terminal state releases the scope`");
        assert.match(error.message, /not an active assignment covering/i, "the message explains the real cause");
        assert.doesNotMatch(error.message, /is held by/i, "…and never claims the item is held");
      }),
  })),

  // ==========================================================================
  // Scenario: a hand-typed local mint on the HOLDING node is refused just like
  // one on any other node
  // ==========================================================================
  {
    name: "item-lock/03 identity: a hand-typed run-start on the HOLDING node (local node id = aof-wsl) is refused, and run-start declares no flag that accepts an assignment id or forces the refusal",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        const error = await refuse(() => invoke("work:run-start", { ref: "42/03" }, fx.ctx));
        assert.equal(error.code, "item-locked-by-assignment");
        assert.equal(error.holderNode, HOLDER);
        assert.deepEqual((await invoke("work:run-status", { ref: "42/03" }, fx.ctx)).runs, [], "zero runs");

        // The help text a face prints IS the command's own `cli.spec` (usage + flag
        // vocabulary — `src/spine/face.mjs`'s parseSpecArgv refuses anything not
        // declared there, so an undeclared override could not even be typed).
        const spec = runStartCommand.cli.spec;
        assert.deepEqual(Object.keys(spec.flags).sort(), ["brief", "session"], "run-start declares exactly two flags");
        assert.doesNotMatch(`${spec.usage} ${JSON.stringify(spec.flags)}`, /assignment|force|override/i, "no flag accepts an assignment id, forces or overrides");
      }, { nodeId: HOLDER }),
  },

  // ==========================================================================
  // Scenario: resuming a parked session under the SAME assignment is admitted
  // and mints nothing new
  // ==========================================================================
  {
    name: "item-lock/03 identity: the m42 resume path runs END-TO-END under a HELD scope — the REAL handler parks needs-input then resumes, admitted by its assignment identity, and still ONE run record",
    run: () =>
      // The REAL worker fixture + the REAL `createMeshWorkerTerminalResumeHandler`, so
      // the mint the lock guards is the one the worker actually issues. The item lock
      // is armed for the whole run: an ACTIVE assignment covers the scope, so a guard
      // that did not admit by identity would fail the FIRST resume outright, and a
      // resume that minted a second record would fail the run count at the end.
      withMeshWorkerExecFixture(async (fx) => {
        const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
        const assignmentId = "asg-held-resume";
        const worktreePath = meshWorktreePath(fx.root, assignmentId);
        await mkdir(worktreePath, { recursive: true });

        // THE LOCK, armed: the very assignment the resume runs under holds the scope.
        const store = await openGlobalWorkProjectionStore({ env: fx.env });
        try {
          insertAssignment(store, assembleAssignmentRecord({
            assignmentId,
            itemRef: fx.itemRef,
            workspaceId: fx.workspaceId,
            targetNodeId: "worker-a",
            issuer: "control-a",
            state: "running",
            now: "2026-08-02T09:00:00.000Z",
          }));
        } finally {
          store.close?.();
        }

        const { spawn, spawnCalls } = createFakePtySpawn({});
        const recorder = createStatusRecorder();
        const logs = [];
        let completionResolve = null;
        const resumeHandler = createMeshWorkerTerminalResumeHandler({
          loadWs: () => Promise.resolve(ws),
          globalWorkStoreOptions: { env: fx.env },
          nodeId: "worker-a",
          now: () => "2026-08-02T10:00:00.000Z",
          onLog: (entry) => logs.push(entry),
          onOutputChunk: () => {},
          onSessionEnd: () => {},
          sendAssignmentStatus: recorder.sendAssignmentStatus,
          sendEffectStep: recorder.sendEffectStep,
          ptySpawn: spawn,
          which: createFakeWhich(["claude"]),
          commandDelayMs: 0,
          livenessIntervalMs: 0,
          watchTranscriptCompletion: () => new Promise((resolve) => { completionResolve = resolve; }),
        });
        const resumeFrame = { sessionId: "sess-held", assignmentId, workspaceId: fx.workspaceId, itemRef: fx.itemRef };

        // First resume → the mint the lock guards, admitted by the assignment id it
        // names. It parks needs-input, so the record stays `running`.
        const first = resumeHandler(resumeFrame);
        await waitFor(() => completionResolve != null && recorder.frames.length >= 1);
        const mintedRunId = recorder.frames[0].runId;
        completionResolve({ outcome: "needs-input" });
        await first;
        assert.ok(mintedRunId, "the held scope's own assignment minted its run — the lock admitted it by identity");
        assert.equal(logs.some((entry) => /item-locked-by-assignment/.test(entry.message ?? "")), false, "no refusal was raised anywhere in that dispatch");

        // Second resume → CONTINUES the same run. Nothing new is minted.
        completionResolve = null;
        const second = resumeHandler(resumeFrame);
        await waitFor(() => spawnCalls.length === 2 && completionResolve != null);
        const revival = recorder.frames.filter((entry) => entry.code === "resumed").at(-1);
        assert.equal(revival.runId, mintedRunId, "the revival frame carries the SAME runId — one run, paused and resumed");
        completionResolve({ outcome: "done" });
        await second;

        const item = await findWork(fx.workDir, fx.itemRef).then((matches) => matches.find((row) => row.ref === fx.itemRef));
        const runs = await readRuns(item);
        assert.equal(runs.filter((entry) => entry.brief?.assignmentId === assignmentId).length, 1, "ONE assignment, ONE run record — a resume mints nothing new");
        assert.equal(runs.find((entry) => entry.runId === mintedRunId)?.state, "done", "…and the completion settles that one record");
      }),
  },

  // ==========================================================================
  // Scenario Outline: an UNHELD item mints byte-identically, meshed or not
  // ==========================================================================
  ...[
    { label: "a meshed workspace, no holders", mesh: true, seed: async () => {} },
    {
      label: "a meshed workspace, holder elsewhere",
      mesh: true,
      seed: async (fx) => { await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" }); },
    },
    { label: "an unmeshed workspace — the plain single-node CLI", mesh: false, seed: async () => {} },
  ].map(({ label, mesh, seed }) => ({
    name: `item-lock/03 identity: an unheld item mints byte-identically in ${label}`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seed(fx);

        const record = await invoke("work:run-start", { ref: "43" }, fx.ctx);
        assert.equal(typeof record.runId, "string");
        assert.equal(record.itemRef, "43");
        assert.equal(record.state, "running");
        for (const key of ["itemLocked", "lock", "locked", "scopeRef", "holderNode", "warning", "degrade", "propagationWarnings"]) {
          assert.equal(Object.prototype.hasOwnProperty.call(record, key), false, `the envelope carries no "${key}" key`);
        }
      }, { mesh }),
  })),

  // ==========================================================================
  // The question this task's header consciously left OPEN and routed to the
  // PO/architect ("what does the guard do when the assignment store cannot be
  // opened or read at all"), now RULED in the story's `## Notes` (ADR-010/R1.4 +
  // R1.3). No scenario carries it — the rulings landed after the features were
  // authored — so it is wired here, where the question was asked.
  // ==========================================================================
  // A GENUINELY torn store — the real database file replaced with bytes SQLite cannot
  // read ("file is not a database"), not an injected `openStore` that throws. Every
  // door the lock guards must answer the same coded refusal to the same fault; before
  // this, `mesh assign` opened the store for its own gates first and leaked a raw
  // ERR_SQLITE_ERROR.
  ...[
    { door: "work run-start", run: (fx) => invoke("work:run-start", { ref: "42" }, fx.ctx) },
    { door: "work next", run: (fx) => invoke("work:next", {}, fx.ctx) },
    { door: "work insert-story", run: (fx) => invoke("work:insert-story", { slug: "probe", at: 1, under: 42, yes: true }, fx.ctx) },
    { door: "mesh assign", run: (fx) => invoke("mesh:assign", { ref: "42", to: "worker-b" }, fx.ctx) },
  ].map(({ door, run }) => ({
    name: `item-lock/03 identity (ADR-010/R1.4): a genuinely TORN store makes \`${door}\` fail CLOSED with the distinct code item-lock-undeterminable — never a raw SQLite error, never item-locked-by-assignment`,
    run: () =>
      withItemLockFixture(async (fx) => {
        const foldersBefore = (await readdir(fx.workDir)).sort();
        await tearTheStore(fx);

        const error = await refuse(() => run(fx));
        assert.equal(error.code, "item-lock-undeterminable", `${door}: a holder that cannot be ruled out refuses, with its OWN code`);
        assert.match(error.message, /repair or remove the store/i, "…and the message names the remedy");
        assert.doesNotMatch(String(error.message), /ERR_SQLITE_ERROR/, "…and never leaks the raw store exception");
        assert.deepEqual((await readdir(fx.workDir)).sort(), foldersBefore, "…and nothing on disk moved");
      }),
  })),
  {
    name: "item-lock/03 identity (ADR-010/R1.4): `readHeldScopes` itself fails CLOSED on a torn store — a `next` that quietly reported nothing held would be the invisible-item failure with a friendly face",
    run: () =>
      withItemLockFixture(async (fx) => {
        const { readHeldScopes } = await import("../src/item-lock.mjs");
        await tearTheStore(fx);
        const error = await refuse(() => readHeldScopes(fx.workspace, { globalWorkStoreOptions: fx.ctx.globalWorkStoreOptions }));
        assert.equal(error.code, "item-lock-undeterminable");
      }),
  },
  {
    name: "item-lock/03 identity (ADR-010/R1.3): a mint reaching the seam with NO lock context in a mesh-configured workspace fails LOUD with item-lock-context-missing — an absent opt never means skip",
    run: () =>
      withItemLockFixture(async (fx) => {
        const item = await resolveItemExact(fx.ctx, "42");
        const error = await refuse(() => transitionRunStart(item, {}, { workspace: fx.workspace, journalOptions: fx.ctx.effectsJournalOptions }));
        assert.equal(error.code, "item-lock-context-missing");
        assert.deepEqual((await invoke("work:run-status", { ref: "42" }, fx.ctx)).runs, [], "nothing was minted");
      }),
  },
  {
    name: "item-lock/03 identity (ADR-010/R1.4): a workspace mesh was never configured for mints FREELY — the correct answer, not a fail-open",
    run: () =>
      withItemLockFixture(async (fx) => {
        const item = await resolveItemExact(fx.ctx, "42");
        const { record } = await transitionRunStart(item, {}, { workspace: fx.workspace, journalOptions: fx.ctx.effectsJournalOptions });
        assert.equal(record.state, "running", "no mesh configured ⇒ there is no assignment and there cannot be one");
      }, { mesh: false }),
  },

  // ==========================================================================
  // Scenario: gaining a lock check does not change run-retry's propagation
  // posture
  // ==========================================================================
  {
    name: "item-lock/03 identity: run-retry still never publishes on mutate — the retry is admitted, lastPublishedAt is unchanged and no propagation warning appears",
    run: () =>
      withItemLockFixture(async (fx) => {
        const started = await invoke("work:run-start", { ref: "43" }, fx.ctx);
        await invoke("work:run-complete", { ref: "43", runId: started.runId, outcome: "failed", reason: "timeout" }, fx.ctx);
        const before = await lastPublishedAt(fx);
        assert.ok(before, "the workspace has published at least once, so a change would be visible");

        const retried = await invoke("work:run-retry", { ref: "43" }, fx.ctx);
        assert.equal(retried.state, "running", "the retry is admitted");
        assert.equal(typeof retried.runId, "string", "…and the envelope reports the resumed runId");
        assert.equal(retried.retryOf, started.runId, "…linked to the prior run's lineage");
        assert.equal(retried.attempt, 2, "…at attempt 2");

        assert.equal(await lastPublishedAt(fx), before, "lastPublishedAt is unchanged by the retry");
        assert.equal(Object.prototype.hasOwnProperty.call(retried, "propagationWarnings"), false, "no propagation warning appears on the envelope");
      }),
  },
];
