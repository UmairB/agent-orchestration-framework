# Phase 33: SDK Adapter Foundation - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Land `src/gsd-sdk-adapter.mjs` as the single typed seam over `@gsd-build/sdk@0.1.0` so every later v1.7 phase calls SDK functions through one auditable, error-wrapped, version-pinned module. Pure addition — no existing AOF behavior changes in this phase. Adapter is the ONLY module that imports `@gsd-build/sdk` or invokes `gsd-tools.cjs`.

**Covers:** SDK-01, SDK-02, SDK-03, SDK-04, SDK-05, SDK-06, SDK-07, SDK-08, SDK-09, DIAG-05 (10 requirements).

</domain>

<decisions>
## Implementation Decisions

### Adapter Surface (already locked by v1.7 research — restated for downstream agents)

- **D-01:** Adapter shape is a **module of pure async functions**, not a class. Matches `src/frameworks.mjs` / `src/packages.mjs` / `src/adapters.mjs` style. `GSDTools` is instantiated inside each adapter function and discarded — no per-call state retained. (Locked by `.planning/research/ARCHITECTURE.md`.)
- **D-02:** Exports: `loadGsdState(projectDir)`, `analyzeGsdRoadmap(projectDir)`, `assertMilestone(projectDir, milestoneId)`, `listMilestonePhases(projectDir, milestoneId)`, `gsdSdkVersion()`, and `class GsdSdkError extends Error`. (Locked by SDK-03..08.)
- **D-03:** Every adapter call wraps `GSDToolsError` into `GsdSdkError` shaped `{code, message, expected?, actual?, next?}`. Raw `gsd-tools.cjs` command strings never reach CLI users. (Locked by SDK-07.)
- **D-04:** `@gsd-build/sdk@0.1.0` pinned **exact** with `--save-exact` in `package.json`; `package-lock.json` committed; `scripts/supply-chain-audit.mjs` allowlist widened for the new transitive surface; `npm run security:supply-chain` passes. (Locked by SDK-01 + Pitfall 1.)
- **D-05:** Adapter MUST NOT call `tools.exec("state", ["milestone-switch"])` or any composite that fakes a missing SDK runner. Milestone-creation handoff to the runtime CLI is Phase 37's responsibility. (Locked by Pitfall 8.)
- **D-06:** No CRLF / `shell: process.platform === "win32"` / BOM-stripping Windows safeguards inside the SDK path. Those live only in the CLI fallback (Phase 37). The adapter normalises paths via `path.resolve(projectDir)` and assumes `node` is on PATH; Windows-specific diagnostics belong to `aof boards doctor` (Phase 38). (Locked by Pitfall 10.)

### Boot Probe / Contract Test (SDK-09)

- **D-07:** **Lazy on first adapter call.** A surface-assertion routine runs once per process the first time any adapter function is invoked. It imports `@gsd-build/sdk`, asserts the methods AOF depends on exist on `GSDTools.prototype` and the shape signatures we rely on, and memoises the result. If the assertion fails, the adapter throws `GsdSdkError("GSD_SDK_SURFACE_MISMATCH", …)` with a clear actionable message and never retries within the process. `bin/aof.mjs` and non-GSD commands (`aof assets list`, etc.) pay zero startup cost.
- **D-08:** The asserted surface is a **hard-coded literal list** inside the adapter (e.g., `["roadmapAnalyze", "stateLoad", "configGet", "configSet", "phasePlanIndex", "phaseComplete", "commit", "exec"]`). Explicit list catches accidental drift even if a method we use was removed; an "extracted from usage" approach would silently miss methods called only on rarer code paths.
- **D-09:** The same surface-assertion routine is also invoked by the unit test for `gsd-sdk-adapter.mjs` so the failure mode is exercised in CI.

### `gsdToolsPath` Resolution (SDK-08)

