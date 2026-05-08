# Pitfalls Research: Global Asset Library

## Source-Of-Truth Confusion

If project configs silently copy global assets into `.aof/`, users will not know whether edits should be made globally or locally. v1.2 should keep reference semantics explicit and show source scope in CLI/UI output.

## ID Collisions

Local and global assets can share IDs. AOF needs deterministic precedence or an explicit conflict error. For v1.2, conflict errors are safer unless the project reference syntax makes the selected source unambiguous.

## Untracked Code Files

Skills and agents may depend on helper scripts. Rendering only the markdown body can create broken runtime assets. The file model needs to preserve associated files under the owning asset directory where runtime semantics support it.

## Lock Ambiguity

Generated files should record whether they came from local project assets or global references. Otherwise users cannot audit why a runtime file changed after editing `~/.aof`.

## UI Scope Mistakes

The setup UI must make project vs global editing visually and behaviorally clear. A user should not accidentally edit a global asset while intending to create a project-specific variant.

## Portability Expectations

Project configs with global references are not fully self-contained. Validate/doctor should explain missing global assets clearly and suggest creating the asset or removing the reference.

