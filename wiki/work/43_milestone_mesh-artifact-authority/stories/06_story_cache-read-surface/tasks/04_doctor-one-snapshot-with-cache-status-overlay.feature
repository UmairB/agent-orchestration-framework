<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-005's doctor clause, the subtlest thing in the story and the one
# RESEARCH §5.5 could not settle by measurement. `work-doctor` does NOT simply move.
# `doctorWork` still builds its snapshot ONCE from disk (folder identity, frontmatter,
# orphans, folder mtime) and its pure `(snapshot, ctx) => Finding[]` group architecture
# is untouched; before the groups run, the BUILDER overlays cache-authoritative STATUS
# onto each row, stamping `statusFrom: "cache" | "disk"`. `statusCoherenceGroup` and
# `lifecycleCompletenessGroup` then read the authoritative status without changing
# their source OR their signature (both take `(snapshot)` today and must keep taking
# it). `freshnessGroup` stays disk-only and explicitly so — it is a folder-mtime probe
# with no cache equivalent.
#
# WAVE 3 (ADR-009) — presupposes 43/02 (an authoritative cache) and 43/04 (`node_id`
# on every row: `node_id` is the ONLY thing that distinguishes a false finding from a
# real one below, so without 43/04 the decisive pair cannot be told apart at all).
#
# LITMUS — and its one honest limit. Every Then below is confirmable from
# `aof work doctor --json`: the PRESENCE or ABSENCE of a finding by `code`, its
# `severity`, its `path`, and its `message`. That is the whole channel; a Finding is
# `{ code, severity, path, message }` and nothing else. `statusFrom` is an INTERNAL
# snapshot stamp with NO black-box channel — it is therefore verified only through its
# consequences (which findings appear), and its existence is the arch-test's business,
# not a Gherkin Then. Where a scenario needs to know WHICH SIDE the authoritative
# status came from, it reads the finding's MESSAGE, which is a required contract:
# see the residual concern below.
#
# RESIDUAL CONCERN (1) to the PO/developer — a REQUIRED MESSAGE CONTRACT for black-box
# verifiability. A divergence finding must NAME the node that last reported the
# authoritative status ("… last reported by aof-wsl"). Without it there is no
# observable difference between the two cases ADR-005 says `node_id` distinguishes,
# and the decisive pair below cannot be asserted at all. This is the same device
# 41/02's task 01 used for `insert-uat`'s `depends` echo.
#
# RESIDUAL CONCERN (2) to the ARCHITECT — a NEW FALSE-FINDING CLASS the overlay
# CREATES, which ADR-005 does not settle. `lifecycleCompletenessGroup` reads
# `status` × `item.docs[…]` × `children` — and the overlay makes the STATUS
# cache-authoritative while the DOCS and CHILDREN maps stay DISK-derived. For a
# worker-authored milestone the control disk holds no VERIFICATION.md, no
# RETROSPECTIVE.md and an empty `stories/`, so the moment the overlay reports it
# `done` the group fires `missing-verification` + `missing-retrospective` +
# `milestone-no-stories` against EVERY remote milestone — precisely the noise the
# overlay exists to prevent, one group over. Two candidate cures, both the
# architect's call, neither QA's: (a) overlay the doc-presence and children maps from
# the cache too (43/03 streams exactly those artifacts, so the data is there), or
# (b) gate the lifecycle findings on `statusFrom === "disk"`. The scenario below
# asserts the OUTCOME — no false lifecycle finding — so it is green either way and
# red if neither is done.
#
# RESIDUAL CONCERN (3) to the PO — an ACCEPTED noise consequence, recorded so it is
# not later mistaken for a defect. Because `freshnessGroup` stays disk-only by
# decision, a worker-authored item WILL keep drawing `stale-updated` against the
# control's disk copy. That finding is TRUE — the control's disk really is stale —
# but the operator will read it beside a row the cache calls fresh. ADR-005 chose
# this deliberately; it is asserted below so the choice stays visible.

