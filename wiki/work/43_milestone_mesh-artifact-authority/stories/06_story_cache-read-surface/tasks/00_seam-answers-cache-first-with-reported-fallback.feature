<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-005 STAGE 0: the cache-first read seam EXISTS and is proven
# against a fixture, with NO call site moved. Zero blast radius. The seam exposes
# cache-first equivalents of work.mjs's four disk readers (`listItems` / `findWork`
# / `nextWork` / `listStream`), each returning rows stamped with provenance, each
# falling back to disk EXPLICITLY when the cache cannot answer.
#
# WAVE 3 (ADR-009) — this story is last on purpose. Every scenario below presupposes
# 43/02 (`work_items` is an upserted, provenance-stamped FACT, so a remote-authored
# row survives the control's publish tick) and 43/04 (rows carry `syncedAt` +
# `reportedBy` on the wire). Against a pre-43/02 cache these scenarios are not merely
# red, they are MEANINGLESS — the control tick would clobber the fixture between the
# Given and the When.
#
# INDICATIVE NAMES (ADR-005 marks them so): the module `src/work-read.mjs`; the
# per-row "which side answered" field `answeredFrom`. The STABLE requirement is that
# the field exists on every returned row in `--json`/API form and takes exactly two
# values, "cache" and "disk" — the name is the developer amigo's to settle.
#
# LITMUS: the seam has NO command surface at stage 0 (the m41 story-01 precedent —
# an engine with no CLI is called directly via its API and the OUTCOME is read back).
# So every Then here is confirmable from either (a) the seam call's own returned rows
# — their `answeredFrom` / `reportedBy` / `syncedAt` fields — or (b) a fresh
# `aof work find|list|next --json` read, which is the INDEPENDENT channel proving the
# zero-blast-radius half: those commands have NOT migrated at stage 0 and must answer
# exactly as they did before the seam existed. No source read anywhere.
#
# RESIDUAL CONCERN to the PO/developer (a required contract for black-box
# verifiability): the "explicit, reported degrade" of ADR-005 needs a READABLE
# channel. `reportDegrade` writes one coded JSONL line into the `degrade` sink
# (src/degrade.mjs), but `aof mesh logs` only admits procs "mesh-serve"/"mesh-ui"
# (mesh-logs.mjs KNOWN_PROCS) — so a degrade event is not readable through any verb
# today. These scenarios assert the sink's JSONL entries directly (an artefact the
# system wrote, not source); making `aof mesh logs degrade` readable would be the
# one-line way to make the report operator-visible.

