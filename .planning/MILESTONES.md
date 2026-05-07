# Milestones: AOF

## v1 — Assistant Configuration Foundation

**Status:** Shipped 2026-05-07
**Phases:** 1-5
**Plans:** 15
**Requirements:** 32/32 complete
**Audit:** Passed

### Delivered

AOF now lets users define assistant-facing assets once in `.aof/`, render them to Claude Code and Codex, manage lock state and GSD install intent, edit configuration through the setup UI, and verify the full v1 behavior through unit, BDD, smoke, and UI build checks.

### Key Accomplishments

1. Established `.aof/` as the repo-local source of truth for configuration, source assets, runtime overrides, and lock state.
2. Added runtime rendering, dry-run planning, drift protection, stale pruning, deterministic Codex rule merging, and lock replay behavior.
3. Added automation-friendly CLI inspection/install flows plus interactive setup selection and GSD package intent handling.
4. Reworked the setup UI into a `.aof` configuration editor with runtime capability visibility and config-only execution boundaries.
5. Hardened diagnostics, setup UI request/static handling, cross-platform smoke coverage, and closeout verification.

### Archives

- [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- [v1-REQUIREMENTS.md](milestones/v1-REQUIREMENTS.md)
- [v1-MILESTONE-AUDIT.md](milestones/v1-MILESTONE-AUDIT.md)

### Known Deferred Items

None.
