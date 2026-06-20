// Adapted from elirantutia/vibeyard (MIT) — the terminal connection-state ramp,
// re-homed as framework-free ESM the node tests and the React dock both import.
// vibeyard is MIT-licensed; see the repo NOTICE file. ADR-003: the dock state is
// the observable EFFECT of the frozen wire envelope's control-frames; DESIGN §4
// fixes the ramp idle → connecting → running → exited/error.
//
// No React, no DOM, no PTY — pure state transitions, so the @executable
// scenarios (exit-code → exited state; error-frame → error state) run headlessly.

// The dock connection states (DESIGN §4 ramp).
export const DOCK_STATES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  RUNNING: "running",
  EXITED: "exited",
  ERROR: "error",
};

// The initial dock state: idle, no session.
export function initialDockState() {
  return { state: DOCK_STATES.IDLE, exitCode: null, reads: null, message: null };
}

// Opening a WebSocket / spawning the PTY → connecting.
export function dockConnecting() {
  return { state: DOCK_STATES.CONNECTING, exitCode: null, reads: null, message: null };
}

// PTY bytes streaming → running.
export function dockRunning() {
  return { state: DOCK_STATES.RUNNING, exitCode: null, reads: null, message: null };
}

// The server reported the session exited with `code`. exitCode 0 reads as a
// clean exit; any non-zero reads as a failure (DESIGN §4: the red branch is the
// destructive/accent state, distinct from a clean grey exit).
export function dockStateFromExit(code) {
  const exitCode = Number(code);
  const reads = exitCode === 0 ? "clean" : "failure";
  return { state: DOCK_STATES.EXITED, exitCode, reads, message: null };
}

// The server emitted an error control-frame (a missing provider, a failed spawn):
// the dock error state, naming the failure (ADR-003 honest-degrade).
export function dockStateFromError(message) {
  return {
    state: DOCK_STATES.ERROR,
    exitCode: null,
    reads: "failure",
    message: typeof message === "string" && message ? message : "terminal session failed",
  };
}

// Apply a server→client control message ({type:'exit'|'error'}) to the dock
// state. Unknown control types leave the state unchanged (raw PTY bytes are not
// control messages and never reach here).
export function dockStateFromControl(current, control) {
  if (!control || typeof control !== "object") return current;
  if (control.type === "exit") return dockStateFromExit(control.exitCode);
  if (control.type === "error") return dockStateFromError(control.message);
  return current;
}
