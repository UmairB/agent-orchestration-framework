# Pitfalls Research: AOF v1.7 Typed GSD SDK Backend

**Domain:** Node ESM CLI migrating a brittle slash-command integration to a typed SDK adapter, plus a v1 backend abstraction.
**Researched:** 2026-05-16
**Confidence:** HIGH for SDK shape, drift surface, v1.6 migration risk; MEDIUM for fallback drift; LOW for upstream SDK milestone-creation timing.

---

## Summary

The v1.7 migration is **not** "replace shell with SDK" — it is "replace one shell-out with a typed wrapper around a different shell-out, while restructuring board lifecycle around explicit milestone identity, removing implicit `.planning/ROADMAP.md` sync, and introducing a backend seam where none existed."

Five things make this hazardous:

1. **`@gsd-build/sdk@0.1.0` is brand new and `GSDTools` still uses `execFile('node', ['gsd-tools.cjs', ...])` under the hood.** Adopting the SDK does not eliminate shellouts — it relocates them with a 30-second default timeout, a hard-coded default path, and JSON parsing of stdout (including a `@file:` indirection for large payloads).
2. **The published SDK (`0.1.0`) and the user's installed CLI (`gsd-sdk` v1.42.2 from `get-shit-done-cc`) are different version trains.** They can return divergent shapes for the same logical query. The SDK's `RoadmapAnalysis` even uses `[key: string]: unknown` to advertise instability.
3. **The published SDK has no `state.milestone-switch` or `init.new-milestone` runner.** `gsd-sdk query init` on the bundled CLI prints `'init' not in native registry; falling back to gsd-tools.cjs`. Composing a "create milestone from objective" flow on top of `@gsd-build/sdk@0.1.0` will either reimplement workflow glue the SDK is going to ship later, or silently couple AOF to whichever `get-shit-done-cc` is installed globally.
4. **Removing implicit ROADMAP.md sync hard-breaks every v1.6 board without `gsd.milestone.id`.** v1.6 validator doesn't even know about `gsd.milestone.id`. v1.6 boards will fail `not bound to a GSD milestone id` on the first run.
5. **A `BoardBackend` interface designed before there is a second backend will leak GSD assumptions.** The existing surface is deeply GSD-shaped. A "generic" interface here will either be a paper-thin rename or over-abstracted ceremony.

**Single best discipline for v1.7:** commit the seam at the smallest possible surface (4 methods + `kind: "gsd"` discriminant) and make every escape valve loud.

---

## Pitfall Catalogue

### Pitfall 1: Pinning `@gsd-build/sdk@^0.1.0` and silently inheriting breaking changes

**Symptom:** `npm install` later, `aof boards sync` throws `TypeError: tools.roadmapAnalyze is not a function`, or returns `phaseCount: 0` because a field rename in 0.2.x changed `RoadmapAnalysis.phases[].number` to `phaseNumber`.

**Why it happens:** Semver does not guarantee minor stability below 1.0.0. The SDK's `dist/types.d.ts` uses `[key: string]: unknown` index signatures — an explicit upstream notice that the shape will evolve.

**Prevention:**
- Pin to exact version (`"@gsd-build/sdk": "0.1.0"`), not `^0.1.0`. Exact pin is the only safe contract.
- Commit `package-lock.json`; run `npm run security:supply-chain` after every bump.
- Add a runtime contract test that imports `@gsd-build/sdk` and asserts the exact surface AOF depends on. Fail boot if not.
- On every SDK bump, run smoke test against known fixture; treat as gate.

**Owning phase:** Phase 33 (SDK adapter foundation).

---

### Pitfall 2: Confusing the published SDK (`@gsd-build/sdk@0.1.0`) with the bundled CLI (`gsd-sdk` v1.42.2)

**Symptom:** AOF logs say "Using @gsd-build/sdk 0.1.0" but user reports behavior only present in v1.42.2. Or: user assumes "I have `gsd-sdk` globally, so it must work" but published 0.1.0 has no init handler.

**Why it happens:** Same `name` field, different release trains. Published SDK's `GSDTools` defaults `gsdToolsPath` to `~/.claude/get-shit-done/bin/gsd-tools.cjs`. If user has a different `gsd-tools.cjs` at that path (e.g. from `gsd-pi` or `get-shit-done-cc`), the SDK silently uses *their* version.

