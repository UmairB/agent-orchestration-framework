<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-005 STAGE 1: `src/commands/resolve.mjs` moves onto the seam.
# ONE edit; the graph's eight dependents — `continue`, `doc`, `feedback`,
# `run-complete`, `run-retry`, `run-start`, `run-status`, `tasks` — all migrate
# behind it. resolve.mjs imports only `work.mjs`, so this is the milestone's single
# largest behavioural change and it is one file.
#
# THE HEADLINE OUTCOME LIVES HERE, in its stage-1 half: a work item authored by a
# REMOTE worker reads correctly on the control node AFTER the worker's worktree has
# been deleted, when the control's own disk holds only the stale pre-run scaffold.
# That is the case that fails today. Three of the six surfaces rule 3 names —
# `doc`, `tasks`, `run-status` — resolve through this chokepoint and are proven here;
# the other three (`next`, `find`, `list`) are stage-2 LEAVES and are proven in
# task 02; the whole six-surface end state on a real two-machine mesh is task 05.
# The split is deliberate: staging is only worth having if each stage is separately
# observable.
#
# WAVE 3 (ADR-009) — presupposes 43/02 (the cache is authoritative; a remote-authored
# row is not clobbered by the control's republish tick) and 43/04 (rows carry
# `syncedAt` + `reportedBy`). Every "reported by aof-wsl" Then depends on 43/04.
#
# LITMUS: every Then is confirmable from a command's `--json` document — the resolved
# ref, the answering side stamped on the answer, the body returned, a coded failure
# and its exit — or from the control node's on-disk tree being unchanged. No source
# read. `answeredFrom` is INDICATIVE (see task 00); the stable requirement is that a
# read command's `--json` says which side answered, alongside the `fromWorker` /
# `reportedBy` markers `doc.mjs`/`run-status.mjs` already emit today.
#
# RESIDUAL CONCERNS to the PO/architect, both surfaced by this stage and NOT settled
# by ADR-005 — each is written below as the scenario that decides it either way:
#   (1) THE REACH-THROUGH. A cache-answered row's `dir` names a folder that does not
#       exist on this node. `tasks.mjs` today answers `{ tasks: [], fromWorker: true }`
#       for an UNRESOLVED streamed ref; once resolve.mjs resolves it from the cache,
#       the readdir simply ENOENTs and the honest "this came from the worker" marker
#       is lost. A silent empty list is a regression dressed as a pass.
#   (2) THE WRITE DOORS. `feedback` appends to a record doc and `run-start` mints a
#       run record, both under `item.dir`. Resolving a cache-only ref hands them a
#       path that is not there. The contract asserted below is REFUSE-CODED-AND-WRITE-
#       NOTHING; if the PO wants scaffold-on-demand instead, this is the scenario to
#       change, and it should be changed here rather than discovered in production.

