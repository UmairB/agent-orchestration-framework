# Requirements: AOF

**Defined:** 2026-05-08
**Milestone:** v1.2 Global Asset Library
**Core Value:** Users can configure assistant skills, commands, agents, rules/instructions, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## v1.2 Requirements

### Global Library

- [ ] **GLIB-01**: User can initialize or access a global AOF library at `~/.aof`.
- [ ] **GLIB-02**: User can create global skills, agents, and rules in `~/.aof`.
- [ ] **GLIB-03**: User can list and inspect global assets independently from project-local assets.
- [ ] **GLIB-04**: User receives clear validation errors when a global asset is malformed or missing required files.

### Project References

- [ ] **GREF-01**: User can reference global assets by ID from a project `.aof` config without copying the asset into the project.
- [ ] **GREF-02**: User receives clear validation errors when a project references a missing global asset.
- [ ] **GREF-03**: AOF detects local/global asset ID conflicts and requires an explicit resolution rather than silently choosing one.
- [ ] **GREF-04**: Project diagnostics show whether each rendered asset came from project-local source or the global library.

### Rendering And Lock State

- [ ] **GRND-01**: `aof apply` renders referenced global assets into Claude Code and Codex outputs alongside local project assets.
- [ ] **GRND-02**: `aof sync` includes referenced global assets in validation, warning analysis, and render planning.
- [ ] **GRND-03**: Lock state records global asset source scope for generated outputs.
- [ ] **GRND-04**: Runtime overrides on global assets are honored during rendering.

### Code-Bearing Assets

- [ ] **CODE-01**: Global assets can own associated files under their asset directory.
- [ ] **CODE-02**: Rendering preserves associated files for runtime asset shapes that require directories, such as skills with helper scripts.
- [ ] **CODE-03**: Validation rejects associated files that escape the asset directory or would overwrite unrelated generated output.

### Setup UI

- [ ] **GUI-01**: User can switch the setup UI between project asset editing and global asset editing.
- [ ] **GUI-02**: User can create and edit global skills, agents, and rules through the setup UI.
- [ ] **GUI-03**: User can add a global asset reference to the current project through the setup UI without copying the global asset.
- [ ] **GUI-04**: Setup UI clearly labels asset source scope so users do not confuse global edits with project-local edits.

### Verification

- [ ] **TEST-01**: Unit tests cover global library path resolution, reference resolution, conflict handling, associated files, and lock metadata.
- [ ] **TEST-02**: BDD integration tests cover CLI global asset creation, project reference rendering, missing-reference diagnostics, and UI API behavior.
- [ ] **TEST-03**: UI build passes after global asset management changes.

## Future Requirements

### Distribution

- **DIST-01**: User can publish or discover hosted global asset packages.
- **DIST-02**: User can synchronize global assets across machines.
- **DIST-03**: User can vendor a global asset into project `.aof` as an explicit snapshot workflow.

### Versioning

- **VERS-01**: User can pin global asset references to semantic versions.
- **VERS-02**: User can upgrade project references from one global asset version to another.

### Runtime Expansion

- **RTME-01**: Global assets can target additional assistant runtimes beyond Claude Code and Codex.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Hosted package discovery or publishing | Requires registry semantics beyond local global reuse. |
| Cross-machine synchronization of `~/.aof` | Requires account, sync, or external storage decisions not needed for local reuse. |
| Vendoring/copying global assets into project `.aof` as the default workflow | User selected reference-first behavior; copies create source-of-truth confusion. |
| Full semantic versioning for global assets | Useful later, but v1.2 only needs enough source metadata for auditability. |
| Runtime support beyond Claude Code and Codex | Current v1 runtime boundary remains intact. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GLIB-01 | Phase 11 | Pending |
| GLIB-02 | Phase 11 | Pending |
| GLIB-03 | Phase 11 | Pending |
| GLIB-04 | Phase 11 | Pending |
| GREF-01 | Phase 12 | Pending |
| GREF-02 | Phase 12 | Pending |
| GREF-03 | Phase 12 | Pending |
| GREF-04 | Phase 12 | Pending |
| GRND-01 | Phase 12 | Pending |
| GRND-02 | Phase 12 | Pending |
| GRND-03 | Phase 12 | Pending |
| GRND-04 | Phase 12 | Pending |
| CODE-01 | Phase 13 | Pending |
| CODE-02 | Phase 13 | Pending |
| CODE-03 | Phase 13 | Pending |
| GUI-01 | Phase 14 | Pending |
| GUI-02 | Phase 14 | Pending |
| GUI-03 | Phase 14 | Pending |
| GUI-04 | Phase 14 | Pending |
| TEST-01 | Phase 15 | Pending |
| TEST-02 | Phase 15 | Pending |
| TEST-03 | Phase 15 | Pending |

**Coverage:**
- v1.2 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-05-08*
*Last updated: 2026-05-08 after v1.2 requirements definition*
