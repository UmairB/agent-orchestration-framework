import path from "node:path";
import { access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, loadProjectConfig } from "./dsl.mjs";
import { applyConfig, supportedRuntimes } from "./adapters.mjs";
import { executeFrameworkInstallPlan, frameworkPlanFromLock, gsdPackageFromConfig, installFramework, knownFrameworks, planFrameworkInstall } from "./frameworks.mjs";
import { mergeFrameworkInstallAttempts, readLock, writeLock } from "./lock.mjs";
import { createLockManifest, createRenderPlan, executeApplyActions, planApplyActions, summarizeLockManifest } from "./render-plan.mjs";
import { readJson, writeText } from "./fs.mjs";
import { normalizePackage } from "./packages.mjs";
import { writeWorkspaceConfig } from "./workspace-writer.mjs";
import { promptResourceInput, selectRuntimes } from "./prompt.mjs";
import { findProjectConfig, globalWorkspacePaths, isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "./workspace.mjs";
import { collectAdapterWarnings } from "./adapter-warnings.mjs";
import { adapterWarningsForConfig, doctorConfig, inspectConfig, inspectGlobalConfig, validateConfig, validateGlobalConfig } from "./config-inspect.mjs";
import { addProjectGlobalRef, removeProjectGlobalRef } from "./config-editor.mjs";
import { addTask, archiveBoard, attachBoardMilestoneRoadmap, createBoard, getBoard, listBoards, moveTask, removeBoard, repairBoard, syncBoardFromGsdRoadmap, updateBoardMilestone, validateBoards, writeBoardIndex } from "./boards.mjs";
import { applyBreakdownProposal, createBreakdownProposal, readBreakdownProposal, refreshBreakdownProposal } from "./board-breakdown.mjs";
import { assignTaskToAgent, isGsdExecutionConfigured, listBoardAgents, readTaskExecution, updateTaskExecution } from "./board-execution.mjs";
import { continueGsdMilestone } from "./gsd-runtime.mjs";

export async function run(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(helpText());
    return;
  }

  if (command === "init") {
    await initCommand(rest);
    return;
  }

  if (command === "assets") {
    await assetsCommand(rest);
    return;
  }

  if (command === "packages") {
    await packagesCommand(rest);
    return;
  }

  if (command === "project") {
    await projectCommand(rest);
    return;
  }

  if (command === "boards") {
    await boardsCommand(rest);
    return;
  }

  if (["add", "apply", "sync", "clean", "global", "install", "migrate", "validate", "doctor", "config", "catalog"].includes(command)) {
    throw removedCommandError(command);
  }

  throw new Error(`Unknown command "${command}".\n\n${helpText()}`);
}

async function boardsCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "ui") {
    await boardsUiCommand(rest);
    return;
  }

  if (subcommand === "list") {
    await boardsListCommand(rest);
    return;
  }

  if (subcommand === "create") {
    await boardsCreateCommand(rest);
    return;
  }

  if (subcommand === "show") {
    await boardsShowCommand(rest);
    return;
  }

  if (subcommand === "archive") {
    await boardsArchiveCommand(rest);
    return;
  }

  if (subcommand === "remove") {
    await boardsRemoveCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await boardsValidateCommand(rest);
    return;
  }

  if (subcommand === "index") {
    await boardsIndexCommand(rest);
    return;
  }

  if (subcommand === "sync") {
    await boardsSyncCommand(rest);
    return;
  }

  if (subcommand === "repair") {
    await boardsRepairCommand(rest);
    return;
  }
  if (subcommand === "milestone") {
    await boardsMilestoneCommand(rest);
    return;
  }

  if (subcommand === "task") {
    await boardsTaskCommand(rest);
    return;
  }

  if (subcommand === "agents") {
    await boardsAgentsCommand(rest);
    return;
  }

  if (subcommand === "execution") {
    await boardsExecutionCommand(rest);
    return;
  }

  if (subcommand === "breakdown") {
    await boardsBreakdownCommand(rest);
    return;
  }

  throw new Error(`Unknown boards command "${subcommand ?? ""}".\n\nExamples:\n  aof boards create release --title "Release" --objective "Ship v1"\n  aof boards sync release\n  aof boards task move release phase-30 in_progress`);
}

async function boardsListCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const boards = await listBoards(targetDir, { includeArchived: Boolean(options.archived) });
  if (options.json) {
    printJson({ boards });
    return;
  }
  if (boards.length === 0) {
    console.log("boards: 0");
    return;
  }
  console.log(`boards: ${boards.length}`);
  for (const board of boards) {
    console.log(`- ${board.id} status=${board.status} tasks=${board.taskCount} title=${board.title}`);
  }
}

async function boardsCreateCommand(args) {
  const options = parseOptions(args);
  const [id] = options._;
  if (!id || !options.objective) throw new Error("Usage: aof boards create <id> --title <title> --objective <text> [--execution-runtime claude|codex] [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const gsdConfigured = await isGsdExecutionConfigured(targetDir, options);
  const runtime = parseExecutionRuntime(options);
  const result = await createBoard(targetDir, {
    id,
    title: options.title,
    objective: options.objective ?? options.deliverable,
    executionProvider: gsdConfigured ? "gsd" : undefined,
    defaultExecutionRuntime: runtime
  }, { force: Boolean(options.force), dryRun: Boolean(options.dryRun) });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`${result.dryRun ? "Would create" : "Created"} board ${result.board.id}`);
  if (result.board.executionProvider === "gsd") {
    console.log(`execution: gsd runtime=${result.board.defaultExecutionRuntime}`);
    console.log(`${result.dryRun ? "would continue" : "continue"}: ${result.board.gsd.milestone.invocation ?? result.board.gsd.milestone.command}`);
    console.log(`milestone: ${result.board.gsd.milestone.status}`);
    console.log(`objective: ${result.board.gsd.milestone.objective}`);
    console.log(`sync: blocked until GSD milestone completes`);
    if (!result.dryRun && result.board.defaultExecutionRuntime === "claude") {
      const runtimeResult = await continueGsdMilestone(targetDir, result.board);
      const updated = await updateBoardMilestone(targetDir, result.board.id, runtimeResult);
      console.log(`runtime: ${runtimeResult.runtime} status=${runtimeResult.status} exit=${runtimeResult.exitCode}`);
      console.log(`milestone: ${updated.gsd.milestone.status}`);
      if (updated.gsd.milestone.lastOutput) console.log(updated.gsd.milestone.lastOutput);
    }
  }
}

