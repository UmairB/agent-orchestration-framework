---
phase: 23
plan: 1
type: summary
wave: 1
name: "Shared capability and validation contract"
status: complete
completed: 2026-05-12
---

# Phase 23 Wave 1 Summary: Shared Capability And Validation Contract

## Completed

- Updated the central runtime capability matrix so `command.codex` is `unsupportedFail` while Claude commands remain native.
- Added config validation for unsupported runtime/resource combinations, including implicit Codex command targeting when `runtimes` is omitted.
- Added simple asset argument validation for explicit argument-like fields and body markers such as `$ARGUMENTS`, `{{GSD_ARGS}}`, `argument-hint`, and `{{args.*}}`.
- Aligned setup UI save validation and capability payloads with the same command/Codex rejection contract.
- Added focused unit coverage for the capability matrix, project/global config validation, and setup UI validation paths.

## Requirements

- RTS-01, RTS-02, RTS-03, RTS-04: covered.
- SIMPLE-01, SIMPLE-02, SIMPLE-03: covered.

## Verification

- `npm run test:unit` passed.
- `npm test` passed.
- `npm run test:integration:ps` passed after PowerShell fixture runtime arrays were pinned as JSON arrays.
