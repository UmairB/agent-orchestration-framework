---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Report facts; the architect decides what to do about them (→ ARCHITECTURE.md).
-->
# 28 · Cross-Platform Console App — Research

**Gathered:** 2026-07-03
**Method:** This repo as ground truth — `package.json`, `bin/aof.mjs`, `src/cli.mjs`,
`src/terminal-ws.mjs`, `src/work-bundle.mjs`, `src/board-serve.mjs`, `src/setup-ui.mjs`,
`src/mesh-ui-serve.mjs`, `src/mesh-relay.mjs`, `src/commands/mesh-identity.mjs`; the **installed**
`node_modules/node-pty/` (package.json, `lib/utils.js` loader, `scripts/prebuild.js`,
`prebuilds/` tree) and `node_modules/ws/` package.json; `node --version` (v22.22.2 locally),
`du`/`find` on `src/bundle` + `ui/dist`. Tooling realities from official docs + maintainer sources:
Node.js SEA API docs, nodejs/node PR #61813, `@yao-pkg/pkg` docs, Microsoft/Apple signing docs,
`deno_install`. Sources cited inline with versions/dates.
**Status:** Desk + installed-package inspection complete. The two facts that gate the design are
evidenced from ground truth, not docs: (a) node-pty is a native `.node` addon loaded by **relative
`require`** with **no Linux prebuild shipped**; (b) SEA **ESM entrypoint support landed in Node
25.7.0**, so a Node 22 LTS SEA is CommonJS-entry only. No live build was run (that is a build-time
confirmation for the architect's first task). No blockers — but one large packaging risk (node-pty).

---

## 0. What actually has to travel with the binary (ground truth)

- **Entry + shape.** `bin/aof.mjs` (`#!/usr/bin/env node`) imports `run` from `src/cli.mjs`.
  `package.json`: `"type": "module"` (pure ESM), `"engines": { "node": ">=20" }`, `"bin": { "aof":
  "./bin/aof.mjs" }`. Runtime deps: `@inquirer/prompts ^8.4.2` (pure JS), `ws ^8.21.0` (pure JS),
  `node-pty 1.1.0` (**native**). `ajv` is a **devDependency** and is **not** imported anywhere under
  `src/` (grep: 0 hits) — it does not ship in the binary.
  - *Constraint:* the packaged app is ESM-first. Only node-pty is native; everything else is JS.

- **Runtime asset directories read from disk, relative to the install location:**
  - `src/bundle/` — the ACD bundle (agents/, commands/, templates/, `bundle.json`, `manifest.json`).
    `src/work-bundle.mjs:25` `bundleRoot()` = `path.join(path.dirname(fileURLToPath(import.meta.url)),
    "bundle")`, then `readFileSync`/`readdirSync` on `bundle.json` and every member file
    (`work-bundle.mjs:35,76,101,131`). **37 files, ~228 KB.**
  - `ui/dist/` — the built board/fleet UI, served as static files. `boardUiDist(repoRoot)` =
    `<repoRoot>/ui/dist` (`board-serve.mjs:17`), same for `meshUiDist` (`mesh-ui-serve.mjs:42`); both
    refuse to serve if `ui/dist/index.html` is absent (`board-serve.mjs:27`, `mesh-ui-serve.mjs:55`).
    **~733 KB, present in-tree.** `serveSetupUi` also defaults `uiRoot` to `<repoRoot>/ui`
    (`setup-ui.mjs:18`).
  - `package.json` — read at runtime for the version string. `aofVersion()`
    (`commands/mesh-identity.mjs:67`) reads `<here>/../../package.json`. This provenance rides the
    mesh heartbeat, so it must resolve inside the binary.
  - *Constraint:* the binary must ship `src/bundle/**` (~228 KB, 37 files) and `ui/dist/**` (~733 KB)
    as embedded/sidecar assets, plus a version string. All three are located today via
    `import.meta.url` "one/two levels up from `src/`" — a resolution that changes under packaging (see §1).

- **repo-root / `import.meta.url` resolution sites (all break or shift under packaging):**
  `src/cli.mjs:2099`, `src/board-serve.mjs:24`, `src/mesh-ui-serve.mjs:48`, `src/setup-ui.mjs:17`,
  `src/work-bundle.mjs:26`, `src/work-bundle-manifest.mjs:24`, `src/commands/mesh-identity.mjs:67`.
  - *Constraint:* every one of these assumes a real `src/…` directory on disk one level below a
    repo root. Inside a SEA, `import.meta.url` = a `file:` URL for `process.execPath` and
    `import.meta.dirname` = the executable's directory (Node SEA docs, §"Module resolution"); under
    `@yao-pkg/pkg` these resolve into the snapshot virtual FS. The base-path idiom must be re-homed to
    an asset lookup (SEA `sea.getAsset`) or a sidecar-relative path — the architect's decision.

- **Child processes (fine for a packaged binary — external spawns, not node re-exec):**
  All the operational spawns are **external binaries** resolved off PATH via the shell-less argv
  idiom: `git` (`mesh-join.mjs:91,95`, `mesh-revoke.mjs:82,86`, `import/source.mjs:82`), the graphify
  tool and coding-assistant CLIs (`graphify.mjs:135,160,188`, `frameworks.mjs:104`,
  `config-inspect.mjs:568`, `project-provision.mjs:137`), and the PTY-spawned `claude`/`codex`
  (`terminal-ws.mjs` → node-pty). **One exception:** `startSetupUiFrontend` (`cli.mjs:2098-2102`)
  re-execs `process.execPath` to run **vite** for the UI **dev** server (`VITE_AOF_UI_MODE`).
  - *Constraint:* the dev-server re-exec is the only spot that assumes a real `node` + a
    `node_modules/vite` on disk — it cannot work from inside a SEA and is a **dev-only** path; the
    shipped board/fleet UI serve from `ui/dist` and do **not** touch it. Everything else spawns
    external tools by name off PATH, which a packaged binary does identically. `process.execPath`
    inside a SEA points at the aof binary itself, not `node` — any future "re-run myself as node" would
    need `--` sub-dispatch, not a node re-exec.

---

## 1. Node SEA (single-executable applications) — reality on Node 20/22/LTS

- **Stability & mechanism.** SEA is **Stability 1.1 (Active development)** (Node.js SEA docs, current).
  The classic pipeline works on **every Node 22+ install** with no extra toolchain: write
  `sea-config.json` → `node --experimental-sea-config sea-config.json` (emits `sea-prep.blob`) → copy
  the `node` binary → inject the blob with **`postject`** using the sentinel fuse
  `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` (+ `--macho-segment-name NODE_SEA` on macOS).
  Newer Node (v25.5.0+) adds a one-shot `node --build-sea sea-config.json`. Config fields:
  `main`, `output`, `disableExperimentalSEAWarning`, `useSnapshot`, `useCodeCache`, `assets`,
  `execArgv`, and `mainFormat`. (Source: nodejs.org SEA docs.)
  - *Constraint:* SEA needs **no cross-toolchain** and ships in-box — attractive. But `useCodeCache`
    is "incompatible with cross-platform builds and `import()`", and SEA has **no cross-compilation**
    at all: you copy the *host's* `node` binary, so each OS/arch artifact must be built on a **matching
    runner** (→ the GH Actions matrix in §6).

- **ESM entrypoint is the decisive version gate.** `"mainFormat": "module"` (ESM SEA entrypoint) was
  added in **Node.js v25.7.0** via **PR #61813** (nodejs/node) — a semver-minor. **It is NOT in Node
  22 LTS.** On Node 22 the SEA main script must be **CommonJS**. This app is `"type": "module"` (pure
  ESM), so on Node 22 the entry must be **pre-bundled to a single CJS file** (esbuild/ncc) before
  injection; the maintainer guidance is explicit: "SEA expects exactly one entry script … use esbuild
  to bundle ESM/CJS/dynamic-imports into one file" (HireNodeJS SEA-2026 guide).
  - *Constraint:* pick one — (a) **bundle to CJS** with esbuild and target Node 22 LTS, or (b) target
    **Node 24/25+** and use a native-ESM SEA. Given `engines: >=20` and the ESM-native `import()` of
    node-pty, option (a) is the lower-risk, LTS-aligned path today; note `import.meta.url` rewrites to
    a bundler shim under esbuild.

- **`import.meta.url` / `__dirname` inside a SEA.** `__dirname`/`import.meta.dirname` =
  **directory of `process.execPath`**; `__filename`/`import.meta.filename` = `process.execPath`;
  `import.meta.url` = the `file:` URL of `process.execPath`. `import.meta.resolve` is **not** supported.
  A bare `require()` in the injected main has only `require.main`; to load from the real FS you must
  `require = createRequire(__filename)`. Crucially, **`import()` in a SEA main can only load built-in
  modules — FS `import()` throws.** (Node SEA docs, §"require in the injected main script".)
  - *Constraint:* the `bundleRoot()`/`repoRoot` idiom no longer points at `src/…`; it points at the
    binary's own directory. Two consequences: (1) `await import("node-pty")` in `terminal-ws.mjs:29`
    **will throw inside a raw SEA main** (FS dynamic import) — node-pty must be reached another way
    (§2); (2) all bundle/UI reads must move to `sea.getAsset(...)` or a sidecar path anchored at
    `import.meta.dirname`.

- **Embedding a whole DIRECTORY tree (`src/bundle/`, `ui/dist/`).** SEA `assets` is a **flat
  key→file map** in `sea-config.json`; read back with `sea.getAsset(key[,enc])` (string/ArrayBuffer),
  `sea.getRawAsset(key)` (no-copy ArrayBuffer), `sea.getAssetAsBlob(key)`, and `sea.getAssetKeys()`
  (list keys; added v24.8.0 / **v22.20.0**). There is **no directory/virtual-FS primitive** — a tree
  must be flattened to one asset entry **per file** (e.g. `"bundle/commands/next.md": "src/bundle/…"`),
  or shipped as a **sidecar** directory next to the binary, or packed into one archive asset and
  unpacked at runtime. `src/bundle/` = 37 files; `ui/dist/` adds more — a generator that walks the
  trees into the `assets` map is the practical route. (Node SEA docs, §"Assets".)
  - *Constraint:* the code that does `readdirSync`/`readFileSync(path.join(root, file))`
    (`work-bundle.mjs:76,101,131`) has to be re-pointed at `getAsset`/`getAssetKeys`, OR the assets
    ship as a sidecar folder and the base path is re-homed to `import.meta.dirname`. A build step must
    enumerate both trees into `assets` (or the sidecar) — it is not a single line of config.

---

## 2. The native-addon problem — node-pty (the single biggest risk)

- **node-pty 1.1.0 is a native C++ addon**, `require`d — not `import`ed — at load time. `package.json`
  depends on `node-addon-api ^7.1.0`, ships `binding.gyp`, and its `install` script runs
  `node scripts/prebuild.js || node-gyp rebuild` (`node_modules/node-pty/package.json:41`). It is
  CommonJS (`lib/index.js` uses `require('./windowsTerminal')` / `require('./unixTerminal')`).

- **How it loads the `.node` — relative `require`, no virtual-FS support.** `lib/utils.js:17-37`
  `loadNativeModule(name)` tries, in order, `../build/Release`, `../build/Debug`,
  `../prebuilds/<platform>-<arch>`, then the same list relative to `.`, and calls
  **`require(dir + "/" + name + ".node")`**. On win32 the addon is loaded eagerly the moment
  `windowsPtyAgent.js` is required (`:42,47`), on unix via `index.js:51`
  `loadNativeModule('pty')`.
  - *Constraint:* a `.node` **cannot be loaded from inside a SEA blob** — Node's loader needs a real
    file on disk and the docs' sanctioned path is `getRawAsset` → `fs.writeFileSync(tmp)` →
    `process.dlopen(tmp)`. node-pty's own loader does **plain relative `require`**, which will not find
    an embedded asset. So node-pty must exist as a **real `.node` on disk** next to the binary and be
    reached via a filesystem `require`/`createRequire` — not embedded.

- **Prebuilds SHIPPED in the installed package (decisive, from `prebuilds/`):**
  `darwin-arm64/pty.node` (+`spawn-helper`), `darwin-x64/pty.node` (+`spawn-helper`),
  `win32-x64/` and `win32-arm64/` (each: `pty.node`, `conpty.node`, `conpty_console_list.node`,
  `winpty.dll`, `winpty-agent.exe`, and a `conpty/` folder with `conpty.dll` + `OpenConsole.exe`).
  **There is NO `linux-*` directory.** `scripts/prebuild.js:29` exits non-zero when the
  `prebuilds/<platform>-<arch>` dir is absent, so on Linux `npm install` **falls through to
  `node-gyp rebuild`** — i.e. Linux has no prebuilt `.node` and requires a C++ toolchain at install
  time.
  - *Constraint:* macOS (x64+arm64) and Windows (x64+arm64) can ship the **shipped prebuilt** `.node`
    (+ the Windows `winpty`/`conpty` sidecar files — note pty.node has **runtime companions**, not just
    one file). **Linux must build node-pty from source on the CI runner** (or adopt a prebuilt-multiarch
    fork) to obtain a `linux-x64`/`linux-arm64` `.node`. This is the concrete Linux packaging gap.

- **@yao-pkg/pkg addon handling.** pkg auto-detects `.node` in `require()` calls, packs them as
  assets, and **extracts to a cache dir on first launch** (`$HOME/.cache/pkg-native/`, `%LOCALAPPDATA%`
  on Windows; overridable via `PKG_NATIVE_CACHE_PATH`) then `require`s the extracted file. But
  node-pty builds its `.node` path **dynamically** (`dir + "/" + name + ".node"`), which pkg's static
  detector **won't see** — such addons must be **manually listed** in the pkg `assets` config, and pkg
  requires the prebuilt binary to already match each `--target` platform/arch. (yao-pkg native-addons
  guide.)
  - *Constraint:* even pkg, which is friendlier to addons than SEA, needs manual `assets` entries for
    node-pty and still needs a per-platform `.node` present — including the Linux one it cannot cross
    compile.

- **Graceful degrade is already wired.** node-pty is imported **only when a real PTY session starts**
  (`terminal-ws.mjs:28-31` `defaultSpawn` does `await import("node-pty")` inside the call; tests inject
  a stub). A spawn failure is caught and surfaced as a `{type:'error'}` control-frame (`:166-175`,
  ADR-003) — importing `terminal-ws.mjs` never needs the addon.
  - *Constraint:* if the `.node` is absent/unloadable on a given target, only the **in-browser
    terminal dock** feature degrades (an error frame), not the CLI or relay. This makes "ship the
    `.node` sidecar; degrade the PTY feature if missing" a viable, low-blast-radius option — but note
    the FS-`import()` issue above (raw SEA main cannot `import()` node-pty from disk; needs
    `createRequire`).

**node-pty handling options (ranked, for the architect):**
1. **Sidecar `.node` next to the binary, loaded via `createRequire`/filesystem `require`.** Ship the
   per-OS/arch prebuilt(s) (mac + win from the package; **build Linux in CI**), keep node-pty as a
   real on-disk module. Lowest risk, matches node-pty's own loader, keeps degrade path.
2. **@yao-pkg/pkg** with node-pty manually in `assets` (auto-extracts to cache). Removes the
   hand-rolled sidecar, but still needs a per-platform `.node` (incl. built Linux) and adds pkg's
   maintenance/version-match surface.
3. **Embed `.node` as a SEA asset + `getRawAsset`→tmp→`process.dlopen`.** Works per Node docs but
   requires **replacing node-pty's own `loadNativeModule`** (it won't call `getRawAsset`), plus the
   Windows companions (`winpty.dll`, `conpty/…`) also need extracting. Most invasive.
