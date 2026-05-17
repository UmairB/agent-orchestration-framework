import crypto from "node:crypto";
import path from "node:path";
import { access, readdir, readFile, rm } from "node:fs/promises";
import { backendSdkVersion, resolveBackend, supportedBackends } from "./backends/index.mjs";
import { normalizeId, writeText } from "./fs.mjs";
import { workspacePaths } from "./workspace.mjs";

export const BOARD_STATUSES = Object.freeze(["backlog", "ready", "in_progress", "blocked", "done"]);
const BOARD_FILE = "BOARD.json";
const INDEX_FILE = path.join("cache", "boards", "index.json");
const STATUS_SET = new Set(BOARD_STATUSES);
const BINDING_STATUSES = new Set(["pending-attachment", "attached", "synced", "drift", "error"]);

export class BoardLifecycleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BoardLifecycleError";
    this.code = code;
    this.expected = details.expected;
    this.actual = details.actual;
    this.next = details.next;
    this.cause = details.cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.expected !== undefined ? { expected: this.expected } : {}),
      ...(this.actual !== undefined ? { actual: this.actual } : {}),
      ...(this.next !== undefined ? { next: this.next } : {})
    };
  }
}

export function boardWorkspacePaths(projectDir = process.cwd()) {
  const paths = workspacePaths(projectDir);
  return {
    ...paths,
    boardsDir: path.join(paths.workspaceDir, "boards"),
    indexPath: path.join(paths.workspaceDir, INDEX_FILE)
  };
}

export async function createBoard(projectDir, input = {}, options = {}) {
  const id = normalizeId(input.id);
  const objective = typeof input.objective === "string" ? input.objective.trim() : typeof input.deliverable === "string" ? input.deliverable.trim() : "";
  if (!objective) throw new Error("Board objective is required.");
  const paths = boardWorkspacePaths(projectDir);
  const boardDir = boardDirPath(paths, id);
  const boardPath = path.join(boardDir, BOARD_FILE);
  if (!options.force && await exists(boardPath)) {
    throw new Error(`Board already exists: ${id}`);
  }

  const now = nowIso();
  const executionProvider = normalizeExecutionProvider(input.executionProvider);
  const backend = executionProvider ? resolveBackend(executionProvider) : null;
  const defaultExecutionRuntime = normalizeRuntime(input.defaultExecutionRuntime ?? input.runtime ?? "codex");
  const milestoneCommand = "$gsd-new-milestone";
  const milestoneInvocation = `${milestoneCommand} ${objective}`;
  const board = {
    version: 1,
    id,
    title: input.title ?? id,
    objective,
    status: "active",
    columns: [...BOARD_STATUSES],
    ...(backend?.kind === "gsd" ? {
      executionProvider,
      defaultExecutionRuntime,
      gsd: {
        milestone: {
          status: "waiting_for_user",
          binding: bindingState("pending-attachment", { backend }),
          command: milestoneCommand,
          invocation: milestoneInvocation,
          objective,
          createdAt: now,
          startedAt: now,
          completedAt: null,
          roadmapPath: null,
          syncedAt: null
        },
        taskCreation: {
          mode: "gsd-phase",
          addPhaseCommand: "$gsd-phase add",
          syncCommand: `aof boards sync ${id}`,
          syncBlockedReason: "milestone-incomplete"
        }
      }
    } : {}),
    createdAt: now,
    updatedAt: now
  };
  await writeText(boardPath, `${JSON.stringify(board, null, 2)}\n`, { dryRun: Boolean(options.dryRun) });
  return { board, boardPath, dryRun: Boolean(options.dryRun) };
}

export async function listBoards(projectDir, options = {}) {
  const index = options.useIndex === false ? null : await loadBoardIndexOrBuild(projectDir);
  const boards = index ? index.boards : (await buildBoardIndex(projectDir)).boards;
  return options.includeArchived ? boards : boards.filter((board) => board.status !== "archived");
}

export async function getBoard(projectDir, boardId) {
  const paths = boardWorkspacePaths(projectDir);
  const id = normalizeId(boardId);
  const board = await readCanonicalBoard(paths, id);
  const tasks = await readBoardTasks(paths, id);
  return { ...board, tasks: tasks.sort(byId) };
}

