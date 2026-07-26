---
doc: retrospective
---
<!--
  Milestone RETROSPECTIVE.md — distilled, carryable lessons from HOW execution went.
  One R<n> per lesson; append-only (never renumber). Reference refs, never restate them.
  Triaged from VERIFICATION Findings + the autonomous run's observations at aof:verify 40.
  (No STATE ## Feedback notes — the run had no blocker/stop; lessons are near-misses + one carry.)
-->
# 40 · Work-item versioning & the upgrade path — Retrospective

## R1 — A new stream-wide "every item must…" validation rule ripples to every scaffold path AND every "current item" fixture — budget for it
- **Kind:** near-miss · **Area:** framework/validation · **Stage:** build (story 03) · **Owner:** developer + architect · **Raised by:** aof-developer + aof-qa
- **What happened:** story 03 made `validateWork` flag any item whose `schema` is behind current. That single live rule instantly exposed that the born-stamp (story 01) covered ONLY the milestone/story templates — newly-scaffolded `uat`/`spike`/`chore` items and `migrate-folder`-scaffolded native docs were born at schema 0 → born stale-by-construction — and that ~17 hand-authored "well-formed current item" test fixtures across other milestones read schema 0 and tripped the new finding. The fix was legitimate and additive (complete the born-stamp on all templates + migrate-folder; stamp the fixtures to represent current items), reviewed PASS as honest (no fixture that was *testing* the unstamped/stale path was stamped), but it turned a 1-file staleness check into a ~30-file changeset.
- **Why:** a rule of the form "every item must carry X" is only as complete as the set of paths that CREATE an item and the set of fixtures that CLAIM to be a current item — both are larger than the story that introduces the rule.
- **Lesson:** when a story adds a stream-wide invariant, enumerate up front (a) every scaffold/creation path (bundle templates × ALL item types + `migrate-folder` + any other minter) and (b) every fixture that asserts validate-clean — and expect to touch all of them in the same story. Scope the story brief to the ripple, don't discover it at build.
- **Carry:** none — born-stamp is now complete across all five record-doc types + migrate-folder; guarded by story 03's live check on the whole stream (`aof work validate` green).
- **Refs:** VERIFICATION Story 03 evidence; `src/work.mjs` `validateWork`; `src/commands/insert-shared.mjs` `stampVersion`; `src/bundle/templates/{uat,spike,chore}/*`; `src/commands/migrate-folder.mjs`; ARCHITECTURE ADR-002.

## R2 — A byte-identity artifact needs BOTH a newline-clean CLI emit and a pinned line ending, or the drift guard is a Windows footgun
- **Kind:** near-miss · **Area:** tooling/cross-platform · **Stage:** build + verify (story 04) · **Owner:** developer · **Raised by:** aof-qa (F-40-04-1) + the developer (`.gitattributes`)
- **What happened:** story 04's changelog contract is "regenerate == committed, byte-for-byte." Two distinct byte-level hazards had to be closed for it to actually hold: (1) `aof upgrade --changelog` piped `renderChangelog()` (which ends in `\n`) through `console.log`, which appends its OWN `\n` — a doubled trailing newline that made `--changelog > UPGRADE-CHANGELOG.md` corrupt the artifact and turn the guard red (F-40-04-1, fixed: render strips the trailing newline; a regression test asserts CLI stdout === committed); (2) the generator always emits LF, so without `UPGRADE-CHANGELOG.md text eol=lf` in `.gitattributes`, a `core.autocrlf=true` Windows checkout would hand the committed file CRLF bytes the LF generator can never match.
- **Why:** "byte-for-byte" is only true if EVERY surface that produces or stores the bytes agrees on them — the API generator, the CLI emit wrapper, and git's checkout normalization are three such surfaces.
- **Lesson:** a regenerate-==-committed guard must be defended at all three: keep the generator deterministic (no volatile content — done), make the CLI emit path not add/duplicate the terminator, and pin the artifact's line ending in `.gitattributes`. This is the recurring line-ending hazard (carried forward from 22/R5, 01/R2 — a byte-identity guard always pins EOL).
- **Carry:** none — both closed and regression-tested within story 04.
- **Refs:** VERIFICATION Story 04 F-40-04-1; `src/commands/upgrade.mjs` (`render`); `src/work-upgrade.mjs` `renderChangelog`; `.gitattributes`; `test/work-upgrade-changelog.test.mjs`.

## R3 — Adding a new record KIND obliges updating every consumer that partitions records by kind — memory `status` was left counting only lessons+adrs
- **Kind:** near-miss (cross-milestone, discovered here) · **Area:** memory/accounting · **Stage:** verify (story 01) · **Owner:** milestone 39 / memory · **Raised by:** aof-developer + verified at source by the PO
- **What happened:** milestone 39 introduced `OUTCOME.md` "outcome" records but did not teach the memory `status` verb to count them — it still buckets only `lessons`/`adrs`/`summaries`. So `test/memory-integration.test.mjs`'s invariant `lessons + adrs == recordCount` now fails `363 !== 370` on the real stream (the 7 excess records are exactly m39's `OUTCOME.md` lines). Root-caused at the source; confirmed to have zero overlap with milestone 40's surface (F-40-01).
- **Why:** a new record kind is added at the producer side, but every partition-by-kind CONSUMER (the `status` split, an invariant that assumes the split is exhaustive) is a separate edit that is easy to miss.
- **Lesson:** when a milestone adds a record kind, grep every place that partitions records by kind (`status` counters, `lessons+adrs==recordCount`-style invariants) and extend them in the same change — an exhaustive-partition assertion silently rots the moment a third kind exists.
- **Carry:** a **follow-up** (milestone 39 / a memory chore) — add an `outcomes` bucket to the memory `status` result and update the integration invariant to `lessons + adrs + summaries + outcomes == recordCount`. Out of milestone 40's scope (m39's delivery memory); recorded so the red doesn't get mis-attributed to a later milestone.
- **Refs:** VERIFICATION Finding F-40-01; `test/memory-integration.test.mjs`; `src/work-memory.mjs` (`status`); milestone 39 (`OUTCOME.md`).

## R4 — An autonomous run sharing a working tree with a concurrent committer must commit by explicit pathspec, never `git add -A`
- **Kind:** near-miss · **Area:** process/git · **Stage:** throughout · **Owner:** the autonomous session · **Raised by:** the run itself
- **What happened:** throughout this run another session was actively committing unrelated mesh work (`mesh-join`/`mesh-relay`/`global-work-store` etc.) into the SAME branch — files appeared staged, then vanished (committed by the other session) between reads. A blanket `git add -A` would have swept that in-flight work into a milestone-40 commit (and once, the other session's commit swept in this run's `scripts/test.mjs` arch-test registrations). Handled by staging every commit with an explicit story-scoped pathspec list and verifying the staged set before committing.
- **Why:** a git working tree is shared mutable state; an autonomous agent is not the only writer.
- **Lesson:** in a shared tree, treat `git add -A`/`git commit -a` as unsafe — stage explicit, scoped pathspecs, verify the staged set (`git diff --cached --name-only`) before committing, and never revert an unrelated change you didn't create (surface it instead).
- **Carry:** none — a working-discipline lesson for autonomous runs.
- **Refs:** the run's commit history (per-story explicit-pathspec commits); the interleaved `fix(mesh): …` commits from the concurrent session.