**Prevention:**
- Adapter boot calls `tools.configGet("version")` + reads `@gsd-build/sdk/package.json` and compares. Doctor surfaces `version-mismatch` warning.
- Explicitly set `gsdToolsPath` in every `new GSDTools({...})` rather than relying on home-dir default.
- Record both versions in lock state (`.aof/lock/packages.json`).
- Doctor fails closed when SDK is `0.x` and resolved `gsd-tools.cjs` is missing.

**Owning phase:** Phase 33 (boot probe) + Phase 38 (doctor surface).

---

### Pitfall 3: Believing "typed SDK = no shellout" and exposing users to the lie

**Symptom:** Docs say "v1.7 replaces shell with typed SDK." User reports `aof boards sync` hanging 30s then `GSDToolsError: gsd-tools timed out`. Performance *worse* than v1.6 (Node cold start per call).

**Why it happens:** `GSDTools.exec` does `execFile('node', [this.gsdToolsPath, command, ...args, '--raw'], { timeout: 30_000, maxBuffer: 10MB })` per call — fresh node process, JSON parsing, `@file:` indirection.

**Prevention:**
- Docs and release notes state: "SDK provides typed call sites; `gsd-tools.cjs` continues to execute out-of-process. The `--raw` JSON contract is the durable interface, not the SDK class."
- Batch related calls in adapter: load full state once via `stateLoad()` + `roadmapAnalyze()` and reuse.
- Wrap every adapter method in `GsdAdapterError` mapping `GSDToolsError` `{command, args, exitCode, stderr}` into actionable messages. Do NOT re-throw `GSDToolsError` to CLI users.
- Set explicit `timeoutMs` per method (10s for reads, 60s for `phaseComplete`).
- Verify `node` resolves from spawned env on Windows. Add `aof doctor` check.

**Owning phase:** Phase 33 (error wrapping + timeout policy) + Phase 38 (doctor).

---

### Pitfall 4: Implicit-sync removal silently breaking every v1.6 board

**Symptom:** After upgrade, `aof boards sync delivery` (worked yesterday) throws `Board delivery is not bound to a GSD milestone id`. Board has `gsd.milestone.roadmapPath` set and `status: "synced"` but no `gsd.milestone.id` because v1.6 creation never wrote it.

**Why it happens:** v1.6 `syncBoardFromGsdRoadmap` only required `roadmapPath`. v1.7 adds milestone-id requirement that v1.6 boards lack. Validator never checked `gsd.milestone.id`. `repairBoard` doesn't set it; only `attachBoardMilestoneRoadmap` does.

**Prevention:**
- Ship explicit migration:
  1. `aof boards doctor` detects v1.6-shaped boards and emits `BOARD_MILESTONE_ID_MISSING` warning with exact `aof boards milestone attach <id> --milestone <inferred-id> --roadmap <path>` invocation.
  2. Infer `<milestone-id>` from roadmap path when possible (e.g. `.planning/milestones/v1-6/ROADMAP.md` → `v1-6`); when ambiguous, suggest reading `.planning/STATE.md` `current_milestone`.
  3. Extend `repairBoard` to auto-attach if `assertMilestone` finds exactly one match; otherwise emit fix-it message.
  4. Do NOT silently auto-pick a milestone. Wrong attach is harder to detect than missing attach.
- BDD scenario materializing v1.6-shaped board on disk; assert v1.7 migration produces clean board.
- Update `validateBoardShape` to surface missing `gsd.milestone.id` as warning during deprecation window.

**Owning phase:** Phase 34 (board lifecycle migration) + Phase 36 (test surface migration).

---

### Pitfall 5: Designing `BoardBackend` for hypothetical backends and locking in the wrong shape

**Symptom:** Six months later, second backend reveals interface bakes in GSD-isms (`milestone.roadmapPath` is markdown, `commands: ["$gsd-discuss-phase 30", ...]`, `phase` refs as numeric strings). "Abstraction" is just rename; ports of non-GSD forced into GSD vocabulary. Or opposite: interface so generic (`backend.do(action, payload)`) that GSD code becomes harder to read.

**Why it happens:** With one implementation, every "neutral" choice is actually a GSD choice in disguise.

