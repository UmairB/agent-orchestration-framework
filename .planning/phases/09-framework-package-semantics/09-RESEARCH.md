# Phase 9 Research: Framework Package Semantics

## Scope

Phase 9 upgrades AOF's current `packages[]` support from GSD-specific installer intent to a package model with source descriptors, required namespaces, direct dependency metadata, lock entries, and pre-write generated-output conflict checks.

The phase stays inside the current Node ESM CLI and the existing Claude Code / Codex runtime targets. It must not add a hosted registry, broaden runtime support, run package installers by default, or turn the setup UI into an execution surface.

## Current Implementation Map

### Package and installer path

- `src/frameworks.mjs` owns the current GSD install plan, dry-run commands, install attempt recording, and lock replay.
- `planFrameworkInstall()` only knows framework id `gsd`, string `source`, selected runtimes, local/global scope, and prior install attempts.
- `sourceToPackageName()` treats `npm:` specially and otherwise passes the source string through as an executable package spec.
- `gsdPackageFromConfig()` finds the configured GSD package by `id === "gsd"`.
- Current tests in `test/frameworks.test.mjs` cover npm source planning, skip-on-successful-prior-attempt, replay from lock, and forced reruns.

### Config normalization and validation

- `src/dsl.mjs` currently passes `config.packages ?? []` through without normalizing package descriptors.
- `src/config-inspect.mjs` validates packages with `VALID_PACKAGES = new Set(["gsd"])` and requires `source` to be an `npm:` string.
- `schemas/aof.schema.json` allows `packages[]` with `id`, `source`, and `runtimes`, with permissive additional properties.
- `src/config-editor.mjs` includes packages in editable payloads and `nextCommands()`, but does not validate package namespace/source/dependency details.

### Rendering and lock state

- `src/adapters.mjs` renders local `.aof/` primitives to runtime output objects with `path`, `runtime`, `resource`, `source`, `content`, and `hash`.
- `src/render-plan.mjs` groups desired outputs by final path, merges Codex rule outputs to `AGENTS.md`, and throws on other duplicate output paths.
- `createLockManifest()` writes `files`, `frameworks`, and `frameworkInstallAttempts`.
- Drift protection already happens in `planApplyActions()` before writes.

### CLI lifecycle

- `src/sync.mjs` creates one combined plan for generated outputs and framework installers.
- `sync` prints package installer commands but does not run them unless `--install` is passed.
- `apply` writes generated outputs and lock state but never runs package installers.
- `validate`, `doctor`, `apply --dry-run`, and `sync --dry-run` already have human and JSON output patterns that can carry package diagnostics.

## Architecture Source

The source architecture document at `C:\Users\Umair\Downloads\architecture-design-vendor-neutral-coding-assistant-dsl.html` defines framework packages as bundles of skills, agents, hooks, rules, and project-doc snippets. Relevant design points:

- Package manifests include `name`, `version`, required `namespace`, `provides`, `depends_on`, target overrides, install hooks, runtime hooks, and compatibility constraints.
- Install flow resolves an npm/git/file source, walks dependencies, conflict-checks the merged output tree, runs install hooks, updates manifest/lock state, then compiles.
- Namespacing is mechanically enforced by prefixing emitted files. Example: package skill `code-review` with namespace `gsd` emits as `gsd-code-review`.
- Conflicts are detected by simulating package plus local primitive output paths before any write.

Phase 9 context intentionally narrows that source design:

- Direct dependency metadata is in scope; full SAT-style transitive graph solving is not.
- Existing string sources remain accepted; structured descriptors are added and normalized internally.
- Known safe merges, such as current Codex `AGENTS.md` rule merging, can remain special-cased.

## Recommended Implementation Shape

### 1. Add a package model module

Create `src/packages.mjs` as the shared package boundary. It should export pure helpers such as:

```js
normalizePackages(packages, options)
normalizePackage(pkg, index, options)
normalizePackageSource(source, baseDir)
packageInstallSpec(packageEntry)
resolvedPackageEntry(packageEntry, options)
```

Keep this module free of file writes and subprocesses. It should return structured objects that `dsl`, `config-inspect`, `frameworks`, `sync`, and `render-plan` can consume.

### 2. Support both source forms

String examples:

