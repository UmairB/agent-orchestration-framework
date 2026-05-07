# Phase 2: Runtime Rendering And Lock State - Research

**Researched:** 2026-05-06T18:03:40+01:00
**Status:** Ready for planning

## Objective

Research how to implement Phase 2 well: render `.aof/` assets into Claude Code and Codex output folders, preserve dry-run behavior, treat runtime folders as generated output, and record reproducible lock state.

## Phase Scope

Phase 2 covers requirements REND-01, REND-02, REND-03, REND-04, FRAM-04, CLI-03, and CLI-04.

In scope:
- Shared render/action planning for `.aof/` assets targeting Claude and Codex.
- `.aof/aof.lock.json` as a generated manifest.
- Generated markers where format allows.
- Drift detection using prior lock hashes.
- Pruning stale, non-drifted files AOF owns.
- Dry-run output that uses the same analysis as real apply without side effects.
- Managed framework intent recorded in lock state only.

Out of scope:
- Full GSD install execution flow and install-result tracking.
- New runtime support beyond Claude Code and Codex.
- UI capability display or config editing.
- Codex `.codex/rules/*.rules` execution-policy assets.

## Existing Implementation

### Apply Flow

`src/cli.mjs` currently loads config via `findProjectConfig()` and `loadConfig()`, then calls `applyConfig(config, { targetDir, runtimes, global, dryRun })`. The CLI prints each returned write action as `{action}: {path}`.

The current flow has no concept of:
- Previous lock state.
- Ownership checks.
- Current file hash comparison.
- Stale-file pruning.
- Framework intent lock entries during `apply`.
- Differentiated action reasons.

### Rendering

`src/adapters.mjs` owns runtime-specific paths and content rendering. `applyConfig()` currently writes immediately by calling `writeRenderedResource()`, which calls `writeText()`.

Important current mappings:
- Claude/Codex skills: `skills/<id>/SKILL.md`
- Claude/Codex commands: `commands/<id>.md`
- Claude/Codex agents: `agents/<id>.md`
- Claude rules: `rules/<id>.md`
- Codex rules: `AGENTS.md` or nested `<path>/AGENTS.md`

Codex rule rendering currently writes one file per rule. If multiple rules target the same `AGENTS.md`, the current loop would overwrite earlier output. Phase 2 must replace this with deterministic grouping/merging before writes happen.

### Source Model

`src/dsl.mjs` resolves `.aof/aof.config.json`, loads file-backed asset bodies, and resolves conventional `overrides/<runtime>.json`. Runtime override merging happens through `mergeRuntimeOverride()` in `src/model.mjs`.

The `.aof/` config remains the input boundary. Generated `.claude/` and `.codex/` files should not be read as source assets.

### Filesystem Helpers

`src/fs.mjs` has `writeText(filePath, content, { dryRun })`, returning `{ path, action: "write" }` for dry-run and real writes. That is not enough for Phase 2 because dry-run must classify create/update/delete/skip/drift-warning using current file and lock state before writing.

Phase 2 should add read/hash/remove support and a render-plan layer rather than overloading `writeText()` with all apply semantics.

### Lock State

`writeInstallLock()` in `src/cli.mjs` writes a simple `.aof/aof.lock.json` during `init`. `migrate` writes a migration lock. `apply` does not write lock state today.

Phase 2 needs a lock module or equivalent helper responsible for:
- Reading absent or existing lock safely.
- Hashing generated content.
- Comparing previous lock entries to current filesystem content.
- Producing a new manifest on successful non-dry-run apply.
- Preserving useful legacy/migration fields only if needed or migrating shape intentionally.

### Framework Intent

`src/frameworks.mjs` currently defines GSD package metadata and installer command construction. Phase 2 should record intent only in lock state from config `packages`, without invoking installers or expanding Phase 3 behavior.

## Recommended Architecture

### Render Plan First

Introduce a render/action planning path:

1. Resolve config and requested runtimes.
2. Generate desired render outputs in memory:
   - runtime
   - source asset id
   - source asset kind
   - absolute path
   - relative runtime path or project-relative path
   - rendered content
   - content hash
