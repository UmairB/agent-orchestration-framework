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
