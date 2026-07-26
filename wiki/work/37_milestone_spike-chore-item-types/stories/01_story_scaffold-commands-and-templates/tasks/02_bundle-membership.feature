@cli @assets @distribution @executable
Feature: The spike & chore commands and templates are members of the ACD asset bundle
  In order to deliver aof:add-spike / aof:add-chore and their templates the same way add-task / add-story ship
  the system must declare the two command docs and the two record-doc templates as bundle members, alongside the existing scaffold assets.

  # Membership + content-address are asserted the way the milestone-01 bundle tests do it
  # (acd-bundle-membership.test.mjs, acd-bundle-manifest-hashes.test.mjs). Bundle-root resolution and the
  # "declared set == on-disk set" invariant are milestone-01 fitness functions; this feature adds the
  # observable claim that THESE FOUR new assets are among the declared, content-addressed members.

  Background:
    Given the ACD asset bundle descriptor and its shipped manifest

  # The two skill commands ship beside the existing scaffold commands.
  Scenario: the add-spike and add-chore command docs are declared bundle members
    When I read the bundle descriptor's members
    Then it declares a member "add-spike" of kind "command"
    And it declares a member "add-chore" of kind "command"
    And it still declares the "add-task" and "add-story" command members

  # The two record-doc templates ship beside the existing templates.
  Scenario: the SPIKE.md and CHORE.md templates are declared bundle members
    When I read the bundle descriptor's members
    Then it declares a member "spike" of kind "template"
    And it declares a member "chore" of kind "template"
    And it still declares the "story" and "uat" template members

  # A declared member must resolve to a real file on disk — no dangling declaration.
  Scenario: each new member resolves to an existing bundle file on disk
    When I resolve each declared member to its bundle path
    Then commands/add-spike.md exists under the bundle root
    And commands/add-chore.md exists under the bundle root
    And templates/spike/SPIKE.md exists under the bundle root
    And templates/chore/CHORE.md exists under the bundle root

  # Each new asset appears in the shipped manifest as a content-addressed entry whose hash matches its
  # re-rendered on-disk content — mirroring acd-bundle-manifest-hashes.test.mjs, so update's drift
  # detection stays sound for these members.
  Scenario Outline: the manifest hash for "<id>" is a true content address of its rendered content
    When I read the shipped manifest entry for member "<id>"
    Then the entry has a non-empty "path"
    And the entry's "hash" begins with "sha256:"
    And the entry's "hash" equals the sha256 hash of that member's re-rendered content

    Examples:
      | id        |
      | add-spike |
      | add-chore |
      | spike     |
      | chore     |
