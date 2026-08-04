// The freshness ramp's TWO renderings (milestone 43 / story 04; DESIGN
// §"The freshness ramp"): a dashed-outline pill and a provenance-line label.
// Both are painted from the ONE headless ramp module (./freshness.mjs) — the
// `status.tsx` pattern, where a ring, a chip and a dot all come from one source,
// so the board, the fleet and the legend can never disagree about the ramp.
//
// WHY A DASHED PILL. Every existing pill in the product is solid-filled or
// solid-bordered (the status chip, the kit Badge, the run/assignment chips, the
// type/lane chips), so a dashed pill is UNCLAIMED and can never be mistaken for
// one of them — while dashed is already the house's "degraded / not-yet / absent"
// primitive (the `not-started` ring carries this exact
// `border-dashed border-muted-foreground/45` literal). The connotation is already
// learned; this reuses it in pill form.
//
// WHY `muted`, NEVER `destructive`. `destructive` is spoken for on these surfaces
// by `blocked` items and `failed` runs. A stale cache row is neither: it is the
// mesh's ONLY readable copy of that work, and it is LATE, not wrong. Painting it
// red would over-alarm exactly the normal degraded state this milestone exists to
// normalise (the m25 node-presence judgement, inherited rather than re-litigated).
//
// NO MOTION, EVER. Motion in this product means "something is happening now".
// Staleness is the absence of something happening, so the ramp adds no animation
// and therefore no new `prefers-reduced-motion` surface.
import { FRESHNESS_GLYPH, badgeText, freshnessLegendMark, freshnessLegendRows } from "./freshness.mjs";
import type { BadgeForm, Freshness } from "./freshness.mjs";

// Pinned by DESIGN. `text-[11px]` (not `text-xs`) is deliberate: the badge must
// be quieter than the `text-xs font-semibold` status chip it sits beside, because
// the hierarchy is STATUS > FRESHNESS — what the item *is* outranks how old the
// copy is.
const BADGE_CLASSES =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-muted-foreground/45 bg-transparent px-2 py-0.5 text-[11px] font-semibold text-muted-foreground";

// The stale badge, in one of its three forms. Renders NOTHING for `fresh` and for
// `unknown` — freshness is the norm and only the deviation earns a mark, and an
// unknown instant is never asserted as stale ("absent, not false").
export function StaleBadge({ freshness, form = "full" }: { freshness: Freshness | null | undefined; form?: BadgeForm }) {
  const text = badgeText(freshness ?? null, form);
  if (!text || !freshness?.badge) return null;
  const title = freshness.badge.title;

  // MINIMAL (glyph-only) — a bare `◌` with no accessible name is a decorative
  // mark pretending to be information, which is exactly what the
  // `role="img" + aria-label` pattern already prevents on `StatusRing`.
  if (form === "minimal") {
    return (
      <span role="img" aria-label={title} title={title} className={BADGE_CLASSES}>
        {FRESHNESS_GLYPH}
      </span>
    );
  }

  // FULL / SHORT — real text, so no `role` and no `aria-hidden` on the words. The
  // glyph is decorative (the status-ring convention); the WORD `stale` is what
  // carries the meaning, so the badge is never colour-only. The words are sliced
  // off the ramp module's own rendering rather than re-composed here — one source
  // for the ramp's language, one place for the mark's a11y treatment.
  const words = text.startsWith(FRESHNESS_GLYPH) ? text.slice(FRESHNESS_GLYPH.length).trim() : text;
  return (
    <span className={BADGE_CLASSES} title={title}>
      <span aria-hidden="true">{FRESHNESS_GLYPH}</span>
      <span>{words}</span>
    </span>
  );
}

// The SAME ramp as text rather than as a pill — the m25 presence-label form
// (`stale · synced 12m ago · from umairs-mac-mini`). One badge per item context:
// the badge attaches to the status-chip cluster, provenance lines use this form,
// and the two never both appear for the same record.
//
// The line is ALWAYS a sentence, including its unknowns: an omitted line reads as
// "there is no such fact", whereas `synced time unknown · from aof-wsl` states
// what is missing (DESIGN GAP D2 — a fact slot degrades to "unknown"; an
// assertion is withheld).
//
// `note` is a PERSISTENT FACT ABOUT THE WORLD appended to the line — today only
// `owner unreachable`, set by a Resync whose request could not be delivered. It
// lives on the LINE rather than in the message slot precisely because the slot
// holds acknowledgements, which decay: "`Requested` is a statement about a call
// we made; `owner unreachable` is a statement about the world, and it remains
// true until the world changes."
export function ProvenanceLabel({ freshness, note = null }: { freshness: Freshness; note?: string | null }) {
  return (
    <span className="mono text-[11px] text-muted-foreground">
      {note ? `${freshness.label} · ${note}` : freshness.label}
    </span>
  );
}

// ── the legend block (DESIGN §Surface 3) ────────────────────────────────────
//
// ONE component for BOTH legends (the board's `◷ status legend` and the fleet's
// `◷ legend`), because a legend that documents a ramp from a second source is
// how a legend starts lying about the ramp it documents. The swatch is the REAL
// <StaleBadge>, fed the ramp module's own descriptor — never a hand-drawn pill,
// a static glyph or a copied class string.
//
// It renders from the ramp module alone, so it is correct BEFORE any data has
// arrived — which matters here, because "before any data arrives" is precisely
// the state in which no window has been received and the rows must degrade to
// words. It has no loading, error or empty state.
export function FreshnessLegend({ windowSeconds }: { windowSeconds: number | null }) {
  const mark = freshnessLegendMark();
  return (
    <>
      <span className="mb-1 block font-semibold uppercase tracking-wide text-muted-foreground">Freshness</span>
      <span className="block space-y-0.5">
        {freshnessLegendRows(windowSeconds).map((row) => (
          <span key={row.text} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {row.marked ? <StaleBadge freshness={mark} form="short" /> : null}
            <span>{row.text}</span>
          </span>
        ))}
      </span>
    </>
  );
}

