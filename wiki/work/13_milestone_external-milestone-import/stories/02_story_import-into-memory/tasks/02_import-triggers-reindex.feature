@cli @adapter @memory
Feature: aof import milestone triggers the backend reindex so import reaches memory with no manual step
  In order to close the loop the SPEC names as load-bearing — import REACHING memory, not a parsed file
  sitting inert on disk — running aof import milestone must leave the imported precedent immediately
  recall-able (the command triggers the backend's reindex after materializing), a --dry-run must
  materialize and index nothing, and a re-import over the same source must yield the same recall-able
  record set with no growth.

  # ADR-003: the import is a PRODUCER of .md; it MAY trigger a reindex after materializing (so import
  # reaches memory), but it does so by INVOKING the backend's existing reindex (now scanning the import
  # store too), NEVER by hand-writing index JSON, and NEVER by integrating with graphify itself
  # (graphify is reached only by the backend via the 09 registered graph:* commands — 10/ADR-002).
  # ADR-005: a re-import is a CLEAN one-time snapshot — re-running re-materializes fresh, so a second
  # import over an unchanged source yields the identical artifact + record set; nothing accretes.
  # The --dry-run (ADR-002) recovers + previews but materializes/indexes/networks nothing — this row
  # cross-checks story 00's dry-run from the memory side (recall after a dry-run surfaces no records).
  #
  # The @executable scenarios run OFFLINE against a LOCAL fixture source (the read-only injection seam,
  # mirroring src/planning-init.mjs) behind a fixed/stubbed recovery input — no binary needed. The
  # graphify-backend recall of imported records needs the LIVE graphify binary (it re-ranks via its
  # existing invoke("graph:build") path), which cannot run in CI — so that one row is @manual and asserts
  # only the OBSERVABLE: graphify recall surfaces the imported records.
  #
  # The STRUCTURAL invariants are story-03 arch-tests, NOT scenarios here: "the import command never
  # writes aof.memory.index.json directly, creates no bespoke store, and imports no src/graphify.mjs /
  # spawns no graphify — it indexes only by triggering the backend's reindex over the extended scan" is
  # acd-import-indexer-extends-scan + acd-import-no-graphify-spawn; "a fresh re-import reproduces the
  # identical record set and every source:line resolves in the import store" is acd-import-derived-index;
  # "source access is read-only / --dry-run materializes nothing" is acd-import-read-only-source.
  # Comment-only — do not restate them as Thens.

  Background:
    Given a local fixture aof-structured source repo with a recoverable milestone "00"

  @executable
  Scenario: import leaves the imported precedent immediately recall-able with no separate reindex step
    When I run "aof import milestone <fixture-repo> 00"
    Then the command exits 0
    When I run "aof work memory recall <query matching the imported milestone>"
    Then the recalled records include a record sourced from the import store

  # ADR-002: --dry-run previews but materializes/indexes nothing — so a recall right after a dry-run
  # surfaces no imported records (it cross-checks story 00's dry-run from the memory side).
  @executable
  Scenario: a --dry-run does not reindex, so recall after it surfaces no imported records
    When I run "aof import milestone <fixture-repo> 00 --dry-run"
    Then the command exits 0
    When I run "aof work memory recall <query matching the imported milestone>"
    Then no recalled record is sourced from the import store

  # ADR-005: a re-import is a clean snapshot — re-materialize fresh + reindex yields the same record set,
  # no growth / no duplication.
  @executable
  Scenario: a re-import over the same source yields the same recall-able record set with no growth
    When I run "aof import milestone <fixture-repo> 00"
    And I note the imported record set recall-able afterwards
    And I run "aof import milestone <fixture-repo> 00" again over the unchanged source
    Then the imported record set recall-able afterwards is the same set
    And the imported record count is unchanged

  # The import-mode -> recall-outcome matrix. import (no flag) triggers reindex -> records recall-able;
  # --dry-run materializes/indexes nothing -> not recall-able; a re-import over the same source ->
  # recall-able, same set (no growth). "recall-able" = the imported records appear in a subsequent
  # recall; "count vs first import" tracks growth across runs ("n/a" where no prior import applies).
  @executable
  Scenario Outline: the import mode decides whether the imported records become recall-able
    When I run "aof import milestone <fixture-repo> 00 <mode>"
    Then the imported records are <recall-able> in a subsequent recall
    And the imported record count is <count>

    Examples: a real import reaches memory
      | mode      | recall-able | count                 |
      | (none)    | recall-able | the imported set      |

    Examples: a dry-run reaches nothing
      | mode      | recall-able | count                 |
      | --dry-run | absent      | zero (nothing indexed) |

    Examples: a re-import is a clean snapshot (no growth over the first import)
      | mode             | recall-able | count                          |
      | (re-run, no flag) | recall-able | unchanged from the first import |

  # @manual: the graphify backend recalling imported records. With memory.backend = graphify, the
  # imported records flow through the SAME extended scan and are recall-able AND graph-re-ranked through
  # the graphify backend's EXISTING invoke("graph:build") path (10/ADR-001/002) — needs the LIVE binary,
  # so it cannot run in CI. Assert ONLY the observable: graphify recall surfaces the imported records
  # (the re-rank ordering and the via-the-command structural invariant are 09/10's concern, not asserted
  # here; "the import imports no src/graphify.mjs / spawns no graphify" is acd-import-no-graphify-spawn).
  @manual
  Scenario: with the graphify backend selected, imported records are recall-able through its existing path
    Given the graphify binary is installed and a logged-in extraction backend is available
    And "memory.backend" is "graphify"
    When I run "aof import milestone <fixture-repo> 00"
    Then the command exits 0
    When I run "aof work memory recall <query matching the imported milestone>"
    Then the recalled records include a record sourced from the import store
