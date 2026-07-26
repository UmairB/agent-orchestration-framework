---
type: story
number: 01
slug: worker-repo-checkout
title: "Worker repo checkout — a worker assigned work it lacks the repo for clones it from a configured location into a scoped checkout, registers the workspace, and falls through to the existing worktree+run flow; no credential left at rest"
parent: 38
status: done
owner: product-owner
created: 2026-07-10
updated: 2026-07-26
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 01 · Worker repo checkout — assigning work to a worker that lacks the repo just works: it clones itself

## User story

As an **operator assigning work across the mesh**, I want a worker that is handed an assignment for a repo it
**does not have checked out** to **clone it itself** — from a configured location, with auth, into an
isolated scoped checkout — and then run the assignment with **no manual pre-setup on that machine**, so that
cross-machine work is real even on a fresh worker, and the milestone-35 refusal (`assignment-repo-unavailable`)
becomes a self-provisioning success.

<!-- Turns the m35 `!hasRepo` REFUSAL into a clone-then-proceed (ADR-005). The worker resolves the clone
     SOURCE from a new committed config key, clones into a dedicated SCOPED root (never os.tmpdir, never a
     path from directive text), registers the workspace so `workerHasRepo` then passes, and FALLS THROUGH to
     the UNCHANGED m35 worktree+run flow (ADR-006 — worktrees are already delivered, reused verbatim). The
     private-repo auth-transmission MECHANISM is the milestone's blocking open question → RESEARCH.md +
     SECURITY.md; the structural safety invariants (scoped target, no credential at rest) are pinned now. -->

## Tasks

