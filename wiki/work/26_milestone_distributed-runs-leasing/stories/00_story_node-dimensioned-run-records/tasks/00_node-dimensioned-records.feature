@cli @work @distribution @executable
Feature: A run record carries its node and lands under its node's partition, and every reader sees one union of flat and node-partitioned runs
  In order to let two nodes record runs against one shared work stream without ever contending for a path
  a run minted with a node id persists under the item's runs/<node>/ partition carrying node as a record key, a run minted without one stays at the flat legacy path with node null, and every reader — the run list, the dedup guard, completion's target resolution, the run-id mint — sees the UNION of flat entries and one level of node subdirs,
  so that a single-node install behaves exactly as today, every legacy record reads forward benignly, and two nodes' records can never hide a duplicate from each other or collide on a run id even before their trees converge.

  # ARCHITECTURE ADR-001 (story 00 / fitness #1–#4): the m22-frozen runNodeRecordPath
  # convention made real in src/run-store.mjs — the record gains ONE additive `node` key
  # (string | null, the FOURTEEN-key freeze superseding 20/ADR-001's thirteen); the persist
  # derives placement FROM the record (record.node set ⇒ nested, null ⇒ flat — record→path,
  # never path→record); readRuns/readRun/applyTransition resolve across the UNION; the dedup
  # guard (20/ADR-006) and completeRun's no-runId resolution therefore span nodes; the mint's
  # seq seed and write-if-absent probe count/check the union. The mint's `now` and `node`
  # arrive as injected DATA (startRun/mintRun options — the store reads no config).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #1 (runNodeRecordPath defined ONCE in run-store.mjs, re-exported by
  #    mesh-store.mjs; no second join of runsDir + node), #2 (the fourteen-key NAME/ORDER
  #    freeze), #3 (the .gitattributes R3 pin matching the real nested path), and #4
  #    (run-store imports no mesh module, reads no config) are STRUCTURAL invariants over
  #    source, imports, key order, and repo config → ARCH-TESTS, never scenarios here.
  #    Key ORDER in particular is asserted ONLY by fitness #2; the scenarios below assert
  #    key PRESENCE and VALUE.
  #  - THIS feature asserts the OBSERVABLE half: where records land on disk, what reads back
  #    (values, ordering, error codes), and that every refusal writes nothing.
  #
  # QA CONTRACT NOTE (product-owner + developer amigos) — the "byte-identical to today"
  # literal for the no-node mint, LOCKED (the 22/R2 get-the-boundary-literal-right
  # discipline): a fourteen-key record (fitness #2 freezes `node` APPENDED, defaulting null)
  # cannot be raw-byte-identical to a pre-m26 thirteen-key record. The locked reading, which
  # the flat-mint scenario below asserts: byte-identical applies to the PLACEMENT (the flat
  # legacy runs/<run-id>.json path) and to the thirteen legacy keys' names and values — the
  # one delta is the additive `node: null`, which every legacy reader ignores benignly
  # (exactly how the four m20 resilience keys landed on m19 records).
  #
  # RESOLVED (developer-amigo): CONFIRMED — the locked reading is the right executable
  # assertion; no tighter one is needed. Wire the flat-mint scenario as: (a) PLACEMENT —
  # the file exists at runRecordPath(item, runId) (src/run-store.mjs:59) and NO node
  # subdir exists under runs/; (b) the PARSED record's thirteen legacy keys carry exactly
  # today's mint values for the same injected inputs (state "running", attempt 1, outcome
  # null, sessionId null, brief {}, createdAt/updatedAt = the injected instant verbatim,
  # four resilience keys null); (c) node reads null. Do NOT raw-byte-compare the whole
  # file here: key ORDER is fitness #2's seam (acd-run-record-node-additive), and the
  # persist stays JSON.stringify(record, null, 2) (src/run-store.mjs:145) — so (values
  # verbatim, this scenario) ∧ (the fourteen-key order freeze, fitness #2) ∧ (the
  # unchanged pretty-persist) together ARE byte-identity on the thirteen-key prefix,
  # with the single trailing `"node": null` line as the additive delta.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And a work item whose runs live in its own runs directory, where I can place fixture run records at flat and node-subdir paths
    And run mints accept an injected creation instant and an optional node id supplied as data

  # THE MINT-PLACEMENT MATRIX (ADR-001.3 — placement derives FROM the record): a node id
  # supplied at mint time places the record under ONE <node>/ segment between runs/ and the
  # run-id leaf (the m22-frozen convention — the run-id LEAF is byte-identical to the flat
  # leaf form); no node id ⇒ the flat legacy path. The node value rides ON the record, so a
  # record read in isolation knows its owner without path archaeology. The not-at column pins
  # the exclusivity: a run lands at exactly one path, never both.
  Scenario Outline: a minted run's placement and node key derive from the node id supplied at mint
    Given no runs exist for the item
    When a run is started for the item with node id <node-supplied> and a fixed injected creation instant
    Then the run record is persisted <persisted-at>
    And the persisted record's node key reads <node-key>
    And no run record exists <not-at>

    Examples:
      | node-supplied        | persisted-at                                                | node-key | not-at                     |
      | "node-a"             | under the runs/node-a/ subdir with the run-id leaf unchanged | "node-a" | at the flat runs/ path     |
      | absent (not supplied) | at the flat legacy runs/<run-id>.json path                  | null     | under any node subdir      |

  # THE SINGLE-NODE FLOOR — the no-node mint is today's behaviour (SPEC: single-node installs
  # keep working UNCHANGED; ADR-001 constraint 1). Asserted per the LOCKED reading above: the
  # flat placement, the thirteen 20/ADR-001 keys carrying exactly the values today's mint
  # writes (state running, attempt 1, retryOf null, outcome null, createdAt = the injected
  # instant), plus the one additive node: null.
  Scenario: a run minted without a node id keeps the single-node install's flat behaviour with node null appended
    Given no runs exist for the item
    When a run is started for the item with no node id and injected creation instant "2026-07-02T10:00:00.000Z"
    Then the run record is persisted at the flat legacy runs/<run-id>.json path
    And the record's state reads "running" with attempt 1, outcome null, and retryOf null (the thirteen legacy keys as today's mint writes them)
    And the record's createdAt reads "2026-07-02T10:00:00.000Z" verbatim
    And the record's node key reads null (the one additive delta — benign to every legacy reader)

  # THE READ-FORWARD MATRIX (ADR-001.2 + 19/ADR-002 "absence is benign"): every generation of
  # record on disk reads through ONE normalization — a nine-key m19 record, a thirteen-key m20
  # record, and a fourteen-key node record are the same record to every reader. Absence of
  # `node` is never an error and never a distinct shape.
  Scenario Outline: run records of every generation read forward through one normalization
    Given a run record file on disk shaped as <record-shape> placed <location>
    When the item's runs are read
    Then exactly one run returns and no error is raised
    And its node key reads <node-reads>
    And <also>

    Examples:
      | record-shape                                 | location                  | node-reads | also                                                               |
      | a nine-key milestone-19 record               | at the flat runs/ path    | null       | the four m20 resilience keys read null (defaulted, absence benign) |
      | a thirteen-key milestone-20 record           | at the flat runs/ path    | null       | the thirteen keys' values read back verbatim as written            |
      | a fourteen-key record carrying node "node-a" | under the runs/node-a/ subdir | "node-a" | the fourteen keys' values read back verbatim as written            |

  # THE UNION READ (ADR-001.4): one item's run history spans the flat dir AND one level of
  # node subdirs — one list, ordered runId-ASCENDING by the lexically-sortable id, regardless
  # of which partition each record lives in. The fixture interleaves the ids across locations
  # (the FLAT record holds the MIDDLE id) so the ordering provably sorts by runId, never by
  # directory walk order. Explicit id literals — the 22/R2 discipline.
  Scenario: reading an item's runs returns one runId-ascending union across the flat dir and every node subdir
    Given a run record with runId "20260702T090000000Z-0000" under the runs/node-a/ subdir
    And a run record with runId "20260702T100000000Z-0000" at the flat runs/ path
    And a run record with runId "20260702T110000000Z-0000" under the runs/node-b/ subdir
    When the item's runs are read
    Then exactly three runs return
    And they are ordered "20260702T090000000Z-0000" then "20260702T100000000Z-0000" then "20260702T110000000Z-0000" (the flat record sits BETWEEN the node records)
    And their node keys read "node-a", null, and "node-b" respectively

  # TORN-FILE TOLERANCE EXTENDS TO A NODE SUBDIR (ADR-001.4 "same normalization, same
  # torn-file tolerance"): a torn/unparseable file inside a node subdir degrades to ONE
  # missing run — it never blinds the rest of the union and never throws (the 19/ADR-002
  # derived-log discipline, now spanning partitions).
  Scenario: a torn run file inside a node subdir is skipped without blinding the union
    Given a valid run record under the runs/node-a/ subdir
    And an unparseable torn run file under the runs/node-b/ subdir
    And a valid run record at the flat runs/ path
    When the item's runs are read
    Then exactly two runs return (the node-a record and the flat record)
    And no error is raised (the torn file degrades to one missing run, never a failed read)

  # THE DEDUP GUARD SPANS THE UNION (ADR-001.4 widening 20/ADR-006): a peer node's record for
  # the SAME item blocks a new mint exactly when it is NON-TERMINAL — queued|running, the
  # closed equivalence class the guard has always read. Terminal states never block. A refusal
  # mints NOTHING anywhere (no new file, flat or nested) and carries the EXISTING code literal
  # "duplicate-run" — one guard widened, never a second code.
  Scenario Outline: a peer node's non-terminal run blocks a new mint across nodes and a terminal one does not
    Given a run record for the item under the runs/node-a/ subdir in state "<peer-state>"
    When a run is started for the item with node id "node-b"
    Then the mint is <outcome>
    And <effect>

    Examples:
      | peer-state | outcome                                 | effect                                                        |
      | queued     | refused with error code "duplicate-run" | no new run file exists under any partition of the item        |
      | running    | refused with error code "duplicate-run" | no new run file exists under any partition of the item        |
      | done       | minted                                  | the new record is persisted under the runs/node-b/ subdir     |
      | failed     | minted                                  | the new record is persisted under the runs/node-b/ subdir     |
      | cancelled  | minted                                  | the new record is persisted under the runs/node-b/ subdir     |

  # COMPLETION RESOLVES ACROSS THE UNION (ADR-001.4): with no runId supplied, the single
  # running run — wherever it lives — is the target. And the RECORD-DRIVEN PERSIST
  # (ADR-001.3) shows here on the WRITE-BACK: completing a node-partitioned run rewrites it
  # AT its node path — the record's node key decides placement on EVERY write, so a completed
  # run is never relocated to the flat path. R4: the unrelated flat terminal run is untouched.
  Scenario: completing without a runId resolves the one running run inside a node subdir and persists it back at its node path
    Given the item's only running run lives under the runs/node-a/ subdir
    And a terminal run at the flat runs/ path
    When the run is completed with outcome "done" and no runId supplied
    Then the node-a run's state reads "done"
    And the completed record is persisted at its runs/node-a/ path (never relocated to the flat path)
    And its node key still reads "node-a"
    And the flat terminal run's file is byte-unchanged

  # THE COMPLETION REFUSAL MATRIX — the no-runId resolution counts running runs ACROSS the
  # union: several running (whatever mix of partitions they span) ⇒ "ambiguous-run"; zero
  # running anywhere ⇒ "no-running-run". The flat+nested row is load-bearing: the union
  # counts the flat dir AND the subdirs as ONE population. The existing code literals are
  # unchanged; a refusal writes nothing (validate-before-write).
  Scenario Outline: completion without a runId is refused when the union holds zero or several running runs
    Given <running-fixture>
    When the run is completed with outcome "done" and no runId supplied
    Then the completion is refused with error code "<code>"
    And every run record file of the item is byte-unchanged (a refusal writes nothing)

    Examples:
      | running-fixture                                                                          | code           |
      | a running run under the runs/node-a/ subdir AND a running run under the runs/node-b/ subdir | ambiguous-run  |
      | a running run at the flat runs/ path AND a running run under the runs/node-a/ subdir     | ambiguous-run  |
      | only terminal runs, spread across the flat path and a node subdir                        | no-running-run |

  # RUNID UNIQUENESS SPANS THE UNION (ADR-001.4: the seq seed counts the union; the
  # write-if-absent probe checks the union): two nodes minting at the SAME injected instant
  # get DISTINCT ids — never a silent overwrite. Boundary literals explicit: the same instant
  # yields seq "-0000" then "-0001". Fixture note: the pre-existing node-a run is TERMINAL
  # (done) so the dedup guard does not fire — this scenario isolates the id mint, not the
  # guard (the guard has its own matrix above).
  Scenario: two nodes minting at the same injected instant get distinct run ids across the union
    Given a terminal done run under the runs/node-a/ subdir with runId "20260702T100000000Z-0000" (minted at injected instant "2026-07-02T10:00:00.000Z")
    When a run is started for the item with node id "node-b" at the same injected instant "2026-07-02T10:00:00.000Z"
    Then the new record's runId is "20260702T100000000Z-0001" (distinct from node-a's, same instant, next seq)
    And both records exist, each under its own node subdir
    And node-a's record file is byte-unchanged (the second mint never overwrote the first)
