---
type: story
number: 07
slug: durable-worker-pushback
title: "A worker's output survives — committed to a real branch and pushed for review"
parent: 38
status: done
owner: product-owner
created: 2026-07-18
updated: 2026-07-26
schema: 1
aofVersion: 0.1.0
---

## User story

As the operator, I want the work a worker produces to be committed to a **real branch and pushed** (for
review / PR), so that a dispatched milestone/story's actual diff survives instead of being force-deleted
with the worktree — the difference between a mesh that does disposable chores and one that does real work.

## Background

Found live during `aof:verify 38` and confirmed against the real GitHub remote (`RESEARCH.md § 4.1`):
`addWorktree` uses `git worktree add --detach` (a detached HEAD, no branch), and a `done` outcome
**force-removes the worktree** (`removeWorktree(..., { force: true })`, `src/mesh-worker-execution.mjs`).
There is **no `git push` anywhere in `src/`**. The earlier "successful" chore soak's output only ever
existed as an untracked local file on the worker — it never reached `origin/main`. Any commit a worker
makes today becomes unreachable garbage the instant the worktree is removed.

**The fix:** the worker checks out a REAL branch (not detached HEAD), and on a successful run `git push`es
it (reusing the ALREADY-BUILT `GIT_ASKPASS` shim — `buildAskpassShim`, the same credential-transmission
path the clone uses, ADR-009's PULL), before the worktree is removed.

**The constraint this bumps (`RESEARCH.md § 4.2`):** the minted credential is code-locked to
`contents: read` (`src/mesh-clone-credential-provider.mjs:181`), guarded by the fitness test
`acd-minted-token-scoped-single-repo` (SECURITY T9). A push needs `contents: write` (and
`pull_requests: write` if auto-opening a PR) — a **deliberate widening of the least-privilege posture**
story-02 established, which MUST re-open the T9 threat model. Preferred shape (§4.2): a SEPARATE
write-scoped token minted only at push time, keeping the clone credential read-only.

## Tasks

<!-- Contract authored `2026-07-18` via `aof:refine 38 --autonomous` (Three Amigos). Refine DELIVERED the
     owed decisions: ARCHITECTURE ADR-015 (durable push-back — real branch `aof/mesh/<itemRef>-<assignmentId>`
     not detached HEAD; `git push origin <branch>` via the ADR-009 `buildAskpassShim` BEFORE force-remove,
     worktree retained until push succeeds; TWO-token widening — clone STAYS `contents:read`, a SEPARATE
     `contents:write` (+`pull_requests:write` only for auto-PR) token minted ONLY at push time; "done" = pushed
     branch) + SECURITY T15 + T9 RE-OPENED (the `acd-minted-token-scoped-single-repo` two-seam rewrite direction).
     Tasks 00–02 `@executable` (a real local bare repo as `origin` + a fake mint recording the two token bodies —
     no real GitHub); task 03 the real-GitHub-push `@manual` soak that directly inverts RESEARCH §4.1's finding. -->

- [x] `tasks/00_real-branch-not-detached.feature` — `@executable` — the worktree is checked out on a REAL branch
  `aof/mesh/<itemRef>-<assignmentId>` (sanitized to a `check-ref-format`-valid ref), HEAD on it, NOT a detached
  HEAD (contrast the measured `git worktree add --detach`); distinct branches per assignmentId; a Scenario
  Outline over ref-hostile itemRef/assignmentId shapes that must sanitize to a valid ref.
- [x] `tasks/01_push-before-worktree-removed.feature` — `@executable` — on a successful run, `git push origin
  <branch>` (via `buildAskpassShim`) runs BEFORE the worktree force-remove (OBSERVABLE call-order + worktree
  still present at push time), over a real local bare origin; a push FAILURE (non-fast-forward / unreachable /
  auth-refused — Outline) RETAINS the worktree + surfaces a loud coded failure, never a clean `done`. (`@round-trip`)
- [x] `tasks/02_two-token-write-scope.feature` — `@executable` — the rewritten `acd-minted-token-scoped-single-repo`:
  the CLONE credential body stays EXACTLY `{repositories:[repo],permissions:{contents:read}}`; the WRITE token is
  single-repo, `permissions ⊆ {contents:write(,pull_requests:write when auto-PR)}`, and the write body appears
  ONLY in the push-mint function (never the clone path). An Outline enumerates the plants that MUST trip CI:
  widened clone body, multi-repo write, omitted `repositories`, an org-wide/`administration` key. (T15 / T9)
- [ ] `tasks/03_durable-push-soak.feature` — `@manual` — the real-producer outsider check (ADR-008; §4.1 proved
  this failure LIVE — green run, output GC'd, never reached `origin/main`): a REAL worker runs REAL feature work,
  commits to a REAL branch, pushes to the REAL GitHub remote; the branch + diff are visible on `origin` AFTER
  the worktree is removed (`git branch -r` / `git show origin/<branch>:<file>`); the write token used was
  single-repo + push-seam-only; T15 security sign-off gate. Deferred human gate — closed at `aof:verify 38`.

## Notes

Independent of story-05/06 (needs only a run that produces commits). Precedes story-08 (memory can only
sync back once output is durable).
