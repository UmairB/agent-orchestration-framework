// Security fitness: acd-directive-only-from-admitted-peer (milestone 35 / SECURITY
// T5, F1) — "A `directive` frame is honoured ONLY from an admitted tailnet-peer
// connection; a non-peer's directive is refused at the upgrade gate (socket
// destroyed, no directive read)."
//
// Proofs:
//  1. Behavioural — over the REAL startControlStreamServer (the
//     acd-control-stream-address-bound in-process ws precedent): a loopback dial
//     NOT in peersByAddress never opens, so its directive never reaches the
//     dispatch path; a mapped peer's does.
//  2. Structural — the directive-handling branch (the nodeId -> ws targeting-map
//     population) sits INSIDE wss.on("connection") (post-admission scope), never on
//     a pre-upgrade surface.
//  3. Self-check (m03 non-vacuous) — a planted pre-upgrade directive-targets.set(...)
//     call (outside wss.on("connection")) trips the structural detector.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { startControlStreamServer, dispatchDirectiveOverTargets, buildDirectiveFrame } from "../../src/control-stream-server.mjs";
import { createDirectiveChannelFixture } from "../support/mesh-directive-channel-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");
const NOW = "2026-07-09T10:00:00.000Z";

async function withGlobalHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-directive-admitted-peer-"));
  try {
    return await fn({ env: { AOF_GLOBAL_HOME: home } });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function waitForOpenOrClose(ws) {
  return new Promise((resolve) => {
    let settled = false;
    ws.on("open", () => { if (!settled) { settled = true; resolve({ opened: true }); } });
    ws.on("close", () => { if (!settled) { settled = true; resolve({ opened: false }); } });
    ws.on("error", () => { if (!settled) { settled = true; resolve({ opened: false }); } });
  });
}

function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error("timed out waiting for condition")); return; }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// findConnectionHandlerBody(source) — extracts the wss.on("connection", (ws, meta)
// => { ... }) callback body (brace-balanced).
function findConnectionHandlerBody(source) {
  const anchor = source.indexOf('wss.on("connection", (ws');
  assert.ok(anchor >= 0, 'wss.on("connection", (ws, meta) => { ... }) is present');
  const braceStart = source.indexOf("{", anchor);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error("unbalanced braces scanning wss.on(\"connection\")");
}

export const archTests = [
  {
    name: "arch/35 SECURITY T5 (acd-directive-only-from-admitted-peer): a loopback dial NOT in peersByAddress never opens, so its directive never reaches the dispatch path; a mapped peer's does (behavioural)",
    run: async () => {
      await withGlobalHome(async ({ env }) => {
        const server = await startControlStreamServer({
          peerNodeIds: ["worker-a"],
          peersByAddress: [{ nodeId: "worker-a", dialAddress: "100.90.249.80" }], // NOT this loopback dial's address
          storeOptions: { env },
        });
        try {
          const port = server.server.address().port;
          const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
          const outcome = await waitForOpenOrClose(ws);
          assert.equal(outcome.opened, false, "a non-peer connection never opens");
          assert.equal(server.directiveTargets.get("worker-a"), null, "no socket ever entered the directive targeting map for the refused connection");

          const result = server.dispatchDirective(buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
          assert.equal(result.sent, false, "a directive to the never-admitted node is refused — nothing was ever dispatched to it");
        } finally {
          server.stop();
        }
      });
    },
  },
  {
    name: "arch/35 SECURITY T5 (acd-directive-only-from-admitted-peer): a mapped (admitted) peer's directive IS honoured (behavioural)",
    run: async () => {
      await withGlobalHome(async ({ env }) => {
        const server = await startControlStreamServer({
          peerNodeIds: ["worker-a"],
          peersByAddress: [{ nodeId: "worker-a", dialAddress: "127.0.0.1" }],
          storeOptions: { env },
        });
        try {
          const port = server.server.address().port;
          const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
          const outcome = await waitForOpenOrClose(ws);
          assert.equal(outcome.opened, true, "the admitted peer's connection opens");
          await waitFor(() => server.directiveTargets.get("worker-a") != null);

          const result = server.dispatchDirective(buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
          assert.equal(result.sent, true, "a directive over the admitted connection is honoured");
          try { ws.close(); } catch { /* already closing */ }
        } finally {
          server.stop();
        }
      });
    },
  },
  {
    name: "arch/35 SECURITY T5 (acd-directive-only-from-admitted-peer): the directive-handling branch sits INSIDE wss.on(\"connection\") (post-admission), never on a pre-upgrade surface (structural)",
    run: async () => {
      const source = await readFile(sourcePath, "utf8");
      const upgradeHandlerStart = source.indexOf('server.on("upgrade"');
      const upgradeHandlerBraceStart = source.indexOf("{", upgradeHandlerStart);
      let depth = 0;
      let upgradeHandlerEnd = upgradeHandlerBraceStart;
      for (let i = upgradeHandlerBraceStart; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        if (source[i] === "}") { depth -= 1; if (depth === 0) { upgradeHandlerEnd = i + 1; break; } }
      }
      const upgradeBody = source.slice(upgradeHandlerBraceStart, upgradeHandlerEnd);
      assert.ok(!/directiveTargets\.set/.test(upgradeBody), "the pre-upgrade admission gate never populates the directive targeting map");

      const connectionBody = findConnectionHandlerBody(source);
      assert.ok(/directiveTargets\.set/.test(connectionBody), "the directive targeting map IS populated inside wss.on(\"connection\") — post-admission");
    },
  },
  {
    name: "arch/35 SECURITY T5 (acd-directive-only-from-admitted-peer): self-check — a planted pre-upgrade directiveTargets.set(...) call trips the structural detector",
    run: async () => {
      const source = await readFile(sourcePath, "utf8");
      const upgradeHandlerStart = source.indexOf('server.on("upgrade"');
      const upgradeHandlerBraceStart = source.indexOf("{", upgradeHandlerStart);

      const planted = `${source.slice(0, upgradeHandlerBraceStart + 1)}\n    directiveTargets.set(origin.nodeId, null); // planted pre-upgrade violation\n${source.slice(upgradeHandlerBraceStart + 1)}`;
      const upgradeHandlerBraceStart2 = planted.indexOf("{", planted.indexOf('server.on("upgrade"'));
      let depth = 0;
      let upgradeHandlerEnd = upgradeHandlerBraceStart2;
      for (let i = upgradeHandlerBraceStart2; i < planted.length; i += 1) {
        if (planted[i] === "{") depth += 1;
        if (planted[i] === "}") { depth -= 1; if (depth === 0) { upgradeHandlerEnd = i + 1; break; } }
      }
      const upgradeBody = planted.slice(upgradeHandlerBraceStart2, upgradeHandlerEnd);
      assert.ok(/directiveTargets\.set/.test(upgradeBody), "the planted pre-upgrade directiveTargets.set(...) trips the detector");
    },
  },
  {
    name: "arch/35 SECURITY T5 (acd-directive-only-from-admitted-peer): unit-level companion — dispatchDirectiveOverTargets only ever routes through the (post-admission-populated) targets map",
    run: async () => {
      const channel = createDirectiveChannelFixture();
      // No connectWorker() call at all — mirroring a connection that was NEVER
      // admitted (the upgrade gate destroyed it, wss.on("connection") never ran).
      const result = dispatchDirectiveOverTargets(channel.targets, buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }), { getMeshRegistry: () => null });
      assert.equal(result.sent, false, "a directive to a never-admitted node is refused");
    },
  },
];
