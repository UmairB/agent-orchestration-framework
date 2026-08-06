<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the ARTIFACT SET (STORY.md AC6–AC8, ADR-007): the four-name whitelist
# becomes a bounded TWO-KIND manifest in a new pure-leaf module (indicatively
# `src/work-artifacts.mjs`) — `{ name, file }` for exact filenames and `{ name, dir, ext }`
# for a bounded directory+extension set (`tasks/` + `.feature`) — with NO third kind and
# NO glob/regex language; `WORK_ITEM_DOC_FILES` is DERIVED from the manifest's
# `file`-kind entries and re-exported from `global-work-store.mjs` so every existing
# importer keeps working unchanged; and every artifact travels with a per-artifact
# content hash so an unchanged artifact is never re-sent.
# LITMUS: every Then is confirmable from an observable outcome — the CONTROL node's
# answer to `aof work doc <ref> <NAME> --json` and `aof work tasks <ref> --json` after a
# worker has streamed, the artifact rows' `updatedAt` stamps (an artifact NOT re-sent is
# observable as a stamp that did not move), and the artifact list a tick's frame carries.
# No source read: this task never asserts that the manifest is "one constant in one
# module" — that is a sameness property of the source and is already owned by
# `test/arch/acd-work-artifact-set-single-home.test.mjs`. What IS asserted here is the
# observable consequence of the single home: the streamed set and the requestable set
# answer identically, name for name.
#
# WHY THE `updatedAt` READ IS AVAILABLE: `upsertWorkItemContent` already stamps
# `node_id` + `updated_at` per (ref, doc) row and `readWorkItemDoc` already returns
# both, so "this artifact was not re-sent" has a real pre-existing black-box read.
#
# ONE CONTRACT THIS FILE ASSUMES AND FLAGS (raised at refine, needs PO/architect
# confirmation before build): the outcome for an artifact DELETED in the worktree. No
# ADR states it. The row below encodes the only reading consistent with ADR-006's
# settled never-evict rule — the last streamed body keeps answering and its stamp stops
# moving — because the alternative (deleting the row) would let a worktree cleanup
# destroy the mesh's only readable copy. If the architect settles it differently, that
# one row changes and nothing else in this file does.

