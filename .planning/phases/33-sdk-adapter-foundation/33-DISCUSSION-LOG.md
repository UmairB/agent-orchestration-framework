# Phase 33: SDK Adapter Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 33-sdk-adapter-foundation
**Areas discussed:** Boot probe / contract test gating, `gsdToolsPath` resolution, Dispatch log retention & redaction, First captured fixture scenario

---

## Boot Probe / Contract Test Gating (SDK-09)

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy on first adapter call | Probe runs once per process when any adapter function is first invoked. CLI commands that don't touch GSD (e.g., `aof assets list`) stay fast. Failure surfaces inside the GSD-touching command with a clear `GSD_SDK_SURFACE_MISMATCH` error. | ✓ |
| Boot-time on every `aof` invocation | Probe runs in `bin/aof.mjs` before any command dispatches. Catches breakage earliest but adds startup cost to every command including unrelated ones. | |
| Only on `aof boards *` subcommands | Probe runs inside the `boards` command dispatcher. Compromise between fast non-boards commands and fail-fast for anything touching the SDK. | |
| Doctor-only + unit test (no runtime probe) | Shape check lives in `aof boards doctor` and the unit suite only. Runtime adapter calls just fail naturally if a method is missing. | |

**User's choice:** Lazy on first adapter call.
**Notes:** Keeps `bin/aof.mjs` clean. Non-GSD commands pay zero startup cost. Memoised at module scope so the probe runs at most once per process.

---

## `gsdToolsPath` Resolution (SDK-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Pinned via `.aof/lock/packages.json` first, then SDK default | Adapter reads the resolved path from lock state written by `aof packages install gsd`. If lock state has no entry, fall back to the SDK's built-in `~/.claude/get-shit-done/bin/gsd-tools.cjs`. Deterministic per-project. | ✓ |
| Probe-and-pick: lock state → env var → SDK default → error | Search order across lock, env, default, then hard error. Resilient for fresh checkouts; transparent when overridden. | |
| Env var first, then lock state, then SDK default | `AOF_GSD_TOOLS_PATH` always wins; then lock state; then SDK default. Operator-friendly but env can silently override what `aof packages install` wrote. | |
| Always SDK default; require explicit injection to override | Use the SDK's default unconditionally; callers wanting a different path pass `{gsdToolsPath}` to every adapter call. Simplest but breaks multi-install users without code edits. | |

**User's choice:** Pinned via `.aof/lock/packages.json` first, then SDK default.
**Notes:** Exposes a gap (R-01 in CONTEXT.md): today's `src/lock.mjs` records install attempts but not the resolved `gsd-tools.cjs` path. Researcher must determine whether `aof packages install gsd` should be extended to write the resolved path, or whether Phase 33 writes it opportunistically on first adapter boot. Field naming TBD (`frameworks[].resolvedToolsPath` proposed).

---

## Dispatch Log Retention & Redaction (DIAG-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Size-capped rotation, args verbatim, no PII heuristics | Append-only until file exceeds ~5MB, then rotate to `dispatch.log.1.jsonl` (keep last 1). Args verbatim. Bounded growth, predictable. | |
| Unbounded append-only, no redaction, manual cleanup | Pure DIAG-05 — append forever. Simplest implementation. Acceptable for v1.7 because typical use is <100 calls/day; revisit if size becomes a problem. | ✓ |
| Daily-rotated files, args verbatim, kept 7 days | Filename like `dispatch.2026-05-16.log.jsonl`; doctor prunes anything older than 7 days. More structure, easier to bisect. | |
| Size-capped with redaction of file/path args | Size cap + redact absolute filesystem path args. Safer if user shares the log publicly. | |

**User's choice:** Unbounded append-only, no redaction, manual cleanup.
**Notes:** Diagnostics MUST NOT break execution — log write failures degrade to a one-line stderr warning, not an adapter failure. Phase 38's doctor may surface a size warning later; rotation/retention/redaction policy is explicitly deferred until usage proves they're needed.

---

## First Captured Fixture Scenario

| Option | Description | Selected |
|--------|-------------|----------|
| Happy-path `roadmapAnalyze` + `stateLoad` against this repo's v1.7 milestone | Capture real `gsd-tools.cjs` output for `roadmap analyze` and `state load` run against AOF's own `.planning/`. Realistic shape, immediately useful for Phase 36 BDD seeds. | ✓ |
| Synthetic minimal scenario built from a fresh `gsd-sdk init` project | Decoupled from AOF's own evolving milestones; less likely to need re-capture when v1.7 ships. Less realistic for the boards-sync flow Phase 34 tests. | |
| Happy-path + one failure mode (missing milestone) | Two scenario directories (`v17-active/` + `missing-milestone/`) so Phase 33's error-wrapping has a real fixture to test against. More work upfront. | |
| Defer fixture capture to Phase 36 entirely | Phase 33 lands the adapter + unit tests that mock the SDK class directly; first real captured fixture lands in Phase 36. Risks delaying validation of the JSON-over-process boundary. | |

**User's choice:** Happy-path `roadmapAnalyze` + `stateLoad` against this repo's v1.7 milestone.
**Notes:** Scenario directory `test/fixtures/gsd-sdk/v17-active/`, two files. A capture recipe lives in `test/fixtures/gsd-sdk/README.md` so re-capture on SDK bump is reproducible. No capture harness in Phase 33 — Phase 36 owns the `MockGSDTools` infrastructure. Failure-mode fixtures deferred to Phase 36.

---

## Claude's Discretion

- Internal helper structure inside `src/gsd-sdk-adapter.mjs` (e.g., shared `wrapGsdToolsError` helper, `resolveGsdToolsPath` helper).
- Test file naming and location (`test/gsd-sdk-adapter.test.mjs` consistent with existing convention).
- JSDoc typedef shape for `GsdSdkError`, `GsdState`, `GsdRoadmapAnalysis` return values.
- Lint/grep mechanism enforcing SDK-02 (only the adapter imports `@gsd-build/sdk` / references `gsd-tools.cjs`) — `scripts/check.mjs` rule vs CI grep vs ESLint rule; planner picks the lowest-friction option that fits existing tooling.

## Deferred Ideas

- Dispatch log rotation / retention / redaction (D-16, may revisit if usage demands).
- Per-method timeout configuration via env var (researcher proposes fixed values; env override deferred until requested).
- Failure-mode captured fixtures — Phase 36 territory.
- Captured-fixture harness / one-shot capture script — Phase 36 owns the `MockGSDTools` infrastructure.
- `aof boards doctor` end-to-end ladder — Phase 38.
- Lock-state recording of SDK + tools versions (DIAG-06) — Phase 38 (Phase 33 only records the resolved `gsd-tools.cjs` path).
- `aof boards milestone create` placeholder UX (visible-with-instructions vs hidden until v1.8) — Phase 34/38.
- Lock-state schema versioning bump — not needed; LOCK_VERSION=2 permits additive fields per v1.1 Phase 9 decision.
