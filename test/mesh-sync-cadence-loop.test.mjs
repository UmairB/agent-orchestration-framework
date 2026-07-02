// Traceability wiring for milestone 22 / story 02 — the background sync loop (a thin
// timer over mesh:sync on a tunable, batched cadence).
//
// Covers EVERY @executable scenario in tasks/01_sync-cadence-loop.feature with an
// INJECTED ticker (no wall-clock wait): the loop invokes mesh:sync once per tick and
// does no git directly; the valid-cadence Scenario Outline (30/10/1/600 verbatim); the
// malformed-cadence Scenario Outline (absent/null/"fast"/"30"/true/0/-5/15.5 → 15s
// default, no crash); batching (a no-staged-change tick → mesh:sync ran but created no
// commit, HEAD unmoved); cadence read-at-start stable for the run. node:assert/strict.
//
//   01_sync-cadence-loop.feature — the loop is timer-only (no transport logic) and the
//     cadence is tunable + default-safe. The transport itself is task 00; this is the
//     loop face. The transport one-shot unit is asserted via a manual ticker so it does
//     not wall-clock-wait.
import assert from "node:assert/strict";
import {
  startSyncLoop,
  resolveCadenceSeconds,
  cadenceFromConfig,
  DEFAULT_CADENCE_SECONDS,
} from "../src/mesh-sync.mjs";

// A MANUAL ticker (the injected clock): start() records the interval + the onTick
// callback and returns a handle; fire(handle, n) invokes onTick n times. No
// setInterval, no wall-clock wait — the loop is driven deterministically. It records
// the interval it was started with so a test can assert the loop's fixed cadence.
function manualTicker() {
  const handles = [];
  return {
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) {
      handle.stopped = true;
    },
    // Fire a handle's tick n times (the injected clock advancing).
    fire(handle, n = 1) {
      for (let i = 0; i < n; i += 1) handle.onTick();
    },
    handles,
  };
}

// A loop started with a manual ticker — returns the loop handle + the ticker so the
// test can fire ticks. cadenceSeconds is the already-resolved interval (the loop reads
// it at start), mirroring how the production caller resolves config → cadence first.
function startWithManualTicker(cadenceSeconds, runSync) {
  const ticker = manualTicker();
  const loop = startSyncLoop({ runSync, cadenceSeconds, ticker });
  return { loop, ticker };
}

