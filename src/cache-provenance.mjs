// src/cache-provenance.mjs — the CACHE's provenance boundary (m43 / story 04, ADR-006).
//
// ONE home for two facts that must never be spelled twice:
//
//   (1) THE STORAGE → WIRE MAPPING. The store speaks the sibling tables' names —
//       `node_id` / `updated_at` on `work_items`, `work_item_docs` and `work_item_runs`
//       alike — so a reader joining the three never meets two column names for one fact.
//       The WIRE speaks DESIGN's names — `reportedBy` / `syncedAt`. `toWireProvenance` is
//       the ONLY translation between them, and it is applied IDENTICALLY to a row and to
//       an artifact: a doc carries its own provenance under the same two keys as the row
//       that names it, because it is the same fact about a different subject.
//
//   (2) THE FRESHNESS VERDICT. `cacheFreshness` is `src/`'s DEFINITION OF RECORD for the
//       verdict — not, today, a predicate any production reader in `src/` calls. The wire
//       carries FACTS (`syncedAt`, `reportedBy`) plus the window, and every verdict this
//       milestone renders is computed client-side by `ui/src/board/freshness.mjs`, which is
//       ADR-006's own architecture rather than an oversight. It lives here so that the first
//       server-side reader that needs a verdict — a CLI freshness view, doctor — reaches for
//       this instead of hand-rolling a comparison, and so the shape the browser must agree
//       with is stated once in `src/` and tested. It does NOT compare timestamps of its own:
//       it calls the SHARED `isStale`
//       (run-store.mjs, re-exposed as `isNodeStale` in mesh-presence.mjs) — strict `>`,
//       `now` injected — which the run layer (m20), the node layer (m23) and session TTL
//       (m38) already share. "Two staleness predicates that can disagree about the same
//       instant is a defect, not a variant" (DESIGN), and this milestone genuinely
//       evaluates the rule on BOTH sides of the wire: the browser recomputes it against a
//       1-second cosmetic tick, so the two must agree AT the threshold instant. Strict `>`
//       is what makes a record EXACTLY AT the window still FRESH.
//
// THREE RULES THIS MODULE EXISTS TO KEEP, each of which a plausible implementation breaks:
//
//   - AN UNKNOWN IS EXPLICIT, NEVER OMITTED AND NEVER FABRICATED. A row that predates
//     schema v8 reads `node_id` NULL and `updated_at` NULL; those become `reportedBy: null`
//     and `syncedAt: null` — PRESENT and null. An omitted key reads as "there is no such
//     fact" rather than "this is unknown" (DESIGN GAP D2), and filling it with the SERVING
//     node's id or the CURRENT time would assert a freshness nobody observed (ADR-006's
//     forbidden backfill, at the read end instead of the write end).
//   - A MISSING INSTANT IS `unknown`, NEVER `stale`. Treating "no instant" as infinitely
//     old would paint every pre-v8 row degraded on the first open after the upgrade — the
//     dangerous failure, because it is the plausible one. A MISSING WINDOW is the same
//     answer for the same reason: `cacheFreshness` is GIVEN the window, and a verdict
//     against a window that never arrived would be a second resolution of the threshold at
//     the wrong layer (it is `resolveCacheStalenessSeconds` below, and ONLY it, that turns a
//     meaningless CONFIG value into the documented default — while still honouring `0`).
//   - A FUTURE INSTANT IS `fresh`, NOT `unknown`. A skewed peer clock gives a parseable
//     instant, so it is judged; `now − t` is negative, which is not `> window`. That is the
//     honest answer: we have an instant, and it is certainly not old.
//
// The module is a near-leaf on purpose: its only repo import is the shared predicate
// itself, so every surface that needs the mapping can reach it without dragging the store,
// the workspace or the mesh transport behind it.
import { isStale } from "./run-store.mjs";

// The DOCUMENTED default cache-staleness window, in SECONDS — the one number `src/`
// resolves when configuration says nothing, and the one that travels on the list envelope
// so `ui/` can carry no default and no literal of its own (ADR-006).
//
// 300s (5 minutes) rather than the presence window's 90s, because the two answer different
// questions over different cadences: presence asks "is this node alive right now" against a
// heartbeat measured in seconds, while cache freshness asks "how old is the COPY I am
// reading" — refreshed by the worker's stream-sync tick and the control's publish tick, and
// perfectly normal to sit minutes old on a settled item. A window tuned to the heartbeat
// would paint healthy settled work degraded, which is precisely the over-alarm this
// milestone exists to avoid.
export const DEFAULT_CACHE_STALENESS_SECONDS = 300;

