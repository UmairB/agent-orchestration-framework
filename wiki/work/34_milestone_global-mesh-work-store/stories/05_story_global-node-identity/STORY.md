---
type: story
number: 05
slug: global-node-identity
title: "Global per-install node identity — one node id per machine, initialized once in the global AOF home, hydrated into every workspace (F-3405)"
parent: 34
status: done
owner: product-owner
created: 2026-07-05
updated: 2026-07-05
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Added 2026-07-05 when the milestone was re-opened: the machine-wide global work store is keyed on
  nodeId, but identity was stored per-workspace — incoherent. See RETROSPECTIVE R8 / VERIFICATION F-3405.
-->
# 05 · Global per-install node identity — one id per machine, not per project

## User story

As an operator running aof in **several workspaces on one control machine**, I want this machine to have
**one node identity** (`nodeId` + `salt`), **initialized once** and stored in the **global AOF home**
(`<AOF_GLOBAL_HOME>/mesh/identity.json`) and hydrated into every workspace, so that the machine-wide global
work store keyed on `nodeId` is **coherent** — the same machine's work is never scattered across a different
`nodeId` per project — while a `git clone` still inherits no identity (the global home is outside any repo,
strengthening the F-3203 fix, not weakening it).

<!-- The direct remediation of F-3405 (the wrong-accept gap): 34/ADR-009 amends 33/ADR-004's persist
     location from the per-workspace sidecar to the global home. loadWorkspace hydrates + exposes
     ws.identityPath; the minting callers write through it; a legacy per-workspace sidecar is a read-only
     fallback migrated up by `work doctor`. -->

## Tasks

- [x] `tasks/00_global-identity-home.feature` — `@executable @finding-F-3405` — identity (`nodeId` + `salt`)
  is minted once to the global AOF home and hydrated into every workspace on the machine (one id shared);
  the project carries no identity file (clone-safe); a second machine (distinct `AOF_GLOBAL_HOME`) keeps its
  own. Guarded by fitness `acd-global-node-identity-home` (identity resolves from the global home, never a
  per-workspace `aofDir`).
- [x] `tasks/01_legacy-sidecar-migrate.feature` — `@executable @finding-F-3405` — a legacy per-workspace
  sidecar is honored as a read-only fallback when the global identity is absent, and `migrateIdentityToGlobal`
  moves it up to the global home (idempotent; removes the per-workspace file); `work doctor` warns
  (`mesh-identity-workspace-local`) while a legacy sidecar remains.
