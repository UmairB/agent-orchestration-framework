// Type declarations for the entry's decision (milestone 45 / story 03, task 00).
// `entry.mjs` is framework-free so `node:test` drives the "exactly once, before the first
// render" clauses with no browser; `main.tsx` gets its types from here.

import type { CanonicalUrlParts, RouteEntry, RouteId, UrlParts } from "./routes.mjs";

export declare const HISTORY_REPLACE: "replace";
export declare const HISTORY_NONE: "none";

export interface EntryPlan {
  // The canonical parts to `history.replaceState` to, or null when the address is already
  // canonical. NEVER a push.
  readonly replace: CanonicalUrlParts | null;
  readonly history: "replace" | "none";
  // The route id the shell mounts — read from the POST-rewrite address, never the incoming one.
  readonly surface: RouteId;
  readonly route: RouteEntry;
  // What the surface is handed: the rewritten parts when there was a rewrite, byte-identically
  // what arrived when there was not.
  readonly address: CanonicalUrlParts;
  readonly url: string;
}

export declare function addressToString(parts: CanonicalUrlParts): string;
export declare function entryPlanFor(parts?: UrlParts | null): EntryPlan;

// The plan's ONE side effect: `history.replaceState` when — and only when — `replace` is
// non-null. Returns the address written, or null when nothing was.
export declare function applyEntryPlan(
  plan: EntryPlan | null,
  history?: { replaceState?: (state: unknown, title: string, url: string) => void } | null,
): string | null;

export declare const SHELL_RENDERED_ROUTES: readonly string[];

export interface SurfaceMount {
  readonly routeId: string;
  // The shell renders this route itself (`landing`, `not-found`): nothing to mount, nothing wrong.
  readonly shellRenders: boolean;
  readonly mounts: boolean;
  // A route id the entry has no surface component for — the shell's failed state, naming it.
  readonly surfaceFailed: boolean;
}

export declare function surfaceMountFor(routeId: string, surfaceIds?: readonly string[] | Record<string, unknown>): SurfaceMount;
