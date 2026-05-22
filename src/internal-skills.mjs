import path from "node:path";
import { readFile } from "node:fs/promises";
import { writeText } from "./fs.mjs";

export const AOF_BOARD_MILESTONE_BRIDGE_VERSION = "1.0.0";
export const AOF_BOARD_MILESTONE_BRIDGE_ID = "aof-board-milestone-bridge";
export const AOF_BOARD_MILESTONE_BRIDGE_DIR = `.aof/skills/${AOF_BOARD_MILESTONE_BRIDGE_ID}`;
export const AOF_BOARD_MILESTONE_BRIDGE_GSD_AGENT = "gsd-roadmapper";

const bridgeSkillBody = `---
name: aof-board-milestone-bridge
description: Bind and sync AOF GSD boards after a GSD milestone roadmap is created. Use when a GSD roadmapper or milestone workflow has just written .planning/ROADMAP.md and .planning/STATE.md for an AOF project that may have pending .aof/boards GSD milestone attachments.
---

# AOF Board Milestone Bridge

Version: ${AOF_BOARD_MILESTONE_BRIDGE_VERSION}

This is an internal project skill for GSD \`agent_skills\` injection only. Do not
register it as an AOF renderable resource or install it into \`.codex/skills\` or
\`.claude/skills\`.

After creating or updating a GSD milestone roadmap for AOF:

1. Confirm \`.planning/ROADMAP.md\` and \`.planning/STATE.md\` have been written.
2. Run the bridge helper from the repository root:

\`\`\`bash
node .aof/skills/aof-board-milestone-bridge/scripts/attach-and-sync.mjs
\`\`\`

The helper reads the current milestone from \`.planning/STATE.md\`, finds a pending
GSD-backed board in \`.aof/boards\`, then runs:

\`\`\`bash
node bin/aof.mjs boards milestone attach <board-id> --milestone <milestone-id> --roadmap .planning/ROADMAP.md
node bin/aof.mjs boards sync <board-id> --milestone <milestone-id>
\`\`\`

Selection rules:

- If exactly one pending GSD board exists, bind and sync it.
- If multiple pending GSD boards exist, do not guess. Report the helper output and the manual command it prints.
- If no pending GSD board exists, treat the bridge as a no-op and continue.
- If the helper fails, surface its stderr/stdout exactly enough for the user to act; do not edit board JSON by hand.

For explicit routing, run:

\`\`\`bash
node .aof/skills/aof-board-milestone-bridge/scripts/attach-and-sync.mjs --board <board-id>
\`\`\`
`;

