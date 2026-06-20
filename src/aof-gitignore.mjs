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
export const AOF_GITIGNORE_ENTRIES = ["aof.memory.index.json"];

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
