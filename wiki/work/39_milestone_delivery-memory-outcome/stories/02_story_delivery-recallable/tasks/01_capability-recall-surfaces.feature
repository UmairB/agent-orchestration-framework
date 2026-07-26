@executable @cli @work @memory
Feature: a "what provides X / is X built" recall surfaces the capability record over the verbose ADRs
  In order to learn a field has no producer BEFORE inventing one — a product question, not only a reasoning one
  the local backend must rank a terse, well-titled capability record at or above four verbose keyword-dense ADRs
  on a capability-intent query, via a BOUNDED type-tiebreaker plus an area="delivery" hard pre-filter escape hatch.

  # Scope: the ranking change in rankRecords (39/ADR-003). The SPEC's flagged central risk — "indexing the doc
  # and still getting four ADRs back is a failure of this milestone" — is the calibration gate below. Three
  # composing mechanisms, all inside the existing ranker (05/ADR-006 BM25-lite + IDF + TITLE_BOOST_PER_TERM=0.6
  # + TYPE_BOOST_LESSON=0.15): (1) authoring discipline — the capability title NAMES the surface, earning the
  # strong title boost under length-normalisation; (2) a query-class-conditional TYPE_BOOST_CAPABILITY, applied
  # ONLY on a capability-intent trigger and calibrated STRICTLY below one title-match term, so it breaks the
  # residual tie but CANNOT invert a decisively-higher base match and is INERT on decision/lesson-intent
  # queries; (3) the area="delivery" HARD pre-filter (applyScope, BEFORE scoring) as the deterministic agent
  # escape hatch. The BOUNDEDNESS invariant (the boost constant < TITLE_BOOST_PER_TERM) is a white-box constant
  # owned by the acd-outcome-capability-ranking-bounded fitness function; here it is asserted OBSERVABLY only
  # through its consequence — a decisive base match is never inverted. Parsed against a FIXTURE index (the
  # capability from an OUTCOME.md, the ADRs from an ARCHITECTURE.md), independent of story 01's authoring path.

  Background:
    Given a fixture memory index built from a milestone's OUTCOME.md, ARCHITECTURE.md and RETROSPECTIVE.md, holding these records:
      | id     | recordType | area         | title                                             | text-shape                                                             |
      | CAP    | capability | delivery     | warnings delivery                                 | terse, dense: "warnings delivery is provided by the notifier path"     |
      | ADR-1  | adr        | architecture | seal discipline is additive-optional, no new hash | long, keyword-dense: repeats "warnings delivery provides" amid padding |
      | ADR-2  | adr        | architecture | seal discipline is additive-optional, no new hash | long, keyword-dense: repeats "warnings delivery provides" amid padding |
      | ADR-3  | adr        | architecture | seal discipline is additive-optional, no new hash | long, keyword-dense: repeats "warnings delivery provides" amid padding |
      | ADR-4  | adr        | architecture | seal discipline is additive-optional, no new hash | long, keyword-dense: repeats "warnings delivery provides" amid padding |
      | GAP    | gap        | delivery     | warnings_delivered field                          | the gap statement plus its discharge condition                         |
      | LESSON | lesson     | process      | fill a field only when a producer exists          | short, on-point: about producers; no "warnings delivery" term overlap  |

  # THE CALIBRATION GATE (39/ADR-003, the SPEC acceptance): a capability record + four verbose keyword-dense
  # ADRs all matching a "what provides X" query → the capability returns #1, not four ADRs. The capability's
  # title carries the query surface (title boost, length-normalised) and the query trigger lands the bounded
  # capability boost; the ADRs' padded repetition is discounted and their title carries no query term.
  Scenario: the calibration gate — a capability query returns the capability record #1 over four verbose ADRs
    Given a capability-intent query "what provides warnings delivery"
    And an empty scope
    When recall ranks the surviving records
    Then the top-ranked record is the capability "CAP"
    And record "CAP" ranks above every one of the verbose ADRs "ADR-1, ADR-2, ADR-3, ADR-4"

  # Self-check that the boost is a tiebreaker, not an override (39/ADR-003 / 05/ADR-006): a decision-intent
  # query the ADRs match decisively on their title still returns the decisive ADR first — the boost did not
  # become a relevance override.
  Scenario: a decision-intent query still returns the decisive ADR first — the capability boost is not an override
    Given a decision-intent query "seal discipline additive optional no new hash"
    And an empty scope
    When recall ranks the surviving records
    Then the top-ranked record is a "seal discipline" ADR the query matches decisively, not the capability "CAP"

  # The bound observed through its consequence: even WITH a capability-intent trigger, a capability that does
  # NOT match the queried surface is never lifted above an ADR that matches it decisively. (The numeric bound
  # itself — TYPE_BOOST_CAPABILITY < 0.6 — is the arch-test's; this is the black-box shadow of it.)
  Scenario: even on a capability-intent query the boost never inverts a decisively-stronger base match
    Given a capability-intent query whose surface terms only a "seal discipline" ADR matches, not the capability "CAP"
    And an empty scope
    When recall ranks the surviving records
    Then that decisively-matched ADR ranks above the capability "CAP"

  # 39/ADR-003 mechanism #2 is query-class-conditional: on a query with no capability-intent trigger word the
  # capability earns no lift, so ADR/lesson recall is byte-for-byte what it was before delivery records existed.
  Scenario: the capability boost is inert on a non-capability query — ADR and lesson recall are unchanged
    Given a query with no capability-intent trigger word that matches "CAP" and an ADR with equivalent length-normalised relevance
    And an empty scope
    When recall ranks the surviving records
    Then record "CAP" and the equally-relevant ADR score equally — the capability earns no lift
    And the ranked order of the ADR and lesson records is exactly what it was before the delivery records were indexed

  # 39/ADR-003 mechanism #3 — the deterministic agent escape hatch: recall --area delivery HARD pre-filters
  # BEFORE scoring, so the ADRs are excluded from the candidate set entirely and cannot rank however densely
  # their text matches the query.
  Scenario: recall --area delivery hard pre-filters to delivery records, excluding the ADRs from the candidate set entirely
    Given a capability-intent query "what provides warnings delivery"
    And a scope of area "delivery"
    When recall ranks the surviving records
    Then only the delivery records "CAP" and "GAP" can rank
    And none of the ADRs "ADR-1, ADR-2, ADR-3, ADR-4" appear in the results, even though their text matches the query
    And the top-ranked record is the capability "CAP"

  # The case matrix — a query class (and scope) to the expected top-ranked record. Row 1/2 are the capability
  # gate (unscoped); the decision-intent row is the tiebreaker-not-override self-check (the ADRs are identical,
  # so the stable sort surfaces ADR-1); the scoped row is the hard pre-filter floor.
  Scenario Outline: the query class decides which record surfaces first
    Given a query "<query>"
    And a scope of <scope>
    When recall ranks the surviving records
    Then the top-ranked record is "<top>"

    Examples: capability-intent — the capability surfaces over the verbose ADRs (the calibration gate)
      | query                           | scope   | top |
      | what provides warnings delivery | (empty) | CAP |
      | is warnings delivery built      | (empty) | CAP |

    Examples: decision-intent — the decisive ADR is unchanged (the boost is a tiebreaker, never an override)
      | query                                  | scope   | top   |
      | seal discipline additive optional hash | (empty) | ADR-1 |

    Examples: the area="delivery" hard pre-filter guarantees the capability regardless of the boost
      | query                           | scope         | top |
      | what provides warnings delivery | area delivery | CAP |
