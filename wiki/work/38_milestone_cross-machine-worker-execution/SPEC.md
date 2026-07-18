---
type: milestone
number: 38
slug: cross-machine-worker-execution
title: "Cross-machine worker execution & session presence — workers that can take on work, and a mesh that reflects live activity"
status: in-progress
owner: product-owner
created: 2026-07-10
updated: 2026-07-18
depends: [34, 35, 36]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 38 · Cross-machine worker execution & session presence

## Objective

The mesh can name its nodes and assign work (milestones 33–35), and a desktop/web fleet view can
render them (25/36) — but two gaps stop cross-machine work from being *real*:

1. **The fleet lies about what a node is doing.** "Current work" only counts *executed aof task-runs*
   (`running` run records), and the presence daemon reads runs from **one** workspace (its launch cwd).
   So a node actively being worked on reads **`idle`**, and a packaged tray app launched from the
   install dir can never reflect *any* repo's work. (Found live in the milestone-36 UAT.)
2. **A worker can't actually run assigned work it isn't already set up for.** If a repo isn't checked
   out on the worker, or has no isolated worktree, an assignment has nowhere to execute.

This milestone closes both: a node's presence reflects **live coding-assistant sessions** (not just
task-runs), aggregated across **all** its workspaces; and a worker node can **provision itself** for an
assignment — check out the repo if missing, and create an isolated worktree to run in.

An outsider can verify the objective is met when: (a) opening a coding assistant on a repo makes that
node read **`working · <repo>`** in the fleet within the heartbeat window, and closing it returns the
node to `idle` (self-expiring, never stuck); a node working two repos shows both; and (b) assigning
work to a worker that lacks the repo results in the worker **cloning it** (from a configured location,
with auth) and creating a **worktree**, then executing — with no manual pre-setup on that machine.

## Scope

In scope:
- **Session presence (idle/working via assistant hooks)** — an assistant-agnostic CLI (`aof session
  start|ping|end`) fed by editor hooks (Claude Code `SessionStart`/`UserPromptSubmit`/`SessionEnd` in
  `.claude/settings.json`); a per-`(node, workspace, assistant)` session record with `lastPingAt`;
  **TTL-based liveness** (a crashed session self-expires, mirroring presence staleness — never a stuck
  "working"). The mesh presence publisher **aggregates active runs + live sessions across ALL of a
  node's registered workspaces** (fixing the single-launch-cwd scope bug). The fleet (desktop 36 / web
  25) renders `working` on any running task **or** live session — task `ref · title`, else `· <repo>
  (session)`.
- **Worker-node repo checkout** — when work is assigned to a worker that lacks the repo, clone it. The
  repo location comes from a **new global aof config key**. Includes the **auth-transmission** design:
  how git credentials / tokens / SSH reach the worker to clone a *private* repo securely (needs
  research + a security review — see the open question below).
- **Worktrees on the worker node** — create an isolated git worktree per assignment on the worker so
  concurrent/isolated execution never collides on a shared checkout.

Out of scope:
- **A general remote-shell / arbitrary-command channel** — the worker provisions *itself* off the
  assignment; this milestone does not add a way to run arbitrary commands on a peer.
- **Multi-assistant richness** (per-file focus, token/cost telemetry) — session presence is
  binary-per-workspace (working / idle) here; finer signal is additive later.
- **Credential storage / a secrets vault** — auth *transmission* for a clone is in scope; a durable
  machine-wide secret store is not (name where it defers if it proves needed).
- **Reflecting non-aof activity** (a bare editor with no assistant hook) — presence is fed by the
  assistant hook contract; an editor that reports nothing stays `idle`.

## Stories

<!-- Broken down `2026-07-10` via `aof:refine 38 --autonomous`. The graph-grounded partition (ARCHITECTURE
     ADR-007) is TWO independent stories, not three: `worker-worktrees` was folded away (ADR-006) because
     the worktree mechanics ALREADY SHIP from m35/ADR-004 (`mesh-worktree.mjs` add/remove/list/sweep + the
     worker handler that already creates a per-assignment worktree) — the checkout story reuses them
     verbatim, so there is zero net-new worktree work.
     UPDATE `2026-07-13`: a THIRD story (`02_story_clone-credential-mint`) was added at the user's direction
     to close the mesh network in this milestone rather than defer the credential-mint automation — so the
     milestone is now accepted when ALL THREE stories are. -->

- [x] [`00_story_session-presence`](stories/00_story_session-presence/STORY.md) — a live coding-assistant
  session marks a node `working · <repo>` via the `aof session start|ping|end` seam (TTL liveness reusing
  the shared `isStale` predicate), the presence record gains an additive `sessions` key (ADR-001), presence
  aggregates across ALL the node's `global_node_workspaces` (ADR-003 — the single-launch-cwd fix), and the
  fleet renders it with run↔session reconciliation (ADR-004). **Fixes the "always idle" + single-workspace
  presence-scope bug.** No blocking research/security dependency.
- [ ] [`01_story_worker-repo-checkout`](stories/01_story_worker-repo-checkout/STORY.md) — a worker assigned
  work it lacks the repo for clones it from `config.mesh.repo.cloneUrl` into the scoped
  `meshCheckoutPath(workspaceId)`, registers the workspace, then FALLS THROUGH to the unchanged m35
  worktree+run flow (ADR-005/006). **Carries the open auth-transmission question** → `RESEARCH.md` (measured:
  `GIT_ASKPASS` + control-minted short-lived token) + `SECURITY.md` (threat model). Tasks 00–03 buildable
  now; the real private-repo two-machine clone is the `@manual` soak, gated on the SECURITY-approved mechanism.

