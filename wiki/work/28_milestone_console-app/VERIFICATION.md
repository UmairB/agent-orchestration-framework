---
doc: verification
milestone: 28
updated: 2026-07-03
---
<!--
  Milestone VERIFICATION.md — the record of WHAT was checked and WHAT was found.
  Written by aof:verify 28. Pointers + evidence, never restatements. Sections with no
  content are omitted (absence is information). This is a PACKAGING milestone: the
  verification reality (ARCHITECTURE §verification-strategy) is @executable + fitness
  for the structural residue, @manual (agent-runnable) for the reference-OS build smoke,
  and @uat (human, cross-OS, signed) for KR4 — which is intrinsically a human sign-off.
  No UI surface (the milestone bundles ui/dist but adds no UI) → no design-conformance
  section. The @uat KR4 gate is routed to the cross-milestone mesh UAT session (below).
-->
# 28 · Cross-Platform Console App — Verification

Environment for the agent-run evidence below: node **v22.22.2**, esbuild + postject present,
node-pty win32-x64 prebuild present, gpg (GnuPG) 2.4.5, git, **win32/x64** (the reference OS).

## Automated + fitness evidence

- **m28's `@executable` suite + all 4 fitness/build units: green.** `node ./scripts/test.mjs`
  (re-run this verify session, `2026-07-03`) → **2221 ok / 0 not ok**. Every m28 behavioural group is
  green — `asset-base-seam/*`, `native-addon-sidecar/*`, `single-entry-two-mode/*`,
  `bundle-asset-manifest-complete/*`, plus story 01's `release-checksum-manifest` / `release-workflow-lint`
  / `release-fingerprint-pin` (real-gpg-keypair) / `release-sidecar-archive-roundtrip`, and story 02's
  52 installer tests (green from BOTH a Git Bash and a PowerShell parent).
- The **4 fitness/build units**, each green + non-vacuous (`verifies →` ARCHITECTURE.md Fitness functions):
  - **#1 `acd-sea-safe-asset-base`** (ADR-003) — no runtime `src/**.mjs` joins an asset path off a bare
    `import.meta.url`/`fileURLToPath` outside `src/asset-base.mjs`; the seven sites reference the seam.
    Behavioural siblings green incl. *"flipping the sentinel re-homes every consumer's read base in
    lock-step (one seam, seven sites)"*; self-check fires on a planted `path.join(fileURLToPath(...),"bundle")`.
  - **#2 `acd-single-entry-command-core`** (ADR-004) — the SEA main (`scripts/sea-entry.mjs`) is
    byte-equivalent in shape to `bin/aof.mjs`: `run(process.argv.slice(2))` only, **no `argv[0]==="relay"`
    fast-path**; m03 non-vacuous self-check fires on a planted relay fast-path.
  - **#3 `acd-native-addon-degrades`** (ADR-002) — the only node-pty reference lives inside
    `terminal-ws.mjs`'s `defaultSpawn` (`createRequire(process.execPath)` under SEA / dynamic import in
    dev); no top-level `import` of `node-pty`/`*.node`; a missing/unloadable sidecar degrades to the
    `{type:'error'}` frame, never a crash (incl. the raw-SEA-FS-`import()`-throws case).
  - **#4 `bundle-asset-manifest-complete`** (ADR-001/003) — set-equality over the real `src/bundle/**`
    (37 files) + `ui/dist/**` vs. the generated manifest, empty diff both directions; self-check: an
    un-manifested planted file fails the set-equality.
- **Gate:** `aof:validate 28` → **PASS — 28 is well-formed** (whole-stream `aof work validate` → 0 findings).

## Verification evidence

All agent-run on the reference OS (win32/x64). The built binary was executed **directly** (no `node` on
the command line) to prove the no-toolchain claim. Artifacts under the session scratchpad (git-ignored).

### `@manual` 28/00/01 — the SEA build smoke (KR4 minus signing) — PASS (all five halves)
`verifies →` `stories/00_story_self-contained-binary/tasks/01_sea-build-recipe.feature`
(the SPEC §Objective KR4-minus-signing bar; the observable halves of ADR-001/002/003/004).

