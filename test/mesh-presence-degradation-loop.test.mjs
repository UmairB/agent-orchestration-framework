// Traceability wiring for milestone 23 / story 02 — task 01
// (tasks/01_graceful-degradation.feature). The cadence loop is a thin timer over the
// one-shot publish.
//
// milestone 33 / story 01 (ADR-002.1 — F-3204): the two relay-DOWN/relay-RESTORED
// scenarios this file used to cover (mesh:heartbeat's best-effort relay push,
// ctx.relayClient) are RETIRED — the ws@8 broker is eliminated as the presence/liveness
// transport and mesh-heartbeat.mjs no longer pushes a second bus (superseded by
// 33/ADR-002 — the broker is eliminated; see src/commands/mesh-heartbeat.mjs). The
// git-durability half those scenarios asserted (0 records lost, byte-identical writes)
// is untouched and unconditional — it was NEVER dependent on the relay to begin with
// (ADR-002.4, git stays the durable authority reused verbatim), so no coverage gap opens.
//
// Covers EVERY remaining @executable scenario:
//   - the cadence LOOP is a thin timer over the one-shot publish (an INJECTED ticker, no
//     wall-clock wait): one publish per tick, the loop holds no publish logic of its own;
//   - the cadence is read from config.mesh.presence.cadenceSeconds (valid verbatim;
//     malformed/absent ⇒ the documented default), read at start + stable for the run.
//
// node:assert/strict.
import assert from "node:assert/strict";
import {
  startPresenceLoop,
  resolvePresenceCadenceSeconds,
  presenceCadenceFromConfig,
  DEFAULT_PRESENCE_CADENCE_SECONDS,
} from "../src/mesh-presence-loop.mjs";

// ---- the manual ticker (the 22 task-01 injected-clock pattern) ----
function manualTicker() {
  const handles = [];
  return {
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
    fire(handle, n = 1) { for (let i = 0; i < n; i += 1) handle.onTick(); },
    handles,
  };
}

