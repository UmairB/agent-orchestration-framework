// Traceability wiring for milestone 38 / story 00
// tasks/07_bug-hook-identity-from-cwd.feature — FINDING F4 (aof:verify 38, BLOCKER):
// a real Claude Code hook payload NEVER carries `workspace`/`repo` (RESEARCH.md
// §2.2, measured) — only `session_id`, `transcript_path`, `cwd`, `hook_event_name`
// (+ event extras). The bare hook commands (`aof session start|ping|end`, no flags,
// exactly as `.claude/settings.json` wires them) must derive workspace + repo from
// the payload's `cwd`, using the SAME canonical idiom the presence publisher uses
// (`config?.mesh?.workspaceId ?? workspaceIdFor(projectRoot)`), or the fix is
// cosmetic — a record keyed on a non-canonical id would be invisible to ADR-003
// aggregation and would break ADR-004 subsumption.
//
// @qa's own note on the finding: "the ONE assertion whose absence let this ship is
// 'a REAL captured payload → the BARE command → a record on disk'." Every fixture
// payload below uses the EXACT RESEARCH-captured field set (session_id,
// transcript_path, cwd, hook_event_name + event extras) — NEVER a hand-authored
// payload carrying `workspace`/`repo` for the cwd-derivation assertions (the
// precedence Outline is the one place a payload legitimately carries those fields,
// because the feature's own contract requires testing that precedence tier).
//
// Exercised against the REAL CLI face (src/commands/mesh-session.mjs's
// meshSessionCommand) over a hermetic fixture repo + a fixture AOF_GLOBAL_HOME (no
// real machine state touched) — real fs, in-process. One test object per scenario /
// Scenario Outline. node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { meshSessionCommand } from "../src/commands/mesh-session.mjs";
import { readSessionRecordsForNode } from "../src/mesh-session.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { workspaceIdFor } from "../src/global-work-store.mjs";
import { startLauncher } from "../src/mesh-launcher.mjs";

const NODE_ID = "node-a";
const REPO_NAME = "aof-fixture";

// ─────────────────────────────────────────── real, RESEARCH.md §2.2 payload shapes ──
// The measured field set — NEVER hand-authored to carry `workspace`/`repo`. `cwd` is
// the ONE identity field every real hook payload carries; that convenience-fixture
// bug (a payload shaped to the consumer's convenience) is exactly what let F4 ship.
function realSessionStartPayload(cwd, sessionId = "4858d722-aaaa-bbbb-cccc-000000000001") {
  return {
    session_id: sessionId,
    transcript_path: "C:\\Users\\Umair\\.claude\\projects\\hook-test\\transcript.jsonl",
    cwd,
    hook_event_name: "SessionStart",
    source: "startup",
  };
}

function realUserPromptSubmitPayload(cwd, sessionId = "4858d722-aaaa-bbbb-cccc-000000000001") {
  return {
    session_id: sessionId,
    transcript_path: "C:\\Users\\Umair\\.claude\\projects\\hook-test\\transcript.jsonl",
    cwd,
    prompt_id: "c9d0bf6c-1111-2222-3333-444444444444",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: "reply with exactly the word OK and nothing else",
  };
}

function realSessionEndPayload(cwd, sessionId = "4858d722-aaaa-bbbb-cccc-000000000001") {
  return {
    session_id: sessionId,
    transcript_path: "C:\\Users\\Umair\\.claude\\projects\\hook-test\\transcript.jsonl",
    cwd,
    prompt_id: "c9d0bf6c-1111-2222-3333-444444444444",
    hook_event_name: "SessionEnd",
    reason: "other",
  };
}

