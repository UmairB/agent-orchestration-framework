---
type: story
number: 04
slug: provisioning-fitness
title: "The provisioning fitness functions — store-first, global-home, provider-neutral, npx-preserved, uninstall-scoped — as arch-tests"
parent: 12
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
---
# 04 · The provisioning fitness functions — the load-bearing structural guarantee

## User story

As the architecture itself (the "aof owns a relocatable, version-pinned tool store, a managed install wins, the npx lane is untouched, uninstall is store-scoped" guarantee),
I want the five structural invariants of ADR-005 — store-first resolution, `AOF_GLOBAL_HOME`-honoured/no-hardcoded-home, provider-neutral registry, npx-lane-preserved, uninstall-store-scoped — enforced as CI arch-tests,
so that the contract is **durable**: a future change that resolves PATH-first, hardcodes the store home, leaks a provider assumption across lanes, regresses the npx installer, or widens uninstall beyond the version dir fails CI loudly.

## Tasks

<!-- This story's deliverable is the FITNESS FUNCTIONS of ADR-005 — arch-tests, NOT task `.feature`
     scenarios (structural invariants belong in the fitness-functions table, never inside a behaviour
     feature). Its contract is already fully specified by ADR-005's fitness-functions table — there is no
     Three-Amigos `.feature`-authoring pass; `aof:continue 12/04` authors the five arch-tests directly and
     they turn GREEN as 00/01/02/03 land. The five arch-tests are tracked here as the story's buildable units. -->

- [x] `test/arch/acd-tool-store-resolution-order.test.mjs` — **store-first resolution**: a managed tool (and the re-pointed graphify/headroom lookups) resolves the store binary ahead of PATH; PATH-fallback on a store miss; structured `{found:false,hint}` no-throw — ADR-005 inv. 1
- [x] `test/arch/acd-tool-store-global-home.test.mjs` — **AOF_GLOBAL_HOME honoured**: the store root relocates under `AOF_GLOBAL_HOME`; no `os.homedir()`/`".aof"` literal in the store/provision code — ADR-005 inv. 2
- [x] `test/arch/acd-provider-neutral-registry.test.mjs` — **provider-neutral**: the uv lane never shells `npx`, the npx lane never shells `uv`; dispatch keys on `descriptor.provider` — ADR-005 inv. 3
- [x] `test/arch/acd-npx-lane-preserved.test.mjs` — **npx lane preserved**: `frameworks.mjs`'s planner/executor/lock semantics + npx argv shape intact; existing GSD/framework tests stay green (GREEN-now regression guard) — ADR-005 inv. 4
- [x] `test/arch/acd-uninstall-store-scoped.test.mjs` — **uninstall store-scoped**: removal targets only `toolVersionDir(name,version)` under the store root, never a global/system/PATH path — ADR-005 inv. 5

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-005 — the load-bearing
deliverable**). This story **owns** the five arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It authors **no production code**.

**Independent because** it asserts against the **frozen** store/resolver/registry (story 00) and the
structural surfaces of 01/02/03 (the provision/uninstall path, the re-pointed resolvers) — but consumes
**none of their internals**: it imports the resolver with injected store/PATH hits, imports `toolStoreRoot`
with `AOF_GLOBAL_HOME` set, source-greps the lanes + the uninstall target, and leans on the existing
GSD/framework tests as the npx regression net. Owning no production code, it cannot block — or be blocked
by — the siblings' internals; it goes GREEN once they land. `acd-npx-lane-preserved` is GREEN now (a
regression guard); the other four are RED-until-built.

> **Note (a separately-tracked deliverable, not a behaviour story):** the SPEC names the enforcing fitness
> guarantees as load-bearing, so they get their own owner + review surface here. But the units are
> *arch-tests*, not `.feature` files — there is no Three-Amigos Contract pass; the contract is ADR-005
> (mirrors 08/03 and 09/03).

**Feasibility (developer amigo seat — confirmed at Contract):** buildable against the real seam — every
test reuses an existing house idiom: injected-seam resolver import (the 09 `acd-graph-binary-absent`
idiom), source-grep with the call-form-not-comment discipline (`acd-terminal-server-only`), and the
existing GSD/framework tests as the npx regression net. Four of the five target paths (`tool-store.mjs`,
the provider registry, `project-provision.mjs`, the re-pointed resolvers) are confirmed **absent** today —
RED-until-built is correct; `acd-npx-lane-preserved` is GREEN now and must stay green.
