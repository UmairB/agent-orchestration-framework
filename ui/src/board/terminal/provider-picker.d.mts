// Type surface for provider-picker.mjs (the exactly-one-selected picker).
export type ProviderId = "claude" | "codex" | "gemini";

export interface PickerState {
  selected: ProviderId;
}

export declare const PROVIDER_IDS: ProviderId[];
export declare function initialPicker(): PickerState;
export declare function selectProvider(state: PickerState, id: string): PickerState;
export declare function isSelected(state: PickerState, id: string): boolean;
export declare function selectedCount(state: PickerState): number;
