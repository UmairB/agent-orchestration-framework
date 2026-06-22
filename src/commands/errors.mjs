// The command error contract (ADR-003): commands throw Errors carrying `.code`
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