**Prevention:**
- **Minimal seam, no generalisation.** Define `BoardBackend` as discriminated union with `kind: "gsd"`. v1 only ships the `gsd` variant. Reject other values with "v1.7 supports gsd only". Callers narrow via `backend.kind === "gsd" && backend.gsd.milestone...`.
- Define interface by what `boards.mjs` actually needs today: `loadState()`, `analyzeRoadmap()`, `assertMilestone(milestoneId)`, `syncBoardFromMilestone(board, milestoneId)`. Four methods. Everything else stays GSD-specific.
- Document: "v1.7 does not promise `BoardBackend` shape is stable; it is a seam, not a contract."
- Keep `gsd.milestone.session.turns`, `gsd.milestone.invocation`, runtime-CLI data inside `backend.gsd.runtime` sub-object so a future backend doesn't have to model a "session with turns" concept.

**Owning phase:** Phase 35 (BoardBackend seam) — *after* the adapter is real so the interface is extracted from working code.

---

### Pitfall 6: The slash-command fallback drifting from the SDK-first path

**Symptom:** Months in, interactive CLI fallback handles a flow the SDK path doesn't, or vice versa. Bug fixes land on one path. Tests cover only one path.

**Why it happens:** `gsd-runtime.mjs` already has two CLIs (claude/codex) + test-status env override + runtime-output classifiers. Adding "SDK" as third triples surface. Each has own session-turn semantics.

**Prevention:**
- Single call site picks exactly one of `sdk | claude | codex` and routes once. Default is `sdk` unless operation literally requires interactive runtime (milestone-creation, until SDK ships runner).
- Define tiny shared result shape `{ status, exitCode, stdout, stderr, runtime, startedAt, endedAt }` both paths produce. v1.6 already uses this.
- Mark fallback as "deprecated, retained for interactive workflows only" in help. Print `[fallback runtime=claude] SDK path unavailable for <reason>; using CLI` to stderr every invocation. Loud-and-ugly prevents drift.
- BDD covers both paths via `--runtime` parameter; reuse `AOF_TEST_GSD_RUNTIME_STATUS`; add `AOF_TEST_GSD_SDK_STATUS` for SDK.
- One "fallback honesty" unit test: SDK and CLI paths produce identical `gsd.milestone.status` transitions for same input.

**Owning phase:** Phase 37 (runtime fallback hardening) — after Phase 33, before Phase 36.

---

### Pitfall 7: SDK timeouts, child errors, and `@file:` indirection failing on Windows

**Symptom:** Windows user gets `GSDToolsError: Failed to parse gsd-tools output for "roadmap": Unexpected token C in JSON at position 0`. The "C" is start of `C:\...` from `@file:` redirect with unquoted spaces. Or `phaseComplete` hangs 30s.

**Why it happens:**
- `execFile('node', [path, ...])` requires `node` on PATH; resolves without shell quoting.
- SDK's `parseOutput` does `readFile(filePath, 'utf-8')` on `@file:` indirection without path validation.
- CRLF + BOM at start of stdout breaks JSON parsing.
- `cwd: this.projectDir` may not handle UNC paths.

**Prevention:**
- Normalize paths via `path.resolve(projectDir)` at adapter boundary; assert `path.isAbsolute`.
- Drop `shell: process.platform === "win32"` from SDK path; keep only for CLI fallback.
- Strip BOM and trim before JSON parse in AOF adapter (defense in depth).
- Document CRLF: keep `/\r?\n/` everywhere markdown is read.
- Add Windows-specific BDD (`test:integration:ps`) with spaces-in-path + non-default drive.
- For UNC, doctor warns: "Project directory is a UNC path; mount as a drive letter."

**Owning phase:** Phase 38 (diagnostics) + Phase 36 (Windows BDD).

---

### Pitfall 8: Reimplementing GSD's milestone-creation workflow because the SDK doesn't expose one

**Symptom:** Adapter grows `createMilestoneFromObjective(objective)` that does `tools.exec("state", ["milestone-switch", ...]); spawn("claude", ["-p", "/gsd:new-milestone " + objective]); tools.exec("roadmap", ["analyze"])`. The brittle composite v1.7 is supposed to delete, just hidden behind typed wrapper. No atomicity.

**Why it happens:** Published SDK exposes `MilestoneRunnerOptions`/`MilestoneRunnerResult` and `GSD.prototype.run(prompt)` for milestone *execution*, but nothing for *creation from fresh objective*. Zero hits in `dist/*.js` for `milestone-switch` or `new-milestone`. Bundled CLI v1.42.2 routes `init new-milestone` through `gsd-tools.cjs` ('init' not in native registry).

