// The aof workspace `.gitignore` baseline (milestone 04 round-trip finding F-02).
//
// `aof work init` and the local memory backend both need the project's `.aof/`
// to git-ignore the DERIVED, regenerable artifacts (the memory index) while the
// tracked install (the lock, config, rendered members) stays committed. The
// round-trip proof surfaced that init established no such baseline and that the
// memory backend relied on amending the REPO-ROOT `.gitignore`.
//
// PO decision (F-02): do NOT touch / rely on the repo-root `.gitignore`. Write a
// SELF-CONTAINED nested `.gitignore` inside `.aof/`. A nested ignore file is
// applied by git relative to its own directory, so the entry `aof.memory.index.json`
// ignores `.aof/aof.memory.index.json`. This module is the single owner of that
// baseline; both init and the memory backend call it.
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, appendFile, writeFile, mkdir } from "node:fs/promises";
import { workspacePaths } from "./workspace.mjs";

// Paths (relative to `.aof/`) the workspace must never commit — derived/regenerable
// artifacts a committed copy of which would be a duplicate authoritative source.
// Both memory backends keep their derived record store here: the local backend's
// `aof.memory.index.json` (05/ADR-005) and the graphify backend's
// `aof.memory.graphify.index.json` (10/ADR-005) — each rebuilt from the `.md` stream,
// never an authoritative second copy, so each is git-ignored by this baseline. The
// Notion work-board sync's identity sidecar `notion.work-map.json` (17/ADR-001) joins
// them: a derived, aof-owned mapping of aof ref → Notion page id, rebuildable by a
// re-sync, never a committed authoritative source — so it is git-ignored here too.
// m43 / ADR-013/C4 — the artifact-sync QUEUE and its consumed `.batch` sibling join
// them, and for the same reason: per-node runtime state, derived, regenerable, never an
// authoritative copy. It is written into EVERY worktree an agent runs in, so leaving it
// untracked-but-not-ignored would (a) show in every `git status` an agent or an operator
// reads mid-run and (b) make every worktree permanently DIRTY — which is precisely the
// input ADR-008 (43/05) refuses gate propagation on. Story 05 would otherwise inherit a
// defect this story created, three stories from its cause.
export const AOF_GITIGNORE_ENTRIES = [
  "aof.memory.index.json",
  "aof.memory.graphify.index.json",
  "notion.work-map.json",
  "artifact-sync-queue.ndjson",
  "artifact-sync-queue.ndjson.batch",
];

const HEADER = "# aof — derived/regenerable artifacts; never commit (the tracked install is committed).\n";

// Idempotently ensure `<targetDir>/.aof/.gitignore` ignores every entry. Additive
// (preserves any existing lines, e.g. an assistant-workspace `/work/`), never
// duplicates an entry, and never touches the repo-root `.gitignore`. Returns true
// iff the file was created or changed.
export async function ensureAofGitignore(targetDir, entries = AOF_GITIGNORE_ENTRIES) {
  const { workspaceDir } = workspacePaths(targetDir);
  const gitignorePath = path.join(workspaceDir, ".gitignore");

  const had = existsSync(gitignorePath);
  const existing = had ? await readFile(gitignorePath, "utf8") : "";

  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return false;

  if (!had) {
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(gitignorePath, `${HEADER}${missing.join("\n")}\n`, "utf8");
    return true;
  }
  const needsNewline = existing.length > 0 && !existing.endsWith("\n");
  await appendFile(gitignorePath, `${needsNewline ? "\n" : ""}${missing.join("\n")}\n`, "utf8");
  return true;
}

// --------------------------------------------------- graphify-out (10/ADR-005) --

// The graphify backend's derived graph artifact lands at `<projectRoot>/graphify-out/`
// (where `graph:build` writes it, src/graphify.mjs `--out <projectRoot>`) — OUTSIDE
// `.aof/`, so the nested `.aof/.gitignore` baseline above cannot cover it. A committed
// graph would be an authoritative second copy (05/ADR-001 / 10/ADR-005 violation): the
// graph is a pure ranking layer, derived and disposable, holding no fact the records do
// not. We apply the SAME self-contained nested-ignore idiom as F-02 (never touch the
// repo-root `.gitignore`): write `<projectRoot>/graphify-out/.gitignore` whose `*`
// ignores everything in the directory (git applies a nested ignore relative to its own
// directory) while `!.gitignore` keeps the ignore file itself out of the ignore set —
// so the discipline is self-documenting in the tree. Idempotent; returns true iff
// created/changed.
export const GRAPHIFY_OUT_DIR = "graphify-out";
export const GRAPHIFY_OUT_GITIGNORE = ["*", "!.gitignore"];

const GRAPHIFY_OUT_HEADER =
  "# aof — graphify's derived graph (10/ADR-005); never commit (rebuilt from the .md stream).\n";

export async function ensureGraphifyOutGitignore(projectRoot, entries = GRAPHIFY_OUT_GITIGNORE) {
  const outDir = path.join(projectRoot, GRAPHIFY_OUT_DIR);
  const gitignorePath = path.join(outDir, ".gitignore");

  const had = existsSync(gitignorePath);
  const existing = had ? await readFile(gitignorePath, "utf8") : "";

  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return false;

  if (!had) {
    await mkdir(outDir, { recursive: true });
    await writeFile(gitignorePath, `${GRAPHIFY_OUT_HEADER}${missing.join("\n")}\n`, "utf8");
    return true;
  }
  const needsNewline = existing.length > 0 && !existing.endsWith("\n");
  await appendFile(gitignorePath, `${needsNewline ? "\n" : ""}${missing.join("\n")}\n`, "utf8");
  return true;
}
