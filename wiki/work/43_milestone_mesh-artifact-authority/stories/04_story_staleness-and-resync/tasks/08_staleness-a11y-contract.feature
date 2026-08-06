<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the freshness ramp's programmatic accessibility contract: the badge never
# carries its meaning in colour alone, a glyph-only badge has an accessible name, Resync
# NAMES ITS OBJECT, its busy state is visible AND programmatic, outcomes are announced
# through a permanently-present polite live region, and the threshold crossing is
# deliberately NOT announced.
# LITMUS: every Then is confirmable from the rendered element tree of the real production
# board mounted headlessly against a real board face — roles, `aria-*` attributes, `title`,
# visible label text, element type, and DOM order. No source read.
#
# THE A11Y LANE IS OFF IN THIS REPO, AND THAT IS THE DECISION, NOT AN OVERSIGHT. Per
# 07/ADR-004 the automated lane is opt-in via `work.tags.domains` containing `"a11y"`;
# `.aof/aof.config.json` lists no such domain and there is no `work.ui.a11y` block. So there
# is NO axe-core-via-Playwright run for this story and NO a11y finding will be logged from
# one. Nothing below is an axe assertion: these are ordinary DOM/attribute assertions off
# the rendered tree, which is a behavioural check QA has always owned. The PERCEPTUAL half —
# does the ramp actually read as degraded, does the word survive a greyscale render, is the
# hit target really 24 CSS px — cannot be settled from an element tree and is task 09's
# `@uat` design-conformance judgement over a real browser render.
#
# THE ONE FAILURE THIS FILE EXISTS TO PREVENT. A ramp whose entire purpose is a THRESHOLD is
# the easiest kind to build colour-only: grey it and move on. The rule is the m03/m25 one —
# colour and label always travel together — and here the word `stale` is what carries the
# meaning, with the dashed border explicitly DECORATIVE (it would not clear the 3:1 non-text
# contrast bar, and no meaning may depend on it).

