@cli @work @distribution @manual
Feature: KR3 on a real 3-node fleet — ≥95% of issued items picked up and run on an eligible node in ≤2 sync intervals, no item run on an ineligible node, no manual file shuffling
  In order to verify the milestone's headline acceptance an outsider can check — KR3 "work issued on A is picked up and run on an eligible B with no manual file shuffling, ≤2 sync intervals, ≥95% of issued items" (PRD §7.2 KF6, §8 Phase 3)
  a real 3-node (Windows + macOS + Linux) fleet over a shared bare remote issues a pool of items across the three target kinds (node / capability / any) and each node runs its normal sync + next cadence over a soak window,
  so that an outsider confirms ≥95% of issued items are picked up and run on an ELIGIBLE node within ≤2 sync intervals, no item ever runs on an ineligible node, and nothing required manual file shuffling — the directive rode git.

  # ARCHITECTURE ADR-005 — KR3 is MEASURED at verification, never asserted in CI wall-clock: a
  # coverage/latency soak under real concurrency across three OSes is a measurement, not a
  # refine-time assert (the m23/m26 measurement discipline). WHAT THIS TASK MEASURES, explicitly:
  #   (1) ≥95% of issued items picked up and RUN on an eligible node (the target satisfied) — the
  #       KR3 headline coverage;
  #   (2) each pickup within ≤2 sync intervals (issuer push + peer pull — ADR-005.1's budget) —
  #       the latency, in sync intervals, per item;
  #   (3) NO issued item run on an ineligible node (a targeted-elsewhere item never ran on a
  #       non-target — routing narrowed correctly across the real fleet);
  #   (4) NO manual file shuffling — every directive reached its eligible node over git alone.
  # @manual: an agent stands up the real 3-node fleet at aof:verify and drives ONLY the registered
  # aof work/mesh commands (aof mesh issue, aof work next / run-start) — never hand-editing files.
  # All measured evidence lands in the milestone VERIFICATION.md.
  #
  # SEAM SPLIT — why this is @manual and not @executable (do NOT silently turn it into an assert):
  #  - The MECHANISM is already @executable in task 05 (the two-clone routing pickup over a bare
  #    remote — node/capability issue, ≤2-interval propagation, withdraw round-trip) plus the
  #    fitness #1/#3/#4/#5/#6 arch-tests — all green WITHOUT a fleet.
  #  - The SOAK is real concurrency on real hardware: three OS processes (Win + macOS + Linux), real
  #    git push/pull, real sync intervals — the ≥95% coverage and ≤2-interval latency are MEASURED
  #    observations, not deterministic CI asserts (a wall-clock coverage/latency soak in CI is flaky
  #    by construction).
  #
  # QA FEASIBILITY FLAG (developer-amigo): keep this @manual — do NOT collapse the ≥95% / 3-OS soak
  # into an @executable assert. The developer-amigo owns the @manual scope: standing up the real
  # 3-node fleet, issuing the pool across the three target kinds, running each node's sync + next
  # cadence over the soak window, and recording every measured count (issued count, pickup coverage
  # %, per-item pickup latency in sync intervals, per-OS breakdown, ineligible-run count) in
  # VERIFICATION.md. RAISED.
  #
  # RESOLVED (developer-amigo): CONFIRMED @manual — no retag proposed, none warranted. This is the
  # m26 "04_kr2-contested-soak" precedent applied verbatim: a wall-clock, cross-OS coverage/latency
  # measurement over real concurrency is not a deterministic CI assert by construction (real sync
  # cadence timing, real process scheduling across three distinct OSes, and a percentage-coverage
  # target are exactly the shape m26 already routed to @manual for KR2, not @executable). The
  # MECHANISM this soak measures is already proven deterministic and @executable at task 05 (the
  # two-clone routing pickup) plus the fitness #1/#3/#4/#5/#6 arch-tests — this task adds NOTHING
  # mechanistically new to verify; it exists solely to MEASURE the aggregate real-world outcome
  # (≥95% coverage, ≤2-interval latency, 0 ineligible runs, 0 manual shuffles) that only a real
  # multi-OS fleet under real timing can honestly produce. Developer-amigo scope confirmed per the
  # ownership note: I stand up the fleet, drive ONLY registered `aof mesh`/`aof work` commands, and
  # record every measured count into the milestone's VERIFICATION.md at aof:verify — same discipline
  # as the m26 KR2 soak.
  Background:
    Given a shared bare git remote all three nodes can push and pull
    And three aof installs — node A (Windows), node B (macOS), node C (Linux) — each cloned from that remote, each a mesh node with its own nodeId and descriptor
    And each node's descriptor advertises a known runtime/skill set (so capability targeting is exercised across all three)
    And a pool of ready items issuable across the three target kinds (node / capability / any)
    And all installs drive only the registered aof work and mesh commands (no hand-edited files)

  # THE KR3 COVERAGE HEADLINE (measurement 1 + 2): a pool of items is issued across the three target
  # kinds; over the soak window each is picked up and run on an eligible node within ≤2 sync
  # intervals. The audited outcome is ≥95% coverage on eligible nodes at ≤2-interval latency — the
  # PRD's headline acceptance, measured over real cross-OS concurrency.
  Scenario: ≥95% of issued items are picked up and run on an eligible node within ≤2 sync intervals
    Given a pool of items is issued across node-targeted, capability-targeted, and any-targeted directives, driven only through aof mesh issue
    When each node runs its normal sync + next + run-start cadence over the soak window
    Then ≥95% of issued items were picked up and RUN on an eligible node (the target satisfied) within ≤2 sync intervals
    And every pickup's latency (in sync intervals) and eligibility were audited from the durable run records on the shared remote
    And the KR3 coverage measurement (issued count, pickup coverage %, per-item latency, per-OS breakdown) is recorded in VERIFICATION.md

  # ROUTING NARROWED CORRECTLY ACROSS THE FLEET (measurement 3): no issued item ever ran on an
  # INELIGIBLE node — a node-targeted item ran only on its target, a capability-targeted item only
  # on an advertising node. Routing narrowed candidacy correctly across three real OSes; the lease
  # decided the runner among the eligible.
  Scenario: no issued item was run on an ineligible node across the soak
    Given the soak has run and the run records across all three nodes are on the shared remote
    When the run records are audited against each issued directive's target
    Then no node-targeted item ran on a node other than its target (0 ineligible node-target runs)
    And no capability-targeted item ran on a node whose descriptor did not advertise the capability (0 ineligible capability runs)
    And the ineligible-run count (0 expected) is recorded in VERIFICATION.md

  # NO MANUAL FILE SHUFFLING — THE DIRECTIVE RODE GIT (measurement 4 / KR3's "no manual file
  # shuffling"): every directive reached its eligible node over the default [meshDir] sync alone —
  # no operator copied, edited, or moved a file to route the work. The fleet was driven only through
  # the registered commands.
  Scenario: every issued item reached its eligible node over git alone — no manual file shuffling
    Given the soak was driven only through aof mesh issue and aof work next / run-start (no hand-edited files)
    When the propagation path of each picked-up item is reviewed
    Then every directive reached its eligible node over the default-root git sync (issuer push → peer pull)
    And no item required an operator to copy, edit, or move a file to route it (KR3 — no manual file shuffling)
    And the no-manual-shuffle confirmation is recorded in VERIFICATION.md
