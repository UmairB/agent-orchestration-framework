// import:milestone — import an external milestone as re-derivable local knowledge
// (milestone 13 / story 00 — the SPINE; ADR-001/002/004/005).
//
//   input  { repo, selector?, dryRun? }
//   result { imported, milestoneRef, sourceSlug, dir, artifacts, recordCount, dryRun }
//
// `run` resolves the source READ-ONLY (the injection seam, ADR-002), recovers the
// milestone (the story-01 seam), then materializes the frozen artifact pair into
// the `.aof/` import store (ADR-001/004) — UNLESS `--dry-run`, which recovers +
// PREVIEWS (computes the artifacts + record count it WOULD write) and writes /
// indexes / networks NOTHING (ADR-002, the planning-init dry-run discipline).
//
// Paths are RAW ABSOLUTE (basis-neutral, 08/ADR-002); the `cli.json` face
// relativises for display, exactly like graph-build. The command reaches the
// source ONLY read-only and constructs NO git write verb against `<repo>`
// (ADR-002 — pinned by the story-03 arch-test acd-import-read-only-source).
import path from "node:path";
import { commandError } from "../command-error.mjs";
import { resolveImportSource } from "../import/source.mjs";
import { recoverMilestone, listRecoverableMilestones, resolveCandidate } from "../import/recovery.mjs";
import { writeColocatedDigest } from "../import/materialize.mjs";
import { slugifySource } from "../import/store.mjs";
import { resolveConfiguredBackend } from "../work-memory.mjs";

// Derive a stable source slug from the `<repo>` token (a local path's basename or
// a remote URL's last path segment), so a re-import of the same source lands in
// the same per-import folder (ADR-005 one-time snapshot). When `<repo>` points
// DIRECTLY at a `…/wiki/work/<milestone-folder>` (point-at-the-folder addressing),
// the SOURCE is the repo that OWNS the folder, not the folder itself — so the slug
// is the repo-root basename, keeping every milestone imported from one repo under
// one `<sourceSlug>/` bucket regardless of how it was addressed.
function sourceSlugFor(repo) {
  if (typeof repo !== "string" || repo.length === 0) return "source";
  const parts = repo.replace(/[/\\]+$/, "").split(/[/\\]/);
  const n = parts.length;
  if (n >= 4 && parts[n - 2] === "work" && parts[n - 3] === "wiki") {
    return slugifySource((parts[n - 4] ?? parts[n - 1]).replace(/\.git$/i, ""));
  }
  const tail = parts[n - 1] ?? repo;
  return slugifySource(tail.replace(/\.git$/i, ""));
}

