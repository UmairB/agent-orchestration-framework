// Fitness: control-stream-server's admission binds to the CONNECTION's remote
// address (never a self-declared header) and the server never binds all
// interfaces (milestone 34 / story 04, ADR-007 / 33-ADR-002 "the fabric IS the
// admission boundary"; review fix P1.6).
//
// Driven over the REAL startControlStreamServer with a real loopback ws socket
// (the mesh-relay-broker-fanout.test.mjs in-process precedent) — no header is
// ever presented; admission succeeds ONLY because the connecting socket's
// request.socket.remoteAddress (127.0.0.1) is joined, via the injected
// peersByAddress roster, to a peer nodeId. A second assertion proves the bound
// address is never "0.0.0.0" (all interfaces) when no explicit bindAddress is
// supplied (the safe loopback default).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { startControlStreamServer } from "../../src/control-stream-server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function withGlobalHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-control-stream-address-bound-"));
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

export const archTests = [
  {
    name: "arch/34 ADR-007/P1.6: admission over a REAL loopback socket succeeds via request.socket.remoteAddress joined through peersByAddress — no header is ever presented",
    async run() {
      await withGlobalHome(async ({ env }) => {
        // The peer roster maps the loopback address ITSELF to a nodeId — proving
        // the DEFAULT resolver reads the connection's remoteAddress (127.0.0.1),
        // not any header (the client below presents no x-aof-node-id header at all).
        const server = await startControlStreamServer({
          peerNodeIds: ["worker-a"],
          peersByAddress: [{ nodeId: "worker-a", dialAddress: "127.0.0.1" }],
          storeOptions: { env },
        });
        try {
          const port = server.server.address().port;
          const ws = new WebSocket(`ws://127.0.0.1:${port}/`); // NO x-aof-node-id header
          const outcome = await waitForOpenOrClose(ws);
          assert.equal(outcome.opened, true, "the connection is admitted purely from its remote address, joined via peersByAddress");
          try { ws.close(); } catch { /* already closing */ }
        } finally {
          server.stop();
        }
      });
    },
  },
  {
    name: "arch/34 ADR-007/P1.6: a remote address NOT in the peersByAddress roster is refused, even though the roster admits a DIFFERENT peer",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const server = await startControlStreamServer({
          peerNodeIds: ["worker-a"],
          // The roster maps a DIFFERENT (non-loopback) address to worker-a — so a
          // real loopback dial resolves to nodeId:null (fail-closed), even though
          // "worker-a" IS in peerNodeIds; the join, not the roster alone, is the gate.
          peersByAddress: [{ nodeId: "worker-a", dialAddress: "100.90.249.80" }],
          storeOptions: { env },
        });
        try {
          const port = server.server.address().port;
          const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
          const outcome = await waitForOpenOrClose(ws);
          assert.equal(outcome.opened, false, "an unmapped remote address is refused even when its (absent) identity would otherwise be a listed peer");
        } finally {
          server.stop();
        }
      });
    },
  },
  {
    name: "arch/34 ADR-007/P1.6: the server never binds all interfaces (0.0.0.0) when no explicit bindAddress is supplied — the default is loopback",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const server = await startControlStreamServer({ peerNodeIds: [], storeOptions: { env } });
        try {
          const address = server.server.address();
          assert.notEqual(address.address, "0.0.0.0", "the server does not bind all interfaces by default");
          assert.equal(address.address, "127.0.0.1", "the default bind address is loopback");
        } finally {
          server.stop();
        }
      });
    },
  },
  {
    name: "arch/34 ADR-007/P1.6: a caller-supplied bindAddress (the fabric-resolved self-address) is honoured, still never 0.0.0.0",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const server = await startControlStreamServer({ peerNodeIds: [], bindAddress: "127.0.0.1", storeOptions: { env } });
        try {
          const address = server.server.address();
          assert.equal(address.address, "127.0.0.1");
          assert.notEqual(address.address, "0.0.0.0");
        } finally {
          server.stop();
        }
      });
    },
  },
  {
    name: "arch/34 ADR-007/P1.6 (structural): startControlStreamServer never passes \"0.0.0.0\" as a literal bind address in LIVE code, and defaultResolveOrigin reads request.socket.remoteAddress",
    async run() {
      const raw = await readFile(path.join(repoRoot, "src", "control-stream-server.mjs"), "utf8");
      // Strip // line comments first (the docstrings legitimately DISCUSS "0.0.0.0"
      // in prose — a naive .includes() on raw source would false-positive there).
      const codeOnly = raw.replace(/\/\/[^\n]*/g, "");
      assert.ok(!codeOnly.includes('"0.0.0.0"'), "no literal 0.0.0.0 bind address in LIVE code");
      assert.ok(raw.includes("request?.socket?.remoteAddress") || raw.includes("request.socket.remoteAddress"), "admission resolves identity from the CONNECTION's remote address");
      assert.ok(!/x-aof-node-id/.test(raw), "the spoofable self-declared header is no longer the admission signal");
    },
  },
];
