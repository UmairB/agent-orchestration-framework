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
// ADR-006: the recallable DIGEST. An imported milestone whose source carried no
// decisions/outcomes (no `ARCHITECTURE.md`/`RETROSPECTIVE.md` to recover) would
// otherwise contribute ZERO records — its recovered intent lands only in the
// legible-but-unindexed `SPEC.md` (ADR-001). For exactly that zero-record case the
// import also emits an `AOF.md` digest (the milestone-14 doc type): each `## `
// section indexes as one `summary` record via the EXISTING `parseAof`, so the
// imported milestone gains a recallable presence with NO new parser. The digest is
// the milestone-14 "give a no-ADR/retro milestone a recallable presence" mechanism,
// now also emitted by the import writer (the deferred 13×14 follow-up).
export const AOF_FILE = "AOF.md";

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
    // ADR-007: the recovered milestone IDENTITY for the digest frontmatter — slug,
    // title, status. A partial/absent meta is tolerated (the digest frontmatter
    // falls back to the ref/slug, never fabricating a title the source lacked).
    meta: recovered.meta && typeof recovered.meta === "object" ? recovered.meta : {},
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

// The recoverable `## ` sections of a digest, in order — one `summary` record each
// (mirrors the milestone-14 `parseAof` section model: only `## Intent`/`## Scope`
// halves that the source actually carried). NEVER fabricates a half the recovered
// intent lacks (ADR-005, "absence is information"): an absent/empty objective or
// scope yields no section, so it yields no record.
function digestSections(intent) {
  const sections = [];
  if (intent && typeof intent.objective === "string" && intent.objective.trim().length > 0) {
    sections.push({ heading: "Intent", body: intent.objective.trim() });
  }
  if (intent && typeof intent.scope === "string" && intent.scope.trim().length > 0) {
    sections.push({ heading: "Scope", body: intent.scope.trim() });
  }
  return sections;
}

// True when the import should emit an `AOF.md` digest (ADR-006): the source carried
// recoverable INTENT but NO decisions and NO outcomes — the zero-record case the
// digest exists to give a recallable presence. A milestone WITH ADR/retro records
// already grounds recall, so it needs no digest (and we keep the materialized set —
// and every existing fixture's record count — unchanged for that case).
function emitsDigest(normalized) {
  return (
    normalized.decisions.length === 0 &&
    normalized.outcomes.length === 0 &&
    digestSections(normalized.intent).length > 0
  );
}

// The digest's frontmatter (ADR-007) — the milestone-14 digest convention
// (`doc`/`milestone`/`slug`/`imported`/`importedBy`), enriched with `title`,
// `status`, and an `importedAt` provenance stamp. UNLIKE the SPEC/ARCHITECTURE/
// RETROSPECTIVE provenance (`provenanceLines`, deliberately timestamp-free so those
// record-bearing artifacts re-import byte-identically — ADR-005), the digest
// frontmatter is NEVER an index record source: `parseAof` reads only `## ` sections
// and ignores frontmatter, so an `importedAt` here changes no record and breaks no
// `source:line`. `title` is quoted (it may carry spaces/punctuation); the numeric
// `milestone`, the `slug`, and the `status` are bare tokens. A missing title/status
// falls back without fabricating (absence is information — ADR-005).
function digestFrontmatter({ milestoneRef, slug, title, status, importedAt, importedBy = "aof" }) {
  const fm = [
    "---",
    "doc: digest",
    `milestone: ${milestoneRef}`,
    `slug: ${slug ?? milestoneRef}`,
    `title: ${JSON.stringify(title ?? "")}`,
    `status: ${status ?? "not-started"}`,
    "imported: true",
    `importedBy: ${importedBy}`,
  ];
  if (importedAt) fm.push(`importedAt: ${importedAt}`);
  fm.push("---");
  return fm;
}

// Render AOF.md — the recallable digest (ADR-006/007). Reuses the EXACT milestone-14
// digest convention `parseAof` reads: each `## ` section is one `summary` record
// (h1 title + HTML comments are not section roots). The sections come verbatim from
// the recovered intent, so every record traces to live text in the materialized
// `.md` (the derived-index invariant, ADR-005). The frontmatter carries the
// recovered milestone identity + provenance (ADR-007).
export function renderDigest({ milestoneRef, slug, title, status, intent, importedAt, importedBy = "aof" }) {
  const heading = title
    ? `# ${milestoneRef} · ${title} — Digest`
    : `# Imported milestone ${milestoneRef} — Digest`;
  const lines = [
    ...digestFrontmatter({ milestoneRef, slug, title, status, importedAt, importedBy }),
    heading,
    "",
    "<!-- Recovered intent as a recallable digest (ADR-006/007). Each `## ` section → one `summary` record via the EXISTING parseAof. -->",
    "",
  ];
  for (const section of digestSections(intent)) {
    lines.push(`## ${section.heading}`, "", section.body, "");
  }
  return lines.join("\n");
}

// Compute the artifact plan WITHOUT touching disk — the shared core of both the
// real write and the --dry-run preview. Returns the per-import dir + the ordered
// artifact specs (filename + content) + the record count the indexer WOULD derive
// (one adr per decision, one lesson per outcome, one summary per digest section;
// SPEC.md yields no records).
export function planMaterialize({ projectRoot, sourceSlug, milestoneRef, recovered, importedAt }) {
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
  // ADR-006: the zero-record (intent-only) case also emits a recallable AOF.md digest.
  const digest = emitsDigest(normalized) ? digestSections(normalized.intent) : [];
  if (digest.length > 0) {
    specs.push({
      file: AOF_FILE,
      content: renderDigest({
        milestoneRef,
        slug: normalized.meta.slug ?? milestoneRef,
        title: normalized.meta.title ?? "",
        status: normalized.meta.status ?? "not-started",
        intent: normalized.intent,
        importedAt,
      }),
    });
  }

  // The indexer (story 02) derives one adr per decision + one lesson per outcome +
  // one summary per digest section; SPEC.md is legible intent, contributing NO
  // records (ADR-001).
  const recordCount = normalized.decisions.length + normalized.outcomes.length + digest.length;

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
export async function materializeImport({ projectRoot, sourceSlug, milestoneRef, recovered, importedAt }, opts = {}) {
  const plan = planMaterialize({ projectRoot, sourceSlug, milestoneRef, recovered, importedAt });

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