export async function archiveBoard(projectDir, boardId) {
  const paths = boardWorkspacePaths(projectDir);
  const id = normalizeId(boardId);
  const boardPath = path.join(boardDirPath(paths, id), BOARD_FILE);
  const board = await readCanonicalBoard(paths, id);
  const next = {
    ...board,
    status: "archived",
    updatedAt: nowIso()
  };
  await writeText(boardPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function removeBoard(projectDir, boardId, options = {}) {
  const paths = boardWorkspacePaths(projectDir);
  const id = normalizeId(boardId);
  const boardDir = boardDirPath(paths, id);
  const boardPath = path.join(boardDir, BOARD_FILE);
  if (!await exists(boardPath)) {
    throw new Error(`Board not found: ${id}`);
  }
  if (!options.dryRun) {
    await rm(boardDir, { recursive: true, force: true });
  }
  return {
    id,
    boardDir,
    dryRun: Boolean(options.dryRun)
  };
}

export async function repairBoard(projectDir, boardId, options = {}) {
  const paths = boardWorkspacePaths(projectDir);
  const id = normalizeId(boardId);
  const boardPath = path.join(boardDirPath(paths, id), BOARD_FILE);
  const board = await readJsonFile(boardPath);
  const now = nowIso();
  const objective = typeof board.objective === "string" ? board.objective.trim() : "";
  if (!objective) throw new Error(`Board ${id} cannot be repaired without an objective.`);
  const backend = backendForBoard(board);
  if (backend && backend.kind !== "gsd") throw new Error(`Board ${id} is not backed by GSD.`);
  if (backend?.kind === "gsd" && board.gsd?.milestone?.id && board.gsd?.milestone?.roadmapPath) {
    const next = ensureBoundSyncCommand(board, id);
    if (next !== board) {
      await writeText(boardPath, `${JSON.stringify(next, null, 2)}\n`, { dryRun: Boolean(options.dryRun) });
      return {
        board: next,
        repaired: !options.dryRun,
        action: "normalize-sync-command",
        message: `Board ${id} sync command now includes --milestone ${next.gsd.milestone.id}.`
      };
    }
    return {
      board,
      repaired: false,
      action: "none",
      message: `Board ${id} already has a backing GSD milestone roadmap.`
    };
  }
  if (backend?.kind === "gsd" && board.gsd?.milestone?.roadmapPath && !board.gsd?.milestone?.id) {
    return repairMissingMilestoneId(projectDir, paths, boardPath, board, id, options, backend);
  }
  if (backend?.kind === "gsd" && board.gsd?.milestone?.status && board.gsd.milestone.status !== "synced" && (board.gsd.milestone.invocation || board.gsd.milestone.startedAt)) {
    return {
      board,
      repaired: false,
      action: "none",
      command: board.gsd.milestone.invocation ?? `${board.gsd.milestone.command ?? "$gsd-new-milestone"} ${objective}`,
      message: `Board ${id} already has a GSD milestone in progress. Complete ${board.gsd.milestone.command ?? "$gsd-new-milestone"}, then sync after the milestone roadmap is attached.`
    };
  }

  const milestoneCommand = "$gsd-new-milestone";
  const milestoneInvocation = `${milestoneCommand} ${objective}`;
  const next = {
    ...board,
    executionProvider: "gsd",
    defaultExecutionRuntime: normalizeRuntime(board.defaultExecutionRuntime ?? options.defaultExecutionRuntime ?? options.runtime ?? "codex"),
    gsd: {
      ...(board.gsd ?? {}),
      milestone: {
        ...(board.gsd?.milestone ?? {}),
        status: "waiting_for_user",
        binding: board.gsd?.milestone?.binding ?? bindingState("pending-attachment", { backend: resolveBackend("gsd") }),
        command: milestoneCommand,
        invocation: milestoneInvocation,
        objective,
        createdAt: board.gsd?.milestone?.createdAt ?? now,
        startedAt: board.gsd?.milestone?.startedAt ?? now,
        completedAt: board.gsd?.milestone?.completedAt ?? null,
        roadmapPath: board.gsd?.milestone?.roadmapPath ?? null,
        syncedAt: null
      },
      taskCreation: {
        mode: "gsd-phase",
        addPhaseCommand: "$gsd-phase add",
        syncCommand: `aof boards sync ${id}`,
        ...(board.gsd?.taskCreation ?? {}),
        syncBlockedReason: "milestone-incomplete"
      }
    },
    updatedAt: now
  };
  await writeText(boardPath, `${JSON.stringify(next, null, 2)}\n`, { dryRun: Boolean(options.dryRun) });
  return {
    board: next,
    repaired: true,
    action: "create-gsd-milestone",
    command: next.gsd.milestone.invocation,
    message: `Board ${id} started ${next.gsd.milestone.invocation}. Complete the GSD milestone, then sync after the milestone roadmap is attached.`
  };
}

export async function updateBoardMilestone(projectDir, boardId, runtimeResult, options = {}) {
  const paths = boardWorkspacePaths(projectDir);
  const id = normalizeId(boardId);
  const boardPath = path.join(boardDirPath(paths, id), BOARD_FILE);
  const board = await readJsonFile(boardPath);
  const backend = backendForBoard(board);
  if (backend?.kind !== "gsd") {
    throw new Error(`Board ${id} is not backed by GSD.`);
  }

  const now = nowIso();
  const output = [runtimeResult.stdout, runtimeResult.stderr].filter(Boolean).join("\n").trim();
  const previousTurns = Array.isArray(board.gsd?.milestone?.session?.turns) ? board.gsd.milestone.session.turns : [];
  const turns = [
    ...previousTurns,
    ...(options.answer ? [{ at: runtimeResult.startedAt ?? now, role: "user", text: options.answer }] : []),
    ...(output ? [{ at: runtimeResult.endedAt ?? now, role: "runtime", text: output }] : [])
  ];
  const status = runtimeResult.status === "completed"
    ? "ready_to_sync"
    : runtimeResult.status === "failed"
      ? "failed"
      : "waiting_for_user";
  const roadmapPath = runtimeResult.status === "completed"
    ? runtimeResult.roadmapPath ?? board.gsd?.milestone?.roadmapPath ?? null
    : board.gsd?.milestone?.roadmapPath ?? null;

  const next = {
    ...board,
    gsd: {
      ...(board.gsd ?? {}),
      milestone: {
        ...(board.gsd?.milestone ?? {}),
        status,
        binding: board.gsd?.milestone?.binding ?? bindingState("pending-attachment", { backend }),
        runtime: runtimeResult.runtime ?? board.defaultExecutionRuntime ?? "codex",
        commandLine: [runtimeResult.executable, ...(runtimeResult.argv ?? [])].filter(Boolean).join(" "),
        exitCode: runtimeResult.exitCode ?? null,
        roadmapPath,
        completedAt: runtimeResult.status === "completed" ? runtimeResult.endedAt ?? now : board.gsd?.milestone?.completedAt ?? null,
        lastOutput: output,
        lastError: runtimeResult.error ?? null,
        session: {
          ...(board.gsd?.milestone?.session ?? {}),
          status,
          runtime: runtimeResult.runtime ?? board.defaultExecutionRuntime ?? "codex",
          executable: runtimeResult.executable,
          argv: runtimeResult.argv ?? [],
          exitCode: runtimeResult.exitCode ?? null,
          startedAt: board.gsd?.milestone?.session?.startedAt ?? runtimeResult.startedAt ?? now,
          updatedAt: runtimeResult.endedAt ?? now,
          turns
        }
      },
      taskCreation: {
        mode: "gsd-phase",
        addPhaseCommand: "$gsd-phase add",
        syncCommand: `aof boards sync ${id}`,
        ...(board.gsd?.taskCreation ?? {}),
        syncBlockedReason: runtimeResult.status === "completed" ? null : "milestone-incomplete"
      }
    },
    updatedAt: now
  };
  await writeText(boardPath, `${JSON.stringify(next, null, 2)}\n`, { dryRun: Boolean(options.dryRun) });
  return next;
}

export async function attachBoardMilestoneRoadmap(projectDir, boardId, input = {}, options = {}) {
  const paths = boardWorkspacePaths(projectDir);
  const id = normalizeId(boardId);
  const milestoneId = normalizeMilestoneInput(input.milestoneId ?? input.milestone);
  const roadmapPath = typeof input.roadmapPath === "string" ? input.roadmapPath.trim() : "";
  if (!roadmapPath) throw new Error("Milestone roadmap path is required.");

  const boardPath = path.join(boardDirPath(paths, id), BOARD_FILE);
  const board = await readJsonFile(boardPath);
  const backend = backendForBoard(board);
  if (backend?.kind !== "gsd") {
    throw new Error(`Board ${id} is not backed by GSD.`);
  }

  const assertion = await assertBoardMilestone(projectDir, milestoneId, options, backend);
  if (!assertion.ok) throw milestoneAssertionError(id, milestoneId, assertion);

  const resolvedRoadmapPath = path.resolve(projectDir, roadmapPath);
  if (!await exists(resolvedRoadmapPath)) {
    throw new Error(`Milestone roadmap not found: ${roadmapPath}`);
  }

  const now = nowIso();
  const next = {
    ...board,
    gsd: {
      ...(board.gsd ?? {}),
      milestone: {
        ...(board.gsd?.milestone ?? {}),
        id: milestoneId,
        status: "ready_to_sync",
        binding: bindingState("attached", { backend }),
        roadmapPath: relativeProjectPath(projectDir, resolvedRoadmapPath),
        completedAt: board.gsd?.milestone?.completedAt ?? now,
        syncedAt: null
      },
      taskCreation: {
        mode: "gsd-phase",
        addPhaseCommand: "$gsd-phase add",
        ...(board.gsd?.taskCreation ?? {}),
        syncCommand: `aof boards sync ${id} --milestone ${milestoneId}`,
        syncBlockedReason: null
      }
    },
    updatedAt: now
  };
  await writeText(boardPath, `${JSON.stringify(next, null, 2)}\n`, { dryRun: Boolean(options.dryRun) });
  return next;
}

export async function addTask(projectDir, boardId, input = {}, options = {}) {
  const paths = boardWorkspacePaths(projectDir);
  const normalizedBoardId = normalizeId(boardId);
  const board = await readCanonicalBoard(paths, normalizedBoardId);
  const backend = backendForBoard(board);
  if (backend?.kind === "gsd" && options.source !== "gsd-roadmap-sync") {
    const bindingStatus = currentBindingStatus(board);
    if (bindingStatus !== "synced") {
      throw new Error(`Board ${normalizedBoardId} is backed by GSD and cannot accept tasks until its milestone roadmap is synced. Run ${board.gsd?.milestone?.command ?? "$gsd-new-milestone"} first, then \`${board.gsd?.taskCreation?.syncCommand ?? `aof boards sync ${normalizedBoardId}`}\`.`);
    }
    throw new Error(`Board ${normalizedBoardId} is backed by GSD. Add tasks with ${board.gsd?.taskCreation?.addPhaseCommand ?? "$gsd-phase add"}, then run \`${board.gsd?.taskCreation?.syncCommand ?? `aof boards sync ${normalizedBoardId}`}\`.`);
  }
  const id = normalizeId(input.id);
  const status = input.status ?? "backlog";
  assertValidStatus(status);
  const taskPath = taskFilePath(paths, normalizedBoardId, id);
  if (!options.force && await exists(taskPath)) {
    throw new Error(`Task already exists: ${normalizedBoardId}/${id}`);
  }
  if (!input.title) throw new Error("Task title is required.");

  const now = nowIso();
  const task = {
    version: 1,
    id,
    boardId: normalizedBoardId,
    title: input.title,
    description: input.description ?? "",
    status,
    priority: input.priority ?? "normal",
    deliverable: input.deliverable ?? "",
    refs: input.refs ?? {},
    history: [{
      at: now,
      type: "created",
      status
    }],
    createdAt: now,
    updatedAt: now
  };
  await writeText(taskPath, `${JSON.stringify(task, null, 2)}\n`, { dryRun: Boolean(options.dryRun) });
  return { task, taskPath, dryRun: Boolean(options.dryRun) };
}

export async function syncBoardFromGsdRoadmap(projectDir, boardId, options = {}) {
  const paths = boardWorkspacePaths(projectDir);
  const normalizedBoardId = normalizeId(boardId);
  const boardPath = path.join(boardDirPath(paths, normalizedBoardId), BOARD_FILE);
  const board = await readJsonFile(boardPath);
  const backend = backendForBoard(board);
  if (backend?.kind !== "gsd") {
    throw new Error(`Board ${normalizedBoardId} is not backed by GSD.`);
  }

  const requestedMilestoneId = normalizeMilestoneInput(options.milestoneId);
  if (!requestedMilestoneId) {
    throw new BoardLifecycleError(
      "MILESTONE_MISSING_ARG",
      "Usage: aof boards sync <board-id> --milestone <milestone-id>",
      { next: `aof boards sync ${normalizedBoardId} --milestone <milestone-id>` }
    );
  }
  const configuredMilestoneId = normalizeMilestoneInput(board.gsd?.milestone?.id);
  if (!configuredMilestoneId) {
    throw new BoardLifecycleError(
      "MILESTONE_NOT_BOUND",
      `Board ${normalizedBoardId} is not bound to a GSD milestone id.`,
      { next: `aof boards milestone attach ${normalizedBoardId} --milestone ${requestedMilestoneId} --roadmap <path>` }
    );
  }
  if (configuredMilestoneId !== requestedMilestoneId) {
    throw new BoardLifecycleError(
      "MILESTONE_ID_MISMATCH",
      `Board ${normalizedBoardId} is bound to milestone ${configuredMilestoneId}, not ${requestedMilestoneId}.`,
      { expected: configuredMilestoneId, actual: requestedMilestoneId, next: `aof boards sync ${normalizedBoardId} --milestone ${configuredMilestoneId}` }
    );
  }

  const configuredRoadmap = board.gsd?.milestone?.roadmapPath;
  if (!configuredRoadmap) {
    const milestoneStatus = board.gsd?.milestone?.status ?? "pending";
    if (["pending", "creating", "running", "waiting_for_user"].includes(milestoneStatus)) {
      throw new BoardLifecycleError(
        "MILESTONE_INCOMPLETE",
        `Board ${normalizedBoardId} GSD milestone has not completed. Complete ${board.gsd?.milestone?.invocation ?? board.gsd?.milestone?.command ?? "$gsd-new-milestone"} and attach its roadmap before syncing.`,
        { next: `aof boards milestone attach ${normalizedBoardId} --milestone ${configuredMilestoneId} --roadmap <path>` }
      );
    }
    throw new BoardLifecycleError(
      "BOARD_MILESTONE_UNATTACHED",
      `Board ${normalizedBoardId} is not bound to a GSD milestone roadmap.`,
      { next: `aof boards repair ${normalizedBoardId}` }
    );
  }

  let phases;
  try {
    const assertion = await assertBoardMilestone(projectDir, configuredMilestoneId, options, backend);
    if (!assertion.ok) throw milestoneAssertionError(normalizedBoardId, configuredMilestoneId, assertion);
    phases = normalizeRoadmapPhases(await readTypedRoadmap(projectDir, options, backend));
  } catch (error) {
    const nextError = boardErrorFromSdk(error);
    await persistBindingError(boardPath, board, configuredMilestoneId, nextError, options);
    throw nextError;
  }
  if (phases.length === 0) {
    throw new BoardLifecycleError(
      "MILESTONE_INCOMPLETE",
      `No GSD phases found for milestone ${configuredMilestoneId}.`,
      { next: `aof boards milestone attach ${normalizedBoardId} --milestone ${configuredMilestoneId} --roadmap <path>` }
    );
  }
  const fingerprint = phaseIdentityFingerprint(phases);

  const existingTasks = await readBoardTasks(paths, normalizedBoardId);
  const existing = new Set(existingTasks.map((task) => task.id));
  const actions = syncActions(phases, existingTasks);
  const created = [];
  try {
    for (const phase of phases) {
      const taskId = `phase-${phase.phaseId}`;
      if (existing.has(taskId) || options.dryRun) continue;
      const result = await addTask(projectDir, normalizedBoardId, {
        id: taskId,
        title: `Phase ${phase.phaseId}: ${phase.title}`,
        description: phase.goal,
        deliverable: board.title,
        refs: {
          phase: phase.phaseId,
          roadmap: configuredRoadmap
        }
      }, { source: "gsd-roadmap-sync" });
      created.push(result.task);
    }
  } catch (error) {
    await persistBindingError(boardPath, board, configuredMilestoneId, error, options);
    throw error;
  }

  const now = nowIso();
  const hasDrift = actions.some((action) => action.action === "drift");
  const next = {
    ...board,
    gsd: {
      ...(board.gsd ?? {}),
      milestone: {
        ...(board.gsd?.milestone ?? {}),
        status: hasDrift ? "ready_to_sync" : "synced",
        id: configuredMilestoneId,
        phases,
        binding: bindingState(hasDrift ? "drift" : "synced", {
          backend,
          fingerprint,
          driftReason: hasDrift ? "BOARD_MILESTONE_DRIFT" : undefined
        }),
        command: board.gsd?.milestone?.command ?? "$gsd-new-milestone",
        invocation: board.gsd?.milestone?.invocation ?? `${board.gsd?.milestone?.command ?? "$gsd-new-milestone"} ${board.objective ?? ""}`.trim(),
        roadmapPath: configuredRoadmap,
        phaseCount: phases.length,
        completedAt: board.gsd?.milestone?.completedAt ?? now,
        syncedAt: hasDrift ? board.gsd?.milestone?.syncedAt ?? null : now
      },
      taskCreation: {
        mode: "gsd-phase",
        addPhaseCommand: "$gsd-phase add",
        ...(board.gsd?.taskCreation ?? {}),
        syncCommand: `aof boards sync ${normalizedBoardId} --milestone ${configuredMilestoneId}`,
        syncBlockedReason: null
      }
    },
    updatedAt: now
  };
  if (!options.dryRun) await writeText(boardPath, `${JSON.stringify(next, null, 2)}\n`);
  return { board: options.dryRun ? board : next, phases, created, actions, dryRun: Boolean(options.dryRun) };
}

export async function moveTask(projectDir, boardId, taskId, status) {
  assertValidStatus(status);
  const paths = boardWorkspacePaths(projectDir);
  const normalizedBoardId = normalizeId(boardId);
  const normalizedTaskId = normalizeId(taskId);
  const taskPath = taskFilePath(paths, normalizedBoardId, normalizedTaskId);
  const task = await readJsonFile(taskPath);
  const now = nowIso();
  const next = {
    ...task,
    status,
    history: [
      ...(Array.isArray(task.history) ? task.history : []),
      {
        at: now,
        type: "status_changed",
        from: task.status,
        to: status
      }
    ],
    updatedAt: now
  };
  await writeText(taskPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function editTask(projectDir, boardId, taskId, input = {}) {
  return updateTask(projectDir, boardId, taskId, (task) => {
    const now = nowIso();
    const next = {
      ...task,
      title: input.title ?? task.title,
      description: input.description ?? task.description ?? "",
      priority: input.priority ?? task.priority ?? "normal",
      deliverable: input.deliverable ?? task.deliverable ?? "",
      refs: input.refs ?? task.refs ?? {},
      history: [
        ...(Array.isArray(task.history) ? task.history : []),
        {
          at: now,
          type: "edited"
        }
      ],
      updatedAt: now
    };
    if (typeof next.title !== "string" || next.title.trim() === "") throw new Error("Task title is required.");
    return next;
  });
}

export async function updateTask(projectDir, boardId, taskId, updater) {
  const paths = boardWorkspacePaths(projectDir);
  const normalizedBoardId = normalizeId(boardId);
  const normalizedTaskId = normalizeId(taskId);
  const taskPath = taskFilePath(paths, normalizedBoardId, normalizedTaskId);
  const task = await readJsonFile(taskPath);
  if (task.boardId !== normalizedBoardId || task.id !== normalizedTaskId) {
    throw new Error(`Task identity mismatch for ${normalizedBoardId}/${normalizedTaskId}.`);
  }
  const next = await updater(task);
  await writeText(taskPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function buildBoardIndex(projectDir) {
  const paths = boardWorkspacePaths(projectDir);
  const boards = [];
  for (const boardDir of await boardDirs(paths)) {
    const board = await readJsonFile(path.join(boardDir, BOARD_FILE));
    const tasks = await readBoardTasks(paths, board.id);
    boards.push(boardSummary(board, tasks));
  }
  boards.sort(byId);
  const fingerprint = await canonicalFingerprint(paths);
  return {
    version: 1,
    generatedAt: nowIso(),
    fingerprint,
    boards
  };
}

export async function writeBoardIndex(projectDir) {
  const paths = boardWorkspacePaths(projectDir);
  const index = await buildBoardIndex(projectDir);
  await writeText(paths.indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return { index, indexPath: paths.indexPath };
}

export async function readBoardIndex(projectDir) {
  const paths = boardWorkspacePaths(projectDir);
  if (!await exists(paths.indexPath)) return null;
  return readJsonFile(paths.indexPath);
}

export async function loadBoardIndexOrBuild(projectDir) {
  const index = await readBoardIndex(projectDir);
  if (!index) return buildBoardIndex(projectDir);
  const currentFingerprint = await canonicalFingerprint(boardWorkspacePaths(projectDir));
  if (index.fingerprint !== currentFingerprint) return buildBoardIndex(projectDir);
  return index;
}

export async function validateBoards(projectDir) {
  const paths = boardWorkspacePaths(projectDir);
  const diagnostics = [];
  const seenBoardIds = new Map();

  for (const boardDir of await boardDirs(paths)) {
    const boardPath = path.join(boardDir, BOARD_FILE);
    const relativeBoardPath = displayPath(paths, boardPath);
    const board = await tryReadJson(boardPath, diagnostics, relativeBoardPath, "BOARD_MALFORMED_JSON");
    if (!board) continue;

    validateBoardShape(board, diagnostics, relativeBoardPath);
    if (typeof board.id === "string") {
      if (seenBoardIds.has(board.id)) {
        diagnostics.push(error("BOARD_DUPLICATE_ID", relativeBoardPath, `Duplicate board id "${board.id}" also appears at ${seenBoardIds.get(board.id)}.`));
      } else {
        seenBoardIds.set(board.id, relativeBoardPath);
      }
    }

    const tasksDir = path.join(boardDir, "tasks");
    for (const taskPath of await taskFiles(tasksDir)) {
      const relativeTaskPath = displayPath(paths, taskPath);
      const task = await tryReadJson(taskPath, diagnostics, relativeTaskPath, "TASK_MALFORMED_JSON");
      if (!task) continue;
      validateTaskShape(task, board, diagnostics, relativeTaskPath);
    }
  }

  const index = await tryReadIndex(paths, diagnostics);
  const fingerprint = await canonicalFingerprint(paths);
  if (!index) {
    diagnostics.push(warning("BOARD_INDEX_MISSING", ".aof/cache/boards/index.json", "Board index is missing; run `aof boards index` to rebuild it."));
  } else if (index.fingerprint !== fingerprint) {
    diagnostics.push(warning("BOARD_INDEX_STALE", ".aof/cache/boards/index.json", "Board index is stale; run `aof boards index` to rebuild it."));
  }

  return diagnostics;
}

function boardSummary(board, tasks) {
  const counts = Object.fromEntries(BOARD_STATUSES.map((status) => [status, 0]));
  for (const task of tasks) {
    if (STATUS_SET.has(task.status)) counts[task.status] += 1;
  }
  return {
    id: board.id,
    title: board.title,
    objective: board.objective ?? "",
    status: board.status ?? "active",
    columns: Array.isArray(board.columns) ? board.columns : [...BOARD_STATUSES],
    executionProvider: board.executionProvider ?? null,
    defaultExecutionRuntime: board.defaultExecutionRuntime ?? null,
    gsd: board.gsd ?? null,
    updatedAt: board.updatedAt,
    taskCount: tasks.length,
    counts,
    tasks: tasks.map(taskSummary).sort(byId)
  };
}

function taskSummary(task) {
  return {
    id: task.id,
    boardId: task.boardId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    deliverable: task.deliverable ?? "",
    refs: task.refs ?? {},
    assignedAgent: task.assignedAgent ?? null,
    execution: task.execution ?? null,
    updatedAt: task.updatedAt
  };
}

async function readCanonicalBoard(paths, id) {
  return readJsonFile(path.join(boardDirPath(paths, id), BOARD_FILE));
}

async function readBoardTasks(paths, boardId) {
  const dir = path.join(boardDirPath(paths, boardId), "tasks");
  const files = await taskFiles(dir);
  const tasks = [];
  for (const filePath of files) {
    tasks.push(await readJsonFile(filePath));
  }
  return tasks;
}

function validateBoardShape(board, diagnostics, pathName) {
  if (!board || typeof board !== "object" || Array.isArray(board)) {
    diagnostics.push(error("BOARD_MALFORMED", pathName, "Board file must contain a JSON object."));
    return;
  }
  if (!validId(board.id)) diagnostics.push(error("BOARD_INVALID_ID", pathName, "Board id is required and must use a valid AOF id."));
  if (typeof board.title !== "string" || board.title.trim() === "") diagnostics.push(error("BOARD_INVALID_TITLE", pathName, "Board title is required."));
  if (board.status !== undefined && !["active", "archived"].includes(board.status)) diagnostics.push(error("BOARD_INVALID_STATUS", pathName, "Board status must be active or archived."));
  if (board.executionProvider !== undefined) {
    try {
      resolveBackend(board.executionProvider);
    } catch {
      diagnostics.push(error("BOARD_INVALID_EXECUTION_PROVIDER", pathName, `Board executionProvider must be one of ${supportedBackends().join(", ")} when provided.`));
    }
  }
  if (board.defaultExecutionRuntime !== undefined && !["claude", "codex"].includes(board.defaultExecutionRuntime)) diagnostics.push(error("BOARD_INVALID_EXECUTION_RUNTIME", pathName, "Board defaultExecutionRuntime must be claude or codex."));
  if (board.executionProvider === "gsd" && board.gsd?.milestone?.roadmapPath && !board.gsd?.milestone?.id) {
    diagnostics.push(warning(
      "BOARD_MILESTONE_ID_MISSING",
      pathName,
      `GSD board is missing gsd.milestone.id; run \`aof boards milestone attach ${board.id ?? "<board-id>"} --milestone <milestone-id> --roadmap ${board.gsd.milestone.roadmapPath}\`.`
    ));
  }
  const bindingStatus = board.gsd?.milestone?.binding?.status;
  if (bindingStatus !== undefined && !BINDING_STATUSES.has(bindingStatus)) diagnostics.push(error("BOARD_INVALID_BINDING_STATUS", pathName, "Board GSD binding status is invalid."));
  if (!Array.isArray(board.columns) || BOARD_STATUSES.some((status) => !board.columns.includes(status))) {
    diagnostics.push(error("BOARD_INVALID_COLUMNS", pathName, `Board columns must include ${BOARD_STATUSES.join(", ")}.`));
  }
}

async function repairMissingMilestoneId(projectDir, paths, boardPath, board, id, options, backend) {
  const roadmapPath = board.gsd.milestone.roadmapPath;
  const roadmap = await readTypedRoadmap(projectDir, options, backend);
  const phases = normalizeRoadmapPhases(roadmap);
  const candidates = Array.isArray(roadmap?.milestones) ? roadmap.milestones.map((item) => item.version).filter(Boolean) : [];
  const existingFingerprint = existingBoardPhaseFingerprint(await readBoardTasks(paths, id));
  const nextFingerprint = phaseIdentityFingerprint(phases);
  const pathMatchesDefault = normalizeProjectPath(roadmapPath) === ".planning/ROADMAP.md";
  const fingerprintMatches = existingFingerprint && existingFingerprint === nextFingerprint;

  if (candidates.length !== 1 || (!pathMatchesDefault && !fingerprintMatches)) {
    return {
      board,
      repaired: false,
      action: "manual-attach-required",
      command: `aof boards milestone attach ${id} --milestone <milestone-id> --roadmap ${roadmapPath}`,
      message: `Board ${id} needs manual milestone attachment before sync.`
    };
  }

  const milestoneId = normalizeMilestoneInput(candidates[0]);
  const assertion = await assertBoardMilestone(projectDir, milestoneId, options, backend);
  if (!assertion.ok) throw milestoneAssertionError(id, milestoneId, assertion);

  const now = nowIso();
  const next = {
    ...board,
    gsd: {
      ...(board.gsd ?? {}),
      milestone: {
        ...(board.gsd?.milestone ?? {}),
        id: milestoneId,
        status: "ready_to_sync",
        binding: bindingState("attached", {
          backend,
          fingerprint: phases.length > 0 ? nextFingerprint : undefined
        }),
        completedAt: board.gsd?.milestone?.completedAt ?? now,
        syncedAt: null
      },
      taskCreation: {
        mode: "gsd-phase",
        addPhaseCommand: "$gsd-phase add",
        ...(board.gsd?.taskCreation ?? {}),
        syncCommand: `aof boards sync ${id} --milestone ${milestoneId}`,
        syncBlockedReason: null
      }
    },
    updatedAt: now
  };

  await writeText(boardPath, `${JSON.stringify(next, null, 2)}\n`, { dryRun: Boolean(options.dryRun) });
  return {
    board: next,
    repaired: true,
    action: "attach-milestone",
    command: next.gsd.taskCreation.syncCommand,
    message: `Board ${id} attached to milestone ${milestoneId}.`
  };
}

function ensureBoundSyncCommand(board, id) {
  const milestoneId = normalizeMilestoneInput(board.gsd?.milestone?.id);
  if (!milestoneId) return board;
  const expected = `aof boards sync ${id} --milestone ${milestoneId}`;
  if (board.gsd?.taskCreation?.syncCommand === expected && board.gsd?.milestone?.binding?.status) return board;
  return {
    ...board,
    gsd: {
      ...(board.gsd ?? {}),
      milestone: {
        ...(board.gsd?.milestone ?? {}),
        id: milestoneId,
        binding: board.gsd?.milestone?.binding ?? bindingState("attached")
      },
      taskCreation: {
        mode: "gsd-phase",
        addPhaseCommand: "$gsd-phase add",
        ...(board.gsd?.taskCreation ?? {}),
        syncCommand: expected,
        syncBlockedReason: board.gsd?.taskCreation?.syncBlockedReason ?? null
      }
    },
    updatedAt: nowIso()
  };
}

async function readTypedRoadmap(projectDir, options, backend = resolveBackend("gsd")) {
  try {
    return await backend.analyzeRoadmap(projectDir, options);
  } catch (error) {
    throw boardErrorFromSdk(error);
  }
}

async function assertBoardMilestone(projectDir, milestoneId, options, backend = resolveBackend("gsd")) {
  const candidates = milestoneCandidates(milestoneId);
  let lastResult = null;
  for (const candidate of candidates) {
    try {
      const result = await backend.assertMilestone(projectDir, candidate, options);
      if (result.ok) return { ...result, expected: milestoneId, actual: result.actual ?? candidate };
      lastResult = result;
    } catch (error) {
      throw boardErrorFromSdk(error);
    }
  }
  return lastResult ?? { ok: false, expected: milestoneId, actual: null, code: "MILESTONE_NOT_IN_STATE" };
}

function milestoneAssertionError(boardId, milestoneId, assertion) {
  const code = assertion.code === "MILESTONE_ID_MISMATCH" ? "MILESTONE_ID_MISMATCH" : "MILESTONE_NOT_IN_STATE";
  return new BoardLifecycleError(
    code,
    `Milestone ${milestoneId} is not available in current GSD state.`,
    {
      expected: assertion.expected ?? milestoneId,
      actual: assertion.actual ?? null,
      next: `aof boards milestone attach ${boardId} --milestone <milestone-id> --roadmap <path>`
    }
  );
}

function boardErrorFromSdk(error) {
  if (error instanceof BoardLifecycleError) return error;
  if (typeof error?.toJSON === "function" && typeof error?.code === "string" && error.name !== "GsdSdkError") return error;
  if (error?.name === "GsdSdkError") {
    return new BoardLifecycleError(error.code, error.message, {
      expected: error.expected,
      actual: error.actual,
      next: error.next,
      cause: error
    });
  }
  return error;
}

async function persistBindingError(boardPath, board, milestoneId, error, options = {}) {
  if (options.dryRun) return;
  const next = {
    ...board,
    gsd: {
      ...(board.gsd ?? {}),
      milestone: {
        ...(board.gsd?.milestone ?? {}),
        id: milestoneId,
        binding: bindingState("error", {
          driftReason: error?.code ?? "SYNC_FAILED"
        })
      }
    },
    updatedAt: nowIso()
  };
  await writeText(boardPath, `${JSON.stringify(next, null, 2)}\n`);
}

function normalizeRoadmapPhases(roadmap) {
  return (Array.isArray(roadmap?.phases) ? roadmap.phases : [])
    .map((phase) => {
      const phaseId = String(phase.number ?? phase.phaseId ?? phase.id ?? "").trim();
      if (!phaseId) return null;
      const title = String(phase.name ?? phase.phase_name ?? phase.title ?? `Phase ${phaseId}`).trim();
      const goal = String(phase.goal ?? phase.description ?? "").trim();
      return { phaseId, title, goal };
    })
    .filter(Boolean);
}

function syncActions(phases, existingTasks) {
  const phaseIds = new Set(phases.map((phase) => phase.phaseId));
  const existingByPhase = new Set(existingTasks.map((task) => String(task.refs?.phase ?? "").trim()).filter(Boolean));
  const actions = phases.map((phase) => ({
    phaseId: phase.phaseId,
    action: existingByPhase.has(phase.phaseId) ? "keep" : "create"
  }));
  for (const phaseId of existingByPhase) {
    if (!phaseIds.has(phaseId)) actions.push({ phaseId, action: "drift" });
  }
  return actions;
}

function bindingState(status, details = {}) {
  return {
    status,
    sdkVersion: backendSdkVersion(details.backend ?? "gsd").installed,
    ...(details.fingerprint ? { fingerprint: details.fingerprint } : {}),
    ...(details.driftReason ? { driftReason: details.driftReason } : {})
  };
}

function normalizeExecutionProvider(value) {
  if (value === undefined || value === null || value === "") return null;
  return resolveBackend(value).kind;
}

function backendForBoard(board) {
  if (!board?.executionProvider) return null;
  return resolveBackend(board.executionProvider);
}

function phaseIdentityFingerprint(phases) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(phases.map((phase) => ({
    phaseId: phase.phaseId,
    title: phase.title,
    goal: phase.goal
  }))));
  return hash.digest("hex");
}

function existingBoardPhaseFingerprint(tasks) {
  const phases = tasks
    .filter((task) => task.refs?.phase)
    .map((task) => ({
      phaseId: String(task.refs.phase),
      title: String(task.title ?? "").replace(/^Phase\s+[^:]+:\s*/u, ""),
      goal: String(task.description ?? "")
    }))
    .sort((left, right) => left.phaseId.localeCompare(right.phaseId));
  return phases.length > 0 ? phaseIdentityFingerprint(phases) : null;
}

function currentBindingStatus(board) {
  return board.gsd?.milestone?.binding?.status ?? (board.gsd?.milestone?.id && board.gsd?.milestone?.status === "synced" ? "synced" : "pending-attachment");
}

function normalizeMilestoneInput(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return normalizeId(value);
}

function milestoneCandidates(value) {
  const normalized = normalizeMilestoneInput(value);
  if (!normalized) return [];
  const dotted = normalized.replace(/^v(\d+)-(\d+)$/u, "v$1.$2");
  return [...new Set([normalized, dotted, value.trim()].filter(Boolean))];
}

function normalizeProjectPath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function validateTaskShape(task, board, diagnostics, pathName) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    diagnostics.push(error("TASK_MALFORMED", pathName, "Task file must contain a JSON object."));
    return;
  }
  if (!validId(task.id)) diagnostics.push(error("TASK_INVALID_ID", pathName, "Task id is required and must use a valid AOF id."));
  if (task.boardId !== board.id) diagnostics.push(error("TASK_BOARD_REF_MISMATCH", pathName, `Task boardId must reference board "${board.id}".`));
  if (typeof task.title !== "string" || task.title.trim() === "") diagnostics.push(error("TASK_INVALID_TITLE", pathName, "Task title is required."));
  if (!STATUS_SET.has(task.status)) diagnostics.push(error("TASK_INVALID_STATUS", pathName, `Task status must be one of ${BOARD_STATUSES.join(", ")}.`));
  if (task.refs !== undefined && (typeof task.refs !== "object" || task.refs === null || Array.isArray(task.refs))) {
    diagnostics.push(error("TASK_INVALID_REFS", pathName, "Task refs must be an object when provided."));
  }
  if (task.execution !== undefined) validateExecutionSummary(task.execution, diagnostics, pathName);
  if (!Array.isArray(task.history)) diagnostics.push(error("TASK_INVALID_HISTORY", pathName, "Task history must be an array."));
}

function validateExecutionSummary(execution, diagnostics, pathName) {
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    diagnostics.push(error("TASK_INVALID_EXECUTION", pathName, "Task execution must be an object when provided."));
    return;
  }
  const validStatuses = new Set(["queued", "running", "waiting_for_user", "blocked", "failed", "complete"]);
  if (!validStatuses.has(execution.status)) {
    diagnostics.push(error("TASK_INVALID_EXECUTION_STATUS", pathName, "Task execution status must be queued, running, waiting_for_user, blocked, failed, or complete."));
  }
}

async function tryReadIndex(paths, diagnostics) {
  if (!await exists(paths.indexPath)) return null;
  return tryReadJson(paths.indexPath, diagnostics, ".aof/cache/boards/index.json", "BOARD_INDEX_MALFORMED_JSON");
}

async function tryReadJson(filePath, diagnostics, pathName, code) {
  try {
    return await readJsonFile(filePath);
  } catch (readError) {
    diagnostics.push(error(code, pathName, readError.message));
    return null;
  }
}

async function canonicalFingerprint(paths) {
  const entries = [];
  for (const boardDir of await boardDirs(paths)) {
    const boardPath = path.join(boardDir, BOARD_FILE);
    if (await exists(boardPath)) entries.push(await fingerprintEntry(paths, boardPath));
    for (const taskPath of await taskFiles(path.join(boardDir, "tasks"))) {
      entries.push(await fingerprintEntry(paths, taskPath));
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const hash = crypto.createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function fingerprintEntry(paths, filePath) {
  return {
    path: displayPath(paths, filePath),
    content: await readFile(filePath, "utf8")
  };
}

async function boardDirs(paths) {
  if (!await exists(paths.boardsDir)) return [];
  const entries = await readdir(paths.boardsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(paths.boardsDir, entry.name))
    .sort();
}

async function taskFiles(tasksDir) {
  if (!await exists(tasksDir)) return [];
  const entries = await readdir(tasksDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(tasksDir, entry.name))
    .sort();
}

async function readJsonFile(filePath) {
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (parseError) {
    throw new Error(`Invalid JSON in ${filePath}: ${parseError.message}`);
  }
}

function boardDirPath(paths, id) {
  return path.join(paths.boardsDir, id);
}

function taskFilePath(paths, boardId, taskId) {
  return path.join(boardDirPath(paths, boardId), "tasks", `${taskId}.json`);
}

function assertValidStatus(status) {
  if (!STATUS_SET.has(status)) {
    throw new Error(`Invalid task status "${status}". Use one of ${BOARD_STATUSES.join(", ")}.`);
  }
}

function normalizeRuntime(value) {
  if (value === "claude" || value === "codex") return value;
  throw new Error(`Invalid default execution runtime "${value}". Use claude or codex.`);
}

function relativeProjectPath(projectDir, filePath) {
  return path.relative(path.resolve(projectDir), filePath).split(path.sep).join("/");
}

function validId(value) {
  try {
    normalizeId(value);
    return true;
  } catch {
    return false;
  }
}

function byId(left, right) {
  return left.id.localeCompare(right.id);
}

function displayPath(paths, filePath) {
  return path.relative(paths.projectDir, filePath).split(path.sep).join("/");
}

function nowIso() {
  return new Date().toISOString();
}

function error(code, pathName, message) {
  return { severity: "error", code, path: pathName, message, blocking: true };
}

function warning(code, pathName, message) {
  return { severity: "warning", code, path: pathName, message, blocking: false };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
