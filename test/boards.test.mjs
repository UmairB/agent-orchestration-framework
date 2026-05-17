import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addTask,
  archiveBoard,
  attachBoardMilestoneRoadmap,
  buildBoardIndex,
  createBoard,
  editTask,
  getBoard,
  listBoards,
  moveTask,
  removeBoard,
  repairBoard,
  syncBoardFromGsdRoadmap,
  updateBoardMilestone,
  validateBoards,
  writeBoardIndex
} from "../src/boards.mjs";
import { claudeGsdMilestoneCommand, claudeGsdMilestonePrompt, classifyGsdMilestoneStatus, codexGsdMilestoneCommand, codexGsdMilestonePrompt, continueGsdMilestone, expandClaudeCommandPrompt, gsdMilestonePrompt, runtimeOutputHasCommandFailure, runtimeOutputNeedsUser } from "../src/gsd-runtime-fallback.mjs";

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
    name: "starts GSD milestone provisioning when creating backed boards",
    run: startsGsdMilestoneProvisioning
  },
  {
    name: "records GSD milestone runtime sessions",
    run: recordsGsdMilestoneRuntimeSessions
  },
  {
    name: "builds GSD runtime prompts and detects command failures",
    run: buildsGsdRuntimePromptsAndDetectsCommandFailures
  },
  {
    name: "marks fallback milestone runtime output",
    run: marksFallbackMilestoneRuntimeOutput
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
    name: "board index fingerprint ignores CRLF and LF differences",
    run: fingerprintIgnoresLineEndingDifferences
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
    await assert.rejects(
      () => createBoard(targetDir, { id: "unsupported", title: "Unsupported", objective: "Reject provider", executionProvider: "other" }),
      (error) => error.code === "BACKEND_UNSUPPORTED" && error.expected.includes("gsd")
    );

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
      /--milestone <milestone-id>/
    );
    await assert.rejects(
      () => syncBoardFromGsdRoadmap(targetDir, "delivery", { milestoneId: "v1-7" }),
      /not bound to a GSD milestone id/
    );

    const repair = await repairBoard(targetDir, "delivery");
    assert.equal(repair.repaired, false);
    assert.equal(repair.command, "$gsd-new-milestone Create phase tasks from a GSD milestone");
    await assert.rejects(
      () => syncBoardFromGsdRoadmap(targetDir, "delivery", { milestoneId: "v1-7" }),
      /not bound to a GSD milestone id/
    );

    const sdkOptions = { tools: fixtureTools(), skipSurfaceProbe: true };
    const attached = await attachBoardMilestoneRoadmap(targetDir, "delivery", {
      milestoneId: "v1-7",
      roadmapPath: ".planning/ROADMAP.md"
    }, sdkOptions);
    assert.equal(attached.gsd.milestone.id, "v1-7");
    assert.equal(attached.gsd.milestone.binding.status, "attached");
    assert.equal(attached.gsd.taskCreation.syncCommand, "aof boards sync delivery --milestone v1-7");

    await assert.rejects(
      () => syncBoardFromGsdRoadmap(targetDir, "delivery", { milestoneId: "v1-8", ...sdkOptions }),
      /bound to milestone v1-7, not v1-8/
    );

    const dryRun = await syncBoardFromGsdRoadmap(targetDir, "delivery", { milestoneId: "v1-7", dryRun: true, ...sdkOptions });
    assert.deepEqual(dryRun.actions.map((item) => item.action), ["create", "create"]);
    assert.equal((await getBoard(targetDir, "delivery")).tasks.length, 0);

    const result = await syncBoardFromGsdRoadmap(targetDir, "delivery", { milestoneId: "v1-7", ...sdkOptions });
    assert.equal(result.created.length, 2);
    assert.equal(result.board.defaultExecutionRuntime, "claude");
    assert.equal(result.board.gsd.milestone.status, "synced");
    assert.equal(result.board.gsd.milestone.binding.status, "synced");
    assert.equal(result.board.gsd.milestone.binding.sdkVersion, "0.1.0");
    assert.equal(result.board.gsd.milestone.phases.length, 2);

    const rerun = await syncBoardFromGsdRoadmap(targetDir, "delivery", { milestoneId: "v1-7", ...sdkOptions });
    assert.equal(rerun.created.length, 0);
    assert.deepEqual(rerun.actions.map((item) => item.action), ["keep", "keep"]);

    await assert.rejects(
      () => addTask(targetDir, "delivery", { id: "manual", title: "Manual" }),
      /Add tasks with \$gsd-phase add/
    );

    const board = await getBoard(targetDir, "delivery");
    assert.deepEqual(board.tasks.map((task) => task.id), ["phase-40", "phase-41"]);
    assert.equal(board.tasks[0].refs.phase, "40");

    const legacyBoardPath = path.join(targetDir, ".aof", "boards", "legacy", "BOARD.json");
    await mkdir(path.dirname(legacyBoardPath), { recursive: true });
    await writeFile(legacyBoardPath, `${JSON.stringify({
      version: 1,
      id: "legacy",
      title: "Legacy",
      objective: "Repair legacy pending board",
      status: "active",
      columns: ["backlog", "ready", "in_progress", "blocked", "done"],
      executionProvider: "gsd",
      defaultExecutionRuntime: "codex",
      gsd: {
        milestone: {
          status: "pending",
          command: "$gsd-new-milestone",
          objective: "Repair legacy pending board",
          createdAt: new Date(0).toISOString(),
          syncedAt: null
        },
        taskCreation: {
          mode: "gsd-phase",
          addPhaseCommand: "$gsd-phase add",
          syncCommand: "aof boards sync legacy"
        }
      }
    }, null, 2)}\n`, "utf8");
    const legacyRepair = await repairBoard(targetDir, "legacy");
    assert.equal(legacyRepair.repaired, true);
    assert.equal(legacyRepair.board.gsd.milestone.status, "waiting_for_user");
    assert.equal(legacyRepair.board.gsd.milestone.invocation, "$gsd-new-milestone Repair legacy pending board");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function startsGsdMilestoneProvisioning() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    const result = await createBoard(targetDir, {
      id: "uat",
      title: "UAT",
      objective: "Run board UAT",
      executionProvider: "gsd",
      defaultExecutionRuntime: "codex"
    });

    assert.equal(result.board.executionProvider, "gsd");
    assert.equal(result.board.gsd.milestone.status, "waiting_for_user");
    assert.equal(result.board.gsd.milestone.startedAt, result.board.gsd.milestone.createdAt);
    assert.equal(result.board.gsd.milestone.command, "$gsd-new-milestone");
    assert.equal(result.board.gsd.milestone.invocation, "$gsd-new-milestone Run board UAT");
    assert.equal(result.board.gsd.milestone.roadmapPath, null);
    assert.equal(result.board.gsd.milestone.completedAt, null);
    assert.equal(result.board.gsd.taskCreation.syncBlockedReason, "milestone-incomplete");

    await assert.rejects(
      () => syncBoardFromGsdRoadmap(targetDir, "uat"),
      /--milestone <milestone-id>/
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function recordsGsdMilestoneRuntimeSessions() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    await createBoard(targetDir, {
      id: "uat",
      title: "UAT",
      objective: "Run board UAT",
      executionProvider: "gsd",
      defaultExecutionRuntime: "claude"
    });
    const waiting = await updateBoardMilestone(targetDir, "uat", {
      runtime: "claude",
      executable: "claude",
      argv: ["-p", "/gsd-new-milestone Run board UAT --text"],
      status: "waiting_for_user",
      exitCode: 0,
      stdout: "What do you want to build next?",
      stderr: "",
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(1).toISOString()
    });

    assert.equal(waiting.gsd.milestone.status, "waiting_for_user");
    assert.equal(waiting.gsd.milestone.runtime, "claude");
    assert.match(waiting.gsd.milestone.lastOutput, /What do you want/);
    assert.equal(waiting.gsd.milestone.session.turns[0].role, "runtime");

    const answered = await updateBoardMilestone(targetDir, "uat", {
      runtime: "claude",
      executable: "claude",
      argv: ["-p", "--continue", "1"],
      status: "waiting_for_user",
      exitCode: 0,
      stdout: "Confirm milestone?",
      stderr: "",
      startedAt: new Date(2).toISOString(),
      endedAt: new Date(3).toISOString()
    }, { answer: "1" });

    assert.deepEqual(answered.gsd.milestone.session.turns.map((turn) => turn.role), ["runtime", "user", "runtime"]);
    assert.equal(answered.gsd.milestone.session.turns[1].text, "1");
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function buildsGsdRuntimePromptsAndDetectsCommandFailures() {
  assert.equal(gsdMilestonePrompt("Run board UAT"), "$gsd-new-milestone Run board UAT --text");
  assert.equal(codexGsdMilestonePrompt("Run board UAT"), "$gsd-new-milestone Run board UAT --text");
  assert.equal(claudeGsdMilestonePrompt("Run board UAT"), "/gsd:new-milestone Run board UAT --text");
  assert.deepEqual(claudeGsdMilestoneCommand("Run board UAT").argv.slice(-2), ["--", "/gsd:new-milestone Run board UAT --text"]);
  assert.deepEqual(codexGsdMilestoneCommand("Run board UAT").argv.slice(-2), ["--", "$gsd-new-milestone Run board UAT --text"]);
  assert.equal(expandClaudeCommandPrompt("Milestone name: $ARGUMENTS", "Run board UAT"), "Milestone name: Run board UAT --text");
  assert.equal(runtimeOutputHasCommandFailure("Unknown command: /gsd-new-milestone"), true);
  assert.equal(runtimeOutputNeedsUser("The user dismissed the question. I'll wait for their direction."), true);
  assert.equal(runtimeOutputHasCommandFailure("What do you want to build next?"), false);
  assert.equal(classifyGsdMilestoneStatus({ exitCode: 0, output: "The user dismissed the question. I'll wait for their direction.", roadmapPath: ".planning/ROADMAP.md" }), "waiting_for_user");
  assert.equal(classifyGsdMilestoneStatus({ exitCode: 0, output: "", roadmapPath: ".planning/ROADMAP.md" }), "completed");
}

async function marksFallbackMilestoneRuntimeOutput() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  const previousStatus = process.env.AOF_TEST_GSD_RUNTIME_STATUS;
  const previousStderr = process.env.AOF_TEST_GSD_RUNTIME_STDERR;
  try {
    process.env.AOF_TEST_GSD_RUNTIME_STATUS = "waiting_for_user";
    process.env.AOF_TEST_GSD_RUNTIME_STDERR = "runtime stderr";
    const board = await createBoard(targetDir, {
      id: "uat",
      title: "UAT",
      objective: "Run board UAT",
      executionProvider: "gsd",
      defaultExecutionRuntime: "codex"
    });

    const result = await continueGsdMilestone(targetDir, board);

    assert.equal(result.status, "waiting_for_user");
    assert.match(result.stderr, /\[fallback runtime=codex\] SDK path unavailable for test-runtime-fixture/);
    assert.match(result.stderr, /runtime stderr/);
  } finally {
    restoreEnv("AOF_TEST_GSD_RUNTIME_STATUS", previousStatus);
    restoreEnv("AOF_TEST_GSD_RUNTIME_STDERR", previousStderr);
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

async function fingerprintIgnoresLineEndingDifferences() {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "aof-boards-"));
  try {
    await createBoard(targetDir, { id: "delivery", title: "Delivery", objective: "Normalize fingerprints" });
    await addTask(targetDir, "delivery", { id: "wire-api", title: "Wire API" });
    const lf = await buildBoardIndex(targetDir);

    for (const filePath of [
      path.join(targetDir, ".aof", "boards", "delivery", "BOARD.json"),
      path.join(targetDir, ".aof", "boards", "delivery", "tasks", "wire-api.json")
    ]) {
      const content = await readFile(filePath, "utf8");
      await writeFile(filePath, content.replace(/\n/g, "\r\n"), "utf8");
    }

    const crlf = await buildBoardIndex(targetDir);
    assert.equal(crlf.fingerprint, lf.fingerprint);
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

    await writeFile(path.join(boardDir, "BOARD.json"), JSON.stringify({
      version: 1,
      id: "delivery",
      title: "Delivery",
      objective: "Invalid provider",
      status: "active",
      columns: ["backlog", "ready", "in_progress", "blocked", "done"],
      executionProvider: "other"
    }), "utf8");
    const providerDiagnostics = await validateBoards(targetDir);
    assert.equal(providerDiagnostics.some((item) => item.code === "BOARD_INVALID_EXECUTION_PROVIDER"), true);
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

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function fixtureTools() {
  return {
    async exec(command, args) {
      if (command === "roadmap" && args[0] === "analyze") {
        return {
          milestones: [{ version: "v1.7" }],
          phases: [
            { number: "40", name: "Runtime Intake", goal: "Capture the requested execution runtime." },
            { number: "41", name: "Roadmap Sync", goal: "Keep board tasks aligned to roadmap phases." }
          ]
        };
      }
      throw new Error(`Unexpected exec ${command}`);
    },
    async execRaw(command, args) {
      if (command === "state" && args[0] === "load") return "current_milestone=v1.7\n";
      throw new Error(`Unexpected execRaw ${command}`);
    }
  };
}
