// A best-effort registry of running agent-terminal sessions, persisted to
// `.aof/terminal-sessions.json`. A live PTY cannot be migrated into a native
// terminal, so its pid is the handle to it — recording pid/ref/provider/cwd lets
// the host inspect, clean up, or "open in terminal" a running session, and lets a
// fresh server detect orphans.
//
// This is OPERATIONAL runtime state in `.aof/` (alongside aof.config.json /
// aof.lock.json), NOT a work-stream mutation — so it sits outside the board's
// write-isolation invariant (ADR-004 / acd-board-write-isolation, which scopes the
// board's sole write to a milestone/story STATE.md under wiki/work). Every write
// is guarded: a registry failure must never break a terminal session.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

function registryPath(projectDir) {
  return path.join(projectDir, ".aof", "terminal-sessions.json");
}

async function readSessions(projectDir) {
  try {
    const data = JSON.parse(await readFile(registryPath(projectDir), "utf8"));
    return Array.isArray(data?.sessions) ? data.sessions : [];
  } catch {
    // Missing / malformed → start clean.
    return [];
  }
}

// Probe whether a pid is still running. `process.kill(pid, 0)` sends no signal —
// it throws ESRCH when the process is gone, EPERM when it exists but isn't ours
// (treat that as alive). Used to self-prune orphan/stale entries.
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function persist(projectDir, sessions) {
  try {
    await mkdir(path.join(projectDir, ".aof"), { recursive: true });
    await writeFile(
      registryPath(projectDir),
      `${JSON.stringify({ updatedAt: new Date().toISOString(), sessions }, null, 2)}\n`,
      "utf8"
    );
  } catch {
    /* best-effort — never break a session over a registry write */
  }
}

// Record a freshly-spawned session (pruning any dead/duplicate entries first).
export async function registerSession(projectDir, session) {
  const kept = (await readSessions(projectDir)).filter((s) => s.pid !== session.pid && isAlive(s.pid));
  kept.push({
    pid: session.pid ?? null,
    ref: session.ref ?? null,
    provider: session.provider ?? null,
    cwd: session.cwd ?? null,
    startedAt: new Date().toISOString(),
  });
  await persist(projectDir, kept);
}

// Drop a session by pid (and prune any other dead entries while we're here).
export async function unregisterSession(projectDir, pid) {
  const kept = (await readSessions(projectDir)).filter((s) => s.pid !== pid && isAlive(s.pid));
  await persist(projectDir, kept);
}

// The currently-alive sessions (self-pruned). For inspection / future endpoints.
export async function listSessions(projectDir) {
  return (await readSessions(projectDir)).filter((s) => isAlive(s.pid));
}
