---
type: story
number: 02
slug: clone-credential-mint
title: "Automated clone-credential mint — the control node mints a short-lived, single-repo, read-only token per clone from a configured provider (GitHub App), so onboarding a private repo needs no hand-made per-repo PAT and no standing secret on any worker"
parent: 38
status: done
owner: product-owner
created: 2026-07-13
updated: 2026-07-16
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 02 · Automated clone-credential mint — the fleet scales to any private repo without a hand-made token

## User story

As an **operator running a control node for a multi-repo fleet**, I want the control node to mint each
clone credential **automatically** — short-lived, read-only, and scoped to **exactly the assigned repo** —
from a **configured provider** (a GitHub App), so that onboarding a new private repo to the mesh needs **no
hand-made per-repo PAT**, **no standing secret sits on any worker**, and the "single-repo / short-lived /
read-only" security posture is **guaranteed by construction** instead of resting on my sign-off.

<!-- Closes the last operator-attested residual of this milestone. ADR-009 (story 01) built the
     credential PULL path with a PLUGGABLE `mintCloneCredential(workspaceId, assignmentId)` seam
     (control-stream-server.mjs) and a deliberately-dumb default that reads a static
     `AOF_MESH_CLONE_TOKEN` env var. SECURITY T4 flagged that static token as a bootstrap only: its
     scope/TTL cannot be worker-asserted, so the operator has to ATTEST them at every soak, and a
     multi-repo fleet would need one hand-made PAT per repo. This story replaces the attestation with an
     automated provider that produces T4-compliant tokens by construction. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

1. **A provider abstraction at the `mintCloneCredential` seam, selected by control-node config**
   (e.g. `config.mesh.repo.credential.provider`): `env-token` (the existing default, **retained**) |
   `github-app` (new). No hard-coded single provider.
2. **The `github-app` provider**, given the assignment's `workspaceId`: resolves the target repo (from its
   `cloneUrl`), **signs a JWT with the App private key on the control node** (RS256, `node:crypto`), and
   **exchanges it for a GitHub App installation access token scoped to that ONE repo, `contents: read`** —
   short-lived (~1h) by construction. **No static PAT anywhere in the path.**
3. **The minted token is single-repo + read-only + short-lived BY CONSTRUCTION** — so T4's minting-policy
   residual is **closed**: a verification/fitness check asserts the provider requests a *scoped* token
   (exactly the assigned repo, `contents:read`), so the operator no longer attests scope/TTL by hand.
4. **The App private key lives ONLY on the control node** (file-permission-protected; a configured path/env),
   **NEVER crosses the relay and NEVER appears in a log, error, or frame.** Only the minted short-lived
   token is handed to the worker — over the **unchanged ADR-009 pull path**.
5. **Backward compatible + fails loud.** Absent provider config → the `env-token` default behaves exactly as
   today. A misconfigured / unreachable / permission-denied provider → the **existing loud coded
   `assignment-repo-unavailable` refusal** (never a hang, and — critically — **never a silent fallback to a
   broad or unauthenticated clone**).
6. **Onboarding a NEW private repo to the fleet needs only**: the App installed on that repo + its `cloneUrl`
   configured. **No new hand-made credential, no per-repo secret.**

## Tasks