3. Group outputs by destination path before action analysis.
4. Read prior lock entries.
5. Compare desired outputs, prior ownership, and current filesystem state.
6. Produce actions:
   - create
   - update
   - delete
   - skip
   - drift-warning
7. For real apply, execute non-dry-run actions and write a new lock only if no blocking drift remains.
8. For dry-run, print the same action plan and never write files, delete files, or update lock state.

This structure keeps dry-run and apply behavior aligned.

### Generated Markers

Generated files should include small markers where the output format allows it:
- Markdown/frontmatter files can include `aof-generated: true`, `aof-runtime`, and source identifiers in frontmatter.
- Codex merged `AGENTS.md` can include a visible generated-by comment or heading plus generated sections.

Lock entries remain authoritative for ownership, drift, and pruning.

### Lock Manifest Shape

Use a versioned manifest. Suggested shape:

```json
{
  "version": 2,
  "generatedAt": "2026-05-06T18:03:40.000Z",
  "runtimes": ["claude", "codex"],
  "files": [
    {
      "path": ".codex/skills/project-context/SKILL.md",
      "runtime": "codex",
      "resource": { "id": "project-context", "kind": "skill" },
      "hash": "sha256:...",
      "generatedAt": "2026-05-06T18:03:40.000Z"
    }
  ],
  "frameworks": [
    {
      "id": "gsd",
      "source": "npm:get-shit-done-cc@latest",
      "runtimes": ["claude", "codex"],
      "scope": "local",
      "intent": "managed"
    }
  ]
}
```

The exact field names can be adjusted during implementation, but plans must preserve the decisions from `02-CONTEXT.md`.

### Drift And Pruning

For each prior lock file entry:
- If the file path is still desired and current file hash differs from the prior hash, produce `drift-warning` and skip overwriting unless force is set.
- If the file path is no longer desired and current file hash matches the prior hash, produce `delete`.
- If the file path is no longer desired and current file hash differs, produce `skip` or `drift-warning`; do not delete by default.

For desired files without prior entries:
- If missing, create.
- If present, update or create depending on whether AOF chooses to treat unowned existing files as collisions. The conservative implementation should skip or warn for unowned existing files unless the content already matches. If this becomes too broad, executor should document the chosen behavior and keep it user-visible.

### Codex AGENTS.md Merge

Before action planning, group Codex `rule` resources by destination path. For each `AGENTS.md`, render deterministic sections sorted by asset id. Each section should be clearly labeled and include the rule body. This prevents later rules from overwriting earlier ones.

## Testing Strategy

BDD coverage is required for every new user-facing behavior.

Targeted unit tests:
- Render plan classifies create/update/delete/skip/drift-warning correctly.
- Lock read/write preserves generated file metadata and framework intent.
- Hash comparison detects drift.
- Codex rules targeting the same `AGENTS.md` merge in stable asset-id order.
- Dry-run returns the same action plan without writing lock/runtime files.

Integration scenarios:
- `aof apply --dry-run` prints action reasons and writes nothing.
- `aof apply` writes `.aof/aof.lock.json` with generated file entries.
- Manual edit of a previously generated file causes a warning and skip by default.
- Stale owned non-drifted files are pruned after asset removal or retargeting.
- Multiple Codex rules targeting the same `AGENTS.md` render as deterministic sections.
- Framework package declarations are recorded as lock intent during apply.

Verification commands:
- `npm run test:unit`
- `npm test`

## Planning Implications

Phase 2 should be split into three waves:

1. Render-plan and lock infrastructure, including hashes, merged desired outputs, generated markers, lock manifest shape, and unit tests.
2. CLI apply integration for drift handling, stale pruning, force behavior, dry-run action reporting, and BDD scenarios.
3. Framework intent lock entries, compatibility/docs polish, full verification, and roadmap/state updates.

The first wave should avoid broad CLI behavior changes until the action planner is unit-tested. The second wave should wire it into `aof apply` and preserve existing init/migrate behavior unless intentionally migrated. The third wave should close cross-cutting requirements and run the full suite.

---

## RESEARCH COMPLETE
