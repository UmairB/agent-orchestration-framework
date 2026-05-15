import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBoard, getBoard } from "../src/boards.mjs";
import { applyBreakdownProposal, createBreakdownProposal, readBreakdownProposal, refreshBreakdownProposal } from "../src/board-breakdown.mjs";

export const boardBreakdownTests = [
  {
    name: "creates reviewable objective breakdown proposals",
    run: createsReviewableProposal
  },
  {
    name: "applies proposals to board tasks with provenance refs",
    run: appliesProposal
  },
  {
    name: "protects existing tasks from silent overwrite",
    run: protectsExistingTasks
  },
  {
    name: "refreshes proposals without mutating board tasks",
    run: refreshesProposal
  }
];

async function createsReviewableProposal() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-breakdown-"));
  try {
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    const { proposal } = await createBreakdownProposal(targetDir, "delivery", {
      id: "api-proposal",
      objective: "Board API"
    });

    assert.equal(proposal.status, "proposed");
    assert.equal(proposal.tasks.length, 3);
    assert.deepEqual(proposal.tasks.map((task) => task.id), [
      "board-api-scope",
      "board-api-implementation",
      "board-api-verification"
    ]);
    assert.equal(proposal.tasks[0].refs.generatedBy, "gsd-objective-breakdown");
    assert.equal((await getBoard(targetDir, "delivery")).tasks.length, 0);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function appliesProposal() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-breakdown-"));
  try {
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    await createBreakdownProposal(targetDir, "delivery", { id: "api-proposal", objective: "Board API" });
    const result = await applyBreakdownProposal(targetDir, "delivery", "api-proposal");

    assert.equal(result.applied.length, 3);
    const board = await getBoard(targetDir, "delivery");
    assert.equal(board.tasks.length, 3);
    assert.equal(board.tasks[0].refs.proposal, "api-proposal");
    assert.equal(board.tasks[0].history[0].type, "created");

    const proposal = await readBreakdownProposal(targetDir, "delivery", "api-proposal");
    assert.equal(proposal.status, "applied");
    assert.deepEqual(proposal.appliedTaskIds, result.applied.map((task) => task.id));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function protectsExistingTasks() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-breakdown-"));
  try {
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    await createBreakdownProposal(targetDir, "delivery", { id: "api-proposal", objective: "Board API" });
    await applyBreakdownProposal(targetDir, "delivery", "api-proposal");
    await createBreakdownProposal(targetDir, "delivery", { id: "api-proposal-refresh", objective: "Board API" });

    await assert.rejects(
      () => applyBreakdownProposal(targetDir, "delivery", "api-proposal-refresh"),
      /conflicts with existing tasks/
    );
    assert.equal((await readBreakdownProposal(targetDir, "delivery", "api-proposal-refresh")).status, "proposed");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function refreshesProposal() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-breakdown-"));
  try {
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    await createBreakdownProposal(targetDir, "delivery", { id: "api-proposal", objective: "Board API" });
    const { proposal } = await refreshBreakdownProposal(targetDir, "delivery", "api-proposal", {
      id: "api-proposal-2"
    });

    assert.equal(proposal.refreshOf, "api-proposal");
    assert.equal(proposal.status, "proposed");
    assert.equal((await getBoard(targetDir, "delivery")).tasks.length, 0);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}