// ──────────────────────────────────────────────────────────────────── fixtures ──
async function makeFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-hook-identity-"));
  const root = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  await mkdir(path.join(root, "wiki", "work"), { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  // `mesh.fabric: "tailscale"` is required for the presence-aggregation scenario's
  // startLauncher() call to pass its fabric preflight (probeFabric) and actually
  // publish a record — mirrors mesh-presence-aggregate-workspaces.test.mjs's own
  // fixture. Harmless for the CLI-only scenarios (meshSessionCommand never reads it).
  const config = { name: REPO_NAME, work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID, fabric: "tailscale" } };
  await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { tmp, root, home, env: { AOF_GLOBAL_HOME: home } };
}

// A plain directory that is NEVER an aof workspace (no .aof/aof.config.json, no
// legacy aof.config.json) — the "cwd cannot resolve a workspace" fixture.
async function makeNonWorkspaceDir(tmp, slug = "not-a-workspace") {
  const dir = path.join(tmp, slug);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function wsFor(fixture) {
  return loadWorkspace(fixture.root, undefined, { env: fixture.env });
}

// A ctx that pins env/nodeId so the CLI face never touches real machine state, and
// supplies a stdin/now/cwd the test controls deterministically. `cwd` here is
// `ctx.cwd` — the FALLBACK the fix consults only when the payload carries no usable
// `cwd` (defaults to `fixture.root`, a real workspace, exactly like the pre-existing
// task-00/05 fixtures).
function ctxFor(fixture, { stdinText = "", cwd, now } = {}) {
  return {
    cwd: cwd ?? fixture.root,
    env: fixture.env,
    nodeId: NODE_ID,
    stdinText,
    now: typeof now === "string" ? () => now : now,
    loadWorkspace: (dir, config) => loadWorkspace(dir, config, { env: fixture.env }),
  };
}

function manualTicker() {
  const handles = [];
  return {
    handles,
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
  };
}

async function runJsonCommand(args, ctx) {
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    await meshSessionCommand(args, ctx);
  } finally {
    console.log = originalLog;
  }
  const exitCode = process.exitCode;
  process.exitCode = originalExitCode;
  const envelope = logs.length > 0 ? JSON.parse(logs[logs.length - 1]) : null;
  return { exitCode, envelope };
}

