---
type: milestone
number: 47
slug: fleet-repo-filter
title: "/fleet with a repo filter — narrow the mesh to the repo in hand"
status: not-started
owner: product-owner
created: 2026-08-02
updated: 2026-08-02
depends: [45]
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
# 47 · /fleet with a repo filter — narrow the mesh to the repo in hand

## Objective

The fleet page renders everything the mesh knows — every workspace, every milestone card, every node
([Fleet.tsx:372-388](../../../ui/src/fleet/Fleet.tsx#L372-L388)) — and the only narrowing available is
`?scope=global|local`, which means "the whole mesh" versus "the daemon's own workspace". An operator
working in one repo has no way to say so.

The filter key already exists: every card carries workspace identity (`workspaceId`, `name`,
`projectRoot`). Only the filter is missing. This milestone moves the fleet surface onto its own
`/fleet` route and gives it a first-class repo/workspace filter, applied consistently to every region.

It is the arc's **earliest visible win** — it needs only the router, nothing else, and it is
independent of the terminal work entirely.

Origin: [PRD — Web UI Restructure](../../planning/PRD-web-ui-restructure.md), milestone
`fleet-repo-filter`.

## Scope

In scope:

- **The fleet surface at `/fleet`.** Milestone 45 introduces the route; this milestone is where `<Fleet>`
  becomes its owner and the surface stops being a `?mode=` value.
- **A repo/workspace filter applied to every region** — workspaces, milestone cards and nodes alike. A
  filter that narrows one region and not another is worse than none.
- **URL persistence beside `?scope=`.** The filter is a deep-link, shareable and refresh-surviving, and
  it composes with the existing scope parameter rather than replacing it.
- **An honest empty state and a visible "filtered by" chip.** A filtered view that looks like an idle
  fleet is a bug; the operator must always be able to see *why* they are looking at nothing.
- **The assign-row geometry contract kept intact.** Region 5's yield order was settled across design
  gaps DG-13…DG-22 and is fitness-locked by
  [fleet-assign-row-geometry.test.mjs](../../../test/fleet-assign-row-geometry.test.mjs). The filter is
  in fact *relief* here — a filtered view can drop the workspace-name column — but the assign row's
  membership is a contract, not a layout preference. Treat any change to it as a deliberate,
  test-updating decision.
- **The `?scope=` question, answered.** A repo filter subsumes most of what `scope=local` is used for.
  The PRD's recommendation is to **keep both initially** — `scope` is a deep-link contract with existing
  consumers — and revisit after soak. This milestone records the decision either way rather than leaving
  two overlapping narrowings undocumented.

Out of scope:

- **Introducing the route itself** — milestone 45.
- **Any terminal change.** The fleet card's peek is re-homed by milestone 46; this milestone does not
  touch it beyond whatever the filter does to card visibility.
- **Filtering the terminals home.** Milestone 49 has its own surface and its own narrowing question.
- **New fleet mutations.** `/api/mesh/assign` remains the one write; the filter is read-side only, and
  [mesh-ui-read-only-contract.test.mjs](../../../test/mesh-ui-read-only-contract.test.mjs) stays green
  untouched.
- **Reworking what a card shows.** The filter changes *which* cards render, not their content.

## Stories

<!-- Populated at the Break-down stage (refine). -->

To be broken down — `aof:refine 47`.

## Dependencies

- **45 · ui-app-shell-routing** — this milestone needs a `/fleet` path to own and the shell's
  URL-parameter handling to persist the filter in. It depends on nothing else in the arc: not on the
  spike, not on the terminal control, not on session identity. Once 45 lands it can run in parallel with
  everything above it.
