// Type declarations for the shell's layout model (milestone 45 / story 03; ADR-005).
// `shell-layout.mjs` is framework-free JavaScript so `node:test` and the fitness function can
// drive it with no bundler; the `.tsx` importers — Shell.tsx here, and whatever milestones 46
// and 49 mount inside it — get their types from this file. Same house pattern as routes.d.mts.

import type { RouteId } from "./routes.mjs";

// ── the three regions ([Build-4]: three constants, five visual rows) ───────────
export declare const REGION_CHROME: "chrome";
export declare const REGION_CONTENT: "content";
export declare const REGION_OVERLAY: "overlay";
export type ShellRegion = "chrome" | "content" | "overlay";
export declare const REGIONS: readonly ShellRegion[];

export declare const ROW_NOTICE_RAIL: "notice-rail";
export declare const ROW_TOP_BAR: "top-bar";
export declare const ROW_SURFACE_BAR: "surface-bar";
export declare const ROW_CONTENT: "content";
export declare const ROW_OVERLAY: "overlay";
export type ShellRow = "notice-rail" | "top-bar" | "surface-bar" | "content" | "overlay";
export declare const ROW_ORDER: readonly ShellRow[];

export declare const SURFACE_BAR_MAX_WIDTH: number;
export declare function surfaceBarStands(input?: { viewportWidth?: number; surfaceDeclaresBar?: boolean }): boolean;

export declare const TOP_BAR_HEIGHT: number;
export declare const SURFACE_BAR_HEIGHT: number;
// The same two numbers as the Tailwind utilities that produce them — one home, because
// Tailwind scans source text and a composed `h-${…}` would never be emitted.
export declare const TOP_BAR_CLASS: string;
export declare const SURFACE_BAR_CLASS: string;
export declare const CHROME_BUDGET: number;
export declare const DESKTOP_WINDOW_HEIGHT: number;
export declare const CONTENT_FLOOR: number;
export declare const NOTICE_RAIL_MAX_VIEWPORT_FRACTION: number;
// The rail's cap AND its first-line pin, as one class.
export declare const NOTICE_RAIL_CLASS: string;
export declare const CONTENT_REGION_ID: string;
// The shell's own two card states (the landing and not-found) share one wrapper and one card.
export declare const SHELL_CARD_WRAPPER_CLASS: string;
export declare const SHELL_CARD_CLASS: string;

export interface ShellRowModel {
  readonly row: ShellRow;
  readonly region: ShellRegion;
  readonly present: boolean;
  readonly height: number | null;
  readonly measured: boolean;
  readonly inFlow: boolean;
  readonly fullBleed: boolean;
  readonly landmark: "banner" | "main" | null;
  readonly scrollOwner: string;
}

export interface ShellRowsInput {
  readonly notice?: { readonly height?: number } | null;
  readonly surfaceBar?: boolean;
  readonly fullscreen?: boolean;
}

export declare function shellRows(input?: ShellRowsInput): readonly ShellRowModel[];

// ── the published chrome height (contract point 7) ─────────────────────────────
export declare const CHROME_HEIGHT_PROPERTY: string;
export declare const CONTENT_HEIGHT_EXPRESSION: string;
export declare const BUDGET_WITHIN: "within";
export declare const BUDGET_AT_FLOOR: "at-budget";
export declare const BUDGET_BREACH: "breach";
export declare const BUDGET_CHROME_HIDDEN: "hidden";
export type BudgetVerdict = "within" | "at-budget" | "breach" | "hidden";

export interface ChromeModel {
  readonly property: string;
  readonly height: number;
  readonly value: string;
  readonly sizingExpression: string;
  readonly unit: "dvh";
  readonly viewportHeight: number;
  readonly viewportWidth: number | null;
  readonly contentHeight: number;
  readonly barsHeight: number;
  readonly noticeHeight: number;
  readonly budget: number;
  readonly barsWithinBudget: boolean;
  readonly contentFloor: number;
  readonly verdict: BudgetVerdict;
  readonly withinBudget: boolean;
  readonly noticeRailExempt: boolean;
  readonly noticeRailCap: number;
  readonly noticeRailScrollsInsideItself: boolean;
  readonly noticeRailFirstLinePinned: boolean;
  readonly reason: string | null;
}

export declare function chromeModel(input?: ShellRowsInput & { viewportHeight?: number; viewportWidth?: number | null }): ChromeModel;

// ── the two content modes ──────────────────────────────────────────────────────
export declare const CONTENT_MODE_PAGE: "content:page";
export declare const CONTENT_MODE_FIXED: "content:fixed";
export type ContentMode = "content:page" | "content:fixed";

export interface ContentModeModel {
  readonly mode: ContentMode;
  readonly scrollOwner: "page" | "descendants";
  readonly regionOwnsScroll: false;
  readonly minHeight: 0;
  readonly pageRootOverflowX: "hidden";
  readonly rootClass: string;
  readonly contentClass: string;
}

