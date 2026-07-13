@cli @assets @scaffold
Feature: The bundled CHORE.md template instantiates to a folder that validates clean
  In order to start a chore without hand-crafting frontmatter or guessing the checklist shape
  the system must ship a CHORE.md template that, once its placeholders are filled into a NN_chore_<slug>/ folder, aof work validate accepts.

  # The template ships in the ACD asset bundle at .aof/templates/work/chore/CHORE.md; membership + hashes
  # are proven in 02_bundle-membership.feature. Structural invariants (recordDoc(chore)==='CHORE.md',
  # a chore folder with no tasks/ validates clean, a CHORE.md requires a ## Definition of Done) are milestone
  # ARCHITECTURE fitness functions (FF-3703, FF-3704b, FF-3706), NOT restated here — this feature is the
  # observable BEHAVIOUR of the shipped template.

  Background:
    Given the bundled template .aof/templates/work/chore/CHORE.md

  # A chore's whole deliverable is a ticked checklist, so "done" is a filled-in doc the engine accepts.
  @executable
  Scenario: an instantiated chore folder validates clean
    Given the template's placeholders are filled into a NN_chore_<slug>/CHORE.md at the stream root
    When I run aof work validate over that stream
    Then validation reports no findings for that chore folder
    And the exit status is success

  # A chore folder is valid WITHOUT a tasks/ or a .feature — it carries no behavioural contract.
  # (Observable half of the per-type verify path; the invariant lives in ARCHITECTURE FF-3704b.)
  @executable
  Scenario: an instantiated chore folder with no tasks/ and no .feature validates clean
    Given the template's placeholders are filled into a NN_chore_<slug>/CHORE.md
    And that folder contains no tasks/ directory and no .feature file
    When I run aof work validate over that stream
    Then validation reports no findings for that chore folder

  # Every required frontmatter key, checked as an observable property of the INSTANTIATED doc: type: chore
  # plus the standard identity plus depends. Checked via aof work validate's folder↔frontmatter branch.
  @executable
  Scenario Outline: the instantiated CHORE.md carries required frontmatter key "<key>"
    Given the template's placeholders are filled into a NN_chore_<slug>/CHORE.md
    When I read that instantiated CHORE.md's frontmatter
    Then it declares a "<key>" key

    Examples:
      | key     |
      | type    |
      | number  |
      | slug    |
      | title   |
      | status  |
      | owner   |
      | created |
      | updated |
      | depends |

  # The chore type is pinned in the shipped template and every required body section is present.
  @executable
  Scenario Outline: the instantiated CHORE.md contains required section "<section>"
    Given the template's placeholders are filled into a NN_chore_<slug>/CHORE.md
    When I read that instantiated CHORE.md
    Then it contains a "<section>" section

    Examples:
      | section              |
      | ## Intent            |
      | ## Definition of Done |
      | ## Notes             |

  # The Definition of Done is the chore's close criterion, so it must be an actual checkbox list — the
  # thing that later gets ticked. Observable in the instantiated doc: the section is present and its body
  # is a markdown checkbox list.
  @executable
  Scenario: the instantiated CHORE.md's Definition of Done is a checkbox list
    Given the template's placeholders are filled into a NN_chore_<slug>/CHORE.md
    When I read the "## Definition of Done" section of that CHORE.md
    Then the section is present
    And its body is a markdown checkbox list (each item begins with "- [ ]" or "- [x]")

  # Actually running the skill command is agent-work the executable suite can't do; a human/agent invokes
  # it live, then re-runs validate. Its procedure is recorded in the milestone UAT record (verifies →).
  @manual
  Scenario: /aof:add-chore scaffolds a chore folder that validates clean
    When an agent runs /aof:add-chore <slug> in an initialised stream
    Then a NN_chore_<slug>/CHORE.md folder is created at the stream root
    And running aof work validate over that stream reports no findings for the new folder