// resolveCacheStalenessSeconds(config) — the configured window, in SECONDS, read off
// `config.mesh.cache.stalenessSeconds` through the raw optional-chain idiom (NOT
// config-editor.mjs — its whitelist would drop an unknown mesh block on rewrite, the m22
// story-01 lesson). The DISCIPLINE is `resolveStalenessSeconds`' verbatim (mesh-presence.mjs
// :418-424): an absent / non-number / non-finite / negative value falls back to the single
// documented default, and ZERO is a valid — if aggressive — threshold that is HONOURED.
// Only a meaningless value falls back.
export function resolveCacheStalenessSeconds(config) {
  const configured = config?.mesh?.cache?.stalenessSeconds;
  if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return DEFAULT_CACHE_STALENESS_SECONDS;
}

// A stored provenance value is only a fact when it is a non-empty string. NULL (never
// stamped), an empty string (a torn write) and a non-string are all the SAME answer —
// "unknown" — and they all serialise as an explicit null rather than as themselves, so no
// surface has to re-decide what an empty string means.
function storedString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// toWireProvenance(record) → { reportedBy, syncedAt } — THE storage→wire mapping, and the
// only one. It accepts either spelling of the STORAGE shape (`node_id`/`updated_at` as read
// straight off a SQLite row, or the store accessors' camelCase `nodeId`/`updatedAt`) and
// always emits the WIRE shape. Both keys are always present; unknowns are null.
//
// It deliberately does NOT read a clock, a config or a node identity: there is nothing it
// could fill an unknown with that would be true.
export function toWireProvenance(record) {
  return {
    reportedBy: storedString(record?.nodeId ?? record?.node_id),
    syncedAt: storedString(record?.updatedAt ?? record?.updated_at),
  };
}

// (A `withProvenance(target, record)` spread helper lived here and was called by nothing at
// all — every consumer spreads `toWireProvenance(record)` directly. Deleted at 43/04's
// structural review, ADR-014/E8: an unused export of a ONE-HOME module is a second sanctioned
// way to do the thing, which is precisely what a one-home module exists to prevent.)

// cacheFreshness(record, { nowMs, stalenessSeconds }) → "fresh" | "stale" | "unknown" —
// the `src`-side verdict of record, for ONE subject. Two subjects use it independently: the
// ROW's own `syncedAt` (work_items.updated_at) and each ARTIFACT's own
// (work_item_docs.updated_at) — "a doc can be older than the row that names it" (ADR-006).
// One predicate, two subjects; neither verdict is ever inherited from the other.
//
// `record` is a WIRE record (anything carrying `syncedAt`) or the instant itself. `nowMs`
// is INJECTED — the 22/R2 discipline the shared predicate already keeps, and the only way
// a boundary case is a test rather than a race. There is no wall clock in this module.
//
// The comparison itself is `isStale`'s, never re-derived here: the record is handed over in
// the presence-shaped `{ heartbeatAt }` form its `heartbeatAt ?? updatedAt` fallback
// resolves, exactly as `isNodeStale` hands over a presence record.
export function cacheFreshness(record, { nowMs, stalenessSeconds } = {}) {
  const syncedAt = typeof record === "string" ? record : record?.syncedAt ?? null;
  if (typeof syncedAt !== "string" || syncedAt.length === 0) return "unknown";
  if (!Number.isFinite(Date.parse(syncedAt))) return "unknown";
  // A MISSING WINDOW IS `unknown`, exactly like a missing instant — and for the same
  // reason. The window is a fact this function is GIVEN, not one it resolves: without it
  // there is nothing to compare the age AGAINST, so no verdict is available. Substituting
  // the documented default here would be a SECOND resolution of the threshold, at the
  // wrong layer, and it made this function disagree with `ui/`'s `freshnessState` on
  // every window shape it cannot use (measured 2026-08-03: absent / negative / NaN — `src`
  // said `stale`, `ui` said `unknown`). "Two staleness predicates that can disagree about
  // the same instant is a defect, not a variant" (DESIGN) — so the two now answer alike on
  // all thirteen shapes, and this module can honestly claim to state the browser's contract.
  //
  // NOT the same layer as `resolveCacheStalenessSeconds` above, whose fallback is
  // deliberately kept: THAT resolves a meaningless CONFIG value to the one documented
  // default (and still HONOURS a configured `0`). This one is handed a window that already
  // failed to arrive, and the honest answer to "how does this copy compare to a window I do
  // not have" is that we do not know — never `stale`, which would paint a degraded mark on
  // the strength of our own missing configuration.
  if (typeof stalenessSeconds !== "number" || !Number.isFinite(stalenessSeconds) || stalenessSeconds < 0) {
    return "unknown";
  }
  return isStale({ heartbeatAt: syncedAt }, nowMs, stalenessSeconds * 1000) ? "stale" : "fresh";
}