```json
{ "id": "gsd", "namespace": "gsd", "source": "npm:get-shit-done-cc@latest" }
{ "id": "base", "namespace": "base", "source": "git:https://example.test/base.git#v1.0.0" }
{ "id": "local", "namespace": "local", "source": "file:../packages/local" }
```

Structured examples:

```json
{ "type": "npm", "package": "get-shit-done-cc", "version": "1.39.0" }
{ "type": "git", "url": "https://example.test/base.git", "ref": "v1.0.0" }
{ "type": "file", "path": "../packages/local" }
```

Normalize both to a shape with `type`, `requested`, `installSpec`, and source-specific fields. For local file sources, resolve paths against the config directory for validation/lock metadata, but keep a project-relative path where possible for readable output.

### 3. Require namespace at validation time

Package namespace should be a separate field with the same conservative id pattern used for resources. Do not silently derive namespace as the only accepted behavior because Phase 9 context locked explicit required namespaces.

Current default config, tests, and docs that declare GSD must add `"namespace": "gsd"`.

### 4. Record direct lock metadata

Add a `packages` array to the lock manifest while preserving existing `frameworks` and `frameworkInstallAttempts` compatibility. A package lock entry should include:

- `id`
- `namespace`
- `source` normalized object
- `resolved` object for deterministic metadata
- `dependencies` direct dependency declarations
- `runtimes`
- `scope`
- `intent`
- `generatedAt`

For `npm:` tags such as `latest`, avoid pretending to have resolved a concrete version without network data. Record the requested selector and a resolution status. Exact pinned npm versions, git refs, and local file paths can be recorded deterministically.

### 5. Preserve the network boundary

`apply`, `sync --dry-run`, `install --dry-run`, and `sync` without `--install` must remain side-effect-free with respect to package fetching/installers. Any future network resolution belongs behind existing explicit installer paths.

For tests, continue using `AOF_TEST_FRAMEWORK_INSTALL_STATUS` for installer success/failure and add deterministic package metadata tests that do not require real network access.

### 6. Treat package emitted outputs as normal desired outputs

Package-owned outputs should be converted into the same desired-output object shape that local primitives use. Add ownership metadata to `resource` or `source` so diagnostics can name `package:<id>` and local primitives can still be identified.

Namespace enforcement should happen before desired outputs are grouped by path. For prompt-like resources, prefix the resource id before calling the existing adapter render path. For root project-doc outputs and other fixed runtime config files, preserve existing safe merge behavior only where already intentional.

### 7. Conflict checks should be a pre-write gate

The existing `groupDesiredOutputs()` already throws on duplicate final paths except for Codex `AGENTS.md` rule merging. Extend that path or wrap it with richer conflict diagnostics so errors identify:

- contested generated output path
- package id and namespace for package-owned claims
- local primitive kind/id for local claims
- runtime

The failure must occur before `planApplyActions()`, `executeApplyActions()`, lock writes, or installer execution.

## Validation Architecture

Unit checks should cover:

- string and structured npm/git/file source normalization
- namespace required and pattern validation
- direct dependency metadata normalization
- install spec generation for npm/git/file package sources
- lock manifest package entries preserve resolved metadata
- package-owned output claims are namespace-prefixed before conflict grouping
- duplicate final paths fail with package/local ownership details

Integration/BDD checks should cover:

- `validate` rejects packages without namespace and accepts npm/git/file descriptors
- `config show` and `doctor` expose package namespace/source details
- `apply --dry-run` or `sync --dry-run` fails before writes on duplicate output claims
- `sync --codex --dry-run` still prints installer commands without running networked package installers
- existing GSD package configs work after adding `namespace: "gsd"`

Recommended verification commands:

- `npm run test:unit`
- `npm test`

Use `npm run ui:build` only if setup UI files are modified in execution.

## Planning Risks

- The current package path does not model package-owned assets; planning must add a minimal testable representation without building a full package registry.
- Remote npm/git package contents cannot be resolved without network access. Keep dry-run deterministic and avoid real package fetching outside explicit install paths.
- `frameworks` lock entries are already used by replay tests. Add package lock metadata without breaking replay from existing framework intent.
- Conflict detection must preserve the existing safe Codex rule merge and not regress local primitive rendering.

## Suggested Plan Split

1. Package descriptor normalization and validation.
2. Package resolution metadata, install planning compatibility, and lock entries.
3. Package output ownership, namespace application, pre-write conflict diagnostics, and user-facing tests/docs.

## RESEARCH COMPLETE

