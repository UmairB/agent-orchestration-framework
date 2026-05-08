# Feature Research: Global Asset Library

## Table Stakes

### Global Asset Authoring

- User can create global skills, agents, and rules in `~/.aof`.
- Global assets use familiar AOF metadata, body files, runtime targets, runtime overrides, and validation rules.
- Global assets may include additional files under the asset directory, such as scripts, templates, examples, or helper modules.

### Project References

- Project `.aof` config can include references to global assets by stable ID.
- Referenced global assets are available to `aof apply`, `aof sync`, `aof validate`, `aof doctor`, and setup UI inspection.
- Local project assets remain editable in the project; global references remain owned by `~/.aof`.

### Rendering

- Applying a project renders referenced global assets into the selected runtime outputs alongside local project assets.
- Runtime-specific overrides on global assets participate in the same adapter behavior as local assets.
- Lock state records that an output came from a global reference so generated files remain auditable.

### UI Support

- Setup UI lets users switch between project assets and global assets.
- UI can create and edit global skills, agents, and rules in `~/.aof`.
- UI can add a global asset reference to the current project without copying source files.

### Code-Bearing Assets

- Global asset directories can contain associated files owned by the asset.
- Rendering preserves required associated files for runtimes that expect directory-shaped assets, especially skills.
- Validation catches missing body files, invalid overrides, and unsafe path escapes.

## Differentiators

- Explicit source distinction between project-local assets and user-global assets.
- Reference-first model with optional future vendoring, not immediate copy semantics.
- UI makes global library management visible instead of hiding it behind CLI-only commands.

## Anti-Features For This Milestone

- Hosted discovery or package marketplace.
- Cross-machine synchronization.
- Asset publishing.
- Versioned global registry semantics beyond enough lock metadata to make generated output auditable.

