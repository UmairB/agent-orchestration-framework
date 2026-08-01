---
doc: digest
milestone: 42
slug: structural-overhaul
title: "Structural overhaul — one home, one door, no silence"
status: not-started
imported: true
importedBy: aof
source: aof
importedAt: 2026-08-01
---
# 42 · Structural overhaul — one home, one door, no silence — Digest

<!-- Recovered digest, co-located in the source milestone folder. Each `## ` section → one `summary` record via the EXISTING parseAof. -->

## Intent

Pay down [TECH_DEBT.md](../TECH_DEBT.md) in full — item 0 (the umbrella) and its symptoms 1–7 — by **redesigning the subsystems that produce the defects, not by patching where they surface**. The codebase grew by accretion: 41k lines across 147 files in which the same fact is derived in many places (workspace identity: 17 call sites), the same act has several doors, failure is handled by 43 empty catches, and a third of the source is prose narrating past bugs that keep recurring anyway. The operator's direction is explicit: a rewrite that yields a robust, stable product is preferred over further adhoc fixes — adhoc fixes are what produced this state.

The stance, per subsystem touched: **rewrite it to a designed shape, then delete what the design retires.** Deletion is a first-class deliverable — the re-derivations, the scar comments, the redundant doors. The one constraint on ambition is the live two-machine soak: a single big-bang rewrite cannot be verified against a running system, so the overhaul lands as ordered, individually verifiable rewrites (sequencing below), each leaving the soak running.

An outsider can verify the milestone was met without reading any diff:

- **No silent failure.** Zero empty `catch` bodies in `src/`, enforced by an armed fitness function; every degrade path emits a coded event to a real sink (debt items 0, 3).
- **Daemons are observable.** Every long-running process writes rotating JSONL to `~/.aof/mesh/logs/`, and `aof mesh logs [--follow] [--node <id>]` reads it — including for a remote worker (item 2).
- **One home per fact.** Workspace identity is owned by one module with one rule; a repo has the same id on every machine; the projections carry a migration for the duplicate ids already stored (items 0, 4). The 17 independent `workspaceIdFor` derivations are deleted, not wrapped.
- **One door per act.** Continue / refine / verify / run each have exactly one issuance path with the routing decision inside it; board, fleet, and CLI are transports over that door (`work:continue` is the proven pattern) (item 0).
- **One ledger per consequence.** Every fact mutation flows through its store's one transition, which appends a domain event to a durable per-node journal; consequences live in one executable effects table, locus-routed, drained locally or durably enqueued over the bridge — a crashed process leaves *pending* events, never lost cascades. Verified by killing a worker between a run's transition and its assignment settle on the live soak (wave (d); design: [PRD-command-spine-effects-ledger](../../planning/PRD-command-spine-effects-ledger.md)).
- **The build is honest.** A running daemon can state which build it is (`aof mesh status`); the soak-loop deploy is restart-not-rebuild (JS payload beside the launcher, SEA reserved for release artefacts); stale `.bak` binaries are pruned to the last N (item 1).
- **Green means green.** The arch suite runs at zero standing failures — dead tests repaired or deleted, derived counts instead of hard-coded ones — so it gates again (item 5).
- **The board only asserts what it can evidence.** Streamed items resolve their docs, runs, and a live console over the fabric — or the board states plainly that the content lives on the worker node; no dead-end resolution errors (item 6).
- **A restarted worker reclaims its own stranded runs** before accepting new work, and reports the reclaim (item 7).
- **The history lives in the design, not the margins.** A measured, substantial reduction of the 1,670 scar markers and the 31% comment ratio: each retired workaround takes its narration with it (item 0).

## Scope

In scope:

- **Wave (a) — stop the bleeding** (debt items 2, 3, 5): a real log sink + `aof mesh logs`; the no-empty-catch fitness function and the sweep that makes it pass; the arch suite repaired to zero standing failures. Without these no later rewrite can be verified.
- **Wave (b) — one home, one door** (items 0, 4, 6, 7): a single workspace-identity module + cross-machine id unification with a projection migration; the one-door issuance seam extended from `work:continue` to refine/verify/run; the board's drill-downs (docs, runs, console) ride the worker projection or degrade honestly; worker startup run-reclaim.
- **Wave (c) — the honest build** (item 1): launcher/payload decoupling for the dev/soak loop, build id stamped and visible at runtime, `.bak` pruning; SEA kept only as the release artefact.
- **Wave (d) — command spine & effects ledger** (item 0 one level deeper; added 2026-07-27, design: [PRD-command-spine-effects-ledger](../../planning/PRD-command-spine-effects-ledger.md)): one generic CLI face over the registry (all ~84 verbs registered; the nine face copies, six flag vocabularies and 41 hand-decided exit-code sites collapse); mutations emit durable domain events from one transition seam; one effects table maps each event to its reactors, each tagged with the locus of the store it mutates (`checkout` / `control-store` / `local` / `integration:<name>`), drained synchronously by the CLI, on the converge tick by daemons, and durably enqueued over the bridge for remote loci; the mesh carries facts, directives and read-only queries — never remote effect execution; the known cascades port onto the ledger (run completion's 8 divergent sites, publish-on-mutate, the two reclaim halves, insert/reindex, the lock read-merge bypasses); Notion becomes a reactor; every store is declared FACT or PROJECTION with `aof doctor --explain/--converge` to read and replay the ledger.
- **The deletion pass** (item 0): retire scar comments, dead fallbacks, and duplicate derivations made obsolete by the waves above — measured before/after.
- **Regression cover for every rewrite**: each rewritten seam lands with the fitness function that stops its defect class recurring, in the existing `test/arch/acd-*` convention.

Out of scope:

- **A big-bang from-scratch rewrite of the repo** — explicitly rejected: the system is a live two-machine soak and an unverifiable cut-over would recreate the flakiness this milestone exists to end. The rewrite is total in ambition, staged in execution.
- **New product features** — no new commands, surfaces, or capabilities beyond what the consolidation itself requires; feature work resumes on a stable base.
- **Release/distribution pipeline redesign** — the SEA remains the release artefact; only the dev/soak deploy loop changes (item 1's fix). Packaging, signing, auto-update: deferred.
- **Mac/Windows installer parity** — item 1 removes the *silent divergence* (a stale build must be visible); making the two platforms deploy identically is a separate effort.
- **Prose cross-reference rewriting in wiki docs** — the deletion pass targets `src/`; historical narrative in record docs stays (it is the record).
