// Type declarations for the pure route model (milestone 45 / story 01; ADR-001, which
// names `routes.d.mts` explicitly). `routes.mjs` is framework-free JavaScript so node:test
// can drive it with no bundler; the `.tsx` importers — the shell entry (story 45/03) and
// whatever milestones 46/47/49 mount — get their types from here.
//
// The names below are the CONTRACT, not an implementation detail: the fitness functions
// and three downstream milestones bind to `routeFor` and `legacyRedirectFor`.

// The five route ids of ADR-002's table. `landing` (not `home`) is deliberate — "/" is the
// shell landing, and milestone 49 replaces what it RENDERS, never the route.
export type RouteId = "landing" | "fleet" | "board" | "config" | "not-found";

// One row of the table. `path` is null for `not-found` alone: it is not addressable, it is
// what every address the table does not know resolves to. Entries are frozen at runtime.
export interface RouteEntry {
  readonly id: RouteId;
  readonly path: string | null;
}

// The URL parts the caller hands in — a `location`-shaped record, or anything shaped like
// one. Every field is optional and every field tolerates null: the entry calls this once,
// before the first render, and a throw at that point is a blank page.
export interface UrlParts {
  readonly pathname?: string | null;
  readonly search?: string | null;
  readonly hash?: string | null;
}

// The canonical URL parts a rewrite yields. `search` is "" (never a bare "?") when nothing
// survived the translation; `hash` is carried verbatim and is "" when there is none.
export interface CanonicalUrlParts {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

// The shell's not-found surface — ONE shared entry, never one per typo.
export declare const NOT_FOUND_ROUTE: RouteEntry;

// ADR-002's table: four addressable entries plus the shared not-found entry.
export declare const ROUTES: readonly RouteEntry[];

// Total over every input, including a non-string one: an unknown, shapeless or hostile
// pathname resolves to NOT_FOUND_ROUTE. Case-sensitive; a single trailing slash is matched
// in place with no rewrite.
export declare function routeFor(pathname: unknown): RouteEntry;

// ADR-003's one-shot legacy translation. Returns null when there is nothing to rewrite —
// which is every URL that already carries a path, so re-applying it to its own output is a
// no-op and a `replaceState` can never loop.
export declare function legacyRedirectFor(parts?: UrlParts | null): CanonicalUrlParts | null;
