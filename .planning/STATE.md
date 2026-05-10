# State: AOF

**Initialized:** 2026-05-06
**Current milestone:** v1.4 Namespaced CLI Contract
**Current phase:** Phase 19: Assets Namespace Rewrite
**Status:** Ready to execute phase

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-10 after v1.4 start)

**Core value:** Users can configure assistant skills, commands, agents, rules/instructions, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## Roadmap Reference

See: `.planning/ROADMAP.md`

## Milestone Reference

See: `.planning/MILESTONES.md`

## Current Focus

v1.4 is focused on a full CLI rewrite around durable namespaces. Phase 19 is planned for a full assets namespace migration with no legacy aliases.

## Current Position

Phase: 19 - Assets Namespace Rewrite
Plan: 3 plans
Status: Ready to execute
Last activity: 2026-05-10 - Phase 19 planned

## Resume

**Stopped at:** Phase 19 planned
**Resume file:** `.planning/phases/19-assets-namespace-rewrite/19-03-PLAN.md`

## Memory

- Existing codebase map is available in `.planning/codebase/`.
- GSD researcher and roadmapper subagent types were not installed in this runtime, so initialization research and roadmap creation were performed inline.
- User selected YOLO mode, standard granularity, parallel execution, git-tracked docs, research enabled, plan check enabled, verifier enabled, and balanced model profile.
- UI v1 is intentionally config editing only; CLI remains responsible for execution.
- Phase 1 context is captured in `.planning/phases/01-aof-workspace-model/01-CONTEXT.md`.
- Phase 1 planning produced 3 plans in `.planning/phases/01-aof-workspace-model/`.
- Phase 1 execution completed and passed verification in `.planning/phases/01-aof-workspace-model/01-VERIFICATION.md`.
- Global decision: BDD tests are required for all new functionality.
- Phase 2 context is captured in `.planning/phases/02-runtime-rendering-and-lock-state/02-CONTEXT.md`.
- Phase 2 research is captured in `.planning/phases/02-runtime-rendering-and-lock-state/02-RESEARCH.md`.
- Phase 2 planning produced 3 plans in `.planning/phases/02-runtime-rendering-and-lock-state/`.
- Phase 2 execution completed and passed verification in `.planning/phases/02-runtime-rendering-and-lock-state/02-VERIFICATION.md`.
- Phase 3 context is captured in `.planning/phases/03-cli-and-gsd-framework-flow/03-CONTEXT.md`.
- Phase 3 research is captured in `.planning/phases/03-cli-and-gsd-framework-flow/03-RESEARCH.md`.
- Phase 3 planning produced 3 plans in `.planning/phases/03-cli-and-gsd-framework-flow/`.
- Phase 3 execution completed and passed verification in `.planning/phases/03-cli-and-gsd-framework-flow/03-VERIFICATION.md`.
- Phase 4 context is captured in `.planning/phases/04-ui-configuration-editor/04-CONTEXT.md`.
- Phase 4 research is captured in `.planning/phases/04-ui-configuration-editor/04-RESEARCH.md`.
- Phase 4 planning produced 3 plans in `.planning/phases/04-ui-configuration-editor/`.
- Phase 4 execution completed and passed verification in `.planning/phases/04-ui-configuration-editor/04-VERIFICATION.md`.
- Phase 5 context is captured in `.planning/phases/05-verification-and-hardening/05-CONTEXT.md`.
- Phase 5 research is captured in `.planning/phases/05-verification-and-hardening/05-RESEARCH.md`.
- Phase 5 planning produced 3 plans in `.planning/phases/05-verification-and-hardening/`.
- Phase 5 execution completed and passed verification in `.planning/phases/05-verification-and-hardening/05-VERIFICATION.md`.
- Milestone v1 audit is archived in `.planning/milestones/v1-MILESTONE-AUDIT.md`; it finds no critical product gaps.
- Milestone v1 roadmap and requirements are archived in `.planning/milestones/`; live roadmap is collapsed for constant-size planning context.
- Milestone v1.1 was derived from `C:\Users\Umair\Downloads\architecture-design-vendor-neutral-coding-assistant-dsl.html`.
- Useful architecture deltas selected for v1.1: CLI lifecycle commands, expanded `.aof/` primitives, adapter degradation policy, framework package semantics, and BDD hardening.
- Deferred from v1.1: broad runtime expansion, Rust migration, UI execution, hosted registry, and task management.
- The local `gsd-sdk` binary does not expose the `query` subcommands referenced by the installed GSD workflow, so v1.1 planning files were updated manually.
- Phase 6 context is captured in `.planning/phases/06-cli-lifecycle-commands/06-CONTEXT.md`.
- Phase 6 research is captured in `.planning/phases/06-cli-lifecycle-commands/06-RESEARCH.md`.
- Phase 6 planning produced 3 plans in `.planning/phases/06-cli-lifecycle-commands/`.
- Phase 6 execution completed with commits for diagnostics/help, scaffold, and sync/clean lifecycle commands.
- Phase 6 verification is captured in `.planning/phases/06-cli-lifecycle-commands/06-VERIFICATION.md`; `npm run test:unit` and `npm test` passed.
- Phase 7 planning proceeded without a CONTEXT.md because the user explicitly invoked `$gsd-plan-phase 7` after the discussion prompt.
- Phase 7 research is captured in `.planning/phases/07-expanded-dsl-primitives/07-RESEARCH.md`.
- Phase 7 planning produced 3 plans in `.planning/phases/07-expanded-dsl-primitives/`.
- Phase 7 execution completed with commits for DSL model validation, runtime rendering, and UI/docs editing surfaces.
- Phase 7 verification is captured in `.planning/phases/07-expanded-dsl-primitives/07-VERIFICATION.md`; `npm run test:unit`, `npm run ui:build`, and `npm test` passed.
- Phase 8 context is captured in `.planning/phases/08-adapter-degradation-policy/08-CONTEXT.md`.
- Phase 8 discussion locked decisions for adapter warning surfaces, strict-mode pre-write gates, mapped/lossy/unsupported classification, and warning detail/JSON shape.
- Phase 8 research is captured in `.planning/phases/08-adapter-degradation-policy/08-RESEARCH.md`.
- Phase 8 planning produced 3 plans in `.planning/phases/08-adapter-degradation-policy/`.
- Phase 8 execution completed with commits for the shared adapter warning analyzer, CLI warning/strict gates, and UI/docs review surfaces.
- Phase 8 verification is captured in `.planning/phases/08-adapter-degradation-policy/08-VERIFICATION.md`; `npm run test:unit`, `npm run ui:build`, and `npm test` passed.
- Phase 9 context is captured in `.planning/phases/09-framework-package-semantics/09-CONTEXT.md`.
- Phase 9 discussion locked decisions for compatible package descriptor normalization, explicit package namespaces, direct resolved package lock metadata, and pre-write conflict failures with known safe merge exceptions only.
- Phase 9 research is captured in `.planning/phases/09-framework-package-semantics/09-RESEARCH.md`.
- Phase 9 planning produced 3 plans in `.planning/phases/09-framework-package-semantics/`.
- Phase 9 execution completed with commits for package descriptor normalization, package lock/install metadata, and package output conflict gates.
- Phase 9 verification is captured in `.planning/phases/09-framework-package-semantics/09-VERIFICATION.md`; `npm run test:unit` and `npm test` passed. UI build was not needed because no UI files changed.
- Phase 10 context is captured in `.planning/phases/10-bdd-parity-and-hardening/10-CONTEXT.md`.
- Phase 10 discussion locked decisions for a phase-local BDD coverage matrix, split domain feature files with per-feature step modules, setup UI API BDD over real HTTP, and PowerShell integration as a separate required verification command.
- Phase 10 research is captured in `.planning/phases/10-bdd-parity-and-hardening/10-RESEARCH.md`.
- Phase 10 planning produced 4 plans in `.planning/phases/10-bdd-parity-and-hardening/`.
- Phase 10 execution completed with commits for the shared BDD runner, split domain features, setup UI HTTP API BDD, and PowerShell parity over the shared feature suite.
- Phase 10 verification is captured in `.planning/phases/10-bdd-parity-and-hardening/10-VERIFICATION.md`; `npm run test:unit`, `npm test`, and `npm run test:integration:ps` passed.
- Milestone v1.1 archive is captured in `.planning/milestones/v1.1-ROADMAP.md`, `.planning/milestones/v1.1-REQUIREMENTS.md`, and `.planning/milestones/v1.1-MILESTONE-AUDIT.md`.
- Accepted process debt at v1.1 closeout: Nyquist validation artifacts were not generated for phases 6-10.
- Milestone v1.2 started on 2026-05-08 as Global Asset Library.
- v1.2 user decisions: global assets live under `~/.aof`; project `.aof` configs reference global asset IDs rather than copying global assets into project workspaces; setup UI must support creating global assets; global assets may include associated files or helper code such as Python scripts.
- v1.2 roadmap uses phases 11-15: Global Library Workspace, Project Reference Rendering, Code-Bearing Asset Files, Global Asset Setup UI, and Global Asset Verification.
- Phase 11 discussion locked decisions: `~/.aof` mirrors project workspace shape with `aof.config.json`; use explicit `aof global ...` commands; global config is canonical; project validation fails only for referenced malformed global assets while `aof global validate` checks the whole library.
- Phase 11 planning produced 3 plans: 11-01 global workspace path and manifest foundation, 11-02 global CLI asset operations, and 11-03 global validation and hardening.
- Phase 11 execution completed with global workspace path helpers, `aof global add/list/show/validate`, global validation coverage, README updates, and completion artifacts; `npm run test:unit` and `npm test` passed.
- Phase 12 discussion locked decisions: project configs use top-level `globalRefs` entries shaped as `{ kind, id }`; global assets own body and runtime overrides; missing refs, duplicate refs, and local/global `kind:id` conflicts are validation errors; only referenced global assets affect project validation; render planning and lock state must preserve global source scope.
- Phase 12 planning produced 3 plans: 12-01 global reference model and validation, 12-02 apply and sync global reference rendering, and 12-03 global reference diagnostics and lock traceability.
- Phase 12 execution completed with `globalRefs` schema/model support, referenced global validation, apply/sync rendering, runtime override handling, config diagnostics, lock source scope, README updates, and completion artifacts; `npm run test:unit` and `npm test` passed.
- Phase 13 discussion locked decisions: associated files are explicit `files` entries relative to the asset directory; Phase 13 renders associated files for skill resources; unsafe paths, missing files, directories, symlink escapes, and primary-body duplication are validation errors; associated files must flow through render planning, drift protection, and lock source metadata.
- Phase 13 planning produced 3 plans: 13-01 associated file model and validation, 13-02 associated file rendering and lock ownership, and 13-03 associated file BDD docs and phase hardening.
- Phase 13 execution completed with resource `files` schema/model support, explicit associated-file validation, skill helper rendering, drift/lock ownership, README updates, BDD coverage, and verification in `.planning/phases/13-code-bearing-asset-files/13-VERIFICATION.md`; `npm run test:unit` and `npm test` passed.
- Phase 14 discussion locked decisions: setup UI uses an explicit Project / Global toggle; global scope edits `~/.aof`; Phase 14 supports global skills, agents, and rules; Global view can add `globalRefs` to the current project without copying; Project view shows referenced globals read-only with remove-reference support; global skill associated files get basic explicit text editing; setup UI APIs must encode explicit scope and return structured diagnostics.
- Phase 14 planning produced 3 plans: 14-01 scoped setup UI config API, 14-02 project global reference API and UI, and 14-03 setup UI BDD docs and phase hardening.
- Phase 14 execution completed with scoped setup UI APIs, global resource saves, global skill associated-file editing, project `globalRefs` add/remove APIs, Project/Global UI switching, read-only referenced global display, README updates, BDD coverage, and verification in `.planning/phases/14-global-asset-setup-ui/14-VERIFICATION.md`; `npm run test:unit`, `npm run ui:build`, and `npm test` passed.
- Phase 15 discussion locked decisions: verify the full v1.2 global asset slice; require `npm run test:unit`, `npm run ui:build`, `npm test`, and Windows PowerShell integration; produce a requirement coverage matrix; add code only for concrete verification gaps; create v1.2 milestone audit and archive snapshots; keep hosted distribution, sync, versioning, vendoring, runtime expansion, and UI execution deferred.
- Phase 15 planning produced 3 plans: 15-01 global asset coverage audit, 15-02 cross-runner verification and hardening, and 15-03 milestone audit and archive.
- Phase 15 execution completed with full v1.2 coverage matrix, PowerShell BDD runner parity for global/setup UI scenarios, passing unit/UI build/Node BDD/PowerShell checks, and v1.2 archive/audit artifacts.
- Phase 16 direction: harden AOF by testing against a live repository. Start with safe read-only/dry-run diagnostics, prefer disposable copy/worktree for write tests, and convert concrete findings into fixes and regression coverage.
- Phase 16 live test finding: `aof init --codex` still used an experimental SQLite catalog and built-in repo defaults (`project-context`, `prime`, `code-reviewer`, `gsd`). User decided to remove SQLite/default repo catalog behavior for now; project and global assets are the active source model.
- Phase 17 proposed: replace typed readline prompts with a real interactive CLI using arrow-key navigation, checkbox toggles, and Enter confirmation without reintroducing repo defaults.
- Phase 17 wave 1 added `@inquirer/prompts` and replaced the prompt wrapper with checkbox/confirm prompts while preserving env-driven BDD inputs.
- Phase 17 wave 2 added no-argument `aof add` and `aof global add` interactive asset creation flows for project/global assets, with deterministic BDD prompt input and no SQLite/default catalog behavior.
- v1.3 Interactive CLI Hardening shipped on 2026-05-09 with Phase 16 and Phase 17 complete. `aof install --interactive`, hosted catalog behavior, and further live-repo hardening are deferred to future milestones.
- Milestone v1.4 started on 2026-05-10 as Namespaced CLI Contract.
- v1.4 user decisions: review every CLI command and subcommand; perform a full rewrite with no legacy aliases; use product-area namespaces so AOF can grow beyond assets; keep `aof init` top-level; use `aof assets ...` for skills, commands, rules, agents, apply, validate, clean, global asset scope, and UI; use `aof packages add gsd` for managed package intent and `aof packages install gsd` for installer execution.
- Phase 18 starts with command-by-command contract review before any implementation.
- Phase 18 discussion accepted the full command-contract draft: use `aof project ...` for project diagnostics/migration, `--global` as an assets scope flag, remove `sync`, remove all legacy aliases, and allow helpful failures for removed commands without executing them.
- Phase 18 planning produced three waves: 18-01 current command inventory, 18-02 replacement CLI contract, and 18-03 help/errors/BDD contract. Research was skipped because the command contract was already locked in discussion.
- Phase 18 execution completed contract artifacts only: current command inventory, replacement CLI contract, BDD contract, wave summaries, and verification. No CLI implementation changed in Phase 18.
- Phase 19 discussion confirmed full assets namespace migration in one pass: implement all `aof assets ...` commands, remove old asset-related top-level execution paths, preserve rendering/lock/drift/global-ref behavior, and do not ship legacy aliases.
- Phase 19 planning produced three waves: 19-01 assets source command namespace, 19-02 assets apply/validate/clean/UI migration, and 19-03 help/docs/parity hardening. Research was skipped because Phase 18 already locked the command contract and Phase 19 is codebase-local implementation planning.
