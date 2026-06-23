// The materialize writer (milestone 13 / story 00 — the SPINE; ADR-001/004/005).
//
// Turns a FROZEN `recovered` shape into the legible artifact PAIR in the import
// store. This is the seam stories 01 (which PRODUCES `recovered`) and 02 (which
// INDEXES the materialized `.md`) couple to — kept minimal and stable.
//
//   materializeImport({ projectRoot, sourceSlug, milestoneRef, recovered }, opts)
//     → { dir, artifacts: [absPath, …], recordCount }
//
// `recovered` is the frozen shape (story 01 fills it; story 00 drives it with a
// FIXED input in tests):
//   {
//     intent:    { objective, scope } | null,
//     decisions: [ { id, title, status, body } ],   // → ARCHITECTURE.md ADR blocks
//     outcomes:  [ { id, title, body } ],            // → RETROSPECTIVE.md R entries
//   }
//
// The artifact set is CONDITIONAL on what `recovered` carries (ADR-001):
//   - SPEC.md          ALWAYS (the recovered intent; absence of intent is recorded
//                      as not-recoverable BY story 01 — story 00 always writes it).
//   - ARCHITECTURE.md  ONLY when `decisions` is non-empty (→ `## ADR-NNN` blocks).
//   - RETROSPECTIVE.md ONLY when `outcomes` is non-empty (→ `## R<n>` entries).
//
// The knowledge artifacts reuse the EXACT 05 heading conventions the EXISTING
// `parseArchitecture` (`## ADR-NNN` + a `**Status:**` line → adr) and
// `parseRetrospective` (`## R<n>` → lesson) read — so the indexer (story 02)
// derives records with NO new parser (ADR-001). SPEC.md is legible intent and is
// NEVER an index record source. `opts.preview === true` computes the artifact set
// + record count it WOULD write but writes nothing (the --dry-run preview leg).
import path from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { importMilestoneDir, ensureImportStoreGitignore } from "./store.mjs";

// The three materialized artifact filenames — REUSING the aof doc shapes (ADR-001:
// no new OUTPUT.md doc type). The indexer (story 02) scans for these two knowledge
// artifacts by these exact names, running the existing parsers.
export const SPEC_FILE = "SPEC.md";
export const ARCHITECTURE_FILE = "ARCHITECTURE.md";
export const RETROSPECTIVE_FILE = "RETROSPECTIVE.md";

// The canonical "absence is information" marker (ADR-005). When the source has no
// recoverable intent, `renderSpec` writes THIS string into the SPEC.md Objective /
// Scope — a legible note, never a fabricated Objective and never an index record
// source (ADR-001). It is exported so the recovery story's absence assertions and
// this writer reference the SAME constant and cannot drift (the Three-Amigos pin).
export const INTENT_NOT_RECOVERABLE = "_Not recoverable from the source._";

// Deterministic provenance frontmatter for a materialized import artifact — marks it
// as imported knowledge and names its source (the `source` slug + the `sourceRef`).
// CRITICAL: NO timestamp / "indexed-at" field — a re-import MUST be byte-identical
// (ADR-005, pinned by acd-import-derived-index: a second import yields the IDENTICAL
// artifact set), so every field here derives ONLY from the inputs. It is NOT
// work-item frontmatter (no `type`/`number`/`status` — an import is never a managed/
// refinable item, ADR-004) and it is never a MemoryRecord field (the record's
// `source:line` path already carries provenance; the frozen record shape — 05/ADR-005
// — is untouched, and the existing parsers key off headings, not frontmatter).
function provenanceLines(sourceSlug, milestoneRef) {
  return ["imported: true", `source: ${sourceSlug ?? "source"}`, `sourceRef: "${milestoneRef}"`];
}

// Normalise the frozen `recovered` shape so the writer never trips on a partial
// input from story 01 (a missing key is treated as "no such half").
function normalizeRecovered(recovered = {}) {
  return {
    intent: recovered.intent ?? null,
    decisions: Array.isArray(recovered.decisions) ? recovered.decisions : [],
    outcomes: Array.isArray(recovered.outcomes) ? recovered.outcomes : [],
  };
}

// Render SPEC.md — the recovered intent in the milestone-SPEC shape (Objective +
// Scope). Legible, NOT an index record source (ADR-001). When intent is null the
// SPEC records that the intent was not recoverable — it NEVER fabricates an
// Objective the source never stated (ADR-005, "absence is information"). (Story 01
// owns the richer absence-recording behaviour; story 00 writes the honest floor.)
export function renderSpec({ milestoneRef, intent, sourceSlug }) {
  const lines = [
    "---",
    "doc: spec",
    ...provenanceLines(sourceSlug, milestoneRef),
    "---",
    `# Imported milestone ${milestoneRef}`,
    "",
    "<!-- Recovered intent (ADR-001). Legible artifact, NOT an index record source. -->",
    "",
    "## Objective",
    "",
  ];
  if (intent && typeof intent.objective === "string" && intent.objective.trim().length > 0) {
    lines.push(intent.objective.trim(), "");
  } else {
    lines.push(INTENT_NOT_RECOVERABLE, "");
  }
  lines.push("## Scope", "");
  if (intent && typeof intent.scope === "string" && intent.scope.trim().length > 0) {
    lines.push(intent.scope.trim(), "");
  } else {
    lines.push(INTENT_NOT_RECOVERABLE, "");
  }
  return lines.join("\n");
}

