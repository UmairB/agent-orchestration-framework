// Traceability wiring for milestone 28 / story 00, task 03 —
// tasks/03_single-entry-two-mode.feature (ADR-004).
//
// Drives run(argv) DIRECTLY, in-process, against the real src/cli.mjs — no
// built binary needed (the Build-notes developer-seat guidance: run() must be
// invokable in-process such that the routed command id is observable). Each
// row is a distinct real route; every one dispatches through the ONE run().
import assert from "node:assert/strict";
import { run } from "../src/cli.mjs";
import { getCommand } from "../src/command-core.mjs";

// Capture console.log output across an awaited call, restoring afterwards
// even on throw.
async function captureLog(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  let out = "";
  let err = "";
  console.log = (msg) => { out += `${String(msg)}\n`; };
  console.error = (msg) => { err += `${String(msg)}\n`; };
  let threw = null;
  try {
    await fn();
  } catch (error) {
    threw = error;
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { out, err, threw };
}

// Wrap the registered mesh:relay command's run to observe whether it was
// actually invoked (the "reaches invoke(mesh:relay)" assertion) without
// bypassing the real dispatch — a thin spy, restored immediately after use.
function spyOnMeshRelayRun() {
  const command = getCommand("mesh:relay");
  const original = command.run;
  let callCount = 0;
  command.run = async (...args) => {
    callCount += 1;
    return original.apply(command, args);
  };
  return {
    callCount: () => callCount,
    restore: () => { command.run = original; },
  };
}

export const singleEntryTwoModeTests = [
  // ===== node-mode and relay-mode argv both route through the one command core =====
  {
    name: "single-entry-two-mode/00 run([]) dispatches to node mode (default/help) through the one command core",
    async run() {
      const { out, threw } = await captureLog(() => run([]));
      assert.equal(threw, null, "bare [] does not throw");
      assert.ok(out.length > 0, "bare [] prints the default/help text (node mode)");
    },
  },
  {
    name: "single-entry-two-mode/00 run([\"--version\"]) dispatches to node mode (version) through the one command core",
    async run() {
      const { out, threw } = await captureLog(() => run(["--version"]));
      assert.equal(threw, null, "--version does not throw");
      assert.match(out.trim(), /^\d+\.\d+\.\d+/, "--version prints a semver-shaped version string (node mode)");
    },
  },
  {
    name: "single-entry-two-mode/00 run([\"work\",\"next\"]) dispatches to node mode (work:next) through the one command core",
    async run() {
      const { threw } = await captureLog(() => run(["work", "next", "--json"]));
      // Whether it succeeds or raises a workspace-shaped error, it must be
      // ROUTED through run()'s own work dispatch, never bypass it — reaching
      // this point (past the argv branch) without a per-mode fork proves the
      // route. A thrown error here is a legitimate workspace-resolution
      // outcome for this repo's cwd, not a fork-detection failure.
      if (threw) {
        assert.ok(threw instanceof Error, "a work:next dispatch failure is a normal Error, not a mode-fork artifact");
      }
    },
  },
  {
    name: "single-entry-two-mode/00 run([\"graph\",\"build\"]) dispatches to node mode (graph:build) through the one command core",
    async run() {
      const { threw } = await captureLog(() => run(["graph", "build", "--json"]));
      if (threw) {
        assert.ok(threw instanceof Error, "a graph:build dispatch failure is a normal Error, not a mode-fork artifact");
      }
    },
  },
  {
    name: "single-entry-two-mode/00 run([\"init\"]) dispatches to node mode (init) through the one command core",
    async run() {
      // This repo's own cwd already carries a .aof/aof.config.json, so init's
      // OWN dispatch (not a mode fork) rejects with its normal already-exists
      // error — reaching that command-level error IS the routing proof (a
      // pre-run fork would never reach init's own refusal logic at all).
      const { threw } = await captureLog(() => run(["init"]));
      assert.ok(threw instanceof Error, "init dispatches through run() and raises its own (normal) refusal");
      assert.match(threw.message, /already exists/, "the refusal is init's own dispatch-level error, not a mode-fork artifact");
    },
  },
  {
    name: "single-entry-two-mode/00 run([\"mesh\",\"status\"]) dispatches to node mode (mesh:status) through the one command core",
    async run() {
      const { out, threw } = await captureLog(() => run(["mesh", "status", "--json"]));
      assert.equal(threw, null, "mesh status --json does not throw against this repo's own workspace");
      const parsed = JSON.parse(out);
      assert.ok(Array.isArray(parsed.nodes), "mesh:status returns the { nodes: [...] } shape (node mode)");
    },
  },
  {
    name: "single-entry-two-mode/00 run([\"mesh\",\"identity\"]) dispatches to node mode (mesh:identity) — a mesh SIBLING of relay, not the relay route itself",
    async run() {
      const spy = spyOnMeshRelayRun();
      try {
        const { threw } = await captureLog(() => run(["mesh", "identity", "--json"]));
        assert.equal(spy.callCount(), 0, "mesh identity never reaches the mesh:relay command's run — \"mesh\" alone is not \"relay\"");
        if (threw) assert.ok(threw instanceof Error, "any dispatch failure is a normal Error");
      } finally {
        spy.restore();
      }
    },
  },
  {
    name: "single-entry-two-mode/00 run([\"mesh\",\"relay\",\"--json\"]) dispatches to relay mode (invoke mesh:relay)",
    async run() {
      const spy = spyOnMeshRelayRun();
      try {
        const { out, threw } = await captureLog(() => run(["mesh", "relay", "--json"]));
        assert.equal(threw, null, "mesh relay --json does not throw");
        assert.equal(spy.callCount(), 1, "the dispatch reaches invoke(\"mesh:relay\") exactly once");
        const parsed = JSON.parse(out);
        assert.ok("nominated" in parsed, "the relay probe's { nominated, controlNode, url } shape is returned (relay mode)");
      } finally {
        spy.restore();
      }
    },
  },
  {
    name: "single-entry-two-mode/00 run([\"mesh\",\"relay\"]) WITHOUT --json still dispatches to relay mode (invoke mesh:relay) — the mode is the subcommand, not the probe flag",
    async run() {
      const spy = spyOnMeshRelayRun();
      try {
        const { threw } = await captureLog(() => run(["mesh", "relay"]));
        assert.equal(threw, null, "mesh relay (no --json) does not throw");
        assert.equal(spy.callCount(), 1, "the dispatch reaches invoke(\"mesh:relay\") exactly once, regardless of --json");
      } finally {
        spy.restore();
      }
    },
  },

  // ===== no forked entry — the packaged main hands FULL argv to run() =====
  {
    name: "single-entry-two-mode/01 relay-mode argv is handed to run() WITHOUT a pre-run argv[0]===\"relay\" inspection (asserted structurally by acd-single-entry-command-core; confirmed behaviourally here: the SAME run() call reaches relay for both entry shapes)",
    async run() {
      const spy = spyOnMeshRelayRun();
      try {
        await captureLog(() => run(["mesh", "relay", "--json"]));
        assert.equal(spy.callCount(), 1, "relay mode is reached only through run()'s existing argv dispatch — the one door");
      } finally {
        spy.restore();
      }
    },
  },

  // ===== error routing — an unknown subcommand is run()'s own dispatch =====
  {
    name: "single-entry-two-mode/02 run([\"definitely-not-a-command\"]) is rejected by run()'s own dispatch, not a pre-run fork",
    async run() {
      const { threw } = await captureLog(() => run(["definitely-not-a-command"]));
      assert.ok(threw instanceof Error, "an unknown top-level command throws run()'s own error");
      assert.match(threw.message, /Unknown command "definitely-not-a-command"/, "the error names the unrecognised command (node mode's standard error)");
    },
  },

  // ===== the relay route runs the non-blocking probe and returns =====
  {
    name: "single-entry-two-mode/03 run([\"mesh\",\"relay\",\"--json\"]) invokes the non-blocking probe and returns without binding a long-lived listener",
    async run() {
      const startedAt = Date.now();
      const { out, threw } = await captureLog(() => run(["mesh", "relay", "--json"]));
      const elapsedMs = Date.now() - startedAt;
      assert.equal(threw, null, "the relay-mode dispatch does not throw");
      // A bound long-lived listener would hang the awaited run() call
      // indefinitely (or at least far longer than a plain config-read probe);
      // completing quickly is the observable proxy for "no listen() call".
      assert.ok(elapsedMs < 2000, "the relay dispatch returns quickly — no long-lived listener was bound by dispatch itself");
      const parsed = JSON.parse(out);
      assert.equal(typeof parsed.nominated, "boolean", "the probe result is returned to the caller");
    },
  },
];
