# Stack Research: AOF v1.7 Typed GSD SDK Backend

**Researched:** 2026-05-16
**Confidence:** HIGH (direct verification of installed package metadata + live npm registry queries)

---

## Key Findings

- **One new direct dep is enough**: `@gsd-build/sdk@0.1.0`, pinned exactly. No new dev dep, no direct `ws`, no direct `@anthropic-ai/claude-agent-sdk`.
- **Node engine already compatible**: SDK declares `engines.node >=20`, matching AOF.
- **SDK ships TypeScript `.d.ts`** for every export — AOF (a `.mjs` project) gets editor-level types for free without adopting TS.
- **Critical version-drift risk**: two `@gsd-build/sdk` lineages share the same package name. npm has only `0.1.0` (maintainer `glittercowboy`, 2026-03-27). The local `gsd-sdk` binary resolves via `get-shit-done-cc@1.42.2`, whose bundled `sdk/package.json` declares `@gsd-build/sdk@1.42.2` — a different release lineage (TÂCHES, frequent CI publishes). API delta unknown but likely non-trivial. AOF must surface a doctor diagnostic when these don't match.
- **The SDK is a thin bridge, not a state engine**: `GSDTools` shells out to `~/.claude/get-shit-done/bin/gsd-tools.cjs`. AOF still depends on a globally-installed GSD CLI for typed reads to work; the adapter should accept a `gsdToolsPath` override that `src/frameworks.mjs` can supply.

---

## Versions and Compatibility

### `@gsd-build/sdk@0.1.0` (the only required addition)
- Latest = only = `0.1.0`, published 2026-03-27, maintainer `glittercowboy`, MIT, ESM, 375 KB unpacked, 69 files.
- `engines.node >=20` (matches AOF).
- Types shipped: `dist/index.d.ts` + per-module `.d.ts`.
- Bin: `gsd-sdk -> dist/cli.js` (AOF uses library exports, not the bin).
- Direct deps: `@anthropic-ai/claude-agent-sdk@^0.2.84`, `ws@^8.20.0`.
- Verified exports (`dist/index.d.ts`): `GSD`, `GSDTools`, `GSDToolsError`, `GSDEventStream`, `parsePlan`, `parsePlanFile`, `loadConfig`, `runPlanSession`, `runPhaseStepSession`, `buildExecutorPrompt`, `parseAgentTools`, `ContextEngine`, `PHASE_FILE_MANIFEST`, `getToolsForPhase`, `PHASE_AGENT_MAP`, `PHASE_DEFAULT_TOOLS`, `PromptFactory`, `extractBlock`, `extractSteps`, `PHASE_WORKFLOW_MAP`, `GSDLogger`, `PhaseRunner`, `PhaseRunnerError`, `CLITransport`, `WSTransport`, `InitRunner`.
- `GSDTools` surface: `exec`, `execRaw`, `stateLoad`, `roadmapAnalyze`, `phaseComplete`, `commit`, `verifySummary`, `initExecutePhase`, `initPhaseOp`, `configGet`, `stateBeginPhase`, `phasePlanIndex`, `initNewProject`, `configSet`.

### `@anthropic-ai/claude-agent-sdk` (transitive — do NOT add direct)
- Latest `0.3.143` (2026-05-15). GSD SDK pin `^0.2.84` resolves under npm caret-on-zero-major to `>=0.2.84 <0.3.0`, so AOF gets a `0.2.x` install, ~2 months stale.
- Author Anthropic, `engines.node >=18`, ESM, ~4.5 MB.
- Peer deps (not auto-installed): `zod@^4.0.0`, `@anthropic-ai/sdk@>=0.93.0`, `@modelcontextprotocol/sdk@^1.29.0`. Inert if AOF doesn't import directly.
- Optional Windows binaries `@anthropic-ai/claude-agent-sdk-win32-x64` / `-win32-arm64` — install non-fatal if download fails.

### `ws@^8.20.0` (transitive) — pure JS, Windows-safe, only used by `WSTransport` (v1.7 defers).

---

## Required Additions (minimum diff to `package.json`)

```json
"dependencies": {
  "@inquirer/prompts": "^8.4.2",
  "@gsd-build/sdk": "0.1.0"
}
```

```bash
npm install @gsd-build/sdk@0.1.0 --save-exact
```

