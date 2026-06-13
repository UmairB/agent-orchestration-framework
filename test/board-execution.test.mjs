import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBoard, addTask, buildBoardIndex, validateBoards } from "../src/boards.mjs";
import { answerTaskExecutionGate, assignTaskToAgent, listBoardAgents, readTaskExecution, readTaskExecutionEvents, takeOverTaskExecution, updateTaskExecution } from "../src/board-execution.mjs";

export const boardExecutionTests = [
  {
    name: "lists configured board execution agents",
    run: listsConfiguredAgents
  },
  {
    name: "lists configured execution runtimes when no board agents are configured",
    run: listsConfiguredExecutionRuntimes
  },
  {
    name: "assigns phase-linked tasks to agents and starts GSD execution",
    run: assignsTaskAndStartsExecution
  },
  {
    name: "persists execution console events",
    run: persistsExecutionConsoleEvents
  },
  {
    name: "pauses execution for human gate input and resumes after answer",
    run: pausesForHumanGateInput
  },
  {
    name: "hands waiting executions over to host ownership",
    run: handsWaitingExecutionToHostOwnership
  },
  {
    name: "records failed SDK phase execution details",
    run: recordsFailedSdkExecution
  },
  {
    name: "records nested SDK phase execution failures",
    run: recordsNestedSdkExecutionFailure
  },
  {
    name: "rejects unknown agents and tasks without phase refs",
    run: rejectsInvalidAssignments
  },
  {
    name: "rejects assignment until task dependencies complete",
    run: rejectsBlockedDependencies
  },
  {
    name: "rejects assignment changes for done tasks",
    run: rejectsDoneTaskAssignmentChanges
  },
  {
    name: "rejects assignment changes for in-progress tasks",
    run: rejectsInProgressTaskAssignmentChanges
  },
  {
    name: "rejects unsupported execution backends and missing capabilities",
    run: rejectsUnsupportedExecutionBackends
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

async function listsConfiguredExecutionRuntimes() {
  const targetDir = await mkProject();
  try {
    await writeGsdOnlyConfig(targetDir);
    const agents = await listBoardAgents(targetDir);
    assert.deepEqual(agents.map((agent) => agent.id), ["claude", "codex"]);
    assert.deepEqual(agents.map((agent) => agent.source), ["runtime", "runtime"]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function assignsTaskAndStartsExecution() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Assign board tasks" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    const result = await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      phaseRunner: successfulPhaseRunner
    });

    assert.equal(result.task.status, "done");
    assert.equal(result.task.assignedAgent.id, "builder");
    assert.equal(result.task.execution.provider, "gsd");
    assert.equal(result.task.execution.status, "complete");
    assert.equal(result.execution.commands[0], "$gsd-discuss-phase 30");
    assert.equal(result.execution.sdkResult.phaseNumber, "30");
    assert.match(await readFile(result.executionPath, "utf8"), /"assignedAgent"/);

    const index = await buildBoardIndex(targetDir);
    assert.equal(index.boards[0].tasks[0].execution.status, "complete");
    assert.equal((await validateBoards(targetDir)).some((item) => item.severity === "error"), false);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function persistsExecutionConsoleEvents() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Stream task output" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      phaseRunner: eventfulPhaseRunner
    });

    const events = await readTaskExecutionEvents(targetDir, "delivery", "phase-30");
    assert.equal(events[0].type, "execution_started");
    assert.equal(events.some((event) => event.type === "gsd_event" && event.event?.type === "assistant_text"), true);
    assert.equal(events.at(-1).type, "execution_complete");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function pausesForHumanGateInput() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Handle human gates" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      phaseRunner: gatedPhaseRunner,
      backgroundExecution: true,
      interactiveGates: true
    });

    await waitFor(async () => {
      const { execution } = await readTaskExecution(targetDir, "delivery", "phase-30");
      return execution.status === "waiting_for_user";
    });
    const waiting = await readTaskExecution(targetDir, "delivery", "phase-30");
    assert.equal(waiting.execution.resume.pendingGate.kind, "blocker");
    assert.deepEqual(waiting.execution.resume.pendingGate.choices, ["retry", "skip", "stop"]);

    const answered = await answerTaskExecutionGate(targetDir, "delivery", "phase-30", { decision: "skip" });
    assert.equal(answered.execution.status, "running");

    await waitFor(async () => {
      const { execution } = await readTaskExecution(targetDir, "delivery", "phase-30");
      return execution.status === "complete";
    });
    const events = await readTaskExecutionEvents(targetDir, "delivery", "phase-30");
    assert.equal(events.some((event) => event.type === "human_gate_waiting"), true);
    assert.equal(events.some((event) => event.type === "human_gate_answered" && event.decision === "skip"), true);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function handsWaitingExecutionToHostOwnership() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Hand off execution" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      phaseRunner: gatedPhaseRunner,
      backgroundExecution: true,
      interactiveGates: true
    });

    await waitFor(async () => {
      const { execution } = await readTaskExecution(targetDir, "delivery", "phase-30");
      return execution.status === "waiting_for_user";
    });

    const takeover = await takeOverTaskExecution(targetDir, "delivery", "phase-30");
    assert.equal(takeover.execution.status, "waiting_for_user");
    assert.equal(takeover.execution.resume.owner.current, "host");
    assert.equal(takeover.execution.resume.pendingGate, null);
    assert.equal(takeover.execution.resume.lastGateDecision.decision, "stop");

    await waitFor(async () => {
      const events = await readTaskExecutionEvents(targetDir, "delivery", "phase-30");
      return events.some((event) => event.type === "execution_handoff_preserved");
    });
    const preserved = await readTaskExecution(targetDir, "delivery", "phase-30");
    assert.equal(preserved.execution.status, "waiting_for_user");
    assert.equal(preserved.execution.resume.owner.current, "host");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function recordsFailedSdkExecution() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Assign board tasks" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    const result = await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      phaseRunner: failedPhaseRunner
    });

    assert.equal(result.task.status, "blocked");
    assert.equal(result.task.execution.status, "failed");
    assert.equal(result.execution.errorSubtype, "error_during_execution");
    assert.deepEqual(result.execution.errorMessages, ["Execution failed."]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function recordsNestedSdkExecutionFailure() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Assign board tasks" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    const result = await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      phaseRunner: nestedFailedPhaseRunner
    });

    assert.equal(result.task.status, "blocked");
    assert.equal(result.task.execution.status, "failed");
    assert.equal(result.execution.errorSubtype, "error_during_execution");
    assert.deepEqual(result.execution.errorMessages, ["Out of usage."]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rejectsInvalidAssignments() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Update execution state" });
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

async function rejectsBlockedDependencies() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Sequence phase tasks" });
    await addTask(targetDir, "delivery", { id: "phase-39", title: "Phase 39", refs: { phase: "39" } });
    await addTask(targetDir, "delivery", { id: "phase-40", title: "Phase 40", refs: { phase: "40" }, dependsOn: ["39"] });

    await assert.rejects(
      () => assignTaskToAgent(targetDir, "delivery", "phase-40", "builder", {
        phaseRunner: successfulPhaseRunner
      }),
      (error) => error.code === "BOARD_TASK_DEPENDENCY_BLOCKED"
        && /phase-40 cannot start until phase-39 is done/.test(error.message)
    );

    await addTask(targetDir, "delivery", { id: "phase-41", title: "Phase 41", status: "done", refs: { phase: "41" } });
    await addTask(targetDir, "delivery", { id: "phase-42", title: "Phase 42", refs: { phase: "42" }, dependsOn: ["41"] });

    const result = await assignTaskToAgent(targetDir, "delivery", "phase-42", "builder", {
      phaseRunner: successfulPhaseRunner
    });
    assert.equal(result.task.status, "done");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rejectsDoneTaskAssignmentChanges() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Lock completed tasks" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      phaseRunner: successfulPhaseRunner
    });

    await assert.rejects(
      () => assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
        phaseRunner: successfulPhaseRunner
      }),
      (error) => error.code === "BOARD_TASK_ASSIGNMENT_LOCKED"
        && /agent assignment cannot be changed/.test(error.message)
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rejectsInProgressTaskAssignmentChanges() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Lock running tasks" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      deferExecution: true
    });

    await assert.rejects(
      () => assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
        deferExecution: true
      }),
      (error) => error.code === "BOARD_TASK_ASSIGNMENT_LOCKED"
        && /agent assignment cannot be changed/.test(error.message)
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function rejectsUnsupportedExecutionBackends() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Update execution state" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });

    await assert.rejects(
      () => assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", { provider: "other" }),
      (error) => error.code === "BACKEND_UNSUPPORTED" && error.actual === "other"
    );
    await assert.rejects(
      () => assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", { provider: "null" }),
      (error) => error.code === "BACKEND_CAPABILITY_UNSUPPORTED" && error.actual === "null"
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function updatesExecutionStatus() {
  const targetDir = await mkProject();
  try {
    await writeAgentConfig(targetDir);
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Reject invalid assignments" });
    await addTask(targetDir, "delivery", { id: "phase-30", title: "Phase 30", refs: { phase: "30" } });
    await assignTaskToAgent(targetDir, "delivery", "phase-30", "builder", {
      phaseRunner: successfulPhaseRunner
    });

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

async function writeGsdOnlyConfig(targetDir) {
  await writeFile(path.join(targetDir, ".aof", "aof.config.json"), `${JSON.stringify({
    $schema: "../schemas/aof.schema.json",
    name: "board-execution",
    resources: [],
    runtimes: ["claude", "codex"],
    globalRefs: [],
    packages: [
      { id: "gsd", namespace: "gsd", source: "npm:get-shit-done-cc@latest", runtimes: ["claude", "codex"] }
    ]
  }, null, 2)}\n`, "utf8");
}

async function successfulPhaseRunner(_projectDir, phase) {
  return {
    phaseNumber: String(phase),
    phaseName: `Phase ${phase}`,
    steps: [],
    success: true,
    totalCostUsd: 0,
    totalDurationMs: 1
  };
}

async function failedPhaseRunner(_projectDir, phase) {
  return {
    phaseNumber: String(phase),
    phaseName: `Phase ${phase}`,
    steps: [{
      step: "execute",
      success: false,
      durationMs: 1,
      planResults: [{
        success: false,
        sessionId: "session-1",
        totalCostUsd: 0,
        durationMs: 1,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0
        },
        numTurns: 1,
        error: {
          subtype: "error_during_execution",
          messages: ["Execution failed."]
        }
      }]
    }],
    success: false,
    totalCostUsd: 0,
    totalDurationMs: 1
  };
}

async function nestedFailedPhaseRunner(_projectDir, phase) {
  return {
    phaseNumber: String(phase),
    phaseName: `Phase ${phase}`,
    steps: [{
      step: "verify",
      success: true,
      durationMs: 1,
      planResults: [{
        success: false,
        sessionId: "session-1",
        totalCostUsd: 0,
        durationMs: 1,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0
        },
        numTurns: 1,
        error: {
          subtype: "error_during_execution",
          messages: ["Out of usage."]
        }
      }]
    }],
    success: true,
    totalCostUsd: 0,
    totalDurationMs: 1
  };
}

async function eventfulPhaseRunner(_projectDir, phase, options = {}) {
  options.onEvent?.({
    type: "assistant_text",
    timestamp: new Date().toISOString(),
    sessionId: "session-console",
    phaseNumber: String(phase),
    text: "Discussing the phase."
  });
  return successfulPhaseRunner(_projectDir, phase);
}

async function gatedPhaseRunner(_projectDir, phase, options = {}) {
  const decision = await options.callbacks.onBlockerDecision({
    phaseNumber: String(phase),
    step: "discuss",
    error: "Need project direction."
  });
  return {
    phaseNumber: String(phase),
    phaseName: `Phase ${phase}`,
    steps: [{ step: "discuss", success: decision === "skip", durationMs: 1 }],
    success: decision === "skip",
    totalCostUsd: 0,
    totalDurationMs: 1
  };
}

async function waitFor(assertion, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Timed out waiting for condition.");
}
