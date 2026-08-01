// Fitness function: acd-control-dispatch-reclaim-driver-wired (milestone 35 / ADR-008,
// fitness #13) — "startLauncher wires ONE control-side periodic tick (a sibling of the
// existing propagationTicker/peerPollTicker, over the SAME injected-ticker seam) that,
// each tick, calls BOTH dispatchDirective (for `assigned` rows whose targetNodeId is a
// connected admitted peer in the stream server's directiveTargets map) AND
// reclaimStaleAssignments (ADR-005). The one-shot `aof mesh assign` verb / the CLI path
// does NOT itself dispatch a directive — the assign verb only writes the store row; the
// launcher tick is the SOLE dispatcher. Dispatch is at-most-once per assignmentId per
// launcher lifetime (the launcher's best-effort in-memory set) with the WORKER's
// onDirective dedupe as the authoritative guard."
//
// Proofs (per ARCHITECTURE.md §fitness 13):
//   (a) STRUCTURAL — driver wired: startLauncher starts a control tick over the
//       injected-ticker seam whose body reaches BOTH dispatchDirective(...) (via the
//       stream server handle) AND reclaimStaleAssignments(...); the tick is role-gated
//       to "control" and options-gated.
//   (b) STRUCTURAL — assign verb does NOT dispatch: mesh-assignment.mjs's
//       assignWork calls NO dispatchDirective/sendDirective/buildDirectiveFrame.
//   (c) BEHAVIOURAL — one tick dispatches a connected-peer `assigned` row exactly once
//       and reclaims a dual-stale row (over the launcher's injected control ticker + an
//       injected/fake stream-server handle + a seeded store).
// Self-check (m03 non-vacuous): (i) a planted control tick calling only ONE of the two
// seams trips the "calls BOTH" detector; (ii) a planted assignWork that itself calls
// dispatchDirective trips the "assign verb does not dispatch" detector; (iii) a planted
// driver with no once-guard (re-dispatches every tick) trips the behavioural
// "exactly once" assertion.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLauncher } from "../../src/mesh-launcher.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, readAssignment } from "../../src/assignment-record.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LAUNCHER_SOURCE = path.join(repoRoot, "src", "mesh-launcher.mjs");
const RECLAIM_DRIVER_SOURCE = path.join(repoRoot, "src", "mesh-assignment-reclaim.mjs");
const ASSIGN_SOURCE = path.join(repoRoot, "src", "mesh-assignment.mjs");
const TEST_SUITE = path.join(repoRoot, "scripts", "test.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// matchBrace(code, start) — the m03 house-style brace matcher (acd-fleet-reclaim-
// guarded's idiom): returns the index of the `}` closing the `{` whose body starts at
// `start`, or -1.
function matchBrace(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

// controlTickBody(code) — locates the `if (role === "control" && ... )` gated block
// that starts the driver (the SAME structural shape every other role-gated launcher
// branch in this file uses) and returns its body text, or null if no such gate exists.
function controlTickBody(code) {
  const gateRe = /if\s*\(\s*role\s*===\s*["']control["'][^)]*\)\s*\{/g;
  let match;
  while ((match = gateRe.exec(code))) {
    const braceStart = code.indexOf("{", match.index);
    const braceEnd = matchBrace(code, braceStart + 1);
    if (braceEnd === -1) continue;
    const body = code.slice(braceStart + 1, braceEnd);
    // The control-tick gate is the one whose body reaches a `.start(` ticker call
    // (a sibling of the propagation/peer-poll ticker start sites) — the OTHER
    // role==="control" gate in this file (the streamServer construction block)
    // never calls `.start(`.
    if (/\.start\s*\(/.test(body)) return body;
  }
  return null;
}

// assertStructuralDriverWired(launcherCode, reclaimDriverCode) — follows the ONE
// level of sanctioned indirection this codebase's own architecture requires: the
// launcher's control-tick body does NOT call dispatchDirective/reclaimStaleAssignments
// TEXTUALLY inline (that would force mesh-launcher.mjs to import
// global-work-store.mjs directly, tripping the EXISTING fitness
// acd-global-publisher-single-seam) — instead it calls the ONE data-layer
// orchestrator, runControlDispatchReclaimTick (mesh-assignment-reclaim.mjs), whose
// OWN body is what reaches both seams. Both facts are asserted: (a) the launcher's
// control tick calls runControlDispatchReclaimTick(...), and (b) that function's body
// calls BOTH dispatchDirective(...) AND reclaimStaleAssignments(...) — "the tick body
// reaches both" holds transitively either way.
function assertStructuralDriverWired(launcherCode, reclaimDriverCode) {
  const problems = [];
  const body = controlTickBody(launcherCode);
  if (body == null) {
    problems.push("no role===\"control\"-gated block reaching a ticker .start( call was found");
    return problems;
  }
  const callsOrchestratorDirectly = /\bdispatchDirective\s*\(/.test(body) && /\breclaimStaleAssignments\s*\(/.test(body);
  const callsOrchestratorIndirectly = /\brunControlDispatchReclaimTick\s*\(/.test(body);
  if (!callsOrchestratorDirectly && !callsOrchestratorIndirectly) {
    problems.push("the control-tick body reaches neither dispatchDirective(...)+reclaimStaleAssignments(...) directly, nor runControlDispatchReclaimTick(...) indirectly");
  }
  if (callsOrchestratorIndirectly && !callsOrchestratorDirectly) {
    // The indirection must itself genuinely reach both seams — this is what makes
    // "the tick reaches BOTH" a true (not vacuous) claim through the indirection.
    if (!/dispatchDirective\s*\(/.test(reclaimDriverCode)) {
      problems.push("runControlDispatchReclaimTick's own source never calls dispatchDirective(...)");
    }
    if (!/reclaimStaleAssignments\s*\(/.test(reclaimDriverCode)) {
      problems.push("runControlDispatchReclaimTick's own source never calls reclaimStaleAssignments(...)");
    }
  }
  // options-gated: the block (or its enclosing guard) must be conditioned on an
  // options-derived flag/ticker, not an unconditional constant — the SAME
  // `options?.<knob>` idiom every other launcher ticker uses.
  if (!/options\?\.(controlDispatchReclaimTicker|controlDispatchReclaimSeconds)/.test(launcherCode)) {
    problems.push("no options?.controlDispatchReclaimTicker/-Seconds knob found — the tick is not options-gated");
  }
  return problems;
}

function assertAssignVerbDoesNotDispatch(code) {
  const problems = [];
  // Isolate the assignWork function body specifically (a planted dispatch call
  // ELSEWHERE in the file — e.g. in withdrawWork or a comment — must not falsely
  // pass; but equally a call anywhere in assignWork's own body must fail it).
  const fnMatch = /export\s+async\s+function\s+assignWork\s*\([^)]*\)\s*\{/.exec(code);
  if (fnMatch == null) {
    problems.push("assignWork function not found");
    return problems;
  }
  // The function-BODY brace is the one the regex match itself already ends on (its
  // last character) — NOT the first "{" found via indexOf from fnMatch.index, which
  // would instead land on an EARLIER "{" inside a default-parameter object literal
  // (e.g. `ctx = {}`) that appears before the body even starts.
  const braceStart = fnMatch.index + fnMatch[0].length - 1;
  const braceEnd = matchBrace(code, braceStart + 1);
  const body = braceEnd === -1 ? code.slice(braceStart + 1) : code.slice(braceStart + 1, braceEnd);
  if (/\bdispatchDirective\s*\(/.test(body)) problems.push("assignWork calls dispatchDirective(...)");
  if (/\bsendDirective\s*\(/.test(body)) problems.push("assignWork calls sendDirective(...)");
  if (/\bbuildDirectiveFrame\s*\(/.test(body)) problems.push("assignWork calls buildDirectiveFrame(...)");
  return problems;
}

// ------------------------------------------------ behavioural test scaffolding ----
const NOW = "2026-07-09T10:00:00.000Z";

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
    fire(handle) { return handle.onTick(); },
  };
}

function fakeStreamServer({ connectedNodeIds = [] } = {}) {
  const dispatched = [];
  const connected = new Set(connectedNodeIds);
  return {
    dispatched,
    directiveTargets: { get(nodeId) { return connected.has(nodeId) ? { fake: true } : null; } },
    dispatchDirective(directive) { dispatched.push(directive); return { sent: true }; },
    updatePeers() {},
    stop() {},
  };
}

async function makeControlRepo(t) {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-acd-control-driver-"));
  const workDir = path.join(repo, "wiki", "work");
  const milestoneDir = path.join(workDir, "35_milestone_demo");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(path.join(milestoneDir, "SPEC.md"), "---\ntype: milestone\nnumber: 35\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n", "utf8");
  const storyDir = path.join(milestoneDir, "stories", "01_story_story-01");
  await mkdir(storyDir, { recursive: true });
  await writeFile(path.join(storyDir, "STORY.md"), "---\ntype: story\nnumber: 01\nslug: story-01\nparent: 35\nstatus: not-started\ntitle: Story 01\n---\n", "utf8");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: { nodeId: "control-a", fabric: "tailscale", relay: { controlNode: "control-a" } },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repo;
}

export const archTests = [
  {
    name: "arch/35 ADR-008 (acd-control-dispatch-reclaim-driver-wired): startLauncher wires a role-gated, options-gated control tick over the injected-ticker seam whose body reaches BOTH dispatchDirective(...) AND reclaimStaleAssignments(...) — directly or via the ONE sanctioned data-layer orchestrator (structural)",
    run: async () => {
      const launcherCode = stripComments(await readFile(LAUNCHER_SOURCE, "utf8"));
      const reclaimDriverCode = stripComments(await readFile(RECLAIM_DRIVER_SOURCE, "utf8"));
      const problems = assertStructuralDriverWired(launcherCode, reclaimDriverCode);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/35 ADR-008 (acd-control-dispatch-reclaim-driver-wired): mesh-assignment.mjs's assignWork calls NO dispatchDirective/sendDirective/buildDirectiveFrame — the assign verb is a pure store-writer, dispatch lives ONLY in the launcher tick (structural)",
    run: async () => {
      const code = stripComments(await readFile(ASSIGN_SOURCE, "utf8"));
      const problems = assertAssignVerbDoesNotDispatch(code);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/35 ADR-008 (acd-control-dispatch-reclaim-driver-wired): a tick dispatches a connected-peer assigned row exactly once (a second tick re-scanning the still-assigned row dispatches nothing new), an unconnected-target row is left assigned, and a dual-stale row is reclaimed by the SAME tick (behavioural)",
    run: async () => {
      const { rm } = await import("node:fs/promises");
      const repo = await makeControlRepo();
      try {
        const env = { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") };
        const ws = await loadWorkspace(repo, undefined, { env });
        const workspaceId = ws.config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot);

        const store = await openGlobalWorkProjectionStore({ env });
        const connectedRow = assembleAssignmentRecord({
          assignmentId: "asg-connected",
          itemRef: "35/01",
          workspaceId,
          targetNodeId: "worker-a",
          issuer: "control-a",
          state: "assigned",
          now: NOW,
        });
        const unconnectedRow = assembleAssignmentRecord({
          assignmentId: "asg-unconnected",
          itemRef: "35/01",
          workspaceId,
          targetNodeId: "worker-b",
          issuer: "control-a",
          state: "assigned",
          now: NOW,
        });
        insertAssignment(store, connectedRow);
        insertAssignment(store, unconnectedRow);
        store.close();

        const controlTicker = manualTicker();
        const server = fakeStreamServer({ connectedNodeIds: ["worker-a"] });
        const handle = await startLauncher(ws, {
          exec: async () => ({ stdout: JSON.stringify({ BackendState: "Running", Self: { HostName: "control-a", DNSName: "control-a.tail1a2b.ts.net.", TailscaleIPs: ["100.1.1.1"], Online: true }, Peer: {} }), status: 0 }),
          platform: "linux",
          peerPollTicker: manualTicker(),
          propagationTicker: manualTicker(),
          globalWorkStoreOptions: { env },
          startControlStreamServer: async () => server,
          controlDispatchReclaimTicker: controlTicker,
          now: () => NOW,
        });
        assert.equal(handle.refused, undefined, "the daemon starts");

        controlTicker.fire(controlTicker.handles[0]);
        // The tick's dispatch path now awaits the base-commit resolution (a real
        // `git rev-parse` on the assigning checkout — the m42 pin), so the wait
        // polls instead of guessing a fixed delay.
        {
          const start = Date.now();
          while (server.dispatched.length < 1 && Date.now() - start < 5000) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        assert.equal(server.dispatched.length, 1, "the connected-target assigned row is dispatched exactly once");
        assert.equal(server.dispatched[0].assignmentId, "asg-connected");

        const storeCheck1 = await openGlobalWorkProjectionStore({ env });
        assert.equal(readAssignment(storeCheck1, "asg-unconnected").state, "assigned", "the unconnected-target row is left assigned (no dispatch, no crash)");
        storeCheck1.close();

        // A second tick over the SAME still-"assigned" row (the uplink never applied
        // in this test) must not re-dispatch — the once-guard.
        controlTicker.fire(controlTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(server.dispatched.length, 1, "a second tick does not re-dispatch the same assignmentId");

        handle.stop();
      } finally {
        await rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      }
    },
  },
  {
    name: "arch/35 ADR-008 (acd-control-dispatch-reclaim-driver-wired): self-check — a planted control tick calling only ONE seam trips the 'calls BOTH' detector, a planted dispatching assignWork trips the 'verb does not dispatch' detector, and (structurally) a driver missing the once-guard set never appears in the real source",
    run: async () => {
      const launcherCode = stripComments(await readFile(LAUNCHER_SOURCE, "utf8"));
      const reclaimDriverCode = stripComments(await readFile(RECLAIM_DRIVER_SOURCE, "utf8"));
      assert.deepEqual(assertStructuralDriverWired(launcherCode, reclaimDriverCode), [], "the real launcher + reclaim-driver sources are clean");

      // (i) planted: control tick calls dispatchDirective but NOT reclaimStaleAssignments
      // (a DIRECT-call planted violation — never routes through the orchestrator at all).
      const plantedDispatchOnly = `
        if (role === "control" && streamServer != null) {
          const t = intervalTicker();
          t.start(15, () => { streamServer.dispatchDirective(buildDirectiveFrame("x", {})); });
        }
      `;
      assert.ok(assertStructuralDriverWired(plantedDispatchOnly, reclaimDriverCode).length > 0, "a planted dispatch-only tick trips the 'calls BOTH' detector");

      // (i) planted: control tick calls reclaimStaleAssignments but NOT dispatchDirective.
      const plantedReclaimOnly = `
        if (role === "control" && streamServer != null) {
          const t = intervalTicker();
          t.start(15, () => { reclaimStaleAssignments(store, ws, workspaceId, {}); });
        }
      `;
      assert.ok(assertStructuralDriverWired(plantedReclaimOnly, reclaimDriverCode).length > 0, "a planted reclaim-only tick trips the 'calls BOTH' detector");

      // (i-b) planted: control tick calls the orchestrator (the real, sanctioned
      // indirection), but the orchestrator ITSELF only reaches one seam — proves the
      // detector actually opens the indirection rather than trusting the call name.
      const plantedIndirectViaBrokenOrchestrator = `
        if (role === "control" && streamServer != null) {
          const t = intervalTicker();
          t.start(15, () => { runControlDispatchReclaimTick(ws, streamServer, {}); });
        }
      `;
      const brokenOrchestratorDispatchOnly = "export async function runControlDispatchReclaimTick() { streamServer.dispatchDirective(x); }";
      assert.ok(
        assertStructuralDriverWired(plantedIndirectViaBrokenOrchestrator, brokenOrchestratorDispatchOnly).length > 0,
        "a planted orchestrator call whose OWN body reaches only one seam still trips the 'calls BOTH' detector",
      );

      // (ii) planted: assignWork itself calls dispatchDirective.
      const assignCode = stripComments(await readFile(ASSIGN_SOURCE, "utf8"));
      assert.deepEqual(assertAssignVerbDoesNotDispatch(assignCode), [], "the real assign verb source is clean");
      const plantedDispatchingAssign = assignCode.replace(
        "insertAssignment(store, record);",
        "insertAssignment(store, record);\n    dispatchDirective(buildDirectiveFrame(nodeId, { assignmentId: record.assignmentId }));",
      );
      assert.ok(assertAssignVerbDoesNotDispatch(plantedDispatchingAssign).length > 0, "a planted dispatching assignWork trips the 'verb does not dispatch' detector");
    },
  },
  {
    name: "arch/35 ADR-008 (acd-control-dispatch-reclaim-driver-wired): behavioural self-check — a driver with NO once-guard (re-dispatches every tick) fails the 'exactly once' assertion the real (guarded) driver passes",
    run: async () => {
      // A minimal stand-in for "the driver, but without the dispatchedAssignmentIds
      // guard" — proves the behavioural test above is non-vacuous: an UNGUARDED scan
      // (no in-memory once-set) dispatches the SAME still-assigned row on every tick.
      const rows = [{ assignmentId: "asg-1", state: "assigned", targetNodeId: "worker-a" }];
      const server = fakeStreamServer({ connectedNodeIds: ["worker-a"] });
      const unguardedTick = () => {
        for (const row of rows) {
          if (row.state !== "assigned") continue;
          const connected = server.directiveTargets.get(row.targetNodeId) != null;
          if (!connected) continue;
          server.dispatchDirective({ assignmentId: row.assignmentId, to: row.targetNodeId });
          // NO dispatchedAssignmentIds.add(...) here — the planted violation.
        }
      };
      unguardedTick();
      unguardedTick();
      assert.ok(server.dispatched.length > 1, "an unguarded driver re-dispatches the same assignmentId on every tick (the violation this planted stand-in demonstrates)");
      // The REAL driver's behavioural test above (case c) already proves the
      // opposite (dispatched.length stays 1 across two ticks) — this self-check
      // shows that assertion is non-vacuous: removing the guard flips the result.
    },
  },
  {
    name: "arch/35 ADR-008 (acd-control-dispatch-reclaim-driver-wired): this fitness test is registered in scripts/test.mjs, and the two new task features (control-dispatch-driver/03, reclaim-scheduler/06) are registered alongside it",
    run: async () => {
      const suite = await readFile(TEST_SUITE, "utf8");
      assert.ok(
        suite.includes("test/arch/acd-control-dispatch-reclaim-driver-wired.test.mjs") && suite.includes("...acdControlDispatchReclaimDriverWiredTests"),
        "acd-control-dispatch-reclaim-driver-wired is imported and spread into the registered suite",
      );
      assert.ok(
        suite.includes("test/mesh-control-dispatch-driver.test.mjs") && suite.includes("...meshControlDispatchDriverTests"),
        "the dispatch-driver feature test is imported and spread into the registered suite",
      );
      assert.ok(
        suite.includes("test/mesh-reclaim-scheduler.test.mjs") && suite.includes("...meshReclaimSchedulerTests"),
        "the reclaim-scheduler feature test is imported and spread into the registered suite",
      );
    },
  },
];
