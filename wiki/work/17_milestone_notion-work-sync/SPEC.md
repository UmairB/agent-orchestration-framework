---
type: milestone
number: 17
slug: notion-work-sync
title: "Notion Work-Board Sync — push milestone + story status to a Notion board, one-way, opt-in"
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-27
depends: [08, 12]
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 17 · Notion Work-Board Sync — push milestone + story status to a Notion board, one-way, opt-in

## Objective

The aof work stream is the source of truth for delivery — milestones, their stories, each item's
status — but that truth lives on disk (and in the local board UI). A team that runs its day on a
**Notion board** has no view of it without manual double-entry: someone retypes "story done" into
Notion every time the on-disk stream moves on. This milestone gives aof an **opt-in, one-way bridge**:
`aof work integrations notion sync-work <milestone>` projects a milestone and its stories onto an
**already-existing** Notion board — milestone → its board page, stories → that page's *sub-tasks* —
pushing status so the Notion board reflects aof without anyone retyping it. It is the **product-owner's**
tool, run when a story finishes, to keep the external board honest against the on-disk stream.

It follows aof's established seams rather than opening new ones. The operation is a **registered
command-core command** (milestone 08) — so the CLI face `aof work integrations notion sync-work` and any
future board/MCP face inherit it for free — and it reaches Notion through the **Notion CLI provisioned
into aof's managed tool store** (milestone 12), **never the Notion MCP server**. That CLI-not-MCP choice
is deliberate: the sync must run head-less in the same places `aof work` already runs (a terminal, a PO's
laptop, eventually a hook), with no agent/MCP session to host it. The integration is **opt-in**: with no
configuration (which board, which databases, how auth is supplied) the command is an honest no-op that
prints a setup hint, and nothing about the existing work stream changes. Direction is **one-way,
aof → Notion only**: aof never treats Notion state as authoritative; on any divergence aof overwrites
Notion from disk.

An outsider can verify the objective is met when: with the integration configured against an existing
Notion board, `aof work integrations notion sync-work 15` makes that milestone's Notion page and its story
sub-tasks **match the on-disk statuses** — creating the aof-item ↔ Notion-page mapping on first run and
**updating in place** (no duplicates) thereafter — and `--dry-run` previews that diff without touching
Notion; while with the integration **unconfigured** the same command changes nothing and says so, and
every other `aof work` command behaves exactly as before.

## Scope

In scope:
- **`notion sync-work` as a registered command-core command** (the milestone-08 contract) — a stable
  input (`{ milestone }`) and a `--json` result envelope reporting, per item, what was pushed
  (`created` / `updated` / `unchanged` / `skipped` + the Notion page ref), reusing the same
  `listItems` / `readMeta` traversal `validate` / `list` / `doctor` already share to read the milestone,
  its stories, and their statuses. CLI face:
  `aof work integrations notion sync-work <milestone> [--json] [--dry-run]`.
- **The aof → Notion projection** — milestone maps to its board page; each story maps to a **sub-task**
  of that page; aof status (`not-started` / `in-progress` / `in-review` / `done`) maps to the board's
  status property; title + a stable identity are carried so a human reading Notion sees the same item.
  The board **already exists** — aof binds to *its* schema (configurable property mapping), it does not
  impose one.
- **Idempotent identity / mapping** — the first sync resolves-or-creates the Notion page for each aof
  item and records the **aof-item ↔ Notion-page-id binding** so re-syncs update in place rather than
  duplicating. *Where that binding lives — a `.aof/` sidecar vs. an external-id property written on the
  Notion page — is the milestone's load-bearing ADR (resolved at refine).*
- **Opt-in configuration + the managed Notion CLI** — a `work.integrations.notion` config block (the
  board / database ids, the status-property mapping, how the auth token is supplied) that, when absent,
  makes the command an **honest no-op + setup hint**; and the **Notion CLI provisioned through the managed
  tool store** (milestone 12) and surfaced by `aof project doctor` (present-and-versioned, auth reachable)
  — not the MCP server.
- **`--dry-run`** — compute and print the projected diff (what would be created / updated) **without
  calling Notion**, so the PO can preview a sync before it writes.

Out of scope:
- **Two-way / reverse sync (Notion → aof)** — aof stays the source of truth; reading Notion edits back
  onto disk is a separate, higher-risk arc with conflict semantics this milestone deliberately avoids.
  **One-way only, for now.**
- **Automatic triggering** — no hook that fires sync from `aof:verify` / story-done / the autonomous
  loop. Sync is the PO's **explicit manual command**; wiring it into a lifecycle event is a deliberate
  follow-up once the manual path is proven.