async function boardsShowCommand(args) {
  const options = parseOptions(args);
  const [id] = options._;
  if (!id) throw new Error("Usage: aof boards show <id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const board = await getBoard(targetDir, id);
  if (options.json) {
    printJson({ board });
    return;
  }
  console.log(`board: ${board.id}`);
  console.log(`title: ${board.title}`);
  console.log(`objective: ${board.objective ?? ""}`);
  console.log(`status: ${board.status}`);
  if (board.executionProvider) {
    console.log(`execution: ${board.executionProvider} runtime=${board.defaultExecutionRuntime}`);
    console.log(`milestone: ${board.gsd?.milestone?.status ?? "unknown"}`);
    if (board.gsd?.milestone?.invocation) console.log(`started: ${board.gsd.milestone.invocation}`);
    if (board.gsd?.taskCreation?.syncCommand) console.log(`sync: ${board.gsd.taskCreation.syncCommand}`);
  }
  console.log(`tasks: ${board.tasks.length}`);
  for (const task of board.tasks) {
    console.log(`- ${task.id} status=${task.status} priority=${task.priority} title=${task.title}`);
  }
}

async function boardsArchiveCommand(args) {
  const options = parseOptions(args);
  const [id] = options._;
  if (!id) throw new Error("Usage: aof boards archive <id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const board = await archiveBoard(targetDir, id);
  if (options.json) {
    printJson({ board });
    return;
  }
  console.log(`Archived board ${board.id}`);
}

async function boardsRemoveCommand(args) {
  const options = parseOptions(args);
  const [id] = options._;
  if (!id) throw new Error("Usage: aof boards remove <id> [--dry-run] [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await removeBoard(targetDir, id, { dryRun: Boolean(options.dryRun) });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`${result.dryRun ? "Would remove" : "Removed"} board ${result.id}`);
  console.log(`path: ${relativeDisplayPath(result.boardDir, targetDir)}`);
}

async function boardsValidateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const diagnostics = await validateBoards(targetDir);
  await printBoardValidationResult(diagnostics, options);
}

async function boardsIndexCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await writeBoardIndex(targetDir);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Updated ${relativeDisplayPath(result.indexPath, targetDir)}`);
  console.log(`boards: ${result.index.boards.length}`);
}

async function boardsSyncCommand(args) {
  const options = parseOptions(args);
  const [boardId] = options._;
  const milestoneId = options.milestone ?? options.milestoneId;
  if (!boardId || !milestoneId) throw new Error("Usage: aof boards sync <board-id> --milestone <milestone-id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await syncBoardFromGsdRoadmap(targetDir, boardId, {
    milestoneId,
    dryRun: Boolean(options.dryRun)
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`${result.dryRun ? "Would sync" : "Synced"} board ${result.board.id} with GSD roadmap`);
  console.log(`phases: ${result.phases.length}`);
  console.log(`created: ${result.created.length}`);
  for (const task of result.created) console.log(`- ${task.id} phase=${task.refs.phase} title=${task.title}`);
  console.log(`add phase: ${result.board.gsd.taskCreation.addPhaseCommand}`);
}

async function boardsRepairCommand(args) {
  const options = parseOptions(args);
  const [boardId] = options._;
  if (!boardId) throw new Error("Usage: aof boards repair <board-id> [--execution-runtime claude|codex] [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const runtime = parseExecutionRuntime(options, { optional: true });
  const result = await repairBoard(targetDir, boardId, {
    defaultExecutionRuntime: runtime,
    dryRun: Boolean(options.dryRun)
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(result.message);
  if (result.command) console.log(`continue: ${result.command}`);
  if (result.board.gsd?.milestone?.objective) console.log(`objective: ${result.board.gsd.milestone.objective}`);
}

async function boardsMilestoneCommand(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === "status") {
    await boardsMilestoneStatusCommand(rest);
    return;
  }
  if (subcommand === "answer") {
    await boardsMilestoneAnswerCommand(rest);
    return;
  }
  if (subcommand === "attach") {
    await boardsMilestoneAttachCommand(rest);
    return;
  }
  throw new Error(`Unknown boards milestone command "${subcommand ?? ""}".\n\nExamples:\n  aof boards milestone status board-id\n  aof boards milestone answer board-id --text "1"\n  aof boards milestone attach board-id --milestone v1.7 --roadmap .planning/ROADMAP.md`);
}

async function boardsMilestoneStatusCommand(args) {
  const options = parseOptions(args);
  const [boardId] = options._;
  if (!boardId) throw new Error("Usage: aof boards milestone status <board-id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const board = await getBoard(targetDir, boardId);
  const milestone = board.gsd?.milestone;
  if (options.json) {
    printJson({ board: board.id, milestone });
    return;
  }
  console.log(`board: ${board.id}`);
  console.log(`milestone: ${milestone?.status ?? "none"}`);
  if (milestone?.runtime) console.log(`runtime: ${milestone.runtime}`);
  if (milestone?.invocation) console.log(`invocation: ${milestone.invocation}`);
  if (milestone?.lastOutput) {
    console.log("");
    console.log("last output:");
    console.log(milestone.lastOutput);
  }
  if (milestone?.status === "waiting_for_user") {
    console.log("");
    console.log(`next: aof boards milestone answer ${board.id} --text "<answer>"`);
  }
}

async function boardsMilestoneAnswerCommand(args) {
  const options = parseOptions(args);
  const [boardId] = options._;
  const answer = options.text ?? options.answer;
  if (!boardId || !answer) throw new Error("Usage: aof boards milestone answer <board-id> --text <answer> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const board = await getBoard(targetDir, boardId);
  if (board.executionProvider !== "gsd") throw new Error(`Board ${board.id} is not backed by GSD.`);
  const runtimeResult = await continueGsdMilestone(targetDir, board, { answer });
  const updated = await updateBoardMilestone(targetDir, board.id, runtimeResult, { answer });
  if (options.json) {
    printJson({ board: updated.id, milestone: updated.gsd.milestone, runtime: runtimeResult });
    return;
  }
  console.log(`board: ${updated.id}`);
  console.log(`runtime: ${runtimeResult.runtime} status=${runtimeResult.status} exit=${runtimeResult.exitCode}`);
  console.log(`milestone: ${updated.gsd.milestone.status}`);
  if (updated.gsd.milestone.lastOutput) {
    console.log("");
    console.log(updated.gsd.milestone.lastOutput);
  }
}

async function boardsMilestoneAttachCommand(args) {
  const options = parseOptions(args);
  const [boardId] = options._;
  const milestoneId = options.milestone ?? options.milestoneId;
  const roadmapPath = options.roadmap ?? options.roadmapPath;
  if (!boardId || !milestoneId || !roadmapPath) throw new Error("Usage: aof boards milestone attach <board-id> --milestone <milestone-id> --roadmap <path> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const board = await attachBoardMilestoneRoadmap(targetDir, boardId, {
    milestoneId,
    roadmapPath
  }, { dryRun: Boolean(options.dryRun) });
  if (options.json) {
    printJson({ board: board.id, milestone: board.gsd.milestone });
    return;
  }
  console.log(`Attached board ${board.id} to milestone ${board.gsd.milestone.id}`);
  console.log(`roadmap: ${board.gsd.milestone.roadmapPath}`);
  console.log(`sync: ${board.gsd.taskCreation.syncCommand}`);
}

async function boardsTaskCommand(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === "add") {
    await boardsTaskAddCommand(rest);
    return;
  }
  if (subcommand === "move") {
    await boardsTaskMoveCommand(rest);
    return;
  }
  if (subcommand === "assign") {
    await boardsTaskAssignCommand(rest);
    return;
  }
  throw new Error(`Unknown boards task command "${subcommand ?? ""}".\n\nExamples:\n  aof boards task add release wire-api --title "Wire board API"\n  aof boards task move release wire-api in_progress`);
}

async function boardsAgentsCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const agents = await listBoardAgents(targetDir, options);
  if (options.json) {
    printJson({ agents });
    return;
  }
  console.log(`agents: ${agents.length}`);
  for (const agent of agents) console.log(`- ${agent.id} source=${agent.source} runtimes=${agent.runtimes.join(",")}`);
}

async function boardsExecutionCommand(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === "show") {
    await boardsExecutionShowCommand(rest);
    return;
  }
  if (subcommand === "update") {
    await boardsExecutionUpdateCommand(rest);
    return;
  }
  throw new Error(`Unknown boards execution command "${subcommand ?? ""}".\n\nExamples:\n  aof boards execution show release wire-api\n  aof boards execution update release wire-api --status waiting_for_user --message "Need input"`);
}

async function boardsBreakdownCommand(args) {
  const [subcommandOrBoardId, ...rest] = args;

  if (subcommandOrBoardId === "show") {
    await boardsBreakdownShowCommand(rest);
    return;
  }

  if (subcommandOrBoardId === "apply") {
    await boardsBreakdownApplyCommand(rest);
    return;
  }

  if (subcommandOrBoardId === "refresh") {
    await boardsBreakdownRefreshCommand(rest);
    return;
  }

  await boardsBreakdownCreateCommand(args);
}

async function boardsBreakdownCreateCommand(args) {
  const options = parseOptions(args);
  const [boardId] = options._;
  if (!boardId || !options.objective) throw new Error("Usage: aof boards breakdown <board-id> --objective <text> [--id proposal-id] [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await createBreakdownProposal(targetDir, boardId, {
    id: options.id,
    objective: options.objective,
    force: Boolean(options.force)
  });
  if (options.json) {
    printJson(result);
    return;
  }
  printBreakdownProposal(result.proposal, targetDir, result.proposalPath);
}

async function boardsBreakdownShowCommand(args) {
  const options = parseOptions(args);
  const [boardId, proposalId] = options._;
  if (!boardId || !proposalId) throw new Error("Usage: aof boards breakdown show <board-id> <proposal-id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const proposal = await readBreakdownProposal(targetDir, boardId, proposalId);
  if (options.json) {
    printJson({ proposal });
    return;
  }
  printBreakdownProposal(proposal, targetDir);
}

async function boardsBreakdownApplyCommand(args) {
  const options = parseOptions(args);
  const [boardId, proposalId] = options._;
  if (!boardId || !proposalId) throw new Error("Usage: aof boards breakdown apply <board-id> <proposal-id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await applyBreakdownProposal(targetDir, boardId, proposalId);
  if (options.json) {
    printJson(result);
    return;
  }
  if (result.alreadyApplied) {
    console.log(`Proposal ${result.proposal.id} was already applied`);
    return;
  }
  console.log(`Applied proposal ${result.proposal.id}`);
  for (const task of result.applied) console.log(`- ${task.id} status=${task.status} title=${task.title}`);
}

async function boardsBreakdownRefreshCommand(args) {
  const options = parseOptions(args);
  const [boardId, proposalId] = options._;
  if (!boardId || !proposalId) throw new Error("Usage: aof boards breakdown refresh <board-id> <proposal-id> --id <new-proposal-id> [--objective text] [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await refreshBreakdownProposal(targetDir, boardId, proposalId, {
    id: options.id,
    objective: options.objective,
    force: Boolean(options.force)
  });
  if (options.json) {
    printJson(result);
    return;
  }
  printBreakdownProposal(result.proposal, targetDir, result.proposalPath);
}

async function boardsTaskAddCommand(args) {
  const options = parseOptions(args);
  const [boardId, taskId] = options._;
  if (!boardId || !taskId || !options.title) throw new Error("Usage: aof boards task add <board-id> <task-id> --title <title> [--status status] [--priority priority] [--deliverable text]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await addTask(targetDir, boardId, {
    id: taskId,
    title: options.title,
    description: options.description,
    status: options.status,
    priority: options.priority,
    deliverable: options.deliverable,
    refs: parseJsonOption(options.refs, "refs")
  }, { force: Boolean(options.force), dryRun: Boolean(options.dryRun) });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`${result.dryRun ? "Would create" : "Created"} task ${result.task.boardId}/${result.task.id}`);
}

async function boardsTaskMoveCommand(args) {
  const options = parseOptions(args);
  const [boardId, taskId, status] = options._;
  if (!boardId || !taskId || !status) throw new Error("Usage: aof boards task move <board-id> <task-id> <status> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const task = await moveTask(targetDir, boardId, taskId, status);
  if (options.json) {
    printJson({ task });
    return;
  }
  console.log(`Moved task ${task.boardId}/${task.id} to ${task.status}`);
}

async function boardsTaskAssignCommand(args) {
  const options = parseOptions(args);
  const [boardId, taskId, agentId] = options._;
  if (!boardId || !taskId || !agentId) throw new Error("Usage: aof boards task assign <board-id> <task-id> <agent-id> [--provider gsd] [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await assignTaskToAgent(targetDir, boardId, taskId, agentId, options);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Assigned task ${result.task.boardId}/${result.task.id} to ${result.execution.assignedAgent.id}`);
  console.log(`Started ${result.execution.provider} execution status=${result.execution.status} phase=${result.execution.phase}`);
  for (const command of result.execution.commands) console.log(`- ${command}`);
}

