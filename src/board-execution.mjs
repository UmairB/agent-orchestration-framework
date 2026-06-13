import path from "node:path";
import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { loadProjectConfig } from "./dsl.mjs";
import { BackendCapabilityError, resolveBackend } from "./backends/index.mjs";
import { normalizeId, writeText } from "./fs.mjs";
import { gsdPackageFromConfig } from "./frameworks.mjs";
import { BoardLifecycleError, boardWorkspacePaths, getBoard, updateTask } from "./boards.mjs";
import { findProjectConfig } from "./workspace.mjs";
import { runGsdPhase } from "./gsd-sdk-adapter.mjs";

export const EXECUTION_STATUSES = Object.freeze(["queued", "running", "waiting_for_user", "blocked", "failed", "complete"]);
const EXECUTION_STATUS_SET = new Set(EXECUTION_STATUSES);
const DEFAULT_PROVIDER = "gsd";
const executionEventBus = new EventEmitter();
executionEventBus.setMaxListeners(200);
const pendingGates = new Map();

export async function listBoardAgents(projectDir, options = {}) {
  const configPath = await findProjectConfig(projectDir, options.config);
  if (!await exists(configPath)) return [];
  const config = await loadProjectConfig(configPath, options);
  const runtimeAgents = runtimeAgentsFromConfig(config);
  if (runtimeAgents.length > 0) return runtimeAgents;

  const configuredAgents = config.resources
    .filter((resource) => resource.kind === "agent")
    .map((agent) => ({
      id: agent.id,
      description: agent.description ?? "",
      runtimes: agent.runtimes ?? ["claude", "codex"],
      source: agent._aofSource?.scope ?? "local"
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (configuredAgents.length > 0) return configuredAgents;

  const gsdPackage = gsdPackageFromConfig(config);
  return runtimeAgentsFromConfig({ runtimes: gsdPackage?.runtimes ?? [] });
}

export async function isGsdExecutionConfigured(projectDir, options = {}) {
  const configPath = await findProjectConfig(projectDir, options.config);
  if (!await exists(configPath)) return false;
  const config = await loadProjectConfig(configPath, options);
  return Boolean(gsdPackageFromConfig(config));
}

export async function assignTaskToAgent(projectDir, boardId, taskId, agentId, options = {}) {
  const backend = resolveBackend(options.provider ?? DEFAULT_PROVIDER);
  if (!backend.capabilities.has("assignTask")) throw new BackendCapabilityError(backend, "assignTask");
  const provider = backend.kind;

  const normalizedAgentId = normalizeId(agentId);
  const agents = await listBoardAgents(projectDir, options);
  const agent = agents.find((item) => item.id === normalizedAgentId);
  if (!agent) {
    throw new BoardLifecycleError(
      "BOARD_AGENT_NOT_FOUND",
      `Unknown agent "${normalizedAgentId}". Configure claude and/or codex in .aof/aof.config.json runtimes before assignment.`,
      { actual: normalizedAgentId, next: "aof boards agents" }
    );
  }

  const board = await getBoard(projectDir, boardId);
  const task = board.tasks.find((item) => item.id === normalizeId(taskId));
  if (!task) {
    throw new BoardLifecycleError(
      "BOARD_TASK_NOT_FOUND",
      `Task not found: ${normalizeId(boardId)}/${normalizeId(taskId)}`,
      { actual: normalizeId(taskId), next: `aof boards show ${normalizeId(boardId)}` }
    );
  }
  if (isAssignmentLocked(task)) {
    throw new BoardLifecycleError(
      "BOARD_TASK_ASSIGNMENT_LOCKED",
      `Task ${board.id}/${task.id} is ${task.status} and its agent assignment cannot be changed.`,
      { actual: task.assignedAgent?.id ?? null, next: `Wait for execution to finish before changing assignment.` }
    );
  }

  const phase = phaseRef(task);
  if (!phase) {
    throw new BoardLifecycleError(
      "BOARD_TASK_PHASE_REF_MISSING",
      `Task ${board.id}/${task.id} cannot use provider ${provider} without refs.phase.`,
      { expected: "refs.phase", actual: task.refs ?? null, next: `aof boards sync ${board.id} --milestone <milestone-id>` }
    );
  }
  assertTaskDependenciesComplete(board, task);

  const now = nowIso();
  const existing = await tryReadExecution(projectDir, board.id, task.id);
  const attemptNumber = (existing?.attempts?.length ?? 0) + 1;
  const attemptId = `attempt-${attemptNumber}`;
  const commands = gsdCommands(phase);
  const executionPath = executionFilePath(projectDir, board.id, task.id);
  let execution = {
    version: 1,
    boardId: board.id,
    taskId: task.id,
    provider,
    status: "running",
    assignedAgent: agent,
    phase,
    commands,
    attempts: [
      ...(existing?.attempts ?? []),
      {
        id: attemptId,
        status: "running",
        startedAt: now,
        commands
      }
    ],
    logs: [
      ...(existing?.logs ?? []),
      {
        at: now,
        level: "info",
        message: `Assigned to agent ${agent.id}; started GSD execution for phase ${phase}.`
      }
    ],
    resume: {
      provider,
      phase,
      nextCommand: commands[0],
      commands
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  await writeText(executionPath, `${JSON.stringify(execution, null, 2)}\n`);
  appendTaskExecutionEvent(projectDir, board.id, task.id, {
    type: "execution_started",
    provider,
    phase,
    agentId: agent.id,
    attemptId
  });
  let updatedTask = await updateTaskExecutionSummary(projectDir, board.id, task.id, execution, executionPath, {
    type: "assigned",
    agentId: agent.id,
    provider,
    executionStatus: "running"
  });

  if (options.deferExecution) return { task: updatedTask, execution, executionPath };
  const runOptions = executionRunOptions(projectDir, board, task, executionPath, options);
  if (options.backgroundExecution) {
    completeAssignedTaskExecution(projectDir, board, task, execution, executionPath, phase, runOptions).catch((error) => {
      appendTaskExecutionEvent(projectDir, board.id, task.id, {
        type: "execution_error",
        message: error?.message ?? String(error)
      });
    });
    return { task: updatedTask, execution, executionPath };
  }

  const completed = await completeAssignedTaskExecution(projectDir, board, task, execution, executionPath, phase, runOptions);
  return { task: completed.task, execution: completed.execution, executionPath };
}

async function completeAssignedTaskExecution(projectDir, board, task, execution, executionPath, phase, options = {}) {
  const phaseRun = await runAssignedPhase(projectDir, phase, options);
  const status = phaseRun.failure ? "failed" : "complete";
  const endedAt = nowIso();
  const latest = await tryReadExecution(projectDir, board.id, task.id) ?? execution;
  if (isHostOwnedExecution(latest)) {
    appendTaskExecutionEvent(projectDir, board.id, task.id, {
      type: "execution_handoff_preserved",
      status: latest.status,
      phase,
      message: "Web runner finished after host takeover; preserving host-owned execution state."
    });
    const updatedTask = await updateTaskExecutionSummary(projectDir, board.id, task.id, latest, executionPath, {
      type: "execution_handoff_preserved",
      executionStatus: latest.status
    });
    return { task: updatedTask, execution: latest, executionPath };
  }
  const attempts = [...(latest.attempts ?? execution.attempts)];
  attempts[attempts.length - 1] = {
    ...attempts[attempts.length - 1],
    status,
    endedAt,
    ...(phaseRun.sdkResult ? { sdkResult: phaseRun.sdkResult } : {}),
    ...(phaseRun.failure ? {
      errorSubtype: phaseRun.failure.subtype,
      errorMessages: phaseRun.failure.messages
    } : {})
  };
  execution = {
    ...latest,
    status,
    ...(phaseRun.sdkResult ? { sdkResult: phaseRun.sdkResult } : {}),
    ...(phaseRun.failure ? {
      errorSubtype: phaseRun.failure.subtype,
      errorMessages: phaseRun.failure.messages
    } : {}),
    attempts,
    logs: [
      ...(latest.logs ?? []),
      {
        at: endedAt,
        level: phaseRun.failure ? "error" : "info",
        message: phaseRun.failure
          ? `GSD execution failed for phase ${phase}: ${phaseRun.failure.subtype}.`
          : `Completed GSD execution for phase ${phase}.`
      }
    ],
    resume: {
      ...(latest.resume ?? {}),
      pendingGate: null
    },
    updatedAt: endedAt
  };
  await writeText(executionPath, `${JSON.stringify(execution, null, 2)}\n`);
  appendTaskExecutionEvent(projectDir, board.id, task.id, {
    type: phaseRun.failure ? "execution_failed" : "execution_complete",
    status,
    phase,
    ...(phaseRun.failure ? { errorSubtype: phaseRun.failure.subtype, errorMessages: phaseRun.failure.messages } : {})
  });
  const updatedTask = await updateTaskExecutionSummary(projectDir, board.id, task.id, execution, executionPath, {
    type: "execution_status_changed",
    executionStatus: status
  });
  return { task: updatedTask, execution, executionPath };
}

function executionRunOptions(projectDir, board, task, executionPath, options = {}) {
  return {
    ...options,
    onEvent(event) {
      appendTaskExecutionEvent(projectDir, board.id, task.id, {
        type: "gsd_event",
        event
      });
      recordGsdSessionEvent(projectDir, board.id, task.id, executionPath, event).catch((error) => {
        appendTaskExecutionEvent(projectDir, board.id, task.id, {
          type: "execution_error",
          message: `Failed to record session id: ${error?.message ?? String(error)}`
        });
      });
      options.onEvent?.(event);
    },
    callbacks: options.interactiveGates
      ? interactiveGateCallbacks(projectDir, board, task, executionPath, options.callbacks)
      : options.callbacks
  };
}

async function runAssignedPhase(projectDir, phase, options = {}) {
  const runner = options.phaseRunner ?? phaseRunnerFromEnv() ?? runGsdPhase;
  try {
    const sdkResult = await runner(projectDir, phase, phaseRunnerOptions(options));
    const failure = phaseRunnerFailure(sdkResult);
    return { sdkResult, failure };
  } catch (error) {
    return {
      sdkResult: error?.actual?.result ?? null,
      failure: failureFromError(error)
    };
  }
}

function phaseRunnerOptions(options = {}) {
  return {
    ...(options.callbacks ? { callbacks: options.callbacks } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.maxBudgetUsd ? { maxBudgetUsd: Number(options.maxBudgetUsd) } : {}),
    ...(options.maxTurns ? { maxTurns: Number(options.maxTurns) } : {}),
    ...(options.maxBudgetPerStep ? { maxBudgetPerStep: Number(options.maxBudgetPerStep) } : {}),
    ...(options.maxTurnsPerStep ? { maxTurnsPerStep: Number(options.maxTurnsPerStep) } : {})
  };
}

function interactiveGateCallbacks(projectDir, board, task, executionPath, callbacks = {}) {
  return {
    ...callbacks,
    async onBlockerDecision(blocker) {
      if (callbacks.onBlockerDecision) return callbacks.onBlockerDecision(blocker);
      return waitForExecutionGate(projectDir, board, task, executionPath, {
        kind: "blocker",
        step: blocker.step,
        message: blocker.error ?? "GSD needs a decision before continuing.",
        context: blocker,
        choices: ["retry", "skip", "stop"]
      });
    },
    async onVerificationReview(result) {
      if (callbacks.onVerificationReview) return callbacks.onVerificationReview(result);
      return waitForExecutionGate(projectDir, board, task, executionPath, {
        kind: "verification",
        step: result.stepResult?.step ?? "verify",
        message: "GSD verification needs review before continuing.",
        context: result,
        choices: ["accept", "reject", "retry"]
      });
    }
  };
}

async function waitForExecutionGate(projectDir, board, task, executionPath, gate) {
  const gateId = `gate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pendingGate = {
    id: gateId,
    kind: gate.kind,
    step: gate.step,
    message: gate.message,
    choices: gate.choices,
    createdAt: nowIso()
  };
  await updateExecutionGateState(projectDir, board.id, task.id, executionPath, pendingGate, "waiting_for_user");
  appendTaskExecutionEvent(projectDir, board.id, task.id, {
    type: "human_gate_waiting",
    gate: pendingGate,
    context: gate.context
  });
  const key = gateKey(projectDir, board.id, task.id, gateId);
  return await new Promise((resolve) => {
    pendingGates.set(key, { resolve, choices: gate.choices });
  });
}

async function updateExecutionGateState(projectDir, boardId, taskId, executionPath, pendingGate, status) {
  const execution = await readExecution(projectDir, boardId, taskId);
  const next = {
    ...execution,
    status,
    resume: {
      ...(execution.resume ?? {}),
      pendingGate
    },
    updatedAt: nowIso()
  };
  await writeText(executionPath, `${JSON.stringify(next, null, 2)}\n`);
  await updateTaskExecutionSummary(projectDir, boardId, taskId, next, executionPath, {
    type: "execution_status_changed",
    executionStatus: status,
    message: pendingGate?.message
  });
  return next;
}

export async function answerTaskExecutionGate(projectDir, boardId, taskId, input = {}) {
  const normalizedBoardId = normalizeId(boardId);
  const normalizedTaskId = normalizeId(taskId);
  const { execution, executionPath } = await readTaskExecution(projectDir, normalizedBoardId, normalizedTaskId);
  const pendingGate = execution.resume?.pendingGate;
  if (!pendingGate?.id) {
    throw new BoardLifecycleError(
      "TASK_EXECUTION_GATE_NOT_WAITING",
      `Task execution is not waiting for user input: ${normalizedBoardId}/${normalizedTaskId}.`,
      { actual: execution.status, next: `aof boards execution show ${normalizedBoardId} ${normalizedTaskId}` }
    );
  }
  const decision = String(input.decision ?? input.answer ?? "").trim();
  if (!pendingGate.choices?.includes(decision)) {
    throw new BoardLifecycleError(
      "TASK_EXECUTION_GATE_DECISION_INVALID",
      `Invalid gate decision "${decision}".`,
      { expected: pendingGate.choices, actual: decision, next: `Choose one of: ${pendingGate.choices.join(", ")}` }
    );
  }
  const key = gateKey(projectDir, normalizedBoardId, normalizedTaskId, pendingGate.id);
  const waiter = pendingGates.get(key);
  if (!waiter) {
    throw new BoardLifecycleError(
      "TASK_EXECUTION_GATE_NOT_RESUMABLE",
      `Task execution gate ${pendingGate.id} is not attached to a running UI server process.`,
      { actual: pendingGate.id, next: `Restart assignment for ${normalizedBoardId}/${normalizedTaskId}.` }
    );
  }

  pendingGates.delete(key);
  const next = {
    ...execution,
    status: "running",
    resume: {
      ...(execution.resume ?? {}),
      pendingGate: null,
      lastGateDecision: {
        gateId: pendingGate.id,
        decision,
        answeredAt: nowIso()
      }
    },
    updatedAt: nowIso()
  };
  await writeText(executionPath, `${JSON.stringify(next, null, 2)}\n`);
  const task = await updateTaskExecutionSummary(projectDir, normalizedBoardId, normalizedTaskId, next, executionPath, {
    type: "execution_status_changed",
    executionStatus: "running",
    message: `Gate answered: ${decision}`
  });
  appendTaskExecutionEvent(projectDir, normalizedBoardId, normalizedTaskId, {
    type: "human_gate_answered",
    gateId: pendingGate.id,
    decision
  });
  waiter.resolve(decision);
  return { task, execution: next, executionPath };
}

export async function takeOverTaskExecution(projectDir, boardId, taskId, input = {}) {
  const normalizedBoardId = normalizeId(boardId);
  const normalizedTaskId = normalizeId(taskId);
  const { execution, executionPath } = await readTaskExecution(projectDir, normalizedBoardId, normalizedTaskId);
  if (execution.status === "running") {
    throw new BoardLifecycleError(
      "TASK_EXECUTION_TAKEOVER_ACTIVE",
      `Task ${normalizedBoardId}/${normalizedTaskId} is actively running in the web execution runner and cannot be taken over until it reaches a user-input or stopped state.`,
      { actual: execution.status, next: "Wait for the execution to request input, fail, or stop before taking over in a host terminal." }
    );
  }

  const now = nowIso();
  const pendingGate = execution.resume?.pendingGate;
  const decision = takeoverGateDecision(pendingGate?.choices);
  const key = pendingGate?.id ? gateKey(projectDir, normalizedBoardId, normalizedTaskId, pendingGate.id) : null;
  const waiter = key ? pendingGates.get(key) : null;
  if (key && waiter) pendingGates.delete(key);

  const next = {
    ...execution,
    status: "waiting_for_user",
    resume: {
      ...(execution.resume ?? {}),
      pendingGate: null,
      owner: {
        current: "host",
        previous: "web",
        takenOverAt: now,
        reason: input.reason ?? "host-console"
      },
      ...(pendingGate?.id ? {
        lastGateDecision: {
          gateId: pendingGate.id,
          decision,
          answeredAt: now,
          source: "host_takeover"
        }
      } : {})
    },
    updatedAt: now
  };
  await writeText(executionPath, `${JSON.stringify(next, null, 2)}\n`);
  const task = await updateTaskExecutionSummary(projectDir, normalizedBoardId, normalizedTaskId, next, executionPath, {
    type: "execution_takeover",
    executionStatus: "waiting_for_user",
    message: "Host terminal took ownership of this execution."
  });
  appendTaskExecutionEvent(projectDir, normalizedBoardId, normalizedTaskId, {
    type: "execution_takeover",
    owner: "host",
    previousOwner: "web",
    ...(pendingGate?.id ? { gateId: pendingGate.id, decision } : {})
  });
  if (waiter) {
    appendTaskExecutionEvent(projectDir, normalizedBoardId, normalizedTaskId, {
      type: "human_gate_answered",
      gateId: pendingGate.id,
      decision,
      source: "host_takeover"
    });
    waiter.resolve(decision);
  }
  return { task, execution: next, executionPath };
}

function takeoverGateDecision(choices = []) {
  if (choices.includes("stop")) return "stop";
  if (choices.includes("reject")) return "reject";
  if (choices.includes("cancel")) return "cancel";
  return choices[0] ?? "stop";
}

function phaseRunnerFromEnv() {
  const raw = process.env.AOF_TEST_GSD_PHASE_RESULT_JSON;
  if (!raw) return null;
  return async (_projectDir, phase) => {
    const result = JSON.parse(raw);
    return {
      phaseNumber: String(phase),
      phaseName: result.phaseName ?? `Phase ${phase}`,
      steps: result.steps ?? [],
      success: result.success !== false,
      totalCostUsd: result.totalCostUsd ?? 0,
      totalDurationMs: result.totalDurationMs ?? 0
    };
  };
}

function phaseRunnerFailure(result) {
  if (!result) return { subtype: "phase_result_missing", messages: ["No GSD phase result was returned."] };
  for (const step of result.steps ?? []) {
    for (const plan of step.planResults ?? []) {
      if (plan?.success === false && plan.error?.subtype) {
        return {
          subtype: plan.error.subtype,
          messages: Array.isArray(plan.error.messages) ? plan.error.messages : []
        };
      }
    }
    if (step?.success === false) {
      return {
        subtype: "phase_step_failed",
        messages: [step.error ?? `${step.step ?? "GSD phase step"} failed.`]
      };
    }
  }
  if (result.success === false) return { subtype: "phase_failed", messages: [] };
  return null;
}

function failureFromError(error) {
  return {
    subtype: error?.actual?.subtype ?? error?.code ?? "gsd_phase_error",
    messages: Array.isArray(error?.actual?.messages) ? error.actual.messages : [error?.message ?? String(error)]
  };
}

export async function readTaskExecution(projectDir, boardId, taskId) {
  const execution = await readExecution(projectDir, boardId, taskId);
  return { execution, executionPath: executionFilePath(projectDir, execution.boardId, execution.taskId) };
}

export async function readTaskExecutionEvents(projectDir, boardId, taskId) {
  const filePath = executionEventsFilePath(projectDir, boardId, taskId);
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function recordGsdSessionEvent(projectDir, boardId, taskId, executionPath, event = {}) {
  const sessionId = String(event.sessionId ?? event.session_id ?? "").trim();
  if (!sessionId) return null;
  const execution = await tryReadExecution(projectDir, boardId, taskId);
  if (!execution) return null;
  const runtime = execution.assignedAgent?.id ?? null;
  const eventType = String(event.type ?? "event");
  const eventAt = event.timestamp ?? nowIso();
  const sessions = Array.isArray(execution.resume?.sessions) ? [...execution.resume.sessions] : [];
  const index = sessions.findIndex((item) => item.id === sessionId);
  const previous = index >= 0 ? sessions[index] : {};
  const status = gsdSessionStatus(eventType, previous.status);
  const nextSession = {
    ...previous,
    id: sessionId,
    runtime,
    phase: event.phase ?? previous.phase ?? execution.phase,
    model: event.model ?? previous.model,
    cwd: event.cwd ?? previous.cwd,
    startedAt: previous.startedAt ?? (eventType === "session_init" ? eventAt : undefined),
    completedAt: eventType === "session_complete" || eventType === "session_error" ? eventAt : previous.completedAt,
    status,
    lastEventAt: eventAt
  };
  if (index >= 0) sessions[index] = nextSession;
  else sessions.push(nextSession);
  const currentSessionId = nextSession.status === "running"
    ? sessionId
    : execution.resume?.currentSessionId === sessionId ? null : execution.resume?.currentSessionId;

  const next = {
    ...execution,
    resume: {
      ...(execution.resume ?? {}),
      currentSessionId,
      lastSessionId: sessionId,
      sessions
    },
    updatedAt: execution.updatedAt
  };
  await writeText(executionPath, `${JSON.stringify(next, null, 2)}\n`);
  return nextSession;
}

function gsdSessionStatus(eventType, previousStatus) {
  if (eventType === "session_complete") return "complete";
  if (eventType === "session_error") return "failed";
  if (previousStatus === "complete" || previousStatus === "failed") return previousStatus;
  return "running";
}

function isHostOwnedExecution(execution) {
  return execution?.resume?.owner?.current === "host";
}

export function subscribeTaskExecutionEvents(projectDir, boardId, taskId, listener) {
  const key = executionEventKey(projectDir, boardId, taskId);
  executionEventBus.on(key, listener);
  return () => executionEventBus.off(key, listener);
}

export function appendTaskExecutionEvent(projectDir, boardId, taskId, input = {}) {
  const normalizedBoardId = normalizeId(boardId);
  const normalizedTaskId = normalizeId(taskId);
  const filePath = executionEventsFilePath(projectDir, normalizedBoardId, normalizedTaskId);
  const event = {
    at: nowIso(),
    ...input
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
  executionEventBus.emit(executionEventKey(projectDir, normalizedBoardId, normalizedTaskId), event);
  return event;
}

export async function updateTaskExecution(projectDir, boardId, taskId, input = {}) {
  const status = input.status;
  assertExecutionStatus(status);
  const execution = await readExecution(projectDir, boardId, taskId);
  const now = nowIso();
  const currentAttemptIndex = execution.attempts?.length ? execution.attempts.length - 1 : -1;
  const attempts = [...(execution.attempts ?? [])];
  if (currentAttemptIndex >= 0) {
    attempts[currentAttemptIndex] = {
      ...attempts[currentAttemptIndex],
      status,
      endedAt: ["blocked", "failed", "complete"].includes(status) ? now : attempts[currentAttemptIndex].endedAt
    };
  }
  const logs = [
    ...(execution.logs ?? []),
    {
      at: now,
      level: input.level ?? "info",
      message: input.message ?? `Execution status changed to ${status}.`
    }
  ];
  const next = {
    ...execution,
    status,
    attempts,
    logs,
    resume: {
      ...(execution.resume ?? {}),
      handoff: input.handoff ?? execution.resume?.handoff,
      lastMessage: input.message ?? execution.resume?.lastMessage
    },
    updatedAt: now
  };
  const filePath = executionFilePath(projectDir, next.boardId, next.taskId);
  await writeText(filePath, `${JSON.stringify(next, null, 2)}\n`);
  const task = await updateTaskExecutionSummary(projectDir, next.boardId, next.taskId, next, filePath, {
    type: "execution_status_changed",
    executionStatus: status,
    message: input.message
  });
  return { task, execution: next, executionPath: filePath };
}

function updateTaskExecutionSummary(projectDir, boardId, taskId, execution, executionPath, event) {
  return updateTask(projectDir, boardId, taskId, (task) => {
    const now = nowIso();
    const boardStatus = boardStatusForExecution(execution.status);
    return {
      ...task,
      status: boardStatus,
      assignedAgent: {
        id: execution.assignedAgent.id,
        description: execution.assignedAgent.description ?? "",
        assignedAt: task.assignedAgent?.assignedAt ?? execution.createdAt ?? now
      },
      execution: {
        provider: execution.provider,
        status: execution.status,
        phase: execution.phase,
        executionPath: relativeProjectPath(projectDir, executionPath),
        updatedAt: execution.updatedAt
      },
      history: [
        ...(Array.isArray(task.history) ? task.history : []),
        {
          at: now,
          ...event,
          boardStatus
        }
      ],
      updatedAt: now
    };
  });
}

function boardStatusForExecution(status) {
  if (status === "complete") return "done";
  if (status === "blocked" || status === "failed") return "blocked";
  return "in_progress";
}

function phaseRef(task) {
  const refs = task.refs ?? {};
  return refs.phase ?? refs.gsd?.phase ?? refs.phaseNumber ?? refs.roadmapPhase ?? null;
}

function assertTaskDependenciesComplete(board, task) {
  const blocked = taskDependencyIds(task)
    .map((dependencyId) => dependencyTask(board, dependencyId))
    .filter((dependency) => !dependency.complete);
  if (blocked.length === 0) return;

  const blockedLabels = blocked.map((dependency) => dependency.task?.id ?? `phase-${dependency.phaseId}`);
  throw new BoardLifecycleError(
    "BOARD_TASK_DEPENDENCY_BLOCKED",
    `Task ${board.id}/${task.id} cannot start until ${blockedLabels.join(", ")} ${blockedLabels.length === 1 ? "is" : "are"} done.`,
    {
      expected: "dependencies done",
      actual: blockedLabels,
      next: `Complete ${blockedLabels[0]} before assigning ${task.id}.`
    }
  );
}

function taskDependencyIds(task) {
  const refs = task.refs ?? {};
  const raw = task.dependsOn ?? refs.dependsOn ?? refs.dependencies ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  return [...new Set(values
    .flatMap((value) => String(value ?? "").split(/[,;]/u))
    .map((value) => value.trim().replace(/^phase-/iu, "").replace(/^Phase\s+/iu, ""))
    .filter(Boolean))];
}

function dependencyTask(board, phaseId) {
  const task = (board.tasks ?? []).find((item) => item.id === `phase-${phaseId}` || String(phaseRef(item) ?? "") === String(phaseId));
  return {
    phaseId,
    task,
    complete: Boolean(task && (task.status === "done" || task.execution?.status === "complete"))
  };
}

function isAssignmentLocked(task) {
  if (task.status === "done" || task.status === "in_progress") return true;
  return ["complete", "queued", "running", "waiting_for_user"].includes(task.execution?.status);
}

function gsdCommands(phase) {
  return [
    `$gsd-discuss-phase ${phase}`,
    `$gsd-plan-phase ${phase}`,
    `$gsd-execute-phase ${phase}`
  ];
}

function runtimeAgentsFromConfig(config) {
  const runtimes = normalizeRuntimes(config?.runtimes);
  return runtimes.map((runtime) => ({
    id: runtime,
    description: `${runtime} execution runtime.`,
    runtimes: [runtime],
    source: "runtime"
  }));
}

function normalizeRuntimes(runtimes) {
  const valid = new Set(["claude", "codex"]);
  if (!Array.isArray(runtimes)) return [];
  return [...new Set(runtimes.map((runtime) => String(runtime).trim()).filter((runtime) => valid.has(runtime)))];
}

async function readExecution(projectDir, boardId, taskId) {
  const normalizedBoardId = normalizeId(boardId);
  const normalizedTaskId = normalizeId(taskId);
  const filePath = executionFilePath(projectDir, normalizedBoardId, normalizedTaskId);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new BoardLifecycleError(
        "TASK_EXECUTION_NOT_FOUND",
        `Task execution not found: ${normalizedBoardId}/${normalizedTaskId}`,
        { actual: normalizedTaskId, next: `aof boards task assign ${normalizedBoardId} ${normalizedTaskId} <agent-id>` }
      );
    }
    throw error;
  }
}

async function tryReadExecution(projectDir, boardId, taskId) {
  const filePath = executionFilePath(projectDir, boardId, taskId);
  if (!await exists(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

function executionFilePath(projectDir, boardId, taskId) {
  const paths = boardWorkspacePaths(projectDir);
  return path.join(paths.boardsDir, normalizeId(boardId), "executions", `${normalizeId(taskId)}.json`);
}

function executionEventsFilePath(projectDir, boardId, taskId) {
  const paths = boardWorkspacePaths(projectDir);
  return path.join(paths.boardsDir, normalizeId(boardId), "executions", `${normalizeId(taskId)}.events.jsonl`);
}

function executionEventKey(projectDir, boardId, taskId) {
  return `${path.resolve(projectDir)}:${normalizeId(boardId)}:${normalizeId(taskId)}`;
}

function gateKey(projectDir, boardId, taskId, gateId) {
  return `${executionEventKey(projectDir, boardId, taskId)}:${gateId}`;
}

function relativeProjectPath(projectDir, filePath) {
  return path.relative(path.resolve(projectDir), filePath).split(path.sep).join("/");
}

function assertExecutionStatus(status) {
  if (!EXECUTION_STATUS_SET.has(status)) {
    throw new BoardLifecycleError(
      "TASK_EXECUTION_STATUS_INVALID",
      `Invalid execution status "${status}". Use one of ${EXECUTION_STATUSES.join(", ")}.`,
      { expected: EXECUTION_STATUSES, actual: status, next: `Use one of: ${EXECUTION_STATUSES.join(", ")}` }
    );
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
