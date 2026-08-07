// Type declarations for the surface → shell channel (milestone 45 / story 03; ADR-005).
// `shell-bus.mjs` is framework-free at RUNTIME (no React import, no DOM); the types below are
// erased at compile time, so naming `ReactNode` here costs the module nothing and spares
// every importer a cast.

import type { ReactNode } from "react";

export declare const SLOT_SURFACE: "surface-slot";
export declare const SLOT_NOTICE: "notice-rail";
export type ShellSlot = "surface-slot" | "notice-rail";

export declare function declareShellPresent(): void;
export declare function hasShellHost(): boolean;
export declare function attachShellHost(handler: (slot: ShellSlot) => void): () => void;
export declare function contribute(slot: ShellSlot, node: ReactNode): () => void;
export declare function contributionFor(slot: ShellSlot): ReactNode;
export declare function resetShellBus(): void;

// [Build-1] — the request carries a LIVE DOM node the shell ADOPTS. Presenting must not
// unmount, remount, re-key or re-create the occupant, and dismissing returns the SAME node to
// `home`, so one xterm, one socket and one PTY survive both transitions.
export interface FullscreenRequest {
  readonly id: string;
  readonly label?: string;
  readonly node: Element;
  readonly home?: Element | null;
  readonly opener?: { focus?: () => void } | null;
  readonly claimsEscape?: boolean;
  readonly onLayout?: () => void;
}

export type FullscreenBusEvent =
  | { readonly type: "present"; readonly occupant: FullscreenRequest }
  | { readonly type: "dismiss"; readonly id?: string; readonly via?: string };

export declare function attachFullscreenHost(handler: (event: FullscreenBusEvent) => void): () => void;
export declare function requestFullscreen(request: FullscreenRequest): () => void;
export declare function dismissFullscreen(id?: string): void;
