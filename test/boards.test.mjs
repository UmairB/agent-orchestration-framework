import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addTask,
  archiveBoard,
  buildBoardIndex,
  createBoard,
  editTask,
  getBoard,
  listBoards,
  moveTask,
  validateBoards,
  writeBoardIndex
} from "../src/boards.mjs";

export const boardTests = [
  {
    name: "creates boards and preserves archived board files",
    run: createsBoardsAndArchives
  },
  {
    name: "adds and moves tasks with history",
    run: addsAndMovesTasks
  },
  {
    name: "builds rebuildable board index and reports stale cache",
    run: buildsIndexAndReportsStaleCache
  },
  {
    name: "validates malformed board and task state",
    run: validatesMalformedState
  }
];

async function createsBoardsAndArchives() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    await createBoard(targetDir, { id: "release", title: "Release", objective: "Ship v1" });
    await createBoard(targetDir, { id: "docs", title: "Docs", objective: "Document v1" });

    const boards = await listBoards(targetDir, { useIndex: false });
    assert.deepEqual(boards.map((board) => board.id), ["docs", "release"]);
    assert.equal(boards.find((board) => board.id === "release").objective, "Ship v1");

    await archiveBoard(targetDir, "docs");
    assert.deepEqual((await listBoards(targetDir, { useIndex: false })).map((board) => board.id), ["release"]);
    assert.deepEqual((await listBoards(targetDir, { useIndex: false, includeArchived: true })).map((board) => board.id), ["docs", "release"]);
    assert.equal(await exists(path.join(targetDir, ".aof", "boards", "docs", "BOARD.json")), true);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function addsAndMovesTasks() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    await addTask(targetDir, "delivery", {
      id: "wire-api",
      title: "Wire API",
      description: "Expose board API",
      priority: "high",
      deliverable: "Board foundation",
      refs: { phase: "28", plan: "28-03-PLAN.md" }
    });
    await moveTask(targetDir, "delivery", "wire-api", "in_progress");
    await editTask(targetDir, "delivery", "wire-api", {
      title: "Wire board API",
      priority: "urgent",
      deliverable: "UI board foundation",
      refs: { phase: "31", plan: "31-02-PLAN.md" }
    });

    const board = await getBoard(targetDir, "delivery");
    assert.equal(board.tasks.length, 1);
    assert.equal(board.tasks[0].status, "in_progress");
    assert.equal(board.tasks[0].title, "Wire board API");
    assert.equal(board.tasks[0].priority, "urgent");
    assert.equal(board.tasks[0].history[0].type, "created");
    assert.equal(board.tasks[0].history[1].type, "status_changed");
    assert.equal(board.tasks[0].history[2].type, "edited");
    assert.deepEqual(board.tasks[0].refs, { phase: "31", plan: "31-02-PLAN.md" });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function buildsIndexAndReportsStaleCache() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    await createBoard(targetDir, { id: "delivery", title: "Delivery" });
    await addTask(targetDir, "delivery", { id: "one", title: "One", status: "ready" });

    const { index, indexPath } = await writeBoardIndex(targetDir);
    assert.equal(index.boards[0].counts.ready, 1);
    assert.equal(await exists(indexPath), true);
    assert.deepEqual(await validateBoards(targetDir), []);

    await addTask(targetDir, "delivery", { id: "two", title: "Two" });
    const diagnostics = await validateBoards(targetDir);
    assert.equal(diagnostics.some((item) => item.code === "BOARD_INDEX_STALE" && item.severity === "warning"), true);

    const rebuilt = await buildBoardIndex(targetDir);
    assert.equal(rebuilt.boards[0].taskCount, 2);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function validatesMalformedState() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    const boardDir = path.join(targetDir, ".aof", "boards", "delivery");
    await mkdir(path.join(boardDir, "tasks"), { recursive: true });
    await writeFile(path.join(boardDir, "BOARD.json"), JSON.stringify({
      version: 1,
      id: "delivery",
      title: "Delivery",
      columns: ["backlog"]
    }), "utf8");
    await writeFile(path.join(boardDir, "tasks", "task.json"), JSON.stringify({
      version: 1,
      id: "task",
      boardId: "other",
      title: "Task",
      status: "waiting",
      refs: [],
      history: {}
    }), "utf8");

    const diagnostics = await validateBoards(targetDir);
    const codes = diagnostics.map((item) => item.code);
    assert.equal(codes.includes("BOARD_INVALID_COLUMNS"), true);
    assert.equal(codes.includes("TASK_BOARD_REF_MISMATCH"), true);
    assert.equal(codes.includes("TASK_INVALID_STATUS"), true);
    assert.equal(codes.includes("TASK_INVALID_REFS"), true);
    assert.equal(codes.includes("TASK_INVALID_HISTORY"), true);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}
