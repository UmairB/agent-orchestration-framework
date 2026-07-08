---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 35 · Mesh Work Assignment — State

## Progress

- Framed `2026-07-08` by operator order, immediately after milestone 34 was finished + re-accepted. The
  operator's driving statement: "assigning work to a node — this is the whole point of the control-worker
  node relationship." Milestone 34 delivered the *observe* direction (workers stream state up to the
  control node); this milestone delivers the *dispatch* direction (the control node hands work down to a
  named worker, which runs it in an isolated worktree and streams the result back). Framed as SPEC + STATE
  only — no stories yet.

## Notes & decisions in flight

- **This is the retired issuance/routing capability, rebuilt on the new transport.** Milestones 26/27
  built work-issuance + distributed leasing on the git-bus; that machinery (and its tests) was retired in
  milestone 34's "global mesh only" correction. Milestone 35 delivers the same *operator intent* — send a
  work item to a specific node — but over the **WebSocket control stream** (34/ADR-007's anticipated
  control→worker channel), never the git-bus. Watch that this does not smuggle the git-bus back in.
- **Worktree isolation is a headline capability**, not an implementation detail: the operator explicitly
  asked whether assigning work creates a worktree; the answer this milestone makes true is **yes**.
- **Remote code execution.** Running assigned work on a worker is RCE within the tailnet trust boundary;
  expect a security-review trigger at refine (33/ADR-002 admission is the inherited boundary).

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` (two-machine) — assign from control, worker runs in a worktree, fleet view advances live
