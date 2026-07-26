import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalMeshPaths } from "./workspace.mjs";

export function meshLauncherLockPaths(options = {}) {
  const meshPaths = options.paths ?? globalMeshPaths(options);
  const lockDir = path.join(meshPaths.meshRoot, "launcher.lock");
  return { lockDir, ownerPath: path.join(lockDir, "owner.json") };
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function readOwner(ownerPath) {
  try {
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    return owner != null && typeof owner === "object" ? owner : null;
  } catch {
    return null;
  }
}

async function removeLockDir(lockDir) {
  await rm(lockDir, { recursive: true, force: true });
}

export async function readMeshLauncherLockStatus(options = {}) {
  const isProcessAlive = typeof options.isProcessAlive === "function" ? options.isProcessAlive : defaultIsProcessAlive;
  const { lockDir, ownerPath } = meshLauncherLockPaths(options);
  const owner = await readOwner(ownerPath);
  const ownerPid = Number.isInteger(owner?.pid) ? owner.pid : null;
  if (ownerPid == null) return { running: false, pid: null, path: lockDir };
  if (isProcessAlive(ownerPid)) return { running: true, pid: ownerPid, path: lockDir };
  return { running: false, pid: null, path: lockDir, stalePid: ownerPid };
}

export async function acquireMeshLauncherLock(options = {}) {
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const isProcessAlive = typeof options.isProcessAlive === "function" ? options.isProcessAlive : defaultIsProcessAlive;
  const { lockDir, ownerPath } = meshLauncherLockPaths(options);
  const token = randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(path.dirname(lockDir), { recursive: true });
      await mkdir(lockDir, { recursive: false });
      await writeFile(ownerPath, `${JSON.stringify({ pid, token, createdAt: now() }, null, 2)}\n`, "utf8");
      return {
        acquired: true,
        pid,
        path: lockDir,
        release: async () => {
          const owner = await readOwner(ownerPath);
          if (owner?.token !== token) return;
          await removeLockDir(lockDir);
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = await readOwner(ownerPath);
      const ownerPid = Number.isInteger(owner?.pid) ? owner.pid : null;
      if (ownerPid != null && isProcessAlive(ownerPid)) {
        return { acquired: false, pid: ownerPid, path: lockDir, release: async () => {} };
      }
      if (attempt === 0) {
        await removeLockDir(lockDir);
        continue;
      }
      return { acquired: false, pid: ownerPid, path: lockDir, release: async () => {} };
    }
  }

  return { acquired: false, pid: null, path: lockDir, release: async () => {} };
}