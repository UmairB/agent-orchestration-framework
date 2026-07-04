---
doc: research
---
# 34 · Global Mesh Work Store — Research Notes

## Store Engine Comparison

### SQLite

Pros:
- Strong fit for cross-workspace querying, joins, filtering, and UI pagination.
- File-level durability and transaction boundaries are better than hand-rolled JSON mutation.
- Natural place for schema versioning and idempotent upserts.

Risks:
- The project currently has no SQLite npm dependency. Adding one would violate the supply-chain preference
  unless explicitly justified and audited.
- A packaged binary must ship whatever SQLite runtime it depends on.
- Operators need a rebuild path for corruption or schema mistakes.

Decision carried into architecture: SQLite is acceptable only as a rebuildable projection and only through a
no-new-dependency runtime path. It does not become the canonical work source.

### JSON / JSONL Projection

Pros:
- Simple, inspectable, no runtime dependency.
- Easy to rebuild and diff.

Risks:
- Cross-workspace query and concurrent writes get ad hoc quickly.
- Locking and partial-write handling become application code.
- UI filtering may require reading many files for every request.

Conclusion: keep JSON as the operator-readable descriptor layer, not the main query index.

## Source Findings

- `workspace.mjs` already owns global AOF path geometry through `globalWorkspacePaths()`.
- `paths.mjs` already supports `AOF_GLOBAL_HOME`, so tests and operators can relocate global state.
- `mesh-ui-serve.mjs` is a focused serve face with one CLI dependent; it is a reasonable place to flip
  default scope as long as data access moves behind a query surface.
- `work.mjs` is the shared work-stream read surface. Snapshot generation should reuse `listItems()` and
  record-doc parsing rather than re-globbing.
- `loadWorkspace()` already returns `aofDir`, `workDir`, `projectRoot`, and hydrated mesh config. That is
  enough context for a propagation publisher to decide whether and what to publish.

## Open Research Items For Build

- Confirm whether the packaged runtime exposes a supported SQLite module on every target platform.
- Confirm expected write concurrency when two workspaces publish simultaneously on Windows.
- Define the exact workspace id: absolute path hash, config name + path, or explicit persisted id.
