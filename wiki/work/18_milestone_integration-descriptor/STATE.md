---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 18 · Per-folder integration descriptor — State

## Status

**Accepted `2026-06-27`** (`aof:verify 18`). All three stories `done`; SPEC `done`. Suite green
(**1381 ok / 0 not ok**), `aof work validate 18` PASS, no blocker finding open. Compacted at accept — the
blow-by-blow below is the distilled record; the durable decisions live in [ARCHITECTURE.md](ARCHITECTURE.md)
(ADR-001..007 + §Fitness FF-A..F), the verify trail in [VERIFICATION.md](VERIFICATION.md), and the process
lessons in [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1 rewrite-comment-sweep, R2 present-but-shapeless guard).

## What shipped

A co-located per-folder **`.integrations.json`** descriptor + a central **`boards` registry** replaced the
superseded `notion.parent`-frontmatter + central-`parents`-map mechanism (re-framed from the original m18
`notion-parent-grouping` design on `2026-06-26` — judged redundant once the `voice-vox-web` test-bed showed
milestones routing to many tasks across different boards). Delivered across three load-bearing-ordered stories:

- **00 · routing-reader + boards + associate** — new `src/integrations/routing.mjs` (the shared seam:
  `readRouting` JSON.parse/absent-tolerant, `isPageId`/`classifyParent` by UUID shape, `resolveNotionRouting`,
  `writeRouting`; imports only `node:fs`/`path`/`recordDoc` — no `parseFrontmatter`, no Notion seam); schema
  `work.integrations.notion` promoted to a closed `oneOf` (flat m17 back-compat arm | `{default, boards}`
  registry); `associate` rewritten to write/clear `.integrations.json` as its only mutation.
- **01 · projection + multi-board sidecar** — projection reads pre-resolved routing, addresses the chosen
  board, nests under the parent via `relationProperty` (absent descriptor ⇒ m17 byte-for-byte); sidecar
  re-keyed to a v2 per-data-source bucket shape (multi-board coexistence, ADR-005) with v1 migration.
- **02 · supersede + fitness** — `parseScalarOrCollection` reverted to its pre-m18 minimal shape (ADR-007,
  the inline-flow-map `{}` branch dropped); the central `parents` block removed; the six fitness invariants
  **FF-A..F** authored + wired (each non-vacuous), the five superseded arch-tests deleted.

## Carried-over principle

**Authored vs derived** (17/ADR-001): routing is AUTHORED intent → committed (`.integrations.json` + the
`boards` config); the page-id binding stays DERIVED → the git-ignored sidecar. Re-deriving the sidecar must
not lose a routing choice. The discrete-JSON-file design (not frontmatter) is the direct answer to the prior
m18's parser-blast-radius lesson — a `JSON.parse` reader never touches the shared `parseFrontmatter`.

## Deferred / open

- **Live-Notion lane (NTN-V1)** — inherited from m17, stays deferred (no workspace/token on this host). Not an
  m18 surface (every m18 scenario is offline/agent-runnable) — does not gate this milestone.
- **Test-hardening backlog (M18-Q)** — non-blocker assertion-tightening (golden m17 `SyncPlan` anchor; a
  `no-board-resolved` regression test; tighter resolver-reason + `--json` envelope assertions). See
  VERIFICATION `@finding-M18-Q`.

## Next

`18` is accepted — `aof work next` advances. `aof work memory ingest` run at accept (184 records; m18 R1/R2
+ ADRs now recallable).
