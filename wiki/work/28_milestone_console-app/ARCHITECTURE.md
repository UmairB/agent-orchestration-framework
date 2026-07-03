---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 28 · Cross-Platform Console App — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the load-bearing deliverables: **signed
> self-contained binaries** for Win/mac/Linux with **no Node.js / toolchain prerequisite**; **one binary,
> two modes** `node`/`relay`; **a one-line installer + signing/notarization per OS**; the outsider-verifiable
> bar is KR4 — "a single signed command produces a working node on all three OSes with no toolchain
> prerequisite, and the same binary runs in `relay` mode") and `STATE.md` (the four open contract points
> refined here: SEA vs `pkg`; the per-OS signing/notarization path; the one-line installer; how `node`/`relay`
> modes are selected from the single binary). The **researcher's measured facts** are the gate: `RESEARCH.md`
> is desk + installed-package ground truth (Node v22.22.2 local; the installed `node_modules/node-pty/`
> prebuilds tree; the `import.meta.url` sites read from source) — **its findings are not re-litigated below,
> they are cited.** The headline constraints it established: (a) node-pty's `.node` **cannot** live in a
> SEA/pkg blob (it `require`s a real on-disk file via a *dynamic* path its own loader builds — `RESEARCH.md
> §2`), and there is **no Linux prebuild** shipped (`darwin-arm64`, `darwin-x64`, `win32-x64`, `win32-arm64`
> only — confirmed against `node_modules/node-pty/prebuilds/`), so the Linux `.node` is **compiled in CI**;
> (b) SEA **ESM entrypoint** (`mainFormat: module`) landed in **Node 25.7.0** (PR #61813), so a **Node 22 LTS**
> SEA is **CJS-entry only** → the ESM app must be **esbuild→CJS pre-bundled** (`RESEARCH.md §1`); (c) **7
> modules** compute a repo-root/asset base off `import.meta.url` and shift under packaging — `work-bundle.mjs:26`,
> `cli.mjs:2099`, `board-serve.mjs:24`, `setup-ui.mjs:17`, `mesh-ui-serve.mjs:48`, `work-bundle-manifest.mjs:24`,
> `commands/mesh-identity.mjs:67` (`RESEARCH.md §0`); (d) directory assets (`src/bundle/` = **37 files**,
> `ui/dist/`) are **not a SEA primitive** — the `assets` map is a flat key→file map (`RESEARCH.md §1`); (e)
> every operational child process is an **external PATH spawn** (fine for a packaged binary), the ONLY
> `process.execPath` re-exec is the **dev-only vite server** (`cli.mjs:2098`) which never runs on the shipped
> path (`RESEARCH.md §0`).
>
> **The precedents this milestone APPLIES and never re-litigates: milestone 08 (cli-command-core), milestone
> 07 (the additive co-touch door), and milestone 23 (the relay mode).** Packaging inherits wholesale:
> `08/ADR-001` (CLI-as-contract over ONE in-process command core — `run(argv)` in `src/cli.mjs`, imported by
> `bin/aof.mjs`; serve is a thin face over a one-shot core); `08/ADR-002` (the frozen
> `{ id, input, run, cli } → result` contract; basis-neutral `run` data; path-display is a face adapter);
> `07/ADR-006` (the additive co-touched-door discipline — appending to `COMMANDS`/dispatch, no shared-line
> edits). The `relay` mode this milestone packages is `23/ADR-001` — `serveRelay`/`relayMode` in
> `src/mesh-relay.mjs`, entered via `aof mesh relay` → `meshVerbCli("mesh:relay")` → `invoke("mesh:relay")`,
> i.e. an argv branch of the SAME `run()`, NOT a second entrypoint. ADRs below cite these as `08/ADR-00n` /
> `07/ADR-006` / `23/ADR-001` / `RESEARCH.md §…` / `SPEC §…` / `STATE §…` / `PRD §…`.
>
> **The seam (confirmed against the codebase graph, `aof graph build src` → 1261 nodes / 3400 edges,
> builtAt 2026-07-03; `aof graph impact` consulted at author time — cited as ACTUAL structure, not
> inferred).** `src/cli.mjs` is the **single entry spine**: `graph impact` reports **0 dependents** (nothing
> in `src/` imports it — `bin/aof.mjs` is its only caller, outside the src graph) and **26 dependencies**
> (every top-level command module, including `board-serve.mjs`, `setup-ui.mjs`, `mesh-ui-serve.mjs`), so
> `run(argv)` is the one door both modes route through — the topological fact `08/ADR-001` rests on. The
> **asset-base touch points cluster on low-fan-out mechanics, not the god-node**: `work-bundle.mjs` (← **6**
> dependents `mesh-identity.mjs`/`config-inspect.mjs`/`work-bundle-manifest.mjs`/`work-bundle-synthesis.mjs`/
> `work-init.mjs`/`work-update.mjs`; → **2** deps `adapters.mjs`/`lock.mjs`); `board-serve.mjs` (← **1**
> `cli.mjs`; → **1** `setup-ui.mjs`); `setup-ui.mjs` (← **2** `board-serve.mjs`/`cli.mjs`; → **4** incl.
> `terminal-ws.mjs`); `mesh-ui-serve.mjs` (← **1** `cli.mjs`; → **2** `command-core.mjs`/`work.mjs`);
> `work-bundle-manifest.mjs` (← **1** `work-bundle-synthesis.mjs`; → **1** `work-bundle.mjs`);
> `mesh-identity.mjs` (← **3**; → **7**). `terminal-ws.mjs` — the node-pty site — is a **leaf under one
> parent**: `graph impact` reports ← **1** dependent (`setup-ui.mjs`) and → **4** deps (`headroom.mjs`,
> `terminal-providers.mjs`, `terminal-sessions.mjs`, `work.mjs`) and **NO** import edge to `node-pty` at all
> — because node-pty is reached only by the guarded `await import("node-pty")` INSIDE `defaultSpawn`
> (`terminal-ws.mjs:29`), never a top-level import (the graph literally shows the addon is not a static
> dependency — the degrade property, made visible). `command-core.mjs` (← **5**; → **28** every
> `src/commands/*.mjs`) is the additive registry door — untouched by packaging (no new command verb).
>
> **Prior-lesson recall** (`work memory recall "cross-platform binary packaging SEA native addon signing
> installer command-core single entry" --area architecture --block`) surfaced five near-misses; each is
> acknowledged as honoured or a conscious departure:
> - **R2 (m01) — content-addressed artifacts must pin line endings or cross-platform CI hashes diverge.**
>   **HONOURED — load-bearing here:** the SEA `assets` map / sidecar bundle is content-addressed by the
>   `src/bundle/manifest.json` hashes (`acd-bundle-manifest-hashes`); the existing `.gitattributes`
>   `src/bundle/** text eol=lf` pin (already present) keeps those bytes stable across the Win/mac/Linux CI
>   runners, so the SAME bundle hashes into the SAME asset on every matrix leg. The build-recipe fitness
>   function (#4) asserts the manifest covers every shipped file so no byte drifts in unpinned.
> - **ADR-004 (m09) — graphify is provisioned assets-only via an `aof project doctor` binary check, NOT by
>   generalizing the load-bearing installer.** **HONOURED (analogy):** the console-app installer
>   (`install.sh`/`install.ps1`) is a NEW, file-disjoint distribution artifact — it does **not** generalize
>   or touch `src/frameworks.mjs` (the npx installer m09 protects). One-line install is a greenfield script
>   pair (ADR-006), not a mutation of an existing installer seam.
> - **ADR-001/ADR-003 (m12) — the managed-tool store resolves STORE-FIRST then PATH-fallback off a frozen
>   platform-aware resolver, and lifecycle rides the SAME `doctor` seam.** **HONOURED (pattern applied to
>   assets):** the SEA-safe asset base (ADR-003 below) is the SAME shape — a frozen platform-aware resolver
>   that resolves SEA-FIRST (`sea.getAsset` / a sidecar dir next to `process.execPath`) then the
>   dev/`import.meta.url` fallback — one resolver, keyed by "am I inside a SEA", exactly as m12 keyed on
>   store-vs-PATH.
> - **R1 (m19) — an ADR that registers a command-core command must enumerate EVERY registry-derived fitness
>   function it trips.** **HONOURED — inverse comes back CLEAN:** this milestone registers **NO new command
>   verb** (`node`/`relay` modes are the EXISTING `run()` argv branches; `aof mesh relay` shipped in m23). So
>   **no** registry-derived gate is armed — `acd-mesh-command-cli-bijection`, `acd-work-command-route-coverage`,
>   `acd-command-namespace` all stay quiet (no new `mesh:*`/`work:*` verb, no new bundle skill `.md`). The
>   `acd-single-entry-command-core` gate (fitness #2) is a NEW structural gate about PACKAGING preserving the
>   single door, not a registry-bijection gate — enumerated explicitly so the R1 discipline is visibly met.
>
> **Scope precision.** This milestone **bundles whatever the build contains and adds NO mesh logic**
> (`SPEC §Out of scope`). The runtime code change is minimal and surgical: ONE new asset-base seam (ADR-003)
> re-homing 7 call sites + ONE re-home of the node-pty dynamic import (ADR-002). Everything else — the bundler
> recipe, the signing pipeline, the installer — is **new build/CI/script files, file-disjoint from `src/`**
> (they are not in the src graph at all). This is what makes the milestone a **linear artifact pipeline**
> (build → sign → install), argued in the story rationale.

## ADR-001: Node SEA + an esbuild→CJS pre-bundle is the primary bundler, built on a per-OS CI runner matrix (no cross-compile); `@yao-pkg/pkg` is the documented fallback

**Status:** Accepted
**Date:** 2026-07-03

**Context.** `SPEC §Scope` asks for signed self-contained binaries with **no Node/toolchain prerequisite**
via "SEA or `pkg`-style bundling"; `STATE §Notes` opens "SEA vs `pkg`" as the first decision. `RESEARCH.md §1`
/`§3`/`§Decision inputs` measured both against THIS app's ground truth: it is `"type": "module"` (pure ESM),
its only native dep is node-pty, and it reads two directory-asset trees. Two measured facts gate the choice:
(1) SEA's **ESM entrypoint** (`mainFormat: module`) is **Node 25.7.0+** (PR #61813) — **not** in Node 22 LTS,
so a Node 22 SEA main must be **CommonJS** (`RESEARCH.md §1`); (2) SEA has **no cross-compilation** — it copies
the host's `node` binary, so each OS/arch artifact must be built on a **matching runner** (`RESEARCH.md §1`,
`§6`), and Linux node-pty must be **compiled on a Linux runner** anyway (`RESEARCH.md §2`).

**Decision.** **Node SEA is the primary bundler, with an esbuild bundle of the ESM app to a single CJS file
as the SEA `main`, targeting Node 22 LTS.** The build recipe is:

1. **`esbuild` → one CJS bundle.** Bundle `bin/aof.mjs`'s import graph (`src/cli.mjs` + its 26 transitive
   deps) into a single CJS file (`--bundle --platform=node --format=cjs --target=node22`), with node-pty and
   the two asset trees **externalized** (they are sidecars, ADR-002/ADR-003), so the SEA `main` is exactly one
   CJS script (SEA requires exactly one entry — `RESEARCH.md §1`). The esbuild step ALSO collapses the seven
   `import.meta.url` base-path sites into one bundler shim, which is precisely where ADR-003's single seam
   substitutes the SEA-safe base.
2. **SEA blob + inject.** `node --experimental-sea-config sea-config.json` → `sea-prep.blob`; copy the runner's
   own `node`; `postject` the blob with the `NODE_SEA_FUSE_…` sentinel (`--macho-segment-name NODE_SEA` on
   macOS). `useCodeCache` is **OFF** (it is "incompatible with cross-platform builds and `import()`" —
   `RESEARCH.md §1`).
3. **A per-OS GitHub Actions runner matrix** (`ubuntu-latest`, `macos-latest`, `windows-latest`, with the
   arch legs `RESEARCH.md §6` names). This is **mandatory** and unavoidable: SEA cannot cross-compile, the
   Linux node-pty `.node` must be built on a Linux runner, and the per-OS signing tools (§ADR-005) only run on
   their own OS. Even the cross-compiling fallback cannot escape the per-OS signing runners. (Building arm64
   SEA on a Linux-arm64 **Docker** container corrupts the ELF for `dlopen` — `RESEARCH.md §6`; arm64 builds on
   a native/non-container runner.)

**`@yao-pkg/pkg` is the documented fallback**, recorded with its trade-off (`RESEARCH.md §3`): it buys
cross-compilation from one host, glob asset bundling (`pkg.assets`), and automatic native-addon
cache-extraction — at the price of a third-party dependency and a **Node-22 Standard-mode regression** (build
on Node 20/24 or via `--sea`). It is the escape hatch **iff** the SEA directory-asset + addon plumbing (ADR-002/003)
proves too heavy at build time; it does NOT change any runtime ADR below (the asset-base seam and the node-pty
sidecar are bundler-agnostic — a `pkg` snapshot resolves `__dirname` into its virtual FS, which ADR-003's
resolver treats as the same "packaged" branch).

**Alternatives considered.**
- *A native-ESM SEA (`mainFormat: module`) on Node 24/25+* — rejected as the primary: it abandons Node 22 LTS
  (`engines: >=20`) for a semver-minor that landed weeks ago (`RESEARCH.md §1`); the esbuild→CJS path is the
  LTS-aligned, lower-risk route today and additionally solves the `import.meta.url` collapse. Recorded as the
  future simplification when the LTS floor moves.
- *`@yao-pkg/pkg` as primary* — rejected (kept as fallback): it introduces a single-fork third-party
  dependency on the critical shipping path and carries a Node-22 regression; SEA is first-party, smallest, and
  the per-OS matrix it forces is required anyway for signing + Linux node-pty (`RESEARCH.md §3` trade-off
  table). The manual asset/addon wiring SEA demands is bounded and owned by ADR-002/003.
- *A single cross-compiling runner* — rejected: impossible for SEA and pointless for pkg, because per-OS
  signing runners (Authenticode/codesign/GPG) and the Linux node-pty compile are unavoidable regardless
  (`RESEARCH.md §6`).

**Consequences.** Story 00 owns the SEA build recipe: `sea-config.json`, the esbuild→CJS pre-bundle step, and
the asset-manifest generator that walks `src/bundle/**` (37 files) + `ui/dist/**` into the `assets` map (or the
sidecar layout, ADR-003). It produces an **unsigned working binary on the reference OS** — KR4 minus signing.
The CI matrix that instantiates this recipe on all three OSes + the signing is Story 01 (build-pipeline, not
runtime code). The **build-time confirmations `RESEARCH.md §Decision inputs` scheduled** (a real
esbuild→CJS→blob→postject build running `aof --version`, `aof mesh relay`, and a live PTY on each OS; the
Linux node-pty compile) are Story 00/01 `@manual`/`@uat` verification deliverables, not refine blockers.

## ADR-002: node-pty ships as an on-disk sidecar `.node` beside the binary (never embedded); its dynamic import re-homes to a filesystem `require`, and the existing graceful-degrade-on-absent-addon guard becomes load-bearing

**Status:** Accepted
**Date:** 2026-07-03

**Context.** node-pty is the single biggest packaging risk (`RESEARCH.md §2`, `§Residual risks #1`). Measured
from the installed package: it is a **native C++ `.node`** loaded by a **relative `require` on a dynamically
built path** (`lib/utils.js` `loadNativeModule` → `require(dir + "/" + name + ".node")`), so a **`.node`
cannot be loaded from inside a SEA blob** (Node's loader needs a real file; the docs' sanctioned
`getRawAsset`→tmp→`dlopen` path requires **replacing** node-pty's own loader — `RESEARCH.md §2`). Two more
measured facts: the shipped prebuilds cover **`darwin-arm64`/`darwin-x64`/`win32-x64`/`win32-arm64`** but there
is **NO `linux-*`** dir (confirmed against `node_modules/node-pty/prebuilds/`), and a **raw SEA main cannot
`import()` node-pty from disk** — an FS `import()` throws inside a SEA (`RESEARCH.md §1`/`§2`), so
`terminal-ws.mjs:29`'s `await import("node-pty")` breaks under a raw SEA main. The graph confirms the leverage:
`graph impact src/terminal-ws.mjs` shows node-pty is **not a static dependency edge at all** — it is reached
only through the guarded dynamic import inside `defaultSpawn`, and importing `terminal-ws.mjs` never needs the
addon.

**Decision.** **Ship the prebuilt `.node` as an on-disk sidecar next to the binary; never embed it**
(`RESEARCH.md §2` ranked option 1 — lowest-risk, matches node-pty's own loader, preserves the degrade path).

1. **Sidecar the `.node` (+ its runtime companions).** The per-OS/arch prebuilt ships as a real file beside
   the executable: mac (x64+arm64) and Windows (x64+arm64) from the package's `prebuilds/`; the **Linux
   `.node` is compiled in CI** (Story 01, on the Linux runner) since none is shipped. **Windows carries
   companions** — `pty.node` plus `winpty.dll`, `winpty-agent.exe`, and the `conpty/` folder
   (`conpty.dll`+`OpenConsole.exe`) — the sidecar is a *directory*, not a lone file (`RESEARCH.md §2`).
2. **Re-home the dynamic import to a filesystem `require`.** Under a SEA, `defaultSpawn`'s
   `await import("node-pty")` (which throws for an FS module in a SEA main) becomes
   `createRequire(process.execPath)("node-pty")` — resolved against the sidecar dir anchored at
   `process.execPath` (the SAME "packaged base" ADR-003's resolver returns). Under a dev/npm run the current
   `await import("node-pty")` is preserved byte-for-byte. The load stays **inside `defaultSpawn`**, never
   hoisted to a top-level import — so importing `terminal-ws.mjs` still never requires the addon.
3. **The graceful-degrade guard becomes LOAD-BEARING.** The existing guard (`terminal-ws.mjs` — a
   spawn/import failure is caught and surfaced as `{type:'error'}`, `23/ADR-003`/`03/ADR-003`) is now a
   packaging invariant: an install whose sidecar `.node` is **missing or unloadable** degrades ONLY the
   in-browser terminal dock feature (an error control-frame), and **NEVER crashes the node or the relay**
   (`RESEARCH.md §2` — the low-blast-radius property). This is asserted structurally by fitness #3
   (`acd-native-addon-degrades`): no module top-level-`import`s a `.node`, so a missing sidecar cannot break
   startup.

**Alternatives considered.**
- *Embed the `.node` as a SEA asset + `getRawAsset`→tmp→`dlopen`* — rejected (`RESEARCH.md §2` option 3, most
  invasive): node-pty's own `loadNativeModule` does a plain relative `require` and will NOT call `getRawAsset`,
  so this forces a fork/monkey-patch of node-pty's loader PLUS extracting the Windows `winpty`/`conpty`
  companions to a temp dir — bespoke, fragile, re-litigated on every node-pty bump. The sidecar matches the
  loader as-shipped.
- *`@yao-pkg/pkg` auto cache-extraction* — noted as riding ADR-001's fallback, not the primary: even pkg needs
  node-pty **manually** in `pkg.assets` (its static detector misses the dynamic path) and still needs a
  per-platform `.node` incl. the Linux one it cannot cross-compile (`RESEARCH.md §2`/`§3`) — it removes the
  hand-rolled sidecar but not the Linux compile.
- *Drop the PTY/terminal-dock feature from the packaged binary* — rejected here as a **product** call, not a
  packaging one (`RESEARCH.md §2` option 4). The sidecar+degrade keeps the feature where the addon loads and
  degrades cleanly where it does not — the best of both without a scope cut.

**Consequences.** Story 00 owns: the node-pty dynamic-import re-home in `src/terminal-ws.mjs` (the
`createRequire`-under-SEA branch, dev path unchanged), the sidecar layout convention (the `.node` + Windows
companions beside `process.execPath`), and fitness #3. The **Linux node-pty CI compile** is Story 01 (it runs
on the Linux runner, produces the `linux-<arch>/pty.node` the sidecar ships). The **installer must download the
sidecar alongside the binary** (Story 02, ADR-006). The *observable* (a real PTY session over the sidecar; a
missing sidecar degrading to an error frame not a crash) is a Story 00/01 `.feature` + `@manual` deliverable,
not a fitness function.

## ADR-003: ONE SEA-safe asset-base seam — a frozen resolver that returns the asset base (SEA-first, dev-`import.meta.url`-fallback); all 7 root-resolution sites route through it, preserving dev behaviour byte-for-byte

**Status:** Accepted
**Date:** 2026-07-03

**Context.** This is the largest runtime code change (`RESEARCH.md §Residual risks #2`). Seven modules locate
a repo-root or asset base off `import.meta.url` and read a real `src/…` directory one level below a repo root —
`work-bundle.mjs:26` (`bundleRoot()` → `src/bundle/**`, 37 files), `cli.mjs:2099` (the dev-only vite re-exec),
`board-serve.mjs:24` + `mesh-ui-serve.mjs:48` + `setup-ui.mjs:17` (`<repoRoot>/ui/dist`),
`work-bundle-manifest.mjs:24` + `commands/mesh-identity.mjs:67` (`../package.json` for the version string)
(`RESEARCH.md §0`). Inside a SEA, `import.meta.url` = the `file:` URL of `process.execPath` and
`import.meta.dirname` = the executable's directory (`RESEARCH.md §1`) — so every one of these silently
re-points at the binary's own dir instead of `src/…`, and directory assets are **not a SEA primitive** (the
`assets` map is flat key→file; `RESEARCH.md §1`). The graph shows these sites are **low-fan-out mechanics on
distinct modules** (`work-bundle.mjs` ← 6 / → 2; the three serve modules each ← 1–2 / → 1–4;
`work-bundle-manifest.mjs` ← 1; `mesh-identity.mjs` ← 3) — no god-node, so a single seam threaded through each
is a clean, additive substitution, not a rewrite of a hot core.

**Decision.** **Introduce exactly ONE seam** — a frozen resolver, e.g. `assetBase()` in a new
`src/asset-base.mjs` (mirroring the `12/ADR-001` frozen platform-aware resolver shape) — that returns the
runtime asset base:

- **Under a SEA** (detected via `sea`/`process.env` sentinel or `require('node:sea').isSea?.()`): resolves an
  asset via `sea.getAsset(key)` / `sea.getAssetKeys()` for embedded assets, OR a **sidecar dir anchored at
  `import.meta.dirname` (= `process.execPath`'s dir)** for the bundle/`ui/dist`/companions — the same anchor
  ADR-002's node-pty sidecar uses.
- **Under a dev/npm run**: resolves to the **current `import.meta.url` path** — the EXACTLY existing behaviour.

**All 7 sites route through this ONE seam.** `bundleRoot()`, the three `ui/dist` resolvers, the two
`package.json`/version reads, and the dev-only vite re-exec all call `assetBase()` (or an asset-key lookup off
it) instead of joining a path off a bare `fileURLToPath(import.meta.url)` root. The `readdirSync`/`readFileSync`
walkers in `work-bundle.mjs` (lines 76,101,131) resolve their per-file paths through the seam (a sidecar
`path.join` OR `getAsset`/`getAssetKeys`, per the ADR-001 build recipe's asset shape).

**The seam PRESERVES dev behaviour byte-for-byte** (the hard invariant): the dev/npm branch is the current
resolution verbatim, so `npm run` / `npx aof` / the test suite see **no** behavioural change — the SEA branch
only activates inside a packaged binary. This is enforced structurally by fitness #1 (`acd-sea-safe-asset-base`):
**no** runtime module joins an asset path off a bare `import.meta.url`/`fileURLToPath(import.meta.url)` root
**outside this one seam** — with the **dev-only vite re-exec on the allow-list** (it is never on the shipped
path, `RESEARCH.md §0`; it is re-homed for correctness but exempt from the "must serve packaged assets"
assertion since a SEA never runs vite).

**Alternatives considered.**
- *Re-home each of the 7 sites independently (no shared seam)* — rejected: it scatters the SEA/dev branch
  across 7 modules (7 places to get the sentinel wrong, 7 to drift), and there is no single point to assert
  the invariant. One seam gives one detection, one place for fitness #1 to allow-list, and one place the pkg
  fallback (ADR-001) swaps in `__dirname`-into-snapshot resolution.
- *Ship assets ONLY as SEA embedded `getAsset` entries (no sidecar option)* — rejected as the sole mechanism:
  `ui/dist` + the node-pty companions already have to be sidecars (a `.node` can't embed, ADR-002), so the
  seam must support the sidecar-dir anchor regardless; embedding is an option the seam MAY use for `src/bundle`
  text files, not a constraint. The seam abstracts which, so the build recipe (ADR-001) can choose per asset
  class without touching call sites.
- *Rewrite `work-bundle.mjs`'s directory walk to `getAssetKeys` unconditionally* — rejected: it would break
  the dev path (there is no `sea` in dev). The walk resolves per-file THROUGH the seam so dev stays `readdir`
  and SEA becomes `getAssetKeys`/sidecar — one branch, in one place.

**Consequences.** Story 00 owns `src/asset-base.mjs` (the frozen resolver), the re-homing of all 7 sites onto
it (dev branch byte-identical), and fitness #1. This is the milestone's central runtime change and the reason
Story 00 is the **only** story touching existing `src/` modules. The *observable* (the packaged binary reads
its bundle/UI/version from the SEA base; the dev run is unchanged) is a Story 00 `.feature` + the `aof --version`
/ `aof mesh relay` probe (`@manual`), not a fitness function.

## ADR-004: One binary, two modes — the packaged binary calls the SAME `run()` command core; `relay` is the existing `aof mesh relay` argv branch, `node` is everything else; packaging introduces NO forked per-mode entry (08/ADR-001 preserved under packaging)

**Status:** Accepted
**Date:** 2026-07-03

**Context.** `SPEC §Scope` requires "one binary, two modes" — the node runtime and the relay ship as the SAME
binary (`node`/`relay`); `STATE §Notes` opens "how `node`/`relay` modes are selected from the single binary."
The graph makes the answer structural, not invented: `graph impact src/cli.mjs` reports **0 dependents** in the
src graph — `bin/aof.mjs` (`import { run } from "../src/cli.mjs"; run(process.argv.slice(2))`) is its ONLY
caller — and **26 dependencies** (every command module). `relay` mode already exists as an argv branch of that
one `run()`: `run(["mesh","relay"])` → `meshCommand` → `meshVerbCli("mesh:relay")` → `invoke("mesh:relay")`
(`23/ADR-001`; confirmed at `cli.mjs:67`, `cli.mjs:509`). So "two modes" is already "two argv routes through
one command core" — `08/ADR-001`'s CLI-as-contract, unchanged.

**Decision.** **The packaged SEA main is `bin/aof.mjs`'s bundled equivalent — it calls the SAME `run(argv)`
and NOTHING else. Mode is ARGV-ROUTED through the one command core; there is NO top-level `relay` fast-path and
NO forked per-mode entry.** Concretely:

- `node` mode = **everything the CLI already does** — `aof <anything-but-mesh-relay>` routes through `run()`'s
  existing argv dispatch (`init`/`work`/`graph`/`mesh identity|status|sync|heartbeat`/…).
- `relay` mode = **`aof mesh relay`** — the EXISTING `23/ADR-001` route (`meshVerbCli("mesh:relay")` →
  `invoke("mesh:relay")`; the long-lived serve is `serveRelay`/`relayMode`, the registered run is the
  non-blocking probe). No new verb, no new entry.

The SEA main is therefore **byte-equivalent in shape to `bin/aof.mjs`**: import (the bundled) `run`, call
`run(process.argv.slice(2))`, print the error + set exit code on reject. Packaging adds **zero** mode-dispatch
logic — the dispatch is `run()`'s existing argv branching, which the esbuild bundle carries intact. This is
enforced by fitness #2 (`acd-single-entry-command-core`): the packaged entry routes both modes through `run()`;
no second `run`-like entry function and no `if (mode === "relay")` fork exists in the entry/bundle.

**Alternatives considered.**
- *A top-level `relay` fast-path in the SEA main (branch on `argv[0] === "relay"` before `run()`)* — rejected:
  it forks the entry into two dispatch paths, duplicating `run()`'s argv handling and giving `relay` a second
  door — the exact `08/ADR-001` violation (one command core, one entry). `aof mesh relay` already reaches the
  relay through the one core; a fast-path adds nothing but a second thing to keep in sync.
- *A separate `aof-relay` binary (two products)* — rejected: it directly contradicts `SPEC §Scope` ("the same
  binary… no separate product to install", `PRD §7.3`) and doubles the sign/notarize/install surface. One
  binary, two argv routes.
- *A `--mode=relay` flag consumed by the SEA main* — rejected: it invents a NEW mode-selection surface parallel
  to the existing `aof mesh relay` (m23's contract), splitting "how you enter relay" into two idioms. The mode
  IS the subcommand; no flag needed.

**Consequences.** Story 00 owns the SEA main (the bundled `run()` call), the confirmation that no per-mode fork
exists, and fitness #2. **No new command verb is registered** (the R1-recall dividend: no registry-derived gate
is armed). The *observable* (the ONE packaged binary runs `aof --version` in node mode AND `aof mesh relay` in
relay mode) is a Story 00/01 `.feature` + the `@manual` probe on the built binary, not a fitness function.

## ADR-005: Per-OS signing / notarization is a build-pipeline decision (CI scripts, not runtime code) — Windows Authenticode via cloud/HSM, macOS codesign+hardened-runtime+notarytool+stapler, Linux GPG-signed SHA256SUMS; secrets are CI-held

**Status:** Accepted
**Date:** 2026-07-03

**Context.** `SPEC §Scope` requires signing/notarization per OS; `STATE §Notes` opens "the per-OS
signing/notarization path." `RESEARCH.md §4` measured each toolchain against 2024–2026 CA/policy reality, and
`§6` established the CI matrix these run on. Three OS-specific realities gate the pipeline: Windows now
**mandates** an OV/EV key on **HSM/cloud** (CA/B June-2023 rule — no exportable `.pfx` in CI); macOS is the
strictest — **all three** of codesign+hardened-runtime → notarytool → stapler are mandatory for a downloadable
binary, and **arm64 macOS refuses to run unsigned code**; Linux has no OS signing standard, the convention is a
GPG-signed `SHA256SUMS` (`RESEARCH.md §4`).

**Decision.** **Signing is a CI-pipeline concern — scripts + the GitHub Actions matrix — NOT runtime code (no
`src/` change).** Per OS:

- **Windows (Authenticode):** `signtool`/AzureSignTool with an **OV or EV cert on an HSM/cloud signing service**
  (Azure Trusted Signing / AzureSignTool / KMS — CA/B rule; no file cert), `/fd SHA256 /tr <rfc3161> /td
  SHA256` for timestamping. Expect **SmartScreen** reputation build-up on early releases (EV instant-trust
  removed 2024) — a documented, accepted friction, not a bug.
- **macOS (codesign → notarize → staple):** `codesign --sign "Developer ID Application: …" --options runtime
  --timestamp` → `xcrun notarytool submit --wait` (App Store Connect API key) → `xcrun stapler staple`. Runs
  on a **macOS runner**. **Ordering constraint (load-bearing):** `postject`/injection (ADR-001) must run
  **before** `codesign` — injection breaks an existing signature, so the SEA blob is injected, THEN
  `codesign --remove-signature` (if needed) + re-sign (`RESEARCH.md §4`).
- **Linux:** a **`SHA256SUMS` manifest + a GPG detached signature** (`SHA256SUMS` + `SHA256SUMS.asc`, the
  Node/HashiCorp shape). GPG key secret only; no hardware.

**Secrets are CI-held** (the Windows cloud-signing creds, the macOS Developer ID cert + App Store Connect API
key, the Linux GPG private key) — provisioned before the first signed release. **Verification is largely
`@manual`/`@uat`:** a human confirms a signed artifact clears Gatekeeper/SmartScreen, and that **unsigned arm64
macOS won't run** (`RESEARCH.md §4`) — this cannot be an `@executable` CI assert.

**Alternatives considered.**
- *Sign at runtime / self-sign in the binary* — rejected: signing is a property of the DISTRIBUTED artifact,
  applied by the trusted CI pipeline with CI-held keys, never by runtime code. No `src/` involvement.
- *A file `.pfx` in a CI secret for Windows* — rejected: the CA/B June-2023 rule forbids exportable OV/EV keys;
  the cert MUST live on HSM/cloud (`RESEARCH.md §4`). The pipeline references a cloud signing service.
- *Skip macOS notarization (codesign only)* — rejected: a signed-but-not-notarized binary is Gatekeeper-blocked
  when downloaded (quarantine xattr), and not-stapled fails offline — all three steps are mandatory
  (`RESEARCH.md §4`).

**Consequences.** Story 01 owns the signing scripts + the CI matrix (win Authenticode / mac
codesign+notarize+staple / linux GPG `SHA256SUMS`) that consume Story 00's build recipe and emit **signed
artifacts + the checksum/GPG manifest**. It is **file-disjoint greenfield** (CI YAML + signing scripts, not in
the src graph). Verification is `@manual`/`@uat` (a human clears Gatekeeper/SmartScreen on a real download).

## ADR-006: The one-line installer is a greenfield script pair — `install.sh` (curl|sh) + `install.ps1` (irm|iex); OS/arch-detect → download the right signed asset + its sidecar → verify checksum/signature → place on PATH

**Status:** Accepted
**Date:** 2026-07-03

**Context.** `SPEC §Scope` requires a one-line installer; `STATE §Notes` opens "the one-line installer."
`RESEARCH.md §5` measured the accepted shapes (rustup/deno/bun/volta prior art) and the concrete
`deno_install/install.sh` mechanics (`uname -sm` → target triple → download → per-user install to
`$HOME/.<tool>/bin`, PATH deferred; deno notably does **no** checksum verify). This milestone's whole point is
**signed** binaries, so the installer **adds the verification deno omits** (`RESEARCH.md §5`).

**Decision.** **Two greenfield installer scripts**, distributed from a stable pinned URL:

- **POSIX** `install.sh` — `curl -fsSL https://<host>/install.sh | sh`.
- **PowerShell** `install.ps1` — `irm https://<host>/install.ps1 | iex`.

Each: **detect OS/arch** (`uname -sm` on POSIX per `deno_install`; `$env:PROCESSOR_ARCHITECTURE` +
`[Environment]::Is64BitOperatingSystem` on PowerShell) → **download the matching signed asset PLUS its node-pty
sidecar** (ADR-002 — the sidecar is a co-download, not a second product; "one binary, two modes" means ONE
binary file placed, `relay` is a runtime subcommand not a second download, `RESEARCH.md §5`) → **verify BEFORE
placing on PATH** (fetch `SHA256SUMS`, `sha256sum -c` / `Get-FileHash`; on Linux additionally `gpg --verify
SHA256SUMS.asc`; macOS/Windows lean on Gatekeeper-staple / Authenticode) → **place per-user on PATH**
(`$HOME/.aof/bin` idiom, no sudo — avoids Windows admin + macOS system-dir friction, `RESEARCH.md §5`). The
README carries the one-liner.

**Decision — the checksum/signature format is a SOFT CONTRACT on ADR-005's manifest.** The installer's verify
step consumes the exact `SHA256SUMS`(+`.asc`) shape Story 01 emits — this is a **format contract** (the manifest
filename + line shape + the GPG `.asc` companion), authored in parallel and pinned as the seam between the two
stories, so the installer's `@executable` unit logic (OS/arch detect, arg parse) runs against a **fixture
manifest** before Story 01's real artifacts exist.

**Alternatives considered.**
- *Skip verification (the deno default)* — rejected: this milestone exists to ship SIGNED binaries; an
  installer that doesn't verify throws away the signature's value. Verify-before-PATH is the point
  (`RESEARCH.md §5`).
- *Generalize/extend `src/frameworks.mjs`'s npx installer* — rejected (the m09/ADR-004 recall lesson): the
  console installer is a NEW distribution artifact for a NEW audience (no-Node end users); it must NOT touch
  the load-bearing in-repo installer. Greenfield scripts.
- *A system-wide install requiring sudo/admin* — rejected: per-user `$HOME/.aof/bin` is the prior-art norm and
  sidesteps Windows HSM/admin + macOS system-dir issues (`RESEARCH.md §5`).

**Consequences.** Story 02 owns `install.sh` + `install.ps1` + the README one-liner. It is **file-disjoint
greenfield** and consumes Story 01's **signed artifacts + checksum/signature format** (the soft contract). Its
`@executable` units are the OS/arch-detect + arg-parse logic (against a fixture manifest); the real install is
`@uat` (a human runs the real one-liner on their OS and confirms a working `aof`).

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI. These
     replace "invariant-as-scenario" — they belong here, never in a task feature. Each new arch-test
     registers in scripts/test.mjs (the `import { archTests as … } from "../test/arch/acd-*.test.mjs"`
     + push into the suite), comment/string-strips before matching (the acd-run-store-mesh-free model),
     and carries the m03 non-vacuous self-check (the detector fires on a planted violation, and does NOT
     fire on the legitimate seam). RED-until-built is the correct state now: src/asset-base.mjs, the
     re-homed sites, the SEA main, and the sidecar re-home do not exist yet. "From" names the owning story. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **SEA-safe asset base.** Every runtime bundle/UI/schema/version asset read routes through the single SEA-safe base resolver (`src/asset-base.mjs`); **no** runtime module under `src/` joins an asset path off a bare `import.meta.url` / `fileURLToPath(import.meta.url)` root OUTSIDE that seam. **Allow-list:** the seam itself + the **dev-only vite re-exec** (`cli.mjs:2099`, never on the shipped path). (ADR-003) | `test/arch/acd-sea-safe-asset-base.test.mjs` — comment/string-stripped source-grep across `src/**.mjs`: assert no module (except `src/asset-base.mjs` and the allow-listed vite re-exec line) constructs an asset path from `fileURLToPath(import.meta.url)`/`import.meta.dirname`/`import.meta.url` joined to `"bundle"`/`"ui"`/`"dist"`/`"package.json"`; the 7 known sites reference `assetBase()`/the seam's export instead. Self-check: the matcher fires on a planted `path.join(fileURLToPath(import.meta.url), "bundle")` and does NOT fire on a call to `assetBase()`. | RED until `src/asset-base.mjs` + the re-homings land | **00** |
| **Single-entry command core.** The packaged entry (`bin/aof.mjs` / the SEA main) routes both `node` and `relay` modes through the ONE `run()` command core; NO second forked entry per mode, NO top-level `relay` fast-path. (ADR-004, 08/ADR-001) | `test/arch/acd-single-entry-command-core.test.mjs` — source-analysis of `bin/aof.mjs` (+ the SEA-main recipe): assert it imports `run` from `src/cli.mjs` and calls exactly `run(process.argv.slice(2))` with **no** `argv[0] === "relay"` / `mode === "relay"` branch before it, and that `src/cli.mjs` exports exactly one `run`; grep the entry for a forbidden second dispatch function. Self-check: the matcher fires on a planted `if (argv[0]==="relay") serveRelay()` fast-path and passes the real `run(...)`-only entry. | RED until the SEA main recipe lands (GREEN already for `bin/aof.mjs`) | **00** |
| **Native addon degrades.** node-pty is loaded ONLY via the guarded dynamic import/`createRequire` inside `defaultSpawn` that degrades on absence; **no** module hard-`import`s a `.node` at top level, so a missing sidecar never crashes startup. (ADR-002) | `test/arch/acd-native-addon-degrades.test.mjs` — comment-stripped import-specifier grep across `src/**.mjs`: assert (a) no top-level `import` of `"node-pty"` or any `*.node` (the only node-pty reference is INSIDE `defaultSpawn` in `terminal-ws.mjs`), and (b) `terminal-ws.mjs`'s node-pty load is wrapped such that a load/spawn failure yields the `{type:'error'}` frame (the try/catch is present). Self-check: the matcher fires on a planted top-level `import ptyModule from "node-pty"` and does NOT flag the in-`defaultSpawn` dynamic load. | RED until the sidecar/`createRequire` re-home lands (the guard already exists) | **00** |
| **Build-recipe completeness.** The asset manifest fed to the bundler covers EVERY file the runtime reads under `src/bundle/` (+`ui/dist`), so nothing is silently omitted from the binary. (ADR-001/ADR-003) | **A build-script UNIT test** (`test/*` on the manifest generator), NOT a pure arch-grep: enumerate `src/bundle/**` (37 files) + `ui/dist/**` on disk and assert the generated SEA `assets` map (or sidecar file list) contains a key for each — a **set-equality** check the generator's logic drives (empty diff both directions). Best as a **build-script unit test** (it executes the generator over real trees) rather than a source-grep arch-test, because completeness is a computed property of the generator's output, not a syntactic source invariant. Self-check: planting a file under `src/bundle/` with no manifest entry fails the set-equality. | RED until the manifest generator exists | **00** |

<!-- Note on arch-test vs behavioural scenario (mirrors m23's split):
     - SEA-SAFE ASSET BASE, SINGLE-ENTRY COMMAND CORE, and NATIVE-ADDON-DEGRADES are true STRUCTURAL
       source invariants (a grep/AST discipline over src/**.mjs + the entry) → arch-tests in test/arch,
       registered in scripts/test.mjs. They are the milestone's load-bearing structural deliverable and
       all live in Story 00.
     - BUILD-RECIPE COMPLETENESS is a COMPUTED property of the manifest generator's output over the real
       asset trees → a build-script UNIT test (it runs the generator), not a syntactic arch-grep. Called
       out explicitly so the PO places it as an @executable build-logic unit, not a test/arch grep.
     - The OBSERVABLE behaviours — "the built binary runs `aof --version` (node mode) AND `aof mesh relay`
       (relay mode) with no toolchain", "a real PTY session runs over the sidecar / a missing sidecar
       degrades to an error frame not a crash", "the installer downloads+verifies+places a working `aof`" —
       exercise real builds, real signing, real installs. They are @manual/@uat deliverables in the story
       .feature files, NOT fitness functions.
     - KR4 ("a single signed command → a working node on all three OSes") and Gatekeeper/SmartScreen
       clearance are @uat human sign-offs (a real signed install on the operator's OS), not CI asserts. -->

## Story break-down rationale

<!-- Informs the PO's break-down; does NOT itself create stories. The PO partitions milestone 28 into
     exactly three stories. The partition follows the real call/dependency coupling the codebase graph
     reports, not inferred coupling. -->

The PO will partition milestone 28 into **exactly three stories** forming a **linear artifact pipeline**
(build → sign → install). The boundary follows the **real call/dependency coupling** the codebase graph
reports (`aof graph build src` → **1261 nodes / 3400 edges**, builtAt 2026-07-03; `aof graph impact` consulted
at author time — cited as **actual** structure, not inferred).

- **00 · the self-contained binary (the code-coupled story)** — owns the SEA build recipe (`sea-config.json` +
  the esbuild→CJS pre-bundle + the asset-manifest generator, ADR-001), the **new `src/asset-base.mjs` seam +
  the re-home of all 7 `import.meta.url` sites** (ADR-003), the **node-pty sidecar strategy + the dynamic-import
  re-home + the retained graceful-degrade** (ADR-002), the **single-entry two-mode confirmation** (ADR-004,
  the SEA main), and the SEA-safety fitness functions (#1/#2/#3 + the build-recipe completeness unit #4).
  Produces an **UNSIGNED working binary on the reference OS** (KR4 minus signing). It is the **ONLY** story
  touching existing `src/` modules.
- **01 · cross-OS signing & notarization (file-disjoint greenfield)** — owns the CI runner matrix
  (win/mac/linux) that builds + signs each artifact (Authenticode / codesign+notarize+staple / GPG
  `SHA256SUMS`, ADR-005) + the **Linux node-pty CI compile** (ADR-002) + the checksum/GPG manifest. New CI YAML
  + signing scripts — **not in the src graph**. Consumes Story 00's build recipe.
- **02 · the one-line installer (file-disjoint greenfield)** — owns `install.sh` + `install.ps1` (OS/arch
  detect → download signed asset + node-pty sidecar → verify checksum/signature → place on PATH, ADR-006) + the
  README one-liner. New scripts — **not in the src graph**. Consumes Story 01's signed artifacts + checksum
  format.

**Why this boundary is grounded in the graph, not inferred:**

1. **The runtime change is ONE seam + one re-home on low-fan-out mechanics — all in Story 00.** `graph impact`
   reports the 7 asset-base sites on distinct low-fan-out modules — `work-bundle.mjs` (← 6 / → 2),
   `board-serve.mjs` (← 1 / → 1), `setup-ui.mjs` (← 2 / → 4), `mesh-ui-serve.mjs` (← 1 / → 2),
   `work-bundle-manifest.mjs` (← 1 / → 1), `mesh-identity.mjs` (← 3 / → 7) — **no god-node**, so threading one
   `src/asset-base.mjs` seam through each is an additive substitution, not a hot-core rewrite. node-pty's site,
   `terminal-ws.mjs`, is a **leaf under one parent** (← 1 `setup-ui.mjs` / → 4) and — decisively — the graph
   shows **no static edge to node-pty at all** (it is reached only inside `defaultSpawn`'s guarded dynamic
   import), which is the exact structural fact ADR-002's degrade property and fitness #3 rest on. All of this
   coupling is confined to `src/`, so it lands wholly in **Story 00** — the single code-coupled story.

2. **`run()` is the one entry both modes already share — the graph proves the single door.** `graph impact
   src/cli.mjs` reports **0 dependents in the src graph** (only `bin/aof.mjs`, outside src, imports `run`) and
   **26 dependencies** (every command module). `relay` mode is already `run(["mesh","relay"])` →
   `meshVerbCli("mesh:relay")` → `invoke("mesh:relay")` (`23/ADR-001`; `mesh-relay.mjs` ← 3 / → 1). So ADR-004's
   "one binary, two modes = two argv routes through one `run()`" is a **confirmation** the graph dictates, not
   a new structure — and it needs **NO new command verb** (the R1-recall dividend: no registry-derived gate is
   armed). This keeps Story 00's entry work to a bundled `run()` call.

3. **Stories 01 and 02 are FILE-DISJOINT GREENFIELD — they are not in the src graph.** The CI matrix + signing
   scripts (01) and the installer scripts (02) are **new files with zero edges into `src/`** — `graph impact`
   has nothing to report because they do not exist in the source graph and do not import any `src/` module.
   Their coupling to Story 00 is **at the ARTIFACT boundary, not the source**: 01 consumes 00's build-recipe
   OUTPUT (the unsigned binary + asset layout), and 02 consumes 01's signed-artifact OUTPUT (the signed binary
   + `SHA256SUMS`). This artifact-boundary coupling is exactly what lets the three CONTRACTS be authored in
   parallel and each story's `@executable` units run against a **fixture/stub upstream artifact** (00's
   asset-manifest completeness over the real trees; 01's manifest-format contract; 02's OS/arch-detect +
   arg-parse over a fixture `SHA256SUMS`).

4. **The dependency edges are a strict linear chain 00 → 01 → 02, with one soft contract.** 01 depends on 00's
   build recipe (a hard OUTPUT edge — 01 cannot sign what 00 has not built). 02 depends on 01's signed
   artifacts + checksum format; the **checksum/signature-verify is a SOFT CONTRACT on 01's manifest format**
   (the `SHA256SUMS`+`.asc` filename/line shape, ADR-006) — pinned as a format seam so 02's installer verify
   logic is written and unit-tested against a **fixture manifest** in parallel with 01's real pipeline. There
   is **no** cross-story edge inside `src/`: 01 and 02 add no `src/` code, and 00's `src/` changes are consumed
   by 01/02 only through the built artifact, never a source import.

**The verification-strategy reality for a packaging milestone (be honest about it).** Verification here is
**mostly `@manual` and `@uat`, with `@executable` reserved for the structural + build-logic residue**:
- `@executable` — the fitness functions (#1/#2/#3, `test/arch/acd-*`) + the build-script unit logic (the
  asset-manifest completeness set-equality #4, the installer's OS/arch-detect + arg-parse #02, ADR-006). These
  are the CI-green deliverables.
- `@manual` (agent-runnable) — build the SEA on the reference OS → run the binary → `aof --version` (node mode)
  + `aof mesh relay` probe (relay mode) + a live PTY session over the sidecar; the Linux node-pty compile
  confirmation. These are the KR4-minus-signing checks a build agent can run.
- `@uat` (human, on their OS) — a real **signed** install clears **Gatekeeper/SmartScreen** (01), and **unsigned
  arm64 macOS won't run** (`RESEARCH.md §4`, a negative a human confirms); the full one-liner
  `curl|sh`/`irm|iex` places a working `aof` (02). KR4's "a single signed command → a working node on all three
  OSes" is intrinsically a human cross-OS sign-off.

The coupling is **advisory**: it informs why the code-coupled binary (00) + a greenfield sign pipeline (01) + a
greenfield installer (02) is the right cut (the graph confines all `src/` change to 00; 01 and 02 touch no
`src/` and couple only at the artifact boundary), but the PO draws the final partition. The graph confirms — it
does not dictate.
