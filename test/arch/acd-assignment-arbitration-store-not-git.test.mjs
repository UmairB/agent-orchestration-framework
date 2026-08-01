// Fitness function: acd-assignment-arbitration-store-not-git (milestone 35 / ADR-003,
// fitness #9) — "Single-runner arbitration is the store uniqueness check, not a git/
// lease read."
//
// Proofs:
//  1. Structural — the assign write path (mesh-assignment.mjs) enforces "at most one
//     ACTIVE assignment per (workspaceId, itemRef)" by querying global_assignments for
//     an active row (state IN (assigned, accepted, running)) and refusing
//     (assignment-already-active); grep asserts the uniqueness query/refusal exists
//     and that the arbitration path imports NO mesh-lease/issuance/sync module and
//     reads no git state for the ACTIVE decision.
//  2. Behavioural — a second assign on an item with an active assignment is refused,
//     minting nothing.
//  Self-check (m03 non-vacuous): a planted second-assign-succeeds-while-active source
//  form fails the SAME structural detector the real (guarded) source passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assignWork } from "../../src/mesh-assignment.mjs";
import { withMeshAssignFixture, seedTargetNode, seedAssignment, readAssignmentRows } from "../support/mesh-assign-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const assignSourcePath = path.join(repoRoot, "src", "mesh-assignment.mjs");
const recordSourcePath = path.join(repoRoot, "src", "assignment-record.mjs");

function assertStructural(source) {
  const problems = [];
  if (!/state\s+IN\s*\(\$\{placeholders\}\)/.test(source) && !/state\s+IN\s*\(/i.test(source)) {
    problems.push("no active-state uniqueness query found");
  }
  if (!/assignment-already-active/.test(source)) {
    problems.push("no assignment-already-active refusal code found");
  }
  if (/mesh-lease\.mjs|mesh-issuance\.mjs|mesh-sync\.mjs|commands\/mesh-issue\.mjs/.test(source)) {
    problems.push("arbitration path imports a git-bus module");
  }
  if (/execSync\(["']git |spawn\(["']git["']|simpleGit\(/.test(source)) {
    problems.push("arbitration path reads git state");
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/35 ADR-003 (acd-assignment-arbitration-store-not-git): the uniqueness query/refusal exists and arbitration reads no git-bus module or git state (structural)",
    run: async () => {
      const assignSource = await readFile(assignSourcePath, "utf8");
      const recordSource = await readFile(recordSourcePath, "utf8");
      const combined = `${assignSource}\n${recordSource}`;
      const problems = assertStructural(combined);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/35 ADR-003 (acd-assignment-arbitration-store-not-git): a second assign on an item with an active assignment is refused, minting nothing (behavioural)",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true, projectRoot: root, workDir });
      await seedTargetNode({ home }, { nodeId: "worker-b", workspaceId, member: true, published: true, projectRoot: root, workDir });
      await seedAssignment({ home }, {
        assignmentId: "active-1",
        itemRef: "35/00",
        workspaceId,
        targetNodeId: "worker-a",
        issuer: "control-a",
        state: "running",
        assignedAt: "2026-07-08T10:00:00.000Z",
      });

      const result = await assignWork(workspace, "35/00", "worker-b", { ...ctx, now: "2026-07-08T11:00:00.000Z" });
      assert.equal(result.ok, false, "the second assign is refused");
      assert.equal(result.code, "assignment-already-active");

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 1, "nothing minted");
    }),
  },
  {
    name: "arch/35 ADR-003 (acd-assignment-arbitration-store-not-git): self-check — a planted git-bus import in the arbitration source trips the SAME detector the real (clean) source passes",
    run: async () => {
      const assignSource = await readFile(assignSourcePath, "utf8");
      const recordSource = await readFile(recordSourcePath, "utf8");
      assert.deepEqual(assertStructural(`${assignSource}\n${recordSource}`), [], "the real source is clean");

      const plantedGitImport = `${assignSource}\nimport { claim } from "./mesh-lease.mjs";\n`;
      assert.ok(assertStructural(plantedGitImport).length > 0, "a planted mesh-lease.mjs import trips the detector");

      const plantedGitExec = `${assignSource}\nexecSync("git log --oneline");\n`;
      assert.ok(assertStructural(plantedGitExec).length > 0, "a planted git exec call trips the detector");
    },
  },
];