@executable @ui @design @distribution
Feature: the freshness ramp carries its meaning in words and names, not in colour — the badge says `stale`, a glyph-only badge has an accessible name, Resync names the item and the node it acts on, and only outcomes are announced
  In order that an operator who cannot distinguish the dashed grey pill, or who is reading the panel through a screen reader,
  learns exactly the same three facts a sighted reader learns — that this copy is old, how old, and whose it is
  every rendering of the ramp carries the literal word `stale` plus the age in text, the decorative glyph is hidden from the
  accessibility tree, and every control on the line states its object and its state both visibly and programmatically

  Background:
    Given the REAL production board mounted headlessly against a REAL board face over an isolated global store, on a controllable clock
    And a mesh-enabled workspace whose item "43/04" was reported by "umairs-mac-mini" 12 minutes ago, past the 300-second window

  # HEADLINE (AC 13, rule 1) — never colour-only, in every form the badge has.
  Scenario Outline: every badge form carries the word `stale` in text, and the decorative glyph carries nothing unique
    Given the badge is rendered in its <form> form
    Then its accessible name contains the literal word "stale"
    And <text clause>
    And the `◌` glyph is <glyph treatment>
    And the dashed border is decorative — no meaning depends on it, and removing it changes no stated fact
    And no colour, token or border is the sole carrier of any fact the badge states

    Examples:
      | case    | form    | text clause                                                     | glyph treatment                          |
      | full    | full    | the visible text also states the age ("stale · 12m ago")        | `aria-hidden="true"`                     |
      | short   | short   | the visible text is the word alone ("stale")                    | `aria-hidden="true"`                     |
      | minimal | minimal | there is no visible text, so the accessible NAME carries it all | the element's own content, not hidden — see the next scenario |

  # AC 13, rule 3 — the minimal badge is the one real trap: a bare `◌` with no accessible
  # name is a decorative mark pretending to be information. The `role="img"` + `aria-label`
  # pattern already prevents exactly this on `StatusRing`.
  Scenario: the glyph-only badge becomes `role="img"` with the full sentence as its accessible name
    Given the fleet card is narrow enough that the badge has yielded to its minimal form
    When the badge is rendered
    Then it carries `role="img"`
    And its `aria-label` is the full sentence — naming the reporting node, the last-synced local time, the age, and the fact that it is past the staleness window
    And there is no bare `◌` anywhere in the tree with no accessible name
    And the label states the window in the same words the legend uses, or omits it entirely when the wire did not carry one — never a guessed number

  # AC 13, rule 3, second half — the full/short forms are real text, so they take no role and
  # their text is never hidden; the sentence goes in `title`.
  Scenario: the full and short badges are plain text with a `title`, carrying no role and no `aria-hidden` on the words
    When the full-form badge is rendered in the detail panel header
    Then it carries no `role` attribute
    And no `aria-hidden` is applied to its text
    And its `title` reads the full sentence naming the node, the last-synced local time, the age and the window
    And the badge does not duplicate the node id in its visible text

  # HEADLINE (AC 13, rule 4) — the control NAMES ITS OBJECT. A bare "Resync" is not a
  # sufficient name on a panel that shows one item among many, and the two-item Example is
  # what makes that concrete rather than theoretical.
  Scenario Outline: the Resync control names the item and the node it acts on
    Given the detail panel is open on <ref>, reported by <node>
    When the Resync control is rendered
    Then its `aria-label` reads "Resync <ref> from <node>"
    And its accessible name is not the bare word "Resync"
    And the same panel's other controls keep their own distinct names

    Examples:
      | ref   | node            |
      | 43/04 | umairs-mac-mini |
      | 43/03 | aof-wsl         |

  # AC 13, rule 5 — a disabled button whose label did not change is a SILENT state. All three
  # signals must agree, in every non-idle state, or the visible and programmatic states
  # contradict each other.
  Scenario Outline: the busy and held states are visible AND programmatic — the label, `disabled` and `aria-busy` always agree
    Given the resync episode is in its <state> state
    When the control is rendered
    Then its visible label reads <label>
    And its `disabled` state is <disabled>
    And its `aria-busy` is <aria-busy>
    And there is no state in which the control is disabled while its visible label is unchanged from the idle label

    Examples:
      | state     | label      | disabled | aria-busy |
      | idle      | ⟳ Resync   | false    | absent or "false" |
      | in-flight | Resyncing… | true     | "true"    |
      | accepted  | Requested  | true     | absent or "false" |
      | no answer | ⟳ Resync   | false    | absent or "false" |
      | refused   | ⟳ Resync   | false    | absent or "false" |
    # `aria-busy` belongs to the IN-FLIGHT leg only: `Requested` is a held acknowledgement of
    # a completed call, not an operation still running.

  # AC 13, rule 6, first half — a live region created at the moment of the message is
  # unreliably announced, so the slot must already exist. It is a reserved constant-width
  # slot in the row geometry anyway, so this costs no layout.
  Scenario: the message slot is a polite live region present in the DOM at all times, including when empty
    Given the detail panel is open on a stale item and no resync has been attempted
    When the provenance line is rendered
    Then the message slot element is present in the DOM
    And it carries `aria-live="polite"`
    And it is empty
    When the operator clicks Resync and the episode reaches a terminal outcome
    Then the outcome text appears inside that SAME element — a new live region was not created for it
    And the element is never removed and re-added between states

  # AC 13, rule 6, second half — the crossing is a PASSIVE state change. Announcing every
  # item that ages past the window would be an unprompted interruption, and on a board with
  # many items it would be a stream of them.
  Scenario: the threshold crossing is deliberately NOT announced
    Given a settled board with several items about to cross the threshold
    When the clock advances past the threshold and the badges appear
    Then no badge is inside a live region
    And no badge carries `aria-live`, `role="status"` or `role="alert"`
    And no announcement was queued for the crossing on any surface
    And the fact is still reachable on demand — the badge's own text and the provenance line's `stale ·` prefix both state it

  # AC 13, rule 7 — focus and keyboard. The control follows the text it acts on, is a real
  # button, and keeps a visible focus indicator.
  Scenario: the Resync control is keyboard reachable, follows the text it acts on, and keeps a visible focus indicator
    Given the detail panel is open on a stale item
    When the provenance line is rendered
    Then the Resync control is a real `<button>` — not a `<div>` or `<span>` with a click handler
    And it follows the provenance label in DOM order, and precedes the message slot
    And it is reachable by keyboard in that order, with no positive `tabindex` and no tab trap
    And its focus indicator is built on the existing ring token — the user-agent outline is not removed without a replacement

  # m38/ADR-012 restated as an ACCESSIBILITY fact rather than a layout one: nesting
  # interactive elements inside a card `<button>` breaks both the focus order and the
  # activation semantics, which is why the badge on those cards is inert.
  Scenario: no interactive element is ever nested inside the card buttons that carry the badge
    Given a stale item rendered in the lanes view and the overview grid
    When the cards are rendered
    Then each card is a single `<button>` with a single accessible name and a single focus stop
    And the badge inside it has no role, no `tabindex`, no click handler and no nested control
    And there is no Resync control inside either card

  # AC 13, rule 10 — the badge must not be the only signal of its own state, so the prose
  # statement is asserted alongside it rather than assumed.
  Scenario: the stale fact is always available in prose, not only as a pill
    Given a stale item with the detail panel open
    When the panel is rendered
    Then the provenance line states the fact in words — "stale · synced 12m ago · from umairs-mac-mini"
    And that statement is present whether or not the badge yielded to a narrower form
    And a reader who never perceives the pill still meets the fact in text on the same panel