**Procedure (agent-run).** `node scripts/build-sea.mjs --out <scratchpad>/dist-sea` — the real
esbuild→CJS→blob→postject recipe on this runner — then ran the produced `aof.exe` directly.

**Result — all five PASS:**
- *Single self-contained executable* — a real **88,045,056-byte `aof.exe`** + the `node-pty-sidecar/` +
  `node_modules/node-pty/` + `bundle/` (37) + `ui/dist/` sidecar tree. The build asserts node-pty is
  **externalized** from the esbuild `--metafile` (no `.node` inlined) — a build-time failure, not a
  runtime crash. (The Windows *"signature seems corrupted"* postject warning is expected — injection
  invalidates the copied `node.exe` Authenticode signature; story 01 re-signs.)
- *Node mode* — `aof --version` → **`0.1.0`** (the app version, read through the ADR-003 packaged base —
  the trimmed sidecar `package.json` — not a `src/` tree; proves the fuse took: it is the app entry, not a
  bare node REPL, which would print `v22.22.2`).
- *Relay mode, same binary* — `aof mesh relay --json` → the m23 non-blocking relay probe
  (`{nodeId:"umairs-msi", controlNode:null, …}`). **No second binary, no forked per-mode entry** (ADR-004).
- *Live PTY over the sidecar* — node-pty resolved from the sidecar via `createRequire(<exe>)("node-pty")`
  (the **exact ADR-002 SEA path**) and a real PTY session **spawned and streamed output** (echoed marker).
