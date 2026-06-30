// Type declarations for runs.mjs (the pure run-observability helpers).
import type { RunRecord } from "./api";

// A run state along the milestone-19 lifecycle (19/ADR-001).
export type RunState = "queued" | "running" | "done" | "failed" | "cancelled";

// The fixed run-state chip descriptor (DESIGN surface 2): a theme-token colour, a
// label, and the chip's distinguishing mark. Colour + label always travel
// together; the run-state ramp is a dot+label chip, never the item-status glyph-ring.
export type RunChip = {
  label: string;
  token: "muted" | "primary" | "destructive" | "secondary";
  mark: "none" | "a pulsing dot" | "a ✓";
};

// The rerun verb descriptor (ARCHITECTURE 21/ADR-002): m21 resolves a FRESH
// work:run-start; m20's resume is a later additive delta (mode becomes "resume").
export type RerunVerb = {
  command: "work:run-start";
  ref: string;
  mode: "fresh" | "resume";
};

// A terse human relative label for an elapsed span (createdAt → now). PURE: `now`
// is passed in (defaults to Date.now() only when omitted).
export declare function relativeTime(fromIso: string, nowIso?: string | null): string;

// The poll affordance's freshness label — relativeTime behind the "⟳ refreshed " prefix.
export declare function refreshedLabel(lastFetchedIso: string, nowIso?: string | null): string;

// The current run for the pinned strip: the single in-flight `running` run, else
// the most recent by createdAt; null for an empty history.
export declare function selectCurrentRun(runs: RunRecord[]): RunRecord | null;

// The run history newest-first (a non-mutating sorted copy).
export declare function historyOrder(runs: RunRecord[]): RunRecord[];

// The fixed run-state → chip mapping (unknown falls back to the quiet muted form).
export declare function runStateChip(state: string): RunChip;

// The rerun's fresh work:run-start verb resolution for the selected ref.
export declare function rerunVerb(ref: string): RerunVerb;

// True when the item has a non-terminal (queued|running) run in flight.
export declare function isInFlight(runs: RunRecord[]): boolean;
