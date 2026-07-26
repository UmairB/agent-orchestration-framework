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
];
