---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 28 · Cross-Platform Console App — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (Phase 4 — install anywhere).
- Refined `2026-07-03` by `aof:refine 28 --autonomous` (Decide + Break-down + all contracts). Researcher →
  [RESEARCH.md](RESEARCH.md) (SEA/pkg realities, node-pty, signing, installer); architect →
  [ARCHITECTURE.md](ARCHITECTURE.md) (6 ADRs + 4 fitness/build units, graph-grounded partition). Broken into
  **three stories** forming a linear artifact pipeline **00 → 01 → 02**:
  - **00 · self-contained-binary** `not-started` — the code-coupled root (SEA recipe + `src/asset-base.mjs`
    seam + node-pty sidecar + single-entry two-mode). The **only** story touching `src/`.
  - **01 · signing-notarization** `not-started` — greenfield CI matrix + per-OS signing + Linux node-pty
    compile + checksum manifest.
  - **02 · one-line-installer** `not-started` — greenfield `install.sh`/`install.ps1` + README one-liner.
  Contracts authored (Three Amigos). Source of truth for each story's status is its own STORY.md frontmatter.
- Build started `2026-07-03` by `aof:continue 28`. Fan-out: **wave 1 = stories 00 ∥ 02 in parallel** (02's
  soft contracts — the asset-name table + the `SHA256SUMS` line shape — are pinned in both STORY.md files, so
  it needs no upstream artifact; the only shared file is the additive `scripts/test.mjs` registration);
  **wave 2 = story 01** (its CI matrix must invoke story 00's actual build scripts — the hard recipe edge).
- Built + reviewed `2026-07-03` by `aof:continue 28`. All three stories built to green and set `in-review`:
  - **00 · self-contained-binary** — 4 tasks + 4 fitness units green; a REAL unsigned `aof.exe` built on the
    reference OS (win32/x64) and verified: `--version`, `mesh relay --json`, a live PTY over the sidecar, and
    clean degrade with the sidecar removed (KR4 minus signing, agent-run evidence in the build report).
  - **01 · signing-notarization** — the `@executable` heart green (checksum manifest + CI lint + archive
    round-trip + fingerprint-pin gate, 35+ tests); the real GPG round-trip ran on this box (sign → verify →
    tamper-detect). Matrix/signing scenarios remain honestly `@manual`/`@uat` (no runners/secrets here);
    windows-arm64 leg is a documented gap (no hosted runner).
  - **02 · one-line-installer** — 52 installer tests green from BOTH a Git Bash and a PowerShell parent
    (explicit Git-Bash/gpg resolution, WSL launchers rejected); sidecar-archive extraction, staged
    no-half-install ordering, GPG key import + fingerprint pin, sha256sum/shasum fallback all exercised for real.
  **Reviews:** architect **APPROVE** (3 NITs, 2 applied at build); QA **APPROVE** (full trace table — every
  `@executable` row maps to a discriminating assertion; skip-honesty proven under a PowerShell parent; 3 NITs,
  the `malformed-line`→`malformed-hash` feature-label drift amended by the PO); craft pass **14 findings — 2
  production blockers (Linux empty-keyring GPG verify; macOS missing `sha256sum`) + 12 others, ALL fixed and
  test-covered at build**. A cross-story race during the parallel build (installer built against a stale zip
  shape) was caught and closed by making installer test fixtures import story 01's REAL `packSidecarArchive`.
  Full suite green at close (2,220+ tests, 0 failures — verified independently from BOTH a Git Bash and a
  PowerShell parent shell; a final PowerShell-parent sweep caught and closed a tar/gpg tool-resolution class
  in the release scripts that Git-Bash-only runs masked). Next gate: `aof:verify 28`.
- Verified + **partially accepted** `2026-07-03` by `aof:verify 28` → [VERIFICATION.md](VERIFICATION.md). The
  `@executable` suite + all 4 fitness/build units green (**2221 ok / 0 not ok**); `aof:validate 28` **PASS**.
  Agent-run `@manual` on the reference OS (win32/x64), both **PASS**: (a) the **SEA build smoke** — a real
  **88 MB `aof.exe`** built via `scripts/build-sea.mjs`, run **directly** (no `node`): node mode
  (`aof --version`→`0.1.0`), relay mode (`aof mesh relay --json`, same binary), a **live PTY** over the sidecar
  via `createRequire(exe)`, and a clean **missing-sidecar degrade** (both modes still boot); (b) the **GPG
  `SHA256SUMS` round-trip** (real keypair — Good signature / tamper→BAD / `sha256sum -c`→FAILED). No defects.
  **All three stories + the milestone marked `done` on agent-scope**; the KR4 signed-cross-OS-install `@uat`
  (un-runnable here: no signing secrets / CI runners / published release) is **DELEGATED to a cross-milestone
  mesh UAT session** (`aof:add-uat` over `depends: [22..28]` → `aof:verify <session>`; its `SESSION.md` is the
  record doc for KR4). Marking `done` is also a **graph necessity** — `aof work next` blocks a session on any
  non-`done` dep (`src/work.mjs`). "Done" = agent-scope + KR4 delegated, **not** KR4 proven: if the session's
  KR4 sign-off fails, 01/02 + the milestone **reopen**. Retrospective + `work memory ingest` + this section's
  compaction/archival are **HELD until the UAT session signs off** (the true close), not run at this hand-off.

## Notes & decisions in flight

- **Cross-milestone change made during 28/verify (not an m28 deliverable):** the mesh partition root was
  relocated from `wiki/work/.mesh/` to **`.aof/mesh/`** at the user's direction — mesh is aof config/runtime
  state (extensible to planning, not only `work`), and the original "not a `.aof/` sidecar" rejection rested
  on a false premise (`.aof/` is not wholesale git-ignored). One-seam change (`meshDir`→`aofHome`), but it
  moved 4 fitness ACs + `.gitattributes`/`.gitignore` + ~15 behavioural tests + on-disk data. Recorded as
  [22/ADR-005](../22_milestone_mesh-foundation/ARCHITECTURE.md) + [22/R7](../22_milestone_mesh-foundation/RETROSPECTIVE.md).

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- Mechanically **independent** of the mesh internals — it bundles whatever the build contains. Its one
  hard edge is the `relay` mode (milestone 23) the "one binary, two modes" deliverable must package; PRD
  §8 still sequences it last so the *shipped* binary carries the full mesh. Parallel-eligible once 23 lands.
- ~~Open for refine: SEA vs `pkg` bundling; the per-OS signing / notarization path; the one-line installer;
  and how `node` / `relay` modes are selected from the single binary.~~ **All four resolved at refine**
  (2026-07-03): **Node SEA + esbuild→CJS pre-bundle** on a per-OS CI matrix, `@yao-pkg/pkg` the documented
  fallback (ADR-001); **Windows Authenticode (HSM/cloud) / macOS codesign+notarize+staple / Linux GPG
  `SHA256SUMS`** (ADR-005); **`install.sh` + `install.ps1`** detect→download→verify→PATH (ADR-006); modes are
  **two argv routes through the one `run()`** — `relay` = the existing `aof mesh relay`, no forked entry
  (ADR-004).
- **PO resolution (2026-07-03) of the story-01-flagged sidecar shape gap:** the sidecar release asset is an
  **ARCHIVE under the exact extensionless pinned name** from `02/tasks/00_os-arch-detect-and-download.feature`
  (`node-pty-darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64|win32-arm64` — node-pty's own platform
  tokens; gzip'd tar content on darwin/linux legs, zip content on win32 legs), whose root entries reproduce
  EXACTLY the directory layout `scripts/build-sea.mjs` emits beside the exe (so extraction into the install dir
  is sufficient for `createRequire(process.execPath)("node-pty")`, ADR-002). Story 02's installers UNPACK the
  verified archive into `$HOME/.aof/bin` (after verify, before PATH — checksum stays on the archive file);
  story 01's stage script emits those byte-exact names + an archive→extract round-trip test. No `.feature`
  scenario changes — the features never pinned a bare-file sidecar; the one-file install assumption was the
  defect. Routed to both developers at build.
- **node-pty is the load-bearing packaging risk** (RESEARCH §2): its `.node` can't live in a SEA blob and there
  is **no Linux prebuild** — it ships as an on-disk sidecar, Linux compiled in CI (ADR-002). A build-time
  confirmation (a real esbuild→CJS→blob→postject build running `aof --version` / `aof mesh relay` / a live PTY
  on each OS + the Linux node-pty compile) is a story 00/01 `@manual`/`@uat` deliverable, not a refine blocker.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green (build gate, 2026-07-03 — full suite 2220 ok / 0 failures, installer lanes
  green from both Git Bash and PowerShell parents)
- [x] Fitness functions green (acd-sea-safe-asset-base, acd-single-entry-command-core,
  acd-native-addon-degrades + polarity, bundle-asset-manifest-complete — all with non-vacuous self-checks)
- [x] `@manual` signed off at `aof:verify 28` (2026-07-03) — see [VERIFICATION.md](VERIFICATION.md): the
  story-00 SEA build smoke (real `aof.exe`: node + relay + live PTY + missing-sidecar degrade) and the
  story-01 GPG `SHA256SUMS` round-trip both **PASS** (agent-run on the reference OS, this session).
- [ ] `@uat` — the KR4 signed-cross-OS-install lane (cross-OS matrix, Gatekeeper/SmartScreen, the one-liner)
  is **delegated to the cross-milestone mesh UAT session** (un-runnable here: no signing secrets / CI runners /
  published release). The milestone is `done` on agent-scope pending that session's KR4 sign-off (reopens on
  failure). **This box stays unchecked until the UAT session signs KR4 off.**

## Feedback (for retro)

- Architecture near-miss (m28 console-app): the graceful-degrade guard in src/terminal-ws.mjs relies on 'await import(node-pty)' inside defaultSpawn, but RESEARCH.md 1/2 establishes that an FS dynamic import() THROWS inside a raw SEA main (SEA import() loads built-in modules only). A degrade guard proven under dev (dynamic import) is NOT automatically SEA-safe. Lesson for the retro: packaging must re-verify EVERY dynamic import()/import.meta.url assumption at build time, not inherit the dev degrade as-is; ADR-002's createRequire(process.execPath) re-home is what makes a PRESENT sidecar actually load rather than the try/catch masking a broken-under-SEA working addon as a spurious error frame. — Raised by: architect
- Contract gap (m28 story 00, task 03): `03_single-entry-two-mode.feature`'s Scenario Outline includes the row `["--version"] -> node mode (version)`, and `01_sea-build-recipe.feature` + STATE.md's KR4 bar assume `aof --version` prints a real version string — but `src/cli.mjs`'s `run()` had NO `--version`/`-v` handler at all before this story (a bare `aof --version` threw "Unknown command"). Not a scenario defect (the scenario is correct and desired), but a pre-existing gap the packaging contract silently depended on. Closed it as a minimal additive argv branch in `run()` (mirrors the existing `help` branch — no new command-core registration, no per-mode fork, ADR-004-compliant), since fixing it was required to make the task-03 scenario and the `@manual` build-smoke true. Lesson for the retro: a milestone whose acceptance bar (`aof --version` working) rests on an assumed-existing base CLI surface should have that assumption checked at Research/Architecture time, not discovered mid-build. — Raised by: developer
- Cross-milestone collision observed at build (m28 not at fault, flagged not fixed): the shared working tree
  carries in-flight milestone-27 work that extends `mesh:status` with an UNCONDITIONAL `isControlNode` marker
  (`src/commands/mesh-identity.mjs`, commented `milestone 27 / story 01`), which deterministically breaks the
  m25 test `mesh-status-fleet-render/01` ("the empty aggregate is exactly { nodes: [], boards: [] }") — that
  test was not updated in the same in-flight change. m28's only touch on that file is the ADR-003 version-read
  re-home (verified via diff). Belongs to m27's build to reconcile (either the marker honours the m25 exact
  envelope contract or the m25 test is updated in the SAME change). Also observed: the untracked m27 arch-test
  `acd-issuance-revoked-issuer-filtered` failing intermittently — same in-flight stream. — Raised by:
  orchestrator (aof:continue 28)
