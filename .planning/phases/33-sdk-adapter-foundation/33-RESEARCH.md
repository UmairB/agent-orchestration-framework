# Phase 33 Research: SDK Adapter Foundation

## Resolved Questions

### R-01: Lock State Shape

`aof packages install gsd` currently records `frameworkInstallAttempts` but does not record a resolved `gsd-tools.cjs` path. Phase 33 should add read support in the adapter for future lock fields without changing installer behavior yet:

- `lock.gsd.toolsPath`
- `lock.gsd.gsdToolsPath`
- `lock.frameworks[].resolvedToolsPath`
- `lock.frameworks[].gsdToolsPath`
- `lock.frameworkInstallAttempts[].resolvedToolsPath`
- `lock.frameworkInstallAttempts[].gsdToolsPath`

If no path is found, the adapter passes no `gsdToolsPath` override and lets the SDK use its default. Phase 38 owns recording tool versions and richer lock metadata.

### R-02: `assertMilestone` Mechanism

`@gsd-build/sdk@0.1.0` exposes `stateLoad()` as raw text and `roadmapAnalyze()` as a typed analysis. There is no typed milestone list API. Phase 33 should keep `assertMilestone(projectDir, milestoneId)` conservative:

- call `loadGsdState(projectDir)`
- call `analyzeGsdRoadmap(projectDir)`
- infer the active/current milestone from state keys when present
- infer known milestone ids from `RoadmapAnalysis.milestones[].version`
- return `{ok, expected, actual, code}` instead of throwing for normal mismatch cases

Phase 34 can tighten code mappings once it owns board lifecycle errors.

### R-03: SDK Surface List

The installed `node_modules/@gsd-build/sdk/dist/gsd-tools.d.ts` exposes:

- `exec`
- `execRaw`
- `stateLoad`
- `roadmapAnalyze`
- `phaseComplete`
- `commit`
- `verifySummary`
- `initExecutePhase`
- `initPhaseOp`
- `configGet`
- `stateBeginPhase`
- `phasePlanIndex`
- `initNewProject`
- `configSet`

Phase 33 contract probe asserts the methods AOF depends on now and near-term: `exec`, `execRaw`, `stateLoad`, `roadmapAnalyze`, `configGet`, `configSet`, `phasePlanIndex`, `initPhaseOp`, `phaseComplete`, and `commit`.

### R-04: Timeout Policy

Use explicit per-call timeouts rather than the SDK default:

- read calls: 10s (`loadGsdState`, `analyzeGsdRoadmap`, `assertMilestone`, `listMilestonePhases`)
- future mutation/phase completion calls: 60s when added in later phases

## Verification Notes

`npm install @gsd-build/sdk@0.1.0 --save-exact --ignore-scripts` completed successfully and `node scripts/supply-chain-audit.mjs` passed with 0 warnings.

