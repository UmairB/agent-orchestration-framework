# Phase 5: Verification And Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07T00:00:00+01:00
**Phase:** 5-Verification And Hardening
**Areas discussed:** Regression safety net, Config and schema hardening, Setup UI risk closure, Lock and generated-output confidence, Build/test command policy

---

## Regression Safety Net

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Final regression sweep breadth | All milestone flows; Changed paths only; Targeted risk matrix | All milestone flows |
| Older compatibility regression scenarios | Yes, root + `.aof` compatibility; Only if current tests miss failures; No new compatibility tests | Yes, root + `.aof` compatibility |
| Child-process integration coverage | Yes, add focused child-process smoke tests; PowerShell runner only; No, in-process is enough | Yes, add focused child-process smoke tests |
| Visible milestone verification report | Yes, final verification matrix; Summaries are enough; Only if gaps are found | Yes, final verification matrix |

**User's choice:** Full milestone flow coverage, explicit compatibility regressions, focused child-process smoke tests, and final verification matrix.
**Notes:** `npm test` remains primarily in-process; child-process coverage is additive.

---

## Config And Schema Hardening

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Validation strictness | Strict for invalid core fields, tolerant for extension fields; Fully strict schema; Mostly tolerant | Strict for invalid core fields, tolerant for extension fields |
| Malformed JSON and unreadable files | Structured blocking diagnostics; Fail fast; Best-effort load with warnings | Structured blocking diagnostics |
| Root config compatibility | Explicit compatibility contract; Test only migration; Deprecate root config aggressively | Explicit compatibility contract |
| Schema file validation | Yes, schema alignment tests; No, runtime validation is enough; Docs-only schema check | Yes, schema alignment tests |

**User's choice:** Strict core validation, extension tolerance, structured blocking diagnostics, explicit legacy compatibility contract, and schema alignment tests.
**Notes:** Unknown extension fields should remain allowed where the schema/model already permits forward compatibility.

---

## Setup UI Risk Closure

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Setup UI/server risks to close | Request validation and static serving; Only new config editor endpoints; Browser/UI smoke only | Request validation and static serving |
| Browser-level smoke testing | Yes, lightweight smoke if feasible; No browser smoke; Manual screenshot only | Yes, lightweight smoke if feasible |
| Treatment of old catalog endpoints | Keep but harden; Deprecate in code; Remove catalog writes | Keep but harden |
| Local UI security posture | Local-only but still defensive; Local-only minimal hardening; Production-grade web security | Local-only but still defensive |

**User's choice:** Harden request validation/static serving, attempt lightweight browser smoke if feasible, keep but harden catalog endpoints, and keep localhost-only defensive posture.
**Notes:** Production-grade auth/CSRF was not selected for v1.

---

## Lock And Generated-Output Confidence

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Additional lock/generated-output coverage | Ownership/drift/prune matrix; Framework intent only; Runtime overrides only | Ownership/drift/prune matrix |
| Runtime override rendering coverage | Cross-kind override coverage; Only body override cases; No more override tests | Cross-kind override coverage |
| Framework lock/install attempt hardening | Yes, attempt replay and failure matrix; Only existing tests; Docs only | Yes, attempt replay and failure matrix |
| Golden-file style output checks | Selective golden checks; No golden checks; Full golden snapshots | Selective golden checks |

**User's choice:** Ownership/drift/prune matrix, cross-kind override coverage, framework attempt replay/failure coverage, and selective golden checks.
**Notes:** Full snapshots were avoided to reduce brittleness.

---

## Build/Test Command Policy

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Resolve `npm run ui:build` shim issue | Cross-platform wrapper; Document fallback only; Environment-only fix | Cross-platform wrapper |
| Include UI build in main test command | Yes, through a separate check script; Yes, inside `npm test`; No, leave UI build separate | Yes, through a separate check script |
| Preserve direct TypeScript/Vite commands in docs | Yes, as troubleshooting detail; No, wrapper only; No docs change | Yes, as troubleshooting detail |
| Successful Phase 5 verification | Full closeout command set; Only `npm run check`; Focused commands per changed area | Full closeout command set |

**User's choice:** Add a cross-platform UI build wrapper, include it in `npm run check`, document direct fallback commands, and require the full closeout command set.
**Notes:** `npm test` should remain focused on unit and integration tests.

---

## the agent's Discretion

No areas were delegated to the agent's discretion.

## Deferred Ideas

None.