// Render ARCHITECTURE.md — one `## ADR-NNN` block per recovered decision, using
// the EXACT heading + `**Status:**` conventions parseArchitecture reads (05/ADR-007).
// Each block: a `## <id>: <title>` heading, a `**Status:**` line, and the body.
export function renderArchitecture({ milestoneRef, decisions, sourceSlug }) {
  const lines = [
    "---",
    "doc: architecture",
    ...provenanceLines(sourceSlug, milestoneRef),
    "---",
    `# Imported milestone ${milestoneRef} — Architecture Decisions`,
    "",
    "<!-- Recovered decisions (ADR-001). `## ADR-NNN` + `**Status:**` → adr records via the existing parser. -->",
    "",
  ];
  for (const decision of decisions) {
    const id = decision.id ?? "ADR-000";
    const title = decision.title ?? "";
    const status = decision.status ?? "Accepted";
    lines.push(`## ${id}: ${title}`, "");
    lines.push(`**Status:** ${status}`, "");
    if (decision.body && String(decision.body).trim().length > 0) {
      lines.push(String(decision.body).trim(), "");
    }
  }
  return lines.join("\n");
}

// Render RETROSPECTIVE.md — one `## R<n>` entry per recovered outcome, using the
// EXACT heading convention parseRetrospective reads (05/ADR-007). Each entry: a
// `## <id> — <title>` heading and the body.
export function renderRetrospective({ milestoneRef, outcomes, sourceSlug }) {
  const lines = [
    "---",
    "doc: retrospective",
    ...provenanceLines(sourceSlug, milestoneRef),
    "---",
    `# Imported milestone ${milestoneRef} — Retrospective`,
    "",
    "<!-- Recovered outcomes (ADR-001). `## R<n>` entries → lesson records via the existing parser. -->",
    "",
  ];
  for (const outcome of outcomes) {
    const id = outcome.id ?? "R1";
    const title = outcome.title ?? "";
    lines.push(`## ${id} — ${title}`, "");
    if (outcome.body && String(outcome.body).trim().length > 0) {
      lines.push(String(outcome.body).trim(), "");
    }
  }
  return lines.join("\n");
}

// Compute the artifact plan WITHOUT touching disk — the shared core of both the
// real write and the --dry-run preview. Returns the per-import dir + the ordered
// artifact specs (filename + content) + the record count the indexer WOULD derive
// (one adr per decision, one lesson per outcome; SPEC.md yields no records).
export function planMaterialize({ projectRoot, sourceSlug, milestoneRef, recovered }) {
  const normalized = normalizeRecovered(recovered);
  const dir = importMilestoneDir(projectRoot, sourceSlug, milestoneRef);

  const specs = [
    { file: SPEC_FILE, content: renderSpec({ milestoneRef, intent: normalized.intent, sourceSlug }) },
  ];
  if (normalized.decisions.length > 0) {
    specs.push({
      file: ARCHITECTURE_FILE,
      content: renderArchitecture({ milestoneRef, decisions: normalized.decisions, sourceSlug }),
    });
  }
  if (normalized.outcomes.length > 0) {
    specs.push({
      file: RETROSPECTIVE_FILE,
      content: renderRetrospective({ milestoneRef, outcomes: normalized.outcomes, sourceSlug }),
    });
  }

  // The indexer (story 02) derives one adr per decision + one lesson per outcome;
  // SPEC.md is legible intent and contributes NO records (ADR-001).
  const recordCount = normalized.decisions.length + normalized.outcomes.length;

  return {
    dir,
    specs,
    artifacts: specs.map((spec) => path.join(dir, spec.file)),
    recordCount,
  };
}

// Materialize the frozen artifact pair (ADR-001/004/005). A fresh write: the
// per-import folder is rebuilt clean so a re-import is a one-time snapshot with
// no accretion (ADR-005). The store is git-ignored via the nested-`.gitignore`
// idiom. `opts.preview === true` returns the SAME plan but writes nothing (the
// --dry-run leg). Returns { dir, artifacts:[absPath], recordCount }.
export async function materializeImport({ projectRoot, sourceSlug, milestoneRef, recovered }, opts = {}) {
  const plan = planMaterialize({ projectRoot, sourceSlug, milestoneRef, recovered });

  if (opts.preview === true) {
    // PREVIEW: compute the plan + record count, write NOTHING (ADR-002 dry-run).
    return { dir: plan.dir, artifacts: plan.artifacts, recordCount: plan.recordCount };
  }

  // Clean re-materialize (ADR-005): replace any prior snapshot for this
  // source/milestone so nothing accretes across runs.
  if (existsSync(plan.dir)) {
    await rm(plan.dir, { recursive: true, force: true });
  }
  await mkdir(plan.dir, { recursive: true });
  for (const spec of plan.specs) {
    await writeFile(path.join(plan.dir, spec.file), `${spec.content.replace(/\n+$/, "\n")}`, "utf8");
  }
  // Git-ignore the WHOLE store (the nested `.gitignore` at the store ROOT). NEVER
  // the repo-root `.gitignore` (F-02). Idempotent.
  await ensureImportStoreGitignore(projectRoot);

  return { dir: plan.dir, artifacts: plan.artifacts, recordCount: plan.recordCount };
}
