// The FRESHNESS RAMP — the fifth read-only ramp (milestone 43 / story 04;
// DESIGN §"The freshness ramp — the ONE new vocabulary"; ARCHITECTURE 43/ADR-006).
//
// One pure, framework-free, headless ESM module — no React, no DOM, no IO, and
// NO CLOCK OF ITS OWN (`now` is passed in) — the `runs.mjs` contract verbatim, so
// the node tests and the React surfaces both drive the SAME code. The board and
// the fleet import this one module, so the two surfaces cannot disagree about
// whether a given row is stale.
//
// IT ANSWERS A QUESTION THE OTHER FOUR RAMPS DO NOT: "how old is the copy I am
// reading, and who wrote it?" It qualifies the DATA, not the work — so it is its
// own primitive and is never merged with item-status, run-state, node-presence or
// assignment-lifecycle.
//
// TWO RULES THAT ARE STRUCTURAL, NOT STYLISTIC:
//
//  1. STRICT `>`, so this side of the wire and `src/`'s shared `isStale`
//     (`mesh-presence.mjs:398-408`) agree AT the threshold instant. A record
//     EXACTLY at the window is still FRESH. "Two staleness predicates that can
//     disagree about the same instant is a defect, not a variant" (DESIGN).
//  2. NO THRESHOLD LITERAL AND NO DEFAULT LIVES IN `ui/`. The number is
//     configured once in `src/` and rides the list envelope; `readStalenessWindow`
//     below is the ONE place in `ui/` that knows its wire name, and it answers
//     `null` when the wire does not carry it. A missing window makes the verdict
//     UNKNOWABLE — never a guess, and never a badge (`acd-cache-staleness-single-
//     predicate` pins both halves).
//
// AND THE DISCIPLINE BEHIND THE THIRD STATE: a missing `syncedAt` yields
// `unknown`, NEVER `stale`. A fact slot degrades to "unknown" (DESIGN GAP D2); an
// assertion is withheld. Backfilling a fabricated instant would assert a
// freshness nobody observed.
import { relativeTime } from "./runs.mjs";

// The badge's mark (U+25CC DOTTED CIRCLE) — deliberately unclaimed by the
// product's glyph set (`○ ◐ ◔ ! ✓ ✦ ◷ ♥ ▸ → ↻ ⟳ ✕`), and the dashed ring in glyph
// form so the mark and the border say the same thing. DECORATIVE: the word
// `stale` is what carries the meaning (DESIGN §Accessibility rule 1).
export const FRESHNESS_GLYPH = "◌";

// The badge's three forms, in the PRIORITY order that says which outranks which
// when a surface must be pinned to a narrower one — whole discrete drops, never a
// shrink factor and never an overprint (the m38 DG-13/DG-19 lesson).
//
// It is NOT a runtime yield ladder: DESIGN withdrew that reading (2026-08-03,
// §"The form is chosen by the SURFACE, not by the viewport"), because the fleet
// card's own width is viewport-INVARIANT — its grid is
// `repeat(auto-fill, minmax(320px, 1fr))`, so a wider viewport buys COLUMNS and
// the card is narrower at 2560 than at 1280. Each surface picks ONE form, the way
// `status.tsx`'s ring/chip/dot are picked. `minimal` is RESERVED — no surface
// paints it in this milestone — and keeps its binding `role="img"` + `aria-label`
// contract, which is what makes it safe to reserve rather than dead.
export const BADGE_FORMS = ["full", "short", "minimal"];

const SECOND = 1;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ------------------------------------------------- the wire's ONE reader ------

