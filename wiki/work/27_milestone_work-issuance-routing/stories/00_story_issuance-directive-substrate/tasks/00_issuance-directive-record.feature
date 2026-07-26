@cli @work @distribution @executable
Feature: An issuance directive assembles as exactly six frozen keys under its issuer's partition, and every issuer's directives read back as one union
  In order to give routing (story 01) and the fleet-UI affordance (story 02) ONE frozen contract two nodes can both write without ever contending for a path
  a directive assembles as exactly the six keys { itemRef, issuer, target, state, issuedAt, aofVersion } in that order — its target the discriminated union any|node|capability, its state "issued", its issuedAt an ISO-8601 UTC-Z instant — and readIssuanceDirectives walks EVERY issuer partition returning the union, absence-tolerant and torn-file-skipping, so a fixture-written directive round-trips byte-faithfully,
  so that an item issued by two different nodes yields two directive files the reader unions (never resolves a winner), a workspace with no issuance tree reads as an empty list rather than a throw, and one torn file never blinds the healthy directives.

  # ARCHITECTURE ADR-001 (story 00 — the directive record substrate): a new .mesh/
  # record class, per-ISSUER partitioned at .mesh/issuance/<issuer>/<item-ref>.json
  # (the 22/ADR-002 partition invariant held STRICTLY — partitioning by ISSUER keeps
  # every merge add-only even when two nodes issue two different items, ADR-001.1). The
  # FROZEN six-key schema (ADR-001.2, top-level keys in this order): { itemRef, issuer,
  # target, state, issuedAt, aofVersion } — target the discriminated union
  # { kind:"any" } | { kind:"node", nodeId } | { kind:"capability", value } (ADR-001.2 /
  # ADR-003); state one of { issued, withdrawn, fulfilled } (ADR-001.3, the
  # issued → withdrawn | fulfilled lifecycle); issuedAt ISO-8601 UTC-Z provenance ONLY —
  # NEVER a clock/arbitration key (no expiry key: a directive does not lapse on a clock,
  # unlike a presence-tied lease); aofVersion provenance (mirrors node/presence/lease
  # records). readIssuanceDirectives is the readLeaseClaims walk ONE level deeper
  # (issuance/<issuer>/<ref>.json vs leases/<item>/<node>.json), absence-tolerant
  # ([] on no dir) + torn-file-skipping (the mesh-store per-file skip discipline,
  # src/mesh-lease.mjs readClaimDir). The reader UNIONS every issuer's directives — it
  # never resolves a "winner" (ADR-001.1, the readLeaseClaims union idiom; the lease
  # arbitrates the actual claim, this reader only surfaces the offers).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #2 (acd-issuance-record-frozen): assembleDirective/readIssuanceDirectives
  #    carry EXACTLY the six keys in that NAME/ORDER, state ∈ {issued,withdrawn,fulfilled},
  #    target the {kind:any|node|capability} union — a SOURCE + import assertion over
  #    src/mesh-issuance.mjs; AND the .gitattributes **/.mesh/** rule MATCHES the real
  #    nested sample path wiki/work/<item>/.mesh/issuance/<node>/<ref>.json by git-semantics
  #    matching (NOT a literal grep; no new pin authored — the existing rule covers it,
  #    ADR-001.5 / 22/R3). Key ORDER + the EOL pin are fitness #2's seam, NOT scenarios.
  #  - THIS feature asserts the OBSERVABLE half: which six keys are PRESENT with which
  #    VALUES for each target kind, what readIssuanceDirectives returns over one / two / no
  #    issuer partitions, that a torn file degrades to one missing directive not a throw,
  #    and that a round-tripped directive reads back byte-faithfully.
  #
  # FIXTURE NOTE — story 00 writes are FIXTURE-WRITTEN. The production directive write
  # (issueDirective / the own-path atomic writeText at issuanceDirectivePath) is story
  # 01's, behind mesh:issue (ADR-001 consequences; ADR-002). Every scenario below places
  # directive files DIRECTLY at issuanceDirectivePath(ws, issuer, ref) via a test helper —
  # exactly as m26 story-00's 02_add-only-run-merge writes run records directly rather than
  # through a not-yet-built mint command. The subject under test here is assembleDirective
  # (a pure projection), readIssuanceDirectives (a pure read), and issuanceDirectivePath
  # (the reserved builder) — NOT any write verb.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the Scenario-Outline over target kinds asserts
  # the assembled key SET (and, jointly with fitness #2, the ORDER) by importing
  # assembleDirective from src/mesh-issuance.mjs IN-PROCESS. This assumes (a) assembleDirective
  # is an EXPORTED pure function taking plain data ({ itemRef, issuer, target, state,
  # issuedAt, aofVersion } — or the assembler derives state:"issued" + issuedAt itself from
  # an injected `now`), importable without touching fs/config/the network, exactly as
  # assembleClaimRecord (src/mesh-lease.mjs:56) and assembleDescriptor (src/node-identity.mjs:135)
  # are; and (b) issuanceDirectivePath is EXPORTED from src/mesh-store.mjs beside
  # leaseClaimPath, so the fixture writer can address the per-issuer path without re-joining
  # it. If assembleDirective instead requires a live config read to source issuer/aofVersion,
  # the key-set/round-trip rows need those supplied as injected data (the assembleDescriptor
  # `now ?? new Date().toISOString()` precedent) to stay @executable and deterministic.
  # RAISED — do NOT silently retag to @manual or drop a row; see VERIFICATION.
  #
  # RESOLVED (developer-amigo): confirmed FEASIBLE, both (a) and (b) lock to the assumed
  # shape. (a) assembleDirective is a NEW export in src/mesh-issuance.mjs mirroring
  # assembleClaimRecord (src/mesh-lease.mjs:56 `export function assembleClaimRecord({ itemRef,
  # nodeId, state, claimedAt, runId = null, aofVersion })` — a bare object-literal return, zero
  # fs/config/network) — same shape here: `assembleDirective({ itemRef, issuer, target, state =
  # "issued", issuedAt, aofVersion })` returning the six-key literal verbatim (issuer/aofVersion
  # supplied AS INJECTED DATA by the caller, never a live config read inside the assembler — the
  # Background's "directive assembly accepts an injected issuedAt instant and provenance
  # supplied as data" is LOCKED as the contract, not just a fixture convenience). (b)
  # issuanceDirectivePath lands EXPORTED from src/mesh-store.mjs beside leaseClaimPath
  # (src/mesh-store.mjs:90 `export function leaseClaimPath(workspace, itemRef, nodeId)` — the
  # exact reservation idiom this story's own "Structural deliverable" row already names). Zero
  # rows drop; the outline runs in-process, pure-data, no fs.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the "issuedAt is an ISO-8601 UTC-Z instant" row
  # needs a DETERMINISTIC clock to stay a stable @executable assert. Confirm assembleDirective
  # accepts an injected `now` (the assembleDescriptor `now` precedent, src/node-identity.mjs:143)
  # so the row asserts a fixed instant verbatim rather than pattern-matching a wall-clock
  # string. If the assembler stamps wall-clock only, weaken the row to a shape assertion
  # (matches /^\d{4}-\d{2}-\d{2}T.*Z$/, a trailing-Z ISO instant) rather than an exact value —
  # but injected-now is the preferred resolution.
  # RAISED — see VERIFICATION.
  #
  # RESOLVED (developer-amigo): confirmed — the injected-now precedent is LOCKED, exact-value
  # assertion stays intact. assembleDescriptor's `publishedAt: now ?? new Date().toISOString()`
  # (src/node-identity.mjs:143) and assembleClaimRecord's caller-supplied `claimedAt`
  # (src/mesh-lease.mjs:56/61, always injected by acquireLease's `nowIso` at :298/317 — the
  # assembler itself never calls `new Date()`) are the two precedents; assembleDirective follows
  # assembleClaimRecord's stricter form: `issuedAt` is a REQUIRED parameter the assembler stamps
  # verbatim onto the record (no `??` fallback inside assembleDirective itself — this story's
  # Background already locks "directive assembly accepts an injected issuedAt instant … supplied
  # as data", so the row's exact-value assert `its issuedAt reads "2026-07-03T10:00:00.000Z"
  # (verbatim)` is the CONTRACT, not merely deterministic-for-testing). Any wall-clock default
  # (`new Date().toISOString()` on a missing `issuedAt`) is the CALLER's concern (story 01's
  # mesh:issue command, which sources `now` the same way commands/run-start.mjs does today) —
  # out of this story's pure-assembly scope. No row weakens to shape-matching.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And an issuance record store where I can place directive files directly at issuanceDirectivePath(workspace, issuer, itemRef) via a test helper
    And directive assembly accepts an injected issuedAt instant and provenance supplied as data

  # THE ASSEMBLY MATRIX (ADR-001.2 / ADR-003 — the six-key freeze, per target kind): a
  # directive assembles as EXACTLY the six keys, in order, carrying state "issued" and the
  # injected issuedAt/aofVersion — for EACH of the three target-union arms. The target rides
  # ON the record as a discriminated union keyed by `kind` (never a bare string that
  # conflates a node id with a capability value, ADR-001.2). Key PRESENCE + the target-union
  # SHAPE + the values are pinned here; key ORDER is fitness #2's seam (acd-issuance-record-frozen).
  Scenario Outline: a directive assembles as exactly six keys carrying its target union arm and state "issued"
    When a directive is assembled for item "27/00" issued by "node-a" with target <target-input> and injected issuedAt "2026-07-03T10:00:00.000Z"
    Then the assembled record carries exactly the keys itemRef, issuer, target, state, issuedAt and aofVersion — no more, no fewer
    And its itemRef reads "27/00" and its issuer reads "node-a"
    And its state reads "issued"
    And its issuedAt reads "2026-07-03T10:00:00.000Z" (an ISO-8601 UTC-Z instant, verbatim)
    And its aofVersion reads the injected provenance value (never absent)
    And its target reads <target-shape>

    Examples:
      | target-input                     | target-shape                                        |
      | any                              | { kind: "any" }                                     |
      | node "build-server"              | { kind: "node", nodeId: "build-server" }            |
      | capability "codex"               | { kind: "capability", value: "codex" }              |

  # THE UNION READ ACROSS ISSUER PARTITIONS (ADR-001.1 — the readLeaseClaims union, one
  # level deeper): readIssuanceDirectives walks EVERY issuer subtree under issuance/ and
  # returns the union of all issuers' directives. TWO DIFFERENT issuers each holding a
  # directive for the SAME item ⇒ BOTH returned (the reader never resolves a winner — two
  # issuers of one item yield two directives, exactly as two lease claims union, ADR-001.1).
  # The itemRef comes from each RECORD, never re-derived from the flatLeaf'd directory name.
  Scenario: two different issuers each with a directive for the same item both read back in the union
    Given issuer "node-a" has a directive for item "27/00" targeting any at its issuance/node-a/ partition
    And issuer "node-b" has a directive for item "27/00" targeting capability "codex" at its issuance/node-b/ partition
    When the workspace's issuance directives are read
    Then exactly two directives return
    And one carries issuer "node-a" with target { kind: "any" } and the other carries issuer "node-b" with target { kind: "capability", value: "codex" }
    And both carry itemRef "27/00" (the reader unions the two issuers, it never resolves a winner)

  # THE MULTI-ITEM MULTI-ISSUER UNION (ADR-001.1): the walk spans every item across every
  # issuer partition — one issuer's several items and several issuers' items all land in the
  # one union list. The reader is a flat union, not grouped by item or by issuer.
  Scenario: directives for multiple items across multiple issuers all read back in one union
    Given issuer "node-a" has directives for items "27/00" and "27/01" at its issuance/node-a/ partition
    And issuer "node-b" has a directive for item "27/02" at its issuance/node-b/ partition
    When the workspace's issuance directives are read
    Then exactly three directives return
    And their itemRefs are exactly "27/00", "27/01" and "27/02" across issuers "node-a", "node-a" and "node-b"

  # ABSENCE IS BENIGN (ADR-001 / the mesh-store readNodeRecords/readLeaseClaims discipline,
  # src/mesh-lease.mjs:86–93): a workspace that has never had a directive issued — no
  # .mesh/issuance/ directory at all — reads as the EMPTY list, never a thrown error. A read
  # mutates nothing.
  Scenario: a workspace with no issuance directory reads as an empty list, never a throw
    Given the workspace has no .mesh/issuance/ directory
    When the workspace's issuance directives are read
    Then an empty list returns
    And no error is raised

  # TORN-FILE TOLERANCE (ADR-001 / the mesh-store per-file torn-skip, src/mesh-lease.mjs:110–118):
  # one unparseable directive file degrades to ONE missing directive — it never blinds the
  # healthy directives and never throws. Spans issuers: a torn file under one issuer's
  # partition does not blind another issuer's directive. A non-.json entry is ignored.
  Scenario: a torn directive file is skipped and the rest still read
    Given issuer "node-a" has a valid directive for item "27/00" at its issuance/node-a/ partition
    And issuer "node-b" has an unparseable torn directive file at its issuance/node-b/ partition
    And issuer "node-a" has a valid directive for item "27/01" at its issuance/node-a/ partition
    When the workspace's issuance directives are read
    Then exactly two directives return (the two valid node-a directives)
    And no error is raised (the torn file degrades to one missing directive, never a failed read)

  # THE ROUND-TRIP (ADR-001.2 — the store persists the record opaque; the reader returns it
  # faithfully): assemble a directive → the fixture writer places it at
  # issuanceDirectivePath(ws, issuer, ref) → readIssuanceDirectives returns it byte-faithfully
  # (every key/value preserved, key order preserved — the mesh-store opaque persist +
  # absence-tolerant read). Both target arms are round-tripped so the union shape survives the
  # git seam byte-for-byte (the poll-for-durability discipline the .mesh/ EOL pin backs, fitness #2).
  Scenario Outline: an assembled directive round-trips through its issuer path byte-faithfully
    Given a directive assembled for item "<item>" by issuer "<issuer>" with target <target-input> and injected issuedAt "2026-07-03T10:00:00.000Z"
    And that directive written to issuanceDirectivePath(workspace, "<issuer>", "<item>")
    When the workspace's issuance directives are read
    Then exactly one directive returns
    And it is byte-faithful to the assembled record — every key and value preserved, key order preserved
    And its target reads <target-shape>

    Examples:
      | item  | issuer      | target-input          | target-shape                                  |
      | 27/00 | node-a      | node "build-server"   | { kind: "node", nodeId: "build-server" }      |
      | 27/01 | build-server | capability "claude"  | { kind: "capability", value: "claude" }       |
