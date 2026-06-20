@cli @work @memory @executable
Feature: a short on-point lesson ranks at or above a long term-heavy adr (the spike's inversion does not recur)
  In order for "we already learned this" to reach a decision-maker first instead of being buried
  the local backend must rank survivors so raw term repetition in a longer record cannot outrank
  a shorter, denser match of equivalent relevance — length normalisation plus a record-type boost.

  # The spike's headline finding F1: naive term-frequency scoring INVERTED the desired order — a long,
  # term-heavy adr out-scored the on-point one-line lesson R1 purely by repeating query terms. ADR-006
  # fixes this with length-normalised (BM25-lite) scoring + a title-match boost + a record-type boost
  # that lifts a lesson over an adr at equal score. This feature is the CONCRETE proof, over a fixture
  # mirroring the spike's scenario, that the inversion does NOT recur. The universal "length-normalised
  # so repetition cannot win" rule is owned by the acd-memory-ranking fitness function; here we pin
  # representative cases (incl. the spike's exact inversion case) and the order/limit behaviour.
  # Records carry a `score` (ADR-004); results are highest-score-first, truncated to `limit` (default 5).
  Background:
    Given a fixture index of these MemoryRecords:
      | id      | recordType | title                                  | text-shape                                              |
      | LESSON  | lesson     | requiring-grep is a fitness-fn smell   | short, on-point: states the lesson once, densely        |
      | ADR     | adr        | content-addressed manifest membership  | long, term-heavy: repeats the query terms many times    |
      | TITLED  | lesson     | pin line endings cross-platform        | short, on-point: the query terms appear in the title    |
      | OTHER   | adr        | unrelated decision                     | long, no query-term overlap                             |

  # The spike's exact inversion case: equivalent-relevance query, short lesson vs long term-heavy adr.
  Scenario: the on-point lesson ranks at or above the longer term-heavy adr
    Given a query "requiring grep fitness function smell"
    And an empty scope
    When recall ranks the surviving records
    Then record "LESSON" ranks at or above record "ADR"
    And record "LESSON" is the top-ranked record

  # Record-type boost (ADR-006): at otherwise-equal relevance a lesson outranks an adr.
  Scenario: at equivalent relevance the lesson outranks the adr on the record-type boost
    Given a query that matches "LESSON" and "ADR" with equivalent length-normalised relevance
    And an empty scope
    When recall ranks the surviving records
    Then record "LESSON" ranks above record "ADR"

  # Title-match boost (ADR-006): a query term in a record's title lifts it.
  Scenario: a title-term match lifts a record above an equally-relevant record without the title match
    Given a query "pin line endings"
    And an empty scope
    When recall ranks the surviving records
    Then record "TITLED" is the top-ranked record

  # Highest-score-first ordering and the default limit truncation (ADR-006).
  Scenario: results are returned highest-score-first
    Given a query "requiring grep fitness function smell"
    And an empty scope
    When recall ranks the surviving records
    Then each record's score is greater than or equal to the score of the record after it

  Scenario: results are truncated to the default limit of 5
    Given a fixture index of 8 records that all match the query
    And a query that matches every record
    And an empty scope
    When recall ranks the surviving records
    Then exactly 5 records are returned

  Scenario: an explicit limit truncates to that many records
    Given a fixture index of 8 records that all match the query
    And a query that matches every record
    And an empty scope
    And a limit of 3
    When recall ranks the surviving records
    Then exactly 3 records are returned

  # The case matrix — a query (and scope) to the expected top-ranked id / expected order.
  # The first row is the spike's documented inversion: the short on-point lesson must NOT lose to
  # the long term-heavy adr. Subsequent rows pin the title-match lift and the record-type boost.
  Scenario Outline: ranking surfaces the right record first and in the right order
    Given a query "<query>"
    And a scope of <scope>
    When recall ranks the surviving records
    Then the top-ranked id is "<top>"
    And the ranked order is "<order>"

    Examples: the spike's inversion case — the on-point lesson wins, never the long term-heavy adr
      | query                                 | scope   | top    | order              |
      | requiring grep fitness function smell | (empty) | LESSON | LESSON, ADR        |

    Examples: title-match boost lifts the record whose title carries the query terms
      | query            | scope   | top    | order              |
      | pin line endings | (empty) | TITLED | TITLED, LESSON     |

    # Boundary of the type boost: it is only a tiebreaker (ADR-006), never a relevance override.
    # A query the adr matches far more strongly than any lesson still ranks the adr first — the
    # boost lifts a lesson over an adr only at equivalent length-normalised relevance (scenario above).
    Examples: relevance dominates — the type boost does not override a clearly stronger adr match
      | query                      | scope   | top | order      |
      | content addressed manifest | (empty) | ADR | ADR, LESSON |
