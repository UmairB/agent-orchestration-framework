@ui @work @distribution @uat
Feature: the [assign ▸] affordance on the fleet board tile — the first write control on a read-only surface, control-node-gated, judged against the DESIGN binding checklist
  In order to issue / target work into the fleet from the fleet surface itself ("issue / assign this work into a board, from here" — PRD §7.2 KF9),
  the control node's fleet view renders a quiet [⊕ assign] control on each board tile whose picker targets any
  node / a specific node / a capability and whose Issue POSTs to /api/mesh/issue, while a non-control node's
  fleet view shows no such control at all,
  so that an operator routes work from the same screen where the whole fleet is visible, a plain runner node's
  view stays byte-identical to the m25 read-only surface, and the affordance reads as one calm action on an
  otherwise-unchanged read-only dashboard.

  # DESIGN.md §"The issue / assign affordance" — the mandatory BINDING CHECKLIST is the interim conformance
  # baseline this @uat review judges against (ADR-003 interim baseline; there is no fresh committed
  # affordance mock this pass — documented default 6). The checklist, in order:
  #   1. PLACEMENT — BOARDS region → board tile → action row (row 2), between the read-only run-state chip
  #      (left) and the Open board → drill-in (right): state (read) · assign (write) · open (navigate).
  #      Per-board-tile (default 1). Nothing in NODES / top bar / tile row-1 changes.
  #   2. COMPONENTS (all from the m03/m25 kit — no new component): trigger = a button (size="sm"), label
  #      "assign" + a lucide plus-circle/send glyph, primary/teal; picker = a Popover/Select anchored to the
  #      trigger (NOT a full modal), a single --to picker with three grouped kinds — Any node (default),
  #      Nodes (each nodeId + its presence dot, from the roster), Capabilities (advertised runtimes + N
  #      skills, from the node cards); confirm/dismiss = an "Issue ▸" button (primary/teal) + a "Cancel"
  #      (variant="ghost"/secondary), Escape/click-away also dismisses; context label = "Issue into <board>".
  #   3. STATES (all six): idle · control-node-gated-hidden · open/picking-target · submitting · success · error.
  #   4. DESIGN RAMP (no new colour): assign+Issue → primary/teal; Cancel → secondary/muted ghost; picker
  #      node dots → the m25 presence ramp verbatim; error → accent/crimson line + teal Retry; success → a
  #      quiet primary/teal micro-ack (NOT destructive, NOT a loud banner); destructive/red is NOT used.
  #
  # SEAM SPLIT — what is an arch-test / another task vs what this @uat review judges:
  #  - fitness #7 (acd-mesh-ui-write-isolation) is STRUCTURAL (the ONE write route reaches invoke) — task 00
  #    + task 03 own its behaviour; NOT judged here.
  #  - S-1 (acd-mesh-issue-route-same-origin) is the CSRF guard — task 01 owns it; the affordance's POST is
  #    the same-origin request that passes it (the affordance runs same-origin on the loopback face by
  #    construction), NOT re-asserted here.
  #  - The route MECHANICS (the POST reaches mesh:issue, the target union, the coded errors) are tasks 00/01.
  #  - THIS @uat review judges the VISUAL affordance against the DESIGN binding checklist: placement, the
  #    kit components, the six states, the design ramp, the control-node-gated ABSENCE, and the
  #    surface-stays-read-only rail. It is the design-conformance judgement (does it LOOK/READ right) — the
  #    functional/behavioural half (does the click WORK) is the @executable route in tasks 00/01.
  #
  # BROWSER LANE (QA-owned): these @uat scenarios are the design-conformance judgement handed to the
  #  designer (a rendered screenshot at the documented breakpoints, driven through the Playwright harness QA
  #  runs — the designer judges the handed render, QA runs the browser). Once the designer judges a render
  #  CONFORMS, that approved render becomes the toHaveScreenshot baseline QA's visual-regression guards
  #  against drift (the seam QA owns; building the baselines into a hard gate is a QA-owned follow-on, out of
  #  scope for this story). Submitting/success are MOTION states — the screenshot locks the presence of the
  #  in-flight spinner / success micro-ack; the transition animation is a functional harness check, not a
  #  pixel assert. The a11y lane is OFF for this story (no "a11y" in work.tags.domains — no axe-core run).
  #
  # QA FEASIBILITY FLAG (developer-amigo): is the control-node gate on the SERVER side, the CLIENT bundle,
  #  or BOTH — and how is the @uat ABSENCE judged? The gate is isControlNode(config) = config.mesh.nodeId
  #  === config.mesh.relay.controlNode (src/mesh-registry.mjs:69). BUT the fleet bundle reads its data from
  #  GET /api/mesh/status, and that aggregate today returns { nodes, boards } with a per-node `local` marker
  #  and NO isControlNode flag (src/commands/mesh-identity.mjs — the status projection). So the bundle CANNOT
  #  currently tell whether the viewing node is the control node. THE OPEN QUESTIONS: (i) does mesh:status
  #  gain an additive `isControlNode` (or `viewer:{ isControlNode }`) fact for the bundle to gate on
  #  client-side — a story-01 or story-02 status-render addition? OR (ii) is the gate ALSO/ONLY enforced
  #  server-side (the /api/mesh/issue route refuses on a non-control node, and the bundle hides the trigger
  #  when the fact is absent)? DESIGN default 3 mandates a TRUE ABSENCE (not a disabled/greyed control), so
  #  the bundle needs the fact to NOT render the trigger — which points to (i) being required regardless.
  #  AND: how is the @uat absence judged — a Playwright DOM-audit asserting the [⊕ assign] element is ABSENT
  #  from a non-control-node render (the m25 no-mutating-affordance DOM-audit idiom, m25 task 05), with the
  #  human confirming byte-identity to the m25 read-only tile? RAISED — the developer wave RESOLVES whether
  #  the status aggregate gains the control-node fact and whether the gate is client/server/both; do NOT
  #  fabricate a RESOLVED. (Note for the developer: ADR-006.3 frames the write as ALSO m24-boundary-gated —
  #  a non-control node's route refusal is a defence-in-depth belt beyond the client hide, but DESIGN's
  #  true-absence requires the client-side fact regardless.)
  #
  # RESOLVED (developer-amigo): CONFIRMED — isControlNode rides mesh:status as an additive fact; the gate
  #  is CLIENT-side (the true-absence render) AND SERVER-side (defence-in-depth on the route), matching the
  #  brief's resolution direction exactly. This is a CROSS-STORY seam: story 01 OWNS the mesh:status
  #  addition, story 02 CONSUMES it. No retag.
  #  SOURCE-CHECKED — the fact ALREADY EXISTS on the tree, authored by story 01's task 04
  #  (wiki/work/27_milestone_work-issuance-routing/stories/01_story_mesh-issue-routing-pickup/tasks/
  #  04_mesh-status-issued-render.feature:131-149, itself RESOLVED there): mesh:status appends
  #  `result.isControlNode` — a pure read of `isControlNode(config)` (`config.mesh.relay.controlNode ===
  #  config.mesh.nodeId`, src/mesh-registry.mjs:69-73) — UNCONDITIONALLY (NOT gated on `config.mesh.nodeId`
  #  being non-empty the way `leases`/`issued` are; a genuinely unconfigured node still reads
  #  `isControlNode: false`, never absent — task 04's two scenarios at lines 139-149 pin `true` for the
  #  control node and `false` for a non-control node, with "the { nodes, boards } shape otherwise
  #  unchanged" — an additive marker, never a gate on the render itself). Today's `mesh:status` (src/
  #  commands/mesh-identity.mjs:168-288) carries NO such key yet — story 01 lands it; story 02 (this task)
  #  is the FIRST consumer.
  #  CLIENT-SIDE GATE (the true-absence render, DESIGN default 3): the fleet bundle reads `isControlNode`
  #  off the SAME `GET /api/mesh/status` aggregate it already fetches (ADR-002's "one fleet-data command
  #  both faces consume" — no second request, no new endpoint) and renders the `[⊕ assign]` trigger IFF
  #  `status.isControlNode === true`; when false (or the key is somehow absent on an older aggregate), the
  #  board tile renders NOTHING extra in its action row — byte-identical to the m25 read-only tile (no
  #  conditional CSS/disabled attribute — a genuine branch that omits the element from the render tree, not
  #  a hidden/greyed DOM node, per DESIGN's "never a disabled/greyed control" mandate).
  #  SERVER-SIDE GATE (defence-in-depth, ADR-006.3's m24-boundary framing): `POST /api/mesh/issue`'s OWN
  #  authority is the m24 group-membership boundary (SECURITY T2, "inherited-green" — no NEW control owed
  #  at the route) PLUS the same `isControlNode(config)` read, checked server-side BEFORE invoking
  #  `mesh:issue` on the CONTROL-ISSUE path specifically (ADR-001.4: "the fleet-UI issue route is framed as
  #  the control-node issuing hub... it is offered/gated behind isControlNode(config)"). Concretely: the
  #  route reads `isControlNode(workspace.config)` the same way `mesh-registry.mjs:92` gates
  #  `writeRegistry`, and refuses (403/`not-control-node`-coded, or simply proceeds if the milestone's
  #  authors decide the CLI-parity underlying `mesh:issue` command itself stays member-authorized
  #  regardless of caller — ADR-001.4's literal text: "the underlying mesh:issue command itself is
  #  member-authorized, so the CLI enqueue works from any node" — meaning the SERVER-side control-node gate
  #  is a FACE-LEVEL policy choice for THIS route specifically, framing "issue via the fleet UI" as
  #  control-node-only even though the bare command is not). This task's `@uat` scope does not re-litigate
  #  that server-side enforcement decision (it is task 00/01's route-mechanics territory) — it is flagged
  #  here only so the client-side hide is never mistaken for the SOLE control (the brief's note, confirmed:
  #  "a non-control node's route refusal is a defence-in-depth belt beyond the client hide").
  #  THE @uat ABSENCE JUDGEMENT: a Playwright DOM-audit (the m25 no-mutating-affordance idiom, m25 task 05)
  #  asserts the `[⊕ assign]` element (by role/text, e.g. `getByRole("button", { name: /assign/i} )`) has
  #  ZERO matches on a non-control-node fixture render (`status.isControlNode: false`), PLUS a snapshot/DOM
  #  diff confirming the tile's remaining markup (run-state chip → "Open board →") is BYTE-IDENTICAL to the
  #  m25 read-only tile fixture — the automated half; the HUMAN reviewer then visually confirms the
  #  rendered screenshot reads as calm/unchanged (the designer's binding-checklist judgement this feature's
  #  header already frames as the `@uat` conformance review, per the BROWSER LANE note above). Both halves
  #  are this task's scope; neither substitutes for the other.
    Given a fleet server running against records I plant
    And a synced roster with named nodes carrying presence and advertised capabilities
    And a registry with registered boards on those nodes

  # STATE: idle — on the CONTROL node the board tile carries the [⊕ assign] trigger in the action row
  # (checklist 1 + 2 + state "idle"): the row reads state (read) · assign (write) · open (navigate); the
  # trigger is a size="sm" primary/teal button with the plus-circle/send glyph; the rest of the tile is
  # m25-unchanged (name/owner row-1, run-state chip, drill-in link).
  # [toHaveScreenshot candidate — the idle control-node board tile]
  Scenario: on the control node a board tile shows the quiet [assign] trigger in its action row (idle)
    Given the viewing node is the control node (isControlNode true)
    And the operator opens the populated fleet view
    When a board tile renders
    Then its action row reads left-to-right: the run-state chip, then the [⊕ assign] trigger, then the "Open board →" drill-in
    And the [assign] trigger is a small primary/teal button carrying the "assign" label and the plus-circle/send glyph
    And the rest of the tile (name, "on <owner>", run-state chip, drill-in) is unchanged from the m25 read-only tile

  # STATE: control-node-gated-hidden — on a NON-control node the affordance renders NOT AT ALL: the tile is
  # byte-identical to the m25 read-only tile, NOT a greyed/disabled control (DESIGN default 3 — a greyed
  # control would leak the concept onto a surface that must read as pure read-only). This is the security
  # lens's control-node framing, surfaced visually.
  # [Playwright DOM-audit candidate — the [assign] element is ABSENT on a non-control-node render]
  Scenario: on a non-control node the [assign] affordance is absent entirely — the tile is byte-identical to the m25 read-only tile
    Given the viewing node is NOT the control node (isControlNode false)
    And the operator opens the populated fleet view
    When a board tile renders
    Then no [assign] trigger appears anywhere on the tile (a TRUE absence, not a disabled/greyed control)
    And the tile is byte-identical to the m25 read-only tile: run-state chip, then the "Open board →" drill-in, nothing between
    And the whole fleet view reads as the calm m25 read-only surface (no leaked write concept)

  # STATE: open / picking-target — clicking [assign] opens the anchored popover (NOT a full modal, no page
  # dim), titled "Issue into <board>", target defaulting to Any node, with a Nodes group (each nodeId + its
  # m25 presence dot) and a Capabilities group (advertised runtimes + N skills), and Issue + Cancel present.
  # The picker renders the fleet's OWN roster/capability vocabulary — it invents no new list (DESIGN §"The
  # data the affordance reads").
  # [toHaveScreenshot candidate — the open picker anchored to the trigger]
  Scenario: clicking [assign] opens the anchored target picker with the three grouped kinds
    Given the viewing node is the control node
    And the operator opens the populated fleet view
    When the operator clicks the [assign] trigger on a board tile
    Then an anchored popover opens (not a full modal, no page dim), titled "Issue into <board>"
    And the target defaults to "Any node" (the untargeted { kind:"any" } default)
    And a "Nodes" group lists each nodeId with its m25 presence dot (live/stale/no-presence, verbatim)
    And a "Capabilities" group lists the advertised runtimes and the "N skills" from the node cards
    And an "Issue ▸" (primary/teal) button and a "Cancel" (ghost/secondary) button are present

  # STATE: submitting → success — submitting the picker POSTs { ref, to? } to /api/mesh/issue; the Issue
  # button reads a quiet in-flight state ("Issuing…" / spinner, inputs disabled, NO page takeover); on
  # success the picker closes and the tile shows a quiet primary/teal micro-ack ("issued ✓ — an eligible
  # node will pick it up"), then returns to idle. The confirmation is CALM, not a loud toast/banner.
  # [toHaveScreenshot candidate — the submitting in-flight + the success micro-ack; the transition is a functional check]
  Scenario: submitting POSTs to /api/mesh/issue and shows the quiet in-flight then the calm success confirmation
    Given the viewing node is the control node and the picker is open on a board tile
    When the operator picks a target and clicks "Issue ▸"
    Then the Issue button reads a quiet in-flight state ("Issuing…" / a spinner, inputs disabled, no page-level takeover)
    And the affordance POSTs { ref, to? } to "/api/mesh/issue" (the same-origin write route)
    And on success the picker closes and the tile shows a quiet primary/teal micro-acknowledgement ("issued ✓ — an eligible node will pick it up")
    And the tile then returns to idle (no loud toast/banner)

  # STATE: error — a failed POST shows an accent/crimson line + a Retry, scoped to the picker/tile (NOT the
  # whole page), mirroring the m25 page-error idiom (crimson text + a teal Retry pill) but tile-scoped.
  # accent/crimson is used HERE and only here (the "needs eyes" reservation); destructive/red is NOT used.
  # The read-only surface around the failed tile is unaffected.
  # [toHaveScreenshot candidate — the error line + Retry scoped to the picker/tile]
  Scenario: a failed issue shows the accent/crimson error line and a Retry, scoped to the tile
    Given the viewing node is the control node and the picker is open on a board tile
    And the /api/mesh/issue POST will fail (a coded error from the route — task 00's error path)
    When the operator clicks "Issue ▸"
    Then the picker/tile shows an accent/crimson line ("Could not issue: …") and a teal "Retry"
    And the error is scoped to the picker/tile, not the whole page (the read-only surface around it is unaffected)
    And no destructive/red alarm colour is used (accent is the only "needs eyes" token, per the ramp)

  # THE READ-ONLY RAIL PRESERVED — the affordance is the ONLY mutation; everything else stays read-only
  # (DESIGN default 4): drill-in is still a link, the presence/run ramps are unchanged, there is no
  # bulk-select, no toolbar, no live action log, no page-dimming modal. The write control did not turn the
  # calm dashboard into a command console. (The wire-level bounded-write posture is task 03's @executable
  # proof; this is the VISUAL statement of the same rail.)
  Scenario: the surface stays otherwise read-only — the affordance is the one quiet action on an unchanged dashboard
    Given the viewing node is the control node
    And the operator opens the populated fleet view
    Then the board drill-in is still a link and the presence/run ramps are unchanged (m25 verbatim)
    And there is no bulk-select, no toolbar, no live action log, and no page-dimming modal
    And the [assign] affordance is the only mutating control on the surface — one quiet per-board action

  # Escape / click-away / Cancel dismisses the picker with NO write — the read-only default is always one
  # keystroke away (DESIGN §Component choices: "the read-only default is always one keystroke away"). Staged
  # target, no commit ⇒ no directive.
  Scenario: Escape / click-away / Cancel dismisses the picker with no write
    Given the viewing node is the control node and the picker is open with a target staged
    When the operator presses Escape (or clicks away, or clicks "Cancel")
    Then the picker closes and no POST is sent (the staged target is discarded)
    And no directive is issued (the picker only stages; Issue commits)
