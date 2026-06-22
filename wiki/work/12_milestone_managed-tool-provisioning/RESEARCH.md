<!-- aof-generated: bundle -->

---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Report facts; the architect decides what to do about them (→ ARCHITECTURE.md).
-->
# 12 · Managed Tool Provisioning — Research

**Gathered:** 2026-06-21
**Method:** Live probes of the installed `uv` 0.9.26 / Python 3.12.5 on this Windows 11 host (`uv tool`,
`uv venv`, `uv pip install`, env-var relocation, a real version-keyed install of `graphifyy==0.8.44` run
end-to-end); headroom README + PyPI metadata (`pypi.org/pypi/headroom-ai/json`); existing aof resolver
source (`src/graphify.mjs`, `src/frameworks.mjs`, `src/paths.mjs`).
**Status:** Desk + live research complete on this host. Cross-platform (POSIX `bin/`, `.exe` suffix) and
headroom-on-Windows confirmed only by docs/metadata here → flagged as `@manual` live-only assumptions.

## Store layout: `uv tool install` is package-keyed, NOT version-keyed (load-bearing)

- **Finding:** `uv tool install <pkg>` builds a venv at `<UV_TOOL_DIR>/<PACKAGE_NAME>/` and drops bin
  shims in `<UV_TOOL_BIN_DIR>/`. Both roots ARE relocatable by env var — confirmed live: with
  `UV_TOOL_DIR` + `UV_TOOL_BIN_DIR` set, the install landed under those dirs and `uv tool dir` /
  `uv tool dir --bin` echoed them. BUT the env dir is keyed on the **package name** (`.../graphifyy/`),
  not the version — there is **no `--tool-dir`/`--install-dir`/version segment**; the install help exposes
  no per-install path flag. So two versions of the same package collide; `uv tool install` cannot itself
  realize `~/.aof/tools/<name>/<version>/`. Binary lands at `<UV_TOOL_DIR>/<pkg>/Scripts/<exe>.exe`
  (Windows) — version is NOT in the path, only in `uv-receipt.toml` / `uv tool list`.
