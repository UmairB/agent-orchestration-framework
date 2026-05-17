---
phase: "38"
plan: "38-02"
subsystem: "gsd-toolchain-observability"
tags:
  - sdk
  - diagnostics
  - lock-state
  - windows
key-files:
  - src/gsd-sdk-adapter.mjs
  - src/boards.mjs
  - src/lock.mjs
  - test/gsd-sdk-adapter.test.mjs
  - test/render-plan.test.mjs
metrics:
  tests: "npm run test:unit; npm test; node scripts/check-sdk-boundary.mjs"
---

# Summary 38-02: SDK Toolchain Observability And Windows Checks

## Result

Added adapter-owned GSD toolchain inspection, SDK/tools drift diagnostics, additive lock metadata merging, BOM-tolerant adapter JSON parsing, and board doctor checks for toolchain metadata, node-on-PATH, UNC paths, and planning-file BOMs.

## Commits

| Commit | Description |
|--------|-------------|
| 9daa926 | Added toolchain metadata probing, lock recording, doctor drift/windows checks, and deterministic test fixture plumbing. |

## Deviations

`GSD_TOOLS_MISSING` is emitted when doctor/inspection explicitly requires a resolvable tools path and no path/version can be found. This avoids failing healthy SDK-default installations solely because a lock file does not record a concrete `gsd-tools.cjs` path.

## Self-Check

PASSED. Unit tests cover version drift, missing tools diagnostics, and lock metadata preservation. Node integration covers visible drift output through `boards doctor`.
