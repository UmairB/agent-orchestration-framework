// The fleet terminal-VIEW's RENDER GEOMETRY (milestone 38 / story 06 / task 04 —
// the live two-machine soak render-quality fix, 2026-07-25). A framework-free ESM
// module — no React, no DOM, no xterm — the terminal-view sibling of stream.mjs /
// view-state.mjs, so the fit math is unit-testable headlessly and the .tsx stays a
// thin consumer.
//
// WHY THIS EXISTS. The worker spawns its interactive `claude` PTY at a FIXED 80×24
// (src/mesh-worker-execution.mjs — the `ptySpawn(..., { cols: 80, rows: 24 })` call).
// `claude`'s TUI is a full-screen, absolutely-cursor-addressed app: it paints every
// line for THAT screen size. If the browser mirror renders the same bytes into an
// xterm of a DIFFERENT size (the old code fit xterm to the tiny ~46×10 card pane),
// every absolutely-positioned line lands at the wrong column and the screen overlaps
// itself into an unreadable scatter. The fix: render the browser xterm at EXACTLY the
// worker's geometry and SCALE the fixed-size result to whatever box is available
// (the card peek scales it DOWN; the expanded overlay scales it UP). xterm's DOM
// renderer (no canvas/webgl addon is loaded on this surface) scales crisply in BOTH
// directions off the SAME instance.
//
// THE CONTRACT. These two constants MUST equal the worker's PTY size. They are a
// pair with src/mesh-worker-execution.mjs; the UI build and the node `src/` build are
// separate worlds that cannot import across, so the tie is held by
// test/fleet-terminal-view-geometry.test.mjs, which reads BOTH files and fails if the
// numbers drift apart.
export const WORKER_TERMINAL_COLS = 80;
export const WORKER_TERMINAL_ROWS = 24;

// terminalFitScale({ intrinsicWidth, intrinsicHeight, boxWidth, boxHeight }) — the
// single CSS-transform scale that fits a fixed-geometry terminal of `intrinsic`
// pixel size into an available `box`, PRESERVING ASPECT so the whole 80×24 screen
// stays visible and is never cropped (min of the two ratios, not max). Anchored
// top-left by the caller, so the scaled result always sits inside the box.
//
// Guards a zero/absent/negative dimension by returning 1 (the identity — render at
// natural size, scale nothing): the pane may be measured a frame before it is laid
// out, and a divide-by-zero must degrade to "don't scale yet", never NaN. The next
// ResizeObserver tick re-fits once the real box is known.
export function terminalFitScale({ intrinsicWidth, intrinsicHeight, boxWidth, boxHeight } = {}) {
  if (!(intrinsicWidth > 0) || !(intrinsicHeight > 0)) return 1;
  if (!(boxWidth > 0) || !(boxHeight > 0)) return 1;
  return Math.min(boxWidth / intrinsicWidth, boxHeight / intrinsicHeight);
}
