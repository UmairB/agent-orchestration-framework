<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — provenance travels: STORAGE keeps the sibling tables' names
# (`node_id` / `updated_at`), the WIRE speaks DESIGN's (`reportedBy` / `syncedAt`), ONE
# mapper does the translation for rows AND artifacts alike, and the configured staleness
# window rides the list response exactly once.
# LITMUS: every Then is confirmable from two observable artefacts and nothing else — (a) a
# store row read back out of an isolated global store, and (b) the JSON the board's
# `/api/work/list` route actually serialises (and the JSON `aof work list --json` prints).
# No source read; "one mapper" is asserted here only where it has an OBSERVABLE
# consequence — the row and the artifact produce the SAME key names and the SAME
# unknown-shape for the same underlying fact. (The structural "declared in one module"
# half is not a scenario; the milestone's fitness functions carry that class of claim.)
#
# THE MEASURED GAP THIS CLOSES (DESIGN §"What the surfaces already receive"): the board's
# per-item wire shape carries no `syncedAt` at all, and `reportedBy` is set ONLY on the
# child rows the worker merge INSERTS (`board-worker-stream.mjs:159-161`) — never on the
# rows it MERGES (`:140`). So attribution today is accidental and partial: the item you
# are actually looking at is the one least likely to say who reported it.
#
# THE ENVELOPE, AND THE CONTRACT IT MUST NOT BREAK. ADR-002 freezes `work list --json` as
# a FLAT ARRAY of the seven contract fields; the board's element shape has only ever grown
# by ADDITIVE OPTIONAL fields (`execution?`, `fromWorker?`, `reportedBy?`). `syncedAt` is
# another additive optional field and is safe. The staleness WINDOW is not per-row — it is
# one number for the whole response — so it needs a home beside the rows on the board
# route. The scenarios below pin both observables (the window arrives once on the board
# response; the CLI's flat array is unchanged) and deliberately leave the exact carrier to
# ARCHITECTURE, because either shape satisfies them and neither may break the frozen CLI
# contract.

