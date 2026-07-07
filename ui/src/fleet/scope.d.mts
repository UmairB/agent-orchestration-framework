// Type declarations for scope.mjs (the pure fleet scope/region/state helpers).
import type { FleetNode, FleetStatus, GlobalWorkItem } from "./api";

export type Scope = "global" | "local";
export type PageState = "loading" | "error" | "empty" | "populated";

export declare const VALID_SCOPES: Scope[];

export declare function scopeLabel(scope: string | null | undefined): "Global" | "Local";
export declare function isValidScope(scope: unknown): scope is Scope;
export declare function withScopeParam(search: string | null | undefined, scope: Scope): string;
export declare function scopeFromSearch(search: string | null | undefined): Scope;

export declare function errorPathFor(
  error: (Error & { path?: string | null }) | null | undefined,
  status: (FleetStatus & { path?: string | null }) | null | undefined
): string | null;

export declare function pageState(ctx: {
  loading: boolean;
  error: string | null | undefined;
  status: FleetStatus | null | undefined;
}): PageState;
export declare function isEmptyStatus(status: FleetStatus | null | undefined): boolean;
export declare function emptyStateCopy(scope: Scope): string;

export declare function milestoneListItems(items: GlobalWorkItem[] | null | undefined): GlobalWorkItem[];

export declare function filterToWorkspace(
  status: FleetStatus | null | undefined,
  workspaceId: string | null | undefined
): FleetStatus | null | undefined;

export declare function withoutCredentialFields<T extends Record<string, unknown>>(record: T | null | undefined): Partial<T>;
export declare function isCredentialField(key: unknown): boolean;

export type NodePanelFacts = {
  nodeId: string | null;
  role: string | null;
  host: string | null;
  lastSeenAt: string | null;
  capabilities: string[];
  fabricAddress: string | null;
  freshness: "live" | "stale" | "unknown" | string;
};

export declare function nodePanelFacts(node: Partial<FleetNode> & Record<string, unknown>): NodePanelFacts;

export type DiagnosticsSummary = {
  projectedAt: string | null;
  skippedWorkspaceCount: number;
  descriptorErrorCount: number;
  projectionErrorCount: number;
};

export declare function diagnosticsSummary(status: FleetStatus | null | undefined): DiagnosticsSummary;
