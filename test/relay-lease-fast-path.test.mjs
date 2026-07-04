// Traceability wiring for milestone 26 / story 02 — the lease intent on the relay's
// second wire kind (tasks/02_relay-fast-path-defer.feature, ADR-004.1).
//
// milestone 33 / story 01 (ADR-002.1 — F-3204): the RECEIVE-side rows this file used to
// cover (the persistent relay subscriber applying { kind:"lease" } frames into an
// in-memory lease cache, overlaid into work:next's buildLeaseView hint slot) are RETIRED
// — src/mesh-presence-subscriber.mjs + src/mesh-presence-cache.mjs (createLeaseCache) are
// DELETED with the broker's liveness path; the fabric peer-map is the liveness plane now
// (git stays the durable authority for lease arbitration, ADR-004.3 — acd-lease-
// arbitration-git-observed already asserts the resolver imports NEITHER module, so the
// arbitration invariant is untouched by this retirement — see superseded by 33/ADR-002 —
// the broker is eliminated). Only the SEND-side row survives here: work:run-start still
// pushes the lease intent over the (unrelated, retained) mesh-relay-client.mjs push seam
// used by the claim path — that push mechanism is NOT part of the retired liveness path
// (acd-claim-relay-independent covers it separately) and this row proves the wire shape.
//
//   02_relay-fast-path-defer.feature — the frozen { kind:"lease", nodeId, signal }
//     envelope, the claim record verbatim as the opaque signal, pushed on the claim path.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { aofVersion } from "../src/commands/mesh-identity.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
const NODE_ID = "node-a";

function frontmatter(fields) {
  const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\n${body}\n---\n`;
}

// A two-story work repo (the work-next fixture shape) whose config pins mesh.nodeId —
// NON-git by design: zero git traffic is possible, so the acquire holds via the
// non-repo degraded sync no-op.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-lease-fastpath-"));
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "00_milestone_m0");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "00", slug: "m0", status: "in-progress", created: "2026-07-01", updated: "2026-07-01" }),
    "utf8"
  );
  for (const s of [{ number: "00", slug: "story-a" }, { number: "01", slug: "story-b" }]) {
    const sDir = path.join(mDir, "stories", `${s.number}_story_${s.slug}`);
    await mkdir(sDir, { recursive: true });
    await writeFile(
      path.join(sDir, "STORY.md"),
      frontmatter({ type: "story", number: s.number, slug: s.slug, status: "not-started", created: "2026-07-01", updated: "2026-07-01", parent: "00" }),
      "utf8"
    );
  }
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: { nodeId: NODE_ID, presence: { stalenessSeconds: 60 }, relay: { url: "ws://127.0.0.1:7799/ws/relay" } },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const workspace = await loadWorkspace(repo);
  return { repo, workDir, workspace };
}

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

export const relayLeaseFastPathTests = [
  // ══ Scenario: the pushed lease intent rides the frozen envelope with the claim
  //    record as the opaque signal ══
  {
    name: "relay-lease-fastpath/02 the pushed lease intent is EXACTLY { kind:'lease', nodeId, signal } with this node's claim record as the opaque signal, byte-for-byte",
    async run() {
      const fx = await makeRepo();
      try {
        const pushed = [];
        const relayClient = {
          async connect() {
            return { close() {} };
          },
          async push(envelope) {
            pushed.push(envelope);
          },
        };
        // This node claims a ready item; its lease intent is pushed on the claim path.
        // (The non-git fixture syncs as the degraded no-op — the acquire holds.)
        await invoke("work:run-start", { ref: "00/00", now: NOW }, { workspace: fx.workspace, relayClient });

        assert.equal(pushed.length, 1, "exactly one envelope was pushed carrying the intent");
        const envelope = pushed[0];
        assert.deepEqual(Object.keys(envelope), ["kind", "nodeId", "signal"], "the envelope is EXACTLY { kind, nodeId, signal }");
        assert.equal(envelope.kind, "lease", "the envelope carries kind lease");
        assert.equal(envelope.nodeId, NODE_ID, "the envelope carries this node's nodeId");
        // The opaque signal is this node's claim record for the item, byte-for-byte
        // (as it stood at push time — runId null, tied after the mint).
        const expected = { itemRef: "00/00", nodeId: NODE_ID, state: "claimed", claimedAt: NOW, runId: null, aofVersion: aofVersion() };
        assert.equal(JSON.stringify(envelope.signal), JSON.stringify(expected), "the signal is the claim record, byte-for-byte");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },
];