@executable @cli @work @distribution
Feature: every cache-published row and artifact carries who reported it and when, under the storage names in the store and the wire names on the response, with the configured staleness window on the list response exactly once
  In order that a reader can tell an authoritative copy from an old one at a glance instead of by inference — and that a reader
  joining `work_items`, `work_item_docs` and `work_item_runs` never meets two column names for one fact
  the upsert seam stamps `node_id` + `updated_at` on every row it writes regardless of which node wrote it, the row mapper
  translates that one fact into `reportedBy` + `syncedAt` identically for rows and for artifacts, and the list response states
  the configured window once so no surface has to hold a threshold of its own

  Background:
    Given an isolated global mesh home and a mesh-enabled workspace published into it
    And the control node "aof-control" and a worker node "umairs-mac-mini" both able to write through the shared upsert seam

  # HEADLINE (AC 3) — every writer stamps, not just the worker, and the stamp is the
  # CONNECTION-AUTHENTICATED node id, never a self-reported one (the rule
  # `applyWorktreeContentFrame` already keeps).
  Scenario Outline: a row upserted through the shared seam reads back stamped with its author and its instant, whichever node wrote it
    Given the workspace has no cached row for "43/04"
    When <writer> publishes the row for "43/04" through the shared upsert seam
    Then reading `work_items` back shows `node_id` = <stamped node> for that row
    And its `updated_at` is a parseable ISO-8601 UTC instant, not null and not an empty string
    And the same row read back through the list response carries `reportedBy` = <stamped node> and a `syncedAt` equal to that `updated_at`

    Examples:
      | case                          | writer                                                   | stamped node       |
      | control publishes its own row | the control node's periodic publish                      | aof-control        |
      | worker streams a delta        | the worker's delta frame over an authenticated connection | umairs-mac-mini    |
      | worker re-reports an existing row | the worker's delta frame for a ref the control already published | umairs-mac-mini |

  # AC 3 — the NAME SPLIT, asserted from both ends at once. This is the whole point of
  # having one mapper: nobody should ever have to know which name a given surface uses.
  Scenario: the store speaks `node_id` / `updated_at` and the wire speaks `reportedBy` / `syncedAt` — never the reverse, and never both
    Given a published, freshly-reported row for "43/04"
    When the store is read directly and the list response is serialised
    Then the store row exposes `node_id` and `updated_at`, and exposes no `synced_at` and no `reported_by` column
    And the serialised row exposes `reportedBy` and `syncedAt`, and exposes no `node_id` and no `updated_at` key
    And the two describe the same instant and the same node — the wire value round-trips back to the stored value with no reformatting beyond ISO serialisation

  # AC 3 / AC 6 — the SAME mapping, applied to a different subject. A doc is stamped by
  # its own writer at its own instant, and the mapper must not special-case it.
  Scenario Outline: an artifact carries its OWN provenance under the SAME wire names as the row that names it
    Given the row for "43/04" was reported by <row node> at <row age> old
    And its cached "SPEC" doc was reported by <doc node> at <doc age> old
    When the item and its doc are served from the cache
    Then the row's serialised provenance reads `reportedBy` = <row node> with a `syncedAt` of <row age> old
    And the doc's serialised provenance reads `reportedBy` = <doc node> with a `syncedAt` of <doc age> old
    And the two are reported independently — neither overwrites, inherits or masks the other

    Examples:
      | case                             | row node        | row age | doc node        | doc age |
      | doc OLDER than the row naming it | umairs-mac-mini | 30s     | umairs-mac-mini | 2h      |
      | doc NEWER than the row           | umairs-mac-mini | 2h      | umairs-mac-mini | 30s     |
      | different nodes, same item       | aof-control     | 30s     | umairs-mac-mini | 5m      |
    # "a doc can be older than the row that names it" (ADR-006) — one predicate, two
    # subjects. Task 02 turns these two grains into the two staleness verdicts; this
    # scenario only proves both facts reach the surface separately.

  # AC 3 — REGRESSION, and the measured gap. Today the merged row (the one the operator is
  # looking at) is the one that loses its attribution, while a child row the merge INSERTED
  # keeps it. Both must carry it.
  Scenario: a row MERGED from a worker's view carries `reportedBy`, not only the child rows the merge inserts
    Given the local checkout already has a row for "43/04" and the worker reports its own view of the same ref
    And the worker also reports a child "43/04/00" that this checkout does not have at all
    When the merged list response is serialised
    Then the merged row for "43/04" carries `reportedBy` naming the worker, and a `syncedAt`
    And the inserted child row "43/04/00" carries the same two fields
    And no row in the response that came from the cache is missing `reportedBy` while a sibling row carries it

  # AC 5 — ONE number, stated once, sourced from configuration. The per-row alternative is
  # explicitly wrong: it would let two rows in one response disagree about the window.
  Scenario Outline: the list response states the configured staleness window exactly once, and it is the configured value
    Given the cache staleness window is configured as <configured> seconds
    When the board's work-list response is serialised
    Then the response carries `stalenessSeconds` = <configured>, once for the whole response
    And no individual row carries a window, a threshold or a pre-computed stale flag of its own
    And every row carries only the facts (`syncedAt`, `reportedBy`) the reader needs to apply that one window

    Examples:
      | case                  | configured |
      | the documented default | (the configured default, whatever `src/` resolves it to) |
      | a short window        | 60         |
      | a long window         | 86400      |
      | zero — aggressive but valid | 0    |
    # Zero is honoured rather than treated as "unset", the discipline `resolveStalenessSeconds`
    # already keeps for the presence window: only a MEANINGLESS value falls back to the default.

  # AC 2 — the NULLs from task 00 must survive serialisation as EXPLICIT nulls. An omitted
  # key is DESIGN GAP D2's failure: a fact slot that vanishes reads as "there is no such
  # fact" rather than "this is unknown".
  Scenario Outline: an unstamped row serialises its unknowns EXPLICITLY — present and null, never omitted and never fabricated
    Given a pre-v8 row for "43/04" whose stored `node_id` is <stored node> and whose stored `updated_at` is <stored time>
    When the list response is serialised
    Then the row carries a `syncedAt` key whose value is <wire time>
    And it carries a `reportedBy` key whose value is <wire node>
    And neither key is omitted from the row, and neither is filled with the serving node's id, the current time, or an empty string

    Examples:
      | case                        | stored node     | stored time | wire node       | wire time        |
      | never stamped (pre-v8)      | NULL            | NULL        | null            | null             |
      | node known, instant unknown | umairs-mac-mini | NULL        | umairs-mac-mini | null             |
      | instant known, node unknown | NULL            | 30s ago     | null            | that same instant|
    # CORRECTED at build (PO, 2026-08-03): the Then read "a `syncedAt` key whose value is
    # null" UNCONDITIONALLY while the table varied the stored instant, so row 3 — whose
    # stored `updated_at` IS 30s ago — could not satisfy it. The two halves of the scenario's
    # subject are independent (a node without an instant, an instant without a node), which is
    # the whole point of the third row; the Then had only been parameterised over one of them.
    # The implementation asserted the correct thing throughout; it was the contract that could
    # not be met as written.

  # ADR-002's frozen contract — the additive rule, asserted so the bump cannot break the
  # CLI face while serving the board.
  Scenario: the CLI's own `work list --json` stays a flat array of the frozen contract fields plus additive optional ones
    When `aof work list --json` is run against the workspace
    Then the output is a flat JSON array, as it is today
    And each element still carries `ref`, `type`, `slug`, `status`, `title`, `parent` and `dir`
    And the provenance fields appear only as additive OPTIONAL keys — no existing key is renamed, retyped or removed
    And no consumer of the frozen array shape has to change to read it
