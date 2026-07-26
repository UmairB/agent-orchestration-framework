---
doc: retrospective
milestone: 33
updated: 2026-07-05
---
<!--
  Milestone RETROSPECTIVE.md — carryable lessons distilled from this milestone's mistakes,
  blockers, and the verification findings. Written at aof:verify close.
-->
# 33 · Mesh Relay/Transport Redesign — Retrospective

## Why this milestone was accepted (read this first — it is not a clean pass)

Milestone 33 was accepted `2026-07-05` **deliberately and with reservations**, by owner decision —
NOT because it independently demonstrates its headline promise. The reasons, plainly:

1. The one hard **blocker (F-3302)** — the macOS `.local` hostname suffix breaking the fabric
   peer→nodeId join — was found on real hardware, fixed, and verified end-to-end on the live
   Windows+macOS tailnet. That defect is genuinely closed.
2. **Milestone 34 (`global-mesh-work-store`) supersedes 33's user-facing surface** and is where the
   mesh becomes *openable and testable*: it makes `aof mesh ui` global-by-default (story 03) and
   composes fabric peer data (`mesh-fabric`) into the node registry the UI renders (story 02), on a
   single control machine. The design debt below is carried to 34, not resolved in 33.
3. The owner chose to accept and move on rather than keep 33 open. This document records the debt so
   34 (and any reviewer) inherits it honestly.

The accept is a **move-to-34 decision**, not a "33 delivers its promise" decision.

## Lessons (carry forward)

- **R1 — Idealized fixtures gave a false-green over the exact bug the seam exists to handle.** Every
  `@executable` fabric-seam test used rosters where the aof `nodeId` *equalled* the Tailscale
  `HostName` (`umairs-mbp`/`umairs-mbp`, no `.local`). Real macOS never looks like that
  (`os.hostname()` → `Umairs-Mac-mini.local` → `umairs-mac-mini-local`), so the ADR-002.2 join left
  the mac **unjoined** — and CI was green over it. The `@manual` real-hardware lane is what caught it
  (F-3302). **How to apply:** a seam whose whole job is bridging a divergence must have at least one
  fixture built from realistic OS output, and the regression test should *derive* the join key
  (`sanitizeHostname(realHostname)`) rather than hard-code the happy value — so a revert goes red.
  (Encoded now: the F-3302 regression in `mesh-fabric-seam` + `self-heal`.)

- **R2 — A "discovery-plane" claim must be verified at the surface, not just at the seam.** ADR-002's
  headline is "the fabric IS the discovery+liveness plane." In truth the shipped code uses the fabric
  only for *liveness of already-rostered nodes*; the node roster `mesh:status`/the UI render still
  comes entirely from git-synced descriptors (`readNodeRecords`). So a node the fabric can see does
  NOT appear in the fleet UI until it git-publishes and both sides sync — the discovery plane is
  still *git*, as in m22. The first time an operator tried the obvious thing (`aof mesh ui` → "see my
  fleet") it showed one node and needed heavy manual git setup to show two. **How to apply:** an
  architectural promise ("X is the discovery plane") needs an acceptance scenario at the *user
  surface* (open the view, see the node) — not only a seam test (`resolvePeers` joins). This is the
  gap 34 story 02/03 is built to close (compose `mesh-fabric` into the registry + global UI).

- **R3 — When a redesign removes a component's main job, re-justify or delete it — don't leave a
  named role that does almost nothing.** Eliminating the WebSocket broker (ADR-002) hollowed the
  "control node" to near-vestigial: its only enforced remaining job is single-writer of the shared
  registry, and it doesn't gate discovery, presence, liveness, or issuance (issuance is own-path).
  An operator immediately asked "then what's the point of a control node?" and was right to. **How to
  apply:** a redesign that guts a component should either give it a concrete new job in the same
  milestone or remove it; a role that survives only as a thin write-guard is a smell. (34 gives it a
  real job — the machine-wide work-store host — which is the right resolution, one milestone late.)

- **R4 — ADR-002 left dead-but-parked code** (`serveRelay`/`relayMode`, the m24 `/enroll`
  device-flow + its behavioural suites) running green over unreachable machinery, deliberately, since
  re-accepting m18–28 was out of scope. Carry-forward: a future milestone should delete or
  `@deprecated`-mark the enrollment apparatus with an ADR-002 amendment.

## What went right

- The `@manual` real-hardware lane did its job: it caught F-3302, which no fixtured lane could. The
  fix (strip `.local` in derivation + a churn-safe self-heal stale-format trigger) was verified on
  the live tailnet (pre-fix id unjoined → post-fix id joins the real mac peer). Keep the real-hardware
  lane; it is where the integrated promise is actually checked.

## Findings ledger (from VERIFICATION.md)

- **F-3302** (blocker) — macOS `.local` fabric-join break. **Fixed + closed on live hardware.**
- **F-3301** (minor) — fleet-shared committed `mesh` config not restored. Deferred (defensible for
  the non-node aof repo; a real fleet-node config concern, now naturally 34's).
