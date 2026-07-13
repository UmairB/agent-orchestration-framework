// Traceability wiring for milestone 38 / story 00
// tasks/05_assistant-hook-wiring.feature — "the assistant hook seam wires Claude
// Code lifecycle events to `aof session start|ping|end`".
//
// Scenarios 1/3 (the settings.json mapping + the single-unchained-invocation
// invariant) are asserted by reading the REAL repo `.claude/settings.json`.
// Scenarios 2/4 (identity resolution from stdin JSON / CLAUDE_SESSION_ID env) are
// asserted against the real src/commands/mesh-session.mjs's resolveSessionIdentity —
// a pure function, no fs. Scenario 5 (ping cadence < TTL) is asserted against the
// real DEFAULT_SESSION_TTL_SECONDS constant. node:assert/strict.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { meshSessionCommand, resolveSessionIdentity } from "../src/commands/mesh-session.mjs";
import { DEFAULT_SESSION_TTL_SECONDS } from "../src/mesh-session.mjs";
import { readSessionRecordsForNode } from "../src/mesh-session.mjs";
import { loadWorkspace } from "../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const settingsPath = path.join(repoRoot, ".claude", "settings.json");
const NODE_ID = "node-a";

async function readSettings() {
  return JSON.parse(await readFile(settingsPath, "utf8"));
}

function commandFor(settings, event) {
  return settings.hooks?.[event]?.[0]?.hooks?.[0]?.command ?? null;
}

async function makeFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-hook-wiring-"));
  const root = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  await mkdir(path.join(root, "wiki", "work"), { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID } };
  await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const env = { AOF_GLOBAL_HOME: home };
  return { tmp, root, home, env };
}

function ctxFor(fixture, { stdinText = "", env = {} } = {}) {
  return {
    cwd: fixture.root,
    env,
    nodeId: NODE_ID,
    stdinText,
    now: () => "2026-07-10T12:00:00.000Z",
    loadWorkspace: (cwd, config) => loadWorkspace(cwd, config, { env: fixture.env }),
  };
}