**Prevention:**
- **Do not compose.** Safe v1.7 design: typed reads + assertions on AOF side; *handoff* to CLI runtime for milestone *creation*. Identical to v1.6's pattern. Milestone creation is genuinely interactive.
- Adapter exposes `createMilestoneViaRuntime(objective, runtime)` calling `continueGsdMilestone` and labels result `runtime: "claude"|"codex"`, NOT `"sdk"`. Honesty over uniformity.
- After runtime returns `status: "completed"`, *then* SDK path takes over: `roadmapAnalyze()` + `assertMilestone(id)`. Smallest possible composite that survives an SDK that later adds `MilestoneRunner`.
- DO NOT call `tools.exec("state", ["milestone-switch"])` directly from AOF — bypasses abstraction.

**Owning phase:** Phase 33 ("no composites" rule) + Phase 37 (handoff implementation).

---

### Pitfall 9: Test doubles at the wrong layer making tests pass while production breaks

**Symptom:** Unit tests mock entire `gsd-sdk-adapter`, pass. Integration tests use env var path, pass. First user runs `aof boards sync` against real `gsd-tools.cjs` and gets shape mismatch because fixtures hand-encoded `RoadmapAnalysis` rather than capturing real SDK output.

**Why it happens:** v1.6 stubs at top (env var) or filesystem layer. v1.7 introduces new layer (SDK). Mocking SDK methods at adapter boundary skips JSON parsing, `@file:` indirection, error mapping.

**Prevention:**
- Two-tier test doubles:
  1. **`MockGSDTools`** — stub implementing methods AOF uses with return values from **captured real fixtures** under `test/fixtures/gsd-sdk/<scenario>/`. Capture once by running real `gsd-tools.cjs` against temp project. Re-capture when SDK upgraded.
  2. **Adapter contract test** booting *real* `GSDTools` against controlled `.planning/` fixture. Slow, integration-only, proves JSON-over-process boundary works.
- Do NOT mock at `boards.mjs` layer for boards tests.
- Keep `AOF_TEST_GSD_RUNTIME_STATUS` for CLI fallback only. Introduce `AOF_TEST_GSD_SDK_FIXTURE=<name>` for SDK path.
- Migrate existing fallback tests to keep as fallback; clone for SDK path.
- BDD scenarios at `boards.feature:70-106` assert specific stdout strings. Don't delete; clone for SDK path.

**Owning phase:** Phase 36 (test surface migration); Phase 33 produces first fixture.

---

### Pitfall 10: Removing CRLF / line-ending and path-quoting safeguards from runtime layer

**Symptom:** After "cleanup" PRs, Windows user's `aof boards milestone answer delivery --text "1"` fails because answer text not quoted correctly. Or `parseRoadmapPhases` regex stops matching after CRLF/BOM edit.

**Why it happens:** v1.7 tempting territory to "modernise" runtime layer. But fallback still needs Windows-specific safeguards:
- `src/gsd-runtime.mjs:141` `shell: process.platform === "win32"` — required for `claude.cmd`/`codex.cmd` shims.
- `parseRoadmapPhases` uses `/\r?\n/` and Unicode emoji regex — must survive migration.
- `relativeProjectPath` uses `.split(path.sep).join("/")` for cross-platform storage — adapter must follow.

**Prevention:**
- Inventory Windows-specific code before deletion. Tag with `// WINDOWS-FALLBACK: required for <reason>`.
- CLI fallback retains `shell: process.platform === "win32"`. SDK path doesn't need it.
- CRLF tolerance everywhere markdown is read. Regression test: ROADMAP.md with `\r\n` + BOM, sync, assert success.
- Forward-slash path canonicalisation stays.
- `.gitattributes`: `* text=auto eol=lf` for `.aof/`, `.planning/` JSON/MD so `canonicalFingerprint` matches across OS.

**Owning phase:** Phase 37 (runtime fallback hardening) + Phase 36 (regression tests).

---

## Migration Risks (v1.6 → v1.7)

