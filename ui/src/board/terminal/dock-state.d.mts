// Type surface for dock-state.mjs (the framework-free connection-state ramp).
export type DockStateName = "idle" | "connecting" | "running" | "exited" | "error";
export type DockReads = "clean" | "failure" | null;

export interface DockState {
  state: DockStateName;
  exitCode: number | null;
  reads: DockReads;
  message: string | null;
}

export interface ControlMessage {
  type: string;
  exitCode?: number;
  message?: string;
}

export declare const DOCK_STATES: {
  IDLE: "idle";
  CONNECTING: "connecting";
  RUNNING: "running";
  EXITED: "exited";
  ERROR: "error";
};

export declare function initialDockState(): DockState;
export declare function dockConnecting(): DockState;
export declare function dockRunning(): DockState;
export declare function dockStateFromExit(code: number): DockState;
export declare function dockStateFromError(message?: string): DockState;
export declare function dockStateFromControl(current: DockState, control: ControlMessage): DockState;
