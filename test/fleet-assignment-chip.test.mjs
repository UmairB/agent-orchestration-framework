// Traceability wiring for milestone 35 / story 03 / task 01 —
// tasks/01_lifecycle-render.feature (@executable).
//
// The pure assignment-chip helper (ui/src/fleet/assignments.mjs, exporting
// `assignmentChip`) is framework-free ESM — no React, no DOM, no I/O, no clock —
// so every scenario/example row runs HEADLESSLY, mirroring the run-chip /
// relative-time / in-flight helper convention (node:test, no browser).
import assert from "node:assert/strict";
import { assignmentChip, assignmentSummary } from "../ui/src/fleet/assignments.mjs";

export const fleetAssignmentChipTests = [
  // Scenario Outline: each lifecycle state maps to its fixed chip — label,
  // mark, token, and motion together (DESIGN §4 ramp).
  {
    name: "fleet-assignment-chip/01 each lifecycle state maps to its fixed chip — label, mark, token, motion together",
    run: () => {
      const rows = [
        { state: "assigned", label: "assigned", mark: "a hollow dot", token: "muted", motion: "none" },
        { state: "accepted", label: "accepted", mark: "a filled dot", token: "secondary", motion: "none" },
        { state: "running", label: "running", mark: "a pulsing dot", token: "primary", motion: "pulse" },
        { state: "done", label: "done", mark: "a ✓", token: "primary", motion: "none" },
        { state: "failed", label: "failed", mark: "a !", token: "destructive", motion: "none" },
      ];
      for (const { state, label, mark, token, motion } of rows) {
        const chip = assignmentChip({ state });
        assert.equal(chip.label, label, `state "${state}" label`);
        assert.equal(chip.mark, mark, `state "${state}" mark`);
        assert.equal(chip.token, token, `state "${state}" token`);
        assert.equal(chip.motion, motion, `state "${state}" motion`);
        assert.ok(chip.token && chip.label && chip.mark, `state "${state}" never returns a token without its paired label and mark`);
      }
    },
  },

  // Only "running" carries motion — every other ramp row is "none".
  {
    name: "fleet-assignment-chip/01 only running carries motion — pulse never appears on any other ramp row",
    run: () => {
      for (const state of ["assigned", "accepted", "done", "failed"]) {
        assert.equal(assignmentChip({ state }).motion, "none", `state "${state}" does not pulse`);
      }
      assert.equal(assignmentChip({ state: "running" }).motion, "pulse", "only running pulses");
    },
  },

  // Scenario Outline: a reclaimed or stale assignment reads as failed plus a
  // degraded `· reclaimed` note.
  {
    name: "fleet-assignment-chip/01 a reclaimed or stale assignment reads as failed plus a degraded reclaimed note",
    run: () => {
      for (const state of ["reclaimed", "stale"]) {
        const chip = assignmentChip({ state, reclaimedAt: "2026-07-08T10:05:00.000Z" });
        assert.equal(chip.label, "failed", `state "${state}" label is failed`);
        assert.equal(chip.mark, "a !", `state "${state}" mark is a !`);
        assert.equal(chip.token, "destructive", `state "${state}" token is destructive`);
        assert.equal(chip.note, "reclaimed", `state "${state}" carries a trailing reclaimed note`);
        // NOT a sixth colour, does not revert to "assigned", never vanishes (a
        // descriptor is always returned with the fixed destructive vocabulary).
        assert.notEqual(chip.token, "assigned");
        assert.notEqual(chip.label, "assigned");
        assert.ok(!["muted", "secondary", "primary"].includes(chip.token), `state "${state}" is not a sixth/other colour`);
      }
    },
  },

  // Scenario: a withdrawn assignment reads as failed with no reclaim note.
  {
    name: "fleet-assignment-chip/01 a withdrawn assignment reads as failed with no reclaim note",
    run: () => {
      const chip = assignmentChip({ state: "withdrawn", reclaimedAt: null });
      assert.equal(chip.label, "failed");
      assert.equal(chip.token, "destructive");
      assert.ok(!("note" in chip) || chip.note == null, "a withdrawn assignment carries no reclaimed note");
    },
  },

  // Scenario Outline: an unknown or absent state degrades to a quiet muted
  // chip, never a throw.
  {
    name: "fleet-assignment-chip/01 an unknown or absent state degrades to a quiet muted chip, never a throw",
    run: () => {
      const rows = [{ state: "queued" }, { state: undefined }, { state: "" }, { state: "some-future" }];
      for (const row of rows) {
        assert.doesNotThrow(() => assignmentChip(row), `state ${JSON.stringify(row.state)} never throws`);
        const chip = assignmentChip(row);
        assert.equal(chip.token, "muted", `state ${JSON.stringify(row.state)} falls back to muted`);
      }
      // a fully-absent row (null/undefined) is also handled without throwing.
      assert.doesNotThrow(() => assignmentChip(null));
      assert.doesNotThrow(() => assignmentChip(undefined));
      assert.equal(assignmentChip(null).token, "muted");
      assert.equal(assignmentChip(undefined).token, "muted");
    },
  },

  // Scenario: on a silent poll error the helper still describes the last-good
  // assignment — the card never tears (keep-last-good idiom).
  {
    name: "fleet-assignment-chip/01 on a silent poll error the helper still describes the last-good assignment — the card never tears",
    run: () => {
      const lastGood = { state: "running" };
      // the helper is PURE over the row it is given — a caller handing it the
      // same last-good row after a silent poll failure gets the SAME chip back.
      const chip = assignmentChip(lastGood);
      assert.equal(chip.label, "running");
      assert.equal(chip.token, "primary");
      assert.equal(chip.mark, "a pulsing dot");
      const again = assignmentChip(lastGood);
      assert.deepEqual(again, chip, "the same last-good row always yields the same descriptor — no loading/error/empty chip");
      assert.notEqual(again.label, "assigned", "the last-good state is not cleared to assigned");
      assert.notEqual(again.token, "muted", "the last-good running chip does not degrade to an empty/muted chip on a silent poll");
    },
  },

  // DESIGN §2b — the node-side compact summary: only non-zero states listed,
  // never "0 assignments"; a degraded row folds into the "failed" bucket.
  {
    name: "fleet-assignment-chip/01 assignmentSummary tallies held assignments by chip label, folding reclaimed/stale into failed, omitting zero states",
    run: () => {
      const rows = [
        { state: "running" },
        { state: "running" },
        { state: "accepted" },
        { state: "reclaimed", reclaimedAt: "2026-07-08T10:05:00.000Z" },
      ];
      const summary = assignmentSummary(rows);
      assert.deepEqual(summary, [
        { state: "running", count: 2 },
        { state: "accepted", count: 1 },
        { state: "failed", count: 1 },
      ]);
      // never a zero-count bucket for a state that has no rows.
      assert.ok(!summary.some((entry) => entry.state === "done"), "no zero-count bucket is fabricated for an absent state");
    },
  },

  // An empty/absent rows list yields an empty summary — the caller omits the
  // line entirely rather than rendering "0 assignments" (absent, not false).
  {
    name: "fleet-assignment-chip/01 assignmentSummary yields an empty array for no held assignments — the caller omits the line, never 0 assignments",
    run: () => {
      assert.deepEqual(assignmentSummary([]), []);
      assert.deepEqual(assignmentSummary(undefined), []);
      assert.deepEqual(assignmentSummary(null), []);
    },
  },
];