- **D-10:** **Pinned via `.aof/lock/<lock>.json` first, then SDK default.** Resolution order:
  1. Read the project's AOF lock file. If it records a resolved `gsd-tools.cjs` path for the installed `gsd` framework, use that.
  2. Otherwise, fall back to `@gsd-build/sdk`'s built-in default (`~/.claude/get-shit-done/bin/gsd-tools.cjs`).
  3. The adapter ALWAYS passes `gsdToolsPath` explicitly to `new GSDTools({…})` rather than relying on the SDK's internal default lookup, so the resolved path is auditable in the dispatch log. (Pitfall 2.)
- **D-11:** Callers may inject an override: every adapter function accepts an optional `{gsdToolsPath}` option that wins over the resolution chain. Used by tests and by `aof boards doctor` future-flow.
- **D-12:** Resolution is performed once per call (cheap — single sync file read), not memoised at module scope. Avoids stale paths when the user re-runs `aof packages install gsd` mid-session.

### Dispatch Log (DIAG-05)

- **D-13:** **Unbounded append-only, no redaction, manual cleanup.** Path: `.aof/cache/boards/dispatch.log.jsonl`. Each line is `{ts, command, args, latencyMs, ok}`. Append happens **after** every `GSDTools.exec`-equivalent call inside the adapter (after the response or error is normalised), regardless of success.
- **D-14:** Args recorded verbatim. GSD args are command strings (e.g., `["analyze"]`, `["load"]`) — no user content. Acceptable for v1.7.
- **D-15:** Directory `.aof/cache/boards/` is created on demand by the adapter using existing fs helpers (`src/fs.mjs`). The log is best-effort: a write failure logs a one-line warning to stderr and DOES NOT fail the adapter call. (Diagnostics must not break execution.)
- **D-16:** Rotation, retention, and redaction are **explicitly deferred**. Doctor (Phase 38) may surface a warning if file size grows unreasonably; that's where any size policy would land.

### First Captured Fixture (Phase 33 seed for Phase 36)

- **D-17:** **Happy-path `roadmapAnalyze` + `stateLoad` against this repo's v1.7 milestone.** Scenario directory: `test/fixtures/gsd-sdk/v17-active/`. Two files (one per call): `roadmap-analyze.stdout.json` and `state-load.stdout.json`. Captures the raw `--raw` stdout shape so Phase 36's `MockGSDTools` can replay it byte-for-byte.
- **D-18:** A small capture recipe lives in `test/fixtures/gsd-sdk/README.md` describing the exact `gsd-tools.cjs` invocations that produced each file, so re-capture on SDK bump is reproducible. No capture script is shipped yet — Phase 36 owns the harness.
- **D-19:** The fixture is consumed by Phase 33's adapter unit test as a smoke check (read fixture → assert adapter's `loadGsdState`/`analyzeGsdRoadmap` happy-path return shape) so the seed has actual test coverage on day one.

### BDD Coverage (project-wide rule)

- **D-20:** Phase 33 ships BDD coverage for any user-facing behavior it introduces. Since Phase 33 is pure addition with no CLI surface change, BDD scope is minimal — the typed errors (`GSD_SDK_SURFACE_MISMATCH`, `GSD_TOOLS_MISSING`) get scenarios as soon as a caller surfaces them in Phase 34. Phase 33 itself ships **adapter unit tests + the boot-time integration smoke** rather than CLI-facing BDD. (Confirm during planning.)

### Open for Research (researcher MUST resolve)

