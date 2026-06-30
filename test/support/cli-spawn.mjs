// test/support/cli-spawn.mjs
//
// The single hardened subprocess spawn the test suite shares — used for both the `aof`
// CLI and the `git` fixtures. `spawnSyncHardened` is a drop-in for child_process.spawnSync
// with ONE behaviour added: it retries a transient spawn that never produced an exit
// code. On Windows, under the temp-dir / handle pressure a full test run accumulates,
// CreateProcess intermittently fails so spawnSync returns { status: null, signal: null,
// error } — the child NEVER RAN (not a real exit). That would falsely red a
// structurally-sound CLI-face / bijection / git-fixture step (the flake first caught in
// acd-mesh-command-cli-bijection: ~1 in 3 full-suite runs, 0/30 in isolation).
//
// We retry ONLY that never-ran case, mirroring src/fs.mjs renameWithRetry (6 attempts,
// linear 25·n ms backoff). A real exit (ANY numeric status, incl. a non-zero failure)
// OR a signal-kill (timeout / crash) is a GENUINE outcome and returns immediately — so
// a true failure keeps its signal and is never masked by a retry.
//
// Synchronous on purpose: it returns the RAW spawnSync result object, so every existing
// `const r = spawnSyncHardened(...); r.status / r.stdout / r.stderr / r.error` call site
// is unchanged — no async cascade into the callers. The inter-attempt sleep is a real
// thread block via Atomics.wait (Node permits this on the main thread); it only happens
// on the rare transient failure, never on the success path.
import { spawnSync } from "node:child_process";

const MAX_ATTEMPTS = 6;

// A blocking sleep with no busy-spin: wait on a throwaway lock that never notifies, so
// the call simply times out after `ms`.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function spawnSyncHardened(command, args, options = {}) {
  let result;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    result = spawnSync(command, args, options);
    // A numeric exit code OR a signal-kill is a genuine outcome — stop and return it.
    // Only a never-ran spawn (status === null && signal == null) is retried.
    if (result.status !== null || result.signal != null) break;
    if (attempt === MAX_ATTEMPTS - 1) break;
    sleepSync(25 * (attempt + 1));
  }
  return result;
}

// Alias: the CLI-spawn call sites (the bulk of the suite) read clearer as `spawnCliSync`.
// Same function — both names are the one shared hardened spawn.
export const spawnCliSync = spawnSyncHardened;
