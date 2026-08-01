// src/command-error.mjs — the command error contract. It lives BELOW `commands/`
// (moved out of `commands/errors.mjs`, m42 wave (d) leg d1) because it is a
// contract, not a command: the faces, the commands and the cores that raise
// coded failures all share it, and a core reaching UP into `commands/` for it was
// one of the four upward imports the layer gate now forbids.
//
// The contract (ADR-003): commands throw Errors carrying `.code`
// and `.status` so BOTH faces map the same failure — the board face responds
// `error.status ?? 500` with the `{ ok:false, error, code }` envelope, and the
// CLI face prints + exits non-zero. The status codes are the milestone-03 frozen
// mapping (invalid-doc/missing-ref/missing-note/unsupported-target → 400,
// ref-not-found → 404). Transport errors (payload-too-large/empty-json/
// malformed-json) stay in the board face's body reader, NOT here.
export function commandError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