- Contract/shape gap between Story 00 and Story 02 (m28 story 01, cross-checked at build): Story 00's
  `scripts/build-sea.mjs` ships the node-pty sidecar as a DIRECTORY TREE (`<outDir>/node-pty-sidecar/**` +
  the whole `<outDir>/node_modules/node-pty/**` package, needed so `createRequire(process.execPath)("node-pty")`
  can resolve the module id per ADR-002). Story 02's as-built `install.sh`/`install.ps1` instead treat the
  sidecar as ONE FILE per leg — `aof_install_files`/`Install-AofFiles` download, checksum-verify, and copy
  `$workdir/$sidecar` straight to `$install_dir/$sidecar` with no unpack step, and `SHA256SUMS` (per the format
  contract both stories share) carries exactly one line per sidecar name. Story 01's release pipeline
  (`scripts/release/stage-release-assets.mjs`) bridges the gap by packing Story 00's directory tree into a
  single archive under the pinned sidecar name (`node-pty-<os>-<arch>`, tar.gz on POSIX / zip on Windows) — the
  archive downloads and checksum-verifies correctly, but NOTHING in either story's as-built code unpacks it back
  into the runnable `node_modules/node-pty/` + `prebuilds/` shape `createRequire` needs beside the installed
  binary. Neither side silently picked a resolution; this is a real open contract point between the two
  file-disjoint stories for the PO/architect to close (either Story 02's installer gains an unpack step, or
  Story 00/01 ship a flat single `.node` file — mac/win already carry companions (winpty/conpty) that don't fit
  a single-file shape either, so this needs a real decision, not a silent pick). — Raised by: developer