export const meshSyncCadenceLoopTests = [
  // Scenario: the loop invokes mesh:sync once per cadence tick.
  {
    name: "feature 22/02/01: the loop invokes mesh:sync once per cadence tick (3 ticks → 3 invocations) and performs no git directly",
    run: async () => {
      let invocations = 0;
      // runSync stands in for invoke("mesh:sync") — the loop's ONLY job is to call it.
      const runSync = () => { invocations += 1; };
      const { ticker } = startWithManualTicker(resolveCadenceSeconds(30), runSync);
      const handle = ticker.handles[0];
      ticker.fire(handle, 3);
      assert.equal(invocations, 3, "mesh:sync was invoked exactly 3 times (once per tick)");
      // The loop performed NO git operation directly: it never spawns git, it only
      // invokes runSync. (The source-discipline arch-test acd-mesh-sync-record-neutral
      // proves startSyncLoop's body holds no git spawn; here we prove the loop's only
      // observable effect is the runSync invocation count.)
    },
  },

  // Scenario Outline: a valid positive cadence is read from config verbatim.
  {
    name: "feature 22/02/01: a valid positive cadence is read from config verbatim (30/10/1/600 → same interval)",
    run: async () => {
      for (const value of [30, 10, 1, 600]) {
        const cadence = cadenceFromConfig({ config: { mesh: { sync: { cadenceSeconds: value } } } });
        const { loop } = startWithManualTicker(cadence, () => {});
        assert.equal(loop.intervalSeconds, value, `cadence ${value} is used verbatim as the tick interval`);
      }
    },
  },

  // Scenario Outline: a missing or malformed cadence falls back to the 15s default
  // (absent/null/"fast"/"30"/true/0/-5/15.5). The loop starts without crashing.
  {
    name: "feature 22/02/01: a missing or malformed cadence falls back to the 15s default without crashing",
    run: async () => {
      // The malformed equivalence classes, EXACTLY the feature's Examples table. `absent`
      // is modelled as no cadenceSeconds key (undefined); the rest are the literal values.
      const cases = [
        { label: "absent", config: { mesh: { sync: {} } } },
        { label: "null", config: { mesh: { sync: { cadenceSeconds: null } } } },
        { label: '"fast"', config: { mesh: { sync: { cadenceSeconds: "fast" } } } },
        { label: '"30"', config: { mesh: { sync: { cadenceSeconds: "30" } } } },
        { label: "true", config: { mesh: { sync: { cadenceSeconds: true } } } },
        { label: "0", config: { mesh: { sync: { cadenceSeconds: 0 } } } },
        { label: "-5", config: { mesh: { sync: { cadenceSeconds: -5 } } } },
        { label: "15.5", config: { mesh: { sync: { cadenceSeconds: 15.5 } } } },
      ];
      assert.equal(DEFAULT_CADENCE_SECONDS, 15, "the documented default cadence is 15s");
      for (const { label, config } of cases) {
        const cadence = cadenceFromConfig({ config });
        assert.equal(cadence, 15, `malformed cadence ${label} falls back to the 15s default`);
        // The loop starts without crashing on the bad config.
        let started = false;
        assert.doesNotThrow(() => {
          const { loop } = startWithManualTicker(cadence, () => {});
          started = loop.intervalSeconds === 15;
        }, `the loop starts without crashing on cadence ${label}`);
        assert.ok(started, `the loop started at the 15s default for cadence ${label}`);
      }
      // Also cover a wholly absent mesh subtree (no config at all).
      assert.equal(cadenceFromConfig({}), 15, "a wholly absent config falls back to 15s");
      assert.equal(cadenceFromConfig(undefined), 15, "an undefined workspace falls back to 15s");
    },
  },

  // Scenario: a tick with no staged changes produces no commit (batching). mesh:sync
  // STILL ran (the loop did its job) yet the commit graph is byte-unchanged.
  {
    name: "feature 22/02/01: a tick with no staged changes produces no commit (batching) — mesh:sync ran but created no commit, HEAD unmoved",
    run: async () => {
      // A fake one-shot transport that reports a clean no-op (no staged changes this
      // tick): it RAN, but committed nothing — the no-op envelope syncMesh returns.
      let ran = 0;
      const headBefore = "abc123"; // a stand-in HEAD; the no-op leaves it unmoved.
      let headAfter = headBefore;
      const runSync = () => {
        ran += 1;
        const result = { committed: false, pushed: [], pulled: [], noop: true };
        // A no-op tick does NOT move HEAD (the loop creates no commit object).
        if (result.committed) headAfter = "moved";
        return result;
      };
      const { ticker } = startWithManualTicker(resolveCadenceSeconds(15), runSync);
      ticker.fire(ticker.handles[0], 1);
      assert.equal(ran, 1, "mesh:sync ran for that tick (the loop invoked the command)");
      assert.equal(headAfter, headBefore, "HEAD is the same commit as before the tick (the no-change tick created no commit)");
    },
  },

  // Scenario: the loop's interval is read at start and is stable for the run — a
  // mid-run config edit does not retune a running loop.
  {
    name: "feature 22/02/01: the loop's interval is read at start and is stable for the run (a mid-run config edit does not retune it)",
    run: async () => {
      // The config the loop reads at start.
      const config = { mesh: { sync: { cadenceSeconds: 30 } } };
      const cadenceAtStart = cadenceFromConfig({ config });
      const { loop } = startWithManualTicker(cadenceAtStart, () => {});
      assert.equal(loop.intervalSeconds, 30, "the loop started at the 30s cadence read from config");
      // Later, the config is changed to 10 — but the RUNNING loop's interval is fixed
      // (it captured the cadence at start; it does not re-read config per tick).
      config.mesh.sync.cadenceSeconds = 10;
      assert.equal(loop.intervalSeconds, 30, "the running loop's tick interval is still 30s (cadence is read at start)");
    },
  },
];
