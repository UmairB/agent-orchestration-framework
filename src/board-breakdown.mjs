import crypto from "node:crypto";
import path from "node:path";
import { access, readdir, readFile } from "node:fs/promises";
import { addTask, boardWorkspacePaths, getBoard } from "./boards.mjs";
import { normalizeId, writeText } from "./fs.mjs";

export async function createBreakdownProposal(projectDir, boardId, input = {}) {
  const board = await getBoard(projectDir, boardId);
  if (!input.objective || typeof input.objective !== "string") {
    throw new Error("Objective is required.");
  }
  const objective = input.objective.trim();
  const objectiveSlug = slugFromText(objective);
  const proposalId = normalizeId(input.id ?? `${objectiveSlug}-${shortHash(objective)}`);
  const paths = proposalPaths(projectDir, board.id, proposalId);
  if (!input.force && await exists(paths.proposalPath)) {
    throw new Error(`Breakdown proposal already exists: ${proposalId}`);
  }

  const now = nowIso();
  const proposal = {
    version: 1,
    id: proposalId,
    boardId: board.id,
    objective,
    status: "proposed",
    refreshOf: input.refreshOf ?? null,
    refs: proposalRefs(proposalId, objective),
    tasks: generatedTasks({ boardId: board.id, proposalId, objective, objectiveSlug }),
    createdAt: now,
    updatedAt: now
  };
  await writeText(paths.proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  return { proposal, proposalPath: paths.proposalPath };
}

export async function refreshBreakdownProposal(projectDir, boardId, proposalId, input = {}) {
  const previous = await readBreakdownProposal(projectDir, boardId, proposalId);
  return createBreakdownProposal(projectDir, boardId, {
    id: input.id,
    objective: input.objective ?? previous.objective,
    refreshOf: previous.id,
    force: input.force
  });
}

export async function readBreakdownProposal(projectDir, boardId, proposalId) {
  const paths = proposalPaths(projectDir, normalizeId(boardId), normalizeId(proposalId));
  return readJsonFile(paths.proposalPath);
}

export async function listBreakdownProposals(projectDir, boardId) {
  const paths = boardWorkspacePaths(projectDir);
  const proposalsDir = path.join(paths.boardsDir, normalizeId(boardId), "proposals");
  if (!await exists(proposalsDir)) return [];
  const entries = await readdir(proposalsDir, { withFileTypes: true });
  const proposals = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
    proposals.push(await readJsonFile(path.join(proposalsDir, entry.name)));
  }
  return proposals;
}

export async function applyBreakdownProposal(projectDir, boardId, proposalId) {
  const proposal = await readBreakdownProposal(projectDir, boardId, proposalId);
  if (proposal.status === "applied") {
    return { proposal, applied: [], alreadyApplied: true };
  }
  if (!Array.isArray(proposal.tasks) || proposal.tasks.length === 0) {
    throw new Error(`Breakdown proposal ${proposal.id} has no tasks to apply.`);
  }

  const board = await getBoard(projectDir, boardId);
  const existingIds = new Set((board.tasks ?? []).map((task) => task.id));
  const conflicts = proposal.tasks.filter((task) => existingIds.has(task.id)).map((task) => task.id);
  if (conflicts.length > 0) {
    throw new Error(`Breakdown proposal conflicts with existing tasks: ${conflicts.join(", ")}`);
  }

  const applied = [];
  for (const task of proposal.tasks) {
    const result = await addTask(projectDir, board.id, {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status ?? "backlog",
      priority: task.priority ?? "normal",
      deliverable: task.deliverable ?? proposal.objective,
      refs: task.refs ?? proposal.refs
    });
    applied.push(result.task);
  }

  const next = {
    ...proposal,
    status: "applied",
    appliedTaskIds: applied.map((task) => task.id),
    updatedAt: nowIso()
  };
  const paths = proposalPaths(projectDir, board.id, proposal.id);
  await writeText(paths.proposalPath, `${JSON.stringify(next, null, 2)}\n`);
  return { proposal: next, applied, alreadyApplied: false };
}

function generatedTasks({ boardId, proposalId, objective, objectiveSlug }) {
  const refs = proposalRefs(proposalId, objective);
  return [
    {
      id: normalizeId(`${objectiveSlug}-scope`),
      boardId,
      title: `Clarify ${objective}`,
      description: "Define success criteria, constraints, and implementation boundaries for this deliverable.",
      status: "backlog",
      priority: "normal",
      deliverable: objective,
      refs
    },
    {
      id: normalizeId(`${objectiveSlug}-implementation`),
      boardId,
      title: `Implement ${objective}`,
      description: "Make the code and configuration changes required to deliver the accepted objective.",
      status: "backlog",
      priority: "normal",
      deliverable: objective,
      refs
    },
    {
      id: normalizeId(`${objectiveSlug}-verification`),
      boardId,
      title: `Verify ${objective}`,
      description: "Run focused and integration verification, then record evidence against the deliverable.",
      status: "backlog",
      priority: "normal",
      deliverable: objective,
      refs
    }
  ];
}

function proposalRefs(proposalId, objective) {
  return {
    objective: {
      id: slugFromText(objective),
      text: objective
    },
    proposal: proposalId,
    generatedBy: "gsd-objective-breakdown",
    artifacts: [
      ".planning/ROADMAP.md",
      ".planning/REQUIREMENTS.md"
    ]
  };
}

function proposalPaths(projectDir, boardId, proposalId) {
  const paths = boardWorkspacePaths(projectDir);
  return {
    proposalsDir: path.join(paths.boardsDir, boardId, "proposals"),
    proposalPath: path.join(paths.boardsDir, boardId, "proposals", `${proposalId}.json`)
  };
}

function slugFromText(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalizeId(slug || "objective");
}

function shortHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

async function readJsonFile(filePath) {
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (parseError) {
    throw new Error(`Invalid JSON in ${filePath}: ${parseError.message}`);
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
