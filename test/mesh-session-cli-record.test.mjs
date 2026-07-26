// Traceability wiring for milestone 38 / story 00
// tasks/00_session-cli-record.feature — "`aof session start|ping|end` are the sole
// producers of a per-(node, workspace, assistant) session record".
//
// Every @executable scenario (and every Scenario Outline Examples row) below is
// asserted against the REAL CLI face (src/commands/mesh-session.mjs's
// meshSessionCommand) over a hermetic fixture repo + a fixture AOF_GLOBAL_HOME (no
// real machine state touched) — real fs, in-process. One test object per scenario,
// each name tracing to feature + scenario. node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { meshSessionCommand } from "../src/commands/mesh-session.mjs";
import { readSessionRecord, readSessionRecordsForNode } from "../src/mesh-session.mjs";
import { loadWorkspace } from "../src/work.mjs";

const NODE_ID = "node-a";

async function makeFixture() {
  const root = await mktempRepo();
  const home = path.join(root, ".global-home");
  const env = { AOF_GLOBAL_HOME: home };
  return { root, home, env };
}

async function mktempRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-session-cli-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID } };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repo;
}

// A ctx that pins cwd/env/nodeId so the CLI face never touches real machine state,
// and supplies a stdin/now the test controls deterministically.
function ctxFor(fixture, { stdinText = "", now } = {}) {
  return {
    cwd: fixture.root,
    env: fixture.env,
    nodeId: NODE_ID,
    stdinText,
    now: typeof now === "string" ? () => now : now,
    loadWorkspace: (cwd, config) => loadWorkspace(cwd, config, { env: fixture.env }),
  };
}

async function wsFor(fixture) {
  return loadWorkspace(fixture.root, undefined, { env: fixture.env });
}

