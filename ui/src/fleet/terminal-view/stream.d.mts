// Type declarations for stream.mjs (the fleet terminal-VIEW's stream resolution;
// milestone 38 / story 06 / task 04). Shipped alongside the .mjs because
// `node scripts/test.mjs` does NOT type-check the fleet TS — a framework-free
// helper consumed from a .tsx without its .d.mts keeps the node suite green while
// `tsc -b` FAILS (this milestone's own craft lesson).
import type { WorkAssignment } from "../api";

export declare const NO_STREAM: {
  NO_ASSIGNMENT: "no-assignment";
  NO_NODE: "no-node";
  NO_SESSION: "no-session";
};

export declare const TERMINAL_VIEW_PATH: "/ws/terminal-view";

export type NoStreamReason = "no-assignment" | "no-node" | "no-session";

export type UnresolvedTerminalStream = { resolved: false; reason: NoStreamReason };

export type ResolvedTerminalStream = {
  resolved: true;
  nodeId: string;
  sessionId: string;
  key: string;
};

export type TerminalStream = UnresolvedTerminalStream | ResolvedTerminalStream;

export declare function terminalStreamKey(
  nodeId: string | null | undefined,
  sessionId: string | null | undefined
): string | null;

export declare function resolveTerminalStream(
  assignment: Partial<WorkAssignment> | null | undefined
): TerminalStream;

export declare function terminalViewSocketUrl(
  stream: TerminalStream | null | undefined,
  location?: { protocol?: string; host?: string }
): string | null;

export type TerminalStreamHeader = {
  ref: string;
  nodeId: string;
  sessionId: string;
  key: string;
  label: string;
  sessionLabel: string;
  readOnlyLabel: string;
};

export declare function terminalStreamHeader(
  stream: TerminalStream | null | undefined,
  owner?: { itemRef?: string | null; assignmentId?: string | null }
): TerminalStreamHeader | null;
