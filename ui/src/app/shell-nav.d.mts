// Type declarations for the shell's navigation model (milestone 45 / story 03, task 02).
// `shell-nav.mjs` is framework-free so `node:test` drives it headlessly; Shell.tsx gets its
// types from here. Same house pattern as routes.d.mts.

import type { RouteId, UrlParts } from "./routes.mjs";

export declare const NAV_FORM_TABS: "tabs";
export declare const NAV_FORM_DISCLOSURE: "disclosure";
export declare const NAV_DISCLOSURE_BREAKPOINT: number;
export declare const NAV_ITEM_BUDGET: number;
export declare const NAV_LABEL_BUDGET: number;

export declare const AVAILABLE: "available";
export declare const UNAVAILABLE: "unavailable";
export declare const UNKNOWN: "unknown";
export type NavAvailability = "available" | "unavailable" | "unknown";

export interface NavMarking {
  readonly rule: { readonly width: number; readonly style: "solid" | "dashed"; readonly colourToken: string };
  readonly weight: string;
  readonly colourToken: string;
  readonly className: string;
}

export interface NavItem {
  readonly id: RouteId;
  readonly label: string;
  readonly path: string;
  readonly href: string | null;
  readonly element: "a";
  readonly current: boolean;
  readonly ariaCurrent: "page" | null;
  readonly availability: NavAvailability;
  readonly ariaDisabled: "true" | null;
  readonly focusable: boolean;
  readonly navigates: boolean;
  readonly title: string | null;
  readonly command: string | null;
  readonly marking: NavMarking;
  readonly height: number;
  readonly fillsBarHeight: boolean;
  readonly holdsItsSlot: boolean;
}

export interface NavDisclosure {
  readonly label: string;
  readonly namesASurface: boolean;
  readonly ariaHasPopup: "menu";
  readonly ariaExpanded: boolean;
  readonly escapeCloses: boolean;
  readonly escapeReturnsFocusToTrigger: boolean;
  readonly arrowKeysMoveWithin: boolean;
  readonly className: string;
  readonly caret: string;
  readonly items: readonly NavItem[];
}

export interface NavBudget {
  readonly items: number;
  readonly itemBudget: number;
  readonly labelBudget: number;
  readonly within: boolean;
  readonly breaches: readonly string[];
  readonly absorbedBy: null;
}

export interface NavModel {
  readonly landmark: { readonly element: "nav"; readonly ariaLabel: "Surfaces" };
  readonly form: "tabs" | "disclosure";
  readonly items: readonly NavItem[];
  readonly currentId: RouteId | null;
  readonly ariaCurrentCount: number;
  readonly labelsTruncated: boolean;
  readonly rows: number;
  readonly horizontallyScrolls: boolean;
  readonly disclosure: NavDisclosure | null;
  readonly budget: NavBudget;
}

// A destination's resolvability from THIS origin, per route id. `true` (or an absent key) is
// in-origin; `{ origin }` is a live link to another origin; `false` is not resolvable from
// here; `null` is "the probe has not answered yet".
export type NavResolvable = Record<string, boolean | { origin: string } | null | undefined>;

export declare function navModel(input?: {
  address?: UrlParts;
  viewportWidth?: number;
  resolvable?: NavResolvable;
}): NavModel;

// The budget over an arbitrary item list. Exported so the tripwire that fires on a FIFTH
// surface (or an over-long label) can be driven without adding a row to the real route table
// — the condition it exists for does not exist yet, so a suite that reimplemented the
// arithmetic would be asserting against its own copy forever.
export declare function navBudgetFor(items: readonly { label: string }[]): NavBudget;
