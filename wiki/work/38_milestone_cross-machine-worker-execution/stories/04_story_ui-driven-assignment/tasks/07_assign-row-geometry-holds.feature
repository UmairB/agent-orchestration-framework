@executable @ui @board
Feature: The assign row's GEOMETRY holds in every state — the action's width is fixed, the picker keeps a floor and never goes anonymous, the message is the element that yields, and region 5's chip names its target in FULL
  In order that an operator can always see WHICH node the row is aimed at — especially at the exact moment a refusal tells them
  to re-aim it — and never watch the row reflow under a label swap, the action reserves the width of its longest label in every
  state, the picker keeps a minimum width rendering at least fourteen characters of the node id beside its chevron, the message
  slot is the only element that yields (truncating, with the full server text in its native `title`), the message's copy keeps
  the HOLDER whole by stepping down a ladder rather than cutting it, and region 5 is a YIELD order in which no two elements
  may ever occupy the same pixels.

  # DG-13 / F-38.04g — from the REAL-assign render of 2026-07-24 (§Surface 2's first real verdict: GAPS at 1280), judged from
  # twelve frames driven by a real click → a real POST /api/mesh/assign → a real global_assignments row read back.
  #
  # AMENDED 2026-07-24 by the SECOND real verdict (the re-render taken after this task was first built, also GAPS at 1280).
  # It closed DG-14 and GAP-S2-3 outright and closed DG-13 as filed, but opened three successors at its edges, all built here:
  #   - DG-15 — the target's `shrink-0` OVERPRINTED `Open board →`. Clause 5 gains a sixth clause: no two elements in region 5
  #     may occupy the same pixels; priority is a YIELD order, never a paint order.
  #   - DG-16 — the workspace name STUBBED to `l…` instead of dropping. It renders in full or not at all.
  #   - DG-17 — clause 4's own exemplar copy could not fit the row clause 1 + clause 2 leave. The RULE changed: the holder is
  #     atomic, and the copy steps down a graduated ladder.
  #
  # Cite: DESIGN §Surface 2 "Amendment 2026-07-24 (b) — F-38.04g / F-38.04f, judged from the REAL-assign render" (five binding
  # clauses), the AMENDED A10 ("'Rhythm' is binding geometry"), and DG-13 in the design-gap list. DG-11 is re-scoped into
  # clause 5.
  #
  # OBSERVED IN REAL PIXELS:
  #   - in the REFUSED frame the picker (`flex-1 min-w-0 truncate`) collapsed to a BARE CHEVRON — ~26px, down from ~284px —
  #     while the inline error took the row. The operator could not see which node was selected at the exact moment they had
  #     to re-aim, and the error truncated before naming the holder (`Item "18" already has an active assignment …`);
  #   - in the SUCCESS frame the action narrowed 67px → 44px on the `Sent` label swap and the picker absorbed the difference,
  #     so the row reflowed on every state change;
  #   - region 5's chip target truncated in EVERY frame that had one (`→ umairs-m…`, `→ aaa-firs…`).
  #
  # WHY IT IS A DESIGN RULE AND NOT A BUILD ACCIDENT: A10's "rhythm" was written as a spacing idiom and read as one. These
  # pixels show it is also GEOMETRY — and that a control which cannot name its target has lost the one thing A7's `Sent`
  # claims to give "for free".
  #
  # WHY THIS IS ITS OWN TASK FILE. tasks/06 owns the affordance's STATE AXIS (its rows, its transitions, its windows). DG-13
  # is orthogonal to that axis: it binds every state at once, it is about WIDTH rather than about what the row SAYS, and
  # clause 5 governs REGION 5 — the footer / attention cluster — which task 06 has never spoken about and should not start to.
  #
  # HOW THESE ARE DRIVEN, and what that can and cannot prove. Every clause below is asserted the way this house asserts render
  # facts: off the REAL, unmodified production <Fleet/> mounted headlessly (test/support/fleet-app-harness.mjs), reading the
  # RENDERED props and classNames the component actually emits. That makes each clause a CLASS/STRUCTURE fact — "the action's
  # reserved width is the same value in every state", "the picker carries a minimum width and no min-w-0", "the message slot
  # truncates and carries the full text in `title`". It does NOT make them a PIXEL verdict: whether the reserved width really
  # does contain `Assigning…` at 11px semibold, and whether the floor really does show fourteen characters, can only be
  # confirmed by a render — which is owed to the designer and is NOT claimed here.

  Background:
    Given the REAL fleet face stood up on a loopback port over an isolated global-store seam
    And a published worker node "worker-a" that is both VISIBLE in the roster and ELIGIBLE for the workspace
    And the REAL production <Fleet/> mounted against it, its milestone card showing the affordance at rest

  Scenario: the action's width is FIXED — the same reserved width in every state, including disabled
    When the row passes through rest, in-flight, the acknowledgment and a refusal
    Then the action reserves the SAME width in every one of those states
    And that width is sized to the LONGEST label the action ever reads — "Assigning…", not the label currently showing
    And it is derived from the label set itself, so renaming or adding a label cannot leave the width behind
    And the reserved width is phase-independent by construction — the value the row renders is computed without consulting the phase at all
    # DG-13 clause 1: "A label swap may not move another element." That is what A10's "or its rhythm" means.

  Scenario: the picker has a FLOOR and never yields to the message — a bare chevron is forbidden
    Given a refusal whose message is long enough to want the whole row
    When the refusal renders
    Then the picker still carries a minimum width of at least fourteen characters of the node id PLUS the select's own chevron
    And it carries no `min-w-0` — the class that let the real render collapse it to a bare chevron
    And the picker's floor is the SAME value in every state: rest, in-flight, acknowledged and refused
    And the CHOSEN node is still the picker's value, so the row still names its target at the exact moment the operator must re-aim it
    # DG-13 clause 2: "a control the operator must re-aim may not be anonymous at the moment they re-aim it"

  Scenario: the message slot is the element that YIELDS — it truncates, and carries the full server text in its native `title`
    When a refusal renders in the row
    Then the message slot is the shrinkable, truncating element of the row
    And its native `title` carries the FULL server sentence, whole and unabbreviated
    And the picker and the action are both `shrink-0`-class fixed — neither of them is what gives way
    # DG-13 clause 3 — the same `title` idiom DG-10 already uses for the session id

  Scenario: the message may not re-state what the card already says, and the HOLDER is ATOMIC — a copy LADDER, never a cut id
    Given the item already has an active assignment held by "worker-a", so the verb's single-runner gate will refuse
    When the operator clicks "Assign →"
    Then the message reads "refused · worker-a"
    And it does NOT lead with the item's ref, which region 1 already shows
    And it names the HOLDER — the only fact no other region on this card carries — WHOLE, never as a prefix of it
    And the affordance shaped that message from the verb's own CODED envelope (`{ ok:false, code, holder }`), not by re-wording the server's sentence
    And the server's sentence is not discarded: it is exactly what the slot's `title` carries
    # DG-13 clause 4, SUPERSEDED by DG-17 (DESIGN §Surface 2, from the 2026-07-24 re-render). Clause 4 was judged "closed in
    # copy, NOT in pixels": the string was exactly `already assigned → umairs-msi` and it still rendered `already assigned →
    # uma…`. The arithmetic proved the rule unsatisfiable — clause 2's picker floor plus clause 1's fixed action leave ~137px
    # of a 360.66px row, while clause 4's OWN exemplar needs ~197px. The RULE changed, not the build: the holder renders WHOLE
    # or is omitted, chosen by a graduated ladder. A three-glyph prefix of a node id is indistinguishable from three other
    # node ids on the same roster — worse than saying nothing.

  Scenario Outline: the copy ladder keeps the holder whole at every width — and omits it rather than mutilating it
    Given a refusal whose outcome is "already assigned" and whose holder is "<holder>"
    Then the row renders "<message>"
    And the rendered copy fits the message slot's derived character budget
    And the holder is either present in FULL or absent ENTIRELY — never a prefix

    Examples:
      | holder                         | message                            |
      | msi                            | already assigned → msi   |
      | worker-a                       | refused · worker-a       |
      | umairs-mac-mini                | already assigned         |
      | umairs-mac-mini-build-agent-02 | already assigned         |
    # The budget is DERIVED from the row this surface is actually built to (the judged render's 136.94px slot over the 10.5px
    # mono advance), not guessed — and it is a parameter, so a wider row climbs BACK to the top rung rather than staying
    # downgraded. CSS `truncate` survives only as a backstop for the UNSHAPED server sentence.

  Scenario Outline: the coded refusals the verb raises are all shaped outcome-first, and every one keeps its full sentence in the `title`
    Given the verb refuses with code "<code>"
    Then the row renders "<message>"
    And the `title` still carries the verb's own sentence in full

    Examples:
      | code                        | message                    |
      | assignment-already-active   | refused · worker-a         |
      | assignment-target-unknown   | unknown node               |
      | assignment-repo-unavailable | no published repo          |
      | ref-not-found               | item not found             |
    # These four are exactly the verb codes whose sentence leads with a fact ANOTHER region already carries (the ref, or the
    # node id the picker is showing two elements to the left). The route's own workspace/identity codes already lead with
    # their outcome, so their sentences stand unshaped rather than being re-worded on a guess — and the `title` rule covers
    # them all regardless.

  Scenario: the row's own membership and rhythm are unchanged — the fixed width adds no element and no height
    When the row passes through rest, in-flight, the acknowledgment and a refusal
    Then the row's direct children are the picker, the action and (only when there is one) the message — in that order, in every state
    And the action's reserved width lives INSIDE the action, not as a fourth element in the row
    And the row keeps the card's own divider+padding idiom, unchanged by this pass
    # A10 (height + rhythm) and A2 (quiet, subordinate — the fixed width must not turn the action into a bigger button). The
    # HEIGHT half and the "bigger button" half are PIXEL claims: the render owed to the designer is what judges them.

  Scenario: region 5 is a YIELD order, never a paint order — no two elements may occupy the same pixels
    Given the item carries a real minted `assigned` record naming a long target node id
    When the card renders
    Then the workspace name is DROPPED from the flow with its separator — rendered in FULL or not at all, never a one-glyph stub
    And the drill-in "Open board →" is the next to give way, and it degrades to its ABBREVIATED form rather than to nothing
    And the drill-in's WORDS truncate inside their own box while the "→" glyph stays pinned, so the affordance is never invisible
    And the drill-in's full label stays recoverable in its native `title`
    And the `· <when> · <note>` tail yields before either, being "all else", ranked last
    And the chip's "→ <target>" yields LAST of all, and when it must, it truncates INSIDE ITS OWN BOX
    And the yield order is readable off the row itself — tail, then drill-in, then target
    # DG-13 clause 5 (DG-11 re-scoped), AMENDED by DG-15 + DG-16 (DESIGN §Surface 2, from the 2026-07-24 re-render).
    # Clause 5's headline was MET — the target rendered in full, 30 characters of it — and its MECHANISM was broken twice.
    # The target's `shrink-0` inside a `min-w-0` wrapper OVERFLOWED and painted over `Open board →`: the id's trailing glyph
    # and the action's leading glyph on the same pixels, destroying BOTH (DG-15). And the workspace name STUBBED to `l…`
    # instead of dropping (DG-16, which also falsified DG-11's "does not reproduce" note). Clause 5 therefore gains a SIXTH
    # clause — NO TWO ELEMENTS IN REGION 5 MAY OCCUPY THE SAME PIXELS — and priority is expressed as who yields FIRST.
    # Every element can yield; the target simply yields last, because it is the fact the chip exists to say.

  Scenario: the workspace name is present and whole when there is no chip — the drop is pressure-driven, not unconditional
    Given the item carries NO assignment record
    When the card renders
    Then the workspace name renders in full in region 5
    # DG-16's other half. "Full or nothing" is not "never" — a chip-less card has the room, so it shows the name.