async function boardsExecutionShowCommand(args) {
  const options = parseOptions(args);
  const [boardId, taskId] = options._;
  if (!boardId || !taskId) throw new Error("Usage: aof boards execution show <board-id> <task-id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await readTaskExecution(targetDir, boardId, taskId);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`execution: ${result.execution.boardId}/${result.execution.taskId}`);
  console.log(`provider: ${result.execution.provider}`);
  console.log(`status: ${result.execution.status}`);
  console.log(`agent: ${result.execution.assignedAgent.id}`);
  console.log(`phase: ${result.execution.phase}`);
  for (const log of result.execution.logs ?? []) console.log(`- ${log.at} ${log.message}`);
}

async function boardsExecutionUpdateCommand(args) {
  const options = parseOptions(args);
  const [boardId, taskId] = options._;
  if (!boardId || !taskId || !options.status) throw new Error("Usage: aof boards execution update <board-id> <task-id> --status <status> [--message text] [--handoff text] [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = await updateTaskExecution(targetDir, boardId, taskId, {
    status: options.status,
    message: options.message,
    handoff: options.handoff
  });
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(`Updated execution ${result.execution.boardId}/${result.execution.taskId} to ${result.execution.status}`);
  console.log(`Task status: ${result.task.status}`);
}

async function assetsCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "add") {
    await assetsAddCommand(rest);
    return;
  }

  if (subcommand === "list") {
    await assetsListCommand(rest);
    return;
  }

  if (subcommand === "show") {
    await assetsShowCommand(rest);
    return;
  }

  if (subcommand === "remove") {
    await assetsRemoveCommand(rest);
    return;
  }

  if (subcommand === "use") {
    await assetsUseCommand(rest);
    return;
  }

  if (subcommand === "unuse") {
    await assetsUnuseCommand(rest);
    return;
  }

  if (subcommand === "apply") {
    await assetsApplyCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await assetsValidateCommand(rest);
    return;
  }

  if (subcommand === "clean") {
    await assetsCleanCommand(rest);
    return;
  }

  if (subcommand === "ui") {
    await assetsUiCommand(rest);
    return;
  }

  throw new Error(`Unknown assets command "${subcommand ?? ""}".\n\nExamples:\n  aof assets add skill code-review\n  aof assets add --global skill shared-review\n  aof assets apply --dry-run`);
}

async function packagesCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "add") {
    await packagesAddCommand(rest);
    return;
  }

  if (subcommand === "list") {
    await packagesListCommand(rest);
    return;
  }

  if (subcommand === "show") {
    await packagesShowCommand(rest);
    return;
  }

  if (subcommand === "remove") {
    await packagesRemoveCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await packagesValidateCommand(rest);
    return;
  }

  if (subcommand === "install") {
    await packagesInstallCommand(rest);
    return;
  }

  throw new Error(`Unknown packages command "${subcommand ?? ""}".\n\nExamples:\n  aof packages add gsd --codex\n  aof packages install gsd --dry-run\n  aof packages install --from-lock --dry-run`);
}

async function projectCommand(args) {
  const [subcommand = "show", ...rest] = args;

  if (subcommand === "show") {
    await projectShowCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await validateCommand(rest);
    return;
  }

  if (subcommand === "doctor") {
    await doctorCommand(rest);
    return;
  }

  if (subcommand === "migrate") {
    await migrateCommand(rest);
    return;
  }

  throw new Error(`Unknown project command "${subcommand ?? ""}".\n\nExamples:\n  aof project show\n  aof project validate\n  aof project doctor\n  aof project migrate --dry-run`);
}

