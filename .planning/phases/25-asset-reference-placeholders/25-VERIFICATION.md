# Phase 25 Verification: Asset Reference Placeholders

**Date:** 2026-05-14
**Status:** Passed

## Requirement Coverage

| Requirement | Result | Evidence |
|-------------|--------|----------|
| REF-01 | Passed | `{{skills.<id>}}` expands in resources, overrides, workflows, and referenced global assets. |
| REF-02 | Passed | `{{workflows.<id>}}` expands to `.claude/aof/workflows/<id>.md` or `.codex/aof/workflows/<id>.md`. |
| REF-03 | Passed | Validation reports `missing-asset-reference` before apply writes. |
| REF-04 | Passed | Validation reports `asset-reference-runtime-mismatch` for runtime-incompatible references. |
| HARD-03 | Passed | Node and PowerShell BDD cover valid and invalid asset reference scenarios. |

## Commands

```txt
npm run test:unit
npm test
npm run test:integration:ps
```

All commands passed on 2026-05-14.

## Notes

- Supported placeholder namespaces are intentionally limited to `skills` and `workflows`.
- `{{commands.*}}`, singular namespaces, and malformed IDs are validation errors.
- Project-local and referenced global skills/workflows share the same reference index.
