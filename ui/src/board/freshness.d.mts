// Type declarations for freshness.mjs (the pure cache-freshness ramp — the
// fifth read-only ramp, milestone 43 / DESIGN §"The freshness ramp").

// DESIGN's three states. `unknown` is a DESIGNED state, not a gap: a missing
// `syncedAt` (or a window the wire never carried) is never rendered as `stale`.
export type FreshnessState = "fresh" | "stale" | "unknown";

// The badge's three forms, in priority order (whole discrete drops). The FORM is
// chosen by the SURFACE, never by the viewport; `minimal` is reserved and
// unpainted in this milestone (DESIGN, 2026-08-03).
export type BadgeForm = "full" | "short" | "minimal";

// The one record the ramp reads — WIRE names (`reportedBy`/`syncedAt`), mapped
// from the store's `node_id`/`updated_at` in the row mapper on the other side of
// the wire (43/ADR-006). Both keys are explicitly present (null when unknown)
// for a cache-published row, and absent for a workspace that is not mesh-enabled.
export type FreshnessRecord = {
  syncedAt?: string | null;
  reportedBy?: string | null;
};

// The badge's renderings + its tooltip sentence. The reporting node never
// appears in the visible text — only in `title`.
export type FreshnessBadge = {
  full: string;
  short: string;
  minimal: string;
  title: string;
};

// The ONE descriptor both renderings come from (the status.tsx ring/chip/dot
// pattern). `badge` is null unless the state is `stale`.
export type Freshness = {
  state: FreshnessState;
  badge: FreshnessBadge | null;
  label: string;
  age: string | null;
  reportedBy: string | null;
  syncedAt: string | null;
  // Whether THIS machine authored the copy — the same fact the label's
  // ` (this node)` clause states, exposed so no surface has to recompute it
  // (43/ADR-015 F5). False whenever the surface does not know which node it is.
  local: boolean;
};

export declare const FRESHNESS_GLYPH: string;
export declare const BADGE_FORMS: BadgeForm[];

// The ONE reader of the window's wire name, off the /api/work/list envelope.
// Null for every way the number can fail to arrive — `ui/` carries no default.
export declare function readStalenessWindow(envelope: unknown): number | null;

// The node this surface runs on, off the same envelope, so a row it published
// reads `(this node)`. Null when the wire does not carry it — no row is marked
// local, and every row still names its reporter plainly.
export declare function readCacheNodeId(envelope: unknown): string | null;

// The window in words ("5 minutes"), for the legend row and the tooltip. Null in,
// null out — the caller rewords, never substitutes a number of its own.
export declare function stalenessWindowWords(windowSeconds: number | null | undefined): string | null;

// The verdict for one instant at one `now` against one window. STRICT `>`, so
// this side agrees with src/'s shared isStale at the threshold instant.
export declare function freshnessState(
  syncedAt: string | null | undefined,
  now: number | string,
  windowSeconds: number | null | undefined,
): FreshnessState;

// Whether the row is one the cache serves — i.e. it carries the provenance keys
// at all (presence, not value: a non-mesh workspace omits them entirely).
export declare function isCachePublished(record: unknown): boolean;

// The state + both renderings + the tooltip sentence, for one record at one
// `now`. `now` is passed in; this module owns no clock.
export declare function freshness(
  record: FreshnessRecord | null | undefined,
  options?: { now: number | string; windowSeconds?: number | null; thisNode?: string | null },
): Freshness;

// The badge's text in one of its three forms; null when there is no badge.
export declare function badgeText(descriptor: Freshness | null | undefined, form?: BadgeForm): string | null;

// The relative age of a copy, through the product's one `relativeTime` formatter.
export declare function ageLabel(syncedAt: string | null | undefined, now: number | string): string | null;

// The legend's swatch descriptor — the ramp's own `stale` state with no age and
// no instant, painted through the SAME badge component the surfaces use.
export declare function freshnessLegendMark(): Freshness;

// The legend block's two rows. `marked` rows paint the real badge; the unmarked
// row shows the absence itself. The window is stated in words from the wire, and
// omitted — never guessed — when the wire did not carry it.
export declare function freshnessLegendRows(
  windowSeconds: number | null | undefined,
): { marked: boolean; text: string }[];

