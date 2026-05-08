# Phase 10 BDD Coverage Matrix

**Status:** Wave 4 completed Node and PowerShell parity over the shared split feature suite.

## BDD-01: CLI Lifecycle Behavior

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| covered | `test/integration/features/lifecycle.feature`: `Show command help`; `Install AOF and create the catalog database`; `Initialize a repository from selected catalog items`; `Refuse to overwrite an existing project config`; `Add a file-backed skill from the CLI`; `Add refuses scaffold collisions unless forced`; `Add scaffolds non-skill kinds`; `Refuse to silently migrate a legacy root config during init`; `Explicitly migrate a legacy root config into .aof`; `Preview apply without writing runtime files or lock state`; `Protect drifted generated files unless forced`; `Prune stale owned generated files`; `Show config inspection in human and JSON formats`; `Validate invalid config for automation`; `Doctor reports package intent and stale legacy config`; `Clean previews and removes matching lock-owned outputs`; `Clean preserves drifted lock-owned outputs`; `List the catalog database`; `Initialize default catalog items`; `Initialize selected catalog items into Codex`; `Preview selected catalog installs without writing files`; `Interactively select catalog items`; `Guided interactive install asks before side effects`. `test/integration/features/packages.feature`: `Sync previews packages and generated outputs without writes`; `Sync applies outputs without running installers by default`; `Sync can explicitly run package installers`. | None. Covered by Node and PowerShell runners. | Done |

## BDD-02: v1.1 Primitive Compile/Render Behavior

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| covered | `test/integration/features/dsl.feature`: `Apply the project config to Codex only`; `Apply file-backed .aof assets`; `Apply expanded DSL primitives`; `Preview expanded DSL primitives before applying`; `Apply runtime override for a file-backed asset`; `Reject runtime override identity changes`; `Render natural-language rule guidance per runtime`; `Merge multiple Codex rules into one AGENTS file`. `test/integration/features/setup-ui.feature`: `Save a command resource through the setup UI API`; `Save expanded config sections through the setup UI API`; `Reject invalid expanded setup UI sections`; `Reject malformed JSON and route payload mismatches`; `Serve adapter warning review payloads`. | None. Covered by Node and PowerShell runners; setup UI coverage is HTTP API/editor coverage, not browser E2E. | Done |

## BDD-03: Framework Package Behavior

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| covered | `test/integration/features/packages.feature`: `Record managed framework intent in apply lock state`; `Refuse package resource output conflicts before writes`; `Validate npm git and file package descriptors`; `Record package dependency and resolution metadata in lock`; `Preview config-declared GSD installer commands`; `Record successful GSD install attempts without real npm in tests`; `Record partial GSD install failure and retry commands`; `Preview framework install replay from lock`; `Sync previews packages and generated outputs without writes`; `Sync applies outputs without running installers by default`; `Sync can explicitly run package installers`. | None. Covered by Node and PowerShell runners. | Done |

## BDD-04: Adapter Degradation Warnings And Strict Mode

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| covered | `test/integration/features/adapter-policy.feature`: `Adapter warnings appear in diagnostics and render previews`; `Strict adapter warnings fail before side effects`; `Adapter warnings stay out of lock manifests`. | None. Covered by Node and PowerShell runners. | Done |

## Cross-Runner Parity

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| covered | Node runner consumes split files through `test/integration/features/*.feature`. PowerShell runner consumes the same split files with feature-to-step dispatch and a non-Windows skip. | None. `npm test` remains unchanged; PowerShell parity is verified separately through `npm run test:integration:ps`. | Done |
