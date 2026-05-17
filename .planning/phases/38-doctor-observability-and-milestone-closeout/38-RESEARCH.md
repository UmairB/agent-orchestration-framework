---
phase: 38
name: Doctor, Observability, And Milestone Closeout
status: complete
researched: 2026-05-17
requirements:
  - DIAG-01
  - DIAG-02
  - DIAG-03
  - DIAG-04
  - DIAG-06
  - MIG-01
---

# Phase 38 Research: Doctor, Observability, And Milestone Closeout

## Summary

Phase 38 should add a reporting layer over the SDK-backed board lifecycle rather than new lifecycle behavior. The main code seams are already present: `BoardLifecycleError` in `src/boards.mjs`, structured JSON handling in `src/cli.mjs`, SDK wrapping and tool path resolution in `src/gsd-sdk-adapter.mjs`, and additive lock helpers in `src/lock.mjs`.

## Current Surfaces

- `src/boards.mjs`
  - Owns board validation, attach/repair/sync, v1.6 milestone-id warnings, and typed lifecycle errors.
  - `validateBoardShape()` already emits `BOARD_MILESTONE_ID_MISSING` but the message uses `<milestone-id>` and is not a full doctor ladder.
  - `repairMissingMilestoneId()` already contains the safe inference rule: one milestone candidate plus default roadmap path or matching phase fingerprint.
- `src/cli.mjs`
  - `boards sync` and `boards repair` already catch structured errors for `--json`; several other board commands still throw directly.
  - Help text lists board commands but not `boards doctor`.
  - `project doctor` exists separately and should remain generic config/render health.
- `src/gsd-sdk-adapter.mjs`
  - Owns `@gsd-build/sdk` imports, `GsdSdkError`, dispatch logging, SDK version reporting, and lock-derived tools path resolution.
  - `wrapGsdError()` already maps missing tools to `GSD_TOOLS_MISSING`.
  - `parseMaybeJson()` does not strip BOM yet; Phase 38 can harden that boundary.
- `src/lock.mjs`
  - Lock writes are additive and tolerate extra fields. A `gsd` or `toolchain` object can be merged without schema churn.
- Tests
  - Unit tests use custom arrays and temp dirs.
  - BDD scenarios live in `test/integration/features/boards.feature`.
  - PowerShell parity in `test/integration/cli.ps1` must be updated for any new BDD steps.

## Implementation Shape

### Board Doctor

Add a function such as `doctorBoards(projectDir, options = {})` that returns:

```json
{
  "ok": false,
  "checks": [
    {
      "code": "BOARD_MILESTONE_ID_MISSING",
      "status": "warn",
      "boardId": "delivery",
      "message": "...",
      "next": "aof boards milestone attach delivery --milestone v1.7 --roadmap .planning/ROADMAP.md"
    }
  ]
}
```

Use stable `status` values: `pass`, `warn`, `fail`.

Doctor should cover:

- Board files are readable and structurally valid.
- GSD state can be loaded.
- GSD-backed boards have milestone ids.
- Bound milestone id matches current GSD state.
- Roadmap can be analyzed and has phases.
- Board tasks are consistent with cached roadmap phases after sync.
- SDK/tools metadata and version drift checks.
- Windows environment checks.

### Migration Diagnostic

For v1.6 boards, reuse the repair inference logic without writing. If inference is safe, fill the exact milestone id in the `next` command. If not, emit the same code with `<milestone-id>`.

### Toolchain Metadata

Expose an adapter-owned function such as `inspectGsdToolchain(projectDir, options = {})`:

- bundled SDK version from `gsdSdkVersion().installed`
- resolved tools path from lock/default resolution
- tools version from a best-effort `gsd-sdk --version`/`tools.execRaw("version")` style probe, or `unknown` with warning if the local SDK does not expose it
- diagnostics: `SDK_VERSION_DRIFT`, `GSD_TOOLS_MISSING`

Record metadata additively in `.aof/aof.lock.json`, for example:

```json
{
  "gsd": {
    "sdkVersion": "0.1.0",
    "toolsPath": "...",
    "toolsVersion": "..."
  }
}
```

Preserve existing lock fields.

### Windows Checks

Keep checks non-destructive:

- node on PATH: use `process.env.PATH` plus `spawnSync("node", ["--version"])` or equivalent.
- UNC path: warn when `projectDir` starts with `\\\\`.
- BOM: strip BOM at adapter JSON parse boundary and add doctor warning when relevant `.planning/STATE.md` or `ROADMAP.md` starts with BOM.

### JSON Parity

Audit board commands introduced or modified across v1.7:

- `boards sync`
- `boards milestone attach/status/answer`
- `boards repair`
- `boards task assign`
- `boards execution show/update`
- `boards doctor`

When a typed error is caught under `--json`, emit `{ ok: false, code, message, expected?, actual?, next? }` and set `process.exitCode = 1`.

## Risks

- Doctor can easily become a second sync implementation. Mitigation: compose existing adapter/backend helpers and keep doctor read-only.
- Tool version detection may be flaky across GSD installations. Mitigation: best-effort warning with stable `unknown` values, not command failure unless tools are missing.
- JSON parity can grow into broad CLI framework work. Mitigation: sweep board/GSD commands only.
- Lock metadata writes can accidentally drop generated-file lock state. Mitigation: read existing lock, shallow merge additive `gsd` metadata, and unit-test preservation.

## Verification Plan

- `node scripts/supply-chain-audit.mjs`
- `node scripts/check-sdk-boundary.mjs`
- `npm run test:unit`
- `npm run test:integration:sdk-contract`
- `npm test`
- `npm run test:integration:ps`

`npm run ui:build` is not required unless implementation touches `ui/`.
