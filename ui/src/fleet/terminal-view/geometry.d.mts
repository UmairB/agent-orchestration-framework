// Type declarations for geometry.mjs (the fleet terminal-VIEW's render geometry;
// milestone 38 / story 06 / task 04, live-soak render fix). Shipped alongside the
// .mjs because `node scripts/test.mjs` does NOT type-check the fleet TS — a
// framework-free helper consumed from a .tsx without its .d.mts keeps the node suite
// green while `tsc -b` FAILS (this milestone's own craft lesson).

// The worker's fixed interactive-PTY geometry (src/mesh-worker-execution.mjs). The
// browser mirror renders at EXACTLY this size, then scales the result to fit.
export declare const WORKER_TERMINAL_COLS: number;
export declare const WORKER_TERMINAL_ROWS: number;

// The aspect-preserving CSS-transform scale that fits an intrinsic-sized terminal
// into an available box. Returns 1 (the identity) for any absent/zero/negative
// dimension, so a pre-layout render never yields NaN.
export declare function terminalFitScale(input?: {
  intrinsicWidth?: number;
  intrinsicHeight?: number;
  boxWidth?: number;
  boxHeight?: number;
}): number;
