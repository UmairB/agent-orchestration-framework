// Fitness functions for m42 — THE SHARED-STORE CONCURRENCY PRAGMAS.
//
// The measured residual (STATE 2026-07-27, "CONTINUOUS `ERR_SQLITE_ERROR:
// database is locked`, every ~5s post-restart"): the global work projection is
// opened by SEVERAL PROCESSES AT ONCE — the desktop's status poll, the board's
// in-flight re-poll, the serve daemon's write ticks and every CLI invocation —
// and it was opened with NO pragmas at all. In `journal_mode: delete` with no
// `busy_timeout`, a write that collides with another process's write fails
// IMMEDIATELY. Nothing was lost (ticks retry next cycle) but any tick could
// silently skip a beat, which is the same class of invisible degradation m42
// exists to kill.
//
//   (1) STRUCTURAL RATCHET: every shared-process SQLite store in src/ applies
//       both concurrency pragmas at open. A new store — or a refactor that
//       drops the call — fails here rather than on a live soak at 3am.
//   (2) BEHAVIOURAL: the real store, opened through its real door, reports
//       `wal` and a non-zero busy_timeout.
//   (3) THE DEFECT ITSELF, CROSS-PROCESS: a second process holding a write
//       transaction no longer costs the writer its beat — it waits and then
//       succeeds. Non-vacuous by construction: the SAME collision under the
//       PRE-FIX pragmas is asserted to fail, so this lane cannot pass green on
//       a machine that simply never contends.
//
// Why cross-process: `node:sqlite`'s DatabaseSync is SYNCHRONOUS, so an
// in-process holder can never release while the waiter blocks the event loop —
// an in-process version of lane (3) is structurally incapable of reproducing
// the defect and would assert nothing. The three real contenders are three real
// processes, and so is this proof.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { fork } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The shared-process SQLite stores: the file, and the open function that must
// carry the pragmas. Both are opened by multiple processes concurrently on a
// control node, which is the whole reason the pragmas are not optional.
const SHARED_STORES = [
  { file: path.join("src", "global-work-store.mjs"), what: "the global work projection" },
  { file: path.join("src", "effects", "journal.mjs"), what: "the effects journal" },
];

// The holder: opens the db, takes a write transaction, tells the parent it is
// held, and releases after `holdMs`. A separate PROCESS, deliberately.
const HOLDER_SOURCE = `
const sqlite = await import("node:sqlite");
const [, , dbPath, mode, holdMs] = process.argv;
const db = new sqlite.DatabaseSync(dbPath);
db.exec(\`PRAGMA journal_mode = \${mode}\`);
db.exec("BEGIN IMMEDIATE");
db.prepare("INSERT INTO t VALUES (1)").run();
process.send("held");
setTimeout(() => { db.exec("COMMIT"); db.close(); process.exit(0); }, Number(holdMs));
`;

// collide(dir, mode, busyTimeout) → { ok, ms } — seed a db, have a CHILD PROCESS
// hold a write transaction, then attempt a write from this process under the
// given pragmas. `ok:false` is the skipped beat.
async function collide(dir, { mode, busyTimeout, holdMs = 300 }) {
  const sqlite = await import("node:sqlite");
  const dbPath = path.join(dir, `${mode}-${busyTimeout}.sqlite`);
  const holderPath = path.join(dir, "holder.mjs");
  await writeFile(holderPath, HOLDER_SOURCE, "utf8");

  const seed = new sqlite.DatabaseSync(dbPath);
  seed.exec(`PRAGMA journal_mode = ${mode}`);
  seed.exec("CREATE TABLE IF NOT EXISTS t (a INTEGER)");
  seed.close();

  // The 4th slot is the IPC channel `process.send` needs — a bare `stdio:"ignore"`
  // would drop it and the holder would die before it could say "held".
  // `execArgv: []` because fork INHERITS the parent's exec flags by default, and
  // the holder is a real file: a runner invoked with `--input-type=module` (or
  // any other eval/coverage flag) would hand the child a flag it cannot start
  // under, and the lane would fail for a reason that has nothing to do with locks.
  const child = fork(holderPath, [dbPath, mode, String(holdMs)], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    execArgv: [],
  });
  try {
    await new Promise((resolve, reject) => {
      child.once("message", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`holder exited early (${code})`)));
    });

    const db = new sqlite.DatabaseSync(dbPath);
    db.exec(`PRAGMA journal_mode = ${mode}`);
    if (busyTimeout > 0) db.exec(`PRAGMA busy_timeout = ${busyTimeout}`);
    const startedAt = Date.now();
    try {
      db.prepare("INSERT INTO t VALUES (2)").run();
      return { ok: true, ms: Date.now() - startedAt };
    } catch {
      return { ok: false, ms: Date.now() - startedAt };
    } finally {
      db.close();
    }
  } finally {
    await new Promise((resolve) => {
      if (child.exitCode != null || child.signalCode != null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => { try { child.kill(); } catch { /* already gone */ } resolve(); }, 2000).unref?.();
    });
  }
}

export const archTests = [
  {
    name: "arch/42: every shared-process SQLite store applies the concurrency pragmas at open",
    run: async () => {
      for (const { file, what } of SHARED_STORES) {
        const source = await readFile(path.join(repoRoot, file), "utf8");
        assert.ok(
          /PRAGMA\s+busy_timeout\s*=\s*\d+/i.test(source),
          `${what} (${file}) sets busy_timeout — without it a colliding write fails instantly instead of waiting`,
        );
      }
      // WAL is required of the PROJECTION specifically: it is the one read by
      // pollers on every tick while a writer holds the file. The journal is
      // written by one drain at a time and needs only the timeout.
      const projection = await readFile(path.join(repoRoot, "src", "global-work-store.mjs"), "utf8");
      assert.ok(
        /PRAGMA\s+journal_mode\s*=\s*WAL/i.test(projection),
        "the global work projection runs in WAL — readers must not block the writer that polls collide with",
      );
    },
  },
  {
    name: "arch/42: the real projection store reports WAL + a non-zero busy_timeout",
    run: async () => {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-store-pragma-"));
      try {
        const store = await openGlobalWorkProjectionStore({ env: { ...process.env, AOF_GLOBAL_HOME: home } });
        try {
          assert.equal(store.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
          assert.ok(store.db.prepare("PRAGMA busy_timeout").get().timeout > 0, "busy_timeout is set");
        } finally {
          store.close();
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/42: a cross-process write collision waits instead of skipping a beat (non-vacuous)",
    run: async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "aof-store-collide-"));
      try {
        // THE CONTROL — the pre-fix pragmas. If this ever passes, the lane below
        // proves nothing on this machine and the assertion says so.
        const before = await collide(dir, { mode: "delete", busyTimeout: 0 });
        assert.equal(
          before.ok,
          false,
          "PRE-FIX control must fail: without busy_timeout a colliding write is refused immediately (if this passes, lane 3 is vacuous here)",
        );

        // THE CURE — the pragmas the store now opens with.
        const after = await collide(dir, { mode: "wal", busyTimeout: 2000 });
        assert.equal(after.ok, true, "with WAL + busy_timeout the colliding write waits for the holder and lands");
        assert.ok(after.ms >= 100, `the write genuinely waited on the holder (waited ${after.ms}ms)`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
];
