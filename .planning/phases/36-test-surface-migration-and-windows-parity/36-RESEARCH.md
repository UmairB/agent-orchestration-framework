---
phase: 36
name: Test Surface Migration And Windows Parity
status: complete
requirements:
  - MIG-03
  - TEST-01
  - TEST-02
  - TEST-03
  - TEST-04
  - TEST-05
  - TEST-06
---

# 36 Research: Test Surface Migration And Windows Parity

## Findings

- `src/gsd-sdk-adapter.mjs` already exposes adapter-boundary injection through `ToolsClass`, direct `tools`, and the existing `AOF_TEST_GSD_SDK_FIXTURE_JSON` env hook. Phase 36 can add named fixture replay without changing board/backends call sites.
- `test/fixtures/gsd-sdk/v17-active/` already contains the captured `roadmap-analyze.stdout.json` and `state-load.stdout.txt` seed required for the two-tier test harness.
- Node BDD setup for GSD boards currently uses an inline JSON fixture in `test/integration/steps/shared-cli.steps.mjs`; `test/integration/support/cli-context.mjs` propagates that JSON to child-process and in-process runs.
- PowerShell BDD currently mirrors feature files but lacks the newer GSD-board setup and GSD runtime/SDK fixture env propagation, so Phase 36 must patch the runner before adding SDK scenarios.
- `src/boards.mjs` hashes raw board/task file content for board index fingerprints. CRLF/LF differences can therefore create false stale/drift signals unless runtime hashing normalizes newlines.
- `repairMissingMilestoneId()` already has the intended v1.6 safety behavior: auto-bind only when a single milestone candidate exists and either the stored roadmap path is default or existing phase-task fingerprint matches. The missing coverage is a canonical fixture and BDD path.

## Constraints

- Keep `test:integration:sdk-contract` separate from `npm test` because local real GSD tools may not exist in every developer checkout.
- Do not implement Phase 37 fallback behavior or Phase 38 doctor warnings during this phase.
- Avoid broad line-ending renormalization churn; add `.gitattributes` and runtime normalization only.

