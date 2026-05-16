# Summary 33-01: SDK Dependency And Adapter Boundary

## Completed

- Added exact `@gsd-build/sdk@0.1.0` dependency and refreshed `package-lock.json`.
- Added `src/gsd-sdk-adapter.mjs` as the only module importing `@gsd-build/sdk`.
- Added adapter exports for state loading, roadmap analysis, milestone assertion, milestone phase listing, SDK version reporting, and the `GsdSdkError` type.
- Added the lazy SDK surface probe and `scripts/check-sdk-boundary.mjs`.

## Verification

- `node scripts/check-sdk-boundary.mjs`
- `node scripts/test-unit.mjs`
- `node scripts/test.mjs`