export const meshHookIdentityFromCwdTests = [
  // ══ Scenario: the bare `aof session start` a real hook fires writes a session record — the regression this bug is ══
  {
    name: "hook-identity-from-cwd/07 the bare `aof session start` a real hook fires writes a session record — the regression this bug is",
    async run() {
      const fixture = await makeFixture();
      try {
        const payload = realSessionStartPayload(fixture.root);
        assert.equal(payload.workspace, undefined, "the fixture payload carries no `workspace` field (RESEARCH §2.2 real shape)");
        assert.equal(payload.repo, undefined, "the fixture payload carries no `repo` field (RESEARCH §2.2 real shape)");

        const { exitCode } = await runJsonCommand(
          ["start", "--json"],
          ctxFor(fixture, { stdinText: JSON.stringify(payload), now: "2026-07-12T12:00:00.000Z" }),
        );
        assert.notEqual(exitCode, 1, "the command exits 0");

        const ws = await wsFor(fixture);
        const records = await readSessionRecordsForNode(ws, NODE_ID);
        assert.equal(records.length, 1, "a session record IS written for this node");
        const record = records[0];
        assert.equal(
          record.workspaceId,
          workspaceIdFor(fixture.root),
          "the record's workspaceId equals the registry-canonical `config.mesh.workspaceId ?? workspaceIdFor(<cwd>)` — the SAME id the presence publisher derives",
        );
        assert.equal(record.repo, REPO_NAME, "the record's repo is the workspace's name");
        assert.equal(record.assistant, "claude-code", "the record's assistant resolves without a flag");
      } finally {
        await rm(fixture.tmp, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the bare `aof session ping` upserts from the same payload, and the bare `aof session end` deletes ══
  {
    name: "hook-identity-from-cwd/07 the bare `aof session ping` upserts from the same payload, and the bare `aof session end` deletes",
    async run() {
      const fixture = await makeFixture();
      try {
        const startPayload = realSessionStartPayload(fixture.root);
        await runJsonCommand(["start", "--json"], ctxFor(fixture, { stdinText: JSON.stringify(startPayload), now: "2026-07-12T12:00:00.000Z" }));

        const ws = await wsFor(fixture);
        let records = await readSessionRecordsForNode(ws, NODE_ID);
        assert.equal(records.length, 1, "a live session started from a real hook payload");

        const pingPayload = realUserPromptSubmitPayload(fixture.root);
        await runJsonCommand(["ping", "--json"], ctxFor(fixture, { stdinText: JSON.stringify(pingPayload), now: "2026-07-12T12:00:30.000Z" }));
        records = await readSessionRecordsForNode(ws, NODE_ID);
        assert.equal(records.length, 1, "no second record is created — ping upserts in place");
        assert.equal(records[0].lastPingAt, "2026-07-12T12:00:30.000Z", "the record's lastPingAt advances");

        const endPayload = realSessionEndPayload(fixture.root);
        const { exitCode } = await runJsonCommand(["end", "--json"], ctxFor(fixture, { stdinText: JSON.stringify(endPayload) }));
        assert.notEqual(exitCode, 1, "the command exits 0");

        records = await readSessionRecordsForNode(ws, NODE_ID);
        assert.equal(records.length, 0, "the record for that (node, workspace, assistant) tuple is removed");
      } finally {
        await rm(fixture.tmp, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the derived workspaceId is the one presence actually aggregates on ══
  {
    name: "hook-identity-from-cwd/07 the derived workspaceId is the one presence actually aggregates on (the invariant the fix exists to hold)",
    async run() {
      const fixture = await makeFixture();
      try {
        const payload = realSessionStartPayload(fixture.root);
        await runJsonCommand(["start", "--json"], ctxFor(fixture, { stdinText: JSON.stringify(payload), now: "2026-07-12T12:00:00.000Z" }));

        const ws = await wsFor(fixture);
        const canonicalId = workspaceIdFor(fixture.root);
        const records = await readSessionRecordsForNode(ws, NODE_ID);
        assert.equal(records[0].workspaceId, canonicalId, "its workspaceId is byte-equal to the canonical id");

        const handle = await startLauncher(ws, {
          exec: async () => ({
            stdout: JSON.stringify({ BackendState: "Running", Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true }, Peer: {} }),
            status: 0,
          }),
          platform: "linux",
          peerPollTicker: manualTicker(),
          propagationTicker: manualTicker(),
          streamServer: false,
          streamClient: false,
          now: () => "2026-07-12T12:00:05.000Z",
          globalWorkStoreOptions: { env: fixture.env },
        });
        handle.stop?.();

        assert.ok(
          handle.record.sessions.some((s) => s.workspaceId === canonicalId),
          "the live session therefore surfaces in the node's published presence sessions[]",
        );
      } finally {
        await rm(fixture.tmp, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: identity precedence — explicit flags win, then payload fields, then the payload's cwd ══
  {
    name: "hook-identity-from-cwd/07 identity precedence — explicit flags win, then payload fields, then the payload's cwd (Examples)",
    async run() {
      const rows = [
        {
          label: "--workspace + --repo flags, payload: cwd only (real shape) -> source: the flags",
          flags: ["--workspace", "flag-ws", "--repo", "flag-repo", "--assistant", "claude-code"],
          payload: (root) => realSessionStartPayload(root),
          expectWorkspaceId: () => "flag-ws",
          expectRepo: () => "flag-repo",
        },
        {
          label: "--workspace + --repo flags, payload: workspace + repo -> source: the flags",
          flags: ["--workspace", "flag-ws", "--repo", "flag-repo", "--assistant", "claude-code"],
          payload: () => ({ session_id: "sid-1", workspace: "payload-ws", repo: "payload-repo" }),
          expectWorkspaceId: () => "flag-ws",
          expectRepo: () => "flag-repo",
        },
        {
          label: "no flags, payload: workspace + repo -> source: the payload fields",
          flags: [],
          payload: () => ({ session_id: "sid-1", workspace: "payload-ws", repo: "payload-repo" }),
          expectWorkspaceId: () => "payload-ws",
          expectRepo: () => "payload-repo",
        },
        {
          label: "no flags, payload: cwd only (real shape) -> source: derived from cwd (THE FIX)",
          flags: [],
          payload: (root) => realSessionStartPayload(root),
          expectWorkspaceId: (root) => workspaceIdFor(root),
          expectRepo: () => REPO_NAME,
        },
        {
          label: "no flags, payload: cwd only (real shape) -> workspaceId is registry-canonical",
          flags: [],
          payload: (root) => realSessionStartPayload(root),
          expectWorkspaceId: (root) => workspaceIdFor(root),
          expectRepo: () => REPO_NAME,
        },
      ];
      for (const row of rows) {
        const fixture = await makeFixture();
        try {
          const payload = row.payload(fixture.root);
          const { exitCode } = await runJsonCommand(
            ["start", ...row.flags, "--json"],
            ctxFor(fixture, { stdinText: JSON.stringify(payload), now: "2026-07-12T12:00:00.000Z" }),
          );
          assert.notEqual(exitCode, 1, `${row.label}: record written (exit 0)`);

          const ws = await wsFor(fixture);
          const records = await readSessionRecordsForNode(ws, NODE_ID);
          assert.equal(records.length, 1, `${row.label}: record written`);
          assert.equal(records[0].workspaceId, row.expectWorkspaceId(fixture.root), `${row.label}: the resolved workspaceId`);
          assert.equal(records[0].repo, row.expectRepo(fixture.root), `${row.label}: the resolved repo`);
        } finally {
          await rm(fixture.tmp, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: a cwd that cannot resolve a workspace still refuses LOUDLY — never a silent or half-formed record ══
  {
    name: "hook-identity-from-cwd/07 a cwd that cannot resolve a workspace still refuses LOUDLY — never a silent or half-formed record (Examples)",
    async run() {
      const rows = [
        {
          label: "a directory that is not an aof workspace",
          buildPayload: (nonWsDir) => realSessionStartPayload(nonWsDir),
          ctxCwdIsNonWorkspace: false, // payload's own cwd wins regardless of ctx.cwd
        },
        {
          label: "absent from the payload entirely",
          buildPayload: (nonWsDir) => {
            const payload = realSessionStartPayload(nonWsDir);
            delete payload.cwd;
            return payload;
          },
          ctxCwdIsNonWorkspace: true, // no payload cwd — falls back to ctx.cwd, which must ALSO fail
        },
        {
          label: "present but blank",
          buildPayload: (nonWsDir) => ({ ...realSessionStartPayload(nonWsDir), cwd: "" }),
          ctxCwdIsNonWorkspace: true,
        },
      ];
      for (const row of rows) {
        const fixture = await makeFixture();
        try {
          const nonWsDir = await makeNonWorkspaceDir(fixture.tmp);
          const payload = row.buildPayload(nonWsDir);
          const ctx = ctxFor(fixture, {
            stdinText: JSON.stringify(payload),
            cwd: row.ctxCwdIsNonWorkspace ? nonWsDir : fixture.root,
          });

          const { exitCode, envelope } = await runJsonCommand(["start", "--json"], ctx);
          assert.equal(exitCode, 1, `${row.label}: the outcome is a loud coded refusal (non-zero exit)`);
          assert.ok(envelope, `${row.label}: an envelope was emitted`);
          assert.equal(envelope.ok, false, `${row.label}: the envelope reports failure`);
          assert.equal(envelope.code, "session-cwd-not-workspace", `${row.label}: a stable coded refusal`);

          const ws = await wsFor(fixture);
          const records = await readSessionRecordsForNode(ws, NODE_ID);
          assert.equal(records.length, 0, `${row.label}: no session record is written`);
        } finally {
          await rm(fixture.tmp, { recursive: true, force: true });
        }
      }
    },
  },
];
