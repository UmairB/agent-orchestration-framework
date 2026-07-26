---
type: story
number: 02
slug: one-line-installer
title: "The one-line installer — install.sh (curl|sh) + install.ps1 (irm|iex): detect → download signed asset + sidecar → verify → place on PATH"
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
# 02 · The one-line installer — a single command, a working `aof`

## User story

As an end user with no Node.js and no toolchain, on any of the three OSes,
I want **one line** — `curl -fsSL https://<host>/install.sh | sh` (POSIX) or `irm https://<host>/install.ps1 |
iex` (PowerShell) — to detect my OS/arch, download the **matching signed binary plus its node-pty sidecar**,
**verify the checksum/signature before** placing anything on PATH, and install per-user to `$HOME/.aof/bin`
(no sudo),
so that "install anywhere, one tool" is literally true: a single signed command produces a **working `aof`**
(node mode) that also runs `aof mesh relay` (relay mode) — KR4 end-to-end — with the signature's trust actually
checked, not thrown away.

<!-- FILE-DISJOINT GREENFIELD (ARCHITECTURE §Story break-down rationale, point 3): install.sh + install.ps1,
     NOT in the src graph, zero edges into src/. Adds NO src/ code. Consumes Story 01's signed-artifact OUTPUT
     + the SHA256SUMS format (a SOFT CONTRACT, ADR-006) — so the installer's verify logic is unit-tested
     against a FIXTURE manifest in parallel with 01's real pipeline. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 28 --autonomous`, Contract stage). Each behaviour task is
     one `.feature` under tasks/; done when its feature is green. The OS/arch-detect + arg-parse + verify logic
     is @executable against fixtures; the real one-liner install is @uat (ARCHITECTURE §verification-strategy). -->

- [x] `tasks/00_os-arch-detect-and-download.feature` — `install.sh` (`uname -sm` → target triple, the
  `deno_install` shape) and `install.ps1` (`$env:PROCESSOR_ARCHITECTURE` + `Is64BitOperatingSystem`) resolve
  the running OS/arch to the **matching release asset name + its node-pty sidecar** and download both (the
  sidecar is a **co-download, not a second product** — "one binary, two modes" places ONE binary file; `relay`
  is a runtime subcommand — ADR-006). The detect→asset-name mapping is `@executable` over a case matrix.
- [x] `tasks/01_verify-before-path.feature` — the installer fetches `SHA256SUMS` (+ `SHA256SUMS.asc` on Linux),
  **verifies the downloaded asset's checksum (and the GPG signature on Linux) BEFORE placing anything on PATH**,
  and **refuses to install on a mismatch** (ADR-006 — verify-before-PATH is the point of a signed-binary
  milestone; macOS/Windows additionally lean on Gatekeeper-staple / Authenticode). The verify + refuse-on-
  mismatch logic is `@executable` against a **fixture `SHA256SUMS`** (the soft-contract format from Story 01).
- [x] `tasks/02_place-on-path-and-run.feature` — a verified install places the binary **and its co-located
  sidecar** per-user under `$HOME/.aof/bin` (no sudo), the binary + sidecar travel together (ADR-002), and a
  fresh shell runs `aof --version` (node mode) **and** `aof mesh relay` (relay mode); the README carries the
  one-liner. The end-to-end real one-liner install is `@uat` on the operator's OS.

**Accepted `done` `2026-07-03` (`aof:verify 28`) on agent-scope** — the `@executable` detect/verify-before-PATH
logic is green (52 tests, both parents). The **KR4 end-to-end `@uat`** in `02_place-on-path-and-run` (the real
`curl|sh` / `irm|iex` one-liner downloading a **published signed release** on each OS) is **DELEGATED to the
cross-milestone mesh UAT session** — it needs a signed release + real 3-OS machines this box cannot provide.
If that session's KR4 sign-off fails, this story reopens.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) — **ADR-006** (the greenfield `install.sh` +
`install.ps1` pair: detect → download signed asset + sidecar → **verify before PATH** → per-user `$HOME/.aof/bin`;
the `SHA256SUMS` verify is a **soft contract** on Story 01's manifest format), and **ADR-002** (the installer
co-downloads the node-pty sidecar alongside the binary). The prior art + mechanics are
[RESEARCH.md §5](../../RESEARCH.md) (rustup/deno/bun/volta; the concrete `deno_install/install.sh` `uname -sm` →
triple → per-user install pattern — and the verification deno omits that this installer **adds**).

