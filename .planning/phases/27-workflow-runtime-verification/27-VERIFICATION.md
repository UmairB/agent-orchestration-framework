# Phase 27 Verification: Workflow Runtime Verification

**Date:** 2026-05-14
**Status:** Passed

## Requirement Coverage

| Requirement | Result | Evidence |
|-------------|--------|----------|
| HARD-01 | Passed | Node and PowerShell BDD cover Codex command rejection and Claude-only command rendering. |
| HARD-02 | Passed | BDD covers workflow-backed Claude command and Codex skill wrappers sharing a workflow. |
| HARD-03 | Passed | BDD covers valid and invalid skill/workflow asset references. |
| HARD-04 | Passed | Disposable live UAT validated and applied a GSD-style command/skill/workflow example. |
| HARD-05 | Passed | README explains simple vs workflow-backed assets, arguments, references, and Codex command rejection. |

## Live UAT

Disposable project shape:

- workflow: `audit-milestone`
- Claude command wrapper: `audit-milestone`
- Codex skill wrapper: `gsd-audit-milestone`
- shared skill reference: `{{skills.ci}}`

Results:

- `aof project validate` returned `valid: config passed validation`.
- `aof assets apply` created Claude and Codex workflow files plus runtime-specific wrappers.
- Claude command referenced `.claude/aof/workflows/audit-milestone.md`.
- Codex skill referenced `.codex/aof/workflows/audit-milestone.md`.
- Codex workflow expanded `{{skills.ci}}` to `.codex/skills/ci/SKILL.md`.

## Commands

```txt
npm run test:unit
npm test
npm run ui:build
npm run test:integration:ps
npm run check
```

All commands passed on 2026-05-14.

## Residual Risk

Browser smoke via Playwright was attempted but unavailable in this runtime because the node REPL could not import `playwright`. The UI production build passed.
