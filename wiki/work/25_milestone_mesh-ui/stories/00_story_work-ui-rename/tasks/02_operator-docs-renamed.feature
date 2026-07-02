@docs @work @board @manual
Feature: the operator-facing docs call the board aof work ui — no live reference to the retired verb remains
  In order that an operator following any current doc lands on a verb that exists,
  every operator-facing reference to the board serve verb — the README / wiki drill-in guidance
  and any current how-to — reads aof work ui after the rename,
  so that no live doc still instructs aof work board, while the historical work records
  (milestone folders, retrospectives, past feature files) keep their original wording as records.

  # ADR-001: the rename is deliberate and complete on the OPERATOR-FACING surface. The CLI
  # usage strings are asserted @executable in task 00; this task owns the prose docs sweep —
  # a human-judged scan (@manual), because "operator-facing" vs "historical record" is a
  # judgement line, not a grep: wiki/work/** is the immutable delivery record (past
  # milestones legitimately say "aof work board" — history stays honest), while README /
  # current guidance must not.
  #
  # QA boundary notes (source-grounded, grep at contract time 2026-07-02):
  # - The LIVE operator-facing references to the retired verb are all in README.md: the
  #   built-front-end note (~line 23), the work command reference block (~line 84), and the
  #   milestone-map board row (~line 149). Under the PO's own boundary the README is wholly
  #   operator-facing, so ALL THREE rename — including the milestone-map row: it indexes the
  #   live command an operator would type, it does not quote history.
  # - The KEEP side has one case the bare "excluding the wiki/work records" phrasing would
  #   have swept by mistake: wiki/planning/PRD-decentralized-agent-orchestration.md — the
  #   planning record whose §8 SPECIFIES this rename. Its "aof work board" is the decision's
  #   SUBJECT, not an instruction; renaming it would erase the decision's own wording. The
  #   per-reference litmus is INSTRUCTS (an operator would run it today → rename) vs
  #   NAMES/RECORDS (quotes history or specifies the change → keep).
  # - Out of this @docs sweep's scope: the stale code comment naming the old verb in
  #   src/terminal-ws.mjs:52 — a code-comment nit for the rename diff (the task-00 seat),
  #   not a doc.
  #
  # DEV (feasibility read 2026-07-02, grep-confirmed): the three LIVE README surfaces exist at
  # the roles named — README.md:23 (built-front-end note), :84 (work-command reference block,
  # `aof work board [--port 4180]`), :149 (milestone-map row `| 03 | Work Board UI | \`aof work
  # board\` …`). All three INSTRUCT (an operator would type them today) → rename to "aof work ui".
  # The KEEP side is confirmed too: wiki/planning/PRD-decentralized-agent-orchestration.md names
  # "aof work board" at :144/:196/:283 — every one is the rename's SUBJECT ("→ aof work ui"),
  # never an instruction, so it stays (the INSTRUCTS-vs-NAMES litmus holds). The terminal-ws.mjs:52
  # comment is correctly OUT of this @docs scope — it is code, tracked as a build reminder on
  # task 00 (see 00_work-ui-verb-rename.feature's DEV note). This @manual sweep is feasible as
  # authored; no literal changed.
  Scenario: current operator guidance reads aof work ui
    When I scan the repo's operator-facing docs (README + current wiki guidance, excluding the wiki/work and wiki/planning records)
    Then every instruction for serving a work stream's board reads "aof work ui"
    And no current instruction tells the operator to run "aof work board"

  # The enumerated live surfaces (found at contract time) — each must read the new verb.
  # The rows name the surfaces by role, not line number, so the human scan survives README
  # drift between contract time and the sweep.
  Scenario Outline: each live README reference to the board serve verb reads the new name
    When I read <surface>
    Then its board-serving reference reads "aof work ui"
    And it no longer instructs "aof work board"

    Examples:
      | surface                                                              |
      | the README note that the work board serves a built front-end        |
      | the README work-command reference block                             |
      | the README milestone-map row naming the board milestone's command   |

  # History is a record, not a doc bug: the sweep must NOT rewrite past milestones'
  # SPEC/STATE/feature wording — and equally must not rewrite the records that DESCRIBE this
  # rename (the PRD, milestone 25's own docs), where the old verb is the subject being renamed.
  Scenario Outline: the records keep their original wording
    When I inspect <record>
    Then its "aof work board" wording is left exactly as written
    And the docs sweep did not edit that document

    Examples:
      | record                                                                                        |
      | a pre-rename milestone's SPEC / STATE / DESIGN (e.g. milestones 03, 06, 21, 22)               |
      | a pre-rename task .feature (e.g. 03/01's board-renders-stream.feature)                        |
      | a pre-rename VERIFICATION / retrospective (e.g. milestones 03, 21)                            |
      | the planning PRD that specifies this rename (wiki/planning) — the decision's subject, kept    |
      | milestone 25's own SPEC / ARCHITECTURE / STORY — they name both verbs to describe the rename  |
