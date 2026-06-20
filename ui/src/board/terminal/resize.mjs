// Adapted from elirantutia/vibeyard (MIT) — the fit → resize signal
// (vibeyard's fitAddon.fit() then a {cols,rows} resize over the carrier),
// re-homed as a framework-free helper. vibeyard is MIT-licensed; see the repo
// NOTICE file. ADR-003: the client→server control envelope is
// { type:'resize', cols, rows }; here we build it and assert "the session is
// told it is now C×R exactly once" headlessly (no real PTY, no xterm).

// Build the client→server resize control message for a fit to cols×rows.
export function resizeMessage(cols, rows) {
  return { type: "resize", cols: toDim(cols), rows: toDim(rows) };
}

// Serialize a resize message to the wire form the WebSocket sends.
export function resizeFrame(cols, rows) {
  return JSON.stringify(resizeMessage(cols, rows));
}

// A fit → single-emit helper: given the fitted cols/rows and a `send` sink,
// emit EXACTLY ONE resize frame for that fit, and return the message that was
// sent (so a test can assert both the dims and the single emission). A no-change
// fit (same dims as the last emitted) does not re-emit — matching xterm's
// fit-only-on-change behaviour and the "exactly one resize per fit" contract.
export function emitFit(cols, rows, send, last) {
  const message = resizeMessage(cols, rows);
  if (last && last.cols === message.cols && last.rows === message.rows) {
    return { sent: false, message: last };
  }
  send(JSON.stringify(message));
  return { sent: true, message };
}

function toDim(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