const bridgeScriptBody = `#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BRIDGE_VERSION = "${AOF_BOARD_MILESTONE_BRIDGE_VERSION}";
const args = parseArgs(process.argv.slice(2));
if (args.version) {
  console.log(BRIDGE_VERSION);
  process.exit(0);
}

const projectDir = path.resolve(args.project ?? process.cwd());
const roadmapPath = normalizeProjectPath(args.roadmap ?? ".planning/ROADMAP.md");
const milestoneId = args.milestone ?? readStateMilestone(projectDir);

if (!milestoneId) fail("Could not determine milestone id from .planning/STATE.md. Pass --milestone <id>.");
if (!existsSync(path.join(projectDir, roadmapPath))) fail(\`Roadmap not found at \${roadmapPath}.\`);

const boards = readBoards(projectDir);
const selected = selectBoard(boards, args);

if (!selected) {
  console.log("[aof-board-milestone-bridge] No pending GSD board to attach.");
  process.exit(0);
}

if (selected.error) fail(selected.error);

const attach = [
  "bin/aof.mjs",
  "boards",
  "milestone",
  "attach",
  selected.board.id,
  "--milestone",
  milestoneId,
  "--roadmap",
  roadmapPath
];
const sync = ["bin/aof.mjs", "boards", "sync", selected.board.id, "--milestone", milestoneId];

if (args["dry-run"]) {
  console.log(\`[aof-board-milestone-bridge] would run: node \${attach.join(" ")}\`);
  console.log(\`[aof-board-milestone-bridge] would run: node \${sync.join(" ")}\`);
  process.exit(0);
}

runNode(projectDir, attach);
runNode(projectDir, sync);
console.log(\`[aof-board-milestone-bridge] Attached and synced board \${selected.board.id} to \${milestoneId}.\`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function readStateMilestone(root) {
  const statePath = path.join(root, ".planning", "STATE.md");
  if (!existsSync(statePath)) return null;
  const state = readFileSync(statePath, "utf8");
  const frontmatter = state.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---/);
  const source = frontmatter?.[1] ?? state;
  const match = source.match(/^milestone:\\s*["']?([^"'\\r\\n]+)["']?\\s*$/m);
  return match?.[1]?.trim() ?? null;
}

function readBoards(root) {
  const boardsDir = path.join(root, ".aof", "boards");
  if (!existsSync(boardsDir)) return [];
  return readdirSync(boardsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const boardPath = path.join(boardsDir, entry.name, "BOARD.json");
      if (!existsSync(boardPath)) return null;
      try {
        return JSON.parse(readFileSync(boardPath, "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function selectBoard(boards, options) {
  const gsdBoards = boards.filter((board) => board.executionProvider === "gsd");
  const pending = gsdBoards.filter(isPendingBoard);

  if (options.board) {
    const board = gsdBoards.find((item) => item.id === options.board);
    if (!board) return { error: \`GSD board "\${options.board}" was not found.\` };
    if (!isPendingBoard(board)) return { error: \`GSD board "\${options.board}" is not pending attachment.\` };
    return { board };
  }

  if (options.objective) {
    const needle = normalizeText(options.objective);
    const matches = pending.filter((board) =>
      [board.objective, board.gsd?.milestone?.objective, board.gsd?.milestone?.invocation]
        .filter(Boolean)
        .some((value) => normalizeText(value).includes(needle))
    );
    if (matches.length === 1) return { board: matches[0] };
    if (matches.length > 1) return ambiguous(matches);
    return { error: \`No pending GSD board matched objective "\${options.objective}".\` };
  }

  if (pending.length === 0) return null;
  if (pending.length === 1) return { board: pending[0] };
  return ambiguous(pending);
}

function isPendingBoard(board) {
  const milestone = board.gsd?.milestone;
  if (!milestone) return false;
  if (milestone.id) return false;
  const binding = milestone.binding?.status;
  return binding === "pending-attachment" || milestone.status === "waiting_for_user" || Boolean(milestone.invocation);
}

function ambiguous(boards) {
  const ids = boards.map((board) => board.id).sort();
  return {
    error: [
      \`Multiple pending GSD boards found: \${ids.join(", ")}.\`,
      "Run the bridge with --board <board-id>, or attach manually:",
      ...ids.map((id) => \`node bin/aof.mjs boards milestone attach \${id} --milestone \${milestoneId} --roadmap \${roadmapPath}\`)
    ].join("\\n")
  };
}

function runNode(root, commandArgs) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function normalizeProjectPath(value) {
  return String(value).replace(/\\\\/g, "/").replace(/^\\.?\\//, "");
}

function normalizeText(value) {
  return String(value).trim().toLowerCase().replace(/\\s+/g, " ");
}

function fail(message) {
  console.error(\`[aof-board-milestone-bridge] \${message}\`);
  process.exit(2);
}
`;

export async function ensureAofBoardMilestoneBridge(projectDir, options = {}) {
  const skillDir = path.join(projectDir, AOF_BOARD_MILESTONE_BRIDGE_DIR);
  const skillPath = path.join(skillDir, "SKILL.md");
  const scriptPath = path.join(skillDir, "scripts", "attach-and-sync.mjs");
  const planningConfigPath = path.join(projectDir, ".planning", "config.json");
  const writes = [];

  writes.push(await writeIfChanged(skillPath, `${bridgeSkillBody}\n`, options));
  writes.push(await writeIfChanged(scriptPath, `${bridgeScriptBody}\n`, options));
  writes.push(await ensurePlanningAgentSkill(planningConfigPath, AOF_BOARD_MILESTONE_BRIDGE_DIR, options));

  return {
    id: AOF_BOARD_MILESTONE_BRIDGE_ID,
    version: AOF_BOARD_MILESTONE_BRIDGE_VERSION,
    path: AOF_BOARD_MILESTONE_BRIDGE_DIR,
    agent: AOF_BOARD_MILESTONE_BRIDGE_GSD_AGENT,
    changed: writes.some(Boolean),
    dryRun: Boolean(options.dryRun)
  };
}

async function ensurePlanningAgentSkill(configPath, skillDir, options) {
  const existing = await readJsonIfExists(configPath);
  const config = existing ?? {};
  const agentSkills = isRecord(config.agent_skills) ? { ...config.agent_skills } : {};
  const current = normalizeSkillList(agentSkills[AOF_BOARD_MILESTONE_BRIDGE_GSD_AGENT]);
  if (!current.includes(skillDir)) current.push(skillDir);
  const next = {
    ...config,
    agent_skills: {
      ...agentSkills,
      [AOF_BOARD_MILESTONE_BRIDGE_GSD_AGENT]: current
    }
  };
  if (JSON.stringify(config) === JSON.stringify(next)) return false;
  await writeText(configPath, `${JSON.stringify(next, null, 2)}\n`, { dryRun: Boolean(options.dryRun) });
  return true;
}

async function writeIfChanged(filePath, content, options) {
  const existing = await readFile(filePath, "utf8").catch(() => null);
  if (existing === content) return false;
  await writeText(filePath, content, { dryRun: Boolean(options.dryRun) });
  return true;
}

async function readJsonIfExists(filePath) {
  const content = await readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function normalizeSkillList(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  return [];
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
