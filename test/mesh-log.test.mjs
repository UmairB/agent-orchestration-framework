// m42 wave (a) / TECH_DEBT item 2 — the daemons' durable log sink. Pins:
//   - one JSONL line per event under <meshRoot>/logs/<proc>.log (AOF_GLOBAL_HOME)
//   - size rotation keeps exactly one previous generation (bounded disk)
//   - the reader tails across the rotation boundary and surfaces torn lines as
//     { raw } instead of dropping them (no silent loss in the forensics tool)
//   - a sink write never throws (the daemon must never crash for its log)
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMeshLogSink, readMeshLog, meshLogPath } from "../src/mesh-log.mjs";
import { invoke } from "../src/command-core.mjs";

async function withHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-log-"));
  try {
    return await fn({ env: { AOF_GLOBAL_HOME: home } });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export const meshLogTests = [
  {
    name: "mesh-log/item-2 events append as JSONL under <meshRoot>/logs/<proc>.log and read back in order",
    async run() {
      await withHome(async ({ env }) => {
        const sink = createMeshLogSink("mesh-serve", { env, now: () => "2026-07-26T15:00:00.000Z" });
        sink.write({ level: "info", code: "daemon-started", message: "up" });
        sink.write({ level: "warn", code: "frame-skipped", message: "unknown-workspace", path: null });

        const { entries, path: logPath } = readMeshLog("mesh-serve", { env });
        assert.equal(logPath, meshLogPath("mesh-serve", { env }));
        assert.equal(entries.length, 2);
        assert.deepEqual(entries[0], { at: "2026-07-26T15:00:00.000Z", proc: "mesh-serve", level: "info", code: "daemon-started", message: "up" });
        assert.equal(entries[1].code, "frame-skipped", "events read back in write order");
      });
    },
  },
  {
    name: "mesh-log/item-2 rotation keeps one previous generation and the reader tails across the boundary",
    async run() {
      await withHome(async ({ env }) => {
        const sink = createMeshLogSink("mesh-serve", { env, maxBytes: 220 });
        for (let i = 0; i < 6; i += 1) sink.write({ level: "info", code: `event-${i}`, message: "x".repeat(40) });

        const logPath = meshLogPath("mesh-serve", { env });
        assert.ok(existsSync(`${logPath}.1`), "the previous generation exists after rotation");
        const all = readMeshLog("mesh-serve", { env });
        const codes = all.entries.map((e) => e.code);
        assert.ok(codes.includes("event-5"), "the newest event is present");
        assert.ok(codes.length >= 2, "the tail spans the rotation boundary (both generations read)");
        const tailed = readMeshLog("mesh-serve", { env, tail: 1 });
        assert.deepEqual(tailed.entries.map((e) => e.code), ["event-5"], "tail returns the newest N only");
      });
    },
  },
  {
    name: "mesh-log/item-2 a torn line surfaces as { raw } and an absent log reads empty — never a throw",
    async run() {
      await withHome(async ({ env }) => {
        assert.deepEqual(readMeshLog("mesh-ui", { env }).entries, [], "an absent log reads as empty, not an error");
        const sink = createMeshLogSink("mesh-ui", { env });
        sink.write({ level: "info", code: "ok", message: "fine" });
        await writeFile(meshLogPath("mesh-ui", { env }), `${JSON.stringify({ at: "t", proc: "mesh-ui", code: "ok" })}\n{ torn`, "utf8");
        const { entries } = readMeshLog("mesh-ui", { env });
        assert.equal(entries.length, 2);
        assert.deepEqual(entries[1], { raw: "{ torn" }, "a torn line is surfaced, never silently dropped");
      });
    },
  },
  {
    name: "mesh-log/item-2 the mesh:logs command reads the sink (proc default, tail knob, invalid-proc refusal)",
    async run() {
      await withHome(async ({ env }) => {
        const sink = createMeshLogSink("mesh-serve", { env });
        sink.write({ level: "warn", code: "frame-skipped", message: "unknown-workspace" });
        const ctx = { workspace: { projectRoot: "/x", workDir: "/x", config: {} }, globalWorkStoreOptions: { env } };

        const result = await invoke("mesh:logs", {}, ctx);
        assert.equal(result.ok, true);
        assert.equal(result.proc, "mesh-serve", "proc defaults to mesh-serve");
        assert.equal(result.count, 1);
        assert.equal(result.entries[0].code, "frame-skipped");

        const tailed = await invoke("mesh:logs", { proc: "mesh-serve", tail: 1 }, ctx);
        assert.equal(tailed.entries.length, 1);

        const empty = await invoke("mesh:logs", { proc: "mesh-ui" }, ctx);
        assert.deepEqual(empty.entries, [], "an absent log is absent-not-error");

        await assert.rejects(
          invoke("mesh:logs", { proc: "not-a-daemon" }, ctx),
          (error) => error.code === "invalid-proc" && error.status === 400,
          "an unknown proc is an input-contract refusal naming the valid set",
        );
      });
    },
  },
  {
    // m42 / item 2's REMOTE read — a worker's log events ride its stream into the
    // control's node_logs ring; `mesh:logs --node` answers from the store, T6
    // holder-attributed, ring-bounded.
    name: "mesh-log/item-2 REMOTE: log-entries frames land in the node_logs ring (T6-attributed, ring-bounded) and mesh:logs --node reads them",
    async run() {
      await withHome(async ({ env }) => {
        const { openGlobalWorkProjectionStore, readNodeLogEntries } = await import("../src/global-work-store.mjs");
        const { applyStreamFrame } = await import("../src/control-stream-server.mjs");
        const { buildLogEntriesFrame } = await import("../src/worker-stream-client.mjs");
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          const frame = buildLogEntriesFrame("spoofed-node", [
            { at: "2026-07-26T15:00:00.000Z", level: "warn", code: "frame-skipped", message: "unknown-workspace", path: null },
          ], "2026-07-26T15:00:00.000Z");
          const applied = await applyStreamFrame(store, frame, { now: "2026-07-26T15:00:00.000Z", nodeId: "umairs-mac-mini" });
          assert.equal(applied.appended, 1);
          assert.equal(applied.nodeId, "umairs-mac-mini", "attribution is the CONNECTION-bound nodeId, never the frame's self-declared one (T6)");

          const ctx = { workspace: { projectRoot: "/x", workDir: "/x", config: {} }, globalWorkStoreOptions: { env } };
          const result = await invoke("mesh:logs", { node: "umairs-mac-mini", tail: 10 }, ctx);
          assert.equal(result.node, "umairs-mac-mini");
          assert.equal(result.entries[0].code, "frame-skipped", "the remote node's streamed event reads back");

          // Ring bound: appending beyond keep retains only the newest rows.
          const { appendNodeLogEntries } = await import("../src/global-work-store.mjs");
          appendNodeLogEntries(store, "umairs-mac-mini", Array.from({ length: 6 }, (_, i) => ({ code: `e${i}` })), { keep: 3 });
          const entries = readNodeLogEntries(store, "umairs-mac-mini", { tail: 10 });
          assert.deepEqual(entries.map((e) => e.code), ["e3", "e4", "e5"], "the ring keeps exactly the newest N, oldest-first on read");

          const empty = await invoke("mesh:logs", { node: "never-streamed" }, ctx);
          assert.deepEqual(empty.entries, [], "a node that never streamed reads empty, not an error");
        } finally {
          store.close();
        }
      });
    },
  },
];
