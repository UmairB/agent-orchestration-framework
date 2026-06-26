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
import { commandError } from "./errors.mjs";
import { resolveImportSource } from "../import/source.mjs";
import { recoverMilestone, listRecoverableMilestones } from "../import/recovery.mjs";
import { materializeImport } from "../import/materialize.mjs";
import { slugifySource } from "../import/store.mjs";
import { resolveConfiguredBackend } from "../work-memory.mjs";

// Derive a stable source slug from the `<repo>` token (a local path's basename or
// a remote URL's last path segment), so a re-import of the same source lands in
// the same per-import folder (ADR-005 one-time snapshot).
function sourceSlugFor(repo) {
  if (typeof repo !== "string" || repo.length === 0) return "source";
  const tail = repo.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? repo;
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

    // Resolve which milestone to import. A MISSING <selector> is NOT a usage error
    // (Three-Amigos decision): exactly one recoverable milestone ⇒ import it;
    // ambiguous (>1) ⇒ a structured error asking which (ADR-002 surface).
    let selector = input.selector;
    if (selector == null || selector === "") {
      const candidates = await listRecoverableMilestones(sourceDir);
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
      selector = candidates[0].ref;
    }

    // Recover the milestone (the story-01 seam — a STUB for now; story 00 freezes
    // the signature + the `recovered` shape it returns).
    const recovered = await recoverMilestone(sourceDir, selector);

    const sourceSlug = sourceSlugFor(repo);
    const milestoneRef = String(selector);
    // The digest's `importedAt` provenance stamp (ADR-007). Injectable via input for
    // deterministic tests; defaults to today's date (YYYY-MM-DD). It lands ONLY in the
    // digest's frontmatter, which is never an index record source (parseAof ignores
    // frontmatter), so it changes no record and breaks no `source:line` (ADR-005).
    const importedAt = input.importedAt ?? new Date().toISOString().slice(0, 10);

    // Materialize the frozen artifact pair (ADR-001/004) — or PREVIEW on a dry-run
    // (ADR-002): the preview computes the artifacts + record count it WOULD write
    // and writes / indexes / networks NOTHING.
    const materialized = await materializeImport(
      { projectRoot, sourceSlug, milestoneRef, recovered, importedAt },
      { preview: dryRun }
    );

    // SEAM (story 02): after a real materialize, the import triggers the backend's
    // `reindex` so import REACHES memory (ADR-003 — the load-bearing "wire the seam
    // into the loop" deliverable). Story 00 deliberately does NOT reindex; story 02
    // adds `import → backend.reindex` HERE (only when !dryRun). The import never
    // writes the index JSON directly and never spawns graphify (ADR-003): it reaches
    // the CONFIGURED backend (`none` no-ops; `local`/`graphify` rebuild from the
    // `.md`, now including the import store via the EXTENDED buildRecords scan).
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
