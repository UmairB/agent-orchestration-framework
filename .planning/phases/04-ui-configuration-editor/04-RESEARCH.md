# Phase 4 Research: UI Configuration Editor

**Researched:** 2026-05-07T00:00:00+01:00
**Status:** Complete

## Research Question

What does the planner need to know to turn the current setup UI into a valid `.aof/` configuration editor without crossing the CLI execution boundary?

## Phase Inputs

- Phase goal: evolve the setup UI into a configuration editor that writes valid `.aof/` configuration while leaving execution to the CLI.
- Requirements: RTOV-04, UI-01, UI-02, UI-03, UI-04, UI-05.
- Context decisions: asset workspace, kind tabs, shared detail editor, inline markdown body editing, runtime checklist, enabled override sections, inline capability badges, Review tab, explicit Save per asset, live validation plus save gate, no UI execution.

## Current Implementation Snapshot

### Server

- `src/setup-ui.mjs` serves the UI and exposes only catalog APIs today:
  - `GET /api/items`
  - `POST /api/items`
- The server already has JSON response/error conventions and a body size guard.
- Static file serving currently joins `uiRoot` with `request.url`; Phase 4 touches this server and should avoid making static serving less safe.
- There is no config editing API yet.

### Config And Persistence

- `src/workspace.mjs` owns `.aof/` path discovery:
  - `.aof/aof.config.json`
  - `.aof/aof.lock.json`
  - `.aof/assets`
- `src/cli.mjs` already has private `writeWorkspaceConfig()` and `assetBodyPath()` logic that writes file-backed assets, but they are not reusable exports.
- `src/dsl.mjs` resolves file-backed resources and runtime override files, including implicit `overrides/<runtime>.json` beside resource body files.
- `src/config-inspect.mjs` provides validation/doctor diagnostics and is the right starting point for UI validation payloads.

### Runtime Capabilities

- `src/model.mjs` centralizes:
  - `RUNTIMES`
  - `RESOURCE_KINDS`
  - `CAPABILITY_STATUS`
  - `CAPABILITIES`
- The UI should not duplicate the capability table by hand. Add a server endpoint or shared generated payload that exposes the central model to the UI.
- Existing statuses map naturally to Phase 4 UI behavior:
  - `native`: normal support
  - `mapped`: caution, valid
  - `unsupported-warning`: caution
  - `unsupported-fail`: save blocker
  - `future`: visible future/caution state

### UI

- `ui/src/main.tsx` is currently a compact single-file React app with local state.
- It already has a two-column shape that can evolve into an asset workspace.
- Existing primitives: `badge`, `button`, `card`, `input`, `label`, `textarea`.
- Missing primitives likely needed for Phase 4: tabs/segmented controls, checkbox/toggle, select, collapsible/disclosure, maybe alert/status rows. These can be built locally with existing styling rather than adding a dependency unless planning finds a strong reason.

## Recommended Architecture For Planning

### Server API Boundary

Add config-editor endpoints to `src/setup-ui.mjs`, backed by reusable helpers in a new module such as `src/config-editor.mjs`.

Recommended endpoints:

- `GET /api/config`
  - Returns project name, resources with resolved body text, packages, config path, validation diagnostics, capability data, and suggested CLI commands.
- `PUT /api/config/resources/:kind/:id`
  - Creates or updates one asset using explicit Save per asset.
  - Writes metadata to `.aof/aof.config.json`.
  - Writes body to `.aof/assets/<plural>/<id>/<BODY_FILE>`.
  - Writes enabled runtime overrides to `.aof/assets/<plural>/<id>/overrides/<runtime>.json`.
  - Removes disabled/empty override files where safe.
- `GET /api/capabilities`
  - Returns `RUNTIMES`, `RESOURCE_KINDS`, `CAPABILITY_STATUS`, and `CAPABILITIES`.
- Optional but useful: `DELETE /api/config/resources/:kind/:id` only if planning decides deletion belongs to "edit"; Phase 4 context only locked create/edit, not duplicate/template behavior.

### Persistence Helper

Do not keep file-backed write behavior private inside `src/cli.mjs`. Extract shared functions so CLI interactive install and setup UI do not drift:

- build asset body path from central `RESOURCE_KINDS` and `defaultBodyFile()`
- serialize resources to `.aof/aof.config.json`
- write body files and override JSON files
- omit disabled/empty overrides
- preserve packages and unrelated resources

### Validation Strategy

Validation should reuse or extend `validateConfig()` from `src/config-inspect.mjs`, but UI needs draft validation before writing. Planning should include a pure validation path for draft resource payloads:

- ID required and normalized
- kind must be `skill`, `command`, `agent`, or `rule`
- runtimes must be a non-empty subset of `claude`, `codex`
- override identity fields must not change
- enabled override data should not be empty if its section is enabled, or should be omitted
- `unsupported-fail` capabilities block save
- mapped/future/warning statuses produce diagnostics but do not block save unless the central model says fail

### UI Shape

The first implementation can remain local-state React but should be split enough to keep complexity under control:

- `App` loads config/capability payloads and owns selected tab/asset.
- `KindTabs` switches between Skills, Commands, Agents, Rules, and Review.
- `AssetList` shows assets for the selected kind.
- `KindOverview` shows counts, runtime coverage, and validation status when no asset is selected.
- `AssetEditor` handles shared fields, kind-specific fields, inline markdown body, runtime checklist, and collapsible override sections.
- `CapabilityBadge` maps central statuses into visible badges/cautions.
- `ReviewPanel` summarizes validation, capability status, package/runtime info, and next CLI commands.

### Verification Strategy

Recommended checks for Phase 4:

- Unit tests for config editor helpers:
  - load existing `.aof/` config with file-backed bodies
  - save a new command/agent/rule/skill
  - write runtime override body files only when enabled
  - omit disabled/empty overrides
  - preserve packages and unrelated resources
  - reject invalid runtime/kind/id/capability states
- Integration or API-level tests for setup UI endpoints where practical.
- `npm run ui:build` for the React/TypeScript surface.
- `npm run test:unit` and `npm test` after server/helper changes.

## Planning Risks

- `writeWorkspaceConfig()` is currently private to `src/cli.mjs`; duplicating its behavior in setup UI would create drift.
- UI validation needs draft payload support, while current `validateConfig()` reads config from disk.
- Static serving in `src/setup-ui.mjs` should be hardened or at least not worsened while expanding the server.
- A single-file `ui/src/main.tsx` may become too large if Phase 4 lands all UI behavior there; planning should allow component extraction.
- Review tab must not accidentally become an execution surface. It can show commands, not run them.

## Research Complete

Phase 4 should be planned as three waves:

1. Config editor server/helper foundation.
2. Asset workspace UI and runtime override editing.
3. Review/capability validation, tests, build verification, and docs.
