---
type: story
number: 01
slug: signing-notarization
title: "Cross-OS signing & notarization — the per-OS CI matrix, the Linux node-pty compile, Authenticode / codesign+notarize+staple / GPG SHA256SUMS, and the checksum manifest"
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
# 01 · Cross-OS signing & notarization — a trusted artifact on every OS

## User story

As an end user who will download and run `aof` on Windows, macOS, or Linux (where an unsigned binary is blocked
by SmartScreen/Gatekeeper — and **arm64 macOS refuses to run unsigned code at all**),
I want Story 00's build recipe instantiated on a **per-OS CI runner matrix** that builds each artifact
(including the **Linux node-pty `.node` compiled from source**, since none is shipped) and **signs** it per OS —
Windows **Authenticode** (OV/EV cert on HSM/cloud), macOS **codesign + hardened runtime → notarytool → staple**,
Linux a **GPG-signed `SHA256SUMS`** — publishing signed artifacts + a checksum/signature manifest,
so that the binary an outsider downloads is **trusted by the OS** it lands on (KR4's "signed" half), and the
installer (Story 02) has a verifiable manifest to check against.

<!-- FILE-DISJOINT GREENFIELD (ARCHITECTURE §Story break-down rationale, point 3): CI YAML + signing scripts,
     NOT in the src graph, zero edges into src/. Adds NO src/ code. Consumes Story 00's build-recipe OUTPUT
     (a hard artifact edge — 01 cannot sign what 00 has not built). Signing is a property of the DISTRIBUTED
     artifact, applied by the trusted CI pipeline with CI-held keys — never runtime code (ADR-005). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 28 --autonomous`, Contract stage). Each behaviour task is
     one `.feature` under tasks/; done when its feature is green. Verification here is mostly @manual/@uat —
     signing clearance is a human/OS judgment, not a CI assert (ARCHITECTURE §verification-strategy). -->

- [ ] `tasks/00_ci-build-matrix.feature` — the per-OS GitHub Actions matrix (`ubuntu-latest`/`macos-latest`/
  `windows-latest` + the arch legs) instantiates Story 00's SEA recipe on each runner (SEA cannot cross-compile
  — ADR-001), **compiles the Linux node-pty `.node` from source** on the Linux runner (ADR-002 — no prebuild
  shipped), and emits a per-OS/arch artifact + its node-pty sidecar. **Constraint:** arm64 SEA must build on a
  **native/non-container** runner (a Linux-arm64 Docker container corrupts the ELF for `dlopen`, RESEARCH §6).
- [ ] `tasks/01_per-os-signing.feature` — each artifact is **signed on its own OS runner** (ADR-005): Windows
  `signtool`/AzureSignTool with an **OV/EV cert on HSM/cloud** (`/fd SHA256 /tr <rfc3161> /td SHA256`; no file
  `.pfx` — CA/B June-2023 rule); macOS `codesign --options runtime --timestamp` → `notarytool submit --wait` →
  `stapler staple`, with the **load-bearing ordering** that `postject` injection runs **before** `codesign`;
  Linux a **GPG detached signature** over the checksum manifest. Secrets are CI-held.
- [x] `tasks/02_checksum-manifest.feature` — the release emits a **`SHA256SUMS`** manifest covering every
  per-OS/arch artifact (+ sidecars) and a **`SHA256SUMS.asc`** GPG detached signature (the Node/HashiCorp
  shape) — the **format contract** Story 02's installer verifies against (filename + line shape + the `.asc`
  companion). The manifest's generation/line-format is `@executable`; the GPG round-trip verify is `@manual`.
  All `@executable` rows green (`scripts/release/generate-sha256sums.mjs` +
  `test/release-checksum-manifest.test.mjs`, 6 test objects covering the coverage set-equality, the LF/format
  pin, and the QA malformed-manifest rejection matrix); the GPG round-trip `@manual` ran on this box (real
  keypair, real `gpg --detach-sign`/`--verify`, `sha256sum -c`, and post-sign tamper-detection) — evidence in
  the developer report, not written to a milestone VERIFICATION.md (that is `aof:verify`'s to author).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) — **ADR-005** (per-OS signing is a CI-pipeline
concern, not runtime code: Windows Authenticode via cloud/HSM, macOS codesign+hardened-runtime+notarytool+
stapler with inject-before-sign, Linux GPG `SHA256SUMS`), **ADR-001** (the per-OS matrix the signing runs on —
SEA has no cross-compile), and **ADR-002** (the Linux node-pty CI compile — no prebuild is shipped). The
toolchain realities are [RESEARCH.md §4](../../RESEARCH.md) (the CA/B HSM rule; the three mandatory macOS steps;
arm64-macOS-won't-run-unsigned; the GPG convention) and §6 (the matrix + the arm64-Docker `dlopen` caveat).

This story **owns**: the GitHub Actions release workflow (the per-OS/arch matrix), the per-OS signing scripts,
the Linux node-pty source-compile step, and the checksum/GPG manifest generation. All **greenfield CI + script
files — zero `src/` change** (`ARCHITECTURE §Story break-down rationale`).

**File-disjoint greenfield; consumes Story 00's artifact, not its source.** The dependency edge is `00 → 01` at
the **artifact boundary**: 01 signs the unsigned binary 00's recipe builds. There is no `src/` cross-story edge
(01 adds no `src/` code). This lets 01's contract be authored **in parallel** with 00 and 02.

**Secrets provisioning is a pre-first-release prerequisite (not a refine blocker):** the Windows cloud-signing
creds, the macOS Developer ID cert + App Store Connect API key, and the Linux GPG private key must be
CI-provisioned before the first signed release. The `.feature` scenarios are authored against this; the actual
signed-clearance runs at `aof:verify` as `@uat`.

**Verification reality (ARCHITECTURE §verification-strategy):** `@executable` = the manifest format/generation
logic + any CI-config lint. `@manual` = a build agent runs the matrix build + the Linux node-pty compile + the
GPG `SHA256SUMS` round-trip verify. `@uat` (human, on their OS) = a **signed** artifact clears
Gatekeeper/SmartScreen, and **unsigned arm64 macOS won't run** — a cross-OS human sign-off that cannot be a CI
assert. This is KR4's "signed" half.

**Contract status (Three Amigos, `aof:refine 28 --autonomous`):** PO authored the three task features + tagged;
`aof-qa` hardened them (split each combined signing scenario into a `@manual` signature-present half + a `@uat`
OS-trust half — fixing a one-concern-per-scenario violation; retagged the Linux node-pty-compile scenario
`@uat`→`@manual`; added the malformed-`SHA256SUMS` rejection matrix + the LF-line-ending pin + sidecar
coverage); `aof-developer` verdict **FEASIBLE — no contract defects**.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change). -->

- **Only `02_checksum-manifest` is `@executable`; the rest are honestly `@uat`/`@manual`** (signature-present
  halves are agent-runnable via `signtool verify` / `codesign --verify` / `gpg --verify`; OS-trust is human).
- **Pin the asset-name SOFT CONTRACT with Story 02 (do NOT let it drift).** The matrix MUST emit exactly these
  release-asset names + `node-pty <os>-<arch>` sidecars, byte-matching Story 02's detection table
  (`00_os-arch-detect-and-download.feature`): `aof-macos-arm64`, `aof-macos-x64`, `aof-linux-x64`,
  `aof-linux-arm64`, `aof-windows-x64.exe`, `aof-windows-arm64.exe`. Story 01 emits them; Story 02 detects
  them — pin identically in both STORY.md so the two greenfield stories cannot diverge when built in parallel.
- **`SHA256SUMS` line format is the assertable seam** — `<sha256>␠␠<filename>`, lowercase 64-hex, two spaces,
  relative filenames, **LF line endings** (a Windows-runner CRLF would shift both the `sha256sum -c` parse and
  the hash-over-manifest the `.asc` signs — the m01/R2 EOL-pin lesson). Keep it byte-exact; it is what Story
  02's installer parses.
- **arm64 legs run on NATIVE (non-container) runners** — GitHub Actions offers `ubuntu-24.04-arm` + arm64
  `macos-14/15`; a Linux-arm64 **Docker** container corrupts the ELF so `process.dlopen` (node-pty) breaks
  (RESEARCH §6). **Match the Linux node-pty build toolchain (glibc/node-gyp) to the target distros** — the
  `.node` must `dlopen` on an older-glibc user machine, not just on the builder (QA flag,
  `00_ci-build-matrix.feature`).
- **Signing secrets are a pre-first-release prerequisite (not a refine blocker):** Windows cloud/HSM creds,
  macOS Developer ID cert + App Store Connect API key, Linux GPG private key — CI-provisioned before the first
  signed release; the `@uat` clearance runs at `aof:verify`.
- **PO pin (2026-07-03, resolving the flagged sidecar shape gap):** the staged sidecar asset is an **ARCHIVE
  under the exact extensionless feature-pinned name** from story 02's detect matrix
  (`node-pty-darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64|win32-arm64`; tar.gz content on
  darwin/linux legs, zip content on win32 legs) whose root entries reproduce EXACTLY the layout
  `scripts/build-sea.mjs` emits beside the exe. Story 02's installers unpack it post-verify. The stage script
  emits those byte-exact names; an archive→extract round-trip set-equality test pins the internal layout.

## Build status (developer, `aof:continue`)

**Accepted `done` `2026-07-03` (`aof:verify 28`) on agent-scope — the `@uat` half is DELEGATED to the
cross-milestone mesh UAT session** (the aof UAT model: a session brokers the `@uat`/`@manual` scenarios
across the milestones it accepts). `tasks/00_ci-build-matrix.feature` and `tasks/01_per-os-signing.feature`
are feature-default `@uat` (the full cross-OS matrix run + OS-trust clearance need real runners/downloads
this dev box cannot host) — **their checkboxes stay unticked deliberately: the `@uat` features are not yet
green; the UAT session validates them.** If that session's KR4/OS-trust sign-off fails, this story reopens. The buildable artifacts exist and are covered by
CI-config lint (`test/release-workflow-lint.test.mjs`, 16 assertions) asserting the declared legs, the
native-arm64 runners, no cross-compile directive, the Linux node-pty source-compile + stage step, the
LOAD-BEARING inject-before-codesign ordering, the per-OS signing tool invocations, and secret-name-only
references: `.github/workflows/release.yml` (the matrix), `scripts/release/sign-windows.mjs`,
`scripts/release/sign-macos.mjs`, `scripts/release/gpg-sign-manifest.mjs`, `scripts/release/stage-release-assets.mjs`,
`scripts/release/stage-linux-node-pty-prebuild.mjs`. **Flag (not silently resolved):** the workflow currently
emits no `aof-windows-arm64.exe` leg — no hosted GitHub-Actions Windows-arm64 runner exists as of authoring;
documented in the workflow file itself and in the developer report/STATE.md Feedback, not silently dropped.
**RESOLVED (PO pin, 2026-07-03, see the "PO pin" bullet above + STATE.md "Notes & decisions in flight"):** the
sidecar shape gap this developer report originally flagged is now the contract — `stage-release-assets.mjs`'s
`packSidecarArchive()` emits the sidecar as an ARCHIVE under the exact extensionless name
(`node-pty-<node-pty-platform>-<arch>`, node-pty's OWN platform tokens: `darwin`/`linux`/`win32` — no
`.tar.gz`/`.zip` suffix), gzip'd tar content on darwin/linux legs, zip content on win32 legs, with root entries
reproducing `build-sea.mjs`'s beside-the-exe layout (`node-pty-sidecar/**` + `node_modules/node-pty/**`) exactly.
Verified with a real archive→extract round-trip (`test/release-sidecar-archive-roundtrip.test.mjs`, set-equality
both directions, both archive formats) — see the developer report for full evidence.

**New build-time finding surfaced while implementing the pin (flag for Story 02's developer, who is concurrently
adding the unpack step):** PowerShell's `Expand-Archive` determines the archive FORMAT from the source path's
FILE EXTENSION, not its content — it refuses an extensionless path ("is not a supported archive file format").
Since the pinned sidecar name is deliberately extensionless, `install.ps1`'s unpack step cannot call
`Expand-Archive` directly on the downloaded/verified file; it needs either (a) a copy-to-a-`.zip`-suffixed-temp-
path-then-`Expand-Archive` two-step (what this story's round-trip test does), or (b) `[System.IO.Compression.ZipFile]`
directly (no extension requirement). `Compress-Archive` (used to BUILD the zip) has the SAME behavior in
reverse — it silently appends `.zip` to an extensionless `-DestinationPath`, so `stage-release-assets.mjs`
builds to an explicit `.zip`-suffixed temp path and renames to the pinned extensionless name afterward. Neither
finding required a `.feature` change (both are implementation mechanics beneath the pinned contract).

**Craft-review fixes (2026-07-03), none `.feature`-affecting — reported per finding number:**
- **F3 (HIGH, RESOLVED):** nothing previously tied `install.sh`'s pinned GPG fingerprint to the actual key the
  release workflow signs with — a one-byte drift meant every Linux install would refuse forever. Added
  `scripts/release/assert-fingerprint-pin.mjs`, wired as a `checksum-and-sign-manifest` step AFTER the CI signing
  key import and BEFORE the manifest is GPG-signed/published — fails the whole release on mismatch. Reads
  `install.sh`'s ACTUAL runtime trust gate (confirmed from source: `aof_verify_gpg_signature` compares the
  GPG-verified signer against the `AOF_RELEASE_GPG_FINGERPRINT` variable, not "whichever key is embedded") and,
  if an embedded PGP public key block is ALSO present (story 02's craft-F1 shape), additionally cross-checks the
  embedded key's own fingerprint agrees with that variable — a self-inconsistent `install.sh` is reported as a
  distinct failure from a CI-key mismatch. Verified with 4 real-gpg-keypair tests
  (`test/release-fingerprint-pin.test.mjs`, no stubs) covering match / self-inconsistent / CI-key-mismatch / the
  real checked-in file's current self-consistency.
- **F9 (MINOR, RESOLVED):** `generate-sha256sums.mjs`'s `splitLines` comment claimed CR was "stripped
  defensively" but never stripped it — a CRLF-mangled manifest would report a misleading `malformed-hash`/wrong-
  filename instead of an honest classification. Fixed the parser to actually strip a trailing `\r` per line
  (reading only — the WRITER stays LF-pure, unchanged). New test proves both the fix (a CRLF-mangled but
  otherwise well-formed manifest now validates cleanly) and the non-vacuous converse (a genuinely malformed hash
  is still rejected even inside a CRLF-mangled manifest).
- **F13(a) (MINOR, RESOLVED):** the `workflow_dispatch` `version` input was declared `required: true` but never
  consumed. Wired into every `actions/checkout@v4` step's `ref:` (`github.event.inputs.version || github.ref`,
  falling through to the natural pushed-tag ref on the `push:tags` trigger).
- **F13(b) (MINOR, RESOLVED):** the macOS notary key secret was interpolated directly into shell script SOURCE
  (`echo "${{ secrets.AOF_MACOS_NOTARY_KEY_P8 }}" > ...`). Changed to `env:` + `printf '%s' "$VAR" > file`. The
  `runner.temp` key-path fix (a prior architect NIT) was NOT reverted.
- **F13(c) (MINOR, RESOLVED — documented, not changed):** `sign-windows.mjs`'s `-kvs` (Key Vault client secret)
  argument is visible in the OS process list for its lifetime — acceptable on GitHub-hosted runners (single-job,
  ephemeral VMs, no other tenant can observe the process table) but a real trade-off, not an oversight. Added an
  explicit "DELIBERATE CHOICE" comment naming the ephemeral-runner reasoning, so a future move to a
  shared/self-hosted runner is a flagged decision, not a silent regression.

All lint tests updated (`test/release-workflow-lint.test.mjs`, 5 new assertions: 16–20) to assert the changed
workflow lines. Full suite green after the fix (`node scripts/test.mjs`).

**Final-verification finding (2026-07-03), RESOLVED — Windows tool-resolution class, same family as `test/installer-shell.mjs`'s WSL-launcher fix:**
- **`packSidecarArchive` (`scripts/release/stage-release-assets.mjs`):** which `tar` binary a bare `tar`
  invocation resolves to on Windows is PARENT-SHELL-DEPENDENT — a Git Bash parent typically resolves Git's own
  GNU tar (needs POSIX `/c/...` paths); a PowerShell/cmd parent can instead resolve
  `C:\Windows\System32\tar.exe` (bsdtar/libarchive, needs NATIVE `C:\...` paths — confirmed `bsdtar` cannot
  reliably be assumed to tolerate the POSIX form). Fixed by detecting the tar flavor AT RUNTIME
  (`tar --version` → "GNU tar" vs "bsdtar", detected once and cached) and shaping the `-C`/destination paths
  only for the flavor actually resolved on THIS invocation — real POSIX CI runners (macOS/Linux) always detect
  "posix" and the conversion stays a no-op there, unchanged. No import from `test/` into the production script.
- **`scripts/release/assert-fingerprint-pin.mjs` + `scripts/release/gpg-sign-manifest.mjs`:** bare `gpg` can fail
  to resolve at all under a PowerShell parent (`spawnSync gpg ENOENT`). Both scripts now honor an `AOF_GPG_BIN`
  env override (default `"gpg"` — CI behaviour unchanged); `test/release-fingerprint-pin.test.mjs` resolves gpg
  via the shared `test/installer-shell.mjs`'s WSL-launcher-safe `resolveGpg()` and passes it through
  `AOF_GPG_BIN` when spawning the real script as a child process.

**Evidence:** ran the release + installer + roundtrip test arrays from BOTH a genuine `powershell.exe` parent
and Git Bash (a `node -e`/driver-script precedent, mirroring the existing test harness style) — all green on
both; then the full `node scripts/test.mjs` from both parents — exit 0, zero `not ok` lines, all 35 story-01
tests present and green on both, all 52 installer tests green under PowerShell too. The previously-failing
`release-sidecar-archive-roundtrip/01`+`/02` (tar) and all 4 `release-fingerprint-pin/*` (gpg) tests confirmed
passing by name under the PowerShell parent.
