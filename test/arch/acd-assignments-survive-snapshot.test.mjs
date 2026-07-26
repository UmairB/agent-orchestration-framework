// Fitness function: acd-assignments-survive-snapshot (milestone 35 / ADR-001,
// fitness #4) — "A publishGlobalWorkSnapshot / publishWorkspaceSnapshot cycle does
// not delete or alter any global_assignments row."
//
// Proofs:
//  (a) STRUCTURAL — grep the snapshot write path (publishWorkspaceSnapshot's body in
//      global-work-store.mjs) for any statement touching global_assignments (DELETE/
//      INSERT/UPDATE); assert NONE exist.
//  (b) BEHAVIOURAL — open a v3 store, insert an assignment, run a full snapshot
//      publish for that workspace, assert the assignment row reads back byte-identical.
//  Self-check (m03 non-vacuous): a planted `DELETE FROM global_assignments` string
//  trips the SAME structural detector the real (clean) source passes.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openGlobalWorkProjectionStore, publishWorkspaceSnapshot } from "../../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, readAssignment } from "../../src/assignment-record.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const storeSourcePath = path.join(repoRoot, "src", "global-work-store.mjs");

function extractFunctionBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`signature not found: ${signature}`);
  const nextStart = nextSignature ? source.indexOf(nextSignature, start) : -1;
  return source.slice(start, nextStart === -1 ? undefined : nextStart);
}

function assertNoAssignmentStatement(body) {
  const offending = [
    /DELETE\s+FROM\s+global_assignments/i,
    /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+global_assignments/i,
    /UPDATE\s+global_assignments/i,
  ].filter((re) => re.test(body));
  return offending;
}

export const archTests = [
  {
    name: "arch/35 ADR-001 (acd-assignments-survive-snapshot): the publishWorkspaceSnapshot body touches no global_assignments statement (structural)",
    run: async () => {
      const source = await readFile(storeSourcePath, "utf8");
      const body = extractFunctionBody(
        source,
        "export async function publishWorkspaceSnapshot",
        "\nexport function recordWorkspaceProjectionError",
      );
      assert.ok(body.length > 200, "publishWorkspaceSnapshot body located (non-vacuous)");
      const offending = assertNoAssignmentStatement(body);
      assert.deepEqual(offending, [], "no DELETE/INSERT/UPDATE against global_assignments in the snapshot path");
    },
  },
  {
    name: "arch/35 ADR-001 (acd-assignments-survive-snapshot): an inserted assignment survives a full publish cycle byte-identical (behavioural)",
    run: async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-arch-survive-snapshot-"));
      try {
        const home = path.join(tmp, "home");
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          const record = assembleAssignmentRecord({
            itemRef: "35/00",
            workspaceId: "ws-1",
            targetNodeId: "worker-a",
            issuer: "control-a",
            state: "running",
            runId: "run-1",
            now: "2026-07-08T10:00:00.000Z",
          });
          insertAssignment(store, record);
          const before = readAssignment(store, record.assignmentId);

          const root = path.join(tmp, "repo");
          const milestoneDir = path.join(root, "wiki", "work", "35_milestone_demo");
          await mkdir(milestoneDir, { recursive: true });
          await writeFile(
            path.join(milestoneDir, "SPEC.md"),
            "---\ntype: milestone\nnumber: 35\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n",
            "utf8",
          );
          const workspace = { config: { name: "demo", work: { dir: "./wiki/work" } }, projectRoot: root, workDir: path.join(root, "wiki", "work") };

          await publishWorkspaceSnapshot(store, workspace, { workspaceId: "ws-1", now: "2026-07-08T11:00:00.000Z" });
          await publishWorkspaceSnapshot(store, workspace, { workspaceId: "ws-1", now: "2026-07-08T12:00:00.000Z" });

          const after = readAssignment(store, record.assignmentId);
          assert.deepEqual(after, before, "the assignment row reads back byte-identical after two publish cycles");
        } finally {
          store.close();
        }
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/35 ADR-001 (acd-assignments-survive-snapshot): self-check — a planted DELETE FROM global_assignments trips the SAME structural detector the real (clean) source passes",
    run: async () => {
      const source = await readFile(storeSourcePath, "utf8");
      const cleanBody = extractFunctionBody(
        source,
        "export async function publishWorkspaceSnapshot",
        "\nexport function recordWorkspaceProjectionError",
      );
      assert.deepEqual(assertNoAssignmentStatement(cleanBody), [], "the real source is clean");

      const plantedBody = `${cleanBody}\n    db.prepare("DELETE FROM global_assignments WHERE workspace_id = ?").run(workspaceId);\n`;
      assert.ok(assertNoAssignmentStatement(plantedBody).length > 0, "a planted DELETE FROM global_assignments trips the detector");
    },
  },
];
