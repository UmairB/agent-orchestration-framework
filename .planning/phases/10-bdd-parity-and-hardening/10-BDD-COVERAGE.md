# Phase 10 BDD Coverage Matrix

**Status:** Initial matrix created in Wave 1. Scenario evidence currently references the pre-split `test/integration/cli.feature`; later waves must update paths to split domain feature files.

## BDD-01: CLI Lifecycle Behavior

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| partial | `Show command help`; `Install AOF and create the catalog database`; `Initialize a repository from selected catalog items`; `Refuse to overwrite an existing project config`; `Add a file-backed skill from the CLI`; `Add refuses scaffold collisions unless forced`; `Add scaffolds non-skill kinds`; `Refuse to silently migrate a legacy root config during init`; `Explicitly migrate a legacy root config into .aof`; `Preview apply without writing runtime files or lock state`; `Show config inspection in human and JSON formats`; `Validate invalid config for automation`; `Doctor reports package intent and stale legacy config`; `Sync previews packages and generated outputs without writes`; `Sync applies outputs without running installers by default`; `Clean previews and removes matching lock-owned outputs`; `Clean preserves drifted lock-owned outputs`; `List the catalog database`; `Initialize default catalog items`; `Initialize selected catalog items into Codex`; `Preview selected catalog installs without writing files`; `Interactively select catalog items`; `Guided interactive install asks before side effects` | Split lifecycle scenarios into `lifecycle.feature`; add or confirm happy/error coverage for init, add, sync, validate, doctor, and clean after split. | Wave 2 |

## BDD-02: v1.1 Primitive Compile/Render Behavior

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| partial | `Apply the project config to Codex only`; `Apply file-backed .aof assets`; `Apply expanded DSL primitives`; `Preview expanded DSL primitives before applying`; `Apply runtime override for a file-backed asset`; `Reject runtime override identity changes`; `Render natural-language rule guidance per runtime`; `Merge multiple Codex rules into one AGENTS file` | Split DSL scenarios into `dsl.feature`; add setup UI API BDD in `setup-ui.feature`; confirm MCP, hooks, project docs, settings, resources, rules, and runtime overrides have scenario-level evidence. | Waves 2-3 |

## BDD-03: Framework Package Behavior

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| partial | `Record managed framework intent in apply lock state`; `Refuse package resource output conflicts before writes`; `Preview config-declared GSD installer commands`; `Record successful GSD install attempts without real npm in tests`; `Record partial GSD install failure and retry commands`; `Preview framework install replay from lock`; `Sync previews packages and generated outputs without writes`; `Sync applies outputs without running installers by default`; `Sync can explicitly run package installers` | Split package scenarios into `packages.feature`; add scenario evidence for npm/git/file package descriptors and dependency/resolution lock metadata if missing. | Wave 2 |

## BDD-04: Adapter Degradation Warnings And Strict Mode

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| partial | `Adapter warnings appear in diagnostics and render previews`; `Strict adapter warnings fail before side effects` | Split adapter scenarios into `adapter-policy.feature`; ensure strict-mode coverage proves no generated files, lock writes, or installers occur before failure; ensure warnings stay out of lock manifests if not already scenario-backed. | Wave 2 |

## Cross-Runner Parity

| Status | Scenario Evidence | Gap To Close | Planned Wave |
|--------|-------------------|--------------|--------------|
| partial | Node runner consumes `test/integration/cli.feature`; PowerShell runner consumes `test/integration/cli.feature` | Update both runners to consume shared split feature files; make PowerShell verification a separate required command with clean non-Windows skip behavior. | Wave 3 |
