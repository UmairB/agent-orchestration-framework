---
type: milestone
number: 28
slug: console-app
title: "Cross-Platform Console App — signed, install-anywhere node + relay binary"
status: not-started
owner: product-owner
created: 2026-06-29
updated: 2026-06-29
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

_To be broken down — `aof:refine 28`._

## Dependencies

- **23 · control-node-relay** — the deliverable is "**one binary, two modes** (`node` + `relay`)"; the
  `relay` mode is introduced in milestone 23, so packaging the complete binary consumes it. Otherwise the
  packaging mechanism (SEA bundling, signing, one-line install) is **mechanically independent** of the
  mesh internals — it bundles whatever the build contains. PRD §8 sequences this **last** (Phase 4) so the
  shipped binary carries the full mesh, but its only hard code-level dependency is the `relay` mode it
  must package; it is otherwise parallel-eligible once milestone 23 lands.
