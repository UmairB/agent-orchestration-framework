# State: AOF

**Initialized:** 2026-05-06
**Current milestone:** v1.2 Global Asset Library
**Current phase:** Phase 14 - Global Asset Setup UI
**Status:** Phase 13 complete

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-08 after Phase 13 completion)

**Core value:** Users can configure assistant skills, commands, agents, rules/instructions, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## Roadmap Reference

See: `.planning/ROADMAP.md`

## Milestone Reference

See: `.planning/MILESTONES.md`

## Current Focus

Phase 13 completed explicit associated files on code-bearing skill assets, validation, rendering, and lock traceability. Phase 14 is ready to discuss global asset creation and reference flows in the setup UI.

## Current Position

Phase: 14 - Global Asset Setup UI
Plan: Not started
Status: Ready for `$gsd-discuss-phase 14`
Last activity: 2026-05-08 - Phase 13 completed

## Resume

**Stopped at:** Phase 13 completed
**Resume file:** `.planning/phases/13-code-bearing-asset-files/13-VERIFICATION.md`

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