async function initCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? options._[0] ?? process.cwd());
  const paths = workspacePaths(targetDir);

  if (!options.force && await exists(paths.configPath)) {
    throw new Error(`Config already exists at ${paths.configPath}. Re-run with --force to replace it.`);
  }

  if (!options.force && await isLegacyConfigOnlyProject(targetDir)) {
    throw new Error(`Legacy config already exists at ${legacyConfigPath(targetDir)}. Run aof project migrate to create .aof/ explicitly.`);
  }

  if (options.items || options.defaults || options.select) {
    throw new Error("Catalog-backed init items are not available yet. Use `aof assets add ...` for project assets or `aof assets add --global ...` for reusable global assets.");
  }

  const runtimes = hasRuntimeOptions(options) ? parseRuntimes(options) : await selectRuntimes();
  const config = {
    name: path.basename(targetDir),
    resources: [],
    globalRefs: [],
    packages: []
  };

  if (options.dryRun) {
    console.log(`write: ${paths.configPath}`);
    console.log(`write: ${paths.lockPath}`);
    console.log("dry-run: no files written");
    return;
  }

  await writeWorkspaceConfig(targetDir, {
    ...config,
    $schema: "https://aof.local/schemas/aof.schema.json",
    runtimes
  });
  await writeInstallLock(targetDir, [], runtimes, null);
  console.log(`Created ${paths.configPath}`);
  await guideAfterInit(targetDir, runtimes, options);
}

async function guideAfterInit(targetDir, runtimes, options) {
  console.log("Next steps:");
  console.log("- Add project assets with `aof assets add skill`.");
  console.log("- Add reusable global assets with `aof assets add --global skill`.");
  console.log("- Add managed packages with `aof packages add gsd`.");
  console.log("- Validate this project with `aof project validate`.");
  console.log("- Render outputs with `aof assets apply --dry-run` then `aof assets apply`.");
  console.log("- Edit assets in the setup UI with `aof assets ui`.");
}

async function assetsAddCommand(args) {
  const options = parseOptions(args);
  let [kind, id] = options._;
  let interactiveInput = null;
  if (!kind && !id) {
    interactiveInput = await promptResourceInput({
      global: Boolean(options.global),
      description: options.description,
      skipBody: true,
      runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : undefined
    });
    kind = interactiveInput.kind;
    id = interactiveInput.id;
  } else if (!kind || !id) {
    const promptInput = await promptResourceInput({
      global: Boolean(options.global),
      kind,
      id,
      description: options.description,
      skipBody: true,
      runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : undefined
    });
    interactiveInput = promptInput;
    kind = promptInput.kind;
    id = promptInput.id;
  }

  const input = {
    kind,
    id,
    name: options.name,
    description: interactiveInput?.description ?? options.description,
    body: options.body ?? interactiveInput?.body,
    runtimes: interactiveInput?.runtimes ?? (hasRuntimeOptions(options) ? parseRuntimes(options) : supportedRuntimes()),
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun)
  };
  const { scaffoldGlobalResource, scaffoldResource } = await import("./scaffold.mjs");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const result = options.global
    ? await scaffoldGlobalResource(input)
    : await scaffoldResource(targetDir, input);

  if (result.dryRun) {
    console.log(`write: ${result.assetPath}`);
    console.log(`write: ${result.configPath}`);
    return;
  }

  console.log(`Created ${result.assetPath}`);
  console.log(`Updated ${result.configPath}`);
  console.log(`Next: edit the source file directly or run \`aof assets ui\`.`);
}

async function assetsListCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const inspection = options.global ? await inspectGlobalConfig() : await inspectConfig(targetDir, options);
  if (options.json) {
    printJson({
      scope: options.global ? "global" : "project",
      configPath: inspection.configPath,
      resources: inspection.resources
    });
    return;
  }

  console.log(`${options.global ? "global" : "project"}: ${inspection.configPath}`);
  if (inspection.resources.length === 0) {
    console.log("resources: 0");
    return;
  }
  console.log(`resources: ${inspection.resources.length}`);
  for (const resource of inspection.resources) {
    console.log(`- ${resource.kind}:${resource.id} runtimes=${resource.runtimes.join(",")}`);
  }
}

async function assetsShowCommand(args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!kind || !id) {
    throw new Error("Usage: aof assets show [--global] <kind> <id> [--json]");
  }

  const paths = options.global ? globalWorkspacePaths() : workspacePaths(path.resolve(options.target ?? process.cwd()));
  if (!await exists(paths.configPath)) {
    const command = options.global ? "aof assets add --global <kind> <id>" : "aof assets add <kind> <id>";
    throw new Error(`Config not found at ${paths.configPath}. Run ${command} first.`);
  }

  const raw = await readJson(paths.configPath);
  const resource = (raw.resources ?? []).find((item) => item.kind === kind && item.id === id);
  if (!resource) {
    throw new Error(`Resource not found: ${kind}:${id}`);
  }

  const sourcePath = resource.path ? path.resolve(path.dirname(paths.configPath), resource.path) : null;
  const bodyExists = sourcePath ? await exists(sourcePath) : Boolean(resource.body || resource.prompt || resource.instructions);
  const payload = {
    configPath: paths.configPath,
    resource: {
      ...resource,
      sourcePath,
      bodyExists
    }
  };

  if (options.json) {
    printJson(payload);
    return;
  }

  console.log(`${options.global ? "global" : "project"}: ${paths.configPath}`);
  console.log(`resource: ${resource.kind}:${resource.id}`);
  if (resource.name) console.log(`name: ${resource.name}`);
  if (resource.description) console.log(`description: ${resource.description}`);
  console.log(`runtimes: ${(resource.runtimes ?? supportedRuntimes()).join(",")}`);
  if (sourcePath) console.log(`path: ${sourcePath}`);
  console.log(`body: ${bodyExists ? "present" : "missing"}`);
}

async function assetsRemoveCommand(args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!kind || !id) {
    throw new Error("Usage: aof assets remove [--global] <kind> <id> [--dry-run] [--force]");
  }

  const paths = options.global ? globalWorkspacePaths() : workspacePaths(path.resolve(options.target ?? process.cwd()));
  if (!await exists(paths.configPath)) {
    throw new Error(`Config not found at ${paths.configPath}.`);
  }

  const raw = await readJson(paths.configPath);
  const resources = Array.isArray(raw.resources) ? raw.resources : [];
  const index = resources.findIndex((resource) => resource.kind === kind && resource.id === id);
  if (index < 0) {
    throw new Error(`Resource not found: ${kind}:${id}`);
  }

  const resource = resources[index];
  const sourcePath = resource.path ? path.resolve(path.dirname(paths.configPath), resource.path) : null;
  const assetDir = sourcePath ? path.dirname(sourcePath) : null;
  const config = {
    ...raw,
    resources: resources.filter((_resource, resourceIndex) => resourceIndex !== index)
  };

  if (options.dryRun) {
    if (assetDir) console.log(`delete: ${assetDir}`);
    console.log(`write: ${paths.configPath}`);
    console.log("dry-run: no source assets or config files were changed");
    return;
  }

  if (assetDir) await rm(assetDir, { recursive: true, force: true });
  await writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
  if (assetDir) console.log(`Deleted ${assetDir}`);
  console.log(`Updated ${paths.configPath}`);
  console.log("Generated runtime outputs were not removed. Run `aof assets clean` to remove lock-owned generated files.");
}

async function assetsUseCommand(args) {
  await assetsGlobalRefCommand("use", args);
}

async function assetsUnuseCommand(args) {
  await assetsGlobalRefCommand("unuse", args);
}

async function assetsGlobalRefCommand(action, args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!options.global || !kind || !id) {
    throw new Error(`Usage: aof assets ${action} --global <kind> <id>`);
  }

  const targetDir = path.resolve(options.target ?? process.cwd());
  const update = action === "use" ? addProjectGlobalRef : removeProjectGlobalRef;
  const result = await update(targetDir, { kind, id }, options);
  if (!result.ok) {
    for (const item of result.diagnostics ?? []) console.log(`${item.severity}: ${item.path} ${item.message}`);
    process.exitCode = 1;
    return;
  }

  const verb = action === "use" ? "Added" : "Removed";
  console.log(`${verb} global reference ${kind}:${id}`);
  console.log(`Updated ${workspacePaths(targetDir).configPath}`);
}

async function assetsValidateCommand(args) {
  const options = parseOptions(args);
  if (options.global) {
    await printValidationResult(await validateGlobalConfig(), options, "global config passed validation");
    return;
  }

  await validateCommand(args);
}

