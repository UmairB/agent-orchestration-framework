@cli @adapter @work-stream
Feature: a per-folder .integrations.json reader resolves each item's routing without touching the frontmatter parser
  In order to make a work item's external-tool routing self-describing and committed beside the item
  the system must read a co-located ".integrations.json" with JSON.parse (NOT parseFrontmatter), tolerate an
  absent or malformed file as "no routing" rather than throwing, ignore an unknown provider block so a future
  jira/linear adapter is additive, and disambiguate a notion parent by SHAPE — a 32-hex Notion page-id is used
  verbatim, anything else is a key resolved later against the chosen board's parents.

  # ADR-003: the reader is the NEW module src/integrations/routing.mjs (named "routing", NOT "descriptor", to
  # avoid the m12 NOTION_DESCRIPTOR collision in tool-store.mjs). readRouting(item) reads the file at the
  # item's RECORD-DOC folder (recordDoc semantics, src/work.mjs:97 — AOF.md-first for a converted milestone,
  # else SPEC.md; in practice item.dir) and returns the parsed object, or {} on an absent/unreadable/corrupt
  # file (mirrors readMapping's absent-file tolerance, mapping.mjs:41-57). The file is provider-namespaced
  # { "notion": { board?, parent? } }; an unknown provider key is IGNORED, never a hard failure (FF-E).
  # ADR-001: parent disambiguation is by shape — ^[0-9a-fA-F]{32}$ after stripping dashes (the 8-4-4-4-12 or
  # compact 32-hex form) ⇒ a raw page-id used verbatim; any other string ⇒ a key.
  #
  # These are OBSERVABLE behaviours of the reader over fixtures, run in-process — so the lane is @executable.
  # STRUCTURAL — "the reader uses JSON.parse and has NO parseFrontmatter dependency" + "an unknown provider is
  # tolerated" are the milestone arch-tests FF-B / FF-E (authored in story 02), NOT Thens here. Comment-only.

  Background:
    Given a work item whose folder is on disk

  @executable
  Scenario: a folder carrying a notion descriptor yields its routing
    Given the folder has an ".integrations.json" containing notion board "ops" and parent "p1"
    When I read the item's routing
    Then the routing's notion board is "ops"
    And the routing's notion parent is "p1"

  # Absent file ⇒ "no routing", never an exception — the projection's default-board/top-level path depends on
  # this (an unrouted item is the common case, m17 behaviour).
  @executable
  Scenario: an absent descriptor is "no routing", not an error
    Given the folder has no ".integrations.json"
    When I read the item's routing
    Then the read succeeds without throwing
    And the routing has no notion block

  # A corrupt/unreadable file is treated as "no routing" (it is a machine-managed file; a re-associate
  # rewrites it) — tolerant, mirroring the sidecar's corrupt-file handling.
  @executable
  Scenario: a malformed descriptor is tolerated as "no routing"
    Given the folder has an ".integrations.json" that is not valid JSON
    When I read the item's routing
    Then the read succeeds without throwing
    And the routing has no notion block

  # FF-E behaviour: an unknown provider block does not break the read — the reader returns the notion routing
  # and ignores the peer, so a future provider is an additive key.
  @executable
  Scenario: an unknown provider block is ignored, not a hard failure
    Given the folder has an ".integrations.json" with a notion block and an unknown "jira" block
    When I read the item's routing
    Then the read succeeds without throwing
    And the routing's notion board is present
    And the unknown "jira" block does not cause an error

  # A converted/imported milestone is record-doc'd by AOF.md, not SPEC.md; its .integrations.json sits in the
  # same folder and is read first-class (the carried-forward BLOCKER fix).
  @executable
  Scenario: an AOF.md-class (imported) milestone's descriptor is read first-class
    Given the folder is an imported milestone whose record doc is "AOF.md"
    And the folder has an ".integrations.json" naming notion parent "p1"
    When I read the item's routing
    Then the routing's notion parent is "p1"

  # ADR-001 shape disambiguation: the reader (or the resolver consuming it) classifies a parent value as a raw
  # page-id (used verbatim) iff it is 32 hex digits after stripping dashes; otherwise it is a key.
  @executable
  Scenario Outline: a notion parent is classified by shape — raw page-id vs key
    Given the folder has an ".integrations.json" naming notion parent "<parent>"
    When I read and classify the item's parent
    Then the parent is treated as a <kind>

    Examples: a 32-hex UUID (dashed or compact) is a raw page-id used verbatim
      | parent                               | kind        |
      | 11112222333344445555666677778888     | raw page-id |
      | 1111aaaa-2222-3333-4444-555566667777 | raw page-id |

    Examples: any other string is a key
      | parent       | kind |
      | phase-alpha  | key  |
      | q3-roadmap   | key  |

    Examples: a near-miss of the UUID shape falls cleanly to "key" (the ^[0-9a-fA-F]{32}$ boundary)
      | parent                            | kind |
      | 1111222233334444555566667777888   | key  |
      | 111122223333444455556666777788889 | key  |
      | 1111222233334444555566667777888g  | key  |
