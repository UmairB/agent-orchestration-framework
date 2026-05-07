# Phase 4: UI Configuration Editor - Context

**Gathered:** 2026-05-07T00:00:00+01:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 evolves the current setup UI from a catalog-only surface into a `.aof/` configuration editor. It lets users create and edit valid `.aof/` assets, runtime targets, runtime-specific overrides, and runtime capability visibility for Claude Code and Codex. It writes `.aof/` source-of-truth files only; `init`, `apply`, and `install` execution remains in the CLI.

</domain>

<decisions>
## Implementation Decisions

### Editor Shape
- **D-01:** The primary UI should be an asset workspace: navigation/list on the left and a focused detail editor on the right.
- **D-02:** The workspace should organize assets with kind tabs: Skills, Commands, Agents, and Rules.
- **D-03:** When no asset is selected, the selected kind tab should show a kind overview with counts, runtime coverage, and validation status.
- **D-04:** Full-project review should live in a dedicated Review tab for config validity, unsaved/saved state, runtime/package summaries, capability issues, and CLI next commands.

### Asset Editing Flow
- **D-05:** Use one shared asset detail editor with kind-specific fields rather than separate editors per kind.
- **D-06:** Asset body content should be editable inline as markdown in the detail panel.
- **D-07:** The editor should provide concise field hints and examples for kind-specific fields such as command invocation, agent instructions, and rule paths.
- **D-08:** Phase 4 should support create and edit only. Duplicate/copy asset behavior and template-from-catalog behavior are out of scope for this phase.

### Runtime Targets And Overrides
- **D-09:** Runtime targeting should be edited with a Claude Code / Codex checklist in the asset detail editor.
- **D-10:** Runtime-specific overrides should appear as collapsible per-runtime sections inside the asset detail editor.
- **D-11:** Override sections should be hidden until explicitly enabled; disabled or empty overrides should not be written.
- **D-12:** Runtime override editing should include body/instructions overrides as well as metadata override fields.

### Capability Warnings
- **D-13:** Capability status should be shown inline near runtime controls using badges such as Native, Mapped, Unsupported, and Future.
- **D-14:** Mapped capabilities are valid but should show visible caution text, not an error. Example: Codex rule guidance maps into generated `AGENTS.md`.
- **D-15:** Saves should block invalid capability states such as `unsupported-fail`, while mapped/future/warning statuses remain visible cautions where applicable.
- **D-16:** The Review tab should include a project-wide capability summary across all assets and runtimes.

### Write Behavior And Validation
- **D-17:** Editing should use explicit Save per asset, not autosave and not a global save-all model.
- **D-18:** Validation should run live while editing and again as a save gate.
- **D-19:** Saving an asset should write config metadata plus file-backed asset body and override files under `.aof/` as needed.
- **D-20:** The UI must not execute CLI actions in Phase 4. It may show suggested next commands such as `aof apply --dry-run`, but it must not run dry-run, apply, init, or install.

### the agent's Discretion
No areas were delegated to the agent's discretion. The user selected concrete decisions for all discussed areas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 4 goal, requirements, success criteria, UI hint, and phase boundary.
- `.planning/PROJECT.md` — Product context, `.aof/` source-of-truth decisions, runtime scope, and UI execution boundary.
- `.planning/REQUIREMENTS.md` — RTOV-04 and UI-01 through UI-05.
- `.planning/STATE.md` — Current phase state and project memory.
- `.planning/phases/01-aof-workspace-model/01-CONTEXT.md` — Locked `.aof/` workspace, asset model, runtime override, and capability table decisions.
- `.planning/phases/02-runtime-rendering-and-lock-state/02-CONTEXT.md` — Locked generated-output, dry-run, lock manifest, and mapped Codex `AGENTS.md` behavior.
- `.planning/phases/03-cli-and-gsd-framework-flow/03-CONTEXT.md` — Locked CLI execution boundary, interactive install behavior, and Phase 4 UI deferrals.

### Codebase Maps
- `.planning/codebase/CONVENTIONS.md` — UI conventions, shadcn-style primitives, local state pattern, and current setup UI limitations.
- `.planning/codebase/STRUCTURE.md` — UI workspace structure, setup UI server, and important paths for UI/API work.
- `.planning/codebase/STACK.md` — React/Vite/Tailwind stack, scripts, and UI build expectations.

### Current Implementation
- `src/setup-ui.mjs` — Current local HTTP server and catalog-only API; Phase 4 should extend this toward config read/write APIs while preserving the no-execution boundary.
- `ui/src/main.tsx` — Current single-file React setup UI; Phase 4 should evolve or split this into an asset workspace with kind tabs, detail editor, and Review tab.
- `src/model.mjs` — Central runtime, resource kind, and capability status definitions that the UI should consume or mirror through an API.
- `src/dsl.mjs` — `.aof/` config loading, file-backed body resolution, runtime validation, and override resolution.
- `schemas/aof.schema.json` — Config schema for resource kinds, runtimes, paths, overrides, and package declarations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ui/src/components/ui/` contains reusable shadcn-style primitives including buttons, badges, cards, inputs, labels, and textarea.
- `ui/src/main.tsx` already has a left sidebar and content area structure that can be evolved into the asset workspace.
- `src/model.mjs` defines `RUNTIMES`, `RESOURCE_KINDS`, `CAPABILITY_STATUS`, and `CAPABILITIES`; Phase 4 should avoid duplicating this capability matrix in handwritten UI constants.
- `src/dsl.mjs` and `schemas/aof.schema.json` define the existing config model and should guide validation and save payload shape.

### Established Patterns
- UI source uses React function components, TypeScript, Tailwind CSS 4, shadcn-style primitives, and direct lucide-react icons.
- Current setup UI keeps state local to `App`; Phase 4 may need more structure, but should stay sympathetic to the compact current app.
- The Node setup UI returns JSON errors for failed POST requests.
- New user-facing behavior should have focused tests, with `npm run ui:build` included for UI changes.

### Integration Points
- Setup UI API should grow from catalog item endpoints toward `.aof/` config read/write, asset body, override, validation, capability, and review data endpoints.
- Asset saves should update `.aof/aof.config.json` metadata and file-backed asset files under `.aof/assets/<kind>/<id>/`.
- Runtime override saves should write only enabled override data, including runtime-specific body overrides where provided.
- Review tab data should come from validation/capability analysis, not from running CLI apply/install actions.

</code_context>

<specifics>
## Specific Ideas

- Keep the UI as a real work surface, not a landing page.
- Use kind tabs plus a shared detail editor to make the configuration model learnable without creating four separate products.
- Prefer concise inline hints/examples over large help panels.
- Show CLI next commands in Review, especially `aof apply --dry-run`, while preserving the Phase 4 no-execution boundary.

</specifics>

<deferred>
## Deferred Ideas

- Duplicate/copy asset actions are deferred beyond Phase 4.
- Creating assets from catalog templates is deferred beyond Phase 4.
- UI execution of dry-run, apply, init, or install remains out of scope for v1.
- Runtime support beyond Claude Code and Codex remains out of scope for v1.

</deferred>

---

*Phase: 4-UI Configuration Editor*
*Context gathered: 2026-05-07T00:00:00+01:00*
