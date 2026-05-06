# State: AOF

**Initialized:** 2026-05-06
**Current phase:** Phase 1 - `.aof` Workspace Model
**Status:** Ready for phase planning

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-06)

**Core value:** Users can configure assistant skills, commands, agents, rules/instructions, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## Roadmap Reference

See: `.planning/ROADMAP.md`

## Current Focus

Phase 1 establishes `.aof/` as the source of truth for configuration, source assets, runtime targeting, and runtime override data.

## Memory

- Existing codebase map is available in `.planning/codebase/`.
- GSD researcher and roadmapper subagent types were not installed in this runtime, so initialization research and roadmap creation were performed inline.
- User selected YOLO mode, standard granularity, parallel execution, git-tracked docs, research enabled, plan check enabled, verifier enabled, and balanced model profile.
- UI v1 is intentionally config editing only; CLI remains responsible for execution.
