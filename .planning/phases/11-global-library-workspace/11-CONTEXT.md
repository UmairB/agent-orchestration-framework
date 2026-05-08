# Phase 11: Global Library Workspace - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 11 establishes `~/.aof` as AOF's user-global source workspace and supports global asset creation, listing, inspection, and validation. This phase is limited to the global workspace shape, global manifest, explicit global CLI command surface, and validation behavior for global skills, agents, and rules.

This phase does not implement project references, rendering referenced global assets into project runtimes, code-bearing associated file rendering, or setup UI global editing. Those are Phase 12, Phase 13, and Phase 14 work.

</domain>

<decisions>
## Implementation Decisions

### Global Home Shape
- **D-01:** `~/.aof` mirrors the project workspace shape instead of using a separate global-only layout.
- **D-02:** The global source workspace should include `~/.aof/aof.config.json` and file-backed assets under `~/.aof/assets/<kind>/<id>/...`.
- **D-03:** Reuse existing project workspace conventions wherever practical so global assets do not require a second asset layout.

### CLI Command Shape
- **D-04:** Use explicit `aof global ...` commands for global source-library operations.
- **D-05:** Do not overload existing `--global` semantics for this phase because `--global` already means runtime-global output for commands such as `apply`, `sync`, and `install`.
- **D-06:** Expected command families include `aof global add`, `aof global list`, and `aof global validate`; the planner can choose exact subcommand details within this explicit namespace.

### Global Config Model
- **D-07:** `~/.aof/aof.config.json` is the canonical global asset manifest.
- **D-08:** Do not infer the authoritative global library purely from scanning `~/.aof/assets/...`.
- **D-09:** File discovery or repair workflows can be considered later, but Phase 11 should keep metadata, runtimes, overrides, and validation explicit through the manifest.

### Validation Behavior
- **D-10:** Project validation should fail only for malformed global assets that the project references.
- **D-11:** `aof global validate` is responsible for validating the whole global library.
- **D-12:** Unrelated broken drafts in `~/.aof` should not block unrelated project validation unless they are referenced by that project.

### the agent's Discretion
- Choose exact helper names, internal module boundaries, and command output wording as long as the decisions above and existing CLI/diagnostic conventions are preserved.
- Choose whether `aof global list` is implemented in Phase 11 as a narrow asset listing command or shares a reusable inspection payload with later project-reference diagnostics.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/PROJECT.md` - v1.2 milestone goal, user decisions, and active global asset requirements.
- `.planning/REQUIREMENTS.md` - Phase 11 requirements `GLIB-01` through `GLIB-04`.
- `.planning/ROADMAP.md` - Phase 11 goal, success criteria, and downstream phase boundaries.
- `.planning/STATE.md` - Current project state and accumulated workflow notes.

### Research
- `.planning/research/SUMMARY.md` - v1.2 research summary, stack additions, table stakes, and watch-outs.
- `.planning/research/ARCHITECTURE.md` - Suggested global workspace data flow and integration points.
- `.planning/research/PITFALLS.md` - Source-of-truth, ID collision, lock ambiguity, and validation risks.

### Prior Phase Decisions
- `.planning/phases/08-adapter-degradation-policy/08-CONTEXT.md` - Diagnostic and warning-surface conventions, including strict behavior and command-time warning policy.
- `.planning/phases/09-framework-package-semantics/09-CONTEXT.md` - Explicit namespace and lock/audit thinking that should inform global source ownership later.
- `.planning/phases/10-bdd-parity-and-hardening/10-CONTEXT.md` - BDD coverage and verification expectations carried into v1.2.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` - CLI dispatch, add/apply/sync/validate flows, module boundaries, and extension points.
- `.planning/codebase/INTEGRATIONS.md` - Existing local filesystem, catalog, framework, and setup UI integration boundaries.
- `.planning/codebase/STACK.md` - Node ESM stack, scripts, dependency boundaries, and UI workspace.

### Current Implementation
- `src/paths.mjs` - Existing OS app-data and catalog path helpers; global source workspace should be separate from these app-data paths.
- `test/paths.test.mjs` - Current path helper coverage to extend for `~/.aof` source workspace behavior.
- `src/scaffold.mjs` - Existing project `.aof/assets/...` asset creation flow likely reusable for `aof global add`.
- `src/workspace.mjs` - Existing project workspace path conventions to mirror for `~/.aof`.
- `src/config-inspect.mjs` - Existing validation/doctor behavior to extend for global library validation.
- `src/cli.mjs` - Command router and option parsing where `aof global ...` should integrate.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/workspace.mjs`: Already defines project `.aof` workspace paths and should guide the mirrored global workspace path shape.
- `src/scaffold.mjs`: Already creates file-backed assets under `.aof/assets/<kind>/<id>/...` and updates `aof.config.json`.
- `src/config-inspect.mjs`: Already validates file-backed assets and emits diagnostics in the style Phase 11 should preserve.
- `src/cli.mjs`: Existing command dispatch can add an explicit `global` command namespace without reusing `--global`.
- `src/paths.mjs`: Existing path helper module is the natural place for a new `~/.aof` source workspace helper, but it must stay distinct from OS-specific app data/catalog paths.

### Established Patterns
- Project source assets live in `.aof/`; generated runtime outputs live in `.claude/`, `.codex/`, or assistant home directories.
- CLI commands prefer explicit dry-run/diagnostic output and stable JSON where automation needs it.
- Unit tests export arrays of `{ name, run }`; BDD integration tests cover user-facing command behavior.
- Existing `--global` language is already used for runtime output scope, so source-library commands need clearer naming.

### Integration Points
- `aof global add` should connect to the existing file-backed asset scaffold path while targeting `~/.aof`.
- `aof global list` and `aof global validate` should read `~/.aof/aof.config.json` as the canonical manifest.
- Future Phase 12 project-reference resolution should be able to reuse the Phase 11 global workspace loader without changing the on-disk shape.
- Validation should distinguish whole-library validation from project-scoped referenced-asset validation.

</code_context>

<specifics>
## Specific Ideas

- The global library should feel like another AOF workspace rather than a runtime-specific assistant folder.
- The explicit command examples discussed were `aof global add`, `aof global list`, and `aof global validate`.
- Broken global drafts are acceptable as long as they do not block projects that do not reference them.

</specifics>

<deferred>
## Deferred Ideas

- Project references to global assets are Phase 12.
- Rendering referenced global assets into Claude Code and Codex outputs is Phase 12.
- Associated helper/code file rendering for global assets is Phase 13.
- Setup UI creation/editing for global assets is Phase 14.
- File-discovery repair/import of orphaned global asset folders is a possible future enhancement, not Phase 11 scope.

</deferred>

---

*Phase: 11-Global Library Workspace*
*Context gathered: 2026-05-08*
