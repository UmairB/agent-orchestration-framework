@cli @assets @scaffold
Feature: The bundled SPIKE.md template instantiates to a folder that validates clean
  In order to start a spike without hand-crafting frontmatter or guessing the RESEARCH-shaped section layout
  the system must ship a SPIKE.md template that, once its placeholders are filled into a NN_spike_<slug>/ folder, aof work validate accepts.

  # The template ships in the ACD asset bundle at .aof/templates/work/spike/SPIKE.md; membership + hashes
  # are proven in 02_bundle-membership.feature. Structural invariants (recordDoc(spike)==='SPIKE.md',
  # a spike folder with no .feature validates clean) are milestone ARCHITECTURE fitness functions
  # (FF-3703, FF-3704a), NOT restated here — this feature is the observable BEHAVIOUR of the shipped template.

  Background:
    Given the bundled template .aof/templates/work/spike/SPIKE.md

  # A spike's whole deliverable is a recorded finding, so "done" is a filled-in doc that the engine accepts.
  @executable
  Scenario: an instantiated spike folder validates clean
    Given the template's placeholders are filled into a NN_spike_<slug>/SPIKE.md at the stream root
    When I run aof work validate over that stream
    Then validation reports no findings for that spike folder
    And the exit status is success

  # A spike folder is valid WITHOUT a tasks/ or a .feature — the deliverable is the finding, not tests.
  # (This is the observable half of the per-type verify path; the invariant lives in ARCHITECTURE FF-3704a.)
  @executable
  Scenario: an instantiated spike folder with no tasks/ and no .feature validates clean
    Given the template's placeholders are filled into a NN_spike_<slug>/SPIKE.md
    And that folder contains no tasks/ directory and no .feature file
    When I run aof work validate over that stream
    Then validation reports no findings for that spike folder

  # Every required frontmatter key and body section, checked as an observable property of the INSTANTIATED
  # doc: filling the template then removing the named piece makes validate (or the finding-recorded check)
  # complain — so the shipped template must carry each one. Frontmatter keys are folder-frontmatter checked
  # by aof work validate; body sections are the RESEARCH-shaped contract of ADR-002.
  @executable
  Scenario Outline: the instantiated SPIKE.md carries required frontmatter key "<key>"
    Given the template's placeholders are filled into a NN_spike_<slug>/SPIKE.md
    When I read that instantiated SPIKE.md's frontmatter
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
      | timebox |

  # The spike type is pinned in the shipped template (not left as a placeholder) and the RESEARCH-shaped
  # sections are all present in the instantiated doc.
  @executable
  Scenario: the instantiated SPIKE.md pins the spike type and carries every required section
    Given the template's placeholders are filled into a NN_spike_<slug>/SPIKE.md
    When I read that instantiated SPIKE.md
    Then its frontmatter "type" is "spike"
    And it contains a "## Question" section
    And it contains a "## Timebox" section
    And it contains an "## Investigation" section
    And it contains a "## Finding" section
    And it contains an "## Outcome / Next" section

  # Actually running the skill command is agent-work the executable suite can't do; a human/agent invokes
  # it live, then re-runs validate. Its procedure is recorded in the milestone UAT record (verifies →).
  @manual
  Scenario: /aof:add-spike scaffolds a spike folder that validates clean
    When an agent runs /aof:add-spike <slug> in an initialised stream
    Then a NN_spike_<slug>/SPIKE.md folder is created at the stream root
    And running aof work validate over that stream reports no findings for the new folder