export const importMilestoneCommand = {
  id: "import:milestone",
  input: {
    type: "object",
    properties: {
      repo: { type: "string" },
      selector: { type: "string" },
      dryRun: { type: "boolean" },
      // Optional injected provenance date for the digest frontmatter (ADR-007);
      // defaults to today. Injectable so tests are deterministic.
      importedAt: { type: "string" },
    },
    required: ["repo"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const projectRoot = ctx.workspace.projectRoot;
    const repo = input.repo;
    const dryRun = input.dryRun === true;

    if (typeof repo !== "string" || repo.length === 0) {
      throw commandError(
        "Usage: aof import milestone <repo> <selector>",
        "missing-repo",
        400
      );
    }

    // Resolve the source READ-ONLY (ADR-002). A LOCAL <repo> reads in place (no
    // network — the @executable lane); a remote uses the read-only fetch leg (the
    // @manual lane), which a --dry-run never reaches.
    const { sourceDir } = resolveImportSource({ repo, dryRun });

    // A remote --dry-run has no local source tree to enumerate yet (story 01 seam);
    // the spine only fully drives the offline local lane. Guard so the offline
    // lane is deterministic and the remote leg surfaces a clear, structured error.
    if (sourceDir == null) {
      throw commandError(
        `Importing from a remote source is not yet supported offline (the read-only fetch is deferred to the recovery story). Pass a local <repo> path.`,
        "remote-source-unsupported",
        501
      );
    }

    // Resolve which milestone to import, the SAME way recovery picks it (one
    // resolver, no drift). A MISSING <selector> is NOT a usage error (Three-Amigos
    // decision): exactly one recoverable milestone ⇒ import it; ambiguous (>1) ⇒ a
    // structured error asking which (ADR-002 surface). An EXPLICIT selector that
    // matches NOTHING is an honest no-match error — never a silent fall-through to
    // "the only milestone" (the GSD `NN-slug`-by-number mis-import that used to slip
    // through). `<repo>` may be a repo root to scan OR a milestone folder directly.
    const candidates = await listRecoverableMilestones(sourceDir);
    let picked;
    if (input.selector == null || input.selector === "") {
      if (candidates.length === 0) {
        throw commandError(
          `No recoverable milestone found in the source "${repo}".`,
          "no-recoverable-milestone",
          404
        );
      }
      if (candidates.length > 1) {
        const refs = candidates.map((c) => c.ref).join(", ");
        throw commandError(
          `The source "${repo}" has more than one recoverable milestone (${refs}). Specify which to import: aof import milestone <repo> <selector>.`,
          "ambiguous-milestone",
          400
        );
      }
      picked = candidates[0];
    } else {
      picked = resolveCandidate(candidates, input.selector);
      if (!picked) {
        const refs = candidates.map((c) => c.ref).join(", ") || "(none)";
        throw commandError(
          `No milestone matching "${input.selector}" in the source "${repo}". Available: ${refs}.`,
          "no-milestone-match",
          404
        );
      }
    }
    const selector = picked.ref;

    // Recover the milestone (the story-01 seam — a STUB for now; story 00 freezes
    // the signature + the `recovered` shape it returns).
    const recovered = await recoverMilestone(sourceDir, selector);

    const sourceSlug = sourceSlugFor(repo);
    const milestoneRef = String(recovered.meta?.ref ?? selector);
    // The digest's `importedAt` provenance stamp (ADR-007). Injectable via input for
    // deterministic tests; defaults to today's date (YYYY-MM-DD). It lands ONLY in the
    // digest's frontmatter, which is never an index record source (parseAof ignores
    // frontmatter), so it changes no record and breaks no `source:line` (ADR-005).
    const importedAt = input.importedAt ?? new Date().toISOString().slice(0, 10);

    // HARD RULE (operator): the recovered digest is written as a single `AOF.md`
    // INTO the source milestone folder it was imported from (`picked.dir`) — co-located
    // beside that milestone's own docs, NEVER a separate `.aof/imports/` store. A
    // --dry-run PREVIEWS the path + record count and writes nothing.
    const materialized = await writeColocatedDigest(
      { targetDir: picked.dir, sourceSlug, milestoneRef, recovered, importedAt },
      { preview: dryRun }
    );

    // After a real write, trigger the backend's `reindex` so the digest REACHES memory
    // (ADR-003 — "wire the seam into the loop"). Best-effort: the co-located AOF.md is
    // indexed in place by the OWNING repo's work-stream scan (a foreign source's own
    // aof picks it up); reindexing this project is a no-op when the source is elsewhere.
    // The import never writes the index JSON directly and never spawns graphify (ADR-003).
    if (!dryRun) {
      // Resilient: a binary-absent graphify backend already degrades (milestone 10);
      // never let a reindex failure fail the import that materialized successfully.
      try {
        const backend = await resolveConfiguredBackend(ctx.workspace.config);
        await backend.reindex(null, {
          workDir: ctx.workspace.workDir,
          projectRoot: ctx.workspace.projectRoot,
          configMemory: ctx.workspace.config?.memory ?? {},
        });
      } catch (error) {
        // Non-fatal (ADR-003 resilience: a binary-absent graphify backend degrades),
        // but surface it — a swallowed failure leaves the import unindexed with no
        // signal. The materialize succeeded; memory will catch up on the next reindex.
        console.error(
          `warning: import materialized but the memory reindex failed (${error.message}). Run \`aof work memory reindex\` to index it.`
        );
      }
    }

    return {
      imported: !dryRun,
      milestoneRef,
      sourceSlug,
      dir: materialized.dir, // RAW absolute; cli.json relativises
      artifacts: materialized.artifacts, // RAW absolute paths
      recordCount: materialized.recordCount,
      dryRun,
    };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs importMilestoneCommandCli copy is
    // deleted (the `aof import` ladder keeps only its unknown-unit shim).
    route: ["import", "milestone"],
    spec: {
      usage: "aof import milestone <repo> [selector] [--dry-run] [--json]",
      flags: {
        dryRun: { type: "boolean", description: "preview the import without writing" },
      },
    },

    // `aof import milestone <repo> [selector] [--dry-run] [--json]`.
    argv: (positionals, options = {}) => {
      const input = { repo: positionals[0] };
      if (positionals[1] != null) input.selector = positionals[1];
      if (options.dryRun) input.dryRun = true;
      return input;
    },

    // Human render: a one-line summary of what was imported (or would be).
    render(result) {
      const verb = result.dryRun ? "Would import" : "Imported";
      const files = result.artifacts
        .map((p) => path.relative(process.cwd(), p))
        .join(", ");
      const head = `${verb} milestone ${result.milestoneRef} (source: ${result.sourceSlug}) — ${result.recordCount} record(s).`;
      const body = `  ${result.dryRun ? "would materialize" : "materialized"}: ${files}`;
      return `${head}\n${body}`;
    },

    // --json face projection: relativise the raw absolute paths to cwd, mirroring
    // graph-build's relativisePaths. The structured result is otherwise verbatim.
    json: (result) => relativisePaths(result),
  },
};

// Relativise `dir` + every `artifacts` entry to process.cwd() for the CLI --json
// face (08/ADR-002 path-display projection). Leaves every other field untouched.
function relativisePaths(result) {
  const out = { ...result };
  if (typeof out.dir === "string") out.dir = path.relative(process.cwd(), out.dir);
  if (Array.isArray(out.artifacts)) {
    out.artifacts = out.artifacts.map((p) =>
      typeof p === "string" ? path.relative(process.cwd(), p) : p
    );
  }
  return out;
}