<!-- Contract authored `2026-07-13` via `aof:refine 38/02 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). Inherits ARCHITECTURE ADR-009/ADR-010 + RESEARCH §3 + SECURITY
     T8–T11. Tasks 00–04 are `@executable` (hermetic over an injected signer/http seam + a FAKE app key + FAKE
     token — no real GitHub, no real key, no network); the real App-minted private clone is the `@manual` soak
     (05). Build order: 00 → 01 → (02, 03, 04 soft-after-01) → 05 last. -->

- [x] `tasks/00_provider-config-driven.feature` — `@executable` — the mint is a config-selected provider
  (`env-token` default unchanged | `github-app`), resolved at the launcher and injected as a LITERAL
  `mintCloneCredential` key (ADR-009 F12 discipline re-armed); unknown provider fails loud at startup; the
  authorization gates (T6/F15/F16) still precede every mint.
- [x] `tasks/01_github-app-mint-scoped.feature` — `@executable` — the `github-app` provider resolves owner/repo
  from the CONTROL's own `config.mesh.repo.cloneUrl` (never the worker's frame), signs an App JWT with
  `node:crypto` (RS256, no new dep), auto-resolves the installation, and requests a token for EXACTLY that repo
  with `contents:read` (T9/F6 — the code-enforced closure of T4); owner/repo parses across https/scp/GHES.
- [x] `tasks/02_app-key-not-relayed.feature` — `@executable` — the App private key flows ONLY into the JWT signer:
  never on a frame, never logged, never on ambient `process.env` (T8/F5); a mint failure redacts both key and
  token; the minted token is left at no rest on the worker (story-01 T1/T3 re-armed on this path).
- [x] `tasks/03_askpass-prompt-aware.feature` — `@executable` — the GIT_ASKPASS shim answers Username →
  `x-access-token`, Password → the token (ADR-010 dec. 4; GitHub's guaranteed App form), so the token is never the
  username; the token still lives only in the scoped one-shot (story-01 F2 stays green); the env-token PAT path
  still authenticates.
- [x] `tasks/04_mint-failure-loud-no-fallback.feature` — `@executable` — any `github-app` fault (App not installed,
  bad key, API unreachable, permission denied, blank token) THROWS → coded `clone-credential-mint-failed` → the
  worker's loud `assignment-repo-unavailable`; NEVER a null, NEVER an env-token fallback, NEVER an unauthenticated
  clone (SECURITY T10); no partial checkout.
- [ ] `tasks/05_real-app-mint-soak.feature` — `@manual` — the outsider check: a REAL GitHub App (installed
  least-privilege on the target repo) mints a REAL installation token that clones a REAL private repo the worker
  lacks, drives to a terminal run, no credential at rest — confirming the `x-access-token` behaviour live and the
  operator's least-privilege-App attestation (the ONE human attestation that REPLACES story-01's per-repo-PAT
  scope/TTL sign-off, now code-enforced). Deferred human gate; closed at `aof:verify 38`.

## Scope

Out of scope (named so they defer honestly):
- **Non-GitHub forges** (GitLab/Bitbucket/self-hosted) — the provider is *pluggable* so they can be added,
  but only `github-app` ships in this story; a second provider is additive later.
- **A general machine-wide secrets vault** — the single App private key at rest on the control node is the
  **accepted residual** (ONE key for the whole fleet, file-perm protected — strictly better than a per-repo
  PAT or a per-worker deploy key; it supersedes SECURITY R2's per-repo standing-credential concern).
- **Token caching / reuse** — minting per-clone is fine (the token is short-lived by design); no cache.

## Fitness units (proposed — armed at refine)

- `acd-clone-credential-provider-config-driven` — the mint provider is resolved from config at the
  `mintCloneCredential` seam; no single hard-coded provider, and the `env-token` default path is unchanged.
- `acd-clone-app-key-not-relayed` — the App private key never crosses the relay and is never logged (extends
  story-01's `acd-clone-credential-relay-not-logged` to the *key*, not just the minted token).
- `acd-minted-token-scoped-single-repo` — the `github-app` mint requests an installation token for EXACTLY
  the assigned repo with `contents:read` (a structural check on the API-call shape), so a broad-scope mint
  fails CI — the code-enforcement that closes T4.

## Open questions (resolve at refine → research / security / architecture)

- **Installation id** — configured explicitly, or auto-resolved via `GET /repos/{owner}/{repo}/installation`?
  (aof-researcher: measure the real API + the App-auth requirement for that call.)
- **`workspaceId → owner/repo` resolution** — parse from the `cloneUrl` (handling the scp-style
  `git@host:owner/repo.git` form and enterprise hosts), or a config mapping? Must agree with the repo the
  clone actually targets.
- **JWT specifics** — RS256 via `node:crypto` (confirm **no new dependency**), the ≤10-min App-JWT expiry
  ceiling, and clock-skew tolerance. (aof-researcher.)
- **Threat model** — the App private key at rest on the control node, and the App's **own** least-privilege
  scope (the App must be installed with `contents:read` on *selected* repos only, never org-wide write).
  (aof-security: a new SECURITY threat entry + the App-scope attestation that REPLACES the per-repo PAT one.)

## Notes

Inherits ADR-009 (the PULL credential path — this story only changes what `mintCloneCredential` *returns*, not
how it reaches the worker) and story-01's SECURITY T1–T7. **Independent of story 00** (session presence).
**Touches the same `control-stream-server.mjs` mint seam as story 01** — so it builds *after* story 01's mint
gates (F15/F16) are in, and reuses them verbatim (holder + workspace-match + active-state authorization all
still precede the mint; this story swaps only the mint *implementation* behind them).