- **R-01:** **Lock state shape for the resolved `gsd-tools.cjs` path.** Today `src/lock.mjs` exposes `mergeFrameworkInstallAttempts` which records install attempts (`{framework, runtime, scope, packageSource, status}`) but does NOT record a resolved `gsd-tools.cjs` path. Researcher must determine: (a) does `aof packages install gsd` already write the path anywhere, or (b) does Phase 33 need to add a new field (e.g., `frameworks[].resolvedToolsPath`) and the write site? D-10's resolution chain depends on this. Phase 38's DIAG-06 (lock state records both versions) builds on the same surface.
- **R-02:** **`assertMilestone` resolution mechanism.** Open question in `.planning/research/ARCHITECTURE.md`: SDK's `RoadmapAnalysis` exposes `phases[]` but not `milestones[]`. Researcher must confirm the exact SDK calls needed to resolve a milestone id (likely `stateLoad()` → `current_milestone` plus `roadmapAnalyze()` for phase-set comparison; possibly `GSDTools.exec("state", ["milestone-id"])`) and the returned `{ok, expected, actual, code}` mapping for the four failure codes Phase 34 will rely on: `MILESTONE_NOT_BOUND`, `MILESTONE_ID_MISMATCH`, `MILESTONE_NOT_IN_STATE`, `MILESTONE_INCOMPLETE`.
- **R-03:** **Hard-coded surface list for D-08.** Researcher should confirm the exact `GSDTools` method names AOF depends on by reading `node_modules/@gsd-build/sdk/dist/types.d.ts` after the dep is added, so the literal list in the contract test reflects 0.1.0's actual surface.
- **R-04:** **Per-method timeout policy.** Pitfall 3 recommends explicit `timeoutMs` per adapter method (10s for reads, 60s for `phaseComplete`) instead of the SDK's 30s default. Researcher should propose concrete values for each Phase-33 method.

### Claude's Discretion

