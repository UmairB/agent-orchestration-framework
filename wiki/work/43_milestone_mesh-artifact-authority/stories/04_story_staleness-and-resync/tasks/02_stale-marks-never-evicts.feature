<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — what the window actually DOES: it MARKS. The shared strict-`>` predicate
# decides freshness for two subjects (the row and each artifact), a missing instant yields
# `unknown` rather than `stale`, and no row is ever removed because it got old — the only
# sanctioned removal in the whole cache is ADR-004's author retraction, predicated on
# authorship and ref-set membership.
# LITMUS: every Then is confirmable from a value the server-side read boundary RETURNS for
# a planted store state at an INJECTED `now` — the freshness verdict on a serialised row,
# the verdict on a serialised artifact, and the row's own content read back after the fact.
# No source read, no wall clock: `now` is injected (the 22/R2 discipline the shared
# predicate already keeps), which is the only way a boundary case is a test rather than a
# race.
#
# WHY THE BOUNDARY IS THE WHOLE TASK. The predicate is strict `>` — `now − syncedAt >
# window` — so a record EXACTLY AT the window is still FRESH (`60 > 60` is false). That is
# not a detail: DESIGN requires the badge to be recomputed in the BROWSER against a live
# 1-second tick, so the predicate genuinely runs on two sides of the wire and the two must
# agree at the threshold instant or the board and the server will disagree about the same
# row for one tick. Task 03 asserts the client half against these same three points.
#
# NOT IN THIS FILE, DELIBERATELY. "There is exactly one staleness predicate / one threshold"
# is a SAMENESS property a scenario can only ever sample at one instant, and the never-evict
# RATCHET ("no time-predicated DELETE exists anywhere") is an ABSENCE. Both live in
# `test/arch/acd-cache-staleness-single-predicate.test.mjs` (green). What IS a scenario, and
# is below, is the OBSERVABLE consequence: an ancient row is still there and still readable.

