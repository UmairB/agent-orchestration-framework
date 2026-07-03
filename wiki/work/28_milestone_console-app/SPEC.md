---
type: milestone
number: 28
slug: console-app
title: "Cross-Platform Console App — signed, install-anywhere node + relay binary"
status: done
owner: product-owner
created: 2026-06-29
updated: 2026-07-03
depends: [23]
origin: wiki/planning/PRD-decentralized-agent-orchestration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 28 · Cross-Platform Console App — signed, install-anywhere node + relay binary

## Objective

**Phase 4 — install anywhere, one tool** (origin:
[PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md), §7.2 KF8, §7.3).
Today aof is an npm-linked dev install. This milestone packages it into **signed, self-contained console
binaries** for Windows / macOS / Linux with **no Node.js / toolchain prerequisite** for the end user,
behind a **one-line installer**.

The node runtime and the relay ship as the **same binary in two modes** (`node` / `relay`) — any box can
host the relay, so there is no separate product to install. Packaging is via Node single-executable
application (SEA) or `pkg`-style bundling, with signing / notarization per OS.

An outsider can verify the objective is met when a single signed command produces a **working node on all
three OSes with no toolchain prerequisite** (KR4), and the same binary runs in `relay` mode.

## Scope

In scope:
- **Signed self-contained binaries** — Windows / macOS / Linux, no Node / toolchain prerequisite;
  SEA or `pkg`-style bundling.
- **One binary, two modes** — the node runtime and the relay ship as the same binary (`node` / `relay`).
- **One-line installer + signing / notarization per OS.**

Out of scope:
- **The mesh features the binary packages** (identity / sync / relay / enrollment / ui / leasing /
  issuance) — milestones 22–27; this milestone bundles whatever the build contains and adds no mesh logic.
- **An auto-update / release-channel pipeline** — beyond the first signed install.
- **Mobile / web distribution** — console binaries only (PRD §7.1).

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 28.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-07-03` by `aof:refine 28 --autonomous`. The partition is a **linear artifact pipeline**
(build → sign → install) following the codebase-graph coupling
([ARCHITECTURE.md §Story break-down rationale](ARCHITECTURE.md), `aof graph build src` → 1261 nodes / 3400
edges, builtAt 2026-07-03): the graph confines **every** runtime `src/` change to story 00 — ONE
`src/asset-base.mjs` seam threaded through 7 low-fan-out `import.meta.url` sites (ADR-003) + ONE node-pty
dynamic-import re-home on the `terminal-ws.mjs` leaf (ADR-002, which the graph shows has **no static edge to
node-pty at all**) + the greenfield SEA recipe (ADR-001) + the single-entry two-mode confirmation (ADR-004,
`run()` has 0 src-dependents — the one door). Stories 01 and 02 are **file-disjoint greenfield** (CI/signing
scripts + installer scripts, **not in the src graph**) — they add zero `src/` code and couple to 00 only at the
**artifact boundary** (01 signs 00's built binary; 02 downloads+verifies 01's signed artifacts). That
artifact-boundary coupling is what lets the three contracts be authored **in parallel**. Edges: **00 → 01 → 02**
(02's checksum-verify a soft contract on 01's `SHA256SUMS` format).

- [x] **00 · [the self-contained binary](stories/00_story_self-contained-binary/STORY.md)** — the SEA +
  esbuild→CJS build recipe + asset-manifest generator (ADR-001), the ONE `src/asset-base.mjs` SEA-safe seam
  re-homing all 7 sites (ADR-003), the node-pty on-disk sidecar + `createRequire` re-home + load-bearing degrade
  (ADR-002), and the single-entry two-mode confirmation (ADR-004) + fitness #1/#2/#3 + the build-recipe
  completeness unit #4. Produces an **unsigned working binary** (KR4 minus signing). The **only** story touching
  `src/`; the code-coupled root of the chain.
- [x] **01 · [cross-OS signing & notarization](stories/01_story_signing-notarization/STORY.md)** — the per-OS CI
  runner matrix (win/mac/linux + arch legs) + the **Linux node-pty source-compile** (ADR-002) + Windows
  Authenticode / macOS codesign+notarize+staple / Linux GPG `SHA256SUMS` (ADR-005) + the checksum manifest.
  **File-disjoint greenfield**; consumes 00's build recipe. KR4's "signed" half; mostly `@manual`/`@uat`.
- [x] **02 · [the one-line installer](stories/02_story_one-line-installer/STORY.md)** — `install.sh` (curl|sh) +
  `install.ps1` (irm|iex): detect OS/arch → download the signed asset **+ its sidecar** → **verify checksum/
  signature before** placing on PATH → per-user `$HOME/.aof/bin` (ADR-006) + the README one-liner.
  **File-disjoint greenfield**; consumes 01's signed artifacts (soft `SHA256SUMS` contract). KR4 end-to-end
  (`@uat`).

## Dependencies

- **23 · control-node-relay** — the deliverable is "**one binary, two modes** (`node` + `relay`)"; the
  `relay` mode is introduced in milestone 23, so packaging the complete binary consumes it. Otherwise the
  packaging mechanism (SEA bundling, signing, one-line install) is **mechanically independent** of the
  mesh internals — it bundles whatever the build contains. PRD §8 sequences this **last** (Phase 4) so the
  shipped binary carries the full mesh, but its only hard code-level dependency is the `relay` mode it
  must package; it is otherwise parallel-eligible once milestone 23 lands.