4. **Drop the PTY/terminal-dock feature from the packaged binary** (degrade unconditionally). Only if
   the in-browser terminal is out of scope for the shipped binary — a product call, not a packaging one.

---

## 3. `pkg`-style alternative — `@yao-pkg/pkg`

- **What it is / status.** The **actively maintained** fork of the archived `vercel/pkg`
  (yao-pkg). Latest **v6.21.0** (published ~2026-06-30, npm). Supports **CJS and ESM**. Cross-compiles
  Linux/macOS/Windows and x64/arm64 **from a single host** on **Node 20 and 24**; **Node 22 has a
  known Standard-mode regression** (works via `--sea`/`--public` there). Native addons packed as
  assets and extracted to a cache dir at runtime (§2). Assets/dirs handled via a snapshot FS + the
  `pkg.assets` config with glob support (`__dirname`/`path.join` resolve into the snapshot). (Sources:
  npmjs `@yao-pkg/pkg`; yao-pkg guides.)

- **SEA vs @yao-pkg/pkg — the trade-off:**

  | Axis | Node **SEA** | **@yao-pkg/pkg** |
  |---|---|---|
  | Node version | In-box, all 22+; **ESM entry needs 25.7.0+**, else pre-bundle to CJS | 20/24 clean; **22 has a Standard-mode regression** |
  | ESM | Native only 25.7+; on 22 → esbuild→CJS first | CJS + ESM |
  | Native addons | Manual: `getRawAsset`→tmp→`dlopen`; **node-pty's own loader won't use it** | Auto-detect + cache-extract; node-pty's **dynamic** path needs manual `assets` |
  | Directory assets | Flat `assets` map, **one entry/file**, no dir primitive; `getAsset*` API | `pkg.assets` **globs**, snapshot FS, `__dirname`-relative reads mostly "just work" |
  | Cross-compile | **No** — copies host `node`; needs per-OS runner | **Yes** from one host (subject to per-platform prebuilt addons) |
  | Output size | Smallest (bare Node + blob) | Larger (bundled Node base) |
  | Maintenance risk | First-party Node, Stability 1.1 (moving) | Single-fork dependency, but active |

  - *Constraint:* **SEA** is first-party and smallest but forces a **per-OS CI matrix** and hands you
    the directory-asset + addon plumbing manually (and the ESM-entry version gate). **@yao-pkg/pkg**
    buys cross-compilation, glob asset bundling, and automatic addon extraction at the cost of a
    third-party dependency and a Node-22 caveat. For **this ESM app with a directory of assets and a
    dynamically-loaded native addon**, `@yao-pkg/pkg` removes the most bespoke work; SEA is the
    "stay-in-the-platform, accept the matrix + manual asset/addon wiring" option. The architect
    decides; the recommendation and rationale are in "Decision inputs" below.