- **A generalized multi-provider integration framework** — the command is namespaced
  `integrations notion` so a future provider (Linear, Jira, …) is a *sibling*, but this milestone ships
  **Notion only** and builds no provider abstraction ahead of a second consumer.
- **Provisioning / authoring the Notion board itself** — the board is already set up; aof binds to its
  existing schema and never creates databases, properties, or views.
- **Syncing below the story line** (tasks / `.feature`s, findings, UAT) or rich content (descriptions,
  comments, acceptance criteria) — **status + identity of the milestone and its stories only**.
- **The Notion MCP server** — explicitly excluded; the integration is CLI-only so it runs head-less
  wherever `aof work` runs.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 17.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-06-25` (`aof:refine 17`) into **four** stories — **00 is the spine; 01 / 02 fan out from
its three frozen contracts (the command envelope, the `.aof/` mapping sidecar, the config/no-op gate) in
parallel, and 03 (fitness) is the parallel tail authored against the frozen ADRs** (the critical path is
`00 → 01`). See [ARCHITECTURE.md](ARCHITECTURE.md) (5 ADRs + the fitness table) and [RESEARCH.md](RESEARCH.md)
for the resolved decisions. The two open `refine` questions are settled: **(1)** the load-bearing mapping is a
git-ignored **`.aof/` sidecar** keyed by aof ref (ADR-001) — NOT an external-id property on the page
(rejected: it needs a board column aof can't create and ~doubles the request count, `RESEARCH §A5/A6`);
**(2)** the Notion CLI is the official **`ntn`** (`RESEARCH §A1`), provisioned as a milestone-12
`provider:"npx"` managed tool (ADR-004, option ii — honouring `12/ADR-002`'s npx-lane/store boundary, NOT
extending it), auth via the **`NOTION_API_TOKEN`** env-var reference (`RESEARCH §A2`, never committed). Dependency
edges: **00 → {01, 02} → 03**.

- [x] **00 · [notion-sync-spine](stories/00_story_notion-sync-spine/STORY.md)** — the registered
  `notion:sync-work` command + `aof work integrations notion sync-work` CLI + the frozen per-item envelope
  (ADR-002), the `.aof/notion.work-map.json` mapping sidecar (ADR-001), and the config-load + opt-in-no-op
  gate (ADR-004). **The spine / critical path** — freezes the three contracts the siblings consume.
- [x] **01 · [notion-projection-sync](stories/01_story_notion-projection-sync/STORY.md)** — the pure
  projection (milestone→page, story→same-database sub-task, status→board option via the mandatory `statusMap`,
  `data_source_id` addressing) + the one-way apply layer (create-on-first-run / update-in-place) + `--dry-run`
  zero-call preview (ADR-003). **The milestone's core behaviour** (critical path with 00; parallel with 02).
- [x] **02 · [notion-cli-provisioning-doctor](stories/02_story_notion-cli-provisioning-doctor/STORY.md)** —
  the `NOTION_DESCRIPTOR` (`provider:"npx"`), the `work.integrations.notion` schema block + validator, the
  env-var-reference auth read, and the `aof project doctor` surface (ADR-004). _Parallel with 01; off the
  critical path — only the `@manual` live binary round-trip needs it._
- [x] **03 · [notion-fitness](stories/03_story_notion-fitness/STORY.md)** — the seven enforcing arch-tests
  (mapping-sidecar-only, one-way, opt-in-no-op, auth-env-ref, never-touch-schema, CLI-not-MCP, fail-honestly);
  the contract IS the ARCHITECTURE.md fitness table (no `.feature`, mirrors 08/03, 12/04, 13/03). **The
  parallel tail** — RED until 00/01/02 land, then green.

## Dependencies

- **08 · cli-command-core** — `notion sync-work` arrives as a **registered command-core command** with a
  `--json` contract (the milestone-08 "new ops arrive as commands first" rule); the CLI is a thin
  `argv → invoke → render` / `--json` face and any future board/MCP face inherits the same command. It
  reuses the `work.mjs` model — `listItems` / `readMeta` / `parseFrontmatter` — that `work:validate` /
  `work:list` already read, to walk a milestone and its stories.
- **12 · managed-tool-provisioning** — the **Notion CLI** is provisioned into
  `~/.aof/tools/notion/<version>/` through the provider registry (a new tool descriptor, possibly a new
  provider lane) and resolved **store-first**; `aof project doctor` reports its presence + version (and
  auth reachability), exactly as graphify / headroom do. This is what lets the integration be
  **CLI-not-MCP and still managed** rather than depending on an operator's hand-installed global.
