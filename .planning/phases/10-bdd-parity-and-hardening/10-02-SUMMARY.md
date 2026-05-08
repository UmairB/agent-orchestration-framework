# Phase 10 Wave 2 Summary: CLI Domain BDD Split

## Completed

- Split the Node CLI BDD suite into domain feature files:
  - `test/integration/features/lifecycle.feature`
  - `test/integration/features/dsl.feature`
  - `test/integration/features/packages.feature`
  - `test/integration/features/adapter-policy.feature`
- Replaced the temporary legacy Node step module with `shared-cli.steps.mjs` plus per-domain dispatch modules.
- Updated the Node feature runner wiring to discover split features and fail clearly for unregistered feature files.
- Added package BDD gap scenarios for npm/git/file descriptors and dependency/resolution lock metadata.
- Added adapter-policy BDD evidence that adapter warnings stay out of lock manifests.
- Made child-process integration prompt handling match the in-process integration runner by mapping scripted prompt input into the existing test prompt environment variables.
- Updated `10-BDD-COVERAGE.md` with split feature-file evidence.

## Verification

- `npm run test:integration` passed.
- `npm run test:unit` passed.
- `npm test` passed.

## Remaining Gaps

- Setup UI HTTP BDD remains for Wave 3.
- PowerShell parity still consumes the legacy `test/integration/cli.feature` until Wave 4 updates the PowerShell runner to consume shared split feature files.
