@executable @cli @work @memory
Feature: After the worker branch merges, `git pull` + `aof work memory ingest` rebuilds the control's OWN index and the worker-authored lesson/ADR becomes recallable
  In order that knowledge produced on a worker is recallable on the control node in the next `aof:refine`/
  `aof:continue` — not stranded on the worker — the control node rebuilds ITS OWN derived index from the
  now-shared markdown by re-ingesting its own checkout; a RETROSPECTIVE `R<n>` lesson / `ADR-NNN` block authored
  on the WORKER (present in the merged markdown) becomes present in the control's rebuilt index and recallable
  via `aof work memory recall` — where before the merge it was absent.

  # ARCHITECTURE 38/ADR-016 — DOCUMENTED DEFAULT: the syncback trigger is a MANUAL `git pull` (the markdown
  # arrives) + `aof work memory ingest` (the control's OWN `graphify-out/` rebuilds from the now-shared markdown)
  # on the control node after the worker-branch merges. Invariant #3: syncback is a re-ingest of the control's
  # OWN checkout — it does NOT fetch a remote index or a peer's cache. RESEARCH §4.4/§4.5 (operator, reiterated:
  # "if a milestone is completed on a worker -> control node memory should update"; `aof work memory ingest` only
  # updates whichever machine runs it, so the control node must re-ingest its own checkout after the pull).
  #
  # The RECORDS rebuild (buildRecords / parseRetrospective / parseArchitecture — 05/ADR-007) is OBSERVABLE with
  # NO graphify binary (the m10 precedent: the live graph.json build needs the binary and is @manual; the records
  # half is @executable). A RETROSPECTIVE entry is a `recordType: "lesson"`; an `ADR-NNN` is a `recordType: "adr"`
  # carrying `area: "architecture"`. `aof work memory recall` over the rebuilt records is what proves the
  # worker-authored knowledge landed on the control node.
  #
  # @executable, hermetic over a real LOCAL git checkout carrying the worker-authored markdown (as if the branch
  # merged) + the real `aof work memory ingest`/`recall` — a REAL ingest over REAL markdown, NOT a hand-built
  # index (cheap + un-fakeable; do NOT stub the index). NO real mesh / second machine; the real cross-machine
  # worker-verified -> control-recall path is EXCLUSIVELY task 02's @manual soak.

  Background:
    Given a real local checkout that is the CONTROL node's own checkout
    And a worker-authored RETROSPECTIVE `R<n>` lesson and `ADR-NNN` block that are NOT yet in that checkout (they live on the worker's unmerged branch)

  Scenario: before the merge, the worker's lesson is not recallable on the control node
    Given the control node has ingested its checkout as it stands, WITHOUT the worker's markdown
    When I run "aof work memory recall <the worker lesson's keywords>"
    Then the command exits 0
    And no recalled record is sourced from the worker-authored lesson/ADR (it is stranded on the worker)

  Scenario: after the branch merges, `git pull` + `aof work memory ingest` makes the worker's lesson recallable
    Given the worker-verified branch has merged into the control's checkout so the worker-authored markdown is now present (as after a `git pull`)
    When I run "aof work memory ingest"
    And I run "aof work memory recall <the worker lesson's keywords>"
    Then the command exits 0
    And the recalled records include the worker-authored RETROSPECTIVE `R<n>` lesson
    And each recalled record's "source" resolves to live text at its "path:line" within the control's OWN checkout, never a peer's cache

  # The QA case-matrix: each KIND of durable knowledge a verify produces (ADR-016 names RETROSPECTIVE `R<n>` +
  # `ADR-NNN`) becomes recallable on the control node after the re-ingest. `recordType` + `area` are the grounded
  # columns the 05 parsers stamp (a lesson -> recordType "lesson"; an adr -> recordType "adr", area always
  # "architecture"). Each row: the merged markdown carries the worker-authored artifact; recall surfaces it.
  Scenario Outline: each worker-authored knowledge artifact becomes recallable after the control re-ingests its checkout
    Given the merged markdown carries a worker-authored <artifact>
    When I run "aof work memory ingest"
    And I run "aof work memory recall <query>"
    Then the recalled records include the worker-authored record of recordType <recordType>
    And that record carries area <area>

    Examples: the durable-knowledge kinds ADR-016 names
      | artifact                     | query                | recordType | area           |
      | RETROSPECTIVE `R<n>` lesson  | <lesson keywords>    | lesson     | <as authored>  |
      | `ADR-NNN` block              | <adr title keywords> | adr        | architecture   |

  # A query that matches NOTHING the worker authored recalls nothing new after the ingest — the re-ingest surfaces
  # exactly the merged markdown, inventing no record (the boundary the matrix pins against a false positive).
  Scenario: a query matching no worker-authored artifact recalls nothing new after the re-ingest
    Given the worker-authored markdown is merged and `aof work memory ingest` has run
    When I run "aof work memory recall <an off-topic term absent from the worker's markdown>"
    Then no recalled record is sourced from the worker-authored lesson/ADR
