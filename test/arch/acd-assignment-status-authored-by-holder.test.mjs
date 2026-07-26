// Security fitness: acd-assignment-status-authored-by-holder (milestone 35 /
// SECURITY T6, F5) — "The control writes an assignment's lifecycle ONLY from the
// connection whose nodeId holds it — a status/lifecycle frame's node is taken from
// the authenticated connection, never a self-reported frame.nodeId, and never
// advances another node's assignment."
//
// Proofs:
//  1. Structural — the assignment-apply seam (applyAssignmentStatusFrame) derives
//     its owner from the connection nodeId bound at connection time (the
//     `ownerNode ?? frameNode` precedence shape, control-stream-server.mjs:120-124),
//     never `frame.nodeId` alone, AND the applied row's target_node_id is compared
//     against the CONNECTION identity before any write.
//  2. Behavioural — a status frame arriving on node-A's connection for an
//     assignment held by node-B is not applied; the holder's own connection DOES
//     advance it.
//  Self-check: the detector fires on a frame.nodeId-trusting apply and accepts the
//  connection-nodeId form.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyStreamFrame } from "../../src/control-stream-server.mjs";
import { readAssignment } from "../../src/assignment-record.mjs";
import { openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";
import { withMeshAssignFixture, seedAssignment } from "../support/mesh-assign-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourcePath = path.join(repoRoot, "src", "control-stream-server.mjs");
const NOW = "2026-07-09T10:00:00.000Z";

function extractFunctionBody(source, name) {
  const anchor = source.indexOf(`function ${name}(`);
  if (anchor < 0) return null;
  const paramListStart = source.indexOf("(", anchor);
  let parenDepth = 0;
  let paramListEnd = paramListStart;
  for (let i = paramListStart; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    if (source[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { paramListEnd = i; break; }
    }
  }
  const braceStart = source.indexOf("{", paramListEnd);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(anchor, i + 1);
    }
  }
  return null;
}

// detectHolderAuthoredApply(body) — the ownerNode ?? frameNode precedence shape
// (connection nodeId wins) AND a target_node_id/holder comparison against that
// resolved connection identity BEFORE any write — never a bare `frame.nodeId` used
// as the write's authorship key on its own.
function detectHolderAuthoredApply(body) {
  const hasPrecedence = /ownerNode\s*\?\?\s*frameNode/.test(body);
  const comparesHolder = /target_node_id\s*!==\s*connectionNodeId|connectionNodeId\s*!==\s*existing\.target_node_id/.test(body);
  return hasPrecedence && comparesHolder;
}

async function withStore({ home }, fn) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

export const archTests = [
  {
    name: "arch/35 SECURITY T6 (acd-assignment-status-authored-by-holder): applyAssignmentStatusFrame derives ownership from the connection nodeId (ownerNode ?? frameNode) and compares it against the row's holder before any write (structural)",
    run: async () => {
      const source = await readFile(sourcePath, "utf8");
      const body = extractFunctionBody(source, "applyAssignmentStatusFrame");
      assert.ok(body, "applyAssignmentStatusFrame is defined");
      assert.equal(detectHolderAuthoredApply(body), true, "the connection-nodeId-wins precedence and a holder comparison are both present");
    },
  },
  {
    name: "arch/35 SECURITY T6 (acd-assignment-status-authored-by-holder): a status frame arriving on node-A's connection for an assignment held by node-B is NOT applied (behavioural)",
    run: async () => {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-b", itemRef: "35/01", workspaceId, targetNodeId: "worker-b", issuer: "control-a", state: "running", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "assignment-status", nodeId: "worker-b", assignmentId: "asg-b", state: "done", at: NOW };
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(result.applied, false, "worker-a's connection cannot advance worker-b's assignment, even self-declaring nodeId worker-b");
          const record = readAssignment(store, "asg-b");
          assert.equal(record.state, "running", "unchanged");
        });
      });
    },
  },
  {
    name: "arch/35 SECURITY T6 (acd-assignment-status-authored-by-holder): the holding node's own connection DOES advance its assignment (behavioural)",
    run: async () => {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-a", itemRef: "35/01", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "assignment-status", nodeId: "worker-a", assignmentId: "asg-a", state: "running", runId: "run-3", at: NOW };
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(result.applied, true);
          const record = readAssignment(store, "asg-a");
          assert.equal(record.state, "running");
          assert.equal(record.runId, "run-3");
        });
      });
    },
  },
  {
    name: "arch/35 SECURITY T6 (acd-assignment-status-authored-by-holder): self-check — the detector fires on a frame.nodeId-trusting apply and accepts the connection-nodeId form",
    run: async () => {
      const trustingForm = `
function applyAssignmentStatusFrame(store, frame, options = {}) {
  const nodeId = frame.nodeId; // TRUSTS the self-declared frame field directly
  const existing = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(frame.assignmentId);
  if (!existing) return { applied: false };
  updateAssignmentState(store, frame.assignmentId, frame.state, {});
  return { applied: true };
}
`;
      assert.equal(detectHolderAuthoredApply(trustingForm), false, "a frame.nodeId-trusting apply trips the detector");

      const checkingForm = `
function applyAssignmentStatusFrame(store, frame, options = {}) {
  const ownerNode = options?.nodeId ?? null;
  const frameNode = frame?.nodeId ?? null;
  const connectionNodeId = ownerNode ?? frameNode;
  const existing = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(frame.assignmentId);
  if (!existing) return { applied: false };
  if (existing.target_node_id !== connectionNodeId) return { applied: false };
  updateAssignmentState(store, frame.assignmentId, frame.state, {});
  return { applied: true };
}
`;
      assert.equal(detectHolderAuthoredApply(checkingForm), true, "the real checking form (connection-nodeId-wins + holder comparison) passes");
    },
  },
];
