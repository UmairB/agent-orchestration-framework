---
type: story
number: 03
slug: per-org-credential-scoping
title: "Per-org credential-provider scoping — a separate GitHub App per org, not one shared App resolved globally on the control node"
parent: 38
status: not-started
owner: product-owner
created: 2026-07-16
updated: 2026-07-16
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 03 · Per-org credential-provider scoping — isolate the mint at the org boundary, not just the repo boundary

## User story

As an **operator running an aof mesh across repos in more than one GitHub org**,
I want **each org's clone credential minted by that org's OWN GitHub App — its own key, its own
installation — resolved per-workspace exactly like `config.mesh.repo.cloneUrl` already is**,
so that **a compromise of one org's App key can never mint a credential for another org's repos: the
isolation boundary is the org, not just the repo inside one shared App.**

<!-- Added `2026-07-16` at the operator's direction, during `aof:verify 38`'s live private-clone-soak
     provisioning — surfaced when the operator asked how the milestone scales to more repos/orgs. ADR-010
     (story 02) resolves the `mintCloneCredential` PROVIDER (env-token | github-app) exactly ONCE, from
     the CONTROL NODE'S OWN config, at the ONE production wiring site (`mesh-launcher.mjs:508-513`) — so
     today one control node mints with exactly one App (or one env-token) for every repo across the
     WHOLE mesh, regardless of org. ADR-010 Gap A already resolves `cloneUrl` per-workspace (via
     `createResolveWorkspaceCloneUrl`, reading each OTHER workspace's own committed config) — this story
     gives the App IDENTITY the same treatment. Locked into THIS milestone's scope (not deferred to a
     future one) at the operator's explicit direction — mirroring how story-02 itself was added
     mid-milestone. See ARCHITECTURE.md's ADR-010 "Known limitation" note for the full context and the
     two options considered (one App installed across orgs, rejected for blast-radius reasons; one App
     per org, chosen for isolation). -->

## Tasks

<!-- Contract authored at `aof:refine 38/03` (Three Amigos). Anticipated shape below — refine may
     reshape freely; this story is independent of siblings 00–02, all of which are already done. -->

- [ ] `tasks/00_per-workspace-app-identity-resolution.feature` — **singular by default, override-able
  per workspace (operator's explicit direction, `2026-07-16`: "assume singular apps, but allow for
  overrides").** Confirmed at this session: `loadWorkspace` (`src/work.mjs:176-180`) ALREADY merges the
  GLOBAL `~/.aof/aof.config.json`'s `mesh` key as the base with each project's own LOCAL `mesh` config
  layered on top (`mergePlainObjects(globalMeshConfig, localMeshConfig)`, local wins) — so a single App
  configured in the GLOBAL config is already the fleet-wide default, and a project's own local config can
  already OVERRIDE it TODAY. The gap this task closes: that override only takes effect when the
  overriding project happens to be the daemon's OWN LAUNCH workspace — `resolveCloneCredentialProvider`
  is resolved ONCE from the launch workspace's merged config (`mesh-launcher.mjs:508-513`), never
  re-resolved per ASSIGNED workspace. Task 00 extends resolution to: for the workspace an assignment
  actually targets, read ITS OWN committed config for a `mesh.repo.credential.*` override (via the
  descriptor lookup, mirroring `createResolveWorkspaceCloneUrl`'s Gap A treatment of `cloneUrl`); absent
  an override, fall through to the control node's own (global-merged) default — the SAME singular/default
  behaviour as today, now correctly reached for ANY assigned workspace, not only the launch one.
- [ ] `tasks/01_cross-org-key-isolation.feature` — a credential minted for workspace A's org can never be
  produced using workspace B's org's App key; a workspace whose own org has no App/key configured fails
  loud (the existing `clone-credential-mint-failed` → `assignment-repo-unavailable` posture), never
  silently borrows another org's App.
- [ ] `tasks/02_default-private-key-directory.feature` — when neither
  `AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH` nor `config.mesh.repo.credential.githubApp.privateKeyPath` is
  set, `resolveGithubAppPrivateKey` falls back to a CODE-ENFORCED default directory under the global mesh
  home (`<meshRoot>/credentials/`, i.e. `~/.aof/mesh/credentials/` — never Dropbox, iCloud, OneDrive, or
  any other sync-scoped folder, matching SECURITY T8's "file-permission-protected path" requirement) —
  added `2026-07-16` at the operator's direction, during `aof:verify 38`'s live soak, after the operator
  relocated the story-02 App key out of a Dropbox-synced folder into `~/.aof/mesh/credentials/`. Until
  this task ships, the path must be set explicitly via env/config (as today's soak does); after it ships,
  dropping a key into the default directory needs no explicit path at all.

## Notes

Inherits milestone 38's ADR-010 (the provider seam this story extends) and Gap A (the per-workspace
resolution pattern this story mirrors for App identity). Likely needs an ADR amendment (or a new ADR)
at refine — the architect decides whether this is ADR-010 extended or a new ADR — and a SECURITY review
pass, since it changes where a per-org secret (T8's App private key) is resolved from and who can
configure it. Independent of stories 00–02 (all already done); near-leaf change scoped to
`mesh-launcher.mjs`'s provider-resolution call site + the `mesh-clone-credential-provider.mjs` module.