async function printValidationResult(diagnostics, options, successMessage) {
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      diagnostics
    });
  } else if (!failed) {
    console.log(`valid: ${successMessage}`);
    if (warnings.length > 0) console.log(`warnings: ${warnings.length}`);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warnings.length} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.path} ${item.message}`);
  }

  if (failed) process.exitCode = 1;
}

async function assetsApplyCommand(args) {
  const options = parseOptions(args);
  if (options.install) {
    throw new Error("aof assets apply does not run package installers. Use `aof packages install ...` for package execution.");
  }
  if (options.global) {
    throw new Error("aof assets apply does not support global runtime output. Reference global source assets with `aof assets use --global ...`, then run `aof assets apply`.");
  }
  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const paths = workspacePaths(targetDir);
  const runtimes = await runtimesForApply(configPath, options);
  const validationDiagnostics = await validateConfig(targetDir, options);
  const validationErrors = validationDiagnostics.filter((item) => item.severity === "error");
  if (validationErrors.length > 0) {
    await printValidationResult(validationDiagnostics, options, "config passed validation");
    return;
  }
  const config = await loadProjectConfig(configPath);
  const adapterWarnings = collectAdapterWarnings(config, {
    targetDir,
    runtimes,
    global: Boolean(options.global)
  });
  const desiredOutputs = await createRenderPlan(config, {
    targetDir,
    runtimes,
    global: Boolean(options.global)
  });
  const previousLock = await readLock(paths.lockPath);
  const actions = await planApplyActions(desiredOutputs, previousLock, {
    targetDir,
    force: Boolean(options.force)
  });

  const manifest = createLockManifest({
    actions,
    desiredOutputs,
    previousLock,
    config,
    runtimes,
    global: Boolean(options.global)
  });

  if (options.dryRun) {
    const summary = summarizeLockManifest(manifest);
    if (options.json) {
      printJson({ dryRun: true, strict: Boolean(options.strict), adapterWarnings, actions, lockPreview: summary });
      if (options.strict && adapterWarnings.length > 0) process.exitCode = 1;
      return;
    }
    console.log("dry-run: no files or lock state were written");
    printAdapterWarnings(adapterWarnings);
    if (strictAdapterWarningsFailed(options, adapterWarnings)) return;
    if (actions.length > 0) console.log("Planned asset changes");
    for (const item of actions) {
      console.log(options.verbose ? formatApplyAction(item) : formatFriendlyApplyAction(item, { dryRun: true }));
    }
    console.log(`Would update ${relativeDisplayPath(paths.lockPath, targetDir)} (${summary.files} file${summary.files === 1 ? "" : "s"}, ${summary.frameworks} framework intent${summary.frameworks === 1 ? "" : "s"})`);
    return;
  }

  printAdapterWarnings(adapterWarnings);
  if (strictAdapterWarningsFailed(options, adapterWarnings)) return;
  if (actions.length > 0) console.log("Applied assets");
  for (const item of actions) {
    console.log(options.verbose ? formatApplyAction(item) : formatFriendlyApplyAction(item, { targetDir }));
  }

  await executeApplyActions(actions);
  await writeLock(paths.lockPath, manifest);
  console.log(`${successMarker()} Updated ${relativeDisplayPath(paths.lockPath, targetDir)}`);
}

async function assetsCleanCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const { createCleanPlan, executeCleanPlan } = await import("./clean.mjs");
  const plan = await createCleanPlan(targetDir);

  if (!plan.lock) {
    console.log(`clean: no lock file found at ${plan.lockPath}`);
    return;
  }

  if (options.dryRun) {
    console.log("dry-run: no generated files or lock entries will be removed");
  }

  if (plan.actions.length === 0) {
    console.log("clean: no generated file entries in lock");
  }

  for (const item of plan.actions) {
    console.log(formatApplyAction(item));
  }
  console.log(`lock-preview: remove ${plan.removedCount} file entr${plan.removedCount === 1 ? "y" : "ies"}`);

  if (options.dryRun) return;

  await executeCleanPlan(plan);
  console.log(`lock: ${plan.lockPath}`);
}

async function assetsUiCommand(args) {
  const options = parseOptions(args);
  await setupUiCommand({ ...options, uiMode: "assets" });
}

async function boardsUiCommand(args) {
  const options = parseOptions(args);
  await setupUiCommand({ ...options, uiMode: "boards" });
}

async function packagesAddCommand(args) {
  const options = parseOptions(args);
  const [packageId] = options._;
  if (packageId !== "gsd") {
    throw new Error("Usage: aof packages add gsd [--codex] [--claude] [--runtime list] [--source source] [--package npm-package] [--dry-run]");
  }

  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const raw = await readJson(configPath);
  const pkg = normalizePackage(packageIntentFromOptions(options, raw), 0);
  const packages = [
    ...(Array.isArray(raw.packages) ? raw.packages.filter((item) => item?.id !== "gsd") : []),
    packageForConfig(pkg)
  ];
  const nextConfig = { ...raw, packages };

  if (options.dryRun) {
    console.log(`dry-run: no config changes were written and no installer code ran`);
    console.log(`write: ${configPath}`);
    console.log(`package: gsd source=${pkg.source} runtimes=${pkg.runtimes.join(",")}`);
    return;
  }

  await writeText(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  console.log(`Updated ${configPath}`);
  console.log(`package: gsd source=${pkg.source} runtimes=${pkg.runtimes.join(",")}`);
  console.log("Next: run `aof packages install gsd --dry-run` to preview installer commands.");
}

async function packagesListCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const config = await loadProjectConfig(await findProjectConfig(targetDir, options.config));
  const paths = workspacePaths(targetDir);
  const lock = await readLock(paths.lockPath);
  const packages = packageSummaries(config.packages ?? [], lock);

  if (options.json) {
    printJson({ packages });
    return;
  }

  console.log(`packages: ${packages.length}`);
  for (const pkg of packages) {
    const attempts = pkg.installAttempts.length;
    console.log(`- ${pkg.id} namespace=${pkg.namespace} source=${pkg.source} runtimes=${pkg.runtimes.join(",")} attempts=${attempts}`);
  }
}

async function packagesShowCommand(args) {
  const options = parseOptions(args);
  const [packageId] = options._;
  if (!packageId) throw new Error("Usage: aof packages show <id> [--json]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const config = await loadProjectConfig(await findProjectConfig(targetDir, options.config));
  const paths = workspacePaths(targetDir);
  const lock = await readLock(paths.lockPath);
  const pkg = packageSummaries(config.packages ?? [], lock).find((item) => item.id === packageId);
  if (!pkg) throw new Error(`Package "${packageId}" is not configured. Run \`aof packages add gsd\` to declare GSD package intent.`);

  if (options.json) {
    printJson(pkg);
    return;
  }

  console.log(`package: ${pkg.id}`);
  console.log(`namespace: ${pkg.namespace}`);
  console.log(`source: ${pkg.source}`);
  console.log(`runtimes: ${pkg.runtimes.join(",")}`);
  console.log(`installAttempts: ${pkg.installAttempts.length}`);
  for (const attempt of pkg.installAttempts) {
    console.log(`- ${attempt.runtime} status=${attempt.status} scope=${attempt.scope}`);
  }
}