---

## 4. Per-OS signing / notarization — toolchain + prerequisites

- **Windows (Authenticode).** Sign with **`signtool sign /fd SHA256 /tr <rfc3161-ts-url> /td SHA256`**
  (timestamping so signatures survive cert expiry). Cert types: **OV** or **EV**. Since **June 2023**,
  the CA/Browser Forum requires OV (and EV) code-signing private keys to live on **FIPS-140-2 L2 /
  CC EAL4+ hardware** — a **USB token or a cloud HSM** (Azure Key Vault + **AzureSignTool**, AWS
  KMS/CloudHSM, GCP KMS, or **Azure Trusted Signing**); you can no longer export a plain `.pfx` and
  sign in CI with just a file. **SmartScreen:** an **unsigned** (or newly-signed) `.exe` triggers a
  Microsoft Defender SmartScreen "unrecognized app" warning; reputation now accrues **per file hash
  over time for both OV and EV** — the EV "instant-trust" bypass was **removed in 2024**. (Sources:
  Microsoft "Code signing options"; CA/B Forum 2023 HSM rule.)
  - *Constraint:* Windows signing in GitHub Actions needs a **secret that references an HSM/cloud
    signing service** (e.g. Azure Trusted Signing / AzureSignTool), not a file cert. Expect SmartScreen
    friction on first releases regardless of cert grade — plan for reputation build-up, not instant
    trust.

