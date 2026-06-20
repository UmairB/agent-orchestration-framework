@cli @work @memory @manual
Feature: reindex over the live aof work stream matches the real corpus
  In order to prove the indexer produces the right records against real data, not just a temp fixture
  an agent must run reindex over the live aof work stream and confirm the record count and lesson/adr
  split match the actual RETROSPECTIVE + ADR corpus.

  # This is agent-run OBSERVATION over the real stream, recorded in the milestone VERIFICATION.md —
  # distinct from the acd-memory-derived-index fitness function (which builds into a temp store from a
  # small/fixture stream and proves source-resolution + idempotent rebuild). Here the bar is the LIVE
  # corpus: the spike measured 21 records = 4 lessons (R1-R4 in milestone-01 RETROSPECTIVE) + 17 ADRs.
  # The exact totals will move as the stream grows, so the assertion is "count and split match the
  # live RETROSPECTIVE+ADR corpus at run time", verified by the agent against the .md files. One
  # @manual lane (inherited; no per-scenario lane). When it no longer needs an agent observation it
  # migrates to @executable. Procedure + recorded result live in the milestone VERIFICATION.md, which
  # points back with `verifies →`.

  Scenario: reindex over the live stream produces a record set matching the live corpus
    When an agent runs "aof work memory reindex" against the live aof work stream
    Then the index recordCount equals the number of RETROSPECTIVE "R<n>" entries plus ARCHITECTURE "ADR-NNN" blocks across the stream
    And the lesson count equals the live RETROSPECTIVE "R<n>" entry count and the adr count equals the live "ADR-NNN" count
    And the agent records the observed count and lesson/adr split in the milestone VERIFICATION.md
