import { spawnSync } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

export function gsdMilestonePrompt(objective) {
  return `$gsd-new-milestone ${objective} --text`;
}

export function claudeGsdMilestonePrompt(objective) {
  return `/gsd:new-milestone ${objective} --text`;
}

export function claudeFlatGsdMilestonePrompt(objective) {
  return `/gsd-new-milestone ${objective} --text`;
}

export function expandClaudeCommandPrompt(commandText, objective) {
  const args = `${objective} --text`;
  return commandText.replaceAll("$ARGUMENTS", args);
}

export function codexGsdMilestonePrompt(objective) {
  return gsdMilestonePrompt(objective);
}

export function runtimeOutputHasCommandFailure(output) {
  return /\bUnknown command:/i.test(output)
    || /\bcommand not found\b/i.test(output)
    || /\bNo such command\b/i.test(output);
}

export function runtimeOutputNeedsUser(output) {
  return /\bdismissed the question\b/i.test(output)
    || /\bwait(?:ing)? for (?:their|your|user) direction\b/i.test(output)
    || /\bwait(?:ing)? for (?:their|your|user) input\b/i.test(output);
}

export function classifyGsdMilestoneStatus({ exitCode, output, roadmapPath }) {
  if (exitCode !== 0 || runtimeOutputHasCommandFailure(output)) return "failed";
  if (runtimeOutputNeedsUser(output)) return "waiting_for_user";
  return roadmapPath ? "completed" : "waiting_for_user";
}

export function claudeGsdMilestoneCommand(objective, options = {}) {
  if (options.answer) {
    return {
      runtime: "claude",
      executable: options.executable ?? "claude",
      argv: [
        "-p",
        "--continue",
        "--",
        options.answer
      ]
    };
  }
  return {
    runtime: "claude",
    executable: options.executable ?? "claude",
    argv: [
      "-p",
      "--permission-mode",
      options.permissionMode ?? "auto",
      "--",
      options.prompt ?? claudeGsdMilestonePrompt(objective)
    ]
  };
}

export function codexGsdMilestoneCommand(objective, options = {}) {
  if (options.answer) {
    return {
      runtime: "codex",
      executable: options.executable ?? "codex",
      argv: [
        "exec",
        "resume",
        "--last",
        "--",
        options.answer
      ]
    };
  }
  return {
    runtime: "codex",
    executable: options.executable ?? "codex",
    argv: [
      "exec",
      "--sandbox",
      options.sandbox ?? "workspace-write",
      "--ask-for-approval",
      options.approval ?? "on-request",
      "--",
      options.prompt ?? codexGsdMilestonePrompt(objective)
    ]
  };
}

export async function continueGsdMilestone(projectDir, board, options = {}) {
  const milestone = board.gsd?.milestone ?? {};
  const objective = milestone.objective ?? board.objective;
  const runtime = board.defaultExecutionRuntime ?? "codex";
  const startedAt = nowIso();
  const testStatus = process.env.AOF_TEST_GSD_RUNTIME_STATUS;
  const entrypoint = testStatus ? null : await resolveGsdMilestoneEntrypoint(projectDir, runtime, objective);
  if (!testStatus && !entrypoint.available) {
    return {
      runtime,
      executable: runtime,
      argv: [],
      status: "failed",
      exitCode: 1,
      stdout: "",
      stderr: entrypoint.message,
      error: entrypoint.message,
      startedAt,
      endedAt: nowIso(),
      roadmapPath: null
    };
  }
  const command = runtime === "claude"
    ? claudeGsdMilestoneCommand(objective, { ...(options.claude ?? {}), answer: options.answer, prompt: entrypoint?.prompt })
    : codexGsdMilestoneCommand(objective, { ...(options.codex ?? {}), answer: options.answer, prompt: entrypoint?.prompt });

  if (testStatus) {
    return {
      ...command,
      status: testStatus,
      exitCode: testStatus === "failed" ? 1 : 0,
      stdout: process.env.AOF_TEST_GSD_RUNTIME_STDOUT ?? "",
      stderr: process.env.AOF_TEST_GSD_RUNTIME_STDERR ?? "",
      startedAt,
      endedAt: nowIso(),
      roadmapPath: testStatus === "completed" ? await completedRoadmapPath(projectDir, startedAt) : null
    };
  }

  const result = spawnSync(command.executable, command.argv, {
    cwd: projectDir,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  const endedAt = nowIso();
  const roadmapPath = await completedRoadmapPath(projectDir, startedAt);
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? result.error?.message ?? "";
  const output = [stdout, stderr].filter(Boolean).join("\n");
  const status = classifyGsdMilestoneStatus({ exitCode, output, roadmapPath });
  return {
    ...command,
    status,
    exitCode,
    stdout,
    stderr,
    error: result.error?.message ?? (status === "failed" ? "Runtime command failed." : undefined),
    startedAt,
    endedAt,
    roadmapPath
  };
}

export async function resolveGsdMilestoneEntrypoint(projectDir, runtime, objective) {
  if (runtime === "codex") {
    const skillPath = path.join(projectDir, ".codex", "skills", "gsd-new-milestone", "SKILL.md");
    if (await exists(skillPath)) {
      return {
        available: true,
        runtime,
        path: ".codex/skills/gsd-new-milestone/SKILL.md",
        prompt: codexGsdMilestonePrompt(objective)
      };
    }
    return missingEntrypoint(runtime, "Missing .codex/skills/gsd-new-milestone/SKILL.md. Run AOF apply/install for Codex GSD assets or use --execution-runtime claude after generating Claude GSD commands.");
  }

  const nestedCommandPath = path.join(projectDir, ".claude", "commands", "gsd", "new-milestone.md");
  if (await exists(nestedCommandPath)) {
    return {
      available: true,
      runtime,
      path: ".claude/commands/gsd/new-milestone.md",
      prompt: expandClaudeCommandPrompt(await readFile(nestedCommandPath, "utf8"), objective)
    };
  }
  const flatCommandPath = path.join(projectDir, ".claude", "commands", "gsd-new-milestone.md");
  if (await exists(flatCommandPath)) {
    return {
      available: true,
      runtime,
      path: ".claude/commands/gsd-new-milestone.md",
      prompt: expandClaudeCommandPrompt(await readFile(flatCommandPath, "utf8"), objective)
    };
  }
  return missingEntrypoint(runtime, "Missing .claude/commands/gsd/new-milestone.md. Run AOF apply/install for Claude GSD assets or use --execution-runtime codex.");
}

function missingEntrypoint(runtime, message) {
  return {
    available: false,
    runtime,
    path: null,
    prompt: null,
    message
  };
}

async function completedRoadmapPath(projectDir, startedAt) {
  const roadmapPath = path.join(projectDir, ".planning", "ROADMAP.md");
  if (!await exists(roadmapPath)) return null;
  if (startedAt) {
    const stats = await stat(roadmapPath);
    if (stats.mtimeMs < new Date(startedAt).getTime()) return null;
  }
  return ".planning/ROADMAP.md";
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
