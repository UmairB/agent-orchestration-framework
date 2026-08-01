<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — attribution becomes an always-on part of reading an item: the detail
# panel's provenance box renders for EVERY cache-published item (not only executing ones),
# control-authored rows read `(this node)`, each doc body states its own provenance above
# the markdown, and `RemoteContentNotice`'s "documents aren't bridged" copy is retired
# because it is now false.
# LITMUS: every Then is confirmable from the RENDERED element tree of the real production
# board mounted headlessly against a real board face (the harness idiom of task 03) — the
# presence, ORDER and text of the provenance lines, and the absence of the retired copy. No
# source read. Fidelity (does the box read quietly enough, does the line fit) is task 09's
# `@uat` verdict.
#
# THE RULE BEING ENCODED, in one sentence: the cache is now the read surface, so every fact
# on the board is a copy of something a machine said at some instant — and the reader must
# always be able to see WHOSE and WHEN, without asking. Today the provenance box renders
# only when `item.execution` exists (`DetailPanel.tsx:169-223`), which makes attribution an
# execution detail; this milestone makes it a first-class fact of the item.
#
# WHAT IS DELIBERATELY NOT HERE. Serving a doc BODY out of the cache is story 06's
# `cached-doc-attribution.feature` — this file asserts the RENDER contract around whatever
# body arrives (the provenance line above it, the reworded miss placeholder instead of the
# retired notice), so the two stories can land in either order without either claiming the
# other's outcome.