- *Missing-sidecar degrade* — with the entire `node-pty-sidecar/` + `node_modules/` moved aside, **both**
  node mode (`aof --version` → 0.1.0) and relay mode boot cleanly (exit 0). The addon is **not a startup
  dependency** (ADR-002's low-blast-radius degrade property, observed on the real binary).

### `@manual` 28/01/02 — the GPG-signed `SHA256SUMS` round-trip — PASS
`verifies →` `stories/01_story_signing-notarization/tasks/02_checksum-manifest.feature`
(the GPG round-trip @manual half — the format contract story 02's installer verifies against).

**Procedure (agent-run, real keypair).** Staged release assets under the pinned names
(`aof-windows-x64.exe`, `node-pty-win32-x64`) → `scripts/release/generate-sha256sums.mjs` →
`scripts/release/gpg-sign-manifest.mjs` (ephemeral ed25519 keypair, isolated `GNUPGHOME`).

**Result — PASS:** the manifest is the byte-exact `<sha256>␠␠<filename>` LF shape; `gpg --verify` on the
clean pair → **Good signature**; a one-hex-char tamper of the manifest → **BAD signature** (rejected); a
one-byte tamper of the asset → `sha256sum -c` → **FAILED** (the untampered sidecar still `OK`). Story 01's
real generator + signer scripts, exercised end-to-end. (Ephemeral keyring destroyed after the run.)

## User acceptance (@uat) — routed to the cross-milestone mesh UAT session

The milestone's headline **KR4** — *"a single **signed** command produces a working node on all three OSes
with no toolchain prerequisite, and the same binary runs in `relay` mode"* — has a `@uat` half that is a
**genuine human cross-OS sign-off** and **cannot be executed in this dev environment**. The three `@uat`
scenarios and their unmet prerequisites:

| `@uat` scenario | Requires (a documented pre-first-release prerequisite, not a defect) |
|---|---|
| `01/00_ci-build-matrix` | Real GitHub Actions runners (ubuntu/macos/windows + native arm64 legs) + a release run producing the per-OS/arch artifacts. |
| `01/01_per-os-signing` (OS-trust halves) | Provisioned CI signing secrets (Windows OV/EV cert on HSM/cloud; macOS Developer ID + App Store Connect notary key; Linux GPG release key) + real macOS/Windows to clear Gatekeeper/SmartScreen — and to confirm **unsigned arm64 macOS refuses to run**. |
| `02/02_place-on-path-and-run` | A **published signed release** at a hosted URL + real 3-OS machines to run the real `curl\|sh` / `irm\|iex` one-liner end-to-end (KR4). |

**Decision (`2026-07-03`): these `@uat` scenarios are DELEGATED to a cross-milestone mesh UAT session**
(`aof:add-uat` over the mesh cluster `depends: [22..28]`, then `aof:verify <session>`) — the aof UAT model,
in which a session brokers the `@uat`/`@manual` scenarios *across the milestones it accepts*. This is also a
**graph necessity**: `aof work next` treats a `depends:` edge as unmet unless the target is `done`
(`src/work.mjs`), so the session over `[22..28]` is unreachable until 28 is `done`. The milestone is therefore
marked `done` **on its agent-verifiable scope, with KR4 delegated to the session** — NOT because KR4 is
proven. **The signed cross-OS install has never actually run** (no signing secrets / CI runners / published
release exist). If the session's KR4 / OS-trust sign-off **fails**, stories 01/02 and milestone 28 **reopen**
(`in-review`). "Done" here = agent-scope complete + KR4 delegated, and the session's `SESSION.md` is the
record doc for the KR4 sign-off.

## Findings

No defects surfaced in either lane — the reference-OS build smoke and the GPG round-trip both passed on the
first attempt against the as-built scripts. Two **pre-existing, already-documented non-blockers** (recorded
here for the UAT session's awareness, not raised anew):

| id | observed | type | severity | triage (PO) | routed-to | status |
|----|----------|------|----------|-------------|-----------|--------|
| N1 | The release workflow emits **no `aof-windows-x64-arm64.exe` leg** — no hosted GitHub-Actions Windows-arm64 runner exists as of authoring; documented in `.github/workflows/release.yml` + STATE Feedback, not silently dropped. | platform-coverage gap | low | non-blocker | backlog / the mesh UAT session (confirm the win-arm64 story when a native runner exists). | deferred (pre-documented) |
| N2 | The `@uat` signed-install lane is un-runnable in this environment (signing secrets + CI runners + a published release absent) — a pre-first-release prerequisite, **not** a code defect. | environmental gate | n/a | non-blocker | the cross-milestone mesh UAT session (see §User acceptance). | routed |

## Accept decision

**ACCEPTED (agent-scope; KR4 `@uat` delegated to the mesh UAT session) — `2026-07-03` by `aof:verify 28`.**

- **Story 00 · self-contained-binary → `done`.** No `@uat` scenario; its entire lane is verified green — all
  4 fitness/build units + the reference-OS build smoke (a real `aof.exe` running node mode, relay mode, a
  live PTY over the sidecar, and a clean missing-sidecar degrade). Fully accepted on its own merits.
- **Story 01 · signing-notarization → `done` (agent-scope).** Its `@executable` heart (checksum manifest,
  workflow lint, fingerprint-pin) + the `@manual` GPG round-trip are green. Its cross-OS signing `@uat`
  (Gatekeeper/SmartScreen; unsigned-arm64-macOS-refuses) is **delegated to the mesh UAT session** — the
  `@uat` task boxes stay unticked (not yet green).
- **Story 02 · one-line-installer → `done` (agent-scope).** Its `@executable` OS/arch-detect + verify-before-
  PATH logic is green (52 tests, both parents). The real one-liner install `@uat` (KR4 end-to-end) needs a
  published signed release — **delegated to the mesh UAT session**.
- **Milestone 28 → `done` (agent-scope), pending the mesh UAT session's KR4 sign-off.** All three stories
  are `done` on agent-scope; the milestone is marked `done` to make the UAT session over `[22..28]` reachable
  (`aof work next` blocks a session on any non-`done` dep). `aof:validate 28` PASSES; nothing `depends:` on 28.
  **The retrospective + `work memory ingest` + STATE compaction/Feedback-archival are HELD until the UAT
  session signs off** (the true close) — running them now would produce a retro the KR4 findings could reopen.

**Reopen condition:** if the mesh UAT session's KR4 / OS-trust acceptance **fails**, stories 01/02 and
milestone 28 return to `in-review` and the failing scenario is triaged here as a blocker (→ `aof:continue 28`).

**Next:** `aof:add-uat` over the mesh cluster (`depends: [22,23,24,25,26,27,28]` — 27 is now `done`) →
`aof:verify <that session>` runs the integrated regression sweep (green) then brokers the KR4
signed-cross-OS-install acceptance. Its `SESSION.md` is the record doc for that sign-off.
