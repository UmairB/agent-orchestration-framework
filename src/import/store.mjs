// The import-store geometry (milestone 13 / story 00 — the SPINE; ADR-004).
//
// Materialized imports live in a DEDICATED store rooted under `.aof/`, OUTSIDE
// the configured `workDir`, so the work-item resolver (`listItems(workDir)` and
// everything downstream — `findWork`/`listStream`/`nextWork`/`validateWork`)
// never enumerates an import as a managed milestone/story/task/uat. An import is
// KNOWLEDGE, never managed work (ADR-004).
//
// The frozen layout this module owns (the contract stories 01/02/03 fan out from):
//
//   <projectRoot>/.aof/imports/                  ← import store ROOT (outside workDir)
//     .gitignore                                  ← nested self-contained ignore
//     <sourceSlug>/<milestoneRef>/                ← per-import folder — NEVER NN_type_slug
//       SPEC.md            recovered intent (legible; NOT an index record source — ADR-001)
//       ARCHITECTURE.md    recovered decisions → adr records (existing parser — ADR-001/003)
//       RETROSPECTIVE.md   recovered outcomes  → lesson records (existing parser)
//
// The milestone folder name is `import-<milestoneRef>` so it can NEVER match the
// work-item pattern `^\d+_(milestone|story|task|uat)_[a-z0-9-]+$` even when the
// recovered ref is purely numeric (e.g. "00" → "import-00"), reinforcing the
// resolver-exclusion boundary at the tree level (ADR-004, self-documenting).
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { workspacePaths } from "../workspace.mjs";

// The import-store root: `<projectRoot>/.aof/imports/`. Resolved off the SAME
// `.aof/` geometry the memory index + locks live in (workspacePaths), so the
// store is unambiguously under the derived-artifact home, never under workDir.
export const IMPORTS_SUBDIR = "imports";

export function importStoreRoot(projectRoot) {
  return path.join(workspacePaths(projectRoot).workspaceDir, IMPORTS_SUBDIR);
}

// Normalise an arbitrary source/milestone token into a filesystem-safe slug:
// lowercased, non-`[a-z0-9-]` runs collapsed to a single hyphen, trimmed. A token
// that slugs to empty (e.g. all punctuation) falls back to "source". This keeps
// the per-import folder legible and stable across re-imports of the same source.
export function slugifySource(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "source";
}

// The materialized milestone folder name. Prefixed with `import-` so it can NEVER
// match the work-item ITEM_RE (`^\d+_(milestone|story|task|uat)_…$`) — a bare
// numeric ref like "00" would otherwise look nothing like a work item, but the
// prefix makes the non-work-item guarantee structural, not incidental (ADR-004).
export function importMilestoneFolderName(milestoneRef) {
  return `import-${slugifySource(milestoneRef)}`;
}

// The per-import folder: `<root>/<sourceSlug>/import-<milestoneRef>/`. The
// caller passes the RAW source token + milestone ref; this module owns the
// slugging + the non-NN_type_slug naming so the layout is a single source of
// truth for the materialize writer (story 00) and the indexer scan (story 02).
export function importMilestoneDir(projectRoot, sourceSlug, milestoneRef) {
  return path.join(
    importStoreRoot(projectRoot),
    slugifySource(sourceSlug),
    importMilestoneFolderName(milestoneRef)
  );
}

// Git-ignore the WHOLE import store via the self-contained nested-`.gitignore`
// idiom (src/aof-gitignore.mjs `ensureGraphifyOutGitignore` pattern): `*` ignores
// everything under the store; `!.gitignore` keeps the ignore file itself visible
// (self-documenting in the tree). NEVER touches the repo-root `.gitignore` (F-02).
// An import is a one-time snapshot — re-derivable, never a tracked deliverable
// (ADR-004) — so a committed copy would be a stale authoritative second copy.
// Idempotent; returns true iff the file was created/changed.
export const IMPORT_STORE_GITIGNORE = ["*", "!.gitignore"];

const IMPORT_STORE_HEADER =
  "# aof — materialized imports (13/ADR-004); never commit (a one-time re-derivable snapshot).\n";

export async function ensureImportStoreGitignore(projectRoot, entries = IMPORT_STORE_GITIGNORE) {
  const root = importStoreRoot(projectRoot);
  const gitignorePath = path.join(root, ".gitignore");

  const had = existsSync(gitignorePath);
  const existing = had ? await readFile(gitignorePath, "utf8") : "";

  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return false;

  await mkdir(root, { recursive: true });
  await writeFile(gitignorePath, `${IMPORT_STORE_HEADER}${[...present].filter(Boolean).concat(missing).join("\n")}\n`, "utf8");
  return true;
}
