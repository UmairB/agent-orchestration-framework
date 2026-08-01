import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJson } from "./fs.mjs";

export const LOCK_VERSION = 2;

export function hashContent(content) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export async function readLock(lockPath) {
  try {
    return await readJson(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// mergeLock(lockPath, patch) — THE READ-MERGE LOCK WRITE (m42 wave (d) leg d4;
// PRD §Cascades have no home: "Two `aof init`/`project migrate` sites bypass
// `writeLock`'s read-merge and wipe the `work`/`planning` lock sections
// wholesale").
//
// The install lock is not one subsystem's file. `aof init` and `project migrate`
// author the ITEMS/runtimes half; `work init` writes `lock.work`; `planning init`
// writes `lock.planning`. Both of the first two wrote the whole document, so
// running either against a workspace that already had work or planning installed
// silently deleted the other subtree — the manifests were gone and the next
// `work update` had nothing to reconcile against.
//
// The cure is the same one-writer-per-subtree discipline the mesh sidecar keeps
// (writeSidecarPatch): read what is there, overlay THIS caller's keys, write the
// union. Absent/torn lock reads as `{}` — a fresh install, never a crash. Keys
// the patch does not name survive byte-equivalent.
export async function mergeLock(lockPath, patch) {
  let existing = null;
  try {
    existing = await readLock(lockPath);
  } catch {
    // A torn/unparseable lock must not block an install: treat it as absent. The
    // patch below is authoritative for its own keys either way.
    existing = null;
  }
  const base = existing != null && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const merged = { ...base, ...patch };
  await writeLock(lockPath, merged);
  return merged;
}

export async function writeLock(lockPath, manifest) {
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  await mkdir(path.dirname(lockPath), { recursive: true });
  const tempPath = path.join(path.dirname(lockPath), `.tmp-${path.basename(lockPath)}-${process.pid}-${Date.now()}-${randomUUID()}`);
  await writeFile(tempPath, content, "utf8");
  await renameWithRetry(tempPath, lockPath);
}

async function renameWithRetry(source, target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!["EACCES", "EPERM"].includes(error.code) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

// ADR-009 (unified lock): read-merge-write — SPREAD the current lock and replace
// ONLY frameworkInstallAttempts. Reconstructing from a fixed field set here would
// DROP the foreign `planning`/`work` sections (and any unknown key) on every
// `packages install`/replay. The flat asset fields are normalised with their
// usual fallbacks; everything else (incl. `planning`/`work`) is carried through.
export function mergeFrameworkInstallAttempts(lock, attempts, generatedAt = new Date().toISOString()) {
  return {
    ...(lock && typeof lock === "object" ? lock : {}),
    version: lock?.version ?? LOCK_VERSION,
    generatedAt: lock?.generatedAt ?? generatedAt,
    runtimes: lock?.runtimes ?? [],
    files: lock?.files ?? [],
    packages: lock?.packages ?? [],
    frameworks: lock?.frameworks ?? [],
    frameworkInstallAttempts: [
      ...(Array.isArray(lock?.frameworkInstallAttempts) ? lock.frameworkInstallAttempts : []),
      ...attempts
    ]
  };
}

export async function hashFileIfExists(filePath) {
  try {
    return hashContent(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
