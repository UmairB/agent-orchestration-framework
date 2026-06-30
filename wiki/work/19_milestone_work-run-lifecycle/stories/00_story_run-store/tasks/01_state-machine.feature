@cli @work @work-stream @executable
Feature: The run state machine validates every transition against one closed table and rejects illegal moves with no write
  In order that a run's recorded state is always a legal point in the lifecycle queued -> running -> done|failed|cancelled
  the run store validates each transition against one frozen table — applying a legal move and rejecting an illegal one with an illegal-transition error that writes nothing,
  so that both the store and story 01's commands share one authority and a bad transition can never slip through a face or corrupt a record.

  # ARCHITECTURE ADR-001 freezes the closed transition table. The validator is a PURE
  # function over a (from, to) pair living in src/run-store.mjs, so this feature
  # exercises it directly. The STRUCTURAL fact "a rejected transition produces no
  # write" is also guarded by the acd-run-write-scope arch-test (fitness #2); here we
  # assert the OBSERVABLE behaviour (the record is unchanged, an error is raised).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the run store loaded in-process from src/run-store.mjs

  # The closed transition table (ADR-001), in FULL. The five states give a 5x5 grid of
  # 25 (from, to) cells; exactly FIVE are legal and the other TWENTY are rejected.
  # queued's two outbound edges are legal+validated though no store call MINTS a queued
  # run (reserved for milestone 20's scheduler); running's three terminal edges are the
  # lifecycle's normal completion; every terminal state is terminal; every self-loop is
  # rejected; every move OUT of a terminal state is rejected.
  # QA: this Examples table IS the frozen table, enumerated cell-by-cell — every one of
  # the 25 (from, to) pairs appears exactly once, so the legal set and the rejected set
  # are both pinned with no gap.
  Scenario Outline: the transition validator accepts only the legal edges of the closed table
    When I validate a transition from "<from>" to "<to>"
    Then the validator reports "<verdict>"

    Examples: from queued — the legal pre-running state (edges representable + validated)
      | from      | to        | verdict  |
      | queued    | queued    | rejected |
      | queued    | running   | legal    |
      | queued    | done      | rejected |
      | queued    | failed    | rejected |
      | queued    | cancelled | legal    |

    Examples: from running — the one non-terminal active state (its three terminal edges)
      | from      | to        | verdict  |
      | running   | queued    | rejected |
      | running   | running   | rejected |
      | running   | done      | legal    |
      | running   | failed    | legal    |
      | running   | cancelled | legal    |

    Examples: from done — TERMINAL (every outbound move rejected, incl. the self-loop)
      | from      | to        | verdict  |
      | done      | queued    | rejected |
      | done      | running   | rejected |
      | done      | done      | rejected |
      | done      | failed    | rejected |
      | done      | cancelled | rejected |

    Examples: from failed — TERMINAL (every outbound move rejected, incl. the self-loop)
      | from      | to        | verdict  |
      | failed    | queued    | rejected |
      | failed    | running   | rejected |
      | failed    | done      | rejected |
      | failed    | failed    | rejected |
      | failed    | cancelled | rejected |

    Examples: from cancelled — TERMINAL (every outbound move rejected, incl. the self-loop)
      | from      | to        | verdict  |
      | cancelled | queued    | rejected |
      | cancelled | running   | rejected |
      | cancelled | done      | rejected |
      | cancelled | failed    | rejected |
      | cancelled | cancelled | rejected |

  # Applying a legal terminal transition to a running run records the new state, sets
  # outcome to EQUAL that terminal state (the outcome==state-on-terminal invariant,
  # ADR-003), bumps updatedAt, and preserves runId + createdAt.
  Scenario Outline: completing a running run records the terminal state and sets outcome to match
    Given a running run for item "19"
    When I transition the run to "<terminal>"
    Then the run record "state" is "<terminal>"
    And the run record "outcome" is "<terminal>"
    And the run record "updatedAt" is at or after its "createdAt"
    And the run record keeps its original runId and createdAt

    Examples:
      | terminal  |
      | done      |
      | failed    |
      | cancelled |

  # An illegal transition is rejected with illegal-transition and the stored record is
  # left BYTE-UNCHANGED — no partial write, no silent no-op. The set below covers the
  # most important class: RE-COMPLETING each already-terminal state (done/failed/
  # cancelled to every terminal incl. itself — proving no terminal can be re-driven),
  # plus the running self-loop and the backward running->queued move.
  Scenario Outline: an illegal transition is rejected and writes nothing
    Given a run for item "19" already in state "<from>"
    When I transition the run to "<to>"
    Then the store raises an "illegal-transition" error
    And the persisted run record is byte-unchanged

    Examples: re-completing a done run — every terminal target rejected
      | from      | to        |
      | done      | running   |
      | done      | done      |
      | done      | failed    |
      | done      | cancelled |

    Examples: re-completing a failed run — every terminal target rejected
      | from      | to        |
      | failed    | running   |
      | failed    | done      |
      | failed    | failed    |
      | failed    | cancelled |

    Examples: re-completing a cancelled run — every terminal target rejected
      | from      | to        |
      | cancelled | running   |
      | cancelled | done      |
      | cancelled | failed    |
      | cancelled | cancelled |

    Examples: running's own illegal moves — the self-loop and the backward edge
      | from      | to        |
      | running   | running   |
      | running   | queued    |

  # The no-mint fact (ADR-001): the store has no API that produces a queued run —
  # starting a run always yields running. queued is representable in the schema + the
  # validator, but milestone 20's scheduler is its only producer.
  Scenario: starting a run always yields running, never queued
    When I start a run for item "19"
    Then the run record "state" is "running"
    And no store operation creates a run in state "queued"