Pin exactly (no `^`, no `~`) because (a) only one version exists on npm, (b) maintainer/lineage situation makes any future bump a manual review, (c) drift detection in the doctor command depends on a deterministic local version string.

No new dev dependencies needed. No engine bump needed.

---

## Optional / Considered-but-Rejected

| Option | Verdict | Reason |
|---|---|---|
| Direct dep on `@anthropic-ai/claude-agent-sdk` | Reject | Reimplements ~12K lines of GSD state logic AOF is consolidating behind a single adapter |
| Shell out to global `gsd-sdk` CLI | Reject as primary; OK as runtime fallback | Reintroduces text scraping — exactly what v1.7 fixes |
| `@gsd-build/sdk` via git URL pinned to SHA | Reject | Slow install, opaque to security audits, breaks offline mirrors |
| Direct `ws@^8.20.0` | Reject (defer) | Only needed for `WSTransport`, which v1.7 explicitly defers |
| Vendor SDK source under `vendor/` | Reject | Loses upstream fixes |
| Switch to `gsd-pi@2.58.0` | Reject | Different package, different API |

---

## Integration Notes (existing single-dep ESM CLI)

- AOF is `"type": "module"` + `.mjs`. SDK `exports."."` has `import: ./dist/index.js` + `types: ./dist/index.d.ts`. `import { GSDTools, parsePlanFile, loadConfig } from '@gsd-build/sdk'` from `.mjs` works with no flags.
- `GSDTools` shells out via `child_process` to `~/.claude/get-shit-done/bin/gsd-tools.cjs` (default; configurable via `gsdToolsPath` constructor option). AOF must:
  - Pass `shell: process.platform === 'win32'` consistent with `src/gsd-runtime.mjs`.
  - Surface clear error wrapping `GSDToolsError` (SDK already exposes `{command, args, exitCode, stderr}`).
  - Allow injecting `gsdToolsPath` from AOF's framework-install resolver (`src/frameworks.mjs`) so users without `~/.claude/get-shit-done/` still work.
- Typed-surface mapping to v1.7's adapter goals:
  - `loadGsdState` → `new GSDTools({projectDir}).stateLoad()` → `Promise<string>` (raw state.json).
  - `analyzeGsdRoadmap` → `GSDTools#roadmapAnalyze()` → `Promise<RoadmapAnalysis>` with typed phase array.
  - `assertMilestone` → compose `stateLoad` + `initNewProject()`; compare against `--milestone <id>`.
  - `syncBoardFromGsdMilestone` → `GSDTools#phasePlanIndex(phaseNumber)` for per-phase plans; mutate task state via `src/boards.mjs`.
  - `GSD`, `PhaseRunner`, `InitRunner`, `MilestoneRunner` are NOT needed for v1.7 — they orchestrate Claude Agent SDK sessions (execution), which AOF keeps in the runtime CLI fallback path.
- Supply-chain audit (`scripts/supply-chain-audit.mjs`) allowlist update needed for `@gsd-build/sdk@0.1.0`, `@anthropic-ai/claude-agent-sdk@0.2.x` + Windows native binary, `ws@8.x`.
- UI workspace: SDK is Node-only — never import from `ui/src/**`. The setup-ui HTTP API is the browser bridge. A lint rule rejecting `@gsd-build/sdk` imports under `ui/src/**` is cheap insurance.

---

## Version Drift Strategy (most important section)

**The drift**: Both lineages publish/declare the same `name: "@gsd-build/sdk"`. npm has only `0.1.0` (`glittercowboy`, 2026-03-27). The CLI-bundled SDK inside `get-shit-done-cc@1.42.2` declares `@gsd-build/sdk@1.42.2`. So `npm install @gsd-build/sdk` always yields `0.1.0`, but the `gsd-sdk` binary on PATH runs `1.42.2`'s code. API delta unknown but likely non-trivial.

### Detection (build into `aof packages doctor` / `aof boards sync`)

