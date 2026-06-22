---
type: story
number: 03
slug: headroom-retrofit
title: "Headroom retrofit — resolve store-first, provision headroom-ai[all] via the uv lane, the platform matrix"
parent: 12
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
---
# 03 · Headroom retrofit — store-first + provision + platform matrix

## User story

As milestone 06's headroom plugin,
I want headroom's binary lookup to resolve the `~/.aof/tools/headroom/` store copy first (PATH fallback retained), headroom provisioned into the store via the uv lane (`headroom-ai[all]`), and a platform matrix that warns where headroom can't ship a wheel (Windows → needs Rust),
so that headroom is an aof-managed dependency like graphify, and an operator on an unsupported platform is told honestly rather than failing mid-install.

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 12/03`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [headroom-store-first](tasks/00_headroom-store-first.feature)** — headroom's `defaultWhich` lookup (`headroom.mjs`/`work-headroom.mjs`) is re-pointed store-first then PATH-fallback; headroom's enable/disable config surface (`useHeadroom`/`unuseHeadroom`) is unchanged — only the binary lookup moves.
- [x] **01 · [provision-and-platform](tasks/01_provision-and-platform.feature)** — the headroom descriptor (`headroom-ai`→`headroom`, extras `[all]`, win32 platform matrix) drives the uv lane and the `tool-platform` doctor warning fires on win32 (no wheel → Rust prereq). _(@executable: uv-lane plan + platform-matrix warning green; live uv install deferred @manual → verify.)_

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-004** the retrofit + platform
matrix; **ADR-001/002** the resolver + uv lane). This story **owns**: the re-point of headroom's binary
lookup in [headroom.mjs](../../../../../src/headroom.mjs) + [work-headroom.mjs](../../../../../src/work-headroom.mjs)
to front the store-first resolver (PATH fallback retained), and the headroom tool descriptor (with the
`platforms` matrix — win32 `supported:false`/Rust prereq, per RESEARCH §A3). It does **not** touch graphify
(02), the store/registry (00), or the provision command/doctor wiring (01 — it consumes them). headroom's
**enable/disable config surface and isolation guard (06/ADR-004) are unchanged** — only the binary lookup
is re-pointed.

**Independent because** it consumes only story 00's frozen resolver + uv lane (and 01's provision/doctor
path) and touches ONLY headroom's lookup + descriptor — graphify is untouched. The store-first re-point and
the win32 platform-matrix warning logic are `@executable` (injected store/platform); the real
`headroom-ai[all]` uv install + the live `headroom --version` from the store are `@manual` (heavy ML stack;
win32 needs Rust — live-only, RESEARCH §A2/A3).

**Feasibility (developer amigo seat — confirmed at Contract):** Feasible. The win32 platform-matrix
warning is `@executable` (pure over `descriptor.platforms[process.platform]` — the `tool-platform` check
from story 01 reused with the headroom descriptor); the uv-lane `headroom-ai[all]` plan is `@executable`
under `dryRun` (the extras-threading already covered by story 00's registry feature); the live
`headroom-ai[all]` install is correctly `@manual` (heavy ML/ONNX/torch stack; win32 has no wheel and needs
Rust per RESEARCH §A3).

**Load-bearing verdict — headroom's binary lookup IS cleanly separable from its enable/disable config surface.**
The lookup is the private `defaultWhich(bin, env)` (`headroom.mjs:25`, `work-headroom.mjs:39`). In
`headroom.mjs` it is consumed at ONE site — `resolveHeadroomLaunch` branch 3 (`which ?? defaultWhich`,
line 82), the runtime decision of which binary wraps the session — so re-pointing it store-first is a
contained swap of the default lookup, with the injected `which` seam (and the whole branch-1/2/4 decision
table) untouched. In `work-headroom.mjs` it is consumed only INSIDE `useHeadroom`, AFTER the config
read-merge-write has already completed (`setHeadroomEnabled` → `writeConfig` at lines 102-103, THEN the
`lookup("headroom", env)` PATH hint at lines 107-109). `unuseHeadroom` never calls it at all. The
config surface (`readConfig`/`setHeadroomEnabled`/`writeConfig`/`unuseHeadroom`) is therefore wholly
independent of the binary lookup — re-pointing the lookup store-first cannot affect whether or how the
`work.headroom` block is written, and the `acd-headroom-config-isolation` guard (06) stays green. The
`@executable` "useHeadroom still writes the config regardless of the lookup" scenario is provable precisely
because the write precedes and does not depend on the lookup.

**One judgement call for the build (not a contract issue):** the load-bearing re-point is `headroom.mjs`'s
`defaultWhich` (the runtime launch resolver — the binary that actually fronts the session, the store-first
target that makes a provisioned headroom win). `work-headroom.mjs`'s `defaultWhich` is only an advisory
"on PATH? print a hint" probe after the config write; re-pointing it store-first is consistency, not
correctness, and the doctor `managed-tool` check surfaces store presence regardless. The contract says
both files — both can be re-pointed off story 00's resolver; neither touches the config surface. No
contract change.
