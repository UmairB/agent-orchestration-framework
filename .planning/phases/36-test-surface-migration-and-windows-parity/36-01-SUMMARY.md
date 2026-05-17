---
phase: "36"
plan: "36-01"
subsystem: "gsd-sdk-fixtures"
tags:
  - sdk
  - fixtures
  - contract
key-files:
  - src/gsd-sdk-adapter.mjs
  - test/support/mock-gsd-tools.mjs
  - test/integration/sdk-contract.mjs
metrics:
  tests: "npm run test:unit; npm run test:integration:sdk-contract"
---

# Summary 36-01: Captured Fixture Harness And SDK Contract

## Result

Added `MockGSDTools`, named SDK fixture env loading, JSON overrides, strict unknown-command failures, and a dedicated `test:integration:sdk-contract` script.

## Commits

| Commit | Description |
|--------|-------------|
| c0cc080 | Added SDK fixture replay, adapter env support, unit coverage, and the SDK contract script. |

## Deviations

The contract script validates the real installed SDK surface, then uses the controlled captured fixture for deterministic roadmap/state calls. This keeps CI/local runs stable while still detecting SDK prototype drift.

## Self-Check

PASSED. Named fixtures and JSON overrides compose at the adapter boundary, and uncaptured SDK calls fail instead of silently returning defaults.