@executable @cli @work @validate @distribution
Feature: work-doctor keeps one disk snapshot and overlays cache-authoritative status, so a remote item draws no false finding and a real divergence still does
  In order that migrating the readers onto the cache makes doctor MORE truthful rather than turning it into noise against every item a worker touched
  the snapshot builder must overlay the cache's authoritative status onto each disk row before the pure groups run, leaving the structural and freshness lanes reading the disk they are about

  Background:
    Given a control node whose work directory holds milestones "05", "06" and "07"
    And "07" on the control's disk is the pre-run SCAFFOLD — status "in-progress", an empty `stories/`, no VERIFICATION.md, no RETROSPECTIVE.md — with `depends: [06]`
    And the cache holds "06" at status "done" and "07" at status "in-progress", both last reported by the REMOTE node "aof-wsl"
    And the control's own disk still reads "06" as "in-progress", because the control never did that work
    And doctor is run with an injected `now`, so the findings are deterministic

  # THE DECISIVE NEGATIVE — the case that makes doctor's overlay necessary rather than
  # optional. Today a disk-status doctor reads "06" as in-progress and reports "07" as
  # working ahead of an unmet dependency. That is FALSE: the worker finished "06". The
  # overlay is the only thing that stops this firing against every remote driver.
  Scenario: a driver whose dependency was completed by a worker draws no false depends-blocked finding
    When I run `aof work doctor --json`
    Then no finding with code "depends-blocked-in-progress" is reported for "07"
    And the run reports no error-severity finding for "07" at all

  # THE OVERLAY IS APPLIED TO EVERY ROW, not to some. A parent judged from the cache
  # against children still judged from disk would MANUFACTURE a `lying-parent` — the
  # exact opposite of the intent. This is the scenario that catches a half-applied
  # overlay, which is otherwise invisible.
  Scenario: a milestone and its stories are judged on the same side, so a half-applied overlay cannot manufacture a lying parent
    Given the control's disk holds "05" at status "not-started" with child stories "05/00" and "05/01", both "not-started"
    And the cache holds "05" at "done" and both its stories at "done", all last reported by "aof-wsl"
    When I run `aof work doctor --json`
    Then no finding with code "lying-parent" is reported for "05"
    And no finding with code "story-done-under-not-started" is reported for "05/00" or "05/01"
    And no finding with code "stale-parent" is reported for "05"

  # THE DECISIVE POSITIVE — the other half of the pair, and the one `node_id`
  # distinguishes. When the ref's authoritative status was last reported by THIS
  # control node, a disagreement between its own disk and its own last report is a
  # REAL fault (something wrote the disk without publishing, or the publish is
  # broken). It must stay a finding, and the message must name the reporting node so
  # the operator can tell the two cases apart.
  Scenario: a divergence on a ref the control itself last reported remains a real finding, naming the reporting node
    Given the cache holds "05" at status "in-progress", last reported by THIS control node
    And the control's own disk reads "05" as "done"
    When I run `aof work doctor --json`
    Then a divergence finding is reported for "05"
    And its message names this control node as the side that last reported the authoritative status
    And its `path` is the real on-disk anchor for "05"

  # …and the same disagreement, differing only in WHO last reported it, is silent.
  # This pair IS the story: identical disk, identical cache values, opposite verdicts,
  # decided by `node_id` alone.
  Scenario: the identical disagreement is silent when a REMOTE node last reported it
    Given the cache holds "05" at status "in-progress", last reported by the REMOTE node "aof-wsl"
    And the control's own disk reads "05" as "done"
    When I run `aof work doctor --json`
    Then no divergence finding is reported for "05"
    And the status-coherence lane judges "05" as "in-progress", the cache's value

  # RESIDUAL CONCERN (2), decided as a scenario: the overlay must not turn the
  # lifecycle lane into noise against every remote milestone. The control's disk holds
  # none of the close-convention artifacts for a worker-authored milestone, because the
  # worker wrote them in its own worktree and streamed them into the cache.
  Scenario: a worker-authored milestone reported done draws no false lifecycle-completeness finding
    Given the cache holds "07" at status "done", last reported by "aof-wsl", carrying its VERIFICATION.md, RETROSPECTIVE.md and two child stories
    And the control's disk holds only the scaffold for "07" — an empty `stories/`, no VERIFICATION.md, no RETROSPECTIVE.md
    When I run `aof work doctor --json`
    Then no finding with code "missing-verification" is reported for "07"
    And no finding with code "missing-retrospective" is reported for "07"
    And no finding with code "milestone-no-stories" is reported for "07"
    And no finding with code "started-story-no-tasks" is reported for any of "07"'s worker-authored stories

  # …and the same lane is NOT switched off: a milestone THIS node authored and marked
  # done on its own disk, with no VERIFICATION.md, still draws its finding. The cure
  # for the false positives must not be "stop checking".
  Scenario: a locally-authored done milestone with no VERIFICATION.md still draws its lifecycle finding
    Given the control's disk holds "06" at status "done" with no non-empty VERIFICATION.md
    And the cache's row for "06" was last reported by THIS control node, also at "done"
    When I run `aof work doctor --json`
    Then a finding with code "missing-verification" is reported for "06"
    And a finding with code "missing-retrospective" is reported for "06"

  # QA case matrix — every check-group by name, against the SAME fixture, saying which
  # side its input comes from. This is the group-by-group contract ADR-005 draws, in
  # its only observable form: which finding appears and which does not.
  Scenario Outline: each check-group reads the side ADR-005 assigns it
    Given the fixture above, in which the cache and the control's disk disagree about "07"
    When I run `aof work doctor --json`
    Then <expectation>

    Examples: the six groups doctorWork's registry runs over the one snapshot
      | group                    | input side               | expectation                                                                             |
      | statusCoherence          | status: CACHE            | "07" is judged on the cache's status, so no false "depends-blocked-in-progress" appears  |
      | lifecycleCompleteness    | status: CACHE            | a worker-reported "done" draws no "missing-verification"/"missing-retrospective"          |
      | freshness                | DISK only, explicitly    | "07"'s disk `updated` past the stale window still draws "stale-updated"                  |
      | structuralIntegrity      | DISK only                | a cache-only ref draws no "numbering-gap", and a real on-disk gap still draws one         |
      | budget                   | DISK only                | the doc line counts are the control disk's files, unchanged by anything cached            |
      | meshIdentityCommitted    | config, unchanged        | its finding set is byte-identical to before the overlay landed                            |

  # RESIDUAL CONCERN (3), asserted so the accepted consequence stays visible:
  # freshness is a folder-mtime + frontmatter-`updated` probe over THIS node's disk and
  # has no cache equivalent. A fresh `syncedAt` must not silence it, because the
  # statement it makes ("this node's copy is old") is TRUE.
  Scenario: a fresh cache row does not silence the disk freshness lane
    Given the cache's row for "07" carries a `syncedAt` seconds old
    And the control disk's "07" frontmatter `updated` is far past the configured stale window
    When I run `aof work doctor --json`
    Then a finding with code "stale-updated" is reported for "07"
    And its `path` is the control disk's own record doc for "07"

  # Doctor's SUBJECT is the disk, so a ref that exists only in the cache is not in the
  # snapshot at all — it draws no finding, and above all no finding carrying a path to
  # a folder that is not there. This is what keeps the overlay a status overlay rather
  # than a second item source.
  Scenario: a ref that exists only in the cache is not doctored, and no finding names a path that does not exist
    Given the cache holds a row for "09/02" that has no folder anywhere on the control node's disk
    When I run `aof work doctor --json`
    Then no finding is reported for "09/02"
    And every reported finding's `path` names a file or directory that exists on this node

  # The structural lane is unmoved in both directions: the cache neither invents a gap
  # nor fills one. Its subject is the folder names on this disk.
  Scenario: the structural lane sees the disk's folders alone
    Given the control's disk holds top-level items "00", "01" and "03", leaving a real numbering gap at "02"
    And the cache holds rows for "02" and for "07", neither of which has a folder on this disk
    When I run `aof work doctor --json`
    Then a finding with code "numbering-gap" is reported for the gap at "02"
    And no finding with code "numbering-gap" is reported for "07"

  # Doctor's determinism contract (its own ADR-003 fitness function) survives the
  # overlay: same fixture, same injected `now`, byte-identical findings. A builder that
  # read the cache per group instead of once would be visible here as a flapping run.
  Scenario: the findings stay deterministic and scope-filterable after the overlay
    When I run `aof work doctor --json` twice against an unchanged fixture with the same injected `now`
    Then the two documents are byte-identical
    And a fresh `aof work doctor 07 --json` reports exactly the findings the unscoped run reported for "07", and no others