@executable @cli @work @distribution
Feature: a cached row past the staleness window is MARKED stale and stays readable forever — the strict-`>` predicate judges the row and each artifact separately, an unknown instant is never called stale, and nothing is ever deleted for being old
  In order that a TTL can never destroy the mesh's only readable copy — after settle the artifacts exist in exactly two places,
  the pushed branch and this cache, and this milestone deliberately does not read git
  the read boundary applies the shared strict-`>` staleness predicate to the row's own `syncedAt` and to each artifact's own,
  reports `unknown` where there is no instant to judge, and removes rows only when their AUTHOR retracts them

  Background:
    Given an isolated global mesh home with a mesh-enabled workspace whose rows are published into the cache
    And the cache staleness window is configured as 300 seconds
    And the read boundary is evaluated at an injected `now`, never against the wall clock

  # HEADLINE (AC 4) — the ROW grain, at the boundary. Strict `>` means EXACTLY AT the
  # window is still fresh; one second later it is stale.
  Scenario Outline: the ROW's freshness is decided by strict `>` — at the window it is still fresh, past it it is stale
    Given the row for "43/04" was reported by "umairs-mac-mini" with a `syncedAt` of <age> seconds before `now`
    When the row is served from the cache at that `now`
    Then its freshness state is <state>
    And the row is present in the response regardless of the verdict

    Examples:
      | case                  | age | state   |
      | brand new             | 0   | fresh   |
      | well inside           | 120 | fresh   |
      | one second under      | 299 | fresh   |
      | EXACTLY at the window | 300 | fresh   |
      | one second over       | 301 | stale   |
      | far past              | 86400 | stale |
    # "EXACTLY at the window" is the row this whole file exists for. A `>=` implementation
    # passes every other row here and fails only this one — which is precisely the instant
    # the browser-side predicate (task 03) has to agree with.

  # AC 6 — the ARTIFACT grain. One predicate, two subjects, judged independently. DESIGN
  # names the case that matters: a doc can be older than the row that names it.
  Scenario Outline: each ARTIFACT is judged on its OWN `syncedAt`, independently of the row that names it
    Given the row for "43/04" has a `syncedAt` of <row age> seconds before `now`
    And its cached "SPEC" doc has a `syncedAt` of <doc age> seconds before `now`
    When the item and its doc are served from the cache at that `now`
    Then the row's freshness state is <row state>
    And the doc's freshness state is <doc state>
    And neither verdict was inherited from the other

    Examples:
      | case                                    | row age | doc age | row state | doc state |
      | both fresh                              | 60      | 60      | fresh     | fresh     |
      | a doc OLDER than the row that names it  | 60      | 7200    | fresh     | stale     |
      | a row older than its freshly-pushed doc | 7200    | 60      | stale     | fresh     |
      | both stale                              | 7200    | 7200    | stale     | stale     |
      | doc EXACTLY at the window, row past it  | 301     | 300     | stale     | fresh     |
      | no cached doc at all                    | 60      | (absent) | fresh    | (no artifact verdict — the doc is a cache MISS, not a stale doc) |

  # AC 2 — `unknown` is a DESIGNED state. The dangerous failure here is the opposite one:
  # treating a missing instant as infinitely old and therefore stale, which would paint
  # every pre-v8 row as degraded on the first open after the upgrade.
  Scenario Outline: a missing or unusable instant yields `unknown` — never `stale`, and never a fabricated freshness
    Given the row for "43/04" has a `syncedAt` of <syncedAt>
    When the row is served from the cache at `now`
    Then its freshness state is <state>
    And it is never reported as stale on the strength of a missing instant
    And the read boundary did not write a value back into the row to make it judgeable

    Examples:
      | case                          | syncedAt                        | state   |
      | never stamped (pre-v8 row)    | null                            | unknown |
      | empty string                  | ""                              | unknown |
      | unparseable text              | "sometime last tuesday"         | unknown |
      | a future instant (clock skew) | 120 seconds AFTER `now`         | fresh   |
      | the epoch                     | 1970-01-01T00:00:00Z            | stale   |
    # A future `syncedAt` is parseable, so it is judged, and `now − t` is negative — which
    # is not `> window`, so it reads FRESH. That is the honest answer for a skewed peer
    # clock: it is not "unknown" (we have an instant) and it is certainly not "stale".

  # HEADLINE (AC 12) — the never-evict rule, as an OBSERVABLE. The ratchet is an absence
  # and lives in the arch test; THIS is what an operator would actually notice.
  Scenario: a row aged far past the window is marked stale and is STILL FULLY READABLE — it is never deleted
    Given the row for "43/04" was reported by "umairs-mac-mini" 30 days before `now`, with a cached "SPEC" doc and two cached run records of the same age
    When the control node runs its ordinary propagation tick, the store is closed and re-opened, and the item is served from the cache at `now`
    Then the row is still present, and is reported stale
    And its `status`, `title`, `type`, `slug` and `parent` read back exactly as they were reported 30 days ago
    And its cached "SPEC" body is still served in full, attributed to "umairs-mac-mini"
    And both cached run records are still readable
    And the row count in `work_items`, `work_item_docs` and `work_item_runs` for that workspace is unchanged by the age of the rows
    # STATE (settled, 2026-08-01): "a TTL that evicts would destroy the mesh's only
    # readable copy". Staleness is a MARK, not a sweep.

  # AC 12 / ADR-004 — the only sanctioned removal, and the proof that it keys on AUTHORSHIP
  # rather than on age. This is what stops "never evict" from meaning "never clean up".
  Scenario Outline: removal is by AUTHOR RETRACTION only — age neither causes a removal nor prevents one
    Given the row for "43/04" was reported by <author> with an age of <age>
    When <publisher> publishes its authoritative ref set, which <membership> that ref
    Then the row is <outcome>
    And no removal in the episode was predicated on how old any row was

    Examples:
      | case                                          | author          | age     | publisher       | membership | outcome  |
      | ancient row its author still claims           | umairs-mac-mini | 30 days | umairs-mac-mini | includes   | retained |
      | ancient row its author has dropped            | umairs-mac-mini | 30 days | umairs-mac-mini | omits      | removed  |
      | brand-new row its author has dropped          | umairs-mac-mini | 5s      | umairs-mac-mini | omits      | removed  |
      | ancient row belonging to ANOTHER node         | umairs-mac-mini | 30 days | aof-control     | omits      | retained |
    # "A node may retract only what it itself authored; it may never delete another node's
    # row, and no deletion may ever be predicated on a timestamp" (ADR-004 / ADR-006). Rows
    # 2 and 3 differ only in age and share an outcome; rows 1 and 2 differ only in
    # membership and differ in outcome. That pair is the shape of the rule.