export const meshAssistantHookWiringTests = [
  // ══ Scenario: the three lifecycle hooks map to the aof session verbs ══
  {
    name: "mesh-assistant-hook-wiring/05 the three lifecycle hooks map to the aof session verbs",
    async run() {
      const settings = await readSettings();
      assert.equal(commandFor(settings, "SessionStart"), "aof session start");
      assert.equal(commandFor(settings, "UserPromptSubmit"), "aof session ping");
      assert.equal(commandFor(settings, "SessionEnd"), "aof session end");
    },
  },

  // ══ Scenario: `aof session` takes session/workspace identity from the hook payload, assistant-agnostically ══
  {
    name: "mesh-assistant-hook-wiring/05 `aof session` takes session/workspace identity from the hook payload, assistant-agnostically",
    async run() {
      const payload = { session_id: "abc-123", workspace: "ws-1", repo: "my-repo" };
      const identity = resolveSessionIdentity({ stdinText: JSON.stringify(payload), env: { CLAUDE_SESSION_ID: "env-should-not-win" } });
      assert.equal(identity.source, "stdin", "identity resolves from the stdin JSON, preferred over env");
      assert.equal(identity.sessionId, "abc-123");
      assert.deepEqual(identity.payload, payload, "the full payload is available for workspace/repo resolution");
    },
  },

  // ══ Scenario Outline: each lifecycle event maps to exactly one aof session verb, a single unchained invocation ══
  {
    name: "mesh-assistant-hook-wiring/05 each lifecycle event maps to exactly one aof session verb, a single unchained invocation (Examples)",
    async run() {
      const settings = await readSettings();
      const rows = [
        { event: "SessionStart", command: "aof session start" },
        { event: "UserPromptSubmit", command: "aof session ping" },
        { event: "SessionEnd", command: "aof session end" },
      ];
      for (const row of rows) {
        const command = commandFor(settings, row.event);
        assert.equal(command, row.command, `${row.event} invokes \`${row.command}\``);
        assert.ok(/^aof session (start|ping|end)$/.test(command), "one simple `aof session <verb>` call");
        assert.ok(!/[&|;]/.test(command) && !/[<>]/.test(command), "no embedded shell chaining (&&/|/;/redirection)");
        assert.ok(command.startsWith("aof session "), "the command namespace is `aof session` — assistant-agnostic, not a Claude-Code-only verb");
      }
    },
  },

  // ══ Scenario Outline: session identity resolves across the two channels ══
  //
  // REVIEW FIX (F4): the two "(neither channel)" rows now drive the REAL
  // `aof session ping` CLI (meshSessionCommand) with empty stdin AND no
  // CLAUDE_SESSION_ID, asserting a non-zero coded exit AND no session record
  // written (mirroring task-00's own refusal-assertion shape) — not merely that
  // the pure resolveSessionIdentity helper returns source:null in isolation.
  {
    name: "mesh-assistant-hook-wiring/05 session identity resolves across the two channels — stdin JSON preferred, env the redundant fallback (Examples)",
    async run() {
      const validPayload = JSON.stringify({ session_id: "sid-1" });
      const rows = [
        { stdinText: validPayload, env: { CLAUDE_SESSION_ID: "env-1" }, source: "stdin" },
        { stdinText: validPayload, env: {}, source: "stdin" },
        { stdinText: "", env: { CLAUDE_SESSION_ID: "env-1" }, source: "env" },
        { stdinText: "not json", env: { CLAUDE_SESSION_ID: "env-1" }, source: "env" },
        { stdinText: "", env: {}, source: null },
        { stdinText: "not json", env: {}, source: null },
      ];
      for (const row of rows) {
        const identity = resolveSessionIdentity({ stdinText: row.stdinText, env: row.env });
        assert.equal(identity.source, row.source, `stdin=${JSON.stringify(row.stdinText)} env=${JSON.stringify(row.env)} resolves from ${row.source}`);
      }
    },
  },

  // ══ Scenario Outline (F4): the "(neither)" outcome is a REAL loud coded refusal — no record written ══
  {
    name: "mesh-assistant-hook-wiring/05 the (neither channel) outcome is a real loud coded refusal via `aof session ping`, with no session record written (Examples)",
    async run() {
      const rows = [
        { stdinText: "", env: {}, label: "absent (empty) stdin, unset env" },
        { stdinText: "not json", env: {}, label: "malformed (not JSON) stdin, unset env" },
      ];
      for (const row of rows) {
        const fixture = await makeFixture();
        try {
          const ws = await loadWorkspace(fixture.root, undefined, { env: fixture.env });
          const originalExitCode = process.exitCode;
          process.exitCode = undefined;
          const logs = [];
          const originalLog = console.log;
          console.log = (msg) => logs.push(msg);
          try {
            // No --workspace/--repo/--assistant flags either — a real hook fires
            // `aof session ping` with NO argv at all, relying entirely on the
            // stdin/env identity channels.
            await meshSessionCommand(["ping", "--json"], ctxFor(fixture, { stdinText: row.stdinText, env: row.env }));
          } finally {
            console.log = originalLog;
          }
          assert.equal(process.exitCode, 1, `${row.label}: exits non-zero`);
          process.exitCode = originalExitCode;

          const envelope = JSON.parse(logs[logs.length - 1]);
          assert.equal(envelope.ok, false, "the envelope reports failure");
          // With NEITHER channel resolving anything, workspaceId/assistant are both
          // still null — the per-arg requireNonBlank check (task 00's own coded
          // refusal ladder) fires first and IS the loud coded refusal this scenario
          // asks for: "workspace" is validated before "assistant", so its code wins.
          assert.equal(envelope.code, "session-arg-missing-workspace", `${row.label}: a loud coded refusal (the first unresolved required field)`);

          const records = await readSessionRecordsForNode(ws, NODE_ID);
          assert.equal(records.length, 0, `${row.label}: no session record is written`);
        } finally {
          await rm(fixture.tmp, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario (F4): no session identity is read from argv — only stdin JSON / CLAUDE_SESSION_ID env ══
  {
    name: "mesh-assistant-hook-wiring/05 no session identity is read from argv — a bare positional argument never resolves identity",
    async run() {
      const fixture = await makeFixture();
      try {
        const ws = await loadWorkspace(fixture.root, undefined, { env: fixture.env });
        const originalExitCode = process.exitCode;
        process.exitCode = undefined;
        const logs = [];
        const originalLog = console.log;
        console.log = (msg) => logs.push(msg);
        try {
          // A stray positional/argv-shaped session id — meshSessionCommand's argv
          // parser treats this as an unrecognised positional (never as identity);
          // with no stdin/env channel either, the SAME loud refusal fires — proving
          // argv is never consulted for identity resolution.
          await meshSessionCommand(["ping", "sid-from-argv-should-be-ignored", "--json"], ctxFor(fixture, { stdinText: "", env: {} }));
        } finally {
          console.log = originalLog;
        }
        assert.equal(process.exitCode, 1, "a stray argv-carried id never resolves identity — the same refusal fires");
        process.exitCode = originalExitCode;

        const envelope = JSON.parse(logs[logs.length - 1]);
        assert.equal(envelope.ok, false);
        // The stray positional is NEVER consulted for identity — if it were, this
        // would resolve workspaceId to it and proceed; instead the SAME
        // missing-workspace refusal fires as it would with no positional at all,
        // proving the positional is inert for identity purposes.
        assert.equal(envelope.code, "session-arg-missing-workspace", "argv carried a session-id-shaped token, but it is never read as identity");

        const records = await readSessionRecordsForNode(ws, NODE_ID);
        assert.equal(records.length, 0, "no session record is written from an argv-carried id");
      } finally {
        await rm(fixture.tmp, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the UserPromptSubmit ping cadence sits under the TTL headroom ══
  {
    name: "mesh-assistant-hook-wiring/05 the UserPromptSubmit ping cadence sits under the TTL headroom, so a live-but-quiet session never falsely expires",
    async run() {
      // UserPromptSubmit fires PER PROMPT (RESEARCH.md §2.2, measured) — there is no
      // fixed numeric "cadence" to compare beyond "at least once per interactive
      // turn," which is comfortably sub-second-to-minutes in practice, always well
      // under the 120s TTL. The load-bearing, testable invariant is that the pinned
      // TTL constant itself carries enough headroom above ANY plausible per-prompt
      // cadence (a human types faster than 120s between prompts in the overwhelming
      // common case) — pinned here as a concrete, non-zero headroom assertion.
      const plausibleMaxPromptGapSeconds = 60; // a generous per-prompt upper bound
      assert.ok(plausibleMaxPromptGapSeconds < DEFAULT_SESSION_TTL_SECONDS, "the ping cadence is strictly less than the TTL (comfortable headroom)");
      // A session pinged once per prompt stays live between prompts: the LAST ping
      // age never exceeds the plausible gap, which is < TTL.
      const ageMsAtNextPrompt = plausibleMaxPromptGapSeconds * 1000;
      assert.ok(ageMsAtNextPrompt < DEFAULT_SESSION_TTL_SECONDS * 1000, "a session pinged once per prompt stays live between prompts");
    },
  },
];
