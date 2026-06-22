@cli @adapter @memory @executable
Feature: with graphify absent, every verb degrades to un-graph-ranked 05 recall, never crashing
  In order to keep memory.backend = graphify usable on a box where the graphify binary is not installed
  the system must degrade to un-graph-ranked recall over the 05 records — recall and brief stay live and
  populated, reindex rebuilds the records and skips the graph with a clear hint, and status reports the
  graph state — so an operator can always tell whether recall is graph-grounded or has fallen back, and
  no verb ever throws on the missing binary.

  # ADR-004: the records come from the 05 parsers REGARDLESS of the graph (ADR-001), so when the binary
  # is absent the records are STILL recallable — only the graph re-rank term is lost. The degrade target
  # is un-graph-ranked recall over the 05 records (the 05 base length-normalised ranking, 05/ADR-006),
  # NOT a none-shaped empty result (that would needlessly discard recall the backend can still serve and
  # make graphify strictly worse than local). The degrade is VISIBLE (a diagnostic / status field), never
  # silent — the honest-degrade discipline 09/ADR-004 set for the doctor check. The install hint is the
  # 09/ADR-004 `resolveGraphifyBinary` structured miss carried through.
  #
  # These scenarios stub resolveGraphifyBinary → {found:false} (the 09 acd-graph-binary-absent idiom:
  # the graph:build the backend invokes throws a structured graphify-missing (424), which the backend
  # CATCHES). They assert the OBSERVABLE degrade SHAPE per verb — recall/brief stay populated and
  # un-graph-ranked, reindex rebuilds records + skips the graph, status reports the graph-absent state.
  # The UNIVERSAL "no verb ever throws" guard is the arch-test's (acd-graphify-binary-absent-degrades,
  # story 03 — it imports the backend with the resolver stubbed and asserts all four verbs return without
  # throwing, and that recall still carries resolving source:line). Comment-only here: the rows below pin
  # the per-verb degrade SHAPE; the throw-free invariant universal over the verbs is the arch-test's.

  Background:
    Given the graphify backend is selected
    And the graphify binary is absent (resolveGraphifyBinary reports found:false with an install hint)
    And a reindex has populated the 05 record store (the records half needs no binary)

  # recall: 05 records, 05 base ranking (no graph re-rank term), every source:line still resolves, PLUS
  # a visible diagnostic that the graph signal was unavailable — a valid, non-empty, un-graph-ranked
  # recall. NEVER empty (the records are still there), NEVER thrown.
  Scenario: recall degrades to un-graph-ranked recall over the 05 records with a visible diagnostic
    When I run "aof work memory recall \"derived index invariant\" --json"
    Then the command exits 0
    And the result's records array is non-empty
    And every record is a frozen MemoryRecord
    And every record's "source" resolves to live text at its "path:line"
    And the records are ranked by the 05 base ranking, without a graph re-rank term
    And the result carries a diagnostic that the graph signal was unavailable

  # brief is COMPOSED over recall seam-side (ADR-004 / 05/ADR-003 — no separate interface method), so it
  # inherits the recall degrade for free: a populated, un-graph-ranked digest, no throw.
  Scenario: brief inherits the same degrade — populated, un-graph-ranked, no throw
    When I run "aof work memory brief"
    Then the command exits 0
    And the digest is populated from the un-graph-ranked recall

  # reindex: the records ARE rebuilt (that half needs no binary); the graph is SKIPPED with a clear
  # "graph skipped (graphify binary absent — <install hint>)" signal — the caught structured
  # graphify-missing miss carried through, NOT a crash. The records-rebuilt result still returns ok.
  Scenario: reindex rebuilds the records and skips the graph with a clear binary-absent hint
    When I run "aof work memory reindex --json"
    Then the command exits 0
    And the record store is rebuilt and non-empty
    And the result reports the graph was skipped because the graphify binary is absent
    And the skipped-graph signal carries the install hint

  # status: reports backend "graphify", the record count, AND the graph state (here: binary-absent +
  # the install hint). It never throws on an absent store or absent graph — mirrors local's status
  # tolerance (05). This is the backend-introspection surface; the doctor check is the project-health one.
  Scenario: status reports the backend, record count, and the binary-absent graph state
    When I run "aof work memory status --json"
    Then the command exits 0
    And the status reports the backend "graphify"
    And the status reports the record count
    And the status reports the graph state as binary-absent with the install hint

  # Each verb with the binary absent: it exits 0 / returns its degrade shape / does not throw. The shape
  # column is the OBSERVABLE per-verb degrade. (The universal throw-free guard is the arch-test's,
  # acd-graphify-binary-absent-degrades — these rows assert the SHAPE each verb degrades TO.)
  Scenario Outline: every verb degrades to its shape with the binary absent, exiting 0
    When I run "aof work memory <verb> <args>"
    Then the command exits 0
    And the result is <shape>

    Examples: the per-verb degrade shapes when the graphify binary is absent
      | verb    | args                          | shape                                                            |
      | recall  | "derived index invariant"     | non-empty 05 records, un-graph-ranked, + graph-unavailable diag  |
      | brief   |                               | a populated un-graph-ranked digest                               |
      | reindex |                               | records rebuilt, graph skipped (binary absent + install hint)    |
      | status  |                               | { backend: "graphify", recordCount, graphState: binary-absent }  |