@executable @ui @work @distribution
Feature: provenance is always on where there is room and on demand where there is not — every cache-published item states who reported it and when, control-authored rows say `(this node)`, each doc body states its own, and the retired "documents aren't bridged" notice is gone
  In order that a reader can tell an authoritative copy from an old one at a glance instead of by inference — including for a
  settled item nobody is executing, which is exactly the item most likely to be old
  the detail panel's provenance box renders for every cache-published item with a freshness/attribution line, the doc body
  carries its own line above the markdown, the fleet card answers on demand through its `title`, and no surface still claims
  the documents live somewhere this board cannot reach

  Background:
    Given the REAL production board mounted headlessly against a REAL board face over an isolated global store, on a controllable clock
    And the board face is serving a mesh-enabled workspace whose rows carry `syncedAt` and `reportedBy`

  # HEADLINE (AC 11) — the widening. "Only while executing" is the behaviour being replaced,
  # so the settled and never-executed cases are the ones that prove the change.
  Scenario Outline: the provenance line renders for EVERY cache-published item, executing or not
    Given the detail panel is open on an item that is <situation>
    When the panel header is rendered
    Then the provenance box is present
    And its line 2 reads <line 2>
    And line 1 — the execution facts (`running on <node>` / `waiting for your input on <node>` / `last run <state> on <node>`, branch, terminal and fleet links) — is <line 1>

    Examples:
      | case                       | situation                                                     | line 2                                                    | line 1                     |
      | running on a worker        | being executed right now by "umairs-mac-mini"                 | synced 4s ago · from umairs-mac-mini                      | present, exactly as today  |
      | settled after a run        | finished executing; the worker has stopped reporting          | stale · synced 12m ago · from umairs-mac-mini             | present, exactly as today  |
      | never executed, remote     | reported by "aof-wsl" and never dispatched                    | synced 30s ago · from aof-wsl                             | absent                     |
      | never executed, local      | published by the control node itself                          | synced 30s ago · from aof-control (this node)             | absent                     |
    # Line 1 keeps its existing rule verbatim (`item.execution` or nothing); line 2 is the
    # new always-on content. Both live in the SAME existing box — no new panel, dock or
    # column is introduced.

  # AC 11 — `(this node)`. Under this milestone the control is simply one more writer into
  # the cache, so its rows are attributed like anyone else's, with a clause that says which
  # machine "here" is.
  Scenario Outline: a row this node published reads `(this node)`; a row another node published names it plainly
    Given the row for "43/04" was reported by <reporter> and this board is running on "aof-control"
    When the provenance line is rendered
    Then it reads <line>
    And it never omits the reporting node on the grounds that it is the local one

    Examples:
      | case                | reporter        | line                                          |
      | control-authored    | aof-control     | synced 30s ago · from aof-control (this node) |
      | worker-authored     | umairs-mac-mini | synced 30s ago · from umairs-mac-mini         |
      | the WSL test node   | aof-wsl         | synced 30s ago · from aof-wsl                 |

  # AC 2 / DESIGN GAP D2 — the explicit unknowns. An omitted line reads as "there is no such
  # fact"; the honest degrade names what is missing.
  Scenario Outline: an unknown instant or an unknown reporter degrades to explicit words, never to an omitted line and never to a guess
    Given the row for "43/04" carries `syncedAt` = <syncedAt> and `reportedBy` = <reportedBy>
    When the provenance line is rendered
    Then it reads <line>
    And no badge is rendered for that row
    And the line is present in the DOM — the unknown is stated, not dropped

    Examples:
      | case                        | syncedAt      | reportedBy      | line                                                |
      | instant unknown             | null          | aof-wsl         | synced time unknown · from aof-wsl                  |
      | both unknown                | null          | null            | synced time unknown · reporting node unknown        |
      | reporter unknown, age known | 30s before now| null            | synced 30s ago · reporting node unknown             |

  # DESIGN §1c — WHERE THE BOX DOES NOT RENDER. Per-workspace presence of the region;
  # per-item always-on content within it. This preserves the board's plain local default,
  # the discipline the execution overlay already keeps.
  Scenario: a workspace that is not mesh-enabled shows no provenance region at all
    Given the board is serving a workspace that is not mesh-enabled
    When the detail panel is opened on any item
    Then there is no provenance box, no provenance line, no badge and no Resync anywhere on the panel
    And the panel is otherwise identical to the plain local board it is today

  # AC 6 / AC 11 — per-artifact provenance, ABOVE the body. Before the reader reads it, not
  # after; and no second badge and no second Resync, because the header's one door serves
  # the item and its artifacts.
  Scenario: a doc body carries its own provenance line at the top, above the rendered markdown
    Given the detail panel is open on an item whose row was reported 30 seconds ago and whose cached "SPEC" was reported 2 hours ago, both by "umairs-mac-mini"
    When the SPEC tab is rendered
    Then the doc region's FIRST child is a single provenance line reading "stale · synced 2h ago · from umairs-mac-mini"
    And the rendered markdown follows it
    And the doc region carries no badge of its own and no Resync of its own
    And the header's own line still reads "synced 30s ago · from umairs-mac-mini" with no `stale ·` prefix, because the row and the doc are judged separately

  # AC 7 / a11y rule 10 — the badge is never the only signal. A reader who misses a small
  # pill still meets the fact in prose, on the same panel, in the same tick.
  Scenario: whenever the badge is showing, the provenance line carries the `stale ·` prefix too
    Given a stale item with the detail panel open
    When the surfaces are rendered
    Then the header badge reads "◌ stale · 12m ago"
    And the provenance line independently reads "stale · synced 12m ago · from umairs-mac-mini"
    And the two never disagree: when the badge clears in a later tick, the prefix clears in the same tick

  # DESIGN §Surface 2 — the fleet's answer is ON DEMAND, because that region's geometry is
  # fitness-locked (`test/fleet-assign-row-geometry.test.mjs`) and the workspace strip above
  # already carries identity in full.
  Scenario: the fleet milestone card carries the badge and its `title` only — no provenance line, no Resync
    Given the fleet's global milestone card is rendered for a stale item reported by "umairs-mac-mini"
    When the card is rendered
    Then row 1's `ml-auto shrink-0` span is a cluster holding the stale badge then the status chip, in that order
    And the badge's `title` reads the full sentence naming the node, the last-synced time and the age
    And no new provenance line was added to the card
    And there is no Resync control anywhere on the fleet surface
    And the existing assign row's element order and reserved widths are unchanged

  # AC / STORY Notes — the RETIREMENT. The copy becomes FALSE the moment the cache is the
  # read surface, and false copy on a degraded path is worse than no copy.
  Scenario: `RemoteContentNotice`'s "documents aren't bridged" copy is retired — it survives only as the reworded cache-miss placeholder
    Given the detail panel is open on an item whose truth lives on "umairs-mac-mini"
    When the doc regions are rendered for a doc the cache HAS and for a doc the cache does NOT have
    Then no surface anywhere states that this board bridges the item list but not its documents or runs
    And no surface directs the reader to "open the fleet to watch that node" in order to read a document
    And the doc the cache HAS renders its body, preceded by its provenance line
    And the doc the cache does NOT have renders the reworded absent placeholder "No cached SPEC yet — umairs-mac-mini has not reported one."
    And that placeholder uses the dashed absent treatment, not the error token — absent is not an error
    # Serving the body itself is story 06 (`cached-doc-attribution.feature`); what this
    # scenario pins is that the notice's claim is gone and that the miss state is the only
    # thing left of it.