export declare function contentModeFor(routeId: RouteId | string): ContentModeModel;

// ── the top bar, its landmarks and the shell's own content states ──────────────
export declare const TOP_BAR_LEFT_OF_SLOT: readonly string[];
export declare const BRAND_MARK: {
  readonly glyph: string;
  readonly shape: string;
  readonly size: number;
  readonly ariaHidden: boolean;
  readonly accessibleName: string;
  readonly className: string;
};
export declare const WORDMARK: string;

export interface TopBarModel {
  readonly routeId: string;
  readonly landmark: "banner";
  readonly height: number;
  readonly leftOfSlot: readonly string[];
  readonly brandMark: typeof BRAND_MARK;
  readonly wordmark: string;
  readonly identityChip: {
    readonly control: boolean;
    readonly focusable: boolean;
    readonly blank: boolean;
    readonly mono: boolean;
    readonly minCh: number;
    readonly maxCh: number;
    readonly titleCarriesFullValue: boolean;
  };
  readonly slot: {
    readonly anchor: string;
    readonly yieldedAfterNav: boolean;
    readonly home: ShellRow;
    readonly contents: readonly string[];
    readonly empty: boolean;
  };
}

export declare function topBarModel(input?: { routeId?: string; slot?: readonly string[]; surfaceBar?: boolean }): TopBarModel;

export declare function landmarksModel(): {
  readonly banner: readonly ShellRow[];
  readonly main: readonly ShellRow[];
  readonly contentRegionId: string;
  readonly skipLinkIsFirstFocusable: boolean;
  readonly skipLinkTarget: string;
  readonly focusOrder: readonly string[];
};

export declare const STATE_NOT_FOUND: "not-found";
export declare const STATE_MOUNTING: "mounting";
export declare const STATE_POPULATED: "populated";
export declare const STATE_FAILED: "failed";
export type ShellContentState = "not-found" | "mounting" | "populated" | "failed";

export interface ContentStateModel {
  readonly state: ShellContentState;
  readonly exclusive: boolean;
  readonly chrome: "intact";
  readonly treatment: string;
  readonly tone: string | null;
  readonly accent: boolean;
  readonly destructive: boolean;
  readonly retry: boolean;
  readonly [key: string]: unknown;
}

export declare function contentStateFor(input?: { routeId?: string; surfaceLoaded?: boolean; surfaceFailed?: boolean }): ContentStateModel;

// ── the z ladder (DG-45-2) ─────────────────────────────────────────────────────
export type ZRung = "stickyChrome" | "popover" | "dock" | "toast" | "fullscreen";
export declare const Z_LADDER: Readonly<Record<ZRung, number>>;
export declare const Z_LADDER_FLOOR: { readonly name: string; readonly z: string; readonly description: string };
export declare const Z_CLASSES: Readonly<Record<ZRung, string>>;
export declare function rungFor(name: string): number;

// ── the fullscreen state machine ───────────────────────────────────────────────
export declare const FULLSCREEN_EMPTY: "empty";
export declare const FULLSCREEN_PRESENTING: "presenting";

export interface FullscreenOccupant {
  readonly id: string;
  readonly label: string;
  readonly opener: unknown;
  readonly claimsEscape: boolean;
}

export interface FullscreenState {
  readonly status: "empty" | "presenting";
  readonly occupant: FullscreenOccupant | null;
  readonly occupants: number;
  readonly chrome: "visible" | "hidden";
  readonly layoutTick: number;
  readonly restoreFocusTo: unknown;
  readonly changed: boolean;
  readonly dismissedVia?: string;
  readonly escapeClaimedByOccupant?: boolean;
}

export type FullscreenAction =
  | { readonly type: "present"; readonly occupant: { id: string; label?: string; opener?: unknown; claimsEscape?: boolean } }
  // `id` is the occupant the caller AIMS AT: a dismiss naming any other occupant is a no-op,
  // exactly like dismissing an empty slot. Omitted (the key, the shell's own exit control) it
  // targets whatever is presented.
  | { readonly type: "dismiss"; readonly id?: string | null; readonly via?: string }
  | { readonly type: "escape" };

export declare function fullscreenState(): FullscreenState;
export declare function fullscreenReducer(state: FullscreenState | null, action: FullscreenAction): FullscreenState;

export declare function presentedStateModel(state: FullscreenState | null): {
  readonly role: "dialog";
  readonly ariaModal: boolean;
  readonly ariaLabel: string;
  readonly focusTrapped: boolean;
  readonly restoreFocusTo: unknown;
  readonly rung: ZRung;
  readonly z: number;
  readonly exitControl: { readonly visible: boolean; readonly anchor: string; readonly dismissesVia: string };
  readonly escapeDismisses: boolean;
  readonly escapeClaimedByOccupant: boolean;
  readonly chrome: "hidden";
} | null;
