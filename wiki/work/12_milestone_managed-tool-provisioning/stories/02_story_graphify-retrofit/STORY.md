---
type: story
number: 02
slug: graphify-retrofit
title: "Graphify retrofit — resolve store-first, provision into the store, and remove the temporary global install"
parent: 12
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
schema: 1
aofVersion: 0.1.0
---
# 02 · Graphify retrofit — store-first + provision + remove the temp global

## User story

As milestone 09's graphify integration,
I want `resolveGraphifyBinary` to resolve the `~/.aof/tools/graphify/` store copy first (falling back to PATH so an operator's own global still works), graphify provisioned into the store via the uv lane, and the **temporary global `uv tool install graphifyy`** (installed during 09's verify) **removed** once the store copy resolves,
so that graphify is an aof-managed, version-pinned dependency — not a hand-installed global — and the verify-time cleanup obligation is closed.

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 12/02`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [graphify-store-first](tasks/00_graphify-store-first.feature)** — `resolveGraphifyBinary` is re-pointed to `resolveManagedBinary` (store-first, then its existing PATH walk); the frozen `{found:false,hint}` no-throw contract is preserved; the hint names `aof project provision graphify`.
- [x] **01 · [provision-and-cleanup](tasks/01_provision-and-cleanup.feature)** — graphify provisions into the store via the uv lane (descriptor `graphifyy`→`graphify`/`graphify-mcp`); **then** the temporary global is removed (`uv tool uninstall graphifyy`) and the store copy resolves. **(@manual — live binary + global removal; the STATE cleanup obligation closed at `aof:verify 12` — see [VERIFICATION.md](../../VERIFICATION.md).)**

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-004** the retrofit + cleanup;
**ADR-001/002** the resolver + uv lane it consumes). This story **owns**: the re-point of
`resolveGraphifyBinary` in [graphify.mjs](../../../../../src/graphify.mjs) to front the store-first
resolver (PATH fallback retained), the graphify tool descriptor, and the **closure of the
⚠ CLEANUP OBLIGATION** ([STATE](../../STATE.md)) — provision graphify into `~/.aof/tools/graphify/`, then
`uv tool uninstall graphifyy` (the temp global from 09's verify), then confirm the store copy resolves.
**Sequencing is load-bearing: the global is removed AFTER the store install + re-point, never before** —
09's live integration currently depends on the global binary. It does **not** touch headroom (03), the
store/registry (00), or the provision command (01 — it consumes them). graphify's privacy/backend model
(09/ADR-005) is unchanged — only the binary LOOKUP is re-pointed.

**Independent because** it consumes only story 00's frozen resolver + uv lane (and story 01's provision
path for the live install) and touches ONLY graphify's lookup + descriptor — headroom is untouched, the
store internals are untouched. The store-first re-point (resolution order) is `@executable` with the store
stubbed; the real `uv venv` install + the `uv tool uninstall graphifyy` removal + the store-copy-resolves
confirmation are `@manual` (live binary). **Closing the cleanup obligation is a precondition of accepting
this story.**

**Feasibility (developer amigo seat — confirmed at Contract):** Feasible, and the re-point is genuinely
small. `resolveGraphifyBinary` (`src/graphify.mjs:138-149`) is already the single resolution seam — every
spawn (`runGraphifyBuild`/`Query`/`Triage`) and the doctor check call it. The re-point fronts it with
`resolveManagedBinary({ name:"graphify", version:PINNED_GRAPHIFY_VERSION, binary:GRAPHIFY_BINARY, … })`
(store-first) and keeps the existing `findBinaryOnPath`/`probeVersion` as the PATH fallback — story 00's
resolver is designed to do exactly this internally, so the re-point may reduce to passing the existing
PATH-walk/probe in as the injected `pathValue`/`useLocator`/`probe` seams. The frozen `{found:false,hint}`
no-throw contract (`09/ADR-002`, line 141) is preserved; only the hint string updates to name
`aof project provision graphify`. graphify's privacy/backend model (`09/ADR-005`) is untouched — only the
lookup moves. The store-first re-point scenarios are `@executable` with the store/PATH seams injected.

**Two honest hard parts, both correctly `@manual` (live) and unchanged from the contract:** (1) the real
`uv venv` + `uv pip install` of graphify into `~/.aof/tools/graphify/0.8.44/` needs the live binary; (2)
the **cleanup sequencing is a real ordering constraint the build must honour** — the temporary global
(`uv tool install graphifyy`, installed during 09's verify, on PATH at `~/.local/bin/graphify`) is removed
(`uv tool uninstall graphifyy`) ONLY AFTER the store install lands AND `resolveGraphifyBinary` is confirmed
to resolve the store copy. Removing it earlier breaks 09's still-live integration (which resolves the global
until the store copy exists). This is verify-time agent procedure, not code logic — it cannot be enforced
by an `@executable` test, so the sequencing lives in the `@manual` feature's scenario order + the
VERIFICATION evidence, and closing it is a precondition of accepting the story. No contract change.
