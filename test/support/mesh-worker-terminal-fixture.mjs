// test/support/mesh-worker-terminal-fixture.mjs — shared fakes for milestone 38 /
// story 05 (ADR-013): a scripted node-pty double + a stubbed terminal-providers
// `which` binary-resolution seam, so @executable coverage drives the REAL
// driveInteractiveClaudeSession / resolveInteractiveDriverLaunch / resolveProvider
// chain (mesh-worker-execution.mjs / terminal-providers.mjs) with no real node-pty,
// no real `claude`, no PTY, no network — the fake occupies EXACTLY the seam
// terminal-ws.mjs's own spawn/which injections occupy (the SAME "test through the
// real seam, only the leaf spawn/PATH-lookup is faked" discipline).

// createFakeWhich(presentBins) — a stubbed-present/absent PATH lookup mirroring
// terminal-providers.mjs's own `which(bin, env) => path|null` contract. `presentBins`
// names which binaries resolve; anything else resolves to null (the honest-degrade
// path terminal-ws.mjs's own provider gate keeps).
export function createFakeWhich(presentBins = ["claude"]) {
  return (bin) => (presentBins.includes(bin) ? `/fake/bin/${bin}` : null);
}

// createScriptedPty({ onWrite }) — a node-pty IPty double (onData/onExit/write/kill,
// the SAME shape terminal-ws.mjs's wireSession already drives). `onWrite` is called
// SYNCHRONOUSLY, inside term.write(...), with { chunk, emitData, emitExit } — letting
// a test script the "agent's" response to the EXACT command line the driver typed,
// with no timing race against driveInteractiveClaudeSession's own internal awaits
// (its onData/onExit handlers are registered BEFORE term.write is ever called, so a
// synchronous emit inside onWrite always reaches an already-registered handler).
export function createScriptedPty({ onWrite } = {}) {
  const dataHandlers = [];
  const exitHandlers = [];
  const writes = [];
  const resizes = [];
  let killed = false;
  const pty = {
    pid: 4242,
    // onData/onExit's returned dispose() SPLICES the handler back out of its
    // array — mirroring real node-pty's own unsubscribe contract, so a test can
    // assert "no fire-after-settle" (a handler disposed after the driver settles
    // must never be invoked by a later emitData/emitExit call).
    onData(cb) {
      dataHandlers.push(cb);
      return {
        dispose() {
          const i = dataHandlers.indexOf(cb);
          if (i !== -1) dataHandlers.splice(i, 1);
        },
      };
    },
    onExit(cb) {
      exitHandlers.push(cb);
      return {
        dispose() {
          const i = exitHandlers.indexOf(cb);
          if (i !== -1) exitHandlers.splice(i, 1);
        },
      };
    },
    write(chunk) {
      writes.push(chunk);
      onWrite?.({
        chunk,
        emitData: (data) => dataHandlers.slice().forEach((cb) => cb(data)),
        emitExit: (exitCode = 0) => exitHandlers.slice().forEach((cb) => cb({ exitCode })),
      });
    },
    resize(cols, rows) {
      resizes.push({ cols, rows });
    },
    kill() {
      killed = true;
    },
    writes,
    resizes,
    get killed() {
      return killed;
    },
  };
  return pty;
}

// createFakePtySpawn({ onWrite }) — records every spawn call (bin/args/options) and
// returns a FRESH createScriptedPty(...) for each spawn — a test asserts spawnCalls
// for the argv-shape scenarios and drives the returned pty (via ptys[n]) for the
// output-stream scenarios. Task 01's "ONE long-lived session per assignment"
// invariant is proven by asserting spawnCalls.length itself.
export function createFakePtySpawn({ onWrite } = {}) {
  const spawnCalls = [];
  const ptys = [];
  const spawn = async (bin, args, options) => {
    const pty = createScriptedPty({ onWrite });
    spawnCalls.push({ bin, args, options });
    ptys.push(pty);
    return pty;
  };
  return { spawn, spawnCalls, ptys };
}
