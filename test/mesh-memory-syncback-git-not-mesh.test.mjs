// Traceability wiring for milestone 38 / story 08 (worker-verified-memory-syncback,
// ADR-016) — tasks/00_knowledge-rides-git-not-mesh.feature.
//
// Covers every @executable scenario / Outline row: the sync-back payload that reaches
// a checkout is committed markdown (never a companion index artifact); the derived
// graphify recall index stays gitignored + derived + machine-local (a delete + rebuild
// changes nothing recall surfaces); and the mesh frame VOCABULARY — driven from its
// REAL builders (control-stream-server.mjs's down-frames, mesh-relay-client.mjs's up-
// envelope, mesh-relay.mjs's real control-frame over a real ephemeral relay) — carries
// no slot on which the derived recall index could ride. The DEEP source-wide runtime
// guarantee ("no source ANYWHERE attaches index bytes to ANY frame builder") is the
// separate arch-test (test/arch/acd-memory-index-never-on-mesh.test.mjs) — this file
// pins the OBSERVABLE frame-vocabulary contract + the git-observable index facts only
// (the feature's own header comment: "Comment-only here; do NOT restate it as a Then").
//
// Hermetic: a REAL local git checkout (test/support/mesh-memory-syncback-fixture.mjs)
// + the REAL graphify backend's reindex/recall, with the graphify BINARY stubbed absent
// (the CI reality — graphify-reindex.test.mjs's own missingBinaryInvoke idiom) so
// nothing here ever invokes a live graphify/claude-cli process. The down-frame
// producers drive the REAL applyCloneCredentialRequestFrame/applyCloneUrlRequestFrame
// over a REAL seeded global-store assignment row (mirrors
// test/arch/acd-write-token-scoped-to-push.test.mjs's own seedAssignment idiom); the
// control-frame producer spins up a REAL serveRelay on an ephemeral port.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";
import { withMeshMemorySyncbackFixture } from "./support/mesh-memory-syncback-fixture.mjs";
import { seedAssignment } from "./support/mesh-assign-fixture.mjs";
import graphifyBackend from "../src/memory/graphify-backend.mjs";
import { buildDirectiveFrame, applyCloneCredentialRequestFrame, applyCloneUrlRequestFrame } from "../src/control-stream-server.mjs";
import { relayEnvelope } from "../src/mesh-relay-client.mjs";
import { serveRelay } from "../src/mesh-relay.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";

// ------------------------------------------------------------ graphify ctx ----

// The injected invoke that simulates the CI reality: graphify's binary is ABSENT, so
// graph:build throws the structured graphify-missing miss (mirrors
// test/graphify-reindex.test.mjs's missingBinaryInvoke EXACTLY) — the backend still
// rebuilds the RECORDS (fail-soft, 10/ADR-004); NOTHING here ever spawns a real binary
// or invokes an LLM.
function missingBinaryInvoke() {
  return async () => {
    const error = new Error("graphify binary not found — run `aof project provision graphify`.");
    error.code = "graphify-missing";
    error.status = 424;
    throw error;
  };
}

function fakeLoadWorkspace(projectRoot, workDir) {
  return async () => ({
    config: { name: "demo", resources: [], memory: { backend: "graphify" } },
    configPath: path.join(projectRoot, ".aof", "aof.config.json"),
    projectRoot,
    workDir,
  });
}

function graphifyCtxFor(fx) {
  return {
    workDir: fx.workDir,
    projectRoot: fx.root,
    configMemory: { backend: "graphify" },
    invoke: missingBinaryInvoke(),
    loadWorkspace: fakeLoadWorkspace(fx.root, fx.workDir),
  };
}

// ------------------------------------------------------- frame vocabulary ----

// No frame-kind's on-the-wire key set may name a graphify-out/graph.json/normalized-
// index payload, and its produced VALUE content must carry no such reference either.
const INDEX_LEAK_RE = /graphify-out|graph\.json|normalizedindex|graph-index/i;