| Risk | Severity | Mitigation | Phase |
|------|----------|------------|-------|
| Existing boards lack `gsd.milestone.id` | **High** — every v1.6 GSD-backed board breaks on first `sync` | Doctor + auto-infer milestone id from `roadmapPath`; clear `attach` hint; deprecation window | Phase 34 |
| `gsd.milestone.session.turns` schema legacy when SDK provides `GSDEventStream` | Medium | Single storage shape supports both; mark `source: "sdk"` vs `"runtime"` | Phase 35 |
| `defaultExecutionRuntime` constrained to `claude\|codex`; SDK adds `sdk` | Medium | Add `sdk` as valid value; keep `claude\|codex` valid for fallback | Phase 34 |
| `executions/<task>.json` records GSD-specific `phase` refs and `$gsd-discuss-phase` commands — leaks under BoardBackend seam | Medium | Keep existing shape under `backend.gsd.execution.commands`; do not promote to abstract interface | Phase 35 |
| Tests asserting `$gsd-new-milestone` invocation strings (`boards.feature`) | Low | Keep "fallback" variant + add "sdk" variant explicitly | Phase 36 |
| `boards.mjs` `parseRoadmapPhases` is only ROADMAP.md parser; SDK may classify phases differently | Medium | SDK as source of truth; remove `parseRoadmapPhases` from sync path; retain only for diagnostic warnings | Phase 33 |
| Lock state in `.aof/lock/packages.json` doesn't record SDK or tools version | Medium | Add `sdkVersion` and `toolsVersion` fields; record on every adapter boot | Phase 38 |

---

## Test Strategy Risks

| Risk | Mitigation |
|------|------------|
| Mocking entire `GSDTools` class | Mock with captured real fixtures; refresh on SDK upgrade |
| Mocking at `boards.mjs` adapter boundary | Tests for `boards.mjs` go through adapter (with `MockGSDTools` injected) |
| Reusing `AOF_TEST_GSD_RUNTIME_STATUS` for SDK path | Introduce `AOF_TEST_GSD_SDK_FIXTURE=<name>` env; keep runtime status for CLI fallback |
| BDD execs real `claude`/`codex` | Always use env-var stubbing path; never call real CLIs in CI |
| No contract test against real SDK import | Add `test:integration:sdk-contract` booting real `GSDTools` against temp `.planning/` |
| BDD scenarios assert exact stdout strings | Acceptable as user-facing contract; document strings as public, version in release notes |
| `canonicalFingerprint` cross-platform CRLF mismatch | Enforce LF via `.gitattributes` for `.aof/**/*.json` and `.planning/**/*.md` |

---

## Windows Risks

| Risk | Mitigation |
|------|------------|
| `node` not on PATH for spawned SDK process | `aof doctor` checks `which/where node`; warns on failure |
| Paths with spaces (`C:\Program Files\nodejs`, `C:\Source\My Project`) | Resolve via `path.resolve` at adapter boundary; Windows BDD with spaces-in-path |
| UNC paths (`\\server\share\project`) | Doctor warns; fail clean with "mount as drive letter" hint |
| CRLF in `.planning/ROADMAP.md` | `/\r?\n/` everywhere; CRLF BDD fixture |
| BOM at start of `gsd-tools.cjs` stdout | Strip BOM at adapter boundary before parse |
| `claude.cmd`/`codex.cmd` shim resolution | Keep `shell: process.platform === "win32"` for CLI fallback only |
| `path.sep` mixing in board JSON | Canonicalise all stored paths to forward slashes at adapter boundary |
| `.gitignore` modifications in working tree | Review change; ensure `.aof/cache/boards/index.json` handling consistent |
| `AOF_DATA_DIR` and `AOF_GLOBAL_HOME` env mismatches under PowerShell | Doctor checks for stale env vars from previous CI runs |
| `gsd-pi` (2.58.0) installed alongside `get-shit-done-cc` (gsd-sdk 1.42.2) | Lock state records resolved path + version; doctor warns on multiple installations |

---

## Slash-Command Fallback Risks

| Risk | Mitigation |
|------|------------|
| Drift between SDK-first and CLI-fallback | Single result shape used by both; unit test asserts identical milestone status transitions |
| Fallback used silently | Always print `[fallback runtime=<x>] SDK path unavailable for <reason>; using CLI` to stderr |
| `runtimeOutputHasCommandFailure`/`runtimeOutputNeedsUser` regexes are CLI-only | Adapter never feeds SDK output to classifiers |
| Slash-command prompts (`$gsd-new-milestone`, `/gsd:new-milestone`, `/gsd-new-milestone`) embedded | Doctor verifies `.codex/skills/gsd-new-milestone/SKILL.md` + `.claude/commands/gsd/new-milestone.md` reference expected command id |
| Two session-recording shapes in same `BOARD.json` | Pick one storage shape (v1.6 `session.turns`); adapter converts SDK events into `{role: "runtime", text}` turns; preserve raw SDK events under `session.events` |
| Fallback invoked when SDK would have worked | Default to SDK; only fallback when (a) operation interactive or (b) SDK boot fails. Log reason every time. |
| Removing slash-command code prematurely | Plan removal for v1.8+ when SDK has interactive runners and v1.6 boards migrated. Mark `gsd-runtime.mjs` exports as "stable for v1.7" not "deprecated." |

