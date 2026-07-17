---
type: story
number: 00
slug: self-contained-binary
title: "The self-contained binary — SEA + esbuild→CJS recipe, the one SEA-safe asset-base seam, the node-pty sidecar, and the single-entry two-mode confirmation"
parent: 28
status: done
owner: product-owner
created: 2026-07-03
updated: 2026-07-03
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · The self-contained binary — the whole app, no Node prerequisite

## User story

As an end user who wants `aof` without first installing Node.js or a build toolchain (and as the fleet that
needs the **same** binary to run in `relay` mode),
I want the app bundled into a **single self-contained executable** — the ESM app esbuild→CJS pre-bundled into a
Node **SEA**, with its two directory-asset trees (`src/bundle/**`, `ui/dist/**`) and the version string reached
through **one SEA-safe asset-base seam**, the native `node-pty` addon shipped as an **on-disk sidecar** that
degrades cleanly when absent, and the binary running **both** `node` and `relay` modes through the **one**
`run()` command core,
so that a single artifact carries the whole app with **no toolchain prerequisite** (KR4 minus signing), the dev
/ `npm` / test path is **byte-for-byte unchanged**, and Stories 01/02 have a working binary to sign and install.

<!-- This is the ONLY story that touches existing src/ modules (ARCHITECTURE §Story break-down rationale,
     point 1): the graph confines every runtime change here — ONE new seam (src/asset-base.mjs, ADR-003) +
     ONE node-pty dynamic-import re-home (ADR-002), both on low-fan-out mechanics, plus the greenfield SEA
     build recipe (ADR-001) and the single-entry confirmation (ADR-004). It produces an UNSIGNED working
     binary on the reference OS; Story 01 signs it, Story 02 installs it. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 28 --autonomous`, Contract stage). Each behaviour task is
     one `.feature` under tasks/; done when its feature is green. The fitness functions are arch-tests
     (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_asset-base-seam.feature` — the ONE `src/asset-base.mjs` SEA-safe resolver (ADR-003): under a
  SEA it resolves the asset base from `sea.getAsset`/a sidecar dir anchored at `process.execPath`'s dir; under
  a dev/`npm` run it returns the **current `import.meta.url` path verbatim**. All 7 root-resolution sites
  (`work-bundle.mjs`, the three `ui/dist` serve resolvers, the two `package.json`/version reads, the dev-only
  vite re-exec) route through it. The hard invariant: **dev behaviour is byte-for-byte unchanged** (the SEA
  branch only activates inside a packaged binary) — asserted `@executable` on the dev path.
- [x] `tasks/01_sea-build-recipe.feature` — the greenfield build recipe (ADR-001): `esbuild --bundle
  --platform=node --format=cjs --target=node22` of `bin/aof.mjs`'s import graph into one CJS SEA `main` (node-pty
  + the asset trees externalized) → `sea-config.json` → blob → `postject` (`useCodeCache` OFF); plus the
  **asset-manifest generator** that walks `src/bundle/**` (37 files) + `ui/dist/**` into the `assets` map (or
  sidecar layout). Produces an **unsigned working binary on the reference OS** — KR4 minus signing.
- [x] `tasks/02_native-addon-sidecar.feature` — node-pty ships as an **on-disk sidecar `.node`** beside the
  binary, never embedded (ADR-002); `defaultSpawn`'s `await import("node-pty")` re-homes to
  `createRequire(process.execPath)("node-pty")` under a SEA (dev path unchanged); a **missing/unloadable
  sidecar degrades ONLY the terminal dock** (a `{type:'error'}` frame) and **never crashes the node or relay**
  — the load-bearing graceful-degrade (`23/ADR-003`).
- [x] `tasks/03_single-entry-two-mode.feature` — the packaged SEA main is `bin/aof.mjs`'s bundled equivalent
  (ADR-004): it calls the **same** `run(process.argv.slice(2))` and nothing else; the ONE binary runs
  `aof --version` (node mode) **and** `aof mesh relay` (relay mode, the existing `23/ADR-001` argv route) — **no
  forked per-mode entry, no top-level `relay` fast-path**.
