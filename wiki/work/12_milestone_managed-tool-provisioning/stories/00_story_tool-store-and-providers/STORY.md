---
type: story
number: 00
slug: tool-store-and-providers
title: "The tool store + provider registry — ~/.aof/tools/<name>/<version>/, store-first resolution, the npx+uv provider lanes (the spine)"
parent: 12
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
---
# 00 · The tool store + provider registry (the spine)

## User story

As the provisioning contract every managed tool (graphify, headroom, the next) and the lifecycle surface couple through,
I want one place that defines the store geometry (`~/.aof/tools/<name>/<version>/` rooted at `defaultGlobalWorkspaceDir`), the **store-first, PATH-fallback** resolver, and a pluggable provider registry (`npx` re-homed + a `uv venv` lane) keyed by a frozen tool descriptor,
so that aof owns a version-pinned dependency store in a relocatable home, an aof-managed install wins over a stray global, and adding the next tool is a descriptor + a registry key — never a new bespoke installer.

<!-- The SPINE: it freezes the store/resolution contract (ADR-001) and the provider/descriptor contract
     (ADR-002) the four sibling stories couple through. It owns no CLI command (01), no driver re-point
     (02/03), no arch-tests (04). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 12/00`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [store-path-and-resolution](tasks/00_store-path-and-resolution.feature)** — `toolStoreRoot`/`toolVersionDir` derive from `defaultGlobalWorkspaceDir` (`AOF_GLOBAL_HOME`-relocatable, no homedir literal); `resolveManagedBinary` resolves the store binary store-first then PATH-fallback, cross-platform (`{Scripts|bin}/<binary>[.exe]`), structured `{found:false,hint}` never a throw.
- [x] **01 · [provider-registry-and-uv-lane](tasks/01_provider-registry-and-uv-lane.feature)** — `planProvision` dispatches on `descriptor.provider`; the `uv` lane plans `uv venv` + `uv pip install --python` into the version dir; the `npx` lane delegates to the untouched `frameworks.mjs`; `dryRun` returns the command list without spawning; neither lane shells the other.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** the store + resolver,
**ADR-002** the provider registry + frozen tool descriptor). This story **owns**: the store path helpers in
[paths.mjs](../../../../../src/paths.mjs) (`toolStoreRoot`/`toolVersionDir`), a new `src/tool-store.mjs`
(the store-first `resolveManagedBinary` + the cross-platform exe rule + the `PACKAGE_BINARIES` map), and
the provider registry (the `uv` lane + the `npx` lane re-homed behind the registry, **delegating** to the
existing [frameworks.mjs](../../../../../src/frameworks.mjs) planner — not rewriting it) + the frozen tool
descriptor + the dry-run plan. It does **not** add the `aof project provision` command or doctor checks
(story 01), re-point any tool driver (02/03), or author `test/arch/*` (04).

**Independent because** it consumes only the already-shipped `paths.mjs`/`frameworks.mjs` seams and produces
the ONE frozen contract (ADR-001/002) that 01/02/03/04 consume; it is the spine they fan out from and
consumes none of their surfaces. The keystone is ADR-001's **store-first/PATH-fallback** order — what makes
the 06/09 retrofit non-breaking — and ADR-002's **`uv venv`** mechanism (NOT `uv tool install`, which is
not version-keyed; RESEARCH §"Store layout").

**Feasibility (developer amigo seat — confirmed at Contract):** Feasible, fully `@executable`. The store
geometry is a thin extension of `paths.mjs` (`toolStoreRoot`/`toolVersionDir` are one-liners over the
existing `defaultGlobalWorkspaceDir(env)` — already `AOF_GLOBAL_HOME`-relocatable at `src/paths.mjs:18-21`,
so the no-homedir-literal invariant is satisfied for free by deriving from it). `resolveManagedBinary` is a
bounded pure function: the cross-platform exe rule (win32 `Scripts/<bin>.exe`, POSIX `bin/<bin>`), the
`PACKAGE_BINARIES` map, and the store-first / PATH-fallback order are all expressible over the injected
`env`/`platform`/`pathValue`/`useLocator`/`probe` seams — the 09 resolver (`src/graphify.mjs:64-149`)
already proves the hermetic idiom (empty injected PATH + `useLocator:false` + degrade-to-null version
probe + `{found:false,hint}` no-throw miss), so the new resolver reuses it verbatim with a store-prefix
check bolted in front. No new live dependency.

**Load-bearing verdict — the npx lane CAN delegate to `frameworks.mjs` with NO rewrite.** `planFrameworkInstall(name, options)`
(`src/frameworks.mjs:48`) is already a pure plan emitter that takes `options.previousLock` / `options.force`
/ `options.dryRun` and returns the `["npx", pkg, runtimeFlag, scopeFlag]` argv plus the full lock/skip
machinery (`skipped`/`skipReason` keyed on framework/runtime/scope/source at lines 59-90), with
`SAFE_NPM_EXEC_ENV` (line 17) baked into each plan item and consumed by `executeFrameworkInstallPlan`
(line 94). The registry's `npx` provider is a one-line dispatch: `planProvision(descriptor,{dryRun,force,previousLock})`
→ `planFrameworkInstall(descriptor.name, {package:…, force, previousLock, dryRun})`. Lock/attempt/`--force`/`SAFE_NPM_EXEC_ENV`
are preserved byte-for-byte because nothing in `frameworks.mjs` is touched — and the existing
`test/frameworks.test.mjs` (18 hits across the four exports) stays the free regression net (ADR-005 inv. 4).
The `uv` lane is genuinely just a plan emitter: two argv `[["uv","venv",verDir],["uv","pip","install","--python",verDir,
"<spec>[extras]==<ver>"]]` over `toolVersionDir`, owning its own exec env — trivial under `dryRun`.

**One friction, not a blocker:** `frameworks.mjs`'s `dryRun` returns the `commands` (joined strings, via
`installFramework`), whereas `planProvision` is contracted to return the structured plan (the command
list) and the uv lane emits argv arrays. The npx provider should delegate to `planFrameworkInstall`
(the structured plan items) rather than `installFramework` (which collapses to strings), so both lanes
return a uniform plan shape. This is a thin adapter choice inside story 00, fully within the contract — no
contract change.