This story **owns**: `install.sh`, `install.ps1`, and the README one-liner. All **greenfield scripts — zero
`src/` change** (`ARCHITECTURE §Story break-down rationale`). It does **not** touch `src/frameworks.mjs`'s npx
installer (the m09/ADR-004 recall lesson: the console installer is a NEW distribution artifact for a NEW
audience, never a mutation of the load-bearing in-repo installer).

**File-disjoint greenfield; consumes Story 01's artifact + a soft format contract.** The dependency edge is
`01 → 02` at the **artifact boundary**: 02 downloads + verifies the signed artifacts 01 produces. The
checksum/signature-verify is a **soft contract** on Story 01's `SHA256SUMS`(+`.asc`) filename/line shape — pinned
as a format seam so 02's `@executable` verify logic is written + unit-tested against a **fixture manifest** in
parallel with 01's real pipeline. No `src/` cross-story edge.

**Verification reality (ARCHITECTURE §verification-strategy):** `@executable` = the OS/arch-detect→asset-name
mapping (case matrix), the arg-parse, and the checksum-verify + refuse-on-mismatch logic (against a fixture
`SHA256SUMS`). `@uat` (human, on their OS) = the real `curl|sh` / `irm|iex` one-liner downloads, verifies, and
places a working `aof` — KR4 end-to-end, "a single signed command → a working node on all three OSes."

**Contract status (Three Amigos, `aof:refine 28 --autonomous`):** PO authored the three task features + tagged;
`aof-qa` hardened them (arch-alias + WOW64 detection rows + a 6-class unsupported-combo loud-fail matrix; the
8-outcome verify matrix incl. sidecar-mismatch, not-in-manifest, `.asc`-missing, and untrusted-key; re-install
idempotence + PATH-persistence); `aof-developer` verdict **FEASIBLE — no contract defects**. PO **accepted QA
finding F2** as a contract requirement (GPG key-fingerprint pinning, below).

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change). -->

- **F2 (accepted, security-relevant): pin the expected GPG public-key FINGERPRINT — not just `gpg`'s exit
  code.** A `gpg --verify` can succeed on the SIGNATURE while the SIGNER is an unknown/untrusted key, so
  "signed by SOME key" must not be mistaken for "signed by OUR key". The installer imports/pins the release
  key's fingerprint and REFUSES an otherwise-valid signature by an unpinned key (the QA row
  "untrusted / unpinned key → refuse" in `01_verify-before-path.feature`). Without this the signed-binary trust
  guarantee is defeatable — carry it to build as a hard requirement.
- **The verify+refuse logic is fully `@executable` against a FIXTURE `SHA256SUMS`** whose shape is
  byte-identical to Story 01's real manifest (`<sha256>␠␠<filename>`, LF) — or the parser passes fixtures and
  fails production. **The GPG step is Linux-only** (mac/Windows lean on Gatekeeper-staple / Authenticode), so a
  missing `gpg` on mac/win is not a false failure; **probe `sha256sum`/`gpg` availability and fail LOUDLY** if
  absent (never silently skip verification — verify-before-PATH is the milestone's point).
- **Windows detection + PATH:** read `Is64BitOperatingSystem` (or `PROCESSOR_ARCHITEW6432`), **not**
  `PROCESSOR_ARCHITECTURE` alone — a 32-bit host process on 64-bit Windows (WOW64) otherwise mis-detects as
  x86. PATH persistence via `setx` (persistent user PATH) vs a `$PROFILE` edit is the one real portability
  wrinkle — decide `setx`-vs-profile at `aof:continue` so the `@uat` "brand-new login shell finds aof" check
  targets the right fresh shell.
- **Pin the asset-name SOFT CONTRACT with Story 01** — the detection table (`aof-macos-arm64`, `aof-macos-x64`,
  `aof-linux-x64`, `aof-linux-arm64`, `aof-windows-x64.exe`, `aof-windows-arm64.exe` + `node-pty <os>-<arch>`
  sidecars) MUST match exactly the names Story 01's matrix emits; an unmapped combo fails loudly (never a wrong
  asset). Mirrored in Story 01's build notes.
- **PO pin (2026-07-03, resolving the story-01-flagged sidecar shape gap):** the sidecar asset is an **ARCHIVE**
  under the exact extensionless feature-pinned name (`node-pty-<darwin|linux|win32>-<arch>`; tar.gz content on
  darwin/linux, zip content on win32) that extracts to the layout `scripts/build-sea.mjs` emits beside the exe.
  The installer **unpacks it into the install dir after verify, before PATH** (checksum verifies the archive
  file itself); re-install replaces both the archive's extracted tree and any stale sidecar tree.