function assertNoIndexSlot(label, frame, expectedKeys) {
  assert.ok(frame && typeof frame === "object", `${label}: a real frame object was produced by its real builder`);
  assert.deepEqual(
    Object.keys(frame).sort(),
    [...expectedKeys].sort(),
    `${label}: the on-the-wire key/payload set is EXACTLY the documented set — no hidden extra slot on which the derived index could ride`,
  );
  assert.ok(
    !INDEX_LEAK_RE.test(JSON.stringify(frame)),
    `${label}: the produced frame names no graphify-out/graph.json/normalized-index payload`,
  );
}

function captureWs() {
  const state = { frame: null };
  return {
    state,
    ws: { readyState: WebSocket.OPEN, send: (json) => { state.frame = JSON.parse(json); } },
  };
}

async function withSeededAssignmentStore(fn) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-syncback-frame-"));
  const home = path.join(tmp, "home");
  try {
    await seedAssignment(
      { home },
      {
        assignmentId: "asg-syncback-frame",
        itemRef: "97/00",
        workspaceId: "ws-syncback-frame",
        targetNodeId: "worker-frame",
        issuer: "control-frame",
        state: "accepted",
        assignedAt: "2026-07-19T00:00:00.000Z",
      },
    );
    const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
    try {
      return await fn(store);
    } finally {
      store.close();
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// The REAL down-half producer for the clone-credential PULL (control-stream-
// server.mjs's applyCloneCredentialRequestFrame), captured off a fake ws whose
// readyState is OPEN — the only seam the frame ever crosses before reaching the wire.
async function produceCloneCredentialFrame() {
  return withSeededAssignmentStore(async (store) => {
    const capture = captureWs();
    await applyCloneCredentialRequestFrame(
      store,
      { kind: "clone-credential-request", nodeId: "worker-frame", assignmentId: "asg-syncback-frame", workspaceId: "ws-syncback-frame", at: "2026-07-19T00:00:01.000Z" },
      {
        nodeId: "worker-frame",
        directiveTargets: { get: (id) => (id === "worker-frame" ? capture.ws : null), set: () => {} },
        mintCloneCredential: async () => "clone-token-value",
        now: "2026-07-19T00:00:01.000Z",
      },
    );
    return capture.state.frame;
  });
}

async function produceCloneUrlFrame() {
  return withSeededAssignmentStore(async (store) => {
    const capture = captureWs();
    await applyCloneUrlRequestFrame(
      store,
      { kind: "clone-url-request", nodeId: "worker-frame", assignmentId: "asg-syncback-frame", workspaceId: "ws-syncback-frame", at: "2026-07-19T00:00:01.000Z" },
      {
        nodeId: "worker-frame",
        directiveTargets: { get: (id) => (id === "worker-frame" ? capture.ws : null), set: () => {} },
        now: "2026-07-19T00:00:01.000Z",
      },
    );
    return capture.state.frame;
  });
}

function produceDirectiveFrame() {
  return buildDirectiveFrame("worker-frame", { assignmentId: "asg-syncback-frame", itemRef: "97/00", workspaceId: "ws-syncback-frame", at: "2026-07-19T00:00:00.000Z" });
}

function produceUpEnvelope() {
  return relayEnvelope("worker-frame", { heartbeatAt: "2026-07-19T00:00:00.000Z", activeRuns: ["97/00"] });
}

// The REAL { type:'joined' } and { type:'error' } control-frames, driven from a REAL
// ephemeral serveRelay + a REAL ws client (mirrors
// test/mesh-relay-envelope-resilience.test.mjs's own connect idiom).
async function produceControlFrames() {
  const relay = await serveRelay({ port: 0 });
  try {
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(relay.url);
      const seen = { joined: null, error: null };
      const timer = setTimeout(() => reject(new Error("control-frame capture timeout")), 4000);
      ws.on("message", (data) => {
        let parsed = null;
        try { parsed = JSON.parse(data.toString()); } catch { /* ignore */ }
        if (parsed?.type === "joined" && !seen.joined) {
          seen.joined = parsed;
          ws.send("not json at all }{"); // triggers the frozen { type:'error' } control-frame
        } else if (parsed?.type === "error" && !seen.error) {
          seen.error = parsed;
          clearTimeout(timer);
          resolve(seen);
        }
      });
      ws.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
  } finally {
    await relay.stop();
  }
}

export const meshMemorySyncbackGitNotMeshTests = [
  // ====================================================================
  // Scenario: the sync-back payload that reached the checkout is committed markdown,
  // not an index
  // ====================================================================
  {
    name: "mesh-memory-syncback/00 the sync-back payload that reached the checkout is committed markdown, not an index",
    run: async () => {
      await withMeshMemorySyncbackFixture(async (fx) => {
        fx.mergeWorkerBranch(); // "a real local checkout whose merged markdown carries..."

        const trackedBefore = fx.git(["ls-files"]).stdout.split(/\r?\n/).filter(Boolean).map((f) => f.replace(/\\/g, "/"));
        assert.ok(trackedBefore.some((f) => f.endsWith("RETROSPECTIVE.md")), "the RETROSPECTIVE R<n> lesson markdown is git-tracked");
        assert.ok(trackedBefore.some((f) => f.endsWith("ARCHITECTURE.md")), "the ADR-NNN block markdown is git-tracked");

        // Non-vacuous: create REAL derived-index artifacts ON DISK (as a genuine
        // ingest would leave behind), then prove they are STILL absent from git's
        // tracked-file list — `git add -A` stages nothing for them.
        await mkdir(path.join(fx.root, "graphify-out"), { recursive: true });
        await writeFile(path.join(fx.root, "graphify-out", "graph.json"), "{\"nodes\":[],\"edges\":[]}\n", "utf8");
        await mkdir(path.join(fx.root, ".aof"), { recursive: true });
        await writeFile(path.join(fx.root, ".aof", "aof.memory.graphify.index.json"), "{}\n", "utf8");

        fx.git(["add", "-A"]);
        const staged = fx.git(["diff", "--cached", "--name-only"]).stdout.split(/\r?\n/).filter(Boolean);
        assert.deepEqual(staged, [], "git add -A stages NOTHING new — the derived-index artifacts are gitignored, never staged for commit");
        fx.git(["reset", "-q"]); // tidy up the (empty) staging attempt

        const trackedAfter = fx.git(["ls-files"]).stdout.split(/\r?\n/).filter(Boolean).map((f) => f.replace(/\\/g, "/"));
        assert.ok(!trackedAfter.some((f) => f.includes("graphify-out")), "graphify-out/graph.json is NOT among the git-tracked files, even though it exists on disk");
        assert.ok(!trackedAfter.some((f) => f.endsWith("aof.memory.graphify.index.json")), "the derived record store is NOT among the git-tracked files either");
        assert.ok(
          trackedAfter.some((f) => f.endsWith("RETROSPECTIVE.md")) && trackedAfter.some((f) => f.endsWith("ARCHITECTURE.md")),
          "the knowledge is fully present in the committed markdown alone, with no companion index artifact travelling beside it",
        );
      });
    },
  },

  // ====================================================================
  // Scenario: the recall-index path stays gitignored + derived + machine-local
  // ====================================================================
  {
    name: "mesh-memory-syncback/00 the recall-index path stays gitignored + derived + machine-local",
    run: async () => {
      await withMeshMemorySyncbackFixture(async (fx) => {
        fx.mergeWorkerBranch();
        const ctx = graphifyCtxFor(fx);
        await graphifyBackend.reindex(null, ctx); // "the control node's aof work memory ingest has rebuilt its own graphify-out/ index"

        // A real derived graph artifact on disk (what a genuine graph:build would
        // have left, absent the live binary here).
        await mkdir(path.join(fx.root, "graphify-out"), { recursive: true });
        await writeFile(path.join(fx.root, "graphify-out", "graph.json"), "{\"nodes\":[],\"edges\":[]}\n", "utf8");

        const ignoreCheck = spawnSyncHardened("git", ["check-ignore", "-q", "graphify-out/graph.json"], { cwd: fx.root });
        assert.equal(ignoreCheck.status, 0, "graphify-out/graph.json is recognised as git-ignored (.gitignore:4 graphify-out/, enforced by src/aof-gitignore.mjs)");
        const tracked = fx.git(["ls-files"]).stdout.split(/\r?\n/).filter(Boolean).map((f) => f.replace(/\\/g, "/"));
        assert.ok(!tracked.some((f) => f.includes("graphify-out")), "graphify-out/graph.json is untracked");

        const before = await graphifyBackend.recall("zephyrlesson", {}, {}, ctx);
        const beforeHit = before.records.find((r) => r.id === "R9");
        assert.ok(beforeHit, "the worker-authored lesson is recallable before the delete");

        // "When I delete graphify-out/ and re-run aof work memory ingest over the same markdown"
        await rm(path.join(fx.root, "graphify-out"), { recursive: true, force: true });
        const rebuilt = await graphifyBackend.reindex(null, ctx);
        assert.ok(rebuilt.recordCount > 0, "the index is rebuilt purely from the .md — it carries no fact absent from the markdown (m10/ADR-005)");

        const after = await graphifyBackend.recall("zephyrlesson", {}, {}, ctx);
        const afterHit = after.records.find((r) => r.id === "R9");
        assert.ok(afterHit, "aof work memory recall still surfaces the worker-authored record after the delete + rebuild");
        assert.deepEqual(
          { recordType: afterHit.recordType, id: afterHit.id, title: afterHit.title, area: afterHit.area, summary: afterHit.summary, source: afterHit.source, score: afterHit.score },
          { recordType: beforeHit.recordType, id: beforeHit.id, title: beforeHit.title, area: beforeHit.area, summary: beforeHit.summary, source: beforeHit.source, score: beforeHit.score },
          'aof work memory recall "<the worker lesson\'s keywords>" returns the SAME worker-authored record as before the delete',
        );
      });
    },
  },

  // ====================================================================
  // Scenario Outline: no frame kind in the mesh vocabulary carries an index/graph
  // payload — Examples: the down-frames (control -> worker)
  // ====================================================================
  {
    name: "mesh-memory-syncback/00 no frame kind in the mesh vocabulary carries an index/graph payload — directive (buildDirectiveFrame — the frozen five keys)",
    run: async () => {
      const frame = produceDirectiveFrame();
      assertNoIndexSlot("directive", frame, ["kind", "to", "assignmentId", "itemRef", "workspaceId", "at"]);
    },
  },
  {
    name: "mesh-memory-syncback/00 no frame kind in the mesh vocabulary carries an index/graph payload — clone-credential (the additive down-frame)",
    run: async () => {
      const frame = await produceCloneCredentialFrame();
      assertNoIndexSlot("clone-credential", frame, ["kind", "to", "assignmentId", "credential", "at"]);
    },
  },
  {
    name: "mesh-memory-syncback/00 no frame kind in the mesh vocabulary carries an index/graph payload — clone-url (the additive down-frame)",
    run: async () => {
      const frame = await produceCloneUrlFrame();
      assertNoIndexSlot("clone-url", frame, ["kind", "to", "assignmentId", "cloneUrl", "at"]);
    },
  },

  // ====================================================================
  // Scenario Outline: no frame kind in the mesh vocabulary carries an index/graph
  // payload — Examples: the up-traffic + control-frames
  // ====================================================================
  {
    name: "mesh-memory-syncback/00 no frame kind in the mesh vocabulary carries an index/graph payload — the worker up-envelope { kind, nodeId, signal }",
    run: async () => {
      const frame = produceUpEnvelope();
      assertNoIndexSlot("worker up-envelope", frame, ["kind", "nodeId", "signal"]);
    },
  },
  {
    name: "mesh-memory-syncback/00 no frame kind in the mesh vocabulary carries an index/graph payload — the { type } control-frame (joined / error)",
    run: async () => {
      const { joined, error } = await produceControlFrames();
      assertNoIndexSlot("control-frame (joined)", joined, ["type"]);
      assertNoIndexSlot("control-frame (error)", error, ["type", "message"]);
    },
  },
];
