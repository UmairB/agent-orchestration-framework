@cli @work @distribution @executable
Feature: mesh:status ADDITIVELY renders the issued directives (issuer, item, target) alongside nodes and boards — absence-tolerant, byte-identical with no directives
  In order to see who issued what and where it is targeted without breaking the m25 { nodes, boards } shape every existing consumer reads
  mesh:status appends an ISSUED section — one entry per non-withdrawn directive (issuer, item, target) — gated on config.mesh.nodeId exactly as the m26 lease section is; with NO directives the key is absent (or empty) and the render is byte-identical to today; and the --json face carries the directives as a stable additive key,
  so that the fleet render surfaces issuance additively (the LEASES/BOARDS layering idiom), an unconfigured install renders byte-identically, and no directive present ever leaves a dangling empty heading.

  # ARCHITECTURE ADR-004 (consequences — the additive mesh:status issued render, riding the
  # EXISTING mesh:status verb; NO gate re-armed, the 22/R1 inverse stays clean) + ADR-001
  # (the directive read — readIssuanceDirectives, the non-withdrawn hint) + 25/ADR-002
  # (mesh:status is the ONE fleet-data command both faces consume — the issued directives render
  # THROUGH it, so the fleet UI's assign affordance in story 02 reads them for free):
  #   - after the nodes + boards (+ m26 leases) projection, IF config.mesh.nodeId is a non-empty
  #     string, append result.issued = [ { issuer, itemRef, target } ] over readIssuanceDirectives,
  #     skipping withdrawn/fulfilled directives (only OPEN "issued" directives render);
  #   - ABSENT when mesh is unconfigured (the key never appears — byte-identical to today);
  #     [] when configured-but-empty (no dangling ISSUED heading — the never-blank discipline);
  #   - the human render appends an ISSUED section ONLY when result.issued is non-empty;
  #   - the --json face passes the { nodes, boards, leases?, issued? } shape through untouched.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - There is NO new fitness gate here: mesh:status is an EXISTING registered verb (no bijection
  #    re-arm — the 22/R1 inverse), and the render is an ADDITIVE projection (the m25/m26 idiom).
  #    fitness #1 (acd-issuance-write-scope) covers the read module's write discipline; the render
  #    itself is a PURE read (it writes nothing — asserted behaviourally here).
  #  - THIS feature asserts the OBSERVABLE render: the issued entries appear additively, the shape
  #    stays { nodes, boards } + the additive keys, absence is byte-identical, and the read
  #    mutates nothing.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the render is extensible additively ONLY if the m25
  # { nodes, boards } result object tolerates a THIRD additive key (issued) the way it already
  # tolerates the m26 `leases` key — i.e. the existing consumers (the m25 web face, the boards
  # projection, any --json reader) key off `nodes`/`boards` and IGNORE unknown keys, so appending
  # `issued` breaks nothing. The m26 lease section (src/commands/mesh-identity.mjs:262-286) proves
  # the pattern held once; this row RAISES whether a SECOND additive key composes as cleanly with
  # the render's section layering (nodes → BOARDS → LEASES → ISSUED, each appended only when
  # non-empty, no dangling heading). Confirm at build that the section order + the "append only
  # when non-empty" guard extend to a fourth section without perturbing the byte-identical
  # no-directives render. RAISED.
  #
  # RESOLVED (developer-amigo): CONFIRMED — a fourth additive section composes cleanly; no retag.
  # Verified against the real `meshStatusCommand` (`src/commands/mesh-identity.mjs:168-345`):
  #  - the JSON side (`:179-287`) already layers THREE additive keys onto the frozen `{ nodes,
  #    boards }` base (`:260`): `boards` is unconditional (`:259`), `leases` is APPENDED only
  #    `if (typeof localId === "string" && localId.length > 0)` (`:275-286`, the SAME
  #    `config.mesh.nodeId` gate this ADR reuses) — `result.issued` slots in identically: computed
  #    under the SAME `if (localId ...)` block (or its own sibling gate on the identical predicate),
  #    set to `[]` when configured-but-empty, appended to `result` right after `result.leases =
  #    leases;` (`:285`). Unconfigured mesh ⇒ the block never runs ⇒ `issued` never appears —
  #    byte-identical, exactly the existing `leases` absence behaviour.
  #  - the human render (`:303-339`) already stacks sections into a `sections` array (`:310`) and
  #    joins with `\n` at the end (`:338`): `nodesHalf` (always present), `BOARDS` (`:313-323`,
  #    pushed only `if (boards.length > 0)`), `LEASES` (`:325-336`, pushed only `if (leases.length >
  #    0)`). A fourth `ISSUED` section is ONE more `if (issued.length > 0) { sections.push("ISSUED",
  #    ...issuedLines); }` block appended AFTER the leases block, in the SAME array-push idiom — the
  #    "never-blank" discipline (push only when non-empty) already proven twice (boards, leases)
  #    extends to a third occurrence with zero structural risk: each section's push is independent
  #    and order-stable (`sections` is built top-to-bottom, so `nodes → BOARDS → LEASES → ISSUED` is
  #    simply one more line at the end of the existing chain, not a refactor of the first three).
  #  - byte-identical no-directives floor: with zero directives, `result.issued` is `[]` (mirrors
  #    the existing `leases: []` empty-but-present case at `:277-286` when claims is empty) and the
  #    render's `if (issued.length > 0)` guard never fires — no dangling `ISSUED` heading, matching
  #    the row's "byte-identical" scenario exactly as the LEASES section already satisfies its own
  #    empty-case scenario today.
  # No existing consumer is put at risk: `--json` passthrough is `(result) => result` (`:343`,
  # untouched) — an UNKNOWN additive key is simply present in the object; nothing in the codebase
  # destructures `mesh:status`'s result with a closed/exact shape (confirmed: the m25 web face and
  # `test/mesh-node-staleness-status.test.mjs` / `test/mesh-identity-status-commands.test.mjs` read
  # named keys off the result, never `Object.keys(result).length` or an exhaustive shape assert —
  # see the Build notes ripple-check below for the specific grep).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And mesh is configured with a stable config.mesh.nodeId "node-a" for this node
    And a synced roster and node descriptors I write directly

  # THE ADDITIVE ISSUED RENDER (ADR-004 consequences): with open directives on disk, mesh:status
  # appends an ISSUED entry per non-withdrawn directive — issuer, item, target — ALONGSIDE the
  # existing nodes/boards/leases sections. The { nodes, boards } shape is untouched; issued rides
  # additively (the m26 LEASES-section idiom, one section deeper).
  Scenario: mesh:status appends an ISSUED section per open directive alongside nodes and boards
    Given node-a issued "27/00" at { kind:"node", nodeId:"build-server" }
    And node-b issued "27/01" at { kind:"capability", value:"codex" }
    When I invoke mesh:status
    Then the result still carries the { nodes, boards } shape unchanged
    And result.issued carries an entry { issuer:"node-a", itemRef:"27/00", target:{ kind:"node", nodeId:"build-server" } }
    And result.issued carries an entry { issuer:"node-b", itemRef:"27/01", target:{ kind:"capability", value:"codex" } }
    And the human render appends an ISSUED section naming issuer, item, and target for each

  # ONLY OPEN DIRECTIVES RENDER (ADR-001.3 / ADR-004.2): a withdrawn (or fulfilled) directive is
  # spent — it is filtered out of the issued render exactly as a released lease is filtered from
  # the LEASES section. The render shows work still on offer, never a withdrawn hint.
  Scenario: a withdrawn directive is filtered out of the issued render
    Given node-a issued "27/00" and then withdrew it (state "withdrawn")
    And node-a issued "27/01" (state "issued")
    When I invoke mesh:status
    Then result.issued carries the open "27/01" entry
    And result.issued does NOT carry the withdrawn "27/00" entry (only open directives render)

  # NO DIRECTIVES ⇒ BYTE-IDENTICAL, ABSENCE-TOLERANT (ADR-004 consequences; the m26 empty-section
  # discipline): with zero directives on disk the render is byte-identical to today's — either
  # result.issued is [] (configured-but-empty, no dangling ISSUED heading) and the human render
  # appends nothing, matching the LEASES never-blank rule.
  Scenario: with no directives the issued render is empty and appends nothing — byte-identical to today
    Given the issuance tree is empty (no directives issued)
    When I invoke mesh:status
    Then result.issued is [] (configured-but-empty)
    And the human render appends NO ISSUED section (no dangling heading — byte-identical to today)

  # UNCONFIGURED MESH ⇒ THE KEY IS ABSENT (ADR-004.4, the config gate — the SAME predicate the
  # nodes/leases sections gate on): with no config.mesh.nodeId the issued read never runs — the
  # `issued` key never appears and the render is byte-identical to today's { nodes, boards }.
  # Directive files sitting on disk are invisible.
  Scenario: with mesh unconfigured the issued key is absent and directive files on disk are invisible
    Given directives sit on disk for "27/00" and "27/01"
    And config.mesh.nodeId is absent (mesh unconfigured)
    When I invoke mesh:status
    Then the result carries no `issued` key at all (the read never ran)
    And the render is byte-identical to today's { nodes, boards } render for that tree

  # THE --json FACE CARRIES THE DIRECTIVES (ADR-004 consequences / 25/ADR-002): the machine face
  # passes the { nodes, boards, leases?, issued? } shape through untouched — the story-02 fleet UI
  # assign affordance reads result.issued off THIS one command (mesh:status is the one fleet-data
  # command both faces consume). Human render and machine face are never mixed.
  Scenario: the --json face passes the issued directives through untouched alongside nodes and boards
    Given node-a issued "27/00" at { kind:"any" }
    When I invoke mesh:status --json
    Then the JSON carries nodes and boards unchanged
    And the JSON carries result.issued with the { issuer, itemRef, target } entry for "27/00"
    And the machine face is not mixed with the human render

  # THE CONTROL-NODE MARKER (25/ADR-002 — mesh:status is the ONE fleet-data command both faces
  # consume; DESIGN control-node-gated true-absence; SECURITY/ADR-006.3 framing): mesh:status ALSO
  # emits an additive `isControlNode` fact — a PURE read of isControlNode(config)
  # (config.mesh.relay.controlNode === config.mesh.nodeId, 24/ADR-001) — so the story-02 fleet UI
  # gates the [assign ▸] affordance to the control node (the true-absence render on a non-control
  # node). It is an additive key like `issued`/`leases`; it NEVER gates the render itself (a pure
  # marker a face reads); a non-control or unconfigured node reads it false. This is the story-01-
  # owned mesh:status addition story 02 CONSUMES (the cross-story seam — one data command).
  Scenario: mesh:status emits an additive isControlNode marker so the fleet UI can gate the assign affordance
    Given config.mesh.nodeId is "node-a" and config.mesh.relay.controlNode is "node-a" (this node IS the control node)
    When I invoke mesh:status
    Then result.isControlNode is true
    And the { nodes, boards } shape is otherwise unchanged (an additive marker, not a gate on the render)

  Scenario: a non-control node reports isControlNode false — the affordance's true-absence signal
    Given config.mesh.nodeId is "node-b" and config.mesh.relay.controlNode is "node-a" (this node is NOT the control node)
    When I invoke mesh:status
    Then result.isControlNode is false
    And the fleet UI reads this to render NO [assign ▸] affordance on this node (story 02 — the DESIGN true-absence)

  # THE ISSUED RENDER IS A PURE READ (ADR-004 consequences; the m25/m26 read-only invariant): like
  # the nodes/boards/leases projections, the issued render WRITES NOTHING — the issuance partition
  # root is byte-unchanged after a mesh:status call.
  Scenario: rendering the issued directives writes nothing — the issuance tree is byte-unchanged
    Given directives sit on disk for "27/00" and "27/01" and I record the issuance tree's byte-state
    When I invoke mesh:status
    Then the issuance partition tree is byte-unchanged (mesh:status is a pure read)