@executable @cli @work @distribution
Feature: commands/resolve.mjs answers from the cache, and its eight dependents migrate behind that one edit
  In order that the milestone's promise holds at the surface the operator actually touches — an item worked on another machine still reads here after that machine has moved on
  the shared ref resolver must answer from the cache first, so `continue`, `doc`, `feedback`, `run-complete`, `run-retry`, `run-start`, `run-status` and `tasks` all resolve a remote-authored ref without one of them being edited

  Background:
    Given a control node whose cache holds milestone "07" and its story "07/01", both last reported by the REMOTE node "aof-wsl"
    And in the cache "07/01" is status "done", carrying its STORY.md and VERIFICATION.md bodies and its `tasks/*.feature` files
    And the control node's own disk holds only the pre-run scaffold for "07" (status "not-started") and NO folder at all for "07/01"
    And the worker's worktree has been deleted, so no further worker tick will ever correct the control's disk
    And no assignment is active over "07" or "07/01" (a gate)

  # THE HEADLINE — the case that fails today. Every one of these reads currently
  # dead-ends on `ref-not-found` or answers from the stale scaffold; after the
  # chokepoint moves they answer with the worker's own view and say whose view it is.
  Scenario: a story authored entirely by a remote worker, whose worktree is gone, reads correctly on the control node
    When I run `aof work doc 07/01 STORY --json`
    Then the command exits 0
    And the document reports `present` true with the worker's STORY.md body verbatim
    And the document reports it was answered from the cache, naming "aof-wsl" as the reporting node
    And a fresh `aof work run-status 07/01 --json` reports the worker's run rows, naming "aof-wsl"
    And a fresh `aof work tasks 07/01 --json` reports the worker's task features, not an empty list
    And a fresh `aof work doc 07 SPEC --json` reports the worker's SPEC.md body, not the control's stale scaffold

  # QA matrix, half one — the READ dependents. Each resolves the remote-authored ref
  # through the one migrated resolver, and each answer says which side produced it.
  # These are the three surfaces of rule 3's headline that sit on this chokepoint.
  Scenario Outline: each READ dependent resolves the remote-authored ref and reports the cache as the answering side
    When I run <invocation>
    Then the command exits 0
    And the answer reports the resolved ref "07/01"
    And the answer reports `answeredFrom` "cache", naming "aof-wsl" as the reporting node
    And <content assertion>

    Examples: the read commands that sit on resolve.mjs
      | command    | invocation                          | content assertion                                            |
      | doc        | `aof work doc 07/01 STORY --json`   | the body is the worker's STORY.md, byte-for-byte             |
      | doc        | `aof work doc 07/01 VERIFICATION --json` | the body is the worker's VERIFICATION.md, byte-for-byte |
      | tasks      | `aof work tasks 07/01 --json`       | the parsed features are the worker's, with their scenario counts |
      | run-status | `aof work run-status 07/01 --json`  | the run rows are the worker's, in their settled state        |

  # QA matrix, half two — the WRITE / DISPATCH dependents. The migration's obligation
  # for these is narrower and must be stated narrowly: RESOLUTION succeeds (they no
  # longer fail `ref-not-found` for an item this node never held), and each command's
  # own contract then applies unchanged. Asserting more than resolution here would be
  # restating another story's outcome.
  Scenario Outline: each WRITE or DISPATCH dependent resolves the remote-authored ref instead of failing ref-not-found
    Given the control node's disk holds a folder for "07" but the cache is the only side that knows "07/01"
    When I run <invocation>
    Then the command does NOT fail with code "ref-not-found"
    And the command's `--json` document echoes the resolved ref "07/01"

    Examples: the write / dispatch commands that sit on resolve.mjs
      | command      | invocation                                                       |
      | continue     | `aof work continue 07/01 --json`                                 |
      | feedback     | `aof work feedback 07/01 --note "spec was thin" --actor qa --json` |
      | run-start    | `aof work run-start 07/01 --json`                                |
      | run-retry    | `aof work run-retry 07/01 --json`                                |
      | run-complete | `aof work run-complete 07/01 --outcome done --json`              |

  # RESIDUAL CONCERN (2), decided as a scenario: a cache-answered row's `dir` is not on
  # this node. A command that writes THROUGH that dir must refuse loudly and leave the
  # disk untouched — never fabricate a folder, never write to a path nobody authored.
  # The indicative code `item-not-on-this-checkout` is the developer amigo's to name;
  # what is NOT negotiable is that it is coded, non-zero, and writes nothing.
  Scenario Outline: a write command against a ref the cache alone knows refuses with a code and writes nothing
    Given "07/01" has no folder on the control node's disk
    When I run <invocation>
    Then the command exits non-zero with a coded error naming the absent local checkout
    And no folder is created anywhere under the control node's work directory
    And a fresh `aof work validate --json` over the control's stream reports zero new findings

    Examples: the two doors that write through `item.dir`
      | command   | invocation                                                        |
      | feedback  | `aof work feedback 07/01 --note "spec was thin" --actor qa --json` |
      | run-start | `aof work run-start 07/01 --json`                                 |

  # RESIDUAL CONCERN (1), decided as a scenario: a resolve that now SUCCEEDS must not
  # turn tasks.mjs's honest "this came from the worker, and its features are not here"
  # into a silent empty list. Either the features come from the cache (43/03 streams
  # `tasks/*.feature`) or the answer says the local folder is absent — never `[]`
  # presented as if the story genuinely had no tasks.
  Scenario: a resolved ref whose folder is absent locally never degrades to a silent empty answer
    Given "07/01" resolves from the cache and has no folder on the control node's disk
    When I run `aof work tasks 07/01 --json`
    Then the command exits 0
    And the answer is NOT an unmarked empty `tasks` list
    And the answer either carries the worker's streamed task features or reports explicitly that the local checkout holds none, naming "aof-wsl" as the side that does

  # ADR-003's load-bearing read-vs-write resolver distinction (resolve.mjs's own
  # header) must survive the migration untouched: the READ resolver may slug-match
  # free text, the WRITE resolver may not — otherwise a typo'd ref appends the bullet
  # to the wrong item. Migrating the SOURCE of the rows must not migrate the RULE.
  Scenario: the exact-vs-slug distinction survives the migration in both directions
    Given the cache holds a remote-authored story "07/01" with slug "cache-read-surface"
    When I run `aof work doc cache-read --json`
    Then the command resolves "07/01" by slug and returns its STORY.md
    And a fresh `aof work feedback cache-read --note "n" --actor qa --json` fails with code "ref-not-found"
    And a fresh `aof work feedback 07/0 --note "n" --actor qa --json` fails with code "ref-not-found"

  # A ref the cache does not know still resolves from disk through the same resolver —
  # the chokepoint inherits the seam's fallback whole, and says which side answered.
  Scenario: a disk-only ref still resolves through the migrated chokepoint, reported as a disk answer
    Given the control node's disk holds a milestone "06" that the cache has no row for
    When I run `aof work doc 06 SPEC --json`
    Then the command exits 0
    And the body is the control disk's SPEC.md
    And the answer reports `answeredFrom` "disk"
    And the answer carries no fabricated `syncedAt`

  # STAGING IS OBSERVABLE, and this is its single-build proof: at stage 1 exactly the
  # eight dependents have moved. The stage-2 leaves have NOT, so the same remote ref
  # that `doc` now answers is still invisible to `find`, `list` and `next`. If this
  # scenario is green, the blast radius of the chokepoint edit is exactly its eight
  # dependents — which is what makes reverting it one edit.
  Scenario: at stage 1 the leaves have not moved — the chokepoint carried eight commands and nothing else
    When I run `aof work doc 07/01 STORY --json`
    Then the command exits 0 and answers from the cache
    And a fresh `aof work find 07/01 --json` still reports the empty set
    And a fresh `aof work list --json` still lists only the control disk's items
    And a fresh `aof work next --json` still never offers "07/01"
    And a fresh `aof work validate --json` reports exactly the findings it reported before the chokepoint moved
