import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export async function writeText(filePath, content, { dryRun = false } = {}) {
  if (dryRun) {
    return { path: filePath, action: "write" };
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}-${randomUUID()}`);
  await writeFile(tempPath, content, "utf8");
  try {
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    // m42 wave (a) / m38-F26: a lost rename (two publishers racing, a reader
    // holding the target on Windows) used to strand the temp file forever —
    // measured live: dozens of .tmp-* orphans in presence/ + nodes/ that nothing
    // swept. The temp is reclaimed HERE, on the failure path that created it; the
    // original error still propagates (the write genuinely failed).
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
  return { path: filePath, action: "write" };
}

// sweepStaleTempFiles(dir, { olderThanMs, now }) — m42 wave (a) / m38-F26: reclaim
// `.tmp-*` orphans a crashed/killed process left behind (the unlink above only
// covers a LIVE process's own failure). Age-gated so a concurrent writer's
// in-flight temp is never swept. Absent dir → { removed: [] }, never a throw.
export async function sweepStaleTempFiles(dir, { olderThanMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  const removed = [];
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return { removed }; // absent dir: nothing to sweep
  }
  for (const name of names) {
    if (!name.startsWith(".tmp-")) continue;
    const filePath = path.join(dir, name);
    try {
      const info = await stat(filePath);
      if (now - info.mtimeMs < olderThanMs) continue;
      await unlink(filePath);
      removed.push(name);
    } catch {
      // A vanished/locked entry is skipped — the next sweep retries; the sweep
      // itself must never throw out of a daemon's startup.
    }
  }
  return { removed };
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

export function normalizeId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-_.]*$/i.test(id)) {
    throw new Error(`Invalid id "${id}". Use letters, numbers, dots, underscores, or hyphens.`);
  }

  return id;
}