---

## "Looks Done But Isn't" Checklist

- [ ] SDK adapter typed methods exist — verify each is *actually called* by `boards.mjs`.
- [ ] `aof boards sync` works on fresh v1.7 board AND on captured v1.6 fixture.
- [ ] `package.json` shows `"@gsd-build/sdk": "0.1.0"` — verify `package-lock.json` matches and contract test passes.
- [ ] SDK + tools versions appear in `aof doctor` output — when *mismatched*, not just matching.
- [ ] `GSDToolsError` does not leak — grep test fixtures and CLI output for `gsd-tools exited with code`: zero hits.
- [ ] BoardBackend seam: only one consumer (`boards.mjs`), only one implementation; no dead-code "future" backends.
- [ ] v1.6 boards open without error — check out v1.6 commit, create board, upgrade, run `aof boards doctor`.
- [ ] Fallback honesty: stderr shows `[fallback runtime=…]` notice when CLI path runs — verify by intentionally breaking SDK boot.
- [ ] `test:integration:ps` exercises SDK adapter — not just Node runner.
- [ ] `sdkVersion` and `toolsVersion` appear in lock JSON after fresh `aof init`.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| SDK shape changed between minor versions | LOW | Update fixtures, bump pin, regenerate captured stdout |
| Bundled vs published version mismatch in production | MEDIUM | Document resolution path; ship vendored `gsd-tools.cjs` if needed; warn in doctor |
| v1.6 boards broken in field | MEDIUM | Ship `aof boards doctor --fix-v16-milestone-ids` one-shot migration; document in release notes |
| BoardBackend leaks GSD assumptions | HIGH | Hard to fix after v1.8 ships a second backend; mitigate by keeping interface minimal in v1.7 |
| Fallback and SDK paths drift | MEDIUM | Add parity unit test; audit every PR touching one path |
| Windows-only failure after refactor | LOW-MED | Restore deleted `shell: process.platform === "win32"` for CLI fallback only |
| `gsd-tools.cjs` resolution finds wrong binary | MEDIUM | Doctor surfaces resolved path; user overrides via env or uninstall conflicting global |

---

## Pitfall-to-Phase Mapping

| Pitfall | Owning Phase | Verification |
|---------|--------------|--------------|
| 1. 0.x SDK semver | Phase 33 | Contract test + exact-pin lint in CI |
| 2. Bundled vs published version drift | Phase 33 + Phase 38 | Doctor surfaces both versions; lock state records both |
| 3. SDK still shells out | Phase 33 | Adapter docs explicit; error wrapping audited; per-method timeouts |
| 4. v1.6 board migration | Phase 34 | BDD with captured v1.6 board JSON; doctor migration path |
| 5. BoardBackend overshoot | Phase 35 | Interface ≤4 methods; only `kind: "gsd"` ships |
| 6. Slash-command fallback drift | Phase 37 | Parity unit test; fallback always logs to stderr |
| 7. Windows specifics | Phase 36 + Phase 38 | `test:integration:ps` covers SDK path; doctor checks `node` PATH, UNC, BOM |
| 8. No SDK milestone-creation runner | Phase 33 + Phase 37 | Adapter has no `tools.exec("state", ["milestone-switch"])`; handoff explicit |
| 9. Test doubles wrong layer | Phase 36 | Captured fixtures; `MockGSDTools` only; adapter contract test in integration suite |
| 10. CRLF / quoting safeguards | Phase 37 + Phase 36 | Windows BDD with spaces/CRLF; `.gitattributes` enforces LF |

**Recommended phase ordering:** Phase 33 (adapter) lands first. Phase 34 (board lifecycle) + Phase 37 (runtime fallback) can run in parallel once 33 stable. Phase 35 (BoardBackend seam) extracts from working code, not designed up-front. Phase 36 (tests) runs alongside every phase. Phase 38 (doctor) closes the milestone.
