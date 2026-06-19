// Local memory backend — RETRIEVAL (milestone 05 / story 02).
//
// This module owns the READ path of the local memory backend: ranking, scope
// filtering, the frozen `RecallResult`, and the `brief` digest. It reads the
// frozen index format (ADR-005) and is a PURE function of (records, query,
// scope, opts) — it never touches disk or argv. The seam (story 00) and the
// indexer (story 01) couple to this module only through the frozen contracts:
//
//   ADR-004  recall returns { query, scope, records[], text }; each record is a
//            MemoryRecord (ADR-005) + a numeric `score`; JSON is the contract,
//            text is a projection of exactly the same records.
//   ADR-005  a record is the frozen MemoryRecord shape; absent-type fields are
//            present as "" so filters never undefined-guard.
//   ADR-006  scope filters are a HARD pre-filter applied BEFORE scoring; ranking
//            is length-normalised (BM25-lite) + IDF + a title-match boost + a
//            record-type boost that lifts `lesson` over `adr` ONLY at equal
//            relevance (a tiebreaker, never a relevance override).
//   ADR-007  `brief` surfaces the lesson/adr split + a recent-lessons-by-area
//            digest, scopable to one milestone via scope.item.
//
// `recall`/`brief` obtain their records from an INJECTABLE source on `ctx` so the
// fixture tests need no disk file and no story-01 parser code: `ctx.records` (an
// array) is used directly when present; otherwise `ctx.loadIndex()` is awaited
// and its `.records` used. The orchestrator's glue (`local-backend.mjs`) wires
// the real on-disk index loader in as `ctx.loadIndex`.

// ── The frozen MemoryRecord field set (ADR-005). Recall adds only `score`. ──
export const MEMORY_RECORD_FIELDS = [
  "recordType",
  "id",
  "item",
  "itemSlug",
  "title",
  "area",
  "stage",
  "kind",
  "owner",
  "status",
  "summary",
  "text",
  "source"
];

// The scope dimensions (ADR-006). `item` is an exact milestone-number match; the
// rest are substring filters over the record's same-named field. Every record
// carries each field (absent → "" per ADR-005), so no undefined-guard is needed.
export const SCOPE_FIELDS = ["area", "stage", "kind", "owner", "item"];

const DEFAULT_LIMIT = 5;

// ── tokenisation ────────────────────────────────────────────────────────────
// Lowercase alphanumeric runs of length > 2 (matches the spike's tokenizer so the
// real corpus behaves identically). Short stop-ish tokens ("is", "a", "fn") drop
// out, which keeps the on-point lesson dense relative to a padded adr.
function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2);
}

// ── scope pre-filter (ADR-006: hard, intersected, BEFORE scoring) ────────────
// Empty scope ⇒ every record is a candidate. A present filter (even "") narrows:
// `item` is an exact stringified match; the rest are substring (`includes`) tests
// against the record's same-named field, so adr-only fields (stage/kind/owner)
// that are "" on lessons/adrs match only records carrying the filter value.
export function applyScope(records, scope = {}) {
  const filters = normalizeScope(scope);
  return records.filter((record) =>
    Object.entries(filters).every(([field, value]) => {
      if (field === "item") return String(record.item ?? "") === String(value);
      return String(record[field] ?? "").includes(value);
    })
  );
}

// Keep only the scope keys that were actually supplied (a non-undefined, non-null
// value). This is what `recall` echoes back as the applied scope (ADR-004): an
// empty scope echoes `{}` — "no applied filters".
export function normalizeScope(scope = {}) {
  const out = {};
  for (const field of SCOPE_FIELDS) {
    const value = scope?.[field];
    if (value === undefined || value === null) continue;
    out[field] = field === "item" ? String(value) : String(value);
  }
  return out;
}

// ── ranking (ADR-006: length-normalised BM25-lite + IDF + boosts) ────────────
//
// A BM25-lite term score over each survivor's `text`, normalised by the record's
// own length so a long, term-heavy record cannot win on raw repetition; IDF
// weights rarer query terms higher across the candidate corpus. On top of the
// content score sit two boosts: a title-match boost (a query term in the title is
// a strong signal) and a record-type boost that lifts `lesson` over `adr`. The
// type boost is deliberately SMALL — a fraction of one IDF-weighted term — so it
// breaks ties between near-equal matches (the "we already learned this" signal)
// but NEVER overturns a clearly stronger match (ADR-006 boundary case).