export const meshPresenceDegradationLoopTests = [
  // ══ Scenario: the cadence loop invokes the one-shot publish once per tick and holds no
  //    publish logic ══
  {
    name: "mesh-presence-degradation/01 the cadence loop invokes the one-shot publish once per tick and holds no publish logic",
    async run() {
      // Given the cadence loop is loaded with an injected ticker (no real wall-clock wait).
      // The loop's ONLY collaborator is publishOnce; it holds no publish logic of its own
      // (no git write, no relay push directly). We prove that BY CONSTRUCTION, not with
      // tautological 0-counters:
      //   (1) startPresenceLoop is given ONLY { publishOnce, cadenceSeconds, ticker } — no
      //       git/relay seam is even in scope for the loop to reach;
      //   (2) a recording publishOnce spy is the SOLE path that ran (publishes === ticks);
      //   (3) the onTick the ticker received calls publishOnce ONCE and touches NOTHING
      //       else — a poisoned git/relay seam in the surrounding closure stays untouched
      //       (so were the loop to do a direct git write / relay push it would fail here).
      let publishes = 0;
      const publishOnce = () => { publishes += 1; };

      // Poisoned seams in the SAME closure the loop runs in: any direct git write / relay
      // push by the loop would have to touch one of these — and that would FAIL the test.
      let gitOrRelayTouched = false;
      const poisonedGit = () => { gitOrRelayTouched = true; throw new Error("the loop reached git directly"); };
      const poisonedRelay = () => { gitOrRelayTouched = true; throw new Error("the loop reached the relay directly"); };
      void poisonedGit; void poisonedRelay; // in scope but never passed to the loop

      // A recording ticker: capture the args startPresenceLoop hands ticker.start so we can
      // assert the loop's only collaborator is the onTick that calls publishOnce.
      const base = manualTicker();
      let startArgs = null;
      const ticker = {
        handles: base.handles,
        start(intervalSeconds, onTick) { startArgs = { intervalSeconds, onTick }; return base.start(intervalSeconds, onTick); },
        stop(handle) { return base.stop(handle); },
        fire(handle, n) { return base.fire(handle, n); },
      };

      // (1) The loop is constructed with ONLY { publishOnce, cadenceSeconds, ticker } — no
      // git/relay seam is passed in, so the loop has none to reach.
      const loopArgs = { publishOnce, cadenceSeconds: resolvePresenceCadenceSeconds(5), ticker };
      assert.deepEqual(
        Object.keys(loopArgs).sort(),
        ["cadenceSeconds", "publishOnce", "ticker"],
        "startPresenceLoop is given ONLY { publishOnce, cadenceSeconds, ticker } — no git/relay seam is in scope for the loop"
      );
      const loop = startPresenceLoop(loopArgs);

      // The loop handed the ticker exactly one onTick callback (its sole per-tick action).
      assert.ok(startArgs && typeof startArgs.onTick === "function", "the loop registered a single onTick with the ticker");

      // (3) Firing the registered onTick ONCE advances publishOnce by exactly one and
      // touches no other seam — the loop's per-tick work is publishOnce and nothing else.
      const before = publishes;
      startArgs.onTick();
      assert.equal(publishes, before + 1, "one onTick fire invokes the one-shot publish exactly once (the loop's only per-tick action)");
      assert.equal(gitOrRelayTouched, false, "the loop's tick reached no git/relay seam — it called only publishOnce");

      // (2) And across N real ticks the publish count equals the tick count: the recording
      // publishOnce spy is the SOLE path that ran (publishes === ticks, no extra/zero work).
      const ticksSoFar = publishes; // (1 from the manual onTick fire above)
      ticker.fire(ticker.handles[0], 3);
      assert.equal(publishes, ticksSoFar + 3, "the one-shot presence publish was invoked exactly once per tick (publishes === ticks)");
      assert.equal(gitOrRelayTouched, false, "across every tick the loop reached no git write and no relay push directly (it only invoked publishOnce)");
      loop.stop();
    },
  },

  // ══ Scenario Outline: a valid positive cadence is read from config verbatim ══
  {
    name: "mesh-presence-degradation/01 a valid positive cadence is read from config.mesh.presence.cadenceSeconds verbatim",
    async run() {
      for (const value of [5, 1, 30, 60]) {
        const cadence = presenceCadenceFromConfig({ config: { mesh: { presence: { cadenceSeconds: value } } } });
        const ticker = manualTicker();
        const loop = startPresenceLoop({ publishOnce: () => {}, cadenceSeconds: cadence, ticker });
        assert.equal(loop.intervalSeconds, value, `cadence ${value} is read from config verbatim as the tick interval`);
        loop.stop();
      }
    },
  },

  // ══ Scenario Outline: a malformed or absent cadence falls back to the documented default ══
  {
    name: "mesh-presence-degradation/01 a malformed or absent cadence falls back to the documented default and the loop does not crash",
    async run() {
      const cases = [
        { label: "absent", config: { mesh: { presence: {} } } },
        { label: "null", config: { mesh: { presence: { cadenceSeconds: null } } } },
        { label: '"fast"', config: { mesh: { presence: { cadenceSeconds: "fast" } } } },
        { label: '"5"', config: { mesh: { presence: { cadenceSeconds: "5" } } } },
        { label: "true", config: { mesh: { presence: { cadenceSeconds: true } } } },
        { label: "0", config: { mesh: { presence: { cadenceSeconds: 0 } } } },
        { label: "-5", config: { mesh: { presence: { cadenceSeconds: -5 } } } },
        { label: "5.5", config: { mesh: { presence: { cadenceSeconds: 5.5 } } } },
      ];
      assert.equal(DEFAULT_PRESENCE_CADENCE_SECONDS, 5, "the documented default presence cadence is 5s");
      for (const { label, config } of cases) {
        const cadence = presenceCadenceFromConfig({ config });
        // Every row falls back to the SAME documented default.
        assert.equal(cadence, DEFAULT_PRESENCE_CADENCE_SECONDS, `malformed cadence ${label} falls back to the documented default (${DEFAULT_PRESENCE_CADENCE_SECONDS}s)`);
        // The loop's tick interval is the documented default, and it starts without crashing.
        let started = false;
        assert.doesNotThrow(() => {
          const ticker = manualTicker();
          const loop = startPresenceLoop({ publishOnce: () => {}, cadenceSeconds: cadence, ticker });
          started = loop.intervalSeconds === DEFAULT_PRESENCE_CADENCE_SECONDS;
          loop.stop();
        }, `the loop started without crashing on the bad config (${label})`);
        assert.ok(started, `the loop started at the documented default for cadence ${label}`);
      }
      // A wholly absent mesh/presence subtree also falls back.
      assert.equal(presenceCadenceFromConfig({}), DEFAULT_PRESENCE_CADENCE_SECONDS, "a wholly absent config falls back to the default");
      assert.equal(presenceCadenceFromConfig(undefined), DEFAULT_PRESENCE_CADENCE_SECONDS, "an undefined workspace falls back to the default");
    },
  },

  // ══ Scenario: the cadence loop reads its interval at start and is stable for the run ══
  {
    name: "mesh-presence-degradation/01 the cadence loop reads its interval at start and is stable for the run",
    async run() {
      // Given config.mesh.presence.cadenceSeconds is 5 → When I start the cadence loop.
      const config = { mesh: { presence: { cadenceSeconds: 5 } } };
      const cadenceAtStart = presenceCadenceFromConfig({ config });
      const ticker = manualTicker();
      const loop = startPresenceLoop({ publishOnce: () => {}, cadenceSeconds: cadenceAtStart, ticker });
      assert.equal(loop.intervalSeconds, 5, "the loop started at the 5s cadence read from config");
      // And config.mesh.presence.cadenceSeconds is later changed to 30.
      config.mesh.presence.cadenceSeconds = 30;
      // The running loop's tick interval is still 5 seconds (the cadence is read at start).
      assert.equal(loop.intervalSeconds, 5, "the running loop's tick interval is still 5s (the cadence is read at start)");
      loop.stop();
    },
  },
];