// readStalenessWindow(envelope) — the configured staleness window, in seconds,
// off the `/api/work/list` envelope (43/ADR-010 R4.1). THIS IS THE ONLY PLACE IN
// `ui/` THAT KNOWS THE FIELD'S WIRE NAME, which is what keeps "one threshold" a
// structural fact rather than a convention: no other module can read it, default
// it, or grow a second copy of it.
//
// Answers `null` for every way the number can fail to arrive — absent, null,
// non-numeric, non-finite — because the honest consequence is identical in all
// of them: the UI does not know the window, so it must not quantify it and must
// not judge staleness (DESIGN §Surface 3's words-never-a-number degrade).
export function readStalenessWindow(envelope) {
  const value = envelope == null ? undefined : envelope.stalenessSeconds;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

// readCacheNodeId(envelope) — WHICH NODE this surface is running on, off the same
// envelope, so a row this node published can read `(this node)` (DESIGN §1c:
// "under this milestone the control is simply one more writer into the cache").
//
// It sits beside `readStalenessWindow` for the same reason that reader exists:
// both are ONE fact for the WHOLE response rather than a per-row one, so both are
// envelope concerns, and `ui/` learns each through exactly one function. Null
// when the wire does not carry it — and a null `thisNode` marks NO row as local,
// which is the honest degrade: a board that does not know which machine it is
// must not guess, and every row still names its reporter plainly.
export function readCacheNodeId(envelope) {
  const value = envelope == null ? undefined : envelope.nodeId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// The window rendered in WORDS, for the legend's `stale` row and the badge's
// tooltip sentence (DESIGN §Surface 3). Null in, null out — a caller that gets
// null must reword rather than substitute a number of its own.
export function stalenessWindowWords(windowSeconds) {
  if (typeof windowSeconds !== "number" || !Number.isFinite(windowSeconds) || windowSeconds < 0) return null;
  const plural = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"}`;
  if (windowSeconds === 0) return plural(0, "second");
  if (windowSeconds % DAY === 0) return plural(windowSeconds / DAY, "day");
  if (windowSeconds % HOUR === 0) return plural(windowSeconds / HOUR, "hour");
  if (windowSeconds % MINUTE === 0) return plural(windowSeconds / MINUTE, "minute");
  return plural(windowSeconds / SECOND, "second");
}

// ----------------------------------------------------- the predicate ---------

// The freshness verdict for one instant, at one `now`, against one window.
// PURE over (syncedAt, now, windowSeconds); `now` is an epoch-ms number or an
// ISO string — never read from a clock here.
//
//   stale   — now − syncedAt > windowSeconds  (STRICT `>`: at the window it is FRESH)
//   unknown — the instant is absent/unparseable, OR the window never arrived
//   fresh   — everything else, including a FUTURE instant (a copy from ahead of
//             this clock is not an old copy)
export function freshnessState(syncedAt, now, windowSeconds) {
  const at = Date.parse(syncedAt);
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return "unknown";
  if (typeof windowSeconds !== "number" || !Number.isFinite(windowSeconds) || windowSeconds < 0) return "unknown";
  return nowMs - at > windowSeconds * 1000 ? "stale" : "fresh";
}

// isCachePublished(record) — whether this row is one the CACHE serves, i.e. it
// carries the provenance keys at all. The wire sends `reportedBy`/`syncedAt` as
// EXPLICITLY PRESENT keys (null when unknown) for every cache-published row, and
// omits them entirely for a workspace that is not mesh-enabled — so their
// presence, not their value, is the per-workspace signal. This is the same
// "absent, not false" discipline the execution overlay already keeps: a plain
// local board renders no freshness vocabulary at all.
export function isCachePublished(record) {
  if (record == null || typeof record !== "object") return false;
  return "syncedAt" in record || "reportedBy" in record;
}

// ----------------------------------------------------- the renderings --------

// freshness(record, { now, windowSeconds, thisNode }) — the ONE descriptor both
// renderings come from (the `status.tsx` ring/chip/dot pattern): the state, the
// badge's three forms, the provenance-line label, and the tooltip sentence.
//
//   `record`  — { syncedAt, reportedBy } under their WIRE names.
//   `now`     — epoch ms (or ISO). Injected; this module reads no clock.
//   `windowSeconds` — the wire's configured window, or null when it did not arrive.
//   `thisNode`— the node this surface is running on, so a row it published reads
//               `(this node)`. Omitted ⇒ no row is marked local.
//
// `badge` is NULL for `fresh` and for `unknown`: freshness is the norm and only
// the deviation earns a mark, and an unknown instant is never asserted as stale.
// `label` is ALWAYS a sentence — an omitted line reads as "there is no such
// fact", so the unknowns are stated in words instead.
export function freshness(record, { now, windowSeconds = null, thisNode = null } = {}) {
  const syncedAt = record?.syncedAt ?? null;
  const reportedBy = record?.reportedBy ?? null;
  const state = freshnessState(syncedAt, now, windowSeconds);
  const age = ageLabel(syncedAt, now);
  // WHETHER THIS MACHINE AUTHORED THE COPY — one fact, computed once, rendered
  // twice (43/ADR-015 F5). The provenance line's ` (this node)` clause and the
  // detail panel's "does this artifact live on ANOTHER machine?" branch are the
  // same question asked in two places, and answering them from two expressions
  // is how they drift: widening `reportedBy` to every cache-published row (which
  // this story did) silently turned a presence test into "always true", so the
  // panel told an operator that their OWN node had failed to report an artifact
  // that had simply never been written. Null `thisNode` marks NO row as local —
  // the honest degrade, identical on both readings.
  const local = thisNode != null && reportedBy != null && reportedBy !== "" && reportedBy === thisNode;
  const from = reportedBy == null || reportedBy === ""
    ? "reporting node unknown"
    : `from ${reportedBy}${local ? " (this node)" : ""}`;
  const when = age == null ? "synced time unknown" : `synced ${age}`;
  const label = `${state === "stale" ? "stale · " : ""}${when} · ${from}`;

  return {
    state,
    // The reporting node NEVER travels in the badge's visible text — the `title`
    // and the provenance line carry it (the m38 region-5 lesson applied
    // pre-emptively: a chip that spends its width on a long node id truncates
    // the thing it exists to say).
    badge: state === "stale"
      ? {
        full: `${FRESHNESS_GLYPH} stale · ${age}`,
        short: `${FRESHNESS_GLYPH} stale`,
        minimal: FRESHNESS_GLYPH,
        title: staleSentence(syncedAt, age, reportedBy, windowSeconds),
      }
      : null,
    label,
    age,
    reportedBy,
    syncedAt,
    local,
  };
}

// badgeText(descriptor, form) — the badge's text in one of its three forms.
// Null when there is no badge to paint, so a caller cannot accidentally render
// an empty pill for a fresh row.
export function badgeText(descriptor, form = "full") {
  if (!descriptor?.badge) return null;
  return descriptor.badge[BADGE_FORMS.includes(form) ? form : "full"];
}

// The relative age of a copy — the product's ONE formatter (`runs.mjs`), so
// `just now` / `Ns ago` / `Nm ago` / `Nh ago` / `yesterday` / `Nd ago` read the
// same here as on every run row. Null when the instant is unknown.
export function ageLabel(syncedAt, now) {
  const at = Date.parse(syncedAt);
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return null;
  return relativeTime(new Date(at).toISOString(), new Date(nowMs).toISOString());
}

// ----------------------------------------------------- the legend -----------

// A new read-only vocabulary that is not in the legend is a vocabulary the
// operator must guess (DESIGN §Surface 3; the m35 precedent, where the fleet
// legend gained the assignment block "so the new ramp is self-documenting
// exactly as the two existing ramps are").
//
// freshnessLegendMark() — the descriptor the legend's `stale` row paints its
// swatch from. It comes from THIS module, and the legend renders it through the
// SAME badge component the surfaces paint, so the legend cannot drift from the
// ramp it documents — the rule the board legend's own comment already states,
// and the reason m35's assignment block paints real chips rather than drawings.
//
// It carries no age and no instant, because a legend row documents the STATE and
// not any particular copy: the short form (`◌ stale`) is the whole of it.
export function freshnessLegendMark() {
  return {
    state: "stale",
    badge: {
      full: `${FRESHNESS_GLYPH} stale`,
      short: `${FRESHNESS_GLYPH} stale`,
      minimal: FRESHNESS_GLYPH,
      title: "This copy is past the staleness window — the badge every stale row carries",
    },
    label: "stale",
    age: null,
    reportedBy: null,
    syncedAt: null,
    // A legend row documents the STATE, not a copy, so it has no author at all.
    local: false,
  };
}

// freshnessLegendRows(windowSeconds) — the legend block's two rows, in order:
// the marked state and the unmarked norm. ONE definition, so the board legend
// and the fleet legend state the same window in the same words.
//
// THE DEGRADE IS THE POINT. The threshold is configured once in `src/` and rides
// the envelope; when it does not arrive the UI genuinely does not know it, and
// the only honest row is one that names the window WITHOUT QUANTIFYING it. A
// baked-in "5 minutes" would be a SECOND threshold by another route: it would
// keep reading "5 minutes" long after an operator configured 30, and the
// operator would have no way to notice.
export function freshnessLegendRows(windowSeconds) {
  const words = stalenessWindowWords(windowSeconds);
  return [
    {
      // `marked` rows paint the real badge; the unmarked row shows the absence
      // itself, which is the "fresh renders nothing" rule stated as a swatch.
      marked: true,
      text: words == null
        ? "— no fresh copy inside the staleness window"
        : `— no fresh copy for over ${words}`,
    },
    { marked: false, text: "(no badge) — synced within the window" },
  ];
}

// The badge's full sentence, for its `title` (and, in the glyph-only form, its
// `aria-label` — a bare `◌` with no accessible name is a decorative mark
// pretending to be information). The window clause is DROPPED, not guessed, when
// the wire did not carry the number.
function staleSentence(syncedAt, age, reportedBy, windowSeconds) {
  const at = Date.parse(syncedAt);
  const node = reportedBy == null || reportedBy === "" ? "an unknown node" : reportedBy;
  const when = Number.isFinite(at) ? ` at ${new Date(at).toLocaleString()}` : "";
  const words = stalenessWindowWords(windowSeconds);
  const past = words == null ? " — past the staleness window" : ` — past the ${words} staleness window`;
  return `Last synced from ${node}${when} (${age})${past}`;
}

