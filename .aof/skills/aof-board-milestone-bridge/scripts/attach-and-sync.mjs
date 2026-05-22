#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BRIDGE_VERSION = "1.0.0";
const args = parseArgs(process.argv.slice(2));
if (args.version) {
  console.log(BRIDGE_VERSION);
  process.exit(0);
}

const projectDir = path.resolve(args.project ?? process.cwd());
const roadmapPath = normalizeProjectPath(args.roadmap ?? ".planning/ROADMAP.md");
const milestoneId = args.milestone ?? readStateMilestone(projectDir);

if (!milestoneId) fail("Could not determine milestone id from .planning/STATE.md. Pass --milestone <id>.");
if (!existsSync(path.join(projectDir, roadmapPath))) fail(`Roadmap not found at ${roadmapPath}.`);

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
  console.log(`[aof-board-milestone-bridge] would run: node ${attach.join(" ")}`);
  console.log(`[aof-board-milestone-bridge] would run: node ${sync.join(" ")}`);
  process.exit(0);
}

runNode(projectDir, attach);
runNode(projectDir, sync);
console.log(`[aof-board-milestone-bridge] Attached and synced board ${selected.board.id} to ${milestoneId}.`);

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
  const frontmatter = state.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const source = frontmatter?.[1] ?? state;
  const match = source.match(/^milestone:\s*["']?([^"'\r\n]+)["']?\s*$/m);
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
    if (!board) return { error: `GSD board "${options.board}" was not found.` };
    if (!isPendingBoard(board)) return { error: `GSD board "${options.board}" is not pending attachment.` };
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
    return { error: `No pending GSD board matched objective "${options.objective}".` };
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
      `Multiple pending GSD boards found: ${ids.join(", ")}.`,
      "Run the bridge with --board <board-id>, or attach manually:",
      ...ids.map((id) => `node bin/aof.mjs boards milestone attach ${id} --milestone ${milestoneId} --roadmap ${roadmapPath}`)
    ].join("\n")
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
  return String(value).replace(/\\/g, "/").replace(/^\.?\//, "");
}

function normalizeText(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function fail(message) {
  console.error(`[aof-board-milestone-bridge] ${message}`);
  process.exit(2);
}