- **macOS (codesign → notarize → staple).** (1) **`codesign --sign "Developer ID Application: …"
  --options runtime --timestamp`** — a **Developer ID Application** cert (paid Apple Developer
  Program) with the **hardened runtime** (`-o runtime`) required for notarization. (2)
  **`xcrun notarytool submit … --wait`** (Apple ID or **App Store Connect API key**) — Apple's malware
  scan issues a ticket. (3) **`xcrun stapler staple <artifact>`** — attaches the ticket so it verifies
  offline. **Failure modes:** unsigned/wrong-signed → **Gatekeeper** blocks; signed-but-not-notarized
  → Gatekeeper blocks downloaded (quarantined, `com.apple.quarantine` xattr) binaries with "cannot be
  opened"; notarized-but-not-stapled → works online, fails offline. **Ad-hoc** signing
  (`codesign -s -`) satisfies arm64's mandatory-signing (arm64 macOS **refuses to run unsigned code**)
  but is **local-machine only** — no good for distribution. (Sources: Apple Developer ID / notarization
  docs; rsms macOS distribution gist.)
  - *Constraint:* macOS is the strictest — **all three** steps are mandatory for a downloadable binary,
    and **arm64 will not even run an unsigned build**. CI needs the Developer ID cert + an App Store
    Connect API key as secrets. `postject` on macOS must run **before** `codesign` (injection breaks an
    existing signature; SEA docs note `codesign --remove-signature` then re-sign).

