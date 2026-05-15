import crypto from "node:crypto";
import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { normalizeId, writeText } from "./fs.mjs";
import { workspacePaths } from "./workspace.mjs";

export const BOARD_STATUSES = Object.freeze(["backlog", "ready", "in_progress", "blocked", "done"]);
const BOARD_FILE = "BOARD.json";
const INDEX_FILE = path.join("cache", "boards", "index.json");
const STATUS_SET = new Set(BOARD_STATUSES);

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
  const paths = boardWorkspacePaths(projectDir);
  const boardDir = boardDirPath(paths, id);
  const boardPath = path.join(boardDir, BOARD_FILE);
  if (!options.force && await exists(boardPath)) {
    throw new Error(`Board already exists: ${id}`);
  }

  const now = nowIso();
  const board = {
    version: 1,
    id,
    title: input.title ?? id,
    objective: input.objective ?? input.deliverable ?? "",
    status: "active",
    columns: [...BOARD_STATUSES],
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

export async function addTask(projectDir, boardId, input = {}, options = {}) {
  const paths = boardWorkspacePaths(projectDir);
  const normalizedBoardId = normalizeId(boardId);
  await readCanonicalBoard(paths, normalizedBoardId);
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
  if (!Array.isArray(board.columns) || BOARD_STATUSES.some((status) => !board.columns.includes(status))) {
    diagnostics.push(error("BOARD_INVALID_COLUMNS", pathName, `Board columns must include ${BOARD_STATUSES.join(", ")}.`));
  }
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
