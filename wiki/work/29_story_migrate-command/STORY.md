---
type: story
number: 29
slug: migrate-command
title: "Migrate Command — adopt an existing folder as a managed aof work item"
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-06-30
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A standalone story (no parent) is self-contained.
-->
# 29 · Migrate Command — adopt an existing folder as a managed aof work item

## User story

As a developer adopting aof on a codebase that already has work underway,
I want a `migrate` command that converts an existing folder into a full aof work item — a real SPEC
(+ stories + tasks) under management — and, when some or all of that work is already done, has the
architect agent review what was delivered and flag the issues a developer can then pick up,
so that I can bring legacy and in-flight work under aof's managed lifecycle (refine / continue /
verify) instead of either restarting it from scratch or settling for `import`'s read-only knowledge
snapshot.

<!--
  The "so that" is the real benefit and the line that justifies a NEW command alongside import.
  The contrast is load-bearing and must survive into refinement:
    - `import`  → SUMMARISES a foreign folder into an AOF.md knowledge digest. Read-only on the
                  source, one-time snapshot, NEVER becomes a managed work item (knowledge only).
    - `migrate` → CONVERTS a folder INTO a full aof spec that IS managed work — refinable,
                  continuable, verifiable. The folder becomes the work item, not a digest of it.
  Already-done work is reconciled, not re-run: the architect reviews what exists and flags issues as
  developer-actionable findings, so migrate produces an honest starting state rather than pretending
  the work is greenfield.
-->

## Tasks

<!-- Authored by `aof:refine 29` (Three Amigos): each task is a tasks/NN_<slug>.feature whose scenarios
     are its acceptance criteria. Tick a box when its @executable feature is green. -->

- [x] [00 — migrate produces a managed work item](tasks/00_migrate-produces-managed-item.feature)
      (the core seam: folder in → a real, managed milestone SPEC + stories + tasks under work.dir that
      resolves via `aof work find` and passes `aof work validate`; `--dry-run` previews; next free slot)
- [x] [01 — migrate vs import, distinct outcome](tasks/01_migrate-vs-import-distinct-outcome.feature)
      (the load-bearing contrast: migrate writes MANAGED work into the stream — never an AOF.md digest,
      never the `.aof/imports/` store — and leaves import's behaviour untouched)
- [x] [02 — already-done reconciled into findings](tasks/02_already-done-review-findings.feature)
      (detect delivered work so status reflects reality; the architect reviews it and records
      developer-actionable findings — an honest starting state, not greenfield)
- [x] [03 — source-shape tolerance](tasks/03_source-shape-tolerance.feature)
      (read/normalise any source shape reusing import's recovery; never demand aof's layout; absence is
      information — a thin source recovers a thin item, an empty one is refused, nothing fabricated)

All four `@executable` suites green (`test/migrate-command-core.test.mjs`, 32 tests) plus two fitness
functions (`acd-migrate-command-cli-bijection`, `acd-migrate-read-only-source`). The two `@manual`
scenarios (task 02 architect-judgement, task 03 real-world folder) are deferred to the `@uat` lane.

## Notes

Standalone for now; if migrate grows companion capabilities it can be regrouped under a milestone at
refinement. Relationship to milestone 13 (External Milestone Import) is deliberate contrast, not
overlap — migrate should reuse import's source-reading/normalization where sensible but diverges at
the outcome: a managed work item under aof's lifecycle, with architect review reconciling work that
is already (partially) done.

### Resolved decisions (taken at `aof:continue 29` build — were open questions at refine)

The contract pinned the OBSERVABLE end-state; these mechanism decisions were resolved during the build
and are pinned by tests (no separate ARCHITECTURE.md — this is a standalone story):

- **Destination = scaffold, source read-only (RESOLVED).** Migrate scaffolds a FRESH managed milestone
  under `work.dir` at the next free slot, deriving content from the read-only source; it never moves or
  mutates the source. This is forced by task 03's "source byte-for-byte unchanged" scenario and pinned by
  the `acd-migrate-read-only-source` fitness function. (Not in-place / relocate.)
- **Findings land in the produced `STATE.md` `## Findings` (RESOLVED).** Developer-actionable findings,
  derived mechanically from recovery-signal gaps, are written to a `## Findings` section of the produced
  milestone's STATE.md (absent when there is no delivered work). The architect's deeper review is the
  deferred `@manual` lane.
- **Command id = `migrate:folder`; top-level `migrate` verb reclaimed (RESOLVED).** One command
  `migrate:folder` `{id,input,run,cli}` in the frozen core; `aof migrate <folder>` reclaims the verb from
  the legacy removed-command stub (the old config-migrator now lives only at `aof project migrate`).
  Pinned by `acd-migrate-command-cli-bijection`.
- **Status mapping, never `done` (RESOLVED).** none → `not-started`; delivered-with-gaps → `in-progress`
  (+ findings); fully-delivered-clean → `in-review`; a source's self-asserted `done` clamps to
  `in-review`. `done` is earned only at `aof:verify`. Guarded by a `done`-marker fixture test.

### Deferred follow-ups (non-blocking, for a later refinement)

- **Arbitrary-source slug is `repo`** (from recovery's synthetic identity) → a bare README source produces
  `NN_milestone_repo` with the real name only in the title. Cosmetic; revisit if a descriptive slug is wanted.
- **Source story-folder/title parsing is duplicated** in `migrate-folder.mjs` (`STORY_FOLDER_RE`,
  `storyTitle`) against `recovery.mjs` (`NUMBERED_FOLDER_RE`, `recoverAofMeta`) — drift-guarded by a
  `keep-in-sync` comment for now; the clean fix is to export one shared enumerator from `recovery.mjs`.
- **Scaffolded task features carry a feature-level `@manual` tag** (so each scenario inherits exactly one
  verification tag, as `checkFeatureTags` requires). The Three Amigos re-author real scenarios + lanes
  when the migrated milestone is itself refined.

### Developer feasibility notes (carried from the Three Amigos — for `aof:continue 29`)

The contract is buildable on import's existing machinery (`resolveImportSource` read-only access,
`recoverMilestone` + the arbitrary-source lane, `materialize`'s `--dry-run` preview, the command-core
`{id,input,run,cli}` shape). Four seams are migrate-NEW over what import/recovery give for free:

- **Empty-source refusal is a migrate guard, not free from recovery.** `listRecoverableMilestones`
  always returns ≥1 synthetic arbitrary candidate and `recoverMilestone` returns an all-empty
  `{intent:null, decisions:[], outcomes:[], meta:{}}` rather than throwing (import would still write a
  thin digest). Migrate must add its own refusal when `intent===null && decisions.length===0 &&
  outcomes.length===0` → non-zero exit, nothing written (file 03's "empty source refused cleanly").
- **`done`-marker clamp.** `normalizeStatus` maps a source's literal "done" marker to `done`, but
  migrate must NEVER emit `done` (earned only via `aof:verify`). The architect should pin the clamp:
  a source's self-asserted `done` becomes at most `in-review` in the produced item (file 02).
- **Findings + gap-detection are wholly new code** over the recovered shape — recovery has no notion of
  "gaps" or a findings record. The contract leaves *where findings land* open (above); the `@executable`
  rows assert only existence + status, which is buildable.
- **Validate passes via the digest schema.** A migrated milestone whose record doc is an `AOF.md`
  digest validates against the digest schema (`milestone`/`slug`/`status`), so it needs no native
  `created`/`updated` — useful if migrate reuses import's `AOF.md` record-doc form.
