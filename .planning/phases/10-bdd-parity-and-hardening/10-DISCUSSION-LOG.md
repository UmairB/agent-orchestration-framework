# Phase 10: BDD Parity And Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08
**Phase:** 10-BDD Parity And Hardening
**Areas discussed:** Coverage Boundary, Feature Organization, UI/API BDD Scope, Cross-Platform Hardening

---

## Coverage Boundary

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| BDD target | Matrix + gaps | Create a traceable BDD coverage matrix and fill missing scenarios for `BDD-01` through `BDD-04`. | ✓ |
| BDD target | Gaps only | Add missing scenarios without creating a separate traceability artifact. | |
| BDD target | Audit first | Start with an explicit BDD audit report, then decide which gaps to implement. | |
| Matrix strictness | Scenario-level evidence | Each `BDD-*` row lists exact scenario names and marks `covered`, `partial`, or `missing`. | ✓ |
| Matrix strictness | Requirement-level summary | Each `BDD-*` row gets a short status and notes, without mapping every scenario. | |
| Matrix strictness | Executable tags | Add tags or metadata to scenarios so coverage can be queried mechanically later. | |
| Existing scenarios | Reuse existing names | Count existing scenarios as evidence and only rename when a scenario is misleading. | ✓ |
| Existing scenarios | Normalize names | Reword scenario titles so the whole feature reads consistently. | |
| Existing scenarios | Add duplicates with better names | Leave old scenarios untouched and add clearer new ones for traceability. | |
| Matrix location | Phase artifact | `.planning/phases/10-bdd-parity-and-hardening/10-BDD-COVERAGE.md`. | ✓ |
| Matrix location | Test folder doc | `test/integration/BDD-COVERAGE.md`. | |
| Matrix location | Requirements file | Add the matrix directly into `.planning/REQUIREMENTS.md`. | |

**User's choices:** 1, 1, 1, 1.
**Notes:** Existing scenario names should remain valid evidence unless misleading.

---

## Feature Organization

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Feature files | Keep one feature file | Keep `test/integration/cli.feature` as canonical and add headings/comments as needed. | |
| Feature files | Split by domain | Split into lifecycle / DSL / packages / adapter feature files and update the runner to discover multiple `.feature` files. | ✓ |
| Feature files | Hybrid | Keep `cli.feature`, but add a second targeted feature file only for Phase 10 gap scenarios. | |
| Step definitions | Shared runner steps | Keep one shared step implementation in `test/integration/cli.mjs` and just load multiple feature files. | |
| Step definitions | Per-feature step modules | Split step definitions by feature domain too. | ✓ |
| Step definitions | Shared core + feature helpers | Keep common assertions shared, but move fixture setup helpers near each feature domain. | |
| Module rollout | Incremental modules | Create the multi-feature runner first, then move steps where it reduces clutter. | |
| Module rollout | Full split now | Every feature file gets its own step module in Phase 10. | ✓ |
| Module rollout | Module skeletons | Create per-feature modules now, but allow some shared legacy steps to remain temporarily. | |
| PowerShell split | Mirror the split | Update PowerShell to discover/run the split feature files too. | ✓ |
| PowerShell split | Keep legacy | Leave PowerShell pointed at the old monolithic shape for now. | |
| PowerShell split | Retire from Phase 10 | Stop treating the PowerShell runner as part of BDD parity. | |
| File names | Domain names | `lifecycle.feature`, `dsl.feature`, `packages.feature`, `adapter-policy.feature`. | ✓ |
| File names | Requirement names | `bdd-01-lifecycle.feature`, `bdd-02-dsl.feature`, etc. | |
| File names | Command names | Group mainly by CLI command, such as `apply.feature`, `sync.feature`, `validate.feature`. | |

**User's choices:** 2, 2, 2, 1, 1.
**Notes:** Full per-feature modules are intentionally part of Phase 10 scope.

---

## UI/API BDD Scope

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| UI hint meaning | Setup UI API BDD | Add BDD-style scenarios for setup UI API/editor flows, but not browser E2E. | ✓ |
| UI hint meaning | CLI only | Keep Phase 10 focused on CLI BDD and rely on existing UI unit/build coverage. | |
| UI hint meaning | Browser E2E | Add real browser-driven setup UI scenarios. | |
| Feature location | Own feature file | Add `setup-ui.feature` with setup UI API/editor scenarios. | ✓ |
| Feature location | Lifecycle feature | Include setup UI API scenarios in `lifecycle.feature`. | |
| Feature location | Separate unit-style only | Keep API behavior in `test/setup-ui.test.mjs`, but reference it in the matrix. | |
| API priority | Editor save/validate flows | Saving resources/expanded sections, invalid payload failures, adapter warning review payload. | ✓ |
| API priority | Server lifecycle only | Starting the setup server and serving static/API routes. | |
| API priority | Catalog API only | Catalog list/seed/update behavior through HTTP endpoints. | |
| Driving style | HTTP server scenarios | Start the setup UI server and exercise real HTTP endpoints. | ✓ |
| Driving style | In-process helper scenarios | Call existing exported helpers directly for speed and simplicity. | |
| Driving style | Mixed | HTTP for core save/validate, helpers for hard-to-drive edge cases. | |

**User's choices:** 1, 1, 1, 1.
**Notes:** Browser E2E is explicitly out of Phase 10.

---

## Cross-Platform Hardening

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| PowerShell status | Normal verification | Make PowerShell integration part of Phase 10 verification and document it in the matrix. | ✓ |
| PowerShell status | Optional check | Keep it available but not required for Phase 10 completion. | |
| PowerShell status | Parity only | Update it to mirror the split, but do not require it to pass in final verification. | |
| Test command | Separate required command | Keep `npm test` fast/current and require `npm run test:integration:ps` for Phase 10 verification. | ✓ |
| Test command | Include in npm test | Make `npm test` run both Node and PowerShell integration suites. | |
| Test command | New aggregate script | Add something like `npm run test:bdd` that runs Node + PowerShell BDD. | |
| Non-Windows behavior | Windows-gated skip | Script detects non-Windows and exits with a clear skip/success message. | ✓ |
| Non-Windows behavior | Fail outside Windows | Treat non-Windows as unsupported and fail. | |
| Non-Windows behavior | Node fallback | PowerShell command delegates to the Node runner when assumptions are unavailable. | |
| Scenario parity | Shared feature files | Both runners consume the same `.feature` files. | ✓ |
| Scenario parity | Mirrored text | PowerShell keeps separate feature text but mirrors scenarios. | |
| Scenario parity | Coverage parity only | PowerShell can have fewer/different scenario names as long as behavior coverage matches. | |

**User's choices:** 1, 1, 1, 1.
**Notes:** PowerShell is required for Phase 10 verification but remains outside `npm test`.

---

## the agent's Discretion

- Internal step module API and shared fixture/helper factoring.
- Exact Markdown layout of `10-BDD-COVERAGE.md`.

## Deferred Ideas

- Browser E2E for setup UI.
- Expanding `npm test` to include PowerShell integration.