- **Linux.** No OS-level code-signing standard. The **accepted convention** is a **`SHA256SUMS`
  manifest + a GPG detached signature** (`SHA256SUMS` + `SHA256SUMS.asc`/`.sig`) — the Node.js
  (`SHASUMS256.txt` + `.asc`) / HashiCorp (`*_SHA256SUMS` + `.sig`) shape. Users run
  `gpg --verify SHA256SUMS.asc SHA256SUMS` then `sha256sum -c SHA256SUMS`; the public key is published
  on the project site / keys.openpgp.org for distro packagers. (Sources: GnuPG docs; Node/HashiCorp
  release conventions.)
  - *Constraint:* Linux "signing" = publish a GPG-signed `SHA256SUMS`. Fully CI-friendly with a GPG
    private key secret; no hardware needed.

- **What runs in CI vs needs secrets/hardware:** all three are CI-runnable. **Windows** needs a
  cloud/HSM signing secret (no file cert). **macOS** needs Developer ID cert + notarization API key
  secrets and must run on a macOS runner. **Linux** needs only a GPG key secret.

---

## 5. One-line installer patterns

- **The two accepted shapes** (rustup / deno / bun / volta prior art):
  - POSIX: **`curl -fsSL https://<host>/install.sh | sh`**
  - PowerShell: **`irm https://<host>/install.ps1 | iex`**
