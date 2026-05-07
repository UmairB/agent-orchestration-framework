---
last_mapped: 2026-05-07
focus: quality
---

# Conventions

## Language Style

- CLI source uses modern ESM JavaScript with explicit imports from `node:*` built-ins.
- UI source uses TypeScript and React function components.
- The codebase avoids classes except where stateful wrapping is useful, such as `Catalog` in `src/catalog.mjs`.
- Most functions are small and colocated with the command or module they serve.

## Module Style

- Public module functions are exported with named exports.
- Private helper functions are kept in the same module below the exported command functions.
- `src/cli.mjs` uses command-specific helper functions for routing/output, while reusable lifecycle planning is split into focused modules such as `src/scaffold.mjs`, `src/sync.mjs`, and `src/clean.mjs`.
- `src/catalog.mjs` encapsulates the database connection in a `Catalog` class returned by `openCatalog()`.

## Error Handling

- Expected user-facing failures throw `Error` with direct messages.
- `bin/aof.mjs` is the only top-level CLI catch point and prints the message.
- `src/fs.mjs` wraps JSON parse failures with the file path.
- Catalog migrations and seed operations are explicit and fail fast.
- The setup UI returns JSON error payloads for failed POST requests.

## Filesystem Pattern

- Use `src/fs.mjs` helpers for shared reads and writes.
- `writeText()` creates parent directories before writing.
- `writeText()` supports dry-run mode and returns action metadata without writing.
- Tests create temporary directories with `mkdtemp()` and clean them with `rm(..., { recursive: true, force: true })`.

## CLI Option Pattern

- `parseOptions()` in `src/cli.mjs` translates `--kebab-case` to camelCase.
- Boolean flags are listed explicitly.
- Value flags accept either `--key=value` or `--key value`.
- Positional arguments are stored in `options._`.

## Runtime Selection Pattern

- Runtime flags are parsed in `src/cli.mjs`.
- `supportedRuntimes()` in `src/adapters.mjs` is the source of supported adapter keys for apply-time defaults.
- DSL runtime validation is duplicated in `src/dsl.mjs`.
- Prompt runtime validation is duplicated in `src/prompt.mjs`.

## Catalog Pattern

- Built-ins are declared as data in `BUILTIN_ITEMS`.
- SQLite writes use prepared statements.
- Built-in seeding is idempotent with `ON CONFLICT(id) DO UPDATE`.
- `runtimes` are persisted as JSON text in `runtimes_json` and parsed on reads.

## Rendering Pattern

- `src/adapters.mjs` maps each resource kind to a target path.
- Rendered files include YAML-style frontmatter followed by the item body.
- Claude commands use `/` invocation prefixes.
- Codex commands use `$` invocation prefixes.
- Generated output writes and cleanup are lock-aware; drifted generated files are reported and preserved unless an explicit force path is used.

## UI Pattern

- UI primitives follow shadcn-style conventions.
- `cn()` from `ui/src/lib/utils.ts` is used to combine class names.
- `class-variance-authority` is used for button variants.
- Lucide icons are imported directly in `ui/src/main.tsx`.
- The setup UI currently keeps state local to `App`.

## Testing Pattern

- Unit tests export arrays of `{ name, run }` objects.
- `scripts/test-unit.mjs` imports those arrays and runs them manually.
- Integration tests are described in Gherkin-like text and interpreted by `test/integration/cli.mjs` or `test/integration/cli.ps1`.
- The Node integration runner can execute the CLI in process when `AOF_IN_PROCESS_INTEGRATION=1`.

## Documentation Pattern

- `README.md` is concise and usage-first.
- Config examples are shown as JSON.
- Test instructions include both Node and PowerShell runners.

## Current Consistency Issues

- `src/cli.mjs` contains `DEFAULT_CONFIG`, but `initCommand()` writes a different compact config shape; the constant appears unused.
- `src/dsl.mjs` validates only `skill`, `command`, and `agent` resources, while schema `packages` supports framework declarations separately.
- Setup UI supports only `skill` and `agent` creation, while catalog built-ins also include `command` and `framework`.