async function packagesRemoveCommand(args) {
  const options = parseOptions(args);
  const [packageId] = options._;
  if (!packageId) throw new Error("Usage: aof packages remove <id> [--dry-run]");
  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const raw = await readJson(configPath);
  const packages = Array.isArray(raw.packages) ? raw.packages : [];
  if (!packages.some((item) => item?.id === packageId)) {
    throw new Error(`Package "${packageId}" is not configured.`);
  }
  const nextConfig = { ...raw, packages: packages.filter((item) => item?.id !== packageId) };

  if (options.dryRun) {
    console.log("dry-run: no config changes were written and no runtime files or lock attempts were removed");
    console.log(`remove-package: ${packageId}`);
    console.log(`write: ${configPath}`);
    return;
  }

  await writeText(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  console.log(`Updated ${configPath}`);
  console.log(`Removed package intent ${packageId}`);
  console.log("Runtime files and lock install attempts were not removed.");
}

async function packagesValidateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const raw = await readJson(configPath);
  const diagnostics = packageDiagnostics(raw);
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      diagnostics
    });
  } else if (!failed) {
    console.log("valid: packages passed validation");
    if (warnings.length > 0) console.log(`warnings: ${warnings.length}`);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warnings.length} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.path} ${item.message}`);
  }

  if (failed) process.exitCode = 1;
}

async function packagesInstallCommand(args) {
  const options = parseOptions(args);
  if (options.fromLock) {
    await installFromLockCommand(options);
    return;
  }

  const [packageId] = options._;
  if (packageId) {
    if (packageId !== "gsd") {
      throw new Error(`Package "${packageId}" does not have installer support yet. Phase 20 supports GSD installer execution only.`);
    }
    const targetDir = path.resolve(options.target ?? process.cwd());
    const config = await loadProjectConfig(await findProjectConfig(targetDir, options.config));
    if (!gsdPackageFromConfig(config) && !options.source && !options.package) {
      throw new Error("GSD package intent is not configured. Run `aof packages add gsd` first.");
    }
    await frameworkInstallCommand(packageId, options);
    return;
  }

  const targetDir = path.resolve(options.target ?? process.cwd());
  const config = await loadProjectConfig(await findProjectConfig(targetDir, options.config));
  const installable = (config.packages ?? []).filter((pkg) => pkg.id === "gsd");
  if (installable.length === 0) {
    throw new Error("No installable packages are configured. Run `aof packages add gsd` first.");
  }
  for (const pkg of installable) {
    await frameworkInstallCommand(pkg.id, options);
  }
}

async function migrateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? options._[0] ?? process.cwd());
  const paths = workspacePaths(targetDir);
  const sourcePath = legacyConfigPath(targetDir);

  if (!await exists(sourcePath)) {
    throw new Error(`No legacy config found at ${sourcePath}.`);
  }

  if (!options.force && await exists(paths.configPath)) {
    throw new Error(`AOF workspace config already exists at ${paths.configPath}. Re-run with --force to replace it.`);
  }

  const legacyConfig = await readJson(sourcePath);
  const resolved = await loadConfig(sourcePath);
  if (options.dryRun) {
    console.log(`write: ${paths.configPath}`);
    console.log(`write: ${paths.lockPath}`);
    return;
  }

  await writeWorkspaceConfig(targetDir, {
    ...resolved,
    $schema: "https://aof.local/schemas/aof.schema.json",
    name: legacyConfig.name ?? resolved.name
  });
  await writeText(paths.lockPath, `${JSON.stringify({
    version: 1,
    migratedAt: new Date().toISOString(),
    source: "aof.config.json",
    runtimes: [...new Set(resolved.resources.flatMap((resource) => resource.runtimes))],
    items: resolved.resources.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      source: "legacy",
      runtimes: resource.runtimes
    }))
  }, null, 2)}\n`);

  console.log(`Created ${paths.configPath}`);
  console.log(`${paths.configPath} is now authoritative; root aof.config.json is legacy and was left untouched.`);
}

async function installCommand(args) {
  const options = parseOptions(args);
  const framework = options._[0];

  if (options.fromLock) {
    await installFromLockCommand(options);
    return;
  }

  if (options.interactive && !framework) {
    await interactiveInstallCommand(options);
    return;
  }

  if (framework && !framework.startsWith("--")) {
    await frameworkInstallCommand(framework, options);
    return;
  }

  await setupUiCommand({ ...options, uiMode: "assets" });
}

async function setupUiCommand(options) {
  const uiMode = options.uiMode === "boards" ? "boards" : "assets";
  const command = uiMode === "boards" ? "aof boards ui" : "aof assets ui";
  const description = uiMode === "boards" ? "board/task management UI" : "project/global asset editor";

  if (options.noServe || options.dryRun) {
    console.log("Setup UI not started.");
    console.log(`Run \`${command}\` to open the local ${description}.`);
    return;
  }

  const defaultUiPort = uiMode === "boards" ? "4187" : "4177";
  const uiPort = Number.parseInt(options.port ?? defaultUiPort, 10);
  const apiPort = Number.parseInt(options.apiPort ?? String(uiPort + 1), 10);
  const { serveSetupUi } = await import("./setup-ui.mjs");
  const { server } = await serveSetupUi(null, { port: apiPort });
  const frontend = startSetupUiFrontend(uiPort, uiMode, `http://127.0.0.1:${apiPort}`);
  const uiUrl = `http://127.0.0.1:${uiPort}/?mode=${uiMode}`;

  console.log(`AOF ${uiMode} UI is running locally.`);
  console.log(`Open this URL in your browser: ${uiUrl}`);
  console.log(`Project: ${process.cwd()}`);
  console.log(`Use the UI for ${description}. Keep this terminal open while you use it.`);
  console.log("Press Ctrl+C to stop the setup UI.");

  await new Promise((resolve, reject) => {
    const shutdown = () => {
      frontend.kill();
      server.close(() => {
        resolve();
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    frontend.once("exit", (code) => {
      server.close(() => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Setup UI frontend exited with code ${code}.`));
        }
      });
    });
  });
}

function startSetupUiFrontend(port, uiMode = "assets", apiUrl = "http://127.0.0.1:4178") {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const uiDir = path.join(repoRoot, "ui");
  const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  return spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: uiDir,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_AOF_UI_MODE: uiMode,
      VITE_AOF_API_URL: apiUrl,
      BROWSER: "none"
    }
  });
}

async function projectShowCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());

  const inspection = await inspectConfig(targetDir, options);
  if (options.json) {
    printJson(inspection);
    return;
  }
  console.log(`config: ${inspection.configPath}`);
  console.log(`name: ${inspection.name ?? "(unresolved)"}`);
  console.log(`resources: ${inspection.resources.length}`);
  for (const resource of inspection.resources) {
    console.log(`- ${resource.kind}:${resource.id} source=${resource.source ?? "local"} runtimes=${resource.runtimes.join(",")}`);
  }
  console.log(`globalRefs: ${inspection.globalRefs.length}`);
  for (const ref of inspection.globalRefs) {
    console.log(`- global:${ref.kind}:${ref.id}`);
  }
  console.log(`packages: ${inspection.packages.length}`);
  for (const pkg of inspection.packages) {
    console.log(`- ${pkg.id} source=${pkg.source} runtimes=${(pkg.runtimes ?? []).join(",")}`);
  }
  if (inspection.legacyConfigIsStale) console.log(`warning: root aof.config.json is legacy; ${inspection.configPath} is authoritative`);
}

async function validateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const diagnostics = await validateConfig(targetDir, options);
  const adapterWarnings = await adapterWarningsForConfig(targetDir, {
    ...options,
    runtimes: parseRuntimes(options)
  });
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const warningCount = warnings.length + adapterWarnings.length;
  const failed = errors.length > 0 || (options.strict && warningCount > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warningCount,
      diagnostics,
      adapterWarnings
    });
  } else if (!failed) {
    console.log("valid: config passed validation");
    if (warningCount > 0) console.log(`warnings: ${warningCount}`);
    printAdapterWarnings(adapterWarnings);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warningCount} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.path} ${item.message}`);
    printAdapterWarnings(adapterWarnings);
  }

  if (failed) process.exitCode = 1;
}

async function doctorCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const report = await doctorConfig(targetDir, {
    ...options,
    runtimes: parseRuntimes(options)
  });
  const errors = report.checks.filter((item) => item.severity === "error");
  const warnings = report.checks.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      healthy: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      ...report
    });
  } else {
    console.log(`doctor: ${failed ? "issues found" : "healthy"}`);
    for (const check of report.checks) {
      console.log(`${check.severity}: ${check.id} - ${check.message}`);
    }
    printAdapterWarnings(report.adapterWarnings);
    for (const suggestion of report.suggestions) {
      console.log(`next: ${suggestion}`);
    }
  }

  if (failed) process.exitCode = 1;
}

async function frameworkInstallCommand(framework, options) {
  const targetDir = path.resolve(options.target ?? process.cwd());
  const paths = workspacePaths(targetDir);
  let config = null;
  try {
    config = await loadConfig(await findProjectConfig(targetDir, options.config));
  } catch (error) {
    if (options.config) throw error;
  }
  const pkg = framework === "gsd" ? gsdPackageFromConfig(config) : null;
  const previousLock = await readLock(paths.lockPath);
  const source = options.package ?? options.source ?? pkg?.source;
  const packageOptions = pkg && source === pkg.source ? pkg : null;
  const runtimes = hasRuntimeOptions(options) ? parseRuntimes(options) : (pkg?.runtimes ?? parseRuntimes(options));
  const plan = planFrameworkInstall(framework, {
    package: packageOptions,
    source,
    namespace: pkg?.namespace,
    runtimes,
    global: Boolean(options.global),
    force: Boolean(options.force),
    previousLock
  });

  if (options.dryRun) {
    if (options.json) {
      printJson({ dryRun: true, network: false, commands: plan });
      return;
    }
    console.log("dry-run: no network or installer commands will run");
    for (const item of plan) console.log(item.skipped ? `skip: ${item.command} reason=${item.skipReason}` : item.command);
    return;
  }

  for (const item of plan) {
    if (item.skipped) {
      console.log(`skip: ${item.runtime} ${item.skipReason}`);
      continue;
    }
    console.log(`network-boundary: running ${item.command}`);
    console.log(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
    console.log("warning: this command may access the network and execute npm package code");
  }

  const attempts = executeFrameworkInstallPlan(plan);
  await writeLock(paths.lockPath, mergeFrameworkInstallAttempts(previousLock, attempts));
  for (const attempt of attempts) {
    console.log(`attempt: ${attempt.runtime} status=${attempt.status} exit=${attempt.exitStatus}`);
  }
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  if (failed.length > 0) {
    for (const attempt of failed) console.log(`retry: ${attempt.command}`);
    throw new Error(`Framework install failed for ${failed.map((attempt) => attempt.runtime).join(", ")}.`);
  }
}

async function installFromLockCommand(options) {
  const targetDir = path.resolve(options.target ?? process.cwd());
  const paths = workspacePaths(targetDir);
  const previousLock = await readLock(paths.lockPath);
  if (!previousLock) throw new Error(`No lock file found at ${paths.lockPath}.`);
  const plan = frameworkPlanFromLock(previousLock, { previousLock });
  if (plan.length === 0) throw new Error("No framework intent found in lock state.");

  if (options.dryRun) {
    if (options.json) {
      printJson({ dryRun: true, fromLock: true, network: false, commands: plan });
      return;
    }
    console.log("dry-run: no network or installer commands will run");
    for (const item of plan) console.log(item.command);
    return;
  }

  for (const item of plan) {
    console.log(`network-boundary: replaying ${item.command}`);
    console.log(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
    console.log("warning: this command may access the network and execute npm package code");
  }
  const attempts = executeFrameworkInstallPlan(plan);
  await writeLock(paths.lockPath, mergeFrameworkInstallAttempts(previousLock, attempts));
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  if (failed.length > 0) throw new Error(`Framework replay failed for ${failed.map((attempt) => attempt.runtime).join(", ")}.`);
}

function packageIntentFromOptions(options, rawConfig) {
  const source = options.source ?? (options.package ? `npm:${options.package}` : "npm:get-shit-done-cc@latest");
  return {
    id: "gsd",
    namespace: "gsd",
    source,
    runtimes: hasRuntimeOptions(options)
      ? parseRuntimes(options)
      : (Array.isArray(rawConfig.runtimes) && rawConfig.runtimes.length > 0 ? [...new Set(rawConfig.runtimes)] : supportedRuntimes())
  };
}

function packageForConfig(pkg) {
  return {
    id: pkg.id,
    namespace: pkg.namespace,
    source: pkg.source,
    runtimes: pkg.runtimes
  };
}

function packageSummaries(packages, lock) {
  const attempts = Array.isArray(lock?.frameworkInstallAttempts) ? lock.frameworkInstallAttempts : [];
  return packages.map((pkg) => ({
    id: pkg.id,
    namespace: pkg.namespace,
    source: pkg.source,
    sourceDescriptor: pkg.sourceDescriptor,
    runtimes: pkg.runtimes ?? [],
    installAttempts: attempts.filter((attempt) => attempt.framework === pkg.id)
  }));
}

function packageDiagnostics(raw) {
  const diagnostics = [];
  if (raw.packages !== undefined && !Array.isArray(raw.packages)) {
    return [{ severity: "error", path: "packages", message: "packages must be an array when provided." }];
  }

  for (const [index, pkg] of (Array.isArray(raw.packages) ? raw.packages : []).entries()) {
    try {
      normalizePackage(pkg, index);
    } catch (error) {
      const pathMatch = error.message.match(/^(packages\[\d+\](?:\.[A-Za-z0-9_]+)?)/);
      diagnostics.push({
        severity: "error",
        path: pathMatch?.[1] ?? `packages[${index}]`,
        message: error.message
      });
    }
  }
  return diagnostics;
}

async function interactiveInstallCommand(options) {
  throw new Error("Interactive project setup is being redesigned. Use `aof init`, `aof assets add ...`, and `aof assets add --global ...` for now.");
}

async function writeInstallLock(targetDir, items, runtimes, dbPath) {
  const lockPath = workspacePaths(targetDir).lockPath;
  const lock = {
    version: 1,
    generatedAt: new Date().toISOString(),
    catalog: dbPath,
    runtimes,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.source,
      runtimes: item.runtimes
    }))
  };

  await writeText(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function parseOptions(args) {
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

    if (["claude", "codex", "global", "local", "dryRun", "force", "select", "interactive", "noGuide", "noServe", "defaults", "json", "fromLock", "strict", "install", "verbose", "archived"].includes(key)) {
      options[key] = true;
      continue;
    }

    options[key] = inlineValue ?? args[++index];
  }

  return options;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printBreakdownProposal(proposal, targetDir, proposalPath) {
  console.log(`proposal: ${proposal.id}`);
  console.log(`board: ${proposal.boardId}`);
  console.log(`status: ${proposal.status}`);
  console.log(`objective: ${proposal.objective}`);
  if (proposal.refreshOf) console.log(`refreshOf: ${proposal.refreshOf}`);
  if (proposalPath) console.log(`path: ${relativeDisplayPath(proposalPath, targetDir)}`);
  console.log(`tasks: ${proposal.tasks.length}`);
  for (const task of proposal.tasks) {
    console.log(`- ${task.id} status=${task.status} title=${task.title}`);
  }
}

function parseJsonOption(value, name) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for --${name}: ${error.message}`);
  }
}

async function printBoardValidationResult(diagnostics, options) {
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      diagnostics
    });
  } else if (!failed) {
    console.log("valid: boards passed validation");
    if (warnings.length > 0) console.log(`warnings: ${warnings.length}`);
    for (const warning of warnings) console.log(`warning: ${warning.code} ${warning.path} ${warning.message}`);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warnings.length} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.code} ${item.path} ${item.message}`);
  }

  if (failed) process.exitCode = 1;
}