export const meshSessionCliRecordTests = [
  // ══ Scenario: `aof session start` writes a session record with the frozen shape ══
  {
    name: "mesh-session-cli-record/00 `aof session start` writes a session record with the frozen shape",
    async run() {
      const fixture = await makeFixture();
      try {
        await meshSessionCommand(["start", "--workspace", "ws-1", "--repo", "my-repo", "--assistant", "claude-code"], ctxFor(fixture, { now: "2026-07-10T12:00:00.000Z" }));
        const ws = await wsFor(fixture);
        const record = await readSessionRecord(ws, NODE_ID, "ws-1", "claude-code");
        assert.ok(record, "a session record exists for (node-a, ws-1, claude-code)");
        assert.deepEqual(Object.keys(record), ["nodeId", "workspaceId", "repo", "assistant", "startedAt", "lastPingAt"], "keys are exactly the frozen six, in order");
        assert.equal(record.startedAt, record.lastPingAt, "startedAt equals lastPingAt on a fresh start");
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: `aof session ping` refreshes lastPingAt and upserts an unstarted session ══
  {
    name: "mesh-session-cli-record/00 `aof session ping` refreshes lastPingAt and upserts an unstarted session",
    async run() {
      const fixture = await makeFixture();
      try {
        const ws = await wsFor(fixture);
        assert.equal(await readSessionRecord(ws, NODE_ID, "ws-1", "claude-code"), null, "no prior session record");

        await meshSessionCommand(["ping", "--workspace", "ws-1", "--repo", "my-repo", "--assistant", "claude-code"], ctxFor(fixture, { now: "2026-07-10T12:00:00.000Z" }));
        let record = await readSessionRecord(ws, NODE_ID, "ws-1", "claude-code");
        assert.ok(record, "ping upserts a fresh session record with no prior start");
        assert.equal(record.lastPingAt, "2026-07-10T12:00:00.000Z");
        assert.equal(record.startedAt, record.lastPingAt, "startedAt equals lastPingAt on first ping");

        await meshSessionCommand(["ping", "--workspace", "ws-1", "--repo", "my-repo", "--assistant", "claude-code"], ctxFor(fixture, { now: "2026-07-10T12:00:30.000Z" }));
        record = await readSessionRecord(ws, NODE_ID, "ws-1", "claude-code");
        assert.equal(record.lastPingAt, "2026-07-10T12:00:30.000Z", "the same record's lastPingAt is refreshed");
        assert.equal(record.startedAt, "2026-07-10T12:00:00.000Z", "startedAt is unchanged");

        const all = await readSessionRecordsForNode(ws, NODE_ID);
        assert.equal(all.length, 1, "exactly one record exists for that tuple — ping upserts in place, never a duplicate");
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: `aof session end` deletes the record ══
  {
    name: "mesh-session-cli-record/00 `aof session end` deletes the record",
    async run() {
      const fixture = await makeFixture();
      try {
        await meshSessionCommand(["start", "--workspace", "ws-1", "--repo", "my-repo", "--assistant", "claude-code"], ctxFor(fixture, { now: "2026-07-10T12:00:00.000Z" }));
        const ws = await wsFor(fixture);
        assert.ok(await readSessionRecord(ws, NODE_ID, "ws-1", "claude-code"), "the record exists before end");

        await meshSessionCommand(["end", "--workspace", "ws-1", "--assistant", "claude-code"], ctxFor(fixture));
        assert.equal(await readSessionRecord(ws, NODE_ID, "ws-1", "claude-code"), null, "no session record exists after end");
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: `aof session end` on a nonexistent session is benign — a no-op success ══
  {
    name: "mesh-session-cli-record/00 `aof session end` on a nonexistent session is benign — a no-op success, never an error",
    async run() {
      const fixture = await makeFixture();
      try {
        const ws = await wsFor(fixture);
        assert.equal(await readSessionRecord(ws, NODE_ID, "ws-9", "claude-code"), null, "no session record exists for the tuple");

        const originalExitCode = process.exitCode;
        process.exitCode = undefined;
        await meshSessionCommand(["end", "--workspace", "ws-9", "--assistant", "claude-code"], ctxFor(fixture));
        assert.notEqual(process.exitCode, 1, "the command does not set a failing exit code");
        process.exitCode = originalExitCode;

        assert.equal(await readSessionRecord(ws, NODE_ID, "ws-9", "claude-code"), null, "still no session record afterward");
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: the (node, workspace, assistant) tuple is the key ══
  {
    name: "mesh-session-cli-record/00 the (node, workspace, assistant) tuple is the key — distinct tuples are distinct records (Examples)",
    async run() {
      const rows = [
        { tupleA: ["ws-1", "claude-code"], tupleB: ["ws-1", "claude-code"], records: 1 },
        { tupleA: ["ws-1", "claude-code"], tupleB: ["ws-1", "cursor"], records: 2 },
        { tupleA: ["ws-1", "claude-code"], tupleB: ["ws-2", "claude-code"], records: 2 },
        { tupleA: ["ws-1", "claude-code"], tupleB: ["ws-2", "cursor"], records: 2 },
      ];
      for (const row of rows) {
        const fixture = await makeFixture();
        try {
          const ws = await wsFor(fixture);
          const [wsA, asA] = row.tupleA;
          const [wsB, asB] = row.tupleB;
          await meshSessionCommand(["start", "--workspace", wsA, "--repo", "repo-a", "--assistant", asA], ctxFor(fixture, { now: "2026-07-10T12:00:00.000Z" }));
          await meshSessionCommand(["start", "--workspace", wsB, "--repo", "repo-b", "--assistant", asB], ctxFor(fixture, { now: "2026-07-10T12:00:00.000Z" }));

          const all = await readSessionRecordsForNode(ws, NODE_ID);
          assert.equal(all.length, row.records, `distinct session records for tuples ${JSON.stringify(row.tupleA)} / ${JSON.stringify(row.tupleB)}`);

          await meshSessionCommand(["end", "--workspace", wsA, "--assistant", asA], ctxFor(fixture));
          const bRecord = await readSessionRecord(ws, NODE_ID, wsB, asB);
          // NB (flagged deviation, developer note — not a silent .feature edit): when
          // tuple-a === tuple-b (this outline's FIRST row), "ending tuple-a leaves
          // tuple-b intact" is unsatisfiable as literally written — they are the SAME
          // (node, workspace, assistant) key, so ending tuple-a necessarily deletes
          // the one record both tuples name. That row's real, satisfiable claim is
          // "starting the SAME tuple twice still yields exactly ONE record" (already
          // asserted above via `records`); the "leaves tuple-b intact" step is
          // meaningful only for the outline's DISTINCT-tuple rows (2-4). Reported to
          // the PO/orchestrator as a Scenario Outline contract wrinkle in row 1.
          const tuplesAreIdentical = wsA === wsB && asA === asB;
          if (tuplesAreIdentical) {
            assert.equal(bRecord, null, "tuple-a === tuple-b: ending the ONE shared record removes it — 'intact' does not apply to this degenerate row");
          } else {
            assert.ok(bRecord, "ending tuple-a leaves tuple-b intact");
          }
        } finally {
          await rm(fixture.root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: a missing or blank required argument is a LOUD coded refusal ══
  {
    name: "mesh-session-cli-record/00 a missing or blank required argument is a LOUD coded refusal — never a silent partial write (Examples)",
    async run() {
      const rows = [
        { verb: "start", args: ["--repo", "my-repo", "--assistant", "claude-code"], code: "session-arg-missing-workspace" },
        { verb: "start", args: ["--workspace", "   ", "--repo", "my-repo", "--assistant", "claude-code"], code: "session-arg-missing-workspace" },
        { verb: "start", args: ["--workspace", "ws-1", "--assistant", "claude-code"], code: "session-arg-missing-repo" },
        { verb: "start", args: ["--workspace", "ws-1", "--repo", "my-repo"], code: "session-arg-missing-assistant" },
        { verb: "start", args: ["--workspace", "ws-1", "--repo", "my-repo", "--assistant", ""], code: "session-arg-missing-assistant" },
        { verb: "ping", args: ["--repo", "my-repo", "--assistant", "claude-code"], code: "session-arg-missing-workspace" },
        { verb: "ping", args: ["--workspace", "ws-1", "--repo", "my-repo"], code: "session-arg-missing-assistant" },
        { verb: "end", args: ["--assistant", "claude-code"], code: "session-arg-missing-workspace" },
        { verb: "end", args: ["--workspace", "ws-1"], code: "session-arg-missing-assistant" },
      ];
      for (const row of rows) {
        const fixture = await makeFixture();
        try {
          const ws = await wsFor(fixture);
          const originalExitCode = process.exitCode;
          process.exitCode = undefined;
          const logs = [];
          const originalLog = console.log;
          console.log = (msg) => logs.push(msg);
          try {
            await meshSessionCommand([row.verb, ...row.args, "--json"], ctxFor(fixture));
          } finally {
            console.log = originalLog;
          }
          assert.equal(process.exitCode, 1, `${row.verb} ${JSON.stringify(row.args)} exits non-zero`);
          process.exitCode = originalExitCode;

          const envelope = JSON.parse(logs[logs.length - 1]);
          assert.equal(envelope.ok, false, "the envelope reports failure");
          assert.equal(envelope.code, row.code, `${row.verb} ${JSON.stringify(row.args)} exits with code "${row.code}"`);

          const all = await readSessionRecordsForNode(ws, NODE_ID);
          assert.equal(all.length, 0, "no session record is written");
        } finally {
          await rm(fixture.root, { recursive: true, force: true });
        }
      }
    },
  },
];
