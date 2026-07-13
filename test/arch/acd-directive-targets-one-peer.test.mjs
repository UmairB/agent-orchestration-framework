// Fitness function: acd-directive-targets-one-peer (milestone 35 / ADR-002, fitness
// #5) — "A node-targeted directive is sent to a SINGLE connected peer socket, never
// broadcast."
//
// Proofs:
//  1. Structural — over control-stream-server.mjs, assert the directive send
//     resolves ONE socket from the nodeId -> ws targeting map (a `.get(nodeId)` /
//     map lookup) and that no directive send iterates `wss.clients` / a "send to
//     all" fan-out branch; sendDirective has no broadcast branch.
//  2. Behavioural — with a two-worker registry, sendDirective("worker-a", …) writes
//     to worker-a's socket only, worker-b's socket receives nothing.
//  3. Self-check (m03 non-vacuous planted-violation) — a planted
//     `for (const c of wss.clients) c.send(directive)` fails the no-fan-out
//     assertion the real (clean) source passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendDirective, buildDirectiveFrame } from "../../src/control-stream-server.mjs";
import { createDirectiveChannelFixture } from "../support/mesh-directive-channel-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");

// detectFanOut(source) — a directive send site iterating wss.clients (or any
// "clients" collection) with a .send(...) call inside the loop body is the
// forbidden broadcast shape. A targeted single-socket resolve (`targets.get(...)`)
// never matches this.
function detectFanOut(source) {
  const stripped = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const fanOutRe = /for\s*\(\s*const\s+\w+\s+of\s+[\w.]*[Cc]lients[^)]*\)\s*\{[\s\S]{0,200}?\.send\s*\(/;
  return fanOutRe.test(stripped);
}

function usesTargetedLookup(source) {
  const stripped = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // sendDirective must resolve via targets.get(nodeId) — a keyed single-entry lookup.
  const fn = stripped.match(/export function sendDirective\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "sendDirective is defined");
  return /targets\.get\(\s*nodeId\s*\)/.test(fn[0]);
}

export const archTests = [
  {
    name: "arch/35 ADR-002 (acd-directive-targets-one-peer): sendDirective resolves ONE socket via a targeting-map .get(nodeId) lookup, never a wss.clients fan-out (structural)",
    run: async () => {
      const source = await readFile(sourcePath, "utf8");
      assert.equal(detectFanOut(source), false, "no `for (const c of wss.clients) c.send(...)` broadcast branch exists");
      assert.ok(usesTargetedLookup(source), "sendDirective resolves exactly one socket via targets.get(nodeId)");
    },
  },
  {
    name: "arch/35 ADR-002 (acd-directive-targets-one-peer): with a two-worker registry, sendDirective writes to the addressed socket only (behavioural)",
    run: async () => {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const workerB = channel.connectWorker("worker-b");
      const result = sendDirective(channel.targets, "worker-a", buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: "2026-07-09T10:00:00.000Z" }));
      assert.equal(result.sent, true);
      assert.equal(workerA.frames.length, 1, "the addressed socket receives exactly one frame");
      assert.equal(workerB.frames.length, 0, "every other socket receives nothing");
    },
  },
  {
    name: "arch/35 ADR-002 (acd-directive-targets-one-peer): self-check — a planted wss.clients fan-out trips the SAME detector the real (clean) source passes",
    run: async () => {
      const source = await readFile(sourcePath, "utf8");
      assert.equal(detectFanOut(source), false, "the real source is clean");

      const plantedFanOut = `${source}\nfunction broadcastDirective(wss, directive) {\n  for (const client of wss.clients) {\n    client.send(JSON.stringify(directive));\n  }\n}\n`;
      assert.equal(detectFanOut(plantedFanOut), true, "a planted wss.clients fan-out trips the detector");
    },
  },
];