- Internal helper structure within `src/gsd-sdk-adapter.mjs` (e.g., shared `wrapGsdToolsError(err)` helper, internal `resolveGsdToolsPath(projectDir, options)` helper).
- Test file location and naming (`test/gsd-sdk-adapter.test.mjs` consistent with existing convention).
- JSDoc typedef shape for `GsdSdkError`, `GsdState`, `GsdRoadmapAnalysis` return values (the `.d.ts` from `@gsd-build/sdk` is the source of truth for upstream shapes; AOF's wrappers re-export or narrow as needed).
- Lint/grep guard mechanism that enforces SDK-02 (only `gsd-sdk-adapter.mjs` imports `@gsd-build/sdk` or references `gsd-tools.cjs`). Could be a `scripts/check.mjs` rule, a CI grep, or an ESLint rule — planner picks the lowest-friction option that fits existing tooling.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase / Milestone Definition
- `.planning/ROADMAP.md` §Phase 33 — phase goal, success criteria (1-5), requirements list, notes
- `.planning/REQUIREMENTS.md` §Adapter (SDK seam) — SDK-01 through SDK-09 with acceptance text
- `.planning/REQUIREMENTS.md` §Diagnostics — DIAG-05 (dispatch log)
- `.planning/PROJECT.md` §Current Milestone v1.7 + §Key Decisions (v1.7 rows) — typed-seam intent, no slash-command scraping, defer-runner rationale

### v1.7 Research (authoritative — read before designing the adapter)
- `.planning/research/SUMMARY.md` — headline findings, stack additions, architecture shape, feature inventory, pitfall ranking, suggested phase decomposition
- `.planning/research/ARCHITECTURE.md` — `src/gsd-sdk-adapter.mjs` shape, `BoardBackend` sketch, modified components, data flow, anti-patterns, open questions
- `.planning/research/PITFALLS.md` — 10 ranked pitfalls; Pitfalls 1, 2, 3, 8, 10 are Phase 33-owning or co-owning
- `.planning/research/STACK.md` — dependency choice rationale, supply-chain audit changes
- `.planning/research/FEATURES.md` — table-stakes vs differentiators vs deferred

### Codebase Patterns (mirror these, don't reinvent)
- `src/frameworks.mjs` — module-of-functions adapter pattern; `installFramework`/`planFrameworkInstall` shape AOF follows for external-tool integrations
- `src/packages.mjs` — package descriptor + supply-chain pattern
- `src/lock.mjs` — `mergeFrameworkInstallAttempts`, `LOCK_VERSION=2`, lock JSON shape; relevant to D-10/R-01
- `src/gsd-runtime.mjs` — current GSD integration to be COMPLEMENTED (not replaced) in Phase 33; Phase 37 renames it to `gsd-runtime-fallback.mjs`. Phase 33 does NOT modify this file.
- `src/boards.mjs` §635-660 (`parseRoadmapPhases`, `nextBoldValue`) — markdown-regex roadmap parser the SDK replaces. Phase 33 does NOT delete this — Phase 34 does.
- `scripts/supply-chain-audit.mjs` — allowlist surface to extend for `@gsd-build/sdk`'s transitives
- `src/fs.mjs` — JSON read/write helpers for the dispatch log + lock state

### SDK Surface (after dep install)
- `node_modules/@gsd-build/sdk/dist/types.d.ts` — authoritative typed surface for `GSDTools`, `GSD`, `GSDToolsError`, `RoadmapAnalysis`, `MilestoneRunnerResult`, etc.
- `node_modules/@gsd-build/sdk/package.json` — installed version (used by `gsdSdkVersion()` drift detection)

### Codebase Map (existing intel)
- `.planning/codebase/STRUCTURE.md` — repo layout (note: somewhat dated — Phase 24+ added board/runtime files not yet reflected; trust live `src/` listing over this doc)
- `.planning/codebase/INTEGRATIONS.md` — external tool integration patterns
- `.planning/codebase/TESTING.md` — unit/BDD/PowerShell test conventions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/frameworks.mjs::FRAMEWORKS` table** — already declares `gsd` with `packageName: "get-shit-done-cc@latest"` and runtime flags. The adapter's `gsdToolsPath` resolver (D-10) hooks into this surface to find where `aof packages install gsd` writes its state.
- **`src/lock.mjs::mergeFrameworkInstallAttempts` + `LOCK_VERSION=2`** — extension point for R-01. Adding a `resolvedToolsPath` field is additive and does not require a lock version bump (LOCK_VERSION semantics permit additive fields per v1.1 Phase 9 lock decisions).
- **`src/fs.mjs::readJson` / `writeText`** — sufficient for the dispatch log (append) and lock state reads. No new fs primitives needed.
- **`scripts/supply-chain-audit.mjs`** — already has the allowlist pattern (`knownBadVersions`, `blockedPackageFamilies`); extending it for `@gsd-build/sdk`'s transitive surface is a straightforward append.

### Established Patterns

- **Module-of-functions, no classes** — `src/frameworks.mjs`, `src/packages.mjs`, `src/adapters.mjs`, `src/boards.mjs` are all pure-function modules. `src/gsd-sdk-adapter.mjs` MUST follow. (`GsdSdkError extends Error` is the one class — error classes are a Node idiom and don't violate the pattern.)
- **`projectDir` as first arg** — every cross-cutting helper takes `projectDir` first (see `boards.mjs`, `lock.mjs`). The adapter follows: `loadGsdState(projectDir)`, `analyzeGsdRoadmap(projectDir)`, `assertMilestone(projectDir, milestoneId)`, etc.
- **Error normalisation at the adapter boundary** — `src/frameworks.mjs::installFramework` throws `Error("Framework install failed: …")` with a structured cause; the SDK adapter does the same with `GsdSdkError` (richer because the contract demands typed `{code, expected, actual, next}` shape).
- **Lock state is the cross-call truth** — `src/lock.mjs` is the single read/write surface for cross-invocation state. The adapter follows: any resolved-path or version data Phase 33 needs to persist goes through lock state, NOT a side-channel file.
- **Tests live next to convention** — `test/<module>.test.mjs` for unit; `test/integration/*.feature` + `cli.mjs`/`cli.ps1` for BDD. Phase 33 adds `test/gsd-sdk-adapter.test.mjs` (unit) and `test/fixtures/gsd-sdk/v17-active/` (fixture). BDD additions wait for Phase 34's CLI-surface changes.

### Integration Points

- **`@gsd-build/sdk`** — only `src/gsd-sdk-adapter.mjs` imports it. Enforcement is a Phase 33 deliverable (SDK-02) — planner picks lint/grep/CI mechanism (Claude's Discretion).
- **`gsd-tools.cjs`** — only the adapter invokes it (transitively via `GSDTools`). The CLI fallback (`src/gsd-runtime.mjs`) spawns `claude`/`codex`, NOT `gsd-tools.cjs`, so there is no overlap.
- **`.aof/cache/boards/`** — new directory owned by the adapter for the dispatch log. Same `.aof/cache/` parent used by `src/boards.mjs` for `index.json` — established convention.
- **`.aof/lock/<lock>.json`** — extended (additively) by Phase 33 to record the resolved `gsd-tools.cjs` path (R-01). Phase 38 extends the same surface for SDK + tools version drift (DIAG-06).

### Files NOT Touched in Phase 33

- `src/boards.mjs`, `src/cli.mjs`, `src/board-execution.mjs`, `src/setup-ui.mjs`, `src/gsd-runtime.mjs` — Phase 34+ territory. Phase 33 is pure addition.
- `ui/src/main.tsx` — UI work is deferred to v1.8.
- `src/dsl.mjs`, `src/adapters.mjs`, `schemas/aof.schema.json` — no DSL or render changes.

</code_context>

<specifics>
## Specific Ideas

- Adapter file naming: `src/gsd-sdk-adapter.mjs` (exact filename locked by ARCHITECTURE.md and reflected throughout REQUIREMENTS.md).
- Error class naming: `GsdSdkError` (locked).
- Dispatch log path: `.aof/cache/boards/dispatch.log.jsonl` (locked by DIAG-05).
- First fixture path: `test/fixtures/gsd-sdk/v17-active/` (chosen in discussion).
- Error code namespace introduced this phase: `GSD_SDK_SURFACE_MISMATCH`, `GSD_TOOLS_MISSING`, `SDK_VERSION_DRIFT` (warning, surfaced by `gsdSdkVersion()`). Phase 34 adds milestone-specific codes (`MILESTONE_NOT_BOUND`, etc.).

</specifics>

<deferred>
## Deferred Ideas

- **`aof boards doctor` end-to-end ladder** — Phase 38 owns this. Phase 33 only ships `gsdSdkVersion()` so Phase 38 has something to call.
- **Lock-state recording of SDK + tools versions (DIAG-06)** — Phase 38. Phase 33 records the resolved `gsd-tools.cjs` path (per R-01); version recording layers on top.
- **Per-method timeout configuration via env** — not requested. Phase 33 picks fixed per-method timeouts (R-04); env override can land later if a user reports needing it.
- **Dispatch log rotation / retention / redaction** — explicitly out of scope per D-16. Revisit if usage proves the log grows unreasonably; doctor (Phase 38) can warn on size.
- **Captured fixture harness / capture script** — Phase 36 owns the `MockGSDTools` infrastructure. Phase 33 ships a manual recipe in `test/fixtures/gsd-sdk/README.md` (D-18).
- **Lint rule enforcement of SDK-02 (only the adapter imports `@gsd-build/sdk`)** — mechanism is Claude's Discretion at plan time; the rule itself is in scope.
- **Failure-mode fixtures (missing-milestone, etc.)** — defer to Phase 36 (alternative considered in discussion; Phase 33 ships happy-path only).
- **`aof boards milestone create` placeholder UX (visible-with-instructions vs hidden)** — Phase 34/38 territory; no Phase 33 surface.

</deferred>

---

*Phase: 33-sdk-adapter-foundation*
*Context gathered: 2026-05-16*
