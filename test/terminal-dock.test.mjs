// Traceability wiring for milestone 03 / story 02 — the @executable UI-logic
// (protocol-shape) scenarios across the two task features. These import the
// framework-free `.mjs` protocol modules the React dock also imports, so the
// dock-state ramp, the exactly-one-selected picker, and the fit→resize emit are
// asserted headlessly — NO PTY, NO browser (per the feature comments: the wire
// EFFECT on dock state, not the frame bytes as spec).
//
//   00_run-agent-terminal.feature
//     @executable Scenario Outline: an exit control message drives the dock to
//         the matching exited state (0→clean, 1→failure, 130→failure)
//     @executable Scenario Outline: fitting the pane to <cols>x<rows> tells the
//         session the new size exactly once (80x24, 120x30, 200x50)
//   01_provider-picker-and-missing.feature
//     @executable the picker starts with exactly one selected
//     @executable Scenario Outline: selecting a provider makes it the only one
import assert from "node:assert/strict";
import {
  dockStateFromControl,
  dockRunning,
  DOCK_STATES,
} from "../ui/src/board/terminal/dock-state.mjs";
import {
  initialPicker,
  selectProvider,
  isSelected,
  selectedCount,
  PROVIDER_IDS,
} from "../ui/src/board/terminal/provider-picker.mjs";
import { emitFit } from "../ui/src/board/terminal/resize.mjs";

export const terminalDockTests = [
  // ===== 00_run-agent-terminal.feature — exit control message → dock state =====
  ...[
    { code: 0, reads: "clean" },
    { code: 1, reads: "failure" },
    { code: 130, reads: "failure" },
  ].map(({ code, reads }) => ({
    name: `terminal-dock/00 an exit control message with code ${code} drives the dock to exited reading "${reads}"`,
    async run() {
      // Given the dock is in the running state
      const running = dockRunning();
      assert.equal(running.state, DOCK_STATES.RUNNING);
      // When the server reports the session exited with code <code>
      const next = dockStateFromControl(running, { type: "exit", exitCode: code });
      // Then the dock shows the exited state reporting code <code>
      assert.equal(next.state, DOCK_STATES.EXITED, "the dock is in the exited state");
      assert.equal(next.exitCode, code, "the exited state reports the exact code");
      // And the exited state reads as "<reads-as>"
      assert.equal(next.reads, reads, `code ${code} reads as ${reads}`);
    },
  })),

  // ===== 00_run-agent-terminal.feature — fit → exactly one resize =====
  ...[
    { cols: 80, rows: 24 },
    { cols: 120, rows: 30 },
    { cols: 200, rows: 50 },
  ].map(({ cols, rows }) => ({
    name: `terminal-dock/00 fitting the pane to ${cols}x${rows} tells the session the new size exactly once`,
    async run() {
      // Given the dock has an open session (a sink that records emitted frames)
      const sent = [];
      const send = (frame) => sent.push(frame);
      // When the pane is fitted to <cols> columns and <rows> rows
      const result = emitFit(cols, rows, send, null);
      // Then the session is told to resize to <cols> columns and <rows> rows
      assert.equal(result.sent, true, "a resize was emitted for the fit");
      assert.equal(result.message.cols, cols, "the resize carries the fitted columns");
      assert.equal(result.message.rows, rows, "the resize carries the fitted rows");
      const parsed = sent.map((frame) => JSON.parse(frame));
      assert.deepEqual(parsed[0], { type: "resize", cols, rows }, "the resize message tells the session the new size");
      // And exactly one resize is sent for that fit
      assert.equal(sent.length, 1, "exactly one resize frame is sent for the fit");

      // And a no-change re-fit does not re-emit (one resize PER fit).
      const again = emitFit(cols, rows, send, result.message);
      assert.equal(again.sent, false, "an identical re-fit does not emit a second resize");
      assert.equal(sent.length, 1, "still exactly one resize for the unchanged geometry");
    },
  })),

  // ===== 01_provider-picker-and-missing.feature — exactly-one-selected =====
  {
    name: "terminal-dock/01 the provider picker starts with exactly one provider selected",
    async run() {
      const picker = initialPicker();
      // Then exactly one of claude, codex or gemini is selected
      assert.equal(selectedCount(picker), 1, "exactly one provider is selected by default");
      const selected = PROVIDER_IDS.filter((id) => isSelected(picker, id));
      assert.equal(selected.length, 1, "precisely one provider id reads as selected");
      // And the other two providers are not selected
      const unselected = PROVIDER_IDS.filter((id) => !isSelected(picker, id));
      assert.equal(unselected.length, 2, "the other two are not selected");
    },
  },

  // ===== 01_provider-picker-and-missing.feature — selecting moves the single selection =====
  ...[
    ["claude", "codex"],
    ["claude", "gemini"],
    ["codex", "claude"],
    ["codex", "gemini"],
    ["gemini", "claude"],
    ["gemini", "codex"],
  ].map(([from, to]) => ({
    name: `terminal-dock/01 selecting ${to} (from ${from}) makes ${to} the only selected provider`,
    async run() {
      // Given the provider "<from>" is currently selected
      let picker = selectProvider(initialPicker(), from);
      assert.ok(isSelected(picker, from), `${from} is selected to start`);
      // When I select the provider "<to>"
      picker = selectProvider(picker, to);
      // Then "<to>" is the selected provider
      assert.ok(isSelected(picker, to), `${to} is now selected`);
      // And "<from>" is no longer selected
      assert.ok(!isSelected(picker, from), `${from} is no longer selected`);
      // And exactly one provider is selected
      assert.equal(selectedCount(picker), 1, "exactly one provider remains selected");
    },
  })),
];
