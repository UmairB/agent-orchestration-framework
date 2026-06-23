@cli @adapter @scaffold @manual
Feature: Graphify provisions into the managed store and the temporary global install is then removed
  In order that graphify becomes an aof-managed dependency and the verify-time global is not left behind
  `aof project provision graphify` installs graphify into the store, then the temporary global install is removed and the store copy resolves,
  so that the ⚠ CLEANUP OBLIGATION from 09's verify is closed — graphify runs from `~/.aof/tools/graphify/`, not a hand-installed global.

  # ADR-004 + STATE ⚠ CLEANUP OBLIGATION: these scenarios drive the REAL uv lane and the
  # REAL global removal, so they are @manual (live binary), verified at aof:verify.
  # SEQUENCING IS LOAD-BEARING: the temporary global `uv tool install graphifyy` (graphify
  # 0.8.44, installed during 09's verify) is removed ONLY AFTER the store install + the
  # resolver re-point (task 00) — never before (09's live integration depends on it until
  # the store copy resolves). Closing this is a precondition of accepting story 02.
  # verifies → milestone UAT.md "graphify store migration + global cleanup" procedure (authored at verify).
  Background:
    Given uv is installed and graphify currently resolves from the temporary global install

  # Provision graphify into the version-keyed store, then confirm the store binary runs
  # and reports the pinned version (the live `graphify --version` probe, RESEARCH §A4).
  Scenario: aof project provision graphify installs graphify into the store
    When I run "aof project provision graphify"
    Then a uv venv exists at the graphify 0.8.44 version dir under ~/.aof/tools/graphify/
    And the store graphify binary reports the pinned version "0.8.44"

  # With the store copy present, resolveGraphifyBinary now resolves the store, not PATH.
  Scenario: graphify resolves the store copy once provisioned
    Given graphify is provisioned into the store
    When I call resolveGraphifyBinary()
    Then it resolves the store copy
    And the source is the managed store

  # ONLY AFTER the store copy resolves, the temporary global is removed and graphify
  # still resolves (now from the store) — the cleanup obligation, closed.
  Scenario: the temporary global graphify is removed after migration and graphify still resolves
    Given graphify resolves from the managed store
    When I remove the temporary global with "uv tool uninstall graphifyy"
    Then graphify still resolves from the store
    And no graphify remains on the global PATH from the removed install