- **Constraint:** The version-keyed store `~/.aof/tools/<name>/<version>/` CANNOT be built with
  `uv tool install` without aof inventing its own per-version `UV_TOOL_DIR` (one tool-root per version,
  fighting uv's package-keyed model) — and even then path discovery of the exe still goes through
  uv-managed shims. → The store layout drives toward the `uv venv` approach below, not `uv tool install`.
- **Source:** live `uv tool install graphifyy==0.8.44` with `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR` set, this host
  2026-06-21; `uv tool install --help` (no path/version flag); current install at
  `C:\Users\Umair\AppData\Roaming\uv\tools\graphifyy\` (no version segment), `uv-receipt.toml`.

## Store layout: `uv venv` + `uv pip install --python <dir>` gives a deterministic, version-keyed path (recommended)

- **Finding:** `uv venv ~/.aof/tools/<name>/<version>` then
  `uv pip install --python ~/.aof/tools/<name>/<version> "<pkg>==<version>"` produces a venv at a path
  **aof fully controls and names** — no uv-internal hashes. Run live end-to-end into
  `<tmp>/graphify/0.8.44`: the binary appeared at `<dir>/Scripts/graphify.exe` and
  `<dir>/Scripts/graphify.exe --version` printed `graphify 0.8.44`. The exe directory is `Scripts/` on
  Windows; on POSIX uv venvs it is `bin/` (uv follows the standard venv layout). `--python <dir>` accepts
  the venv directory directly (its env hint is `UV_PYTHON`).
- **Constraint:** This is the only approach that yields a deterministic, relocatable, version-keyed store
  path aof can resolve later with zero guessing. → The `uv` provider lane should provision via
  `uv venv` + `uv pip install --python <store-dir> <pkg>==<ver>`, and the resolution contract for any
  uv-lane tool is `<store>/<name>/<version>/{Scripts on win32 | bin on POSIX}/<binary>[.exe]`.
- **Source:** live `uv venv` + `uv pip install --python … graphifyy==0.8.44`, this host 2026-06-21
  (binary at `…/0.8.44/Scripts/graphify.exe`, `--version` → `graphify 0.8.44`); `uv venv --help`,
  `uv pip install --help` (`--python <PYTHON>`).

## Version pin, lockfile, prerequisite

- **Finding:** Versions pin with `==` on the install spec (`graphifyy==0.8.44`, confirmed live). A lockfile
  path exists: `uv pip compile <requirements.in>` emits `requirements.txt` **or `pylock.toml`**; the
  installer supports `--require-hashes`. `uv` itself is the hard prerequisite for the lane (it provides
  both `uv venv` and `uv pip`). Pip + pipx fallbacks DO exist on this host (`pip`, `pipx` both on PATH,
  Python 3.12.5) — pipx could install the same PyPI tools — but they would not give the same
  uv-controlled venv path, and the milestone names `uv` as the lane.
- **Constraint:** The `uv` lane must treat `uv` (and a discoverable Python — uv can download one) as a
  doctor-checked prerequisite; pin format is `<spec>==<version>`. A reproducibility upgrade (hash-locked
  `pylock.toml` per tool) is AVAILABLE but optional — architect's call whether the store needs it.
- **Source:** live install with `==`; `uv pip compile --help` (emits `pylock.toml`); `which pip`/`which
  pipx` present, `python --version` → 3.12.5, this host 2026-06-21.

## Cross-platform binary resolution rule

- **Finding:** For a uv-lane tool in the store, the exe is at
  `<store>/<name>/<version>/Scripts/<binary>.exe` on Windows and `<store>/<name>/<version>/bin/<binary>`
  on POSIX. aof's existing resolver (`src/graphify.mjs`) already encodes the cross-platform exe-name set
  (`.exe`/`.cmd`/`.bat`/bare on win32, bare on POSIX) and a degrade-to-null `--version` probe — but it
  resolves off **PATH only** (`where`/`which` + PATH scan), with no store-first lookup. graphify exposes
  TWO binaries from one package: `graphify` and `graphify-mcp` (both present in the live install's
  `Scripts/`). Version is verified by spawning `<bin> --version` (confirmed: `graphify --version` →
  `graphify 0.8.44`).
- **Constraint:** The store-first resolver must (1) build the platform-specific exe dir (`Scripts` vs
  `bin`) and exe name (`.exe` on win32), (2) check the store path BEFORE the PATH walk that
  `resolveGraphifyBinary` does today, (3) verify with `<bin> --version`. A package→binary map is needed
  (one package can ship several binaries; install spec `graphifyy` ≠ binary `graphify`).
- **Source:** `src/graphify.mjs:31-37,64-122,138-149`; live `Scripts/` listing (`graphify.exe`,
  `graphify-mcp.exe`); `uv tool list` (`graphifyy v0.8.44` → `graphify`, `graphify-mcp`).

## Headroom installs as a PyPI package — same uv lane, no new install provider, BUT a platform constraint

- **Finding:** headroom (github.com/chopratejas/headroom) installs as the PyPI package **`headroom-ai`**
  (current `0.26.0`, `requires_python >=3.10`); README install is `pip install "headroom-ai[all]"`
  (granular extras incl. `[all]`, `[mcp]`, `[ml]`, `[proxy]`, `[code]`, …). Console binary on PATH is
  **`headroom`**. pipx is offered (`pipx install --python python3.13 "headroom-ai[all]"`) — i.e. it is a
  plain Python console-script package, so `uv venv` + `uv pip install "headroom-ai[all]==0.26.0"` fits the
  SAME uv lane as graphify. No cargo/curl/binary-download install step is required for the common case.
  HOWEVER PyPI ships prebuilt wheels ONLY for **macosx_11_0_arm64**, **manylinux_2_28_x86_64**, and
  **manylinux_2_28_aarch64** (all `cp310-abi3`) plus an sdist `.tar.gz` — there is **NO Windows wheel**.
  On Windows, install falls back to the sdist and needs a **Rust toolchain** to build (README also notes
  Rust is needed in SSL-inspection corporate envs). Runtime, not install: ONNX Runtime is fetched from
  `cdn.pyke.io` and a `kompress-base` model from `huggingface.co` at first run (network egress + disk).
- **Constraint:** The provider registry does NOT need a lane beyond uv+npx to *install* headroom — it is a
  uv-lane PyPI tool (`headroom-ai` → binary `headroom`), so the install seam generalizes cleanly. The
  load-bearing scope inputs are instead: (a) the install spec must carry **extras** (`headroom-ai[all]`)
  and a **package≠binary** mapping (`headroom-ai` → `headroom`), so the uv lane's spec model needs an
  extras field; (b) headroom is **not installable on Windows from a prebuilt wheel** → the store/doctor
  needs a per-tool **platform-support matrix** (Rust prereq + sdist build on win32, or "unsupported on
  this platform"); (c) doctor should be aware of headroom's runtime network/model fetch (a present binary
  is not a working tool offline).
- **Source:** README (github.com/chopratejas/headroom) fetched 2026-06-21; PyPI metadata
  `pypi.org/pypi/headroom-ai/json` — `version 0.26.0`, `requires_python ">=3.10"`, wheels listed above,
  `provides_extra` includes `all`.

## Existing seam this milestone generalizes

- **Finding:** Today's installer is npx-only and hardcoded: `planFrameworkInstall` builds
  `["npx", packageName, runtimeFlag, scopeFlag]` and `executeFrameworkInstallPlan` spawns it with a
  fixed `SAFE_NPM_EXEC_ENV` (`npm_config_*`); there is lock/attempt machinery (skip-if-already-succeeded,
  `--force`) keyed on framework/runtime/scope/source. The store root already exists:
  `defaultGlobalWorkspaceDir` → `~/.aof` (or `AOF_GLOBAL_HOME`), `src/paths.mjs:18-21`.
- **Constraint:** A `uv` lane must be a PEER to this npx lane behind one seam, preserving npx's
  lock/attempt/skip semantics (npx env is npm-specific and does NOT transfer to uv — each lane owns its
  exec env). The store lives under `defaultGlobalWorkspaceDir` + `tools/<name>/<version>/`.
- **Source:** `src/frameworks.mjs:48-116`, `src/paths.mjs:18-21`.

## Assumptions to confirm

- **A1 — POSIX uv venvs put the exe at `<store>/<name>/<version>/bin/<binary>` (no `.exe`).** Confirmed on
  Windows here (`Scripts/…​.exe`); the `bin/` shape on macOS/Linux is uv's documented standard-venv layout
  but was NOT run on a POSIX host. Confirm by running `uv venv` + `uv pip install --python` on macOS/Linux
  and listing `<dir>/bin`. Testable in CI: **yes** (a Linux CI job can assert the `bin/<binary>` path
  exists and is executable). `@executable`.
- **A2 — `headroom-ai[all]` installs into a `uv venv` and exposes a `headroom` binary at
  `<dir>/{bin|Scripts}/headroom[.exe]`.** Inferred from README + PyPI (plain console-script package);
  NOT run live (the `[all]` extra pulls a heavy ML/ONNX/torch stack). Confirm by
  `uv venv X && uv pip install --python X "headroom-ai[all]==<ver>"` then `X/.../headroom --version`.
  Testable in CI: **partially** — install + `--version` runnable on Linux CI (x86_64 wheel exists) but
  heavy; gate behind an opt-in job. Developer-run `@manual` for the routine path.
- **A3 — headroom on Windows requires building the sdist (Rust toolchain); no prebuilt wheel.** From PyPI
  wheel list (no win tag) + README Rust note; NOT attempted live. Confirm by attempting
  `uv pip install "headroom-ai==0.26.0"` on Windows with/without Rust. Testable in CI: **no** (needs a
  Windows host + Rust; destructive/heavy). Live-only `@manual`.
- **A4 — `graphify --version` and `headroom --version` are the reliable version-verify probes.**
  `graphify --version` → `graphify 0.8.44` confirmed live; `headroom --version` assumed by convention,
  NOT run. graphify's resolver already degrades to `version: null` on a missing/odd flag, so the store
  resolver should keep that no-throw contract. Testable in CI: **no** for headroom (needs the live
  binary); the no-throw degrade path IS unit-testable. `@manual` for the live headroom probe.
- **A5 — `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR` relocation (if the architect still wants the `uv tool` route)
  does not version-segment the path.** Confirmed live here (landed at `<UV_TOOL_DIR>/graphifyy/`, no
  version dir). Testable in CI: **yes** (assert the resulting path has no version segment). `@executable`.
  This is the evidence behind preferring the `uv venv` route for the store.
