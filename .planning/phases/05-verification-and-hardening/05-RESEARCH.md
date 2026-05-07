---
phase: 5
status: complete
researched: 2026-05-07
---

# Phase 5 Research: Verification And Hardening

## Research Complete

Phase 5 should be planned as a closeout and hardening phase, not as a new feature phase. The highest-risk areas are configuration compatibility, structured diagnostics, generated-output ownership behavior, framework install replay, setup UI request handling, and the Windows-safe UI build command.

## Current State

- `.aof/aof.config.json` is already authoritative when both `.aof/aof.config.json` and root `aof.config.json` exist, via `findProjectConfig()` in `src/workspace.mjs`.
- `src/config-inspect.mjs` already returns structured diagnostics with `severity`, `path`, `message`, and `code`, but malformed JSON and unreadable override files currently collapse into generic read/parse errors.
- `src/dsl.mjs` resolves file-backed resource bodies and runtime override JSON, but many error paths are not explicitly covered.
- `src/render-plan.mjs` already plans create, update, skip, drift-warning, delete, force overwrite, Codex rule merging, and lock manifest generation.
- `src/frameworks.mjs` already supports dry-run planning, previous successful attempt skipping, force rerun, simulated success/failure, and lock replay, but the matrix needs broader closeout coverage.
- `src/setup-ui.mjs` binds to `127.0.0.1`, exposes config/capability endpoints, keeps old catalog endpoints, and has a body-size guard. It still uses direct `JSON.parse()` in route handlers and needs consistent JSON error shapes, malformed JSON handling, route validation, payload-size behavior, and static path traversal regression tests.
- `npm run ui:build` currently delegates to the UI workspace npm script. On this Windows environment it failed because the npm/Git Bash shim could not find Unix utilities, while direct Node entry points for TypeScript and Vite passed.

## Planning Implications

### Validation And Compatibility

The plan should make config validation stricter for central AOF fields while preserving forward-compatible extension tolerance. Concretely:

- invalid `resources`, `packages`, core resource `kind`, `id`, `runtimes`, `overrides`, and package fields should block;
- unknown non-core fields should not block;
- root-only config remains legacy input;
- `.aof/aof.config.json` wins when both configs exist;
- migration and editor saves must not silently mutate root `aof.config.json`;
- stale legacy-root warnings should stay explicit in inspect/doctor output.

Schema alignment should be a focused unit test comparing `schemas/aof.schema.json` against `src/model.mjs` for supported runtimes, resource kinds, and high-value fields. It should not attempt full JSON Schema validation unless a schema validator already exists in dependencies.

### Regression Coverage

The existing custom unit harness is the right fit for closeout tests. Add test arrays and register them in `scripts/test-unit.mjs` and `scripts/test.mjs`; keep `npm test` focused on in-process unit plus BDD integration.

The BDD runner can already run through a real child process when `AOF_IN_PROCESS_INTEGRATION` is not set. Phase 5 should add a focused child-process smoke path without replacing the in-process default. This can be a small script or one explicit BDD invocation that exercises `bin/aof.mjs`, `--help`, a simple init/apply/config command, and process exit behavior.

### Generated Output And Lock State

`render-plan` already has the core primitives. Phase 5 should expand tests into an ownership/drift/prune matrix:

- create when missing;
- skip when matching;
- update when desired content changes and prior hash matches;
- drift-warning when generated output was manually changed;
- update with `--force`;
- delete stale generated file when unchanged;
- preserve stale drift by warning instead of deleting;
- keep lock entries for drift-blocked generated files.

Selective golden checks should target high-value outputs users inspect: merged Codex `AGENTS.md`, Claude rule output, and lock manifest shape. Full snapshots would be brittle and are not needed.

### Setup UI Hardening

The UI server can remain local-only and unauthenticated in v1, but it should treat requests as untrusted:

- parse JSON in one helper with a useful malformed JSON error;
- return consistent `{ ok: false, error, diagnostics? }` shapes for API errors;
- validate config-resource route kind/id against the URL and payload;
- reject unsupported methods and invalid API routes deterministically;
- retain and harden `GET/POST /api/items`;
- keep static file resolution inside `ui/`, with tests for encoded traversal;
- make payload-size rejection deterministic and avoid continuing after rejecting an oversized body.

Browser smoke is optional and should not block Phase 5 if local tooling is unavailable. API-level tests plus the TypeScript/Vite build wrapper are the reliable fallback.

### Build Command Policy

Add a root-level Node wrapper, for example `scripts/ui-build.mjs`, that invokes:

- `node ./node_modules/typescript/bin/tsc -b` from `ui/`;
- `node ./node_modules/vite/bin/vite.js build` from `ui/`.

Then point root `npm run ui:build` to that wrapper and make `npm run check` run `npm test` plus the wrapper. This avoids Git Bash shim dependence and preserves direct TypeScript/Vite commands as troubleshooting fallback in docs.

## Recommended Plan Shape

1. Wave 1: config validation, schema alignment, root compatibility, generated-output lock matrix, runtime override coverage, and framework replay/failure coverage.
2. Wave 2: setup UI request/static hardening and cross-platform UI build wrapper.
3. Wave 3: focused child-process smoke, final regression sweep, docs updates, and verification matrix artifact.

## Risks

- Broadening `npm run check` may reveal existing environment issues; the wrapper should isolate npm shim failures from actual UI build failures.
- Tightening validation can accidentally reject extension fields. Tests should explicitly prove extension tolerance.
- Setup UI hardening should avoid breaking Phase 4's config editor endpoints or older catalog endpoints.
- `STATE.md` and `ROADMAP.md` may remain stale because local `gsd-sdk query` mutation handlers are unavailable; phase artifacts should be treated as the current planning record.
