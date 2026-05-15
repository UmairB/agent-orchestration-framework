import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBoard, addTask, buildBoardIndex, validateBoards } from "../src/boards.mjs";
import { assignTaskToAgent, listBoardAgents, readTaskExecution, updateTaskExecution } from "../src/board-execution.mjs";

export const boardExecutionTests = [
  {
    name: "lists configured board execution agents",
    run: listsConfiguredAgents
  },
  {
    name: "assigns phase-linked tasks to agents and starts GSD execution",
    run: assignsTaskAndStartsExecution
  },
  {
    name: "rejects unknown agents and tasks without phase refs",
    run: rejectsInvalidAssignments
  },
  {
    name: "updates execution status and synchronizes board task status",
    run: updatesExecutionStatus
  }
];

async function listsConfiguredAgents() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    const agents = await listBoardAgents(targetDir);
    assert.deepEqual(agents.map((agent) => agent.id), ["builder"]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function assignsTaskAndStartsExecution() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    const result = await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder");

    assert.equal(result.task.status, "in_progress");
    assert.equal(result.task.assignedAgent.id, "builder");
    assert.equal(result.task.execution.provider, "gsd");
    assert.equal(result.task.execution.status, "running");
    assert.equal(result.execution.commands[0], "$gsd-discuss-phase 30");
    assert.match(await readFile(result.executionPath, "utf8"), /"assignedAgent"/);

    const index = await buildBoardIndex(targetDir);
    assert.equal(index.boards[0].tasks[0].execution.status, "running");
    assert.equal((await validateBoards(targetDir)).some((item) => item.severity === "error"), false);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rejectsInvalidAssignments() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });
    await addTask(targetDir, "delivery", { id: "missing-phase", title: "Missing Phase" });

    await assert.rejects(
      () => assignTaskToAgent(targetDir, "delivery", "phase-30", "missing-agent"),
      /Unknown agent/
    );
    await assert.rejects(
      () => assignTaskToAgent(targetDir, "delivery", "missing-phase", "builder"),
      /without refs\.phase/
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function updatesExecutionStatus() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });
    await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder");

    let result = await updateTaskExecution(targetDir, "delivery", "phase-30", {
      status: "waiting_for_user",
      message: "Need a scope decision.",
      handoff: "Ask for scope."
    });
    assert.equal(result.task.status, "in_progress");
    assert.equal(result.execution.resume.handoff, "Ask for scope.");

    result = await updateTaskExecution(targetDir, "delivery", "phase-30", {
      status: "failed",
      message: "Execution failed."
    });
    assert.equal(result.task.status, "blocked");

    result = await updateTaskExecution(targetDir, "delivery", "phase-30", {
      status: "complete",
      message: "Execution complete."
    });
    assert.equal(result.task.status, "done");
    assert.equal((await readTaskExecution(targetDir, "delivery", "phase-30")).execution.status, "complete");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function mkProject() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-board-execution-"));
  await mkdir(path.join(targetDir, ".aof"), { recursive: true });
  return targetDir;
}

async function writeAgentConfig(targetDir) {
  await writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
    $schema: "../schemas/aof.schema.json",
    name: "board-execution",
    resources: [
      { kind: "agent", id: "builder", description: "Builds assigned tasks.", body: "Execute the assigned task." }
    ],
    globalRefs: [],
    packages: []
  }, null, 2)}\n`, "utf8");
}