function parseRuntimes(options) {
  const selected = [];
  if (options.claude) selected.push("claude");
  if (options.codex) selected.push("codex");

  if (options.runtime) {
    selected.push(...String(options.runtime).split(",").map((runtime) => runtime.trim()).filter(Boolean));
  }

  if (selected.length === 0) return supportedRuntimes();
  return [...new Set(selected)];
}

function hasRuntimeOptions(options) {
  return Boolean(options.claude || options.codex || options.runtime);
}

function parseExecutionRuntime(options, settings = {}) {
  const explicit = options.executionRuntime ?? options.runtime;
  if (explicit !== undefined) {
    const runtimes = String(explicit).split(",").map((runtime) => runtime.trim()).filter(Boolean);
    if (runtimes.length !== 1 || !["claude", "codex"].includes(runtimes[0])) {
      throw new Error("Invalid execution runtime. Use --execution-runtime claude or --execution-runtime codex.");
    }
    return runtimes[0];
  }
  if (options.claude && options.codex) {
    throw new Error("Choose one execution runtime for boards: --execution-runtime claude or --execution-runtime codex.");
  }
  if (options.claude) return "claude";
  if (options.codex) return "codex";
  return settings.optional ? undefined : "codex";
}

async function runtimesForApply(configPath, options) {
  if (hasRuntimeOptions(options)) return parseRuntimes(options);
  const raw = await readJson(configPath);
  if (Array.isArray(raw.runtimes) && raw.runtimes.length > 0) {
    return [...new Set(raw.runtimes)];
  }
  return supportedRuntimes();
}