- Resolution + a new build-time finding on the above (m28 story 01, 2026-07-03): the PO pinned the sidecar as an
  ARCHIVE under the exact extensionless name (`node-pty-<node-pty-platform>-<arch>` — no `.tar.gz`/`.zip`
  suffix) whose root entries reproduce `build-sea.mjs`'s beside-the-exe layout exactly; Story 02 unpacks it
  post-verify. Implemented in `scripts/release/stage-release-assets.mjs` (`packSidecarArchive`) + verified with
  a real archive→extract round-trip (`test/release-sidecar-archive-roundtrip.test.mjs`, set-equality both
  directions, both the darwin/linux tar.gz and the win32 zip). Surfaced while building it: PowerShell's
  `Expand-Archive` determines archive FORMAT from the source path's FILE EXTENSION, not content — it refuses an
  extensionless path outright. Since the pinned sidecar name is deliberately extensionless, `install.ps1`'s
  unpack step (Story 02, in flight concurrently) cannot call `Expand-Archive` directly on the
  downloaded/verified file — it needs a copy-to-`.zip`-suffixed-temp-then-expand step (what this story's
  round-trip test does) or `[System.IO.Compression.ZipFile]` directly. `Compress-Archive` (used to BUILD the
  zip) has the mirror-image behavior — it silently appends `.zip` to an extensionless `-DestinationPath` rather
  than erroring, which `stage-release-assets.mjs` works around by building to an explicit `.zip`-suffixed temp
  path and renaming to the pinned extensionless name afterward. Flagged directly to Story 02's developer via
  this entry since their unpack step is concurrent in-flight work. — Raised by: developer
