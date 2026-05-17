---
status: passed
phase: "36"
phase_name: "Test Surface Migration And Windows Parity"
verified_at: "2026-05-17"
---

# Verification: Phase 36 Test Surface Migration And Windows Parity

## Result

Phase 36 passed verification.

## Evidence

- `node scripts/supply-chain-audit.mjs` passed with 0 warnings.
- `node scripts/check-sdk-boundary.mjs` passed.
- `npm run test:unit` passed.
- `npm run test:integration:sdk-contract` passed.
- `npm test` passed.
- `npm run test:integration:ps` passed.

## Requirement Coverage

- MIG-03: `test/fixtures/v1-6-board.json` plus task fixtures are exercised end-to-end through `boards repair` and `boards sync`.
- TEST-01: `MockGSDTools` replays captured fixture files from `test/fixtures/gsd-sdk/<scenario>/` with overrides.
- TEST-02: `npm run test:integration:sdk-contract` validates the installed SDK surface and controlled roadmap/state shape.
- TEST-03: SDK-path BDD siblings cover attach/sync, v1.6 repair, and assignment flows.
- TEST-04: `test:integration:ps` now runs with temp project roots containing spaces and passes SDK fixture board scenarios.
- TEST-05: Happy auto-bind and ambiguous no-guess v1.6 migration scenarios assert binding state and task behavior.
- TEST-06: `.gitattributes` adds LF policy and `canonicalFingerprint` normalizes CRLF to LF before hashing.

## Notes

UNC and BOM handling remain deferred to Phase 38 doctor warnings, matching the Phase 36 context decisions.

