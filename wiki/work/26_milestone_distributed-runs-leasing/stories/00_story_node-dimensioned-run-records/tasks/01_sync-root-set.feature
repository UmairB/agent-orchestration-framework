@cli @work @distribution @executable
Feature: The sync tick commits exactly its root set — the default set is the partition root alone, a mesh-aware set adds the runs pathspec, and an operator's unrelated edits are never swept in either mode
  In order to move run records over the same git bus that carries mesh records without ever sweeping an operator's working tree
  a sync tick stages and commits ONLY paths under its root set — defaulting to the partition root alone (today's behaviour, byte-for-byte), widened by argument to add the runs pathspec so run-record writes commit and push on the tick,
  so that a run record rides the bus exactly when asked, an in-flight record-doc or source edit is never folded into a machine commit in either mode, and the honest failure and clean no-op envelopes stay exactly as they are today.

  # ARCHITECTURE ADR-002 (story 00 / fitness #5): syncMesh(workspace, { roots }) — the staged
  # root becomes a root/pathspec SET defaulting [meshDir(workspace)]; every stage/diff/commit
  # pathspec AND the pulled-names diff iterate the set; the runs pathspec is resolved by ONE
  # pure helper beside the engine. The pull half is ALREADY branch-wide (a plain git pull) —
  # only the COMMIT half is scoped, which is the over-promise ADR-002 settles honestly.
  # Story 00 touches NO command file: the mesh-aware set is driven at the ENGINE seam (the
  # injected roots argument — stories 01/02 pass it in production); the mesh:sync command
  # keeps the default set, which the default-root rows below pin.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #5 (the default literal [meshDir], the pathspec iteration in source, the
  #    runs-pathspec resolver's single home) and the re-armed acd-mesh-sync-record-neutral
  #    gate (the engine never parses/imports record content — the SOURCE half of
  #    content-agnostic) are STRUCTURAL → ARCH-TESTS, never scenarios here.
  #  - THIS feature asserts the OBSERVABLE half: what a tick commits/pushes/pulls (envelope
  #    names and remote tips), what it refuses to sweep, and the exact failure/no-op
  #    envelope literals.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the push-failed rows ride the PROVEN harness seam
  # (test/mesh-git-sync-transport.test.mjs breaks ONLY the remote's push URL — deterministic,
  # no network). The pull-failed rows assume the mirror breakage (a broken FETCH url, or an
  # equivalent local arrangement) forces a failing pull just as deterministically — that seam
  # is NOT yet in the harness. If a deterministic no-network pull failure cannot be arranged,
  # the pull-failed rows are not reliably @executable in CI. RAISED — do NOT silently retag
  # or drop the rows; see VERIFICATION.
  #
  # RESOLVED (developer-amigo): the pull breakage IS arrangeable deterministically, no
  # network — the exact mirror of the proven push seam. Mechanism, LOCKED: after the
  # baseline commit+push, repoint the clone's FETCH url at a non-existent local bare
  # path via `git remote set-url origin <tmp>/does-not-exist.git` (the sibling of
  # test/mesh-git-sync-transport.test.mjs breakPushRemote, lines 124–127, which uses
  # `set-url --push`; plain `set-url` rewrites the fetch url). `git remote` still lists
  # origin (hasRemote stays true, src/mesh-sync.mjs:72–75), the tick reaches the pull,
  # and `git pull` fails immediately with "does not appear to be a git repository" —
  # deterministic, offline, no timeout. The engine's pull PRECEDES its push and returns
  # the pull-failed envelope before any push runs (src/mesh-sync.mjs:165–170), so the
  # shared-url rewrite cannot bleed into the push half; optionally re-set the push url
  # (`set-url --push origin <bare>`) as belt-and-braces against a future reorder. The
  # pull-failed rows STAY @executable.
  Background:
    Given a local git work stream with a configured bare remote I control
    And a published mesh record under the partition root, already committed and pushed (a clean baseline tip)
    And a work item whose run records I can write under its runs tree
    And sync ticks accept an injected root set, defaulting to the partition root alone

  # THE DEFAULT-ROOT SCOPE MATRIX (ADR-002 — the default preserves today's behaviour
  # byte-for-byte). Each row leaves exactly ONE pending write in the working tree and runs
  # one default-root tick. Only a write under the partition root is committed; a run record —
  # OUTSIDE the partition root — is NOT (the honest scope: before this story the engine
  # header over-promised "runs sync with zero engine change"). The no-rows pin the operator-
  # safety floor twice over: the pending file stays uncommitted AND byte-intact.
  Scenario Outline: a default-root sync tick commits a partition-root write and nothing else
    Given the only pending working-tree change is <pending-write>
    When a sync tick runs with the default root set
    Then the tick <tick-outcome>
    And <after>

    Examples:
      | pending-write                              | tick-outcome                                             | after                                                                  |
      | a mesh record under the partition root     | commits and pushes it, reporting its path in pushed      | the remote branch tip contains the mesh record                         |
      | a run record under the item's runs tree    | is a clean no-op (nothing committed, nothing pushed)     | the run record stays uncommitted in the working tree, byte-intact      |
      | an operator's record-doc edit (a STORY.md) | is a clean no-op (nothing committed, nothing pushed)     | the record-doc edit stays uncommitted in the working tree, byte-intact |
      | an unrelated source-file edit              | is a clean no-op (nothing committed, nothing pushed)     | the source edit stays uncommitted in the working tree, byte-intact     |

  # THE WIDENED SCOPE (ADR-002 decision): with the runs pathspec in the set, a run-record
  # write IS the tick's business — committed, pushed, and reported in the envelope's pushed
  # names, landing on the remote byte-for-byte as written.
  Scenario: a mesh-aware root set commits and pushes a pending run record and reports it in pushed
    Given a pending run record under the item's runs tree at its runs/node-a/ path
    When a sync tick runs with the mesh-aware root set (the partition root plus the runs pathspec)
    Then the tick commits and pushes
    And the envelope's pushed names include the run record's path
    And the remote branch tip contains the run record byte-for-byte as written

  # THE OPERATOR-SAFETY INVARIANT SURVIVES THE WIDENING (ADR-002 alternatives: "stage the
  # whole workDir" was REJECTED for exactly this hazard). A mesh-aware tick that carries the
  # run record STILL never sweeps in-flight operator edits: record docs and source files are
  # in NO root set — deliberately (cross-node record-doc propagation rides the normal git
  # workflow; correctness rests on the lease, never on fresh frontmatter).
  Scenario: a mesh-aware tick carries the run record but never sweeps an operator's unrelated edits
    Given a pending run record under the item's runs tree
    And a pending operator edit to a record doc (a STORY.md)
    And a pending edit to an unrelated source file
    When a sync tick runs with the mesh-aware root set
    Then the tick's commit contains the run record and only root-set paths
    And the record-doc edit stays uncommitted in the working tree, byte-intact
    And the source-file edit stays uncommitted in the working tree, byte-intact
    And the remote branch tip contains the run record and neither operator edit

  # THE PULL HALF IS ALREADY BRANCH-WIDE (ADR-002 context: a plain pull brings peers' commits
  # regardless of path) — but the envelope's pulled NAMES iterate the root set. Both halves
  # pinned: a peer's run record lands ON DISK under either root set (durability never depends
  # on the scope argument); only the mesh-aware set REPORTS it (the envelope never claims
  # scope it was not given).
  Scenario Outline: a peer's run record on the remote arrives on disk under either root set and is reported only by the mesh-aware set
    Given the remote branch tip carries a peer's run record this clone has not seen
    When a sync tick runs with <root-set>
    Then the tick does not fail
    And the peer's run record is present in the working tree byte-for-byte
    And the envelope's pulled names <pulled-report>

    Examples:
      | root-set                | pulled-report                       |
      | the default root set    | do not list the run record's path   |
      | the mesh-aware root set | list the run record's path          |

  # THE CLEAN NO-OP IS UNCHANGED IN BOTH MODES (ADR-002: the widened argument must not
  # disturb the no-op tick the m22/m23 loops rely on): nothing pending anywhere ⇒ no commit,
  # HEAD unmoved, tree byte-unchanged, the envelope's noop true — identical under either set.
  Scenario Outline: a tick with nothing pending anywhere is the same clean no-op under either root set
    Given no pending working-tree changes and no unseen peer commits
    And I record the current HEAD commit and the working-tree state
    When a sync tick runs with <root-set>
    Then the envelope is the clean no-op shape (nothing committed, nothing pushed, nothing pulled, noop true)
    And no commit is created and HEAD is the same commit as before
    And the working tree is byte-unchanged

    Examples:
      | root-set                |
      | the default root set    |
      | the mesh-aware root set |

  # THE HONEST FAILURE ENVELOPES ARE UNCHANGED (ADR-002 consequences — ADR-003 builds its
  # lease arbitration on exactly these literals, so they are load-bearing): a failed network
  # half never reports success and never claims to have moved records — pushed comes back
  # EMPTY on failure. Reason literals exact: "push-failed" / "pull-failed", in BOTH modes.
  # See the QA FEASIBILITY FLAG above on arranging the pull failure deterministically.
  Scenario Outline: a failed network half returns the same honest failure envelope under either root set
    Given a pending <pending-write>
    And the remote is arranged so the <failing-half> fails
    When a sync tick runs with <root-set>
    Then the envelope reports synced false with reason "<reason>"
    And the envelope's pushed names are empty (a failed sync never claims it moved records)
    And the pending write is still safe in the local tree (committed locally at most — never lost)

    Examples:
      | pending-write                            | failing-half | root-set                | reason      |
      | mesh record under the partition root     | push         | the default root set    | push-failed |
      | run record under the item's runs tree    | push         | the mesh-aware root set | push-failed |
      | mesh record under the partition root     | pull         | the default root set    | pull-failed |
      | run record under the item's runs tree    | pull         | the mesh-aware root set | pull-failed |

  # CONTENT-AGNOSTIC OVER THE WIDENED SCOPE (ADR-002: the engine moves bytes, parses nothing
  # — the SOURCE-level record-neutrality is fitness #5's re-armed gate; THIS pins the
  # observable half over the NEW root, mirroring the m22 payload-agnostic proof): a file
  # under the runs pathspec moves byte-for-byte whatever its content — an unknown JSON shape
  # and non-JSON bytes both ride unmodified.
  Scenario Outline: a mesh-aware tick moves a runs-tree file byte-for-byte whatever its content
    Given a pending file "<file>" under the item's runs tree containing <content>
    When a sync tick runs with the mesh-aware root set
    Then "<file>" is committed and pushed byte-for-byte unchanged
    And the remote branch tip contains "<file>" with identical bytes

    Examples:
      | file              | content                            |
      | future-shape.json | arbitrary JSON of an unknown shape |
      | opaque.bin        | non-JSON binary-ish bytes          |
