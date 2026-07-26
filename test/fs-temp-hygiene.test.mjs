// m42 wave (a) / m38-F26 — the atomic-write temp-file hygiene. Pins:
//   - a FAILED rename reclaims the temp it created (the leak: dozens of .tmp-*
//     orphans in presence/ + nodes/ that nothing swept), while the original
//     error still propagates
//   - sweepStaleTempFiles reclaims only AGED .tmp-* orphans (a live writer's
//     fresh temp survives), tolerates an absent dir, and never throws
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readdir, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeText, sweepStaleTempFiles } from "../src/fs.mjs";

async function withTemp(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-fs-hygiene-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const fsTempHygieneTests = [
  {
    name: "fs-hygiene/F26 a failed rename reclaims its own temp file and still propagates the error",
    async run() {
      await withTemp(async (root) => {
        // Make the TARGET a non-empty directory: rename(file -> dir) fails on
        // every platform with a non-retryable code, exercising the failure path.
        const target = path.join(root, "record.json");
        await mkdir(target);
        await writeFile(path.join(target, "occupant"), "x", "utf8");

        await assert.rejects(writeText(target, "{}"), "the write genuinely failed and says so");
        const leftovers = (await readdir(root)).filter((name) => name.startsWith(".tmp-"));
        assert.deepEqual(leftovers, [], "the failure path reclaimed the temp it created — no orphan");
      });
    },
  },
  {
    name: "fs-hygiene/F26 sweepStaleTempFiles reclaims aged .tmp-* orphans, spares fresh ones and non-temp files, tolerates absence",
    async run() {
      await withTemp(async (root) => {
        const old = path.join(root, ".tmp-record.json-123-dead");
        const fresh = path.join(root, ".tmp-record.json-456-live");
        const real = path.join(root, "record.json");
        await writeFile(old, "orphan", "utf8");
        await writeFile(fresh, "in-flight", "utf8");
        await writeFile(real, "{}", "utf8");
        const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
        await utimes(old, twoHoursAgo, twoHoursAgo);

        const swept = await sweepStaleTempFiles(root, { olderThanMs: 60 * 60 * 1000 });
        assert.deepEqual(swept.removed, [path.basename(old)], "exactly the aged orphan is reclaimed");
        const remaining = (await readdir(root)).sort();
        assert.deepEqual(remaining, [path.basename(fresh), "record.json"].sort(), "the fresh temp and the real file survive");

        const absent = await sweepStaleTempFiles(path.join(root, "no-such-dir"));
        assert.deepEqual(absent.removed, [], "an absent dir sweeps to empty, never a throw");
      });
    },
  },
];
