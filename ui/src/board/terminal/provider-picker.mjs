// Adapted from elirantutia/vibeyard (MIT) — the per-session provider selection
// (vibeyard's providerId on a SessionRecord), re-homed as a framework-free
// radio-semantics picker. vibeyard is MIT-licensed; see the repo NOTICE file.
// DESIGN §4: the provider picker offers claude / codex / gemini with EXACTLY ONE
// selected at all times (never two-on, never zero-on).
//
// No React — pure state, so the @executable scenarios (exactly-one-selected
// default; selecting moves the single selection) run headlessly.

// The exclusive provider vocabulary (mirrors src/terminal-providers.mjs).
export const PROVIDER_IDS = ["claude", "codex", "gemini"];

// The initial picker: exactly one provider selected (claude, the DESIGN default).
export function initialPicker() {
  return { selected: "claude" };
}

// Select a provider — moves the single selection to `id`. An unknown id is a
// no-op (the selection stays valid; never zero-on). Returns a new state.
export function selectProvider(state, id) {
  if (!PROVIDER_IDS.includes(id)) return { selected: state?.selected ?? "claude" };
  return { selected: id };
}

// True iff `id` is the one selected provider.
export function isSelected(state, id) {
  return (state?.selected ?? null) === id;
}

// The count of selected providers — always exactly 1 for a valid picker state
// (the invariant the exactly-one-selected scenarios assert).
export function selectedCount(state) {
  return PROVIDER_IDS.filter((id) => isSelected(state, id)).length;
}
