# Research Summary: Global Asset Library

## Stack Additions

- Add `~/.aof` as AOF's user-global source asset workspace.
- Reuse the existing file-backed asset model, config editor, validation, adapter, and render-plan paths where possible.
- Add a resolver layer that reads project-local config plus referenced global assets before diagnostics and rendering.

## Feature Table Stakes

- Users can create global skills, agents, and rules.
- Projects can reference global asset IDs without copying source files into project `.aof`.
- Apply/sync renders referenced global assets into Claude Code and Codex outputs.
- Setup UI supports creating and editing global assets and adding references to project configs.
- Assets can own associated files such as helper scripts.

## Watch Out For

- Keep source ownership explicit: global assets live in `~/.aof`; project assets live in project `.aof`.
- Treat local/global ID collisions and missing global references as validation problems.
- Preserve associated files for code-bearing assets.
- Record global source scope in lock output for auditability.
- Avoid hosted registry, publishing, cross-machine sync, and full versioning in this milestone.

