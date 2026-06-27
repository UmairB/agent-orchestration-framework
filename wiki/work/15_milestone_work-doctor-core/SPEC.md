---
type: milestone
number: 15
slug: work-doctor-core
title: "Work Doctor Core — a health lane for the work stream"
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-25
depends: [08]
origin: wiki/planning/PRD-work-artifact-health.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 15 · Work Doctor Core — a health lane for the work stream

## Objective

The work stream has a **validity** lane — `aof work validate` (folder↔frontmatter, the closed tag
vocabulary, the `depends` graph) — but no **health** lane. Every validate check is *per-file
well-formedness*; none can see across items. So the stream can be 100% valid while a `done` milestone
hides an `in-progress` child (a lying parent), a `done` milestone has no `RETROSPECTIVE.md`, an
`in-progress` item's `updated` date is months stale, ROADMAP.md lists milestones no folder backs, or a
typo'd folder vanishes from `listItems` entirely — all deterministic, computable facts that nothing
reports.

This milestone gives the work stream its missing health lane, mirroring the `validate`/`doctor` split
aof already runs for config (`aof project validate` / `aof project doctor`). It authors **`work:doctor`**
as a command-core command — so the CLI, board, and MCP faces inherit it for free — reusing the same
`listItems` / `readMeta` traversal `validate` and `list` already share, and builds the deterministic
*cross-item* health-check engine: status coherence, lifecycle completeness, freshness / date sanity,
ROADMAP↔folder sync, and orphan folders. It stays read-only and advisory by default — `--strict`
promotes warnings to failures exactly as the config doctor does — and is wired into `/aof:validate`
*after* `aof work validate`: the deterministic floor beneath that skill's agent-only layer, never a
replacement for the validate keystone.

An outsider can verify it: a stream that passes `aof work validate` but hides a lying parent / a missing
RETROSPECTIVE / a stale-`updated` item / a ROADMAP-vs-folder mismatch / a typo'd orphan now surfaces each
as a coded, severity-tagged `work:doctor` finding — while `validate` stays the hard non-zero gate and
`doctor` stays advisory until `--strict`.

## Scope

In scope:
- **`work:doctor` as a registered command-core command** (the milestone-08 contract) — a stable `--json`
  envelope and a `--strict` flag (advisory warnings by default; `--strict` promotes to non-zero),
  reusing `listItems` / `readMeta`, scope-as-filter semantics matching `work:validate`, and a CLI face
  (`aof work doctor [scope] [--json] [--strict]`) that mirrors the existing validate render/json adapter
  discipline. Each finding carries a **severity** (`warn` / `error`) and a stable machine code so faces
  and `--strict` can reason over it.
- **The deterministic health-check engine**, grouped:
  - **Status coherence (cross-item):** milestone `done` with a non-`done` child story (lying parent);
    milestone `not-started` with an `in-progress`/`done` child (stale parent); story `done` under a
    `not-started` milestone; a driver `depends`-blocked yet already `in-progress`.
  - **Lifecycle completeness (docs-for-status):** `in-review`/`done` milestone missing a non-empty
    `VERIFICATION.md`; `done` milestone missing `RETROSPECTIVE.md` (the close convention); a past-
    `not-started` milestone with zero stories; a started story with an empty `tasks/`; `ARCHITECTURE.md`
    absent once a milestone has stories.
  - **Freshness / date sanity:** `updated` older than the newest file mtime in the item's folder;
    `updated < created`; non-ISO / unparseable dates; an `in-progress` item stale beyond a configurable
    window.
  - **ROADMAP ↔ folder sync:** milestones on disk absent from ROADMAP.md (or vice-versa); numbering gaps
    and duplicate top-level driver numbers.
  - **Orphans:** directories under the work dir that do not match `^(\d+)_(milestone|story|task|uat)_…`
    (typo'd folders silently dropped by `listItems` today).
- **Wiring into the lint keystone:** `/aof:validate` runs `aof work validate` then `aof work doctor` and
  reports both, grouped by lane; the board and MCP faces surface the doctor envelope through the
  registered command (no new door).

Out of scope:
- **Auto-repair / mutation (`--fix`)** — `doctor` is read-only like its config sibling; repairing
  incoherence (bumping a stale parent, stubbing a missing RETROSPECTIVE) is a separate, higher-risk arc.
- **Agent-layer semantic checks** — traceability (`@executable`→green test, `@manual`/`@uat`→
  VERIFICATION rows), `@finding-<id>` lineage, `verifies →` resolution, UAT-gate `## Findings` integrity,
  and litmus stay in the `/aof:validate` skill: they need prose comprehension, not determinism.
- **Generated-output drift** (`.claude/` / `.codex/` stale vs `.aof/` source) — config/workspace health,
  `aof project doctor` territory, not work-artifact health.
- **Gating the autonomous loop on doctor** — whether `aof work next` / `aof:autonomous` treats a
  `--strict` doctor failure as a blocker is a deliberate follow-up; validate stays the gate, doctor stays
  advisory.
- **The context-budget / doc-bloat lint** — its own dependent milestone (**16 · context-budget-lint**);
  and any new aof runtimes or server/daemon/DB infrastructure.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 15.
     Broken down by `aof:refine 15 --autonomous` (2026-06-25); see ARCHITECTURE.md ADR-006 for why the
     boundaries are independent. Build-time order is 00 → {01, 02, 03} (01/02/03 each consume story 00's
     spine; they are mutually independent). The milestone is accepted when all its stories are. -->

- [x] **00 · [doctor-command-core](stories/00_story_doctor-command-core/STORY.md)** — registers `work:doctor` (the `{ code, severity, path, message }` envelope), the `doctorWork` snapshot-once engine + the pure check-GROUP registry + the injectable `now`/`staleWindow`, the CLI face with the advisory/`--strict` exit policy, the `/api/work/doctor` board route, and the registry-derived bijection generalisation (no new door). The spine the others plug into.
- [x] **01 · [coherence-and-completeness-checks](stories/01_story_coherence-and-completeness-checks/STORY.md)** — the status-coherence (lying/stale parent, story-under-not-started, depends-blocked-in-progress) and lifecycle-completeness (missing VERIFICATION/RETROSPECTIVE/ARCHITECTURE, milestone-no-stories, started-story-no-tasks) check-groups, appended to the engine registry.
- [x] **02 · [freshness-and-structural-integrity](stories/02_story_freshness-and-structural-integrity/STORY.md)** — the freshness/date-sanity (stale-updated, updated-before-created, unparseable-date, mtime-ahead-of-updated — via the injected clock) and structural-integrity (folder-first numbering-gap, duplicate-driver-number, orphan-folder + the dormant ROADMAP cross-reference) check-groups, appended to the engine registry.
- [x] **03 · [validate-keystone-wiring](stories/03_story_validate-keystone-wiring/STORY.md)** — wires `aof work doctor` into the `/aof:validate` skill after `aof work validate`, lane-grouped: validate stays the hard gate, doctor is the deterministic advisory floor.

## Dependencies

- **08 · cli-command-core** — `work:doctor` is authored as a registered command on milestone 08's
  command-core contract (every operation is a registered command; the CLI / board / MCP are thin faces
  that may *only* invoke registered commands), and reuses the `work.mjs` model — `listItems` / `readMeta`
  / `parseFrontmatter` — that `work:validate` already reads. The doctor is the validate sibling on that
  same core, so it inherits faces for free rather than opening a side-channel.
