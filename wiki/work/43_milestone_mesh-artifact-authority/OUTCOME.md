# 43 · Mesh artifact authority — Outcome

<!--
  OUTCOME.md — what this item now delivers, the assumptions that delivery rests on, and the gaps it
  declared but did not fill. Authored EXCLUSIVELY by aof:verify at Accept (ADR-004) — never at insert,
  never by a developer/evidence subagent (verify owns record docs). States product STATE ("the system
  now IS X"), never motive ("we built X because Y" — that reasoning belongs in RETROSPECTIVE.md). This
  is an ADDITIONAL artifact: it carries no identity frontmatter and is never this item's record doc.
-->

## Delivered

### The exclusive item lock
An item whose execution scope is covered by an active assignment is not assignable again, and the check
sits in front of `transitionRunStart` — the one seam all four mint doors route through — so `work next`
and `run-start` honour it as well as the continue/refine/verify doors.

### The cache as the authority for item state
`work_items` is no longer wholesale-deleted and rebuilt on every propagation tick; authority is by
**authorship and door**, never by timestamp, and `syncedAt` is provenance for display and staleness
only. A worker-authored row survives the control node's republish tick indefinitely.

### Write-triggered artifact sync
A `PostToolUse` hook on `Write|Edit|NotebookEdit` enqueues the exact path the agent wrote, and the
worker daemon batches the wire send; the periodic re-scan remains as the reconciliation backstop for
files a `Bash` command touched. The manifest carries `ARCHITECTURE.md` and `tasks/*.feature`, which the
previous four-name whitelist excluded.

### Staleness that marks rather than evicts
Cached rows carry `reportedBy` and `syncedAt`; past the configured window a row renders a stale badge
and an operator-initiated **Resync** that asks the owning node to push a fresh copy. Nothing is ever
evicted — after settle the cache is one of only two copies of that work, the other being the pushed
branch.

### Gate-time propagation
A dispatch advances a continuing item's branch to the assignment's pinned base at the worker's reuse
door, by merge, before the agent starts. An item whose line exists only on the remote is adopted as a
local head and takes that same door rather than being forked. A conflicting advance aborts the merge,
refuses with `assignment-gate-propagation-conflict`, and leaves the branch at its prior tip with no
half-merged tree; the outcome and both commits ride the node log channel.

### The cache as the read surface
`list`, `find`, `next`, `resolve` (and the `doc` / `tasks` / `feedback` commands that sit on it),
`run-start`, `run-status`, `work-doctor`, the notion sync/associate pair, `promote-gap-to-chore`,
`mesh-heartbeat` and `memory/local-indexing` answer cache-first with a disk fallback, and say which
side answered. A worker reading its own checkout still reads that checkout — the boundary is pinned by
positive assertion on the protected function itself.

## Assumptions

- **A worker reports its own slice** — the read surface is only as current as the last frame the owning
  node sent; nothing pulls from control to worker except an operator-initiated Resync.
- **The control node syncs its own lifecycle writes through the same seam a worker uses** — a milestone
  authored on the control node reaches the cache only because the control publishes it; nothing else
  seeds the cache.
- **Structural operations remain disk-based** — `work-reindex`, `validate`/`doctor`'s folder↔frontmatter
  consistency checks, `work-upgrade` and the scaffold verbs act on the control's own checkout and
  publish their result into the cache.
- **`work list --json` carries no provenance** — the seven-field contract (m03/ADR-002,
  `acd-work-list-contract`) is unchanged; the provenance envelope rides the HTTP face and the other five
  CLI read surfaces. A cache-answered row carries three provenance keys, so widening the array contract
  would make its key set vary by deployment.
- **The advance is safe because it runs at a gate** — the item lock is what makes the line quiescent at
  the moment the branch is moved; the advance does not create that quiet window, it uses it.
- **Coverage of the sync trigger is high, not total** — files written by a `Bash` command are carried by
  the reconciliation backstop on the next tick rather than by the hook.

## Gaps

### An operator-initiated delete for a foreign-authored cached row
- **Status:** open
- **Discharge condition:** aof grows an item-delete verb for the door to hang on.
A cached row authored by another node, for a ref an operator deletes on the control node, is
unreachable: the retraction predicate is by authorship, and there is no verb that asks the owning node
to retract. Recorded as TECH_DEBT item 13.

### A settled run's terminal state on the control node
- **Status:** open
- **Discharge condition:** whatever writes a terminal `global_assignments` state settles the run row in
the same transaction, or a read-time reconciliation refuses to report `running` for a terminal
assignment.
A run can read `running` on the control indefinitely while the worker's own record reads `done`; the
cache reports faithfully what it was told, and the terminal frame is what never arrives. Because the
cache does not evict by design, a run row that misses its terminal frame is wrong permanently rather
than briefly. Recorded as TECH_DEBT item 19.

### A coded reason on a failed assignment
- **Status:** open
- **Discharge condition:** the code the worker already sends on `reportSettled` is persisted on the
assignment row and rendered beside the state.
The fleet can report that an assignment failed but not why: `code` is NULL on 45 of 46 assignment rows,
including all 30 in state `failed`. Every distinguishing cause — conflict, unavailable base commit,
unavailable repo, credential refusal — is computed and then dropped at the last hop, surviving only on
the node log channel. Recorded as TECH_DEBT item 22.

### The perceptual accessibility lane
- **Status:** open
- **Discharge condition:** `work.tags.domains` gains an `a11y` entry (or a `work.ui.a11y` block) and an
axe-core-via-Playwright run is armed.
The freshness ramp's programmatic a11y contract (roles, names, live regions) is asserted; the
perceptual half — the greyscale and colour-vision read — has no automated run behind it in this repo and
was judged by a human at the gate, un-baselined.

### A visual-regression baseline for the freshness surfaces
- **Status:** open
- **Discharge condition:** the designer-approved renders are committed as `toHaveScreenshot` baselines
and a drift from one becomes a QA finding.
The surfaces are motion-free, so a screenshot is a complete lock on them, and an approved render exists
at every documented breakpoint — but the baselines are not yet committed as a hard gate.
