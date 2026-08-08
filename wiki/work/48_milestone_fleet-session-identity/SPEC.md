---
type: milestone
number: 48
slug: fleet-session-identity
title: "Routable session identity — a live session you can address without an assignment"
status: not-started
owner: product-owner
created: 2026-08-02
updated: 2026-08-02
origin: ../../planning/PRD-web-ui-restructure.md
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 48 · Routable session identity — a live session you can address without an assignment

## Objective

The terminal mirror routes strictly on the `(nodeId, sessionId)` tuple
([mesh-terminal-mirror.mjs](../../../src/mesh-terminal-mirror.mjs)), and the only place a `sessionId`
reaches the browser today is on an **assignment** record. The presence record's `sessions[]` carries
`{ workspaceId, repo, assistant, lastPingAt }` ([api.ts](../../../ui/src/fleet/api.ts)) — no session
id, no pid, nothing addressable.

The consequence is exact and it is the reason this milestone is the arc's true foundation: the fleet
already **knows** a node is working (`working · <repo> (session)`,
[fleet/runs.mjs](../../../ui/src/fleet/runs.mjs)) and **cannot open a terminal on it**. A session
started outside an assignment is invisible to every terminal surface. No grid of live panes is possible
until session identity is on the wire.

This milestone puts a stable, routable session id — with the repo/workspace it belongs to and the
lifecycle the surfaces render — on the presence record and in a fleet-side session index, so **any**
live session on **any** node is addressable as `(nodeId, sessionId)` without going through an
assignment.

Origin: [PRD — Web UI Restructure](../../planning/PRD-web-ui-restructure.md), milestone
`fleet-session-identity`.

## Scope

In scope:

- **A stable session id on the presence record.** Additive to `PresenceSession`, in the manner
  milestone 38 / story 00 already established for that record (`sessions` was itself an additive
  growth — a no-session node emits `sessions: []`, present and never omitted). Stable means it survives
  the heartbeats of one session and is never reused across two.
- **Repo/workspace attribution.** Which repo and which workspace a session belongs to, so a surface can
  group and filter by them without inferring from free text.
- **A fleet-side session index** keyed by `(nodeId, sessionId)`, so the control node can answer "what
  live sessions exist across the mesh" as a lookup rather than a scan of assignments.
- **The lifecycle the surfaces render** — a session appearing, ending, and expiring. TTL-filtered
  liveness stays computed by the presence aggregate before the wire carries it; the card renders what it
  is handed and never recomputes liveness itself, which is the existing contract and stays the contract.
- **Additive, never a second source of truth.** The assignment record keeps carrying its own
  `sessionId`; this milestone must not create a second authority that can disagree with it. Where both
  describe the same session, one derives from the other.
- **Sessions with no work item.** A session that is not attached to an assignment is the whole point —
  it must be representable with `workItem: null` rather than being filtered out or given a fake ref.

Out of scope:

- **Any UI surface.** This milestone changes the wire and the index. The grid that consumes it is
  milestone 49; the launcher that registers new sessions into it is milestone 50.
- **Spawning sessions.** Milestone 50. This milestone makes *existing* sessions addressable.
- **Durable transcripts or replay.** The mirror stays ephemeral (ADR-014). A per-session transcript
  store is a separate observability arc.
- **Stall detection.** Knowing a session is *live* is in scope; deciding it is *stalled* is a separate
  run-resilience arc with its own definition of the word.
- **Changing how the mirror routes.** `(nodeId, sessionId)` is already the routing tuple; this milestone
  supplies the tuple more widely, it does not redesign the relay.

## Stories

<!-- Populated at the Break-down stage (refine). -->

To be broken down — `aof:refine 48`.

## Dependencies

None in this arc. It is a wire-shape and index change with no UI surface, so it depends on neither the
router (45) nor the spike (44) and is **parallel-eligible from day one** — worth starting alongside 45
rather than after it, since 49 and 50 both wait on it and it is the longest pole to the home screen.