@executable @cli @work @distribution
Feature: the artifact set is a bounded two-kind manifest whose widening rides the wire without growing the tick
  In order that every artifact a reader needs is readable on the control node while a remote agent is still writing it, and that "what can I ask for" stays answerable rather than becoming a pattern language
  the streamed and requestable sets must both derive from one bounded manifest of exact filenames plus one directory+extension entry, and each artifact must carry a content hash so an unchanged one is never sent again

  Background:
    Given a worker streaming an active worktree for item "43/03"
    And a control node whose own checkout holds only the pre-run scaffold for that item

  # HEADLINE (AC6, and the whole story's payoff) — this is the scenario that closes
  # `commands/tasks.mjs:15`'s "the features live in the worker's worktree and are not
  # streamed yet". The last Then is what makes it a real proof: the control's own disk
  # cannot possibly be the source of the answer.
  Scenario: a story's task features ride the wire and are readable on the control node during the run
    Given the worker's worktree holds `tasks/00_a.feature` and `tasks/01_b.feature` for "43/03"
    And the control node's checkout has no `tasks/` directory for "43/03"
    When the worker's stream tick runs
    Then `aof work tasks 43/03 --json` on the control node lists both feature files
    And each is listed with its scenarios and per-lane counts, as a local read would give
    And each answer is stamped with the worker that reported it
    And the control node's own checkout still has no `tasks/` directory for "43/03"

  # THE `file`-KIND ENTRIES (AC6). Each is requestable BY NAME — `work:doc`'s input
  # contract — and each rides the wire. The first four are today's whitelist and must
  # keep answering exactly as before (see the derivation guard below); the last four are
  # the widening SPEC asks for. An ADR log needs no separate entry: in this repo an ADR
  # log IS `ARCHITECTURE.md`.
  Scenario Outline: every exact-filename entry is both streamed and requestable by name
    Given the worker's worktree holds <file> for "43/03" or its milestone
    When the worker's stream tick runs
    Then `aof work doc 43/03 <name> --json` on the control node returns that file's current body
    And the answer is stamped with the worker that reported it
    And the request was accepted — no `invalid-doc` refusal for the name <name>

    Examples:
      | name          | file              |
      | SPEC          | SPEC.md           |
      | STORY         | STORY.md          |
      | VERIFICATION  | VERIFICATION.md   |
      | RETROSPECTIVE | RETROSPECTIVE.md  |
      | ARCHITECTURE  | ARCHITECTURE.md   |
      | DESIGN        | DESIGN.md         |
      | RESEARCH      | RESEARCH.md       |
      | STATE         | STATE.md          |

  # THE `dir`-KIND ENTRY (AC6): requested by name + MEMBER, never by pattern. A regex or
  # glob language is exactly how the streamed set and the requestable set would drift
  # apart, so the input contract stays "a name, and for a directory entry a member".
  # The traversal row is the one that matters most: a member is a bounded directory
  # entry, so a separator or a `..` in it is a refusal, never a read.
  Scenario Outline: the directory entry is requested by name plus member, and an out-of-contract request is refused, coded
    Given the worker has streamed `tasks/00_a.feature` for "43/03"
    When the control node requests <request>
    Then the outcome is <outcome>

    Examples:
      | request                                       | outcome                                                        |
      | the TASKS entry, member "00_a.feature"        | the current body of that feature file                          |
      | the TASKS entry, member "99_absent.feature"   | absent-not-error — present false, empty body, never a 404       |
      | the TASKS entry, member "../../STORY.md"      | a coded refusal — a member is a bounded directory entry         |
      | the TASKS entry, member "sub/deep.feature"    | a coded refusal — the entry is one directory, not a walk        |
      | the TASKS entry with no member                | a coded refusal — a directory entry is not requestable whole    |
      | the ARCHITECTURE entry with a member          | a coded refusal — an exact-filename entry takes no member       |
      | the name "NOTES" (in no manifest entry)       | a coded `invalid-doc` refusal — the set stays answerable        |

  # THE `dir`-KIND ENTRY IS BOUNDED BY EXTENSION (AC6). The directory is not a
  # free-for-all: only `.feature` members are in the set. This is what keeps the
  # widening's payload bounded and the requestable set enumerable.
  Scenario Outline: only .feature members of the tasks directory are streamed
    Given the worker's worktree holds <entry> inside "43/03"'s `tasks/` directory
    When the worker's stream tick runs
    Then that entry is <streamed> in the frame
    And `aof work tasks 43/03 --json` on the control node <listed>

    Examples:
      | entry                     | streamed | listed                      |
      | `00_a.feature`            | carried  | lists it                    |
      | `notes.md`                | absent   | does not list it            |
      | `00_a.feature.bak`        | absent   | does not list it            |
      | `.keep`                   | absent   | does not list it            |
      | `nested/deep.feature`     | absent   | does not list it            |
      | `00_A.FEATURE`            | absent   | does not list it            |

  # THE DERIVATION GUARD (AC7) — a regression scenario, not a new capability. The
  # widening must be purely additive: the four names existing importers already use keep
  # resolving to the same files with the same answers. "Never two literal lists" is the
  # structural claim (arch-test); THIS is its observable consequence.
  Scenario: the four pre-existing doc names keep answering exactly as they did before the widening
    Given the worker has streamed all eight record docs for "43/03"
    When the control node requests SPEC, STORY, VERIFICATION and RETROSPECTIVE in turn
    Then each returns the same file's body it returned before the widening
    And no previously-valid doc name became invalid
    And no previously-valid doc name now resolves to a different filename
    And a request for a name outside the manifest is still a coded `invalid-doc` refusal, not a silent empty answer

  # THE CONTENT HASH (AC8) — what makes the widening affordable and what keeps the
  # reconciliation backstop cheap enough to run forever. The mtime row is the sharp one:
  # the hash is over CONTENT, so a touched-but-unchanged file must not be re-sent; a
  # tick keyed on mtime would re-send the whole set after any checkout or archive
  # extraction.
  Scenario Outline: an unchanged artifact is never re-sent, and only a real content change moves its stamp
    Given the control node already holds all fourteen of "43/03"'s artifacts
    And <change> between the previous tick and this one
    When the stream tick runs once
    Then the frame carries <bodies> artifact body/bodies
    And <stamps>

    Examples:
      | change                                            | bodies | stamps                                                       |
      | nothing changed in the worktree                   | 0      | every artifact keeps the `updatedAt` it already had          |
      | one artifact's bytes changed                      | 1      | only that artifact's `updatedAt` moves                       |
      | one artifact was touched, its bytes unchanged     | 0      | every artifact keeps the `updatedAt` it already had          |
      | one artifact was edited and then reverted exactly | 0      | every artifact keeps the `updatedAt` it already had          |
      | a new `tasks/*.feature` file was added            | 1      | the new artifact gains a row; no existing stamp moves        |
      | one artifact was deleted from the worktree        | 0      | its last streamed body still answers, and its stamp stops moving |

  # THE WIDENING'S COST IS BOUNDED (AC8, stated as the operator-visible number). Without
  # the hash, widening from four files to eight-plus-every-feature-file multiplies the
  # per-tick payload by the size of the set; with it, the payload tracks what moved.
  Scenario: after the widening a steady-state tick carries no artifact bodies at all
    Given the control node already holds all fourteen of "43/03"'s artifacts
    And the worktree is untouched
    When three consecutive stream ticks run
    Then no artifact body is carried in any of the three frames
    And every one of the fourteen rows keeps the `updatedAt` it had before the three ticks
    And every one of the fourteen bodies is still readable on the control node

  # THE TWO SETS CANNOT DRIFT (AC6/AC7's real point, as an outcome). Whatever the
  # manifest holds, the same names answer on both sides — what a worker streams is
  # exactly what a face may ask for, with no name answerable on one side only.
  Scenario: every name the worker streams is a name the control node can request, and no other
    Given the worker's worktree holds every artifact in the manifest for "43/03"
    When the worker's stream tick runs
    Then every artifact the frame carries is requestable on the control node by its manifest name
    And every manifest name the control node requests is answered from what the frame carried
    And a name absent from the manifest is refused on the request side and absent from the frame