- [x] [`02_story_clone-credential-mint`](stories/02_story_clone-credential-mint/STORY.md) — the control node
  mints each clone credential automatically from a configured provider (a **GitHub App**): short-lived,
  `contents:read`, scoped to exactly the assigned repo — replacing the hand-made per-repo PAT and closing
  SECURITY **T4**'s operator-attested minting-policy residual (scope/TTL become code-enforced, not attested).
  Added `2026-07-13` at the user's direction — *this milestone is to be the close of the mesh network, so the
  credential-mint automation lands here rather than deferring to a follow-up.* Plugs into story-01's ADR-009
  `mintCloneCredential` seam; builds after story 01. **Refine owes: RESEARCH (GitHub App installation-token
  API + JWT signing), SECURITY (App-key-at-rest threat + least-privilege App scope), an ADR (the provider
  abstraction).**

- [ ] [`03_story_per-org-credential-scoping`](stories/03_story_per-org-credential-scoping/STORY.md) — each
  org's clone credential is minted by that org's OWN GitHub App (its own key, its own installation),
  resolved per-workspace exactly like `config.mesh.repo.cloneUrl` already is (ADR-010 Gap A) — instead of
  today's ONE App/token resolved globally on the control node for the whole mesh. Added `2026-07-16` at
  the operator's direction during `aof:verify 38`'s live soak provisioning, locked into THIS milestone's
  scope (not deferred). **Milestone now accepts only when all FOUR stories are done.**

**Stories 04–08 added `2026-07-18`** at the operator's direction after `aof:verify 38`'s real two-machine
soak proved the plumbing works but exposed that a worker's output is disposable (never pushed), its driver
can't ask a human anything (`claude -p`), and nothing syncs verified knowledge back to control. The
operator's bar: *"I'm not signing off this milestone until it actually works in a real-world scenario …
even if you need to create 100 more stories."* The mega-scope is decomposed into five focused,
independently-verifiable stories (research + decisions: `RESEARCH.md § 4`), in dependency order:

- [ ] [`04_story_ui-driven-assignment`](stories/04_story_ui-driven-assignment/STORY.md) — assign a
  milestone/story to a worker node FROM the fleet/board UI (a security-reviewed mutation carve-out on the
  read-only fleet face, ADR-006, wrapping the existing `aof mesh assign` verb). No CLI. Entry point.
- [ ] [`05_story_terminal-driven-worker-execution`](stories/05_story_terminal-driven-worker-execution/STORY.md)
  — the worker runs assigned work as **interactive `claude` in a PTY** (the existing
  `terminal-ws`/`terminal-providers`/`terminal-sessions` subsystem, on the worker's subscription), driven
  by whole commands the control node writes into it (`/aof:refine <ref> --autonomous`, `/aof:continue`) —
  **replacing `claude -p` entirely**. Asks-a-human and subscription-billing both fall out of this. Dep: 04.
- [ ] [`06_story_worker-terminal-streaming`](stories/06_story_worker-terminal-streaming/STORY.md) — relay
  the worker's live `/ws/terminal` PTY stream over the mesh into the control node's fleet view (read-only
  mirror first), routed by (nodeId, sessionId) — the fleet-face no-terminal refusal becomes a carve-out.
  Dep: 05.
- [ ] [`07_story_durable-worker-pushback`](stories/07_story_durable-worker-pushback/STORY.md) — the
  worker's work commits to a **real branch and is pushed/PR'd** (reusing the `GIT_ASKPASS` shim) so output
  survives the `done`-worktree force-remove; needs the credential widened to `contents:write` (re-opens
  SECURITY T9). Independent of 05/06.
- [ ] [`08_story_worker-verified-memory-syncback`](stories/08_story_worker-verified-memory-syncback/STORY.md)
  — a milestone/story **verified on a worker updates the control node's memory** (`git pull` +
  `aof work memory ingest` of the now-shared markdown; the graphify index is a local cache, nothing crosses
  the mesh). Dep: 07. **Milestone now accepts only when all NINE stories (00–08) are done.**

<!-- FOLDED AWAY (ADR-006): `worker-worktrees` — delivered by m35/ADR-004; no story, no net-new work. -->
- [x] ~~`worker-worktrees`~~ — SUBSUMED by milestone 35 (ADR-006); the worktree-per-assignment mechanics
  already ship and are reused verbatim by `worker-repo-checkout`.

## Dependencies

- **34 · global-mesh-work-store** — the presence / `activeRuns` model this extends, and the machine-wide
  registry of a node's workspaces the aggregation reads.
- **35 · mesh-work-assignment** — the worker-execution path (`mesh-worker-execution.mjs`) that provisioning
  (checkout + worktree) hangs off, and that a `running` run record already flows from.
- **36 · mesh-desktop-app** — the desktop fleet view (and the web view, 25) that renders the new
  `working`/`idle` + session signal; the milestone whose UAT surfaced gap #1.

## Open questions (resolve at refine → research/security)

- **Auth transmission for a private-repo clone on a worker.** How does the worker obtain credentials to
  `git clone` a private repo — a short-lived token minted by the control node and passed over the relay?
  A pre-provisioned per-worker deploy key / SSH agent? Delegated to the fabric (e.g. Tailscale identity)?
  This needs `aof-researcher` (prior art / vendor behaviour) + `aof-security` (threat model: a credential
  crossing the mesh must not be exfiltratable or over-scoped). Blocks the `worker-repo-checkout` story.
- **Session ↔ run reconciliation.** When a live session AND a task-run exist for the same workspace, which
  wins the "current work" line, and do they merge? (Design at refine.)