1. Read `node_modules/@gsd-build/sdk/package.json` → `installedSdkVersion` (expect `0.1.0`).
2. Spawn `gsd-sdk --version` → `cliBundledVersion` (will be e.g. `1.42.2`).
3. If different, emit a **warning** (not fatal — typed reads route through `gsd-tools.cjs` which both lineages share):
   > AOF is using `@gsd-build/sdk@{installed}` but the global `gsd-sdk` CLI is bundled with `@gsd-build/sdk@{cliBundled}`. State semantics may drift. Update `get-shit-done-cc` or re-pin AOF's SDK.
4. Sanity-check `~/.claude/get-shit-done/bin/gsd-tools.cjs` exists and is readable; surface remediation hint if not.

### Pinning discipline

| Layer | Strategy | Reason |
|---|---|---|
| `@gsd-build/sdk` in deps | Exact `"0.1.0"` | Only version on registry |
| `@anthropic-ai/claude-agent-sdk` | No direct dep | AOF's contract is with GSD SDK |
| `ws` | No direct dep | Only WSTransport, deferred |
| `engines.node` | Keep `>=20` | Matches SDK |
| `package-lock.json` | Commit it | Locks `0.2.x` of claude-agent-sdk |
| CI guard | Reject widening to a range | Prevent accidental `npm install` from reintroducing `^0.1.0` |

### When to bump
Only when (a) a new version appears on npm with changelog explaining the lineage relationship, (b) the maintainer publishes a `1.x` aligned with the CLI lineage, or (c) AOF needs an API only in the CLI-bundled SDK — temporarily install from the CLI bundle's `sdk/` directory and document the deviation.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `@gsd-build/sdk@0.1.0` is single, three-month-old release by different maintainer; may be abandoned | **HIGH** | Pin exactly; hide behind `BoardBackend` interface so swap is one-file work |
| Bundled CLI SDK (`1.42.2`) and published SDK (`0.1.0`) diverge in JSON shape from `gsd-tools.cjs` | **HIGH** | Doctor diagnostic; shape-validate before use |
| Transitive `@anthropic-ai/claude-agent-sdk@^0.2.84` is two months behind active `0.3.143` (minor = likely breaking) | MEDIUM | Acceptable for v1.7 (no session execution); reassess for WS event streaming |
| Optional Windows native binary may be flaky | MEDIUM | Verify install on Windows 11 before milestone close |
| Peer-dep unmet warnings (`zod`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`) | LOW | Document as expected; AOF doesn't import agent SDK directly |
| `gsd-tools.cjs` default path fragile for users without GSD globally installed | MEDIUM | Adapter accepts `gsdToolsPath` override via `src/frameworks.mjs` |
| Supply-chain surface expands from 1 to ~30+ transitives | LOW | Update `scripts/supply-chain-audit.mjs` allowlist |
| Browser bundle could accidentally import SDK | LOW | Lint rule rejecting imports under `ui/src/**` |
| SDK `engines.node >=20` vs bundled CLI `engines.node >=22` may confuse Node-20 users | LOW | Document: AOF on Node 20, CLI on Node 22 |

---

## Roadmap Implications

- One `package.json` task: pin `@gsd-build/sdk@0.1.0` with `--save-exact`; no engine bump.
- One supply-chain-audit task: update allowlist for ~30+ transitives.
- One adapter-implementation task: thin `src/gsd-sdk-adapter.mjs` wrapping `GSDTools` for `loadGsdState` / `analyzeGsdRoadmap` / `assertMilestone` / `syncBoardFromGsdMilestone`, with `gsdToolsPath` injectable.
- One doctor task: SDK-vs-CLI version drift diagnostic; warn-not-fail.
- One UI-guard task: lint rule rejecting `@gsd-build/sdk` imports under `ui/src/**`.
- Explicitly out of v1.7: direct `ws` dep, direct `@anthropic-ai/claude-agent-sdk` dep, `WSTransport`/event-stream UI, `PhaseRunner`/`MilestoneRunner`/`InitRunner` integration.

---

## Open Questions for Follow-up Research

- Does `glittercowboy`'s `@gsd-build/sdk@0.1.0` share the SAME `gsd-tools.cjs` JSON contract as `get-shit-done-cc@1.42.2`'s bundled `gsd-tools.cjs`? Verifiable by diffing the bundled `gsd-tools.cjs` against what `GSDTools` expects.
- Will `gsd-pi@2.58.0` eventually expose its own typed SDK that supersedes `@gsd-build/sdk`? Worth a watch but not a v1.7 dependency.
