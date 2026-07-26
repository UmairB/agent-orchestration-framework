import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireMeshLauncherLock } from "../src/mesh-launcher-lock.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";

async function withTempHome(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-launcher-lock-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const meshLauncherLockTests = [
  {
    name: "mesh-launcher-lock/00 a second launcher on the same machine is refused by the global mesh lock",
    run: async () => withTempHome(async (home) => {
      const env = { AOF_GLOBAL_HOME: home };
      const first = await acquireMeshLauncherLock({ env, pid: 111, isProcessAlive: () => true });
      assert.equal(first.acquired, true, "first launcher acquires the global lock");

      const second = await acquireMeshLauncherLock({ env, pid: 222, isProcessAlive: () => true });
      assert.equal(second.acquired, false, "second launcher is refused");
      assert.equal(second.pid, 111, "refusal reports the owning pid");

      const owner = JSON.parse(await readFile(path.join(globalMeshPaths({ env }).meshRoot, "launcher.lock", "owner.json"), "utf8"));
      assert.equal(owner.pid, 111, "owner is persisted under the global mesh home");

      await first.release();
      const afterRelease = await acquireMeshLauncherLock({ env, pid: 333, isProcessAlive: () => true });
      assert.equal(afterRelease.acquired, true, "lock can be acquired after release");
      await afterRelease.release();
    }),
  },
  {
    name: "mesh-launcher-lock/00 a stale launcher lock is reclaimed when its owner pid is dead",
    run: async () => withTempHome(async (home) => {
      const env = { AOF_GLOBAL_HOME: home };
      const first = await acquireMeshLauncherLock({ env, pid: 111, isProcessAlive: () => true });

      const stale = await acquireMeshLauncherLock({ env, pid: 222, isProcessAlive: (pid) => pid !== 111 });
      assert.equal(stale.acquired, true, "dead owner lock is reclaimed");
      assert.equal(stale.pid, 222, "new owner pid is recorded");

      await first.release();
      const third = await acquireMeshLauncherLock({ env, pid: 333, isProcessAlive: () => true });
      assert.equal(third.acquired, false, "a stale handle cannot release the new owner lock");
      assert.equal(third.pid, 222, "the reclaimed owner remains protected");
      await stale.release();
    }),
  },
];