// BM25 saturation/length-normalisation parameters (standard defaults).
const BM25_K1 = 1.2;
const BM25_B = 0.75;
// The record-type boost: lessons over adrs at equal relevance. Kept below one
// IDF-weighted term so it is a tiebreaker, never a relevance override.
const TYPE_BOOST_LESSON = 0.15;
// Per-query-term title-match boost (a query term appearing in the record title).
const TITLE_BOOST_PER_TERM = 0.6;

function computeIdf(candidates, terms) {
  const N = candidates.length || 1;
  const docTokens = candidates.map((r) => new Set(tokenize(r.text)));
  const idf = new Map();
  for (const term of terms) {
    let df = 0;
    for (const tokens of docTokens) if (tokens.has(term)) df += 1;
    // BM25 idf with a +1 floor so a term present in every doc still has weight.
    idf.set(term, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }
  return idf;
}

function termFrequencies(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

// The length-normalised content score for one record against the query terms.
function contentScore(record, terms, idf, avgLen) {
  const tokens = tokenize(record.text);
  const len = tokens.length || 1;
  const tf = termFrequencies(tokens);
  let score = 0;
  for (const term of terms) {
    const f = tf.get(term) || 0;
    if (f === 0) continue;
    // BM25 term saturation + length normalisation: a longer doc needs more raw
    // hits to earn the same weight, so repetition in a padded adr is discounted.
    const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (len / (avgLen || 1)));
    score += (idf.get(term) || 0) * ((f * (BM25_K1 + 1)) / denom);
  }
  return score;
}

function titleBoost(record, terms) {
  const titleTokens = new Set(tokenize(record.title));
  let boost = 0;
  for (const term of terms) if (titleTokens.has(term)) boost += TITLE_BOOST_PER_TERM;
  return boost;
}

function typeBoost(record) {
  return record.recordType === "lesson" ? TYPE_BOOST_LESSON : 0;
}

// Rank records: (a) hard scope pre-filter, (b) length-normalised content score +
// title-match boost + record-type tiebreaker over the SURVIVING candidate corpus,
// (c) highest-score-first, truncated to opts.limit (default 5). Each returned
// record is the input record annotated with a numeric `score`.
//
// With no query terms (a scope-only recall) every survivor scores equally on
// content, so the type boost orders lessons ahead of adrs and the result is the
// scope-filtered set (capped at the limit) — useful for the brief/scoped views.
export function rankRecords(records, query, scope = {}, opts = {}) {
  const survivors = applyScope(records, scope);
  const terms = tokenize(query);
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const avgLen =
    survivors.length > 0
      ? survivors.reduce((sum, r) => sum + (tokenize(r.text).length || 1), 0) / survivors.length
      : 1;
  const idf = computeIdf(survivors, terms);

  const scored = survivors.map((record) => {
    const content = terms.length ? contentScore(record, terms, idf, avgLen) : 0;
    const score = content + titleBoost(record, terms) + typeBoost(record);
    return { record: { ...record, score }, score };
  });

  // Stable highest-score-first. JS sort is stable, so equal-score records keep
  // their fixture order (the type boost has already lifted lessons above adrs).
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((entry) => entry.record);
}

// ── obtaining records (injectable; no disk in tests) ─────────────────────────
// `ctx.records` (an array) is used directly when present; otherwise
// `ctx.loadIndex()` is awaited and its `.records` used. This is the seam between
// retrieval and the indexer/store: the glue passes the on-disk loader as
// `ctx.loadIndex`; tests pass a fixture array as `ctx.records`.
async function resolveRecords(ctx = {}) {
  if (Array.isArray(ctx.records)) return ctx.records;
  if (typeof ctx.loadIndex === "function") {
    const index = await ctx.loadIndex();
    return Array.isArray(index?.records) ? index.records : [];
  }
  return [];
}

// ── recall (ADR-004 frozen RecallResult) ─────────────────────────────────────
// Returns { query, scope, records[], text }: the applied scope echoed back
// (empty scope → {}), the ranked+scored records, and a human `text` view that
// projects EXACTLY the same record ids (introduces none, omits none).
export async function recall(query, scope = {}, opts = {}, ctx = {}) {
  const records = await resolveRecords(ctx);
  const ranked = rankRecords(records, query, scope, opts);
  const result = {
    query: query ?? "",
    scope: normalizeScope(scope),
    records: ranked,
    text: ""
  };
  result.text = renderRecallText(result);
  return result;
}

// ── brief (ADR-007 lesson/adr split + recent-lessons-by-area digest) ─────────
// A digest over the scope-filtered records: lesson/adr counts and a
// recent-lessons-by-area map. `scope.item` (the seam's --item NN) scopes the
// brief to one milestone. Returns a structured digest plus a rendered `text`
// view, mirroring the RecallResult JSON-is-contract / text-is-projection split.
export async function brief(scope = {}, opts = {}, ctx = {}) {
  const records = await resolveRecords(ctx);
  // brief scopes by item only (the situational "what does milestone NN hold");
  // the other scope dimensions are recall's concern.
  const itemScope = scope?.item === undefined || scope?.item === null ? {} : { item: scope.item };
  const scoped = applyScope(records, itemScope);

  const lessons = scoped.filter((r) => r.recordType === "lesson");
  const adrs = scoped.filter((r) => r.recordType === "adr");

  // Recent-lessons-by-area: area → lessons in that area (most recent last in the
  // fixture order; we keep source order so "recent" tracks index order). Each
  // entry is a light projection so the seam/agent can render without re-reading.
  const lessonsByArea = {};
  for (const lesson of lessons) {
    const area = lesson.area || "";
    (lessonsByArea[area] ||= []).push({
      id: lesson.id,
      item: lesson.item,
      title: lesson.title,
      summary: lesson.summary ?? ""
    });
  }

  const digest = {
    scope: normalizeScope(itemScope),
    lessonCount: lessons.length,
    adrCount: adrs.length,
    lessonsByArea,
    text: ""
  };
  digest.text = renderBriefText(digest);
  return digest;
}

// ── text rendering (the human projection of a RecallResult) ──────────────────
// Surfaces every record id in `result.records` and NO id absent from it (ADR-004:
// text is a projection of the same records the agent path reads).
export function renderRecallText(result) {
  const { query, scope, records } = result;
  const scopeLabel = describeScope(scope);
  const lines = [];
  lines.push(`recall "${query ?? ""}"${scopeLabel ? ` [${scopeLabel}]` : ""}  →  ${records.length} hit(s)`);
  for (const record of records) {
    const tag =
      record.recordType === "lesson"
        ? [record.kind, record.area].filter(Boolean).join("/") || "lesson"
        : `adr${record.status ? `/${record.status}` : ""}`;
    const score = typeof record.score === "number" ? `, score ${round(record.score)}` : "";
    lines.push(`  > [${record.id} · m${record.item}] ${record.title}  (${tag}${score})`);
    const gist = (record.summary || record.text || "").replace(/\s+/g, " ").trim().slice(0, 180);
    if (gist) lines.push(`    ${gist}`);
    if (record.source) lines.push(`    ↳ ${record.source}`);
  }
  return lines.join("\n") + "\n";
}

// The human projection of a brief digest (the lesson/adr split + recent lessons
// grouped by area). Surfaces each lesson id under its area.
export function renderBriefText(digest) {
  const { scope, lessonCount, adrCount, lessonsByArea } = digest;
  const where = scope?.item ? ` · milestone ${scope.item}` : " · whole stream";
  const lines = [];
  lines.push(`memory brief${where}`);
  lines.push(`  ${lessonCount} lesson(s), ${adrCount} adr(s)`);
  lines.push(`  recent lessons by area:`);
  const areas = Object.keys(lessonsByArea);
  if (areas.length === 0) {
    lines.push(`    —`);
  } else {
    for (const area of areas) {
      const ids = lessonsByArea[area].map((l) => l.id).join(", ");
      lines.push(`    ${area || "(no area)"}: ${ids}`);
    }
  }
  return lines.join("\n") + "\n";
}

function describeScope(scope = {}) {
  return Object.entries(scope)
    .map(([field, value]) => `${field} ${value}`)
    .join(", ");
}

function round(n) {
  return Math.round(n * 100) / 100;
}
