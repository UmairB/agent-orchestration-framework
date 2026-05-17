import path from "node:path";
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

export async function listBoardAgents(projectDir, options = {}) {
  const configPath = await findProjectConfig(projectDir, options.config);
  if (!await exists(configPath)) return [];
  const config = await loadProjectConfig(configPath, options);
  return config.resources
    .filter((resource) => resource.kind === "agent")
    .map((agent) => ({
      id: agent.id,
      description: agent.description ?? "",
      runtimes: agent.runtimes ?? ["claude", "codex"],
      source: agent._aofSource?.scope ?? "local"
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
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
      `Unknown agent "${normalizedAgentId}". Configure it in .aof/aof.config.json before assignment.`,
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

  const phase = phaseRef(task);
  if (!phase) {
    throw new BoardLifecycleError(
      "BOARD_TASK_PHASE_REF_MISSING",
      `Task ${board.id}/${task.id} cannot use provider ${provider} without refs.phase.`,
      { expected: "refs.phase", actual: task.refs ?? null, next: `aof boards sync ${board.id} --milestone <milestone-id>` }
    );
  }

  const now = nowIso();
  const existing = await tryReadExecution(projectDir, board.id, task.id);
  const attemptNumber = (existing?.attempts?.length ?? 0) + 1;
  const attemptId = `attempt-${attemptNumber}`;
  const commands = gsdCommands(phase);
  const phaseRun = await runAssignedPhase(projectDir, phase, options);
  const status = phaseRun.failure ? "failed" : "complete";
  const endedAt = nowIso();
  const execution = {
    version: 1,
    boardId: board.id,
    taskId: task.id,
    provider,
    status,
    assignedAgent: agent,
    phase,
    commands,
    ...(phaseRun.sdkResult ? { sdkResult: phaseRun.sdkResult } : {}),
    ...(phaseRun.failure ? {
      errorSubtype: phaseRun.failure.subtype,
      errorMessages: phaseRun.failure.messages
    } : {}),
    attempts: [
      ...(existing?.attempts ?? []),
      {
        id: attemptId,
        status,
        startedAt: now,
        endedAt,
        commands,
        ...(phaseRun.sdkResult ? { sdkResult: phaseRun.sdkResult } : {}),
        ...(phaseRun.failure ? {
          errorSubtype: phaseRun.failure.subtype,
          errorMessages: phaseRun.failure.messages
        } : {})
      }
    ],
    logs: [
      ...(existing?.logs ?? []),
      {
        at: now,
        level: phaseRun.failure ? "error" : "info",
        message: phaseRun.failure
          ? `Assigned to agent ${agent.id}; GSD execution failed for phase ${phase}: ${phaseRun.failure.subtype}.`
          : `Assigned to agent ${agent.id}; completed GSD execution for phase ${phase}.`
      }
    ],
    resume: {
      provider,
      phase,
      nextCommand: commands[0],
      commands
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: endedAt
  };

  const executionPath = executionFilePath(projectDir, board.id, task.id);
  await writeText(executionPath, `${JSON.stringify(execution, null, 2)}\n`);
  const updatedTask = await updateTaskExecutionSummary(projectDir, board.id, task.id, execution, executionPath, {
    type: "assigned",
    agentId: agent.id,
    provider,
    executionStatus: "running"
  });

  return { task: updatedTask, execution, executionPath };
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
    ...(options.model ? { model: options.model } : {}),
    ...(options.maxBudgetUsd ? { maxBudgetUsd: Number(options.maxBudgetUsd) } : {}),
    ...(options.maxTurns ? { maxTurns: Number(options.maxTurns) } : {}),
    ...(options.maxBudgetPerStep ? { maxBudgetPerStep: Number(options.maxBudgetPerStep) } : {}),
    ...(options.maxTurnsPerStep ? { maxTurnsPerStep: Number(options.maxTurnsPerStep) } : {})
  };
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
  if (!result || result.success !== false) return null;
  for (const step of result.steps ?? []) {
    for (const plan of step.planResults ?? []) {
      if (plan?.success === false && plan.error?.subtype) {
        return {
          subtype: plan.error.subtype,
          messages: Array.isArray(plan.error.messages) ? plan.error.messages : []
        };
      }
    }
    if (step?.success === false && step.error) {
      return { subtype: "phase_step_failed", messages: [step.error] };
    }
  }
  return { subtype: "phase_failed", messages: [] };
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

function gsdCommands(phase) {
  return [
    `$gsd-discuss-phase ${phase}`,
    `$gsd-plan-phase ${phase}`,
    `$gsd-execute-phase ${phase}`
  ];
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
