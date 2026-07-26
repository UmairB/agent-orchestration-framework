// Traceability wiring for milestone 38 / story 00
// tasks/02_presence-additive-sessions.feature — "the presence record gains an
// additive `sessions` key without breaking the frozen m23 byte-equivalence".
//
// Every @executable scenario / Scenario Outline row is asserted against the real
// src/mesh-presence.mjs `assemblePresenceRecord` assembler — a pure function, no
// fs/fixture needed. node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assemblePresenceRecord, readLiveSessions } from "../src/mesh-presence.mjs";
import { startSession } from "../src/mesh-session.mjs";
import { loadWorkspace } from "../src/work.mjs";

const FROZEN_FIVE = ["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion"];
const NODE_ID = "node-a";
const NOW = "2026-07-10T12:00:00.000Z";

async function makeFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-presence-additive-sessions-"));
  const root = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  await mkdir(path.join(root, "wiki", "work"), { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID } };
  await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const env = { AOF_GLOBAL_HOME: home };
  const ws = await loadWorkspace(root, undefined, { env });
  return { tmp, root, home, env, ws };
}

function m23Projection(record) {
  return JSON.stringify({ nodeId: record.nodeId, heartbeatAt: record.heartbeatAt, activeRuns: record.activeRuns, aofVersion: record.aofVersion });
}

