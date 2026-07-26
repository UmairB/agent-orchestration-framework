import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Strip // line comments (doc-comments legitimately DISCUSS resolvePeers/mesh-fabric
// without calling them — a naive `.includes()` on raw source would false-positive on
// prose) so the structural check reads only LIVE code.
function stripLineComments(source) {
  return source.replace(/\/\/[^\n]*/g, "");
}

// The stream target (the control node's dial address) must be resolved via
// mesh-fabric.mjs's resolvePeers — never a committed/hand-derived URL literal
// (milestone 34 / story 04, ADR-007, preserving 33's "addresses come from the
// fabric" invariant). worker-stream-client.mjs and control-stream-server.mjs hold NO
// fabric-resolution logic of their own (they are transport/session modules — they
// only carry frames / consume an ALREADY-resolved roster); mesh-launcher.mjs is the
// ONE caller that resolves peers and hands the resolved dialAddress / peerNodeIds in.
export const archTests = [
  {
    name: "arch/34 ADR-007: the worker stream client never hand-derives a dial URL or calls resolvePeers itself",
    async run() {
      const source = stripLineComments(await readFile(path.join(repoRoot, "src", "worker-stream-client.mjs"), "utf8"));
      // No ws:// or wss:// URL LITERAL is embedded in the client module — the only
      // permissible "url" is a caller-supplied parameter (createWorkerWsTransport's
      // `url` argument), never a hard-coded scheme+host string.
      assert.ok(!/wss?:\/\/[a-zA-Z0-9]/.test(source), "no hand-derived ws(s):// URL literal in worker-stream-client.mjs");
      assert.ok(!/\bresolvePeers\s*\(/.test(source), "worker-stream-client.mjs does not itself CALL resolvePeers — the caller resolves the address");
      assert.ok(!/from\s+["']\.\/mesh-fabric\.mjs["']/.test(source), "worker-stream-client.mjs does not import mesh-fabric.mjs directly");
    },
  },
  {
    name: "arch/34 ADR-007: mesh-launcher resolves the stream target through mesh-fabric.resolvePeers, not a literal",
    async run() {
      const rawSource = await readFile(path.join(repoRoot, "src", "mesh-launcher.mjs"), "utf8");
      const source = stripLineComments(rawSource);
      assert.ok(rawSource.includes("mesh-fabric.mjs"), "mesh-launcher.mjs imports the ONE fabric seam");
      assert.ok(/\bresolvePeers\s*\(/.test(source), "mesh-launcher.mjs resolves peers via mesh-fabric's resolvePeers");
      assert.ok(!/wss?:\/\/[a-zA-Z0-9]/.test(source), "no hand-derived ws(s):// URL literal in mesh-launcher.mjs");
    },
  },
  {
    name: "arch/34 ADR-007: the control-stream server never hand-derives a peer address, it consumes the resolved roster",
    async run() {
      const source = stripLineComments(await readFile(path.join(repoRoot, "src", "control-stream-server.mjs"), "utf8"));
      assert.ok(!/wss?:\/\/[a-zA-Z0-9]/.test(source), "no hand-derived ws(s):// URL literal in control-stream-server.mjs");
      assert.ok(!/\bresolvePeers\s*\(/.test(source), "control-stream-server.mjs does not itself CALL resolvePeers — it is handed a peerNodeIds roster");
      assert.ok(!/from\s+["']\.\/mesh-fabric\.mjs["']/.test(source), "control-stream-server.mjs does not import mesh-fabric.mjs directly");
    },
  },
];
