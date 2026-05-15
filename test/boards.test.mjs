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
  removeBoard,
  repairBoard,
  syncBoardFromGsdRoadmap,
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
    name: "syncs GSD-backed boards from roadmap phases",
    run: syncsGsdBackedBoards
  },
  {
    name: "removes board directories",
    run: removesBoardDirectories
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
    await assert.rejects(() => createBoard(targetDir, { id: "missing", title: "Missing" }), /Board objective is required/);

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
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Deliver board API" });
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

async function syncsGsdBackedBoards() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    await mkdir(path.join(targetDir, ".planning"), { recursive: true });
    await writeFile(path.join(targetDir, ".planning", "ROADMAP.md"), [
      "## Phase Details",
      "",
      "### Phase 40: Runtime Intake",
      "",
      "**Goal:** Capture the requested execution runtime.",
      "",
      "### Phase 41: Roadmap Sync",
      "",
      "**Goal:** Keep board tasks aligned to roadmap phases."
    ].join("\n"), "utf8");
    await createBoard(targetDir, {
      id: "delivery",
      title: "Delivery",
      objective: "Create phase tasks from a GSD milestone",
      executionProvider: "gsd",
      defaultExecutionRuntime: "claude"
    });

    await assert.rejects(
      () => addTask(targetDir, "delivery", { id: "manual", title: "Manual" }),
      /cannot accept tasks until its milestone roadmap is synced/
    );
    await assert.rejects(
      () => syncBoardFromGsdRoadmap(targetDir, "delivery"),
      /not bound to a GSD milestone/
    );

    const repair = await repairBoard(targetDir, "delivery");
    assert.equal(repair.repaired, true);
    assert.equal(repair.command, "$gsd-new-milestone");
    await assert.rejects(
      () => syncBoardFromGsdRoadmap(targetDir, "delivery"),
      /not bound to a GSD milestone/
    );

    const boardPath = path.join(targetDir, ".aof", "boards", "delivery", "BOARD.json");
    const repairedBoard = JSON.parse(await readFile(boardPath, "utf8"));
    repairedBoard.gsd.milestone.roadmapPath = ".planning/ROADMAP.md";
    await writeFile(boardPath, `${JSON.stringify(repairedBoard, null, 2)}\n`, "utf8");

    const result = await syncBoardFromGsdRoadmap(targetDir, "delivery");
    assert.equal(result.created.length, 2);
    assert.equal(result.board.defaultExecutionRuntime, "claude");
    assert.equal(result.board.gsd.milestone.status, "synced");

    await assert.rejects(
      () => addTask(targetDir, "delivery", { id: "manual", title: "Manual" }),
      /Add tasks with \$gsd-phase add/
    );

    const board = await getBoard(targetDir, "delivery");
    assert.deepEqual(board.tasks.map((task) => task.id), ["phase-40", "phase-41"]);
    assert.equal(board.tasks[0].refs.phase, "40");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function removesBoardDirectories() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    await createBoard(targetDir, { id: "cleanup", title: "Cleanup", objective: "Clean up boards" });
    await addTask(targetDir, "cleanup", { id: "one", title: "One" });
    const boardDir = path.join(targetDir, ".aof", "boards", "cleanup");

    const dryRun = await removeBoard(targetDir, "cleanup", { dryRun: true });
    assert.equal(dryRun.dryRun, true);
    assert.equal(await exists(path.join(boardDir, "BOARD.json")), true);

    const removed = await removeBoard(targetDir, "cleanup");
    assert.equal(removed.id, "cleanup");
    assert.equal(await exists(path.join(boardDir, "BOARD.json")), false);
    await assert.rejects(() => removeBoard(targetDir, "cleanup"), /Board not found: cleanup/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function buildsIndexAndReportsStaleCache() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Index board tasks" });
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
