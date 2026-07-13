// Traceability wiring for milestone 38 / story 00
// tasks/08_bug-web-fleet-presence-plumbing.feature — finding F6 (aof:verify 38,
// BLOCKER): the web fleet's ONE read route (`GET /api/mesh/status`, served by
// src/mesh-ui-serve.mjs through src/global-mesh-query.mjs's queryGlobalMeshStatus)
// carried NO `presence` key on any node object, so ui/src/fleet/Fleet.tsx's
// `fleetCurrentWorkLines(node.presence ?? {})` always received `{}` and row 3
// always rendered `idle` — even with a REAL live coding-assistant session on disk.
//
// "The assertion whose absence let this ship" (the feature's own @qa note): the
// REAL route payload, fed to the REAL card projection, must yield the working
// line. Every fixture below is the ROUTE'S ACTUAL JSON response — never a
// hand-built presence record — closing the exact fixture-vs-producer gap F1/F4/F6
// share (task 04's render test and the design-review server both fed
// fleetCurrentWorkLines a convenience fixture shaped to its own producer, never
// the real one).
//
// FOLLOW-ON finding F9 (aof:verify 38, found by a headless-Chromium render AFTER
// F6 landed): F6 put `presence` on the wire, but `ui/src/fleet/Fleet.tsx`'s
// `isGlobalStatus(status)` is ALWAYS true for a real `/api/mesh/status` response
// (mesh-ui-serve.mjs serves BOTH scopes from queryGlobalMeshStatus, whose payload
// always carries `workspaces`) — so production ALWAYS renders `GlobalScopeView` →
// `GlobalNodePanel`, and NEVER the `NodeCard` that calls `fleetCurrentWorkLines`.
// `GlobalNodePanel` had no current-work line at all. The fix wires
// `GlobalNodePanel` to the SAME projection through a new node:test-exercisable
// wrapper, `nodeCurrentWork` (ui/src/fleet/scope.mjs) — this file's F9 block
// asserts THAT wrapper (the one the actually-rendered component calls) over the
// real route payload, not the dead `NodeCard`.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../src/global-node-registry.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import { publishPresenceRecord, assemblePresenceRecord } from "../src/mesh-presence.mjs";
// ui/src/fleet/runs.mjs's fleetCurrentWorkLines — the SAME pure projection
// ui/src/fleet/Fleet.tsx:631 (NodeCard) hands `node.presence ?? {}` to. Imported
// directly (node:test has no React harness in this repo, the house pattern —
// see test/mesh-fleet-session-render.test.mjs).
import { fleetCurrentWorkLines } from "../ui/src/fleet/runs.mjs";
// finding F9 — nodeCurrentWork (ui/src/fleet/scope.mjs) is the EXACT function
// GlobalNodePanel calls to derive row 3 in production; asserting THIS function
// (not a re-implemented/parallel call to fleetCurrentWorkLines) closes the
// component-vs-test drift the finding names.
import { nodeCurrentWork } from "../ui/src/fleet/scope.mjs";

// --- fixtures (mesh-ui-global-scope.test.mjs idiom — a minimal REAL ui/dist so
// serveMeshUi's build-missing guard is satisfied without depending on a real
// `npm run ui:build`) ------------------------------------------------------------

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/assets/index-abc123.js\"></script></head><body><div id=\"root\"></div></body></html>\n",
    "utf8"
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
  return dir;
}

async function makeRepoRootWithDist() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-fleet-presence-root-"));
  await writeDist(meshUiDist(root));
  return root;
}