- [x] **Fitness `acd-sea-safe-asset-base`** (arch-test, ADR-003 / fitness #1) — no runtime `src/**.mjs` module
  (except `src/asset-base.mjs` + the allow-listed dev-only vite re-exec line) constructs an asset path off a
  bare `fileURLToPath(import.meta.url)`/`import.meta.dirname`/`import.meta.url` joined to
  `bundle`/`ui`/`dist`/`package.json`; the 7 sites reference the seam. Comment/string-stripped grep + the m03
  non-vacuous self-check (fires on a planted violation; passes a call to `assetBase()`).
- [x] **Fitness `acd-single-entry-command-core`** (arch-test, ADR-004 / `08/ADR-001` / fitness #2) —
  `bin/aof.mjs` (+ the SEA-main recipe) imports `run` from `src/cli.mjs` and calls exactly
  `run(process.argv.slice(2))` with **no** `argv[0]==="relay"` / `mode==="relay"` fork before it; `src/cli.mjs`
  exports exactly one `run`. Self-check fires on a planted `relay` fast-path.
- [x] **Fitness `acd-native-addon-degrades`** (arch-test, ADR-002 / fitness #3) — no `src/**.mjs` module
  top-level-`import`s `"node-pty"` or a `*.node` (the only node-pty reference is inside `defaultSpawn`), and
  `terminal-ws.mjs`'s load is wrapped so a load/spawn failure yields the `{type:'error'}` frame. Self-check
  fires on a planted top-level `import … from "node-pty"`.
- [x] **Build-unit `bundle-asset-manifest-complete`** (build-script unit test, ADR-001/003 / fitness #4) — a
  **set-equality** over the real `src/bundle/**` (37 files) + `ui/dist/**` trees vs. the generated `assets`
  map/sidecar file list (empty diff both directions), driven by the manifest generator's output — **not** a
  source grep. Self-check: planting an un-manifested file under `src/bundle/` fails the set-equality.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) — **ADR-001** (SEA + esbuild→CJS on a per-OS CI
matrix; `@yao-pkg/pkg` the documented fallback), **ADR-002** (node-pty on-disk sidecar + the `createRequire`
re-home + the load-bearing degrade), **ADR-003** (the ONE `src/asset-base.mjs` seam, dev byte-for-byte), and
**ADR-004** (single-entry two-mode). The measured constraints these rest on are
[RESEARCH.md](../../RESEARCH.md) (node-pty has **no Linux prebuild** → compiled in CI, Story 01; SEA ESM entry
is Node 25.7+ → esbuild→CJS on Node 22 LTS; the 7 `import.meta.url` sites; directory assets are not a SEA
primitive).

This story **owns** the milestone's entire runtime `src/` change and the greenfield build recipe:
`src/asset-base.mjs` (new), the re-homing of the 7 sites onto it, the node-pty dynamic-import re-home in
`src/terminal-ws.mjs`, the SEA build scripts (`sea-config.json` + the esbuild pre-bundle + the asset-manifest
generator), the SEA main (the bundled `run()` call), and the four fitness/build units above + their
registration in [scripts/test.mjs](../../../../../scripts/test.mjs).

**The only story touching `src/` — parallel-authorable, the code-coupled root of the chain.** The graph
(`ARCHITECTURE §Story break-down rationale`) confines all `src/` coupling here: ONE seam threaded through
low-fan-out mechanics (`work-bundle.mjs` ← 6, the serve resolvers ← 1–2, `mesh-identity.mjs` ← 3) + the
node-pty leaf (`terminal-ws.mjs`, no static edge to the addon at all). Stories 01/02 add **zero** `src/` code;
they consume this story's **artifact** (the unsigned binary + asset layout), never a source import — so all
three contracts are authored in parallel and this story's `@executable` units (the fitness functions + the
asset-manifest set-equality) run with no upstream artifact.

**Verification reality (ARCHITECTURE §verification-strategy):** `@executable` = the three arch-tests + the
build-recipe completeness unit. `@manual` (agent-runnable) = build the SEA on the reference OS → run
`aof --version` (node) + `aof mesh relay` probe (relay) + a live PTY over the sidecar + the missing-sidecar
degrade. The cross-OS + signed variants are Story 01/02's `@uat`.

**Contract status (Three Amigos, `aof:refine 28 --autonomous`):** PO authored the four task features + tagged;
`aof-qa` hardened the case matrices (the packaged-asset walker/enumeration/absent-asset rows; the 6-class
node-pty degrade matrix incl. the raw-SEA-`import()`-throws + wrong-arch + missing-Windows-companion cases; the
9-row argv→mode matrix); `aof-developer` verdict **FEASIBLE — no contract defects**, every `@executable`
scenario + fitness function verified reachable in-process against the live codebase (Node v22.22.2). PO removed
the speculative `@yao-pkg/pkg` build scenario (QA finding F1 — it is ADR-001's escape hatch, not a story-00
obligation; its bundler-agnostic kernel is covered carrier-neutrally by `00_asset-base-seam`).

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change). -->

- **The SEA sentinel MUST be an injectable shim, not a raw inline `require('node:sea')` at each site.**
  `node:sea` is import-safe under a plain `node` run (verified live: `isSea()` returns `false` without
  throwing) — but the `@executable` in-process tests flip the sentinel ON with no built binary, so
  `src/asset-base.mjs` must default detection to `isSea()` yet expose an override (a module-scoped injectable
  / options arg / env sentinel), mirroring how `terminal-ws.mjs` injects its `spawn`. This is what makes the
  seam feature and fitness #3's sibling scenarios green in-process.
- **`sea.getAsset`/`getAssetKeys` may be called ONLY inside the SEA branch.** Verified: `getAsset` throws
  `ERR_NOT_IN_SINGLE_EXECUTABLE_APPLICATION` outside a SEA — so the dev branch must be pure `import.meta.url`
  resolution with zero SEA-API calls (the `00_asset-base-seam.feature` "no SEA API on the dev path" assertion
  is load-bearing, not cosmetic). The seam's enumeration primitive must return the SAME member set whether the
  class is embedded (`getAssetKeys`) or a sidecar dir (`readdir`), and a missing packaged asset must surface
  ONE locatable error (naming the key/path), never a silent `import.meta.url`/src-tree fallback.
- **`terminal-ws.mjs`'s existing catch does NOT need to widen** — the `await import("node-pty")` lives INSIDE
  the awaited `spawn` call (`src/terminal-ws.mjs:158-175`), so a load/import rejection already propagates into
  the `catch` that emits `{type:'error'}`. Keep the re-home inside `defaultSpawn` (choose
  `createRequire(process.execPath)("node-pty")` under SEA vs `await import("node-pty")` in dev); never hoist
  to a top-level import (fitness #3 forbids it and it would break the degrade).
- **CO-TOUCH — the ADR-003 re-home breaks the pre-existing m01 arch-test `acd-bundle-location`.**
  [`test/arch/acd-bundle-location.test.mjs:48-49`](../../../../../test/arch/acd-bundle-location.test.mjs)
  asserts `bundleRoot()`'s body matches `/import\.meta\.url/`. Under ADR-003 `bundleRoot()` delegates to
  `assetBase("bundle")`, so that assert goes RED. **Update `acd-bundle-location` in the SAME change** that
  lands the seam — assert the `import.meta.url` resolution now lives in `src/asset-base.mjs` and that
  `bundleRoot()` routes through `assetBase()`; the cwd-independence asserts (`:33`, `:53-55`) stay green.
  This is a planned co-touch, not an m28 contract defect — flagged so it is not a surprise regression at build.
- **Assert externalization from the esbuild `--metafile`** — `node-pty` + the asset trees must be ABSENT from
  the bundle `inputs` (externalized), with no inlined `require("…pty.node")` in the CJS output; this makes the
  externalization boundary (`01_sea-build-recipe.feature`) a deterministic build check, not a downstream crash.
