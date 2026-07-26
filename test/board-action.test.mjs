// Unit coverage for the state-aware primary action mapping (ui/src/board/action.ts
// — DESIGN: the detail panel's primary "Run agent" button is state-aware). Pure
// data: status + ctx in, { kind, label, command?, disabled? } out. Imported here
// the same way the React DetailPanel imports it, so the lifecycle mapping
// (refine → continue → verify, plus blocked/done/view) is asserted headlessly.
import assert from "node:assert/strict";
import { primaryAction } from "../ui/src/board/action.mjs";

// A minimal WorkItem stub — primaryAction reads only `status` and `ref`.
const item = (status, ref = "03") => ({ ref, type: "milestone", slug: "x", status, title: null, parent: null, dir: "" });

export const boardActionTests = [
  {
    name: "board-action/in-review → Verify running /aof:verify <ref>",
    async run() {
      const a = primaryAction(item("in-review"), { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "verify");
      assert.equal(a.label, "Verify");
      assert.equal(a.command, "/aof:verify 03");
      assert.notEqual(a.disabled, true);
    },
  },
  {
    name: "board-action/not-started WITHOUT a breakdown → Refine running /aof:refine <ref>",
    async run() {
      const a = primaryAction(item("not-started"), { hasBreakdown: false, liveForRef: false });
      assert.equal(a.kind, "refine");
      assert.equal(a.label, "Refine");
      assert.equal(a.command, "/aof:refine 03");
    },
  },
  {
    name: "board-action/not-started WITH a breakdown → Continue running /aof:continue <ref>",
    async run() {
      const a = primaryAction(item("not-started"), { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "continue");
      assert.equal(a.label, "Continue");
      assert.equal(a.command, "/aof:continue 03");
    },
  },
  {
    name: "board-action/in-progress → Continue running /aof:continue <ref>",
    async run() {
      const a = primaryAction(item("in-progress"), { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "continue");
      assert.equal(a.command, "/aof:continue 03");
    },
  },
  {
    // 2026-07-26 (operator, live soak): an item a WORKER was actively executing still
    // offered "Continue", and clicking it dispatched a second run that the assign core
    // refused — "already has an active assignment held by <node>". The row already
    // carries the answer; running work is watched, not restarted.
    name: "board-action/a worker is executing it (session not yet captured) → disabled, names the node, offers NO continue",
    async run() {
      const running = { ...item("in-progress"), execution: { assignmentId: "a1", active: true, state: "running", nodeId: "umairs-mac-mini", sessionId: null, updatedAt: null, branch: null } };
      const a = primaryAction(running, { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "running");
      assert.equal(a.label, "Running on umairs-mac-mini");
      assert.equal(a.disabled, true);
      assert.equal(a.command, undefined, "a running item offers no command to launch");
    },
  },
  {
    // m42 item 6 (reworked at the operator's insistence): the board has ONE terminal
    // surface — the dock — and a running item WITH a captured session opens it as the
    // fleet's read-only mirror. A remote session is a SOURCE of the dock, never a
    // second widget.
    name: "board-action/a worker is executing it WITH a captured session → View terminal opens the dock as the read-only mirror",
    async run() {
      const running = { ...item("in-progress"), execution: { assignmentId: "a1", active: true, state: "running", nodeId: "umairs-mac-mini", sessionId: "3ffa37de-ce0c", updatedAt: null, branch: null } };
      const a = primaryAction(running, { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "mirror");
      assert.equal(a.label, "View terminal — umairs-mac-mini");
      assert.equal(a.nodeId, "umairs-mac-mini");
      assert.equal(a.sessionId, "3ffa37de-ce0c", "the full (nodeId, sessionId) tuple rides the action — the dock needs both");
      assert.equal(a.disabled, undefined, "watchable running work is not a dead end");
    },
  },
  {
    // The mirror case: a SETTLED remote run (withdrawn/done/failed) is not executing, so
    // the item is continuable again — the guard must key on `active`, not on the mere
    // presence of an execution record (every finished mesh run leaves one behind).
    name: "board-action/a SETTLED remote run → Continue is offered again",
    async run() {
      const settled = { ...item("in-progress"), execution: { assignmentId: "a1", active: false, state: "withdrawn", nodeId: "umairs-mac-mini", sessionId: null, updatedAt: null, branch: null } };
      const a = primaryAction(settled, { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "continue");
      assert.equal(a.command, "/aof:continue 03");
    },
  },
  {
    // A LOCAL dock session still wins over everything — unchanged.
    name: "board-action/a live local session wins over a remote execution record",
    async run() {
      const running = { ...item("in-progress"), execution: { assignmentId: "a1", active: true, state: "running", nodeId: "umairs-mac-mini", sessionId: null, updatedAt: null, branch: null } };
      const a = primaryAction(running, { hasBreakdown: true, liveForRef: true });
      assert.equal(a.kind, "view");
      assert.equal(a.label, "View terminal");
    },
  },
  {
    name: "board-action/blocked → disabled, no command",
    async run() {
      const a = primaryAction(item("blocked"), { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "blocked");
      assert.equal(a.label, "Blocked");
      assert.equal(a.disabled, true);
      assert.equal(a.command, undefined);
    },
  },
  {
    name: "board-action/done → ad-hoc Run agent with no command",
    async run() {
      const a = primaryAction(item("done"), { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "adhoc");
      assert.equal(a.label, "Run agent");
      assert.equal(a.command, undefined);
    },
  },
  {
    name: "board-action/null status → ad-hoc Run agent (unknown falls through)",
    async run() {
      const a = primaryAction(item(null), { hasBreakdown: true, liveForRef: false });
      assert.equal(a.kind, "adhoc");
      assert.equal(a.command, undefined);
    },
  },
  {
    name: "board-action/a live session for the ref → View terminal (takes precedence over status)",
    async run() {
      // Even an in-review item shows "View terminal" when a session is live for it.
      const a = primaryAction(item("in-review"), { hasBreakdown: true, liveForRef: true });
      assert.equal(a.kind, "view");
      assert.equal(a.label, "View terminal");
      assert.equal(a.command, undefined);
    },
  },
];