- **`deno_install/install.sh` (concrete prior art):** detects with **`uname -sm`** → a target triple
  (`"Darwin arm64"`→`aarch64-apple-darwin`, `"Linux aarch64"`→`aarch64-unknown-linux-gnu`, default
  `x86_64-unknown-linux-gnu`), builds
  `https://dl.deno.land/release/${ver}/deno-${target}.zip`, downloads with
  **`curl --fail --location --progress-bar -o "$exe.zip" "$uri"`**, unzips (`unzip`/`7z`), installs to
  **`${DENO_INSTALL:-$HOME/.deno}/bin/deno`** (per-user), and defers PATH edits to a shell-setup step.
  Notably deno's script does **no** checksum/signature verification. deno's install dir/env pattern
  (`DENO_INSTALL`, `$HOME/.deno/bin`) mirrors rustup (`~/.cargo/bin`) and volta/bun (`~/.bun/bin`).
  - *Constraint:* per-user install (`$HOME/.<tool>/bin` on PATH) is the norm — **no sudo**, avoids the
    Windows HSM/admin friction and macOS system-dir issues. Given this milestone's whole point is
    *signed* binaries, the installer **should add the verification deno omits**: fetch `SHA256SUMS`
    (+`.asc` on Linux), verify **before** placing on PATH (macOS relies on Gatekeeper/staple; Windows
    on Authenticode). The installer scripts are themselves distributed from a stable URL/GitHub Pages
    and pin a version. OS/arch detection: `uname -sm` (POSIX), `$env:PROCESSOR_ARCHITECTURE` +
    `[Environment]::Is64BitOperatingSystem` (PowerShell). The `aof` binary's "one binary two modes"
    means the installer places **one** file; `relay` is a runtime subcommand, not a second download.

---

## 6. Cross-OS build matrix in GitHub Actions

- **One workflow, three signed artifacts via a runner matrix:** `strategy.matrix.os:
  [ubuntu-latest, macos-latest, windows-latest]` (add arch legs: macOS `arm64`+`x64`→`lipo` universal;
  Windows/Linux `x64`+`arm64`). This is **required** for SEA (no cross-compile: each artifact is the
  runner's own `node` + blob, and node-pty's Linux `.node` must be built on a Linux runner);
  `@yao-pkg/pkg` *could* build all targets on one runner but **still needs a Linux runner (or a built
  Linux `.node`)** for node-pty and per-OS runners for the **signing** steps anyway (Windows
  `signtool`/AzureSignTool, macOS `codesign`+`notarytool`+`stapler`, Linux GPG). The 2026 SEA guides
  and the HireNodeJS write-up both use exactly this per-OS matrix.
  - *Constraint:* the matrix is effectively mandatory here — even a cross-compiling bundler can't
    escape per-OS **signing** runners and the Linux node-pty build. **Known caveat:** producing a SEA
    on a **Linux arm64 Docker container** yields an ELF whose hash table breaks `process.dlopen()` —
    build arm64 on a non-container/native arm64 runner (Node SEA docs).
- **Release-asset + checksum conventions:** upload per-OS/arch binaries (e.g.
  `aof-<os>-<arch>[.exe]`), a **`SHA256SUMS`** manifest covering all of them, `SHA256SUMS.asc` (GPG)
  for the Linux/packager path, and the two installer scripts. macOS/Windows artifacts are already
  signed+notarized/Authenticode-signed before upload; Linux relies on the signed `SHA256SUMS`.