function removedCommandError(command) {
  if (command === "catalog") {
    return new Error(`Removed command "catalog".\n\nCatalog is not currently supported. Project and global .aof assets are the active source model:\n  aof assets add skill\n  aof assets add --global skill\n  aof assets list --global`);
  }

  const replacements = {
    add: ["aof assets add skill", "aof assets add command", "aof assets add rule", "aof assets add agent"],
    apply: ["aof assets apply", "aof assets apply --dry-run"],
    sync: ["aof assets apply", "aof packages install"],
    clean: ["aof assets clean", "aof assets clean --dry-run"],
    global: ["aof assets add --global skill", "aof assets list --global", "aof assets use --global skill <id>"],
    install: ["aof assets ui", "aof packages add gsd", "aof packages install gsd", "aof packages install --from-lock"],
    migrate: ["aof project migrate"],
    validate: ["aof project validate", "aof assets validate", "aof packages validate"],
    doctor: ["aof project doctor"],
    config: ["aof project show", "aof project validate", "aof project doctor"]
  };
  return new Error(`Removed command "${command}".\n\nAOF now uses namespaced commands:\n${replacements[command].map((item) => `  ${item}`).join("\n")}`);
}

function formatApplyAction(item) {
  const parts = [
    `${item.action}: ${item.path}`,
    item.runtime ? `runtime=${item.runtime}` : null,
    item.resource ? `source=${item.resource.kind}:${item.resource.id}` : null,
    item.reason ? `reason=${item.reason}` : null
  ].filter(Boolean);
  return parts.join(" ");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function helpText() {
  return `aof - Agent Orchestration Framework

Usage:
  aof init [dir] [--claude] [--codex] [--runtime claude,codex] [--force] [--dry-run]

Project:
  aof project show [--json]
  aof project validate [--json] [--strict]
  aof project doctor [--json] [--strict]
  aof project migrate [dir] [--force] [--dry-run]

Assets:
  aof assets add skill|command|rule|agent [id] [--runtime claude,codex] [--description text] [--force]
  aof assets add --global skill|rule|agent [id] [--runtime claude,codex] [--description text] [--force]
  aof assets list [--global] [--json]
  aof assets show [--global] kind id [--json]
  aof assets remove kind id [--dry-run]
  aof assets use --global kind id
  aof assets unuse --global kind id
  aof assets apply [--config aof.config.json] [--target dir] [--claude] [--codex] [--dry-run] [--force] [--strict]
  aof assets validate [--global] [--json] [--strict]
  aof assets clean [--dry-run] [--force]
  aof assets ui [--port 4177] [--api-port 4178]

Packages:
  aof packages add gsd [--claude] [--codex] [--runtime claude,codex] [--source source]
  aof packages list [--json]
  aof packages show gsd [--json]
  aof packages remove gsd [--dry-run]
  aof packages validate [--json] [--strict]
  aof packages install [gsd] [--claude] [--codex] [--global] [--dry-run] [--force] [--json]
  aof packages install --from-lock [--dry-run] [--json]

Boards:
  aof boards ui [--port 4187] [--api-port 4188]
  aof boards list [--archived] [--json]
  aof boards create id --title text --objective text [--execution-runtime claude|codex] [--json]
  aof boards show id [--json]
  aof boards archive id [--json]
  aof boards remove id [--dry-run] [--json]
  aof boards validate [--json] [--strict]
  aof boards index [--json]
  aof boards sync id --milestone milestone-id [--json]
  aof boards milestone attach id --milestone milestone-id --roadmap path [--json]
  aof boards repair id [--runtime claude|codex] [--json]
  aof boards agents [--json]
  aof boards task add board-id task-id --title text [--status status] [--priority priority] [--deliverable text] [--refs json]
  aof boards task move board-id task-id status [--json]
  aof boards task assign board-id task-id agent-id [--provider gsd] [--json]
  aof boards execution show board-id task-id [--json]
  aof boards execution update board-id task-id --status status [--message text] [--handoff text] [--json]
  aof boards breakdown board-id --objective text [--id proposal-id] [--json]
  aof boards breakdown show board-id proposal-id [--json]
  aof boards breakdown apply board-id proposal-id [--json]
  aof boards breakdown refresh board-id proposal-id --id new-proposal-id [--objective text] [--json]

Defaults:
  init creates an empty project .aof workspace for the selected coding assistants.
  project commands inspect, validate, diagnose, and migrate the current repository's AOF workspace.
  assets apply renders source assets into the runtimes selected in .aof/aof.config.json unless runtime flags narrow the run.
  packages add records package intent only and never runs installer code.
  packages install prints a network/package-code boundary before executing installers.
  boards stores canonical task state in .aof/boards and generated indexes in .aof/cache/boards.
  GSD-backed boards start with $gsd-new-milestone and sync tasks from GSD roadmap phases.
  assets ui opens the project/global asset editor.
  boards ui opens the board/task management UI.
  --strict promotes adapter warnings to command failures for CI.
`;
}

function formatFriendlyApplyAction(item, options = {}) {
  const displayPath = relativeDisplayPath(item.path, options.targetDir);
  if (options.dryRun) {
    const verbs = {
      create: "Would create",
      update: "Would update",
      delete: "Would remove",
      skip: "Would keep",
      "drift-warning": "Warning"
    };
    const verb = verbs[item.action] ?? item.action;
    if (item.action === "drift-warning") return `drift-warning: ${displayPath} was modified; not overwriting`;
    return `${verb} ${displayPath}`;
  }

  const verbs = {
    create: "Created",
    update: "Updated",
    delete: "Removed",
    skip: "Kept",
    "drift-warning": "Warning"
  };
  if (item.action === "drift-warning") return `drift-warning: ${displayPath} was modified; not overwriting`;
  return `${successMarker()} ${verbs[item.action] ?? item.action} ${displayPath}`;
}

function successMarker() {
  if (process.stdout.isTTY) return "\u001b[32m\u2713\u001b[0m";
  return "\u2713";
}

function relativeDisplayPath(filePath, targetDir = process.cwd()) {
  const relativePath = path.isAbsolute(filePath) ? path.relative(targetDir, filePath) : filePath;
  return relativePath.replaceAll("\\", "/");
}

function printAdapterWarnings(warnings = []) {
  if (warnings.length === 0) return;
  console.log("adapter-warnings:");
  for (const warning of warnings) {
    const source = warning.kind && warning.id ? `${warning.kind}:${warning.id}` : warning.kind;
    const output = warning.generatedPath ? ` output=${warning.generatedPath}` : "";
    console.log(`- [${warning.code}] ${warning.path} runtime=${warning.runtime} source=${source}${output}`);
    console.log(`  reason: ${warning.reason}`);
    console.log(`  remediation: ${warning.remediation}`);
  }
}

function strictAdapterWarningsFailed(options, warnings = []) {
  if (!options.strict || warnings.length === 0) return false;
  console.log(`strict: ${warnings.length} adapter warning(s) treated as failure`);
  process.exitCode = 1;
  return true;
}
