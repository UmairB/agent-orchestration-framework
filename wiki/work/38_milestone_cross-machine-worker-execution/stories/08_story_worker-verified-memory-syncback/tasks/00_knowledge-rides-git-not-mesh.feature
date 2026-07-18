@executable @cli @work @memory @distribution
Feature: Worker-verified knowledge rides GIT as committed markdown; NO recall-index bytes cross any mesh frame
  In order that knowledge produced on a worker reaches the control node WITHOUT a new wire protocol and without
  shipping a derived cache each machine can and must rebuild itself, the durable sync-back payload is plain
  committed markdown (record docs / RETROSPECTIVE `R<n>` / `ADR-NNN`) that travels on story-07's push-back +
  merge, while the graphify RECALL INDEX (`graphify-out/graph.json`, `src/graph-normalize.mjs`) stays
  gitignored, DERIVED, and machine-local — never placed on any mesh frame. There is nothing to send over the
  mesh; the knowledge rides git, and each machine rebuilds its own index locally.

  # ARCHITECTURE 38/ADR-016 — the load-bearing invariant: "the recall index NEVER crosses the mesh." Durable
  # knowledge rides GIT, not the mesh (invariant #1: no `graphify-out/`/`graph.json`/normalized-index payload on
  # a relay/directive/status frame — the index is never the payload); `graphify-out/` stays gitignored + derived
  # (invariant #2, m10/ADR-005 — fully rebuildable from the `.md`, so a lost index rebuilds from `git pull` +
  # `ingest`). RESEARCH §4.4 (MEASURED, source read): the index is gitignored at `.gitignore:4` `graphify-out/`,
  # enforced by `src/aof-gitignore.mjs`; a DERIVED cache, not a source of truth; `aof work memory ingest` only
  # updates whichever machine runs it — so there is nothing to transmit over the mesh.
  #
  # The mesh frame VOCABULARY carries no index slot: the down-frames are `buildDirectiveFrame`'s frozen five-key
  # `directive` (35/ADR-002) plus the additive `clone-credential`/`clone-url` frames; the up-traffic is the
  # `{ kind, nodeId, signal }` envelope; the control-frames are `{ type: joined|error }`. NONE has a slot on
  # which `graphify-out/graph.json` could ride. This feature asserts that OBSERVABLE frame-vocabulary contract +
  # the git-observable index facts. The DEEP source-wide runtime guarantee — no source ANYWHERE attaches index
  # bytes to ANY frame builder — is the arch-test `acd-memory-index-never-on-mesh` (ADR-016 invariant #1,
  # fitness fn 19), SPEC + armed at BUILD. Comment-only here; do NOT restate it as a Then.
  #
  # @executable, hermetic over a real LOCAL git checkout + the real `aof work memory ingest`, with the frame
  # vocabulary enumerated from the real frame builders — NO real mesh / second machine. The real cross-machine
  # worker-verified -> control-recall path is EXCLUSIVELY task 02's @manual soak.

  Background:
    Given a real local checkout whose merged markdown carries a worker-authored RETROSPECTIVE `R<n>` lesson and an `ADR-NNN` block
    And the control node's `aof work memory ingest` has rebuilt its own `graphify-out/` index from that markdown

  Scenario: the sync-back payload that reached the checkout is committed markdown, not an index
    Then the RETROSPECTIVE `R<n>` and `ADR-NNN` that carry the knowledge are git-tracked markdown files in the checkout
    And `graphify-out/graph.json` is NOT among the git-tracked files (it is never committed — it is gitignored + derived)
    And the knowledge is fully present in the committed markdown alone, with no companion index artifact travelling beside it

  Scenario: the recall-index path stays gitignored + derived + machine-local
    Then `graphify-out/graph.json` is git-ignored (`.gitignore:4` `graphify-out/`, enforced by `src/aof-gitignore.mjs`) and untracked
    When I delete `graphify-out/` and re-run `aof work memory ingest` over the same markdown
    Then the index is rebuilt purely from the `.md` (it carries no fact absent from the markdown — m10/ADR-005)
    And `aof work memory recall "<the worker lesson's keywords>"` returns the same worker-authored records as before the delete

  # The STRUCTURAL mesh-boundary assertion (PO-fixed): enumerate the mesh frame vocabulary and assert every kind's
  # on-the-wire key/payload set has no slot for the derived index — not merely "this run did not send it." The
  # source-wide "no builder EVER attaches it" scan is the arch-test (see the header note); here we pin the
  # observable frame-vocabulary contract each frame kind carries.
  Scenario Outline: no frame kind in the mesh vocabulary carries an index/graph payload
    Given the mesh frame `<frame_kind>` as produced by its real builder
    Then its on-the-wire key/payload set names no `graphify-out/`, `graph.json`, or normalized-index payload
    And there is no slot on `<frame_kind>` on which the derived recall index could ride

    Examples: the down-frames (control -> worker)
      | frame_kind                                                   |
      | directive (buildDirectiveFrame — the frozen five keys)        |
      | clone-credential (the additive down-frame)                    |
      | clone-url (the additive down-frame)                           |

    Examples: the up-traffic + control-frames
      | frame_kind                                                   |
      | the worker up-envelope { kind, nodeId, signal }               |
      | the { type } control-frame (joined / error)                  |