---

## Decision inputs for the architect

**Recommended bundler.** Lead with **Node SEA + an esbuild pre-bundle to CJS**, targeting **Node 22
LTS** (SEA ships in-box, smallest binary, first-party, and the ESM→CJS esbuild step also collapses the
`import.meta.url` base-path sites into one place). Accept its two costs: (a) a **per-OS GitHub Actions
matrix** (unavoidable for signing + the Linux node-pty build anyway), and (b) **manual asset wiring** —
a build step must enumerate `src/bundle/**` (37 files) and `ui/dist/**` into the SEA `assets` map (or
ship them as a sidecar dir anchored at `import.meta.dirname`). **Fallback: `@yao-pkg/pkg`** if the
directory-asset + addon plumbing proves too heavy — it gives glob asset bundling and automatic addon
extraction, at the price of a third-party dep and a Node-22 regression (build on 20/24 or via `--sea`).
Either way, **ESM-native SEA (`mainFormat: module`) is off the table on Node 22** — it needs Node 25.7+.

**node-pty handling (ranked):** (1) **ship the prebuilt `.node` as a sidecar** next to the binary,
loaded via `createRequire`/filesystem `require` (mac+win prebuilts come in the package; **build the
Linux `.node` in CI** — none is shipped); keep the existing graceful-degrade so a missing/broken addon
only downgrades the terminal dock. (2) `@yao-pkg/pkg` with node-pty **manually** in `assets`
(auto-extracts to a cache). (3) embed as SEA asset + `getRawAsset`→tmp→`dlopen` (requires overriding
node-pty's own loader + extracting the Windows `winpty`/`conpty` companions — most invasive). (4) drop
the PTY feature from the shipped binary (product call). Note: a **raw SEA main cannot `import()`
node-pty from disk** — `terminal-ws.mjs:29`'s `await import("node-pty")` needs re-homing to
`createRequire` under SEA.

**Per-OS signing prerequisites checklist:**
- **Windows:** `signtool`/AzureSignTool + **OV or EV cert on HSM/USB/cloud** (CA/B June-2023 rule; no
  file `.pfx`), RFC-3161 timestamp. Secret: cloud-signing/Trusted-Signing creds. Expect SmartScreen
  reputation build-up (EV instant-trust removed 2024).
- **macOS:** **Developer ID Application** cert + hardened runtime (`codesign -o runtime --timestamp`)
  → **`notarytool submit --wait`** (App Store Connect API key) → **`stapler staple`**. Must run on a
  macOS runner; `postject`/inject **before** codesign. arm64 will not run unsigned.
- **Linux:** **`SHA256SUMS` + GPG `.asc`** (Node/HashiCorp shape). GPG key secret only; no hardware.

**Residual risks (in priority order):**
1. **Linux node-pty has no shipped prebuild** — must be compiled in CI (or a prebuilt-multiarch fork
   adopted); the single biggest packaging unknown to confirm at build time.
2. **Directory assets are not a SEA primitive** — `src/bundle/` (37 files) + `ui/dist/` must be
   flattened into `assets` or shipped as a sidecar; every `import.meta.url` base-path site
   (7 modules listed in §0) must be re-homed.
3. **ESM-entry version gate** — Node 22 LTS SEA is CJS-entry only (ESM needs 25.7+); commits the build
   to an esbuild pre-bundle or a newer Node.
4. **SEA `import()` restriction** breaks `terminal-ws.mjs`'s dynamic `import("node-pty")` — needs
   `createRequire`; and the **vite dev-server re-exec** (`cli.mjs:2098`) cannot run from a SEA (dev-only,
   not shipped — confirm it is never on the packaged path).
5. **arm64 SEA on Linux-arm64 Docker** corrupts the ELF for `dlopen` — build arm64 on native/non-container
   runners.
6. **Signing secrets/hardware** — Windows now mandates HSM/cloud signing; macOS mandates Developer ID +
   notarization; both are CI-doable but need provisioned secrets before the first signed release.

**Build-time confirmations to schedule (the architect's first ADR should assign these):** a real SEA
build of this ESM app (esbuild→CJS→blob→postject) on each OS runner actually running `aof --help`,
`aof mesh relay`, and a live PTY session with the sidecar `.node`; and a Linux node-pty compile in CI.