async function makeWorkspace(root, { name = path.basename(root), nodeId, env }) {
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh: { enabled: true, nodeId } }, null, 2)}\n`,
    "utf8",
  );
  return loadWorkspace(root, undefined, { env });
}

async function seedNode(ws, nodeId, fields = {}) {
  await publishNodeRecord(ws, nodeId, {
    nodeId,
    host: fields.host ?? nodeId,
    os: fields.os ?? "win32",
    runtimes: fields.runtimes ?? ["claude-code"],
    skills: fields.skills ?? [],
    aofVersion: fields.aofVersion ?? "1.0.0",
    publishedAt: fields.publishedAt ?? "2026-07-10T10:00:00.000Z",
  });
}

function session(workspaceId, repo) {
  return { workspaceId, repo, assistant: "claude-code", lastPingAt: new Date().toISOString() };
}

// Publish a node's presence record through the SAME assembler the real daemon
// publishes through (mesh-launcher.mjs's assembleCurrentPresenceRecord) — the
// frozen five-key shape, `heartbeatAt` defaulting to "now" so the freshness ramp
// reads "live" against the server's own wall-clock `now` (no injected clock on
// this route).
async function seedPresence(ws, nodeId, { activeRuns = [], sessions = [] } = {}) {
  const record = assemblePresenceRecord({
    nodeId,
    heartbeatAt: new Date().toISOString(),
    activeRuns,
    sessions,
    aofVersion: "1.0.0",
  });
  await publishPresenceRecord(ws, nodeId, record);
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function cleanup(...dirs) {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}

// Build the fixture this whole file drives: ONE workspace/node roster carrying
// every row-3 state at once (idle / one-repo session / two-repo session /
// active-run / never-beat), published through the REAL registry publish path
// (publishGlobalRegistryDescriptorsToStore) so `/api/mesh/status`'s response is
// the actual producer's output, not a stand-in.
async function buildFixture(home) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-fleet-presence-store-"));
  const env = { AOF_GLOBAL_HOME: home };
  const ws = await makeWorkspace(path.join(tmp, "alpha"), { nodeId: "node-idle", env });

  await seedNode(ws, "node-idle");
  await seedNode(ws, "node-one-session");
  await seedNode(ws, "node-two-sessions");
  await seedNode(ws, "node-running");
  await seedNode(ws, "node-never-beat");

  // Sessions are minted ONCE here (not re-derived at assertion time) so the test
  // can assert `sessions[] travels through EXACTLY as the publisher emitted it`
  // against the SAME object, not a freshly-timestamped lookalike.
  const oneSession = [session("ws-A", "repoA")];
  const twoSessions = [session("ws-A", "repoA"), session("ws-B", "repoB")];

  // node-idle: presence published, but no runs/no sessions ⇒ row 3 reads `idle`.
  await seedPresence(ws, "node-idle", { activeRuns: [], sessions: [] });
  // node-one-session: a single live session on one repo, no run.
  await seedPresence(ws, "node-one-session", { sessions: oneSession });
  // node-two-sessions: live sessions on two repos, no run.
  await seedPresence(ws, "node-two-sessions", { sessions: twoSessions });
  // node-running: an active run — ADR-004 the run wins the primary line.
  await seedPresence(ws, "node-running", { activeRuns: ["run-1"], sessions: [] });
  // node-never-beat: NO presence record published at all (never beat).

  const store = await openGlobalWorkProjectionStore({ env });
  try {
    await publishGlobalRegistryDescriptorsToStore(store, ws, { now: "2026-07-10T10:05:00.000Z" });
  } finally {
    store.close();
  }
  return { tmp, ws, oneSession, twoSessions };
}

export const meshFleetPresencePlumbingTests = [
  // ══ Scenario: the fleet read route carries each node's presence record ══
  {
    name: "mesh-fleet-presence-plumbing/08 the fleet read route carries each node's presence record (frozen five-key order, sessions verbatim, freshness unchanged)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-fleet-presence-home-"));
      const root = await makeRepoRootWithDist();
      let server;
      try {
        const { tmp, oneSession } = await buildFixture(home);
        try {
          ({ server } = await serveMeshUi({
            projectDir: tmp,
            port: 0,
            repoRoot: root,
            scope: "global",
            globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          }));
          const address = server.address();
          const response = await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`);
          assert.equal(response.status, 200);
          const body = await response.json();

          const node = body.nodes.find((n) => n.nodeId === "node-one-session");
          assert.ok(node, "node-one-session surfaces in the roster");
          assert.ok(node.presence, "the node object carries a presence key");
          assert.deepEqual(
            Object.keys(node.presence),
            ["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion"],
            "presence is the frozen FIVE-key record, in ADR-001 order",
          );
          assert.deepEqual(
            node.presence.sessions,
            oneSession,
            "sessions[] holds the node's live sessions exactly as the publisher emitted them",
          );

          // The pre-existing freshness ramp is UNCHANGED — additive, not replaced.
          assert.ok(
            ["live", "stale", "unknown"].includes(node.freshness),
            "the freshness ramp still renders alongside the new presence key",
          );
          assert.equal(node.freshness, "live", "a just-published heartbeat reads live, exactly as before this fix");
        } finally {
          await cleanup(tmp);
        }
      } finally {
        if (server) await closeServer(server);
        await cleanup(home, root);
      }
    },
  },

  // ══ Scenario: the real route payload, fed to the real card projection, renders the session ══
  {
    name: "mesh-fleet-presence-plumbing/08 the real route payload, fed to fleetCurrentWorkLines, renders `working · <repo> (session)` with the primary token",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-fleet-presence-home2-"));
      const root = await makeRepoRootWithDist();
      let server;
      try {
        const { tmp } = await buildFixture(home);
        try {
          ({ server } = await serveMeshUi({
            projectDir: tmp,
            port: 0,
            repoRoot: root,
            scope: "global",
            globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          }));
          const address = server.address();
          // The ACTUAL JSON body /api/mesh/status returns — never a hand-built fixture.
          const body = await (await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`)).json();
          const node = body.nodes.find((n) => n.nodeId === "node-one-session");

          // ui/src/fleet/Fleet.tsx:631's EXACT call.
          const rendered = fleetCurrentWorkLines(node.presence);
          assert.deepEqual(rendered.lines, ["working · repoA (session)"]);
          assert.equal(rendered.token, "primary", "the token is primary, not the muted idle token");
          assert.equal(rendered.state, "working");
        } finally {
          await cleanup(tmp);
        }
      } finally {
        if (server) await closeServer(server);
        await cleanup(home, root);
      }
    },
  },

  // ══ Scenario Outline: every row-3 state survives the real route end to end ══
  // ══ + Scenario: a node that never beat still degrades cleanly ══
  {
    name: "mesh-fleet-presence-plumbing/08 every row-3 state survives the real route end to end (idle / one repo / two repos / run-wins / never-beat)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-fleet-presence-home3-"));
      const root = await makeRepoRootWithDist();
      let server;
      try {
        const { tmp } = await buildFixture(home);
        try {
          ({ server } = await serveMeshUi({
            projectDir: tmp,
            port: 0,
            repoRoot: root,
            scope: "global",
            globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          }));
          const address = server.address();
          const body = await (await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`)).json();
          const byId = new Map(body.nodes.map((n) => [n.nodeId, n]));

          const rows = [
            { nodeId: "node-idle", lines: ["idle"], token: "muted" },
            { nodeId: "node-one-session", lines: ["working · repoA (session)"], token: "primary" },
            { nodeId: "node-two-sessions", lines: ["working · repoA, repoB (session)"], token: "primary" },
            { nodeId: "node-running", lines: ["running 1 run"], token: "primary" },
          ];
          for (const row of rows) {
            const node = byId.get(row.nodeId);
            assert.ok(node, `${row.nodeId} surfaces in the roster`);
            assert.ok(node.presence, `${row.nodeId} carries a presence key`);
            const rendered = fleetCurrentWorkLines(node.presence);
            assert.deepEqual(rendered.lines, row.lines, `${row.nodeId} row 3`);
            assert.equal(rendered.token, row.token, `${row.nodeId} token`);
          }

          // A node that never beat still degrades cleanly — the wire OMITS
          // `presence` entirely (never a fabricated empty record), and the SAME
          // card projection NodeCard applies (`node.presence ?? {}`) renders idle
          // without throwing.
          const neverBeat = byId.get("node-never-beat");
          assert.ok(neverBeat, "node-never-beat surfaces in the roster");
          assert.equal("presence" in neverBeat, false, "a never-beat node's presence key is absent, not null/empty");
          const rendered = fleetCurrentWorkLines(neverBeat.presence ?? {});
          assert.deepEqual(rendered.lines, ["idle"]);
          assert.equal(rendered.token, "muted");
        } finally {
          await cleanup(tmp);
        }
      } finally {
        if (server) await closeServer(server);
        await cleanup(home, root);
      }
    },
  },

  // ══ Scenario: both scopes carry it ══
  {
    name: "mesh-fleet-presence-plumbing/08 both `?scope=global` and `?scope=local` carry the presence record (one queryGlobalMeshStatus source)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-fleet-presence-home4-"));
      const root = await makeRepoRootWithDist();
      let server;
      try {
        const { tmp } = await buildFixture(home);
        try {
          ({ server } = await serveMeshUi({
            projectDir: tmp,
            port: 0,
            repoRoot: root,
            scope: "global",
            globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          }));
          const address = server.address();

          const globalBody = await (await fetch(`http://127.0.0.1:${address.port}/api/mesh/status?scope=global`)).json();
          assert.equal(globalBody.scope, "global");
          const globalNode = globalBody.nodes.find((n) => n.nodeId === "node-one-session");
          assert.ok(globalNode.presence, "scope=global carries presence");

          const localBody = await (await fetch(`http://127.0.0.1:${address.port}/api/mesh/status?scope=local`)).json();
          assert.equal(localBody.scope, "local");
          const localNode = localBody.nodes.find((n) => n.nodeId === "node-one-session");
          assert.ok(localNode.presence, "scope=local carries presence (the node roster is machine-wide either way)");
          assert.deepEqual(localNode.presence, globalNode.presence, "both scopes read the SAME presence — one queryGlobalMeshStatus source");
        } finally {
          await cleanup(tmp);
        }
      } finally {
        if (server) await closeServer(server);
        await cleanup(home, root);
      }
    },
  },

  // ══════════════════════════ finding F9 ══════════════════════════════════════
  // The card production ACTUALLY renders (GlobalNodePanel, since isGlobalStatus
  // is always true for a real route response) now derives row 3 — asserted via
  // nodeCurrentWork, the exact wrapper that component calls, fed the real route
  // payload. Never NodeCard (the dead component) as a stand-in.

  {
    name: "mesh-fleet-presence-plumbing/09 nodeCurrentWork — the ACTUALLY-rendered global node panel's row-3 derivation — survives every state through the real route",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-fleet-presence-home5-"));
      const root = await makeRepoRootWithDist();
      let server;
      try {
        const { tmp } = await buildFixture(home);
        try {
          ({ server } = await serveMeshUi({
            projectDir: tmp,
            port: 0,
            repoRoot: root,
            scope: "global",
            globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          }));
          const address = server.address();
          const body = await (await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`)).json();
          const byId = new Map(body.nodes.map((n) => [n.nodeId, n]));

          const rows = [
            { nodeId: "node-idle", lines: ["idle"], token: "muted" },
            { nodeId: "node-one-session", lines: ["working · repoA (session)"], token: "primary" },
            { nodeId: "node-two-sessions", lines: ["working · repoA, repoB (session)"], token: "primary" },
            { nodeId: "node-running", lines: ["running 1 run"], token: "primary" },
          ];
          for (const row of rows) {
            const node = byId.get(row.nodeId);
            assert.ok(node, `${row.nodeId} surfaces in the roster`);
            // The EXACT call GlobalNodePanel makes (Fleet.tsx: `nodeCurrentWork(node)`),
            // over the node object exactly as `/api/mesh/status` returned it.
            const rendered = nodeCurrentWork(node);
            assert.deepEqual(rendered.lines, row.lines, `${row.nodeId} row 3 (via the production card's own derivation)`);
            assert.equal(rendered.token, row.token, `${row.nodeId} token`);
          }

          // A never-beat node — GlobalNodePanel must render `idle`, never throw,
          // even though `presence` is entirely absent from the wire.
          const neverBeat = byId.get("node-never-beat");
          assert.ok(neverBeat, "node-never-beat surfaces in the roster");
          assert.equal("presence" in neverBeat, false, "a never-beat node's presence key is absent on the global shape too");
          const rendered = nodeCurrentWork(neverBeat);
          assert.deepEqual(rendered.lines, ["idle"]);
          assert.equal(rendered.token, "muted");
        } finally {
          await cleanup(tmp);
        }
      } finally {
        if (server) await closeServer(server);
        await cleanup(home, root);
      }
    },
  },

  {
    name: "mesh-fleet-presence-plumbing/09 nodeCurrentWork agrees byte-for-byte with fleetCurrentWorkLines — one collapse rule, no fork, for the component the app actually mounts",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-fleet-presence-home6-"));
      const root = await makeRepoRootWithDist();
      let server;
      try {
        const { tmp } = await buildFixture(home);
        try {
          ({ server } = await serveMeshUi({
            projectDir: tmp,
            port: 0,
            repoRoot: root,
            scope: "global",
            globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
          }));
          const address = server.address();
          const body = await (await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`)).json();

          for (const node of body.nodes) {
            assert.deepEqual(
              nodeCurrentWork(node),
              fleetCurrentWorkLines(node.presence ?? {}),
              `${node.nodeId}: GlobalNodePanel's derivation matches NodeCard's — no divergent collapse rule`,
            );
          }
        } finally {
          await cleanup(tmp);
        }
      } finally {
        if (server) await closeServer(server);
        await cleanup(home, root);
      }
    },
  },
];
