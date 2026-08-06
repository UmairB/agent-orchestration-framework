<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — a new read-only vocabulary that is not in the legend is a vocabulary the
# operator must guess. Both legends gain a Freshness block painting the REAL badge beside
# its label, and the block states the window from the ONE number that arrives on the wire —
# degrading to WORDS, never to a guessed number, when the wire does not carry it.
# LITMUS: every Then is confirmable from the rendered element tree of the real production
# board and fleet mounted headlessly against real faces — the legend's section order, the
# rows' text, and the fact that the swatch is the same badge component the surface paints.
# No source read. Whether the block reads calmly at 1280 is task 09's `@uat` verdict.
#
# WHY THE DEGRADE MATTERS MORE THAN IT LOOKS. The threshold number is configured ONCE in
# `src/` and travels on the list response as `stalenessSeconds`; `ui/` carries no default
# and no literal (that half is a structural absence and is asserted by
# `acd-cache-staleness-single-predicate`, not restated here). The consequence is that when
# the wire does not carry the number, the UI genuinely does not know it — and the only
# honest legend row is one that names the window without quantifying it. A "5 minutes"
# fallback baked into the legend would be a SECOND threshold by another route: it would keep
# reading "5 minutes" long after an operator configured 30, and the operator would have no
# way to notice.
#
# THE LEGEND MUST MIRROR THE PAINTED RAMP 1:1 — the rule the board legend's own comment
# already states, and the reason m35's assignment block paints real chips rather than
# drawings. A hand-drawn legend swatch is how a legend starts lying about the ramp it
# documents.

@executable @ui @design @distribution
Feature: both legends gain a Freshness block that paints the real badge and states the configured window — in words from the wire, and in words alone when the wire does not carry it
  In order that an operator meeting a dashed grey pill for the first time can find out what it means without guessing, and is
  never told a staleness window that is not the one actually in force
  the board's status legend and the fleet's legend each gain a Freshness section as their last block, painting the real stale
  badge beside its label, with the window rendered from the `stalenessSeconds` on the wire and degrading to an unquantified
  sentence when it is absent

  Background:
    Given the REAL production board and fleet mounted headlessly against their REAL faces over an isolated global store
    And the surfaces are serving a mesh-enabled workspace

  # HEADLINE (AC 5 / DESIGN §Surface 3) — the block exists, in the right place, on both
  # surfaces, painting the real component.
  Scenario Outline: each legend gains a Freshness block as its last section, painting the REAL badge beside its label
    Given the <surface> legend is opened
    Then its sections appear in the order <order>
    And the Freshness block carries the existing uppercase legend heading treatment
    And it lists exactly two rows
    And the mark on the `stale` row is the SAME badge component the surface paints on a stale item — not a hand-drawn swatch, a static glyph or a copied class string
    And the `(no badge)` row shows the absence itself, matching the "fresh renders nothing" rule

    Examples:
      | surface | order                                                                    |
      | board   | the five status rows, a divider, then Freshness                          |
      | fleet   | Node liveness, Run state, Assignment, then Freshness                     |

  # AC 5 — the window is stated from the wire's number, and the number's home is `src/`. The
  # Examples sample values that a hard-coded default would silently contradict.
  Scenario Outline: the `stale` row states the configured window, taken from the number on the wire
    Given the list response carries `stalenessSeconds` = <configured>
    When the legend's Freshness block is rendered
    Then the `stale` row reads "◌ stale — no fresh copy for over <window in words>"
    And the `(no badge)` row reads "(no badge) — synced within the window"
    And the row states the configured window, never a value of the legend's own

    Examples:
      | case                | configured | window in words |
      | one minute          | 60         | 1 minute        |
      | five minutes        | 300        | 5 minutes       |
      | one hour            | 3600       | 1 hour          |
      | one day             | 86400      | 1 day           |
      | zero — every copy is immediately stale | 0 | 0 seconds |
    # If the configured window changes, the legend changes with it in the next response —
    # which is the whole reason the number rides the wire instead of living in two places.

  # HEADLINE (AC 5, the degrade) — WORDS, NEVER A GUESSED NUMBER. Each Example is a distinct
  # way the field can fail to arrive, and all three must degrade the same way.
  Scenario Outline: when the wire does not carry the window the row degrades to words — never to a number
    Given the list response's `stalenessSeconds` is <wire value>
    When the legend's Freshness block is rendered
    Then the `stale` row reads exactly "◌ stale — no fresh copy inside the staleness window"
    And the row contains no number, no duration and no unit anywhere in its text
    And the block is still rendered — the degrade is a rewording, not a disappearance
    And no other surface substituted a window of its own for the missing one

    Examples:
      | case                | wire value        |
      | field absent        | not present at all|
      | explicit null       | null              |
      | non-numeric         | "5m"              |
      | not finite          | NaN               |

  # The legend has no data states, which is exactly why it must be correct before any data
  # arrives — and "before any data arrives" is precisely the state in which no
  # `stalenessSeconds` has been received.
  Scenario: the legend renders correctly before any data has arrived, in its words form
    Given no list response has arrived yet
    When the legend is opened
    Then it renders from the ramp module alone — it has no loading, error or empty state
    And the Freshness block is present with its two rows
    And the `stale` row is in its unquantified words form, because no window has been received
    When the first list response arrives carrying `stalenessSeconds` = 300
    Then the row states the 5-minute window on the next render

  # The badge in the legend and the badge on the board must be the same thing, or the legend
  # documents a ramp the surface does not paint.
  Scenario: the legend's swatch and the surface's badge stay identical — one ramp, one source
    Given a stale item is on the board and the legend is open
    When the badge on the item and the swatch in the legend are compared
    Then both are produced by the same freshness ramp module and carry the same token set — dashed `muted-foreground/45` border, transparent background, `muted-foreground` text
    And neither carries a `destructive` or `accent` token
    And the legend's swatch is visually distinct from the node-presence dot, the run chip and the assignment chip on the same page