@executable @cli @work @distribution
Feature: the cache-first read seam answers from the cache, degrades to disk explicitly, and moves no call site
  In order that the readers can migrate onto the cache one reviewable stage at a time instead of in one big bang
  the new seam must answer cache-first with per-row provenance, fall back to disk as a reported degrade rather than a silent one, and change the answer of nothing that has not yet been wired to it

  Background:
    Given a fixture control-node workspace whose own disk holds milestones "00" and "01" only
    And a cache holding a row for "02" last reported by the REMOTE node "aof-wsl", with a `syncedAt` and status "in-progress"
    And the cache also holds a row for "01" last reported by this control node, matching its disk
    And no assignment is active over any of those refs (a gate — 43/01's lock is not in play)

  # Headline (stage 0): the seam answers a ref this node's disk has NEVER held. This is
  # the fact the whole milestone turns on, proven at the seam before any caller moves.
  # Each of the four readers is exercised, because the migration replaces all four.
  Scenario Outline: each seam reader answers a cache-known ref the control's disk has never seen, stamped with its author
    When the seam's <reader> is called against the fixture workspace
    Then the result includes a row for ref "02"
    And that row reports `answeredFrom` "cache"
    And that row reports `reportedBy` "aof-wsl"
    And that row carries the `syncedAt` the cache holds for it, unmodified
    And a fresh `aof work find 02 --json` still resolves nothing (no call site has moved at stage 0)

    Examples: the four readers work.mjs owns, each getting a cache-first equivalent
      | reader              |
      | listItems-equivalent  |
      | findWork-equivalent   |
      | nextWork-equivalent   |
      | listStream-equivalent |

  # Cache-FIRST, not cache-only, and the two sides never blend: when a ref exists on
  # BOTH sides the cache's row is the answer, and the row still says so.
  Scenario: a ref held by both sides is answered from the cache, and says so
    Given the cache's row for "01" carries status "done" while the control's disk frontmatter for "01" reads "in-progress"
    When the seam's findWork-equivalent is called for ref "01"
    Then the returned row reports status "done"
    And the returned row reports `answeredFrom` "cache"
    And the returned row reports `reportedBy` as this control node

  # The FALLBACK is a designed path and is proven in both directions. A ref the cache
  # has no row for is answered from disk — and the row SAYS "disk", so no reader can
  # mistake a degrade for an authoritative answer. No timestamp is fabricated: an
  # absent `syncedAt` is DESIGN's `unknown`, never a made-up freshness.
  Scenario: a ref the cache has no row for falls back to disk, and the row reports the fallback
    When the seam's findWork-equivalent is called for ref "00"
    Then the returned row is the control disk's row for "00"
    And the returned row reports `answeredFrom` "disk"
    And the returned row carries NO `syncedAt` (an unobserved freshness is never fabricated)
    And the durable degrade sink has gained one coded entry naming the cache miss and the ref

  # QA case matrix — the store's states, including the two that must NEVER stop the
  # node answering: a workspace that has never published, and a torn store. Every row
  # answers, every row is reported, and nothing exits non-zero: a read seam that could
  # refuse to answer would be strictly worse than the disk reader it replaces.
  Scenario Outline: whatever state the cache is in, the seam still answers, and always says which side answered
    Given the control node's cache is <store state>
    When the seam's listItems-equivalent is called against the fixture workspace
    Then the call succeeds
    And the rows it returns are <rows>
    And every returned row reports `answeredFrom` <answered from>
    And the durable degrade sink <degrade> a coded entry for this read

    Examples: the store states a control node genuinely reaches
      | store state                                     | rows                                | answered from | degrade     |
      | present, holding the "02" row                   | the disk's "00"/"01" plus cache "02" | as per row    | has gained  |
      | absent — a fresh workspace that never published | the disk's "00" and "01" only        | "disk"        | has gained  |
      | present but holding no row for this workspace   | the disk's "00" and "01" only        | "disk"        | has gained  |
      | present but TORN / unreadable                   | the disk's "00" and "01" only        | "disk"        | has gained  |

  # The degrade is reported ONCE per class, not per row — `reportDegrade` throttles by
  # code, and a hot read loop must not turn the sink into the noise it exists to replace.
  Scenario: a read that falls back for many refs reports the degrade as one coded class, not once per row
    Given the control node's cache is absent
    When the seam's listStream-equivalent is called against a fixture holding twelve items
    Then all twelve rows are returned, each reporting `answeredFrom` "disk"
    And the durable degrade sink holds ONE coded entry for that read, not twelve

  # ZERO BLAST RADIUS — the whole point of stage 0, and the thing that makes the stages
  # revertible. The seam exists, the cache holds a row the disk does not, and every
  # unmigrated reader answers EXACTLY as it did before the seam was written.
  Scenario: with the seam present and no call site moved, every existing reader answers exactly as before
    When I run `aof work list --json`
    Then the listed rows are the control disk's "00" and "01" alone
    And no listed row carries an `answeredFrom`, a `reportedBy`, or a `syncedAt` field
    And a fresh `aof work find 02 --json` reports the empty set and exits 0
    And a fresh `aof work next --json` never offers "02"
    And a fresh `aof work doc 02 SPEC --json` fails with code "ref-not-found"

  # The dependency direction, in its only observable form (ADR-005: work.mjs must never
  # import work-read.mjs, and gains no export). Called directly, the disk readers still
  # return the disk and nothing else — no cache row leaks down into the god-node, and
  # no provenance field appears on a disk-reader row. The SOURCE fact belongs to
  # `acd-cache-read-surface-boundary`; this is its behavioural shadow.
  Scenario: work.mjs's disk readers are unchanged — they see the disk only, cache or no cache
    Given the cache holds the "02" row and a status for "01" that differs from disk
    When work.mjs's `listItems` is called directly against the fixture workspace
    Then the returned items are exactly the disk's "00" and "01"
    And no returned item carries an `answeredFrom`, a `reportedBy`, or a `syncedAt` field
    And work.mjs's `findWork` called directly for "01" reports the DISK's status, not the cache's
