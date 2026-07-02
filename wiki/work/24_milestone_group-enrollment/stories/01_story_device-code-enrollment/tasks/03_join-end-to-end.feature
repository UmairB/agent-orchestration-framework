@cli @work @distribution @manual
Feature: a fresh machine joins the fleet with a single 6-digit code — no manual credential copying (KR6) — and the credential-at-rest + code-in-flight residual risks are pen-tested
  In order to verify the milestone's load-bearing objective an outsider can check — one 6-digit code admits a fresh machine, no key copying (PRD §7.2 KF10 / §7.4 A3, KR6) — and to honestly record the two accepted v1 residual risks
  a fresh machine runs aof mesh join <code> with ONLY the code the operator read off aof mesh invite and is admitted + issued a working credential + git-remote configured, and an agent inspects where the credential lives at rest (R-1) and whether the code is observable in flight on a TLS-less LAN (R-3),
  so that an outsider confirms the single-code join works end-to-end with no manual credential copying, and the two documented residual risks are RECORDED (not mitigated) as evidence in the milestone VERIFICATION.md.

  # ARCHITECTURE ADR-002 + ADR-003 + SECURITY.md R-1 (T5) / R-3 (T2/T4): @manual — a genuine fresh-
  # machine join over a REAL endpoint + a REAL git remote, plus the two accepted-residual-risk pen-
  # tests SECURITY.md routes here by name (credential-at-rest R-1, code-in-flight R-3). This is BOTH
  # the outsider-verifiable KR6 headline (one code, no key copying) AND the residual-risk pen-tests —
  # neither is a unit-CI assert: the single-code join is proven end-to-end on real hardware over a real
  # network, and the pen-tests are human/agent-observed at-rest / in-flight inspections. The
  # @executable half is already covered WITHOUT a fresh machine: task 00 (mint), task 01 (the match /
  # reject / TTL / attempt-cap matrix in-process), task 02 (join stores the credential + provisions
  # git-remote argv-form in-process). Only the real fresh-machine join + the at-rest/in-flight
  # inspections need a real fleet. The 3-OS matrix is the cross-milestone UAT (KR6's all-three-OSes
  # claim) — this pins the SINGLE-CODE join observable + the two pen-tests on one real join; the OS
  # matrix is recorded at the milestone UAT, not re-run per story.
  #
  # QA FEASIBILITY FLAG (developer-amigo): @manual — a genuine fresh-machine join over a real /enroll
  # endpoint on a real control node + a real git remote, driving ONLY the registered aof mesh commands
  # (never hand-editing config or the registry). The pen-tests are human / agent-observed inspections:
  # R-1 is a filesystem inspection of where config.mesh.credential lives on the joined node + whether a
  # co-located process can read it; R-3 is a packet / wire observation of the 6-digit code in flight on
  # a TLS-less LAN. Both are RECORDED as residual-risk evidence in VERIFICATION.md at verify — they are
  # documented, NOT mitigated (Phase-5+). Tag UNCHANGED at @manual — do NOT collapse a real fresh-
  # machine join or a wire/at-rest inspection into an @executable assert.
  Background:
    Given a real control node running serveRelay with the enrollment endpoint reachable over a LAN
    And a shared git remote the group's git-of-record lives on
    And a FRESH machine with aof installed, holding NO credential and NO manual keys
    And the fresh machine drives only the registered aof mesh commands (no hand-edited config or registry)

  # KR6 — the headline single-code join: the operator runs aof mesh invite on the control node, reads
  # the 6-digit code aloud, and the fresh machine runs aof mesh join <code> with ONLY that code — no
  # key file, no manual credential copying — and comes out admitted + issued a working credential +
  # git-remote configured. The agent records the end-to-end evidence in VERIFICATION.md. R4: pin BOTH
  # halves — ONLY the 6-digit code was transported by hand (no key copied) AND the machine is fully
  # provisioned after (roster + credential + git-remote).
  Scenario: a fresh machine joins the fleet with only the 6-digit code — no manual credential copying
    Given the operator ran aof mesh invite on the control node and read off a 6-digit code
    When the fresh machine runs aof mesh join <code> with ONLY that 6-digit code (no key file, no manual copying)
    Then the fresh machine is admitted to the group roster on the control node
    And the fresh machine is issued a working mesh credential (relay auth + stream identity + git-remote grant)
    And the fresh machine's git-remote is configured against the group's git-of-record
    And ONLY the 6-digit code was transported by hand — no credential / key was manually copied (KR6)
    And the single-code join evidence is recorded in VERIFICATION.md

  # R-1 credential-at-rest pen-test (SECURITY T5) — a DOCUMENTED residual risk, recorded not mitigated.
  # The agent inspects WHERE the credential lives on the joined node (config.mesh.credential) and
  # confirms a co-located process can read it — the shared-remote blast radius v1 accepts (per-node
  # credential scoping is Phase-5+). The finding is RECORDED as accepted residual risk, not fixed.
  Scenario: credential-at-rest pen-test — where the credential lives on the joined node (R-1, recorded residual risk)
    Given the fresh machine has joined and is holding its mesh credential
    When an agent inspects where the credential is stored at rest on the joined node
    Then the credential is found under config.mesh.credential on the joined node
    And a co-located process on the joined node can read it (there is no per-node credential scoping in v1)
    And this shared-remote blast radius is RECORDED as the documented v1 residual risk R-1 in VERIFICATION.md (accepted, not mitigated — Phase-5+)

  # R-3 code-in-flight pen-test (SECURITY T2/T4) — a DOCUMENTED residual risk, recorded not mitigated.
  # On a hostile LAN without TLS the agent observes the 6-digit code in flight (it is human-
  # transcribed, presented over the endpoint). v1 BOUNDS the value of an observed code with short-TTL
  # + single-use + attempt-cap (tasks 00/01) — it does not encrypt the transport. The finding is
  # RECORDED as accepted residual risk. R4: pin BOTH halves — the code IS observable in flight AND its
  # value is bounded (a captured code, if not used in-window, is worthless once the TTL expires / it is
  # consumed / the attempt-cap trips).
  Scenario: code-in-flight pen-test — the 6-digit code is observable on a TLS-less LAN, bounded by TTL + single-use + attempt-cap (R-3, recorded residual risk)
    Given a hostile observer on the same LAN without TLS on the enrollment transport
    When the fresh machine presents the 6-digit code to the endpoint and the observer captures the wire
    Then the 6-digit code is observable in flight (v1 does not encrypt the enrollment transport)
    And the value of the captured code is bounded by short-TTL + single-use + the attempt-cap (tasks 00/01)
    And a captured code is worthless once its TTL expires, it is consumed, or the attempt-cap trips
    And this in-flight exposure is RECORDED as the documented v1 residual risk R-3 in VERIFICATION.md (accepted, not mitigated — Phase-5+ / operator-knob)