export const meshPresenceAdditiveSessionsTests = [
  // ══ Scenario: a node with no live session emits sessions:[] and its first four keys are byte-identical to m23 ══
  {
    name: "mesh-presence-additive-sessions/02 a node with no live session emits sessions:[] and its first four keys are byte-identical to m23",
    async run() {
      const inputs = { nodeId: "node-a", heartbeatAt: "2026-07-10T12:00:00.000Z", activeRuns: ["run-1"], aofVersion: "1.2.3" };
      const record = assemblePresenceRecord(inputs);
      assert.deepEqual(Object.keys(record), FROZEN_FIVE, "keys are exactly the frozen five, in order");
      assert.deepEqual(record.sessions, [], "sessions is the empty array");
      assert.equal(m23Projection(record), JSON.stringify(inputs), "nodeId/heartbeatAt/activeRuns/aofVersion are byte-identical to the m23 four-key record");
    },
  },

  // ══ Scenario: a live session projects into the sessions array as { workspaceId, repo, assistant, lastPingAt } ══
  {
    name: "mesh-presence-additive-sessions/02 a live session projects into the sessions array as { workspaceId, repo, assistant, lastPingAt }",
    async run() {
      const session = { workspaceId: "ws-1", repo: "my-repo", assistant: "claude-code", lastPingAt: "2026-07-10T12:00:00.000Z" };
      const record = assemblePresenceRecord({ nodeId: "node-a", heartbeatAt: "2026-07-10T12:00:00.000Z", activeRuns: [], sessions: [session], aofVersion: "1.2.3" });
      assert.equal(record.sessions.length, 1, "sessions has exactly one entry");
      assert.deepEqual(Object.keys(record.sessions[0]), ["workspaceId", "repo", "assistant", "lastPingAt"], "entry keys are exactly the four, in order");
      assert.deepEqual(record.sessions[0], session, "the entry matches the live session record");
    },
  },

  // ══ Scenario Outline: the sessions array is the projection of the LIVE session records only, key-order held ══
  //
  // REVIEW FIX (F2): the FIRST version of this test fed pre-filtered arrays
  // directly to assemblePresenceRecord (which performs ZERO TTL filtering itself —
  // it is a pure key-shape assembler). This drives the REAL readLiveSessions
  // (src/mesh-presence.mjs) — the function that ACTUALLY applies the TTL — against
  // real seeded session records with an injected `now`/`ttlSeconds`, so an
  // EXPIRED record's absence from the projected array is a genuine, non-vacuous
  // proof. Restores all 7 Scenario Outline rows from the .feature (including the
  // two dropped ws-2-EXPIRED-only rows and the two-assistants row).
  {
    name: "mesh-presence-additive-sessions/02 the sessions array is the projection of the LIVE session records only, key-order held (Examples)",
    async run() {
      const ttlSeconds = 120;
      // "live" = started/pinged AT now (age 0s, well within TTL); "expired" =
      // pinged far enough in the past to be strictly past the TTL window.
      const liveNow = NOW;
      const expiredAt = "2026-07-10T00:00:00.000Z"; // 12h before NOW — well past 120s TTL

      const rows = [
        { seeds: [], liveWorkspaces: [] },
        { seeds: [{ workspaceId: "ws-1", assistant: "claude-code", at: liveNow }], liveWorkspaces: ["ws-1"] },
        { seeds: [{ workspaceId: "ws-1", assistant: "claude-code", at: liveNow }, { workspaceId: "ws-2", assistant: "claude-code", at: liveNow }], liveWorkspaces: ["ws-1", "ws-2"] },
        // two assistants, one workspace each still live — both surface.
        { seeds: [{ workspaceId: "ws-1", assistant: "claude-code", at: liveNow }, { workspaceId: "ws-2", assistant: "cursor", at: liveNow }], liveWorkspaces: ["ws-1", "ws-2"] },
        // ws-1 live, ws-2 EXPIRED → only ws-1 survives.
        { seeds: [{ workspaceId: "ws-1", assistant: "claude-code", at: liveNow }, { workspaceId: "ws-2", assistant: "claude-code", at: expiredAt }], liveWorkspaces: ["ws-1"] },
        // ws-1 EXPIRED alone → none survive.
        { seeds: [{ workspaceId: "ws-1", assistant: "claude-code", at: expiredAt }], liveWorkspaces: [] },
        // ws-1 EXPIRED, ws-2 EXPIRED → none survive.
        { seeds: [{ workspaceId: "ws-1", assistant: "claude-code", at: expiredAt }, { workspaceId: "ws-2", assistant: "claude-code", at: expiredAt }], liveWorkspaces: [] },
      ];
      for (const row of rows) {
        const fixture = await makeFixture();
        try {
          for (const seed of row.seeds) {
            await startSession(fixture.ws, { nodeId: NODE_ID, workspaceId: seed.workspaceId, repo: `repo-${seed.workspaceId}`, assistant: seed.assistant, now: seed.at });
          }
          const live = await readLiveSessions(fixture.ws, NODE_ID, { now: NOW, ttlSeconds });
          assert.equal(live.length, row.liveWorkspaces.length, `sessions has exactly ${row.liveWorkspaces.length} entries for seeds ${JSON.stringify(row.seeds)}`);
          assert.deepEqual(live.map((s) => s.workspaceId).sort(), [...row.liveWorkspaces].sort(), "sessions contains exactly the live workspaces");
          for (const entry of live) {
            assert.deepEqual(Object.keys(entry), ["workspaceId", "repo", "assistant", "lastPingAt"], "each projected entry carries exactly the four keys, in order");
          }

          const record = assemblePresenceRecord({ nodeId: NODE_ID, heartbeatAt: NOW, activeRuns: [], sessions: live, aofVersion: "1.2.3" });
          assert.deepEqual(Object.keys(record), FROZEN_FIVE, "the five-key order is unchanged");
          const isByteEquivalent = row.liveWorkspaces.length === 0;
          assert.equal(record.sessions.length === 0, isByteEquivalent, "sessions is [] iff the byte-equivalent case");
        } finally {
          await rm(fixture.tmp, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: the record is rebuildable — same clock + run records + session records yield a content-equivalent record ══
  {
    name: "mesh-presence-additive-sessions/02 the record is rebuildable — same clock + run records + session records yield a content-equivalent record",
    async run() {
      const inputs = { nodeId: "node-a", heartbeatAt: "2026-07-10T12:00:00.000Z", activeRuns: ["run-1"], sessions: [{ workspaceId: "ws-1", repo: "my-repo", assistant: "claude-code", lastPingAt: "2026-07-10T12:00:00.000Z" }], aofVersion: "1.2.3" };
      const first = assemblePresenceRecord(inputs);
      const second = assemblePresenceRecord(inputs);
      assert.deepEqual(second, first, "the two records are content-equivalent (same five keys, same order, same values)");
    },
  },
];
