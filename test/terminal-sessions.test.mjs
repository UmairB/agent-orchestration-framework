// Unit tests for the running-session registry (src/terminal-sessions.mjs) — the
// .aof/terminal-sessions.json store of live agent-terminal PIDs.
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerSession, unregisterSession, listSessions } from "../src/terminal-sessions.mjs";

async function tempProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-sessions-"));
  await mkdir(path.join(dir, ".aof"), { recursive: true });
  return dir;
}

function registryFile(dir) {
  return path.join(dir, ".aof", "terminal-sessions.json");
}

export const terminalSessionsTests = [
  {
    name: "terminal-sessions: register persists pid/ref/provider/cwd to .aof/terminal-sessions.json",
    async run() {
      const dir = await tempProject();
      try {
        await registerSession(dir, { pid: process.pid, ref: "03/02", provider: "claude", cwd: dir });
        const data = JSON.parse(await readFile(registryFile(dir), "utf8"));
        assert.equal(data.sessions.length, 1, "one session recorded");
        assert.equal(data.sessions[0].pid, process.pid);
        assert.equal(data.sessions[0].ref, "03/02");
        assert.equal(data.sessions[0].provider, "claude");
        assert.equal(data.sessions[0].cwd, dir);
        assert.ok(typeof data.sessions[0].startedAt === "string", "carries a startedAt timestamp");
        assert.equal((await listSessions(dir)).length, 1, "listed as alive");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "terminal-sessions: unregister removes the session by pid",
    async run() {
      const dir = await tempProject();
      try {
        await registerSession(dir, { pid: process.pid, ref: "03/00", provider: "claude", cwd: dir });
        await unregisterSession(dir, process.pid);
        const data = JSON.parse(await readFile(registryFile(dir), "utf8"));
        assert.equal(data.sessions.length, 0, "session removed");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "terminal-sessions: a malformed registry is tolerated and a dead pid is pruned",
    async run() {
      const dir = await tempProject();
      try {
        // Malformed file → register starts clean rather than throwing.
        await writeFile(registryFile(dir), "{not valid json", "utf8");
        await registerSession(dir, { pid: process.pid, ref: "live", provider: "claude", cwd: dir });
        assert.equal((await listSessions(dir)).length, 1, "register recovered from malformed file");

        // Seed a clearly-dead pid alongside the live one; listing self-prunes it.
        await writeFile(
          registryFile(dir),
          JSON.stringify({ sessions: [{ pid: 2147483646, ref: "dead" }, { pid: process.pid, ref: "live" }] }),
          "utf8"
        );
        const live = await listSessions(dir);
        assert.deepEqual(live.map((s) => s.ref), ["live"], "the dead pid is pruned, the live one kept");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
];
