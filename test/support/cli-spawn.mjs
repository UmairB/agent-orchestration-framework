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
import { spawnSync, spawn } from "node:child_process";

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

// The ASYNC counterpart — a Promise<{ status, signal, stdout, stderr, error }> mirroring
// spawnSyncHardened's result shape (same never-ran retry). Use this — NOT spawnCliSync —
// whenever the SAME process that spawns the CLI is ALSO serving the endpoint the CLI
// talks to (an in-process serveRelay / board-serve): spawnSync BLOCKS the parent event
// loop for the child's whole lifetime, so the parent can never run its loop to accept the
// child's request → the child's fetch hangs → a spawnSync deadlock (empty stdout, SIGTERM
// on timeout). An async spawn keeps the parent loop live, so the in-process server serves
// the child while it runs. Stdout/stderr are decoded utf8 (matching encoding:"utf8").
export function spawnCliAsync(command, args, options = {}) {
  const attempt = () =>
    new Promise((resolve) => {
      const child = spawn(command, args, options);
      let stdout = "";
      let stderr = "";
      let spawnError = null;
      if (child.stdout) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => { stdout += chunk; });
      }
      if (child.stderr) {
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => { stderr += chunk; });
      }
      // 'error' (CreateProcess/ENOENT) may fire with no 'close'; settle once, either way.
      let settled = false;
      const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
      child.on("error", (error) => { spawnError = error; settle({ status: null, signal: null, stdout, stderr, error }); });
      child.on("close", (status, signal) => settle({ status, signal, stdout, stderr, error: spawnError }));
    });
  const run = async () => {
    let result;
    for (let n = 0; n < MAX_ATTEMPTS; n += 1) {
      result = await attempt();
      // A numeric exit code OR a signal-kill is a genuine outcome — return it. Only a
      // never-ran spawn (no status, no signal — the Windows CreateProcess flake) retries.
      if (result.status !== null || result.signal != null) break;
      if (n === MAX_ATTEMPTS - 1) break;
      await new Promise((r) => setTimeout(r, 25 * (n + 1)));
    }
    return result;
  };
  return run();
}
