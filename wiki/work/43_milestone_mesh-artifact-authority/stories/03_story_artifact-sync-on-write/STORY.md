---
type: story
number: 03
slug: artifact-sync-on-write
title: "Write-triggered artifact sync — a PostToolUse hook whose body derives nothing names each artifact as the agent writes it, the daemon batches the send on its existing tick, the artifact set widens through one manifest, and the co-authored .claude/settings.json is MERGED, never rendered whole"
parent: 43
status: done
owner: product-owner
created: 2026-08-01
updated: 2026-08-02
depends: [43/02]
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 03 · Write-triggered artifact sync

## User story

As the **operator reading a work item while a remote agent is actively authoring it**,
I want every artifact the agent writes — not just four record docs — to **reach the control node as it is
written**, driven by a hook the model cannot skip rather than by a periodic re-scan,
so that `tasks/*.feature`, `ARCHITECTURE.md`, `DESIGN.md`, `RESEARCH.md` and `STATE.md` are readable on
the control node **during** the run instead of living only in the worker's worktree until it is deleted —
closing `commands/tasks.mjs:15`'s *"the features live in the worker's worktree and are not streamed yet"*.

<!-- The trigger is a HOOK, never a prose instruction: "an instruction to run a command after editing is
     the forget-class bug this arc exists to kill" (STATE). The hook's real architectural job is not
     latency — it turns an O(all artifacts) re-scan into O(changed), which is what makes widening the
     artifact set affordable. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` **ADR-001** (the trigger), **ADR-002** (the settings merge) and **ADR-007**
(the artifact manifest).

1. **The trigger is a `PostToolUse` `command` hook in EXEC form** (`command` + `args`), matcher pinned to
   exactly **`Write|Edit|NotebookEdit`**. Exec form is **mandatory** — the shell form's interpreter differs
   across the Windows control node, the Mac worker and the WSL worker, and a hook that behaves differently
   per node is the cross-machine defect class this repo keeps paying for. `MultiEdit` is deliberately
   absent (measured removed from the shipped tool set, v2.1.220).
2. **The hook body DERIVES NOTHING.** It reads stdin, resolves the path field through an explicit per-tool
   map, appends ONE NDJSON line to a queue file **whose absolute path was stamped into its argv at
   install time**, and exits **0, always**. It opens no store, imports nothing from `src/`, boots no CLI,
   loads no workspace, and **computes no workspace identity** — the last is not incidental: cwd-derived
   identity is TECH_DEBT item 4, the defect that silently discarded 100% of worker→control frames for days.
3. **The per-tool path map is explicit and fails LOUD, never silent.** `Write` → `tool_input.file_path`,
   `Edit` → `file_path`, **`NotebookEdit` → `tool_input.notebook_path`** (a measured field-name exception).
   A payload whose tool matched but whose mapped field is absent enqueues a coded **`unresolved-path`**
   line rather than dropping the event; the drain reports it as a degrade. A hook keyed only on `file_path`
   silently misses every notebook edit — and silence here is the exact failure mode being engineered out.
4. **A failed enqueue NEVER fails the agent.** Exit code is always 0 (`PostToolUse` cannot block — the
   tool already ran). A queue that cannot be written degrades to the reconciliation tick, which is the
   pre-existing behaviour — **never worse than today**.
5. **The daemon owns batching and the wire.** The worker daemon drains the queue on its **existing**
   stream tick (`pushActiveWorktreeState`), de-duplicates by path, and sends one batched frame carrying
   **only artifacts whose content hash moved**. The queue bounds the **wire and the reporting**, not
   the local read: the tick still performs the full reconciliation read STATE mandates, because a
   `Bash`-written file and a node with no hook installed must both still converge on the very next
   tick. What the queue buys that no re-scan can: a named-but-now-missing artifact becomes a coded
   degrade instead of a silence, an `unresolved-path` line reaches an operator, and the drain is
   **idempotent and loss-averse** — it consumes by rename-then-read, so a crash mid-drain **re-sends
   rather than loses**. One loop does both jobs.
   <!-- AC5's original "reads current content for the named artifacts ONLY" was superseded at the
        43/03 build review by ADR-013/C8: a cadence split would have broken AC4's "never worse than
        today", task 00's "within one stream tick" for `Bash`-written files, and every codex worker
        (which has no `PostToolUse` hook, so its queue is permanently empty). The affordability
        argument was always the content hash's, in both ADR-001's and ADR-007's own words. -->

6. **The artifact set becomes a bounded two-kind MANIFEST in a new pure-leaf `src/work-artifacts.mjs`:**
   `{ name, file }` for exact filenames (`SPEC.md`, `STORY.md`, `VERIFICATION.md`, `RETROSPECTIVE.md`,
   `ARCHITECTURE.md`, `DESIGN.md`, `RESEARCH.md`, `STATE.md`) and `{ name, dir, ext }` for a bounded
   directory+extension set (`tasks/` + `.feature`). **A glob/regex language is REJECTED** — `work:doc`'s
   input contract is a *name*, so "what can I ask for" must stay answerable; a pattern language is exactly
   how the streamed set and the requestable set would drift apart.
7. **`WORK_ITEM_DOC_FILES` is DERIVED from the manifest** (its `file`-kind entries) and re-exported from
   `global-work-store.mjs`, so every existing importer keeps working unchanged. One definition, one derived
   compatibility view — **never two literal lists**. This preserves the invariant already stated at
   `global-work-store.mjs:17-22`: *"ONE home for the set … so the streamed set and the requestable set can
   never drift."*
8. **Artifacts travel with a per-artifact content hash, and an unchanged artifact is never re-sent.** This
   is what keeps the tick cheap after the widening, and what makes the reconciliation backstop affordable
   to run forever.
9. **`.claude/settings.json` is treated as CO-AUTHORED and gets a surgical MERGE.** A new merge writer
   mirrors `mergeLock` (`src/lock.mjs:37-50`) and `writeSidecarPatch` (`src/node-identity.mjs:74-95`):
   read (absent/torn ⇒ `{}`), splice, write the union, and **skip the write entirely when the merged result
   is byte-identical**. The merge target is not "one key" but **one hook array entry, inside one event key,
   inside one top-level key**.
10. **aof-authored hook entries are SELF-IDENTIFYING**, so the splice is **idempotent and retractable**:
    removing the hook from config removes exactly aof's entry and nothing else, and any entry on the same
    event that aof did not author survives **byte-identical**.
11. **The whole-file render path is structurally CLOSED for this file.** `renderRuntimeConfigOutputs`
    (`src/adapters.mjs:101-111`) must no longer emit a whole-file `.claude/settings.json`, so it can never
    reach `planApplyActions`' ungated fall-through (`src/render-plan.mjs:48`). This is a **removal**, not a
    guard added at a call site — the m42 lesson is that a rule living at whichever call site needed it
    first is not a rule.
12. **The hook SCRIPT and the hook ENTRY ship through different doors.** The enqueue script is an
    aof-exclusive file and ships as a normal content-hashed **bundle asset** (the existing drift-protected
    mechanism); the settings **entry** ships through the merge. Splitting them is what keeps
    "whole-file render iff aof exclusively owns the file" true of every file the bundle writes.

## Tasks

<!-- Authored at `aof:refine 43 --autonomous` (Three Amigos: PO headline Scenarios + aof-qa Examples +
     aof-developer feasibility). Each is a tasks/NN_<slug>.feature whose @executable scenarios are the
     acceptance criteria. Kept independent of the other stories' tasks.
     The split follows the story's four SEAMS — the producer (the hook), the consumer (the daemon's
     drain), the SET the two carry (the manifest), and the co-authored FILE the hook entry lands in.
     The hook and the drain are one queue's two ends but a different subject each: their observable
     channels do not overlap (queue-file bytes and an exit code vs. a wire frame and a control-side
     row), so they are two contracts, not one.
     35 scenarios: 32 `@executable`, 2 `@manual` (each needs machines a single process cannot have),
     1 `@uat` (the human acceptance this whole story exists for). -->

- [x] `tasks/00_posttooluse-enqueue-hook.feature` — `@executable` + `@manual` — the trigger is a
  `PostToolUse` `command` hook in EXEC form (`command` + `args`) with the matcher pinned to exactly
  `Write|Edit|NotebookEdit`; its body resolves the path through the explicit per-tool map (`Write`/`Edit`
  → `tool_input.file_path`, **`NotebookEdit` → `tool_input.notebook_path`**), enqueues a coded
  `unresolved-path` line when a MATCHED tool's mapped field is absent rather than dropping the event,
  appends nothing for an unmatched tool, carries the payload's path VERBATIM (normalising it would be a
  cwd derivation), lands in the same argv-stamped queue file from any cwd, and **exits 0 under every
  queue fault and every malformed payload** — with the degraded run still converging on the
  reconciliation tick, i.e. never worse than today. (AC1–AC4, ADR-001)
- [x] `tasks/01_daemon-drains-queue-into-one-batched-frame.feature` — `@executable` + `@uat` — the
  worker daemon drains the queue on its **existing** stream tick (`pushActiveWorktreeState`), de-duplicates
  by path (including across `/` vs `\`), reads content for the **named** artifacts only — observable as
  every unnamed artifact's control-side `updatedAt` refusing to move — and sends ONE batched frame; an
  interruption at any point in the drain **re-sends rather than loses**, a re-drain is idempotent, an
  `unresolved-path` line is a coded degrade on `aof mesh logs` rather than a silence, and the
  reconciliation backstop still converges a `Bash`-written artifact the hook never saw. Closes with the
  operator reading a live remote agent's freshly authored features on the control node, mid-run.
  (AC5, ADR-001)
- [x] `tasks/02_artifact-manifest-widening-and-content-hash.feature` — `@executable` — the artifact set
  becomes a bounded TWO-KIND manifest (`{name,file}` × 8 exact filenames, `{name,dir,ext}` × `tasks/` +
  `.feature`) with no glob language: every `file` entry is streamed AND requestable by name, the `dir`
  entry is requested by name + member with traversal / nested / member-on-a-file-entry / unknown-name all
  coded refusals, only `.feature` members are in the set, the four pre-existing doc names keep answering
  identically (the derived-`WORK_ITEM_DOC_FILES` regression guard), and a per-artifact **content hash**
  means an unchanged — or touched-but-unchanged, or edited-and-reverted — artifact is never re-sent.
  The headline is the payoff: `tasks/*.feature` ride the wire and read on the control node while the
  control's own checkout still has no `tasks/` directory — closing `commands/tasks.mjs:15`.
  (AC6–AC8, ADR-007)
- [x] `tasks/03_claude-settings-surgical-merge.feature` — `@executable` + `@manual` — `.claude/settings.json`
  is CO-AUTHORED and takes a surgical merge: every one of the operator's top-level keys and four
  hand-wired hook events survives **byte-identical**, an operator entry on the same `PostToolUse` event
  survives beside aof's, repeated runs leave exactly one aof entry and a byte-identical result **skips the
  write entirely** (no mtime churn), retraction removes exactly aof's entry and returns `PostToolUse` to
  `[]` without deleting the key, absent / zero-byte / torn / `{}` are each handled without inventing
  content (and a missing file with nothing to splice **stays** missing), `work init` / `work update` /
  `assets apply` each plan **no action at all** for the file, and the SCRIPT ships as a drift-protected
  bundle asset while the ENTRY ships through the merge. (AC9–AC12, ADR-002)

## Notes

- **Dependency shape (ADR-009):** wave 2, parallel with stories 04 and 05. Depends on `43/02`'s upsert
  seam; shares only the new leaf `work-artifacts.mjs` with the cache work.
- **The `http` hook type was measured and REJECTED as primary**, with the measurement recorded in ADR-001 —
  not on merit (it is cheaper at the call site: zero process spawn vs. ~23ms) but because it needs a new
  inbound listening surface on every agent node, requires writing the security-relevant
  `allowedHttpHookUrls` key into a hand-authored settings file, needs a dynamic port known at settings-write
  time, and **fails silently** when the allowlist is restrictive — reintroducing the forget-class failure
  one layer down. `curl` as the hook binary was rejected for the same endpoint requirement plus a
  portability assumption, for 17ms.
- **The latent defect this story closes before it arms:** `planApplyActions` falls through to an ungated
  *"existing file will be overwritten"* for any file with no prior lock entry — which describes this repo's
  hand-authored `.claude/settings.json` exactly. The hazard is **dormant, not absent**: it goes live the
  moment a `claude` hook lands in `.aof/aof.config.json`, i.e. the very change this story makes. The
  repo-wide fix is routed to `wiki/work/TECH_DEBT.md` **item 9**; this story closes only this instance.
- Arch-tests already green: `acd-artifact-sync-hook-derivation-free` (fails CI if the enqueue script grows
  an `src/` import, a store open, a workspace-identity derivation, or a non-zero exit path — or if it
  handles `file_path` without handling `notebook_path`), `acd-claude-settings-co-authored` (a canary on the
  operator's current top-level keys, arming exactly at the hazard), `acd-work-artifact-set-single-home`.