<!-- Contract authored `2026-07-10` via `aof:refine 38 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). Inherits ARCHITECTURE ADR-005/006/007 + RESEARCH.md + SECURITY.md.
     Tasks 00–03 are `@executable` (structural invariants, buildable without the final auth mechanism); the
     real private-repo two-machine clone is the `@manual` soak (04), gated on the SECURITY-approved auth
     mechanism. -->

- [x] `tasks/00_clone-location-config.feature` — `@executable` — the clone SOURCE resolves from the new
  committed `config.mesh.repo.cloneUrl` key via the raw optional-chain idiom (NOT the config-editor
  whitelist); a workspace with no resolvable `cloneUrl` stays a LOUD coded `assignment-repo-unavailable`
  `failed` (never a silent hang) so a misconfigured fleet fails honestly (ADR-005).
- [x] `tasks/01_clone-into-scoped-checkout.feature` — `@executable` — on `!hasRepo`, `git clone` into the ONE
  `meshCheckoutPath(workspaceId)` seam under the global mesh home (`<meshRoot>/checkouts/<workspaceId>/`);
  the path is composed from the store-canonical `workspaceId` only (never directive/ref text), so a traversal
  id escapes nothing; NEVER `os.tmpdir()`; the git spawn is argv-form, shell-less (ADR-005).
- [x] `tasks/02_register-and-fallthrough.feature` — `@executable` — after a successful clone the worker
  writes the local `mesh.repo.published` marker for this `workspaceId` AND inserts its own
  `global_node_workspaces (nodeId, workspaceId)` row, RE-CHECKS `workerHasRepo` (now true), and FALLS THROUGH
  to the EXISTING m35 `addWorktree → resolve-ref → startRun → spawnRuntime → completeRun → cleanup` flow —
  reused VERBATIM, no second worktree call site (ADR-005, ADR-006).
- [x] `tasks/03_credential-not-persisted.feature` — `@executable` — the clone leaves NO credential at rest:
  nothing written into the checkout's `.git/config` (no `url.<cred>@` rewrite, no durable `credential.helper
  store`), and no credential value in any log or error message (the redaction discipline); the credential
  reaches git only through an ephemeral, in-memory/askpass path (ADR-005, SECURITY).
- [ ] `tasks/04_private-clone-soak.feature` — `@manual` — the outsider check for SPEC objective (b): assign a
  story from the control node to a worker that LACKS a **private** repo; the worker clones it (with the
  SECURITY-approved auth mechanism), materializes a worktree, and drives the ref to a terminal run — with no
  manual pre-setup on that machine — and the fleet advances `assigned → running → done` live. **Deferred
  human gate; gated on the RESEARCH/SECURITY auth mechanism; closed at `aof:verify 38`.**

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md) + [SECURITY.md](../../SECURITY.md) — this story arms:

- `acd-worker-clone-target-scoped` (ADR-005) — the clone target is built ONLY from the dedicated
  `meshCheckoutPath` root under the global mesh home; no `os.tmpdir()`, no path from directive/ref text.
- `acd-worker-clone-no-credential-persisted` (ADR-005 / SECURITY) — the clone path writes no credential into
  `.git/config` (no `url.<x>@` rewrite, no durable `credential.helper store`) and logs no credential value.
- `acd-worker-checkout-reuses-worktree` (ADR-006) — the checkout path introduces NO second `git worktree add`
  call site outside the `mesh-worktree.mjs` `addWorktree` seam (re-arms the m35 worktree-scope invariant).

## Notes

**`aof mesh repo publish` auto-detects `cloneUrl` from `git remote get-url origin`
(`2026-07-16`, at the operator's direction, during `aof:verify 38`'s live soak).** The
operator rejected hand-editing `.aof/aof.config.json` (and rejected a proposed
`set-clone-url` verb as needless ceremony) — "check if it exists first, then add it if
it doesn't". `writeRepoPublishedMarker`/`publishRepoToMesh` (`src/commands/mesh-repo.mjs`)
now check the EXISTING `mesh.repo.cloneUrl` first (never overwritten once configured);
only when absent do they run `git remote get-url origin` (an injectable exec seam,
mirroring `mesh-worker-execution.mjs`'s clone-exec idiom) and persist the result through
the SAME read-merge-write, validated by the existing `isWellFormedCloneUrl` gate. A
detection failure (no git repo, no `origin` remote, malformed) is silent and non-fatal —
publish still succeeds with no `cloneUrl`, exactly today's behaviour. **Found and fixed
in the same pass:** a detected `https://` remote commonly carries the operator's own
embedded username (`scheme://user@host/...`) — since `git clone` uses `cloneUrl`
VERBATIM ([mesh-worker-execution.mjs:517](../../../../src/mesh-worker-execution.mjs#L517)),
an embedded personal username would make git skip the askpass Username prompt entirely,
silently defeating ADR-010's `x-access-token` prompt-aware answer for a GitHub App
installation token. `stripUrlUserinfo` strips it before persisting (scp-style
`git@host:owner/repo` is left untouched — that `git` user is the SSH service-account
convention, not a personal credential). Seven new tests added to
`test/mesh-repo-publish.test.mjs` (auto-detect, check-first/no-overwrite, three
detection-failure modes, userinfo-stripped, scp-style-preserved); full suite re-run
clean (2580 ok / 1 not-ok — an UNRELATED, pre-existing timing flake, see STATE.md
Feedback).

Inherits **ADR-005** (clone-on-miss extends the m35 `!hasRepo` branch), **ADR-006** (worktrees reused
verbatim — no net-new worktree work), **ADR-007** (the two-story partition) and [RESEARCH.md](../../RESEARCH.md)
+ [SECURITY.md](../../SECURITY.md) for the auth-transmission mechanism.

**⚠ Blocking dependency — auth transmission (SPEC open question).** The specific mechanism by which a
credential reaches the worker to clone a *private* repo is owed by RESEARCH.md (prior art) + SECURITY.md
(threat model). Tasks 00–03 pin the STRUCTURAL invariants and are buildable without the final choice; the
`@manual` soak (04) with a real private repo is gated on the SECURITY-approved mechanism.

**Independent of Story 00** (ADR-007) — near-leaf blast radius: `mesh-worker-execution.mjs` is imported only
by `mesh-launcher.mjs` and imports only `mesh-worktree.mjs`. Touches `mesh-launcher.mjs` only at the
worker-execution wiring (disjoint from Story 00's presence assembly). Builds in parallel with Story 00.

**Reuses m35 verbatim (ADR-006):** `addWorktree`/`removeWorktree`/`sweepRetainedWorktrees` and the whole
`accepted → running → done|failed` bracket are unchanged; clone-on-miss is additive prefix logic before the
existing repo guard passes.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: no retags. Tasks 00–03 stay `@executable` (hermetic over an INJECTED clone-exec seam + a FAKE
token string — no real forge, no real credential, no network); 04 is genuinely `@manual`.** Task 03's
credential invariants ARE hermetically assertable: the fake git exec records its argv + `env`, so "no
`--config http.*`", "credential only on the clone `execFile` env, never `process.env`", "the scripted
`spawnRuntime` child doesn't inherit it", and "failed-clone log redacted" are all pure Node-process /
string-match assertions — the `@executable` convention already always injects a scripted `spawnRuntime` (no
real `claude`/`codex`).

- **Net-new infra to budget:** (1) an **injected clone-exec seam** `(args, { cwd, env? }) → { stdout, stderr,
  status }`, a direct mirror of `mesh-worktree.mjs`'s `options.exec` idiom. (2) `meshCheckoutPath(workspaceId)`
  — mirrors `meshWorktreePath`/`meshWorktreesRoot` almost verbatim, rooted at `globalMeshPaths(...).meshRoot`.
  (3) the `config.mesh.repo.cloneUrl` resolver — trivial raw optional-chain, BUT the malformed-URL Examples
  need a **git-URL-shape validator, NOT `new URL()` alone** (`new URL()` rejects scp-style `git@host:path`).
  (4) workspace-registration: `writeRepoPublishedMarker` is reused UNMODIFIED, but the `global_node_workspaces`
  insert is **NOT** — ⚠ the only existing writer (`global-node-registry.mjs:211`) does `DELETE FROM
  global_node_workspaces WHERE workspace_id = ?` first (a fabric-sync flow), which would blow away OTHER nodes'
  membership rows for a shared workspace. The worker needs its OWN **narrow single-row upsert** (`INSERT OR
  REPLACE (node_id, workspace_id)`, no delete) — net-new, small, correctness-critical. (5) the `GIT_ASKPASS`
  askpass script + scoped `env` plumbing (see below). (6) credential redaction on the clone-error path (reuses
  the `acd-global-node-descriptors-redact-secrets` discipline, new call site).
- **REUSE verified real:** `addWorktree`/`removeWorktree`/`workerHasRepo`/`writeRepoPublishedMarker` are
  imported + called UNMODIFIED; task 02 adds ZERO new `git worktree add` call sites (the only one is inside
  `addWorktree`).
- **Build order:** `00 → 01 → 02` hard edges (each is the next's precondition); `03` soft-after-`02` (same
  injected exec seam; wants the credential-env wired at the call site 02 completes); `04` is the ONLY hard
  external block. **Tasks 00–03 do NOT block on RESEARCH/SECURITY building the REAL mechanism** — they need
  only the STRUCTURAL shape (scoped env, argv-form, no `--config`), already decided in ADR-005 + SECURITY.md.
  Only `04` blocks on a real private repo + the SECURITY-approved token + a second machine + the operator
  sign-off (R1/R4).
- **GIT_ASKPASS feasible with the current `execFile` idiom** — additive: neither worktree nor worker-exec
  passes `env` today, so adding a scoped `env` to ONLY the clone call is additive. The sanctioned form spreads
  `...process.env` (git needs `PATH`/`SystemRoot` to run — esp. on Windows) and adds ONLY the
  `GIT_ASKPASS=<path>` pointer; the **token is never a literal on `process.env`** — the askpass script reads it
  from a one-shot temp carrier deleted in a `finally`. Control-side token MINTING is out of this story's scope
  (T4 residual — the worker only CONSUMES a token).
- **⚠ Windows askpass shim is the single largest unbudgeted surface (task 03).** `GIT_ASKPASS` names one
  executable (not command+args), so `node <script>` doesn't work directly — needs a generated one-shot `.cmd`
  (Windows) / shell script (POSIX) that internally execs `node <script>`, written scoped + deleted after the
  clone. RESEARCH.md §1 measured GIT_ASKPASS leaves no trace but did NOT validate a Windows `.cmd` shim
  end-to-end — **worth a small spike if it proves fiddly at build** (does not block 00–03: the FAKE exec needs
  no real askpass). `core.longpaths` is already set; the checkout nesting is no deeper than the existing
  `.aof/mesh/worktrees/` path.
- **⚠ Owed fitness function:** `acd-worker-checkout-reuses-worktree` (ADR-006) is referenced but NOT yet a file
  under `test/arch/` — authored at build by the architect/security owner (like ADR-004's
  `acd-session-run-reconciliation`, deliberately built with its story). Not this contract's gap.
