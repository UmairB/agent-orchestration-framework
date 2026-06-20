@cli @assets @distribution @executable
Feature: The bundle ships a content-addressed manifest of its rendered members
  In order to let a consumer see which bundle release they are on and to make drift detection sound
  the system must ship a manifest that catalogues each rendered member by path, runtime, resource, and hash, plus a version.

  Background:
    Given the shipped bundle manifest

  Scenario: the manifest catalogues one entry per rendered member
    When I read the manifest's entries
    Then there is exactly one entry per rendered bundle member
    And every entry carries a "path", a "runtime", a "resource", and a "hash"
    And each entry's "resource" carries an "id" and a "kind"

  Scenario: every manifest hash is a sha256 content address
    When I read the manifest's entries
    Then every entry's "hash" begins with "sha256:"

  Scenario: the manifest records the bundle version
    When I read the manifest
    Then it carries a "bundleVersion"

  Scenario: regenerating the manifest from an unchanged bundle is byte-for-byte stable
    Given a generated manifest of the unchanged bundle
    When I regenerate the manifest from the same bundle
    Then the regenerated manifest is identical to the first
    And every entry's "hash" is unchanged

  # The shape each kind of rendered member contributes to the manifest.
  Scenario Outline: a rendered member appears in the manifest with the full entry shape
    When I read the manifest entry for "<id>"
    Then it has a non-empty "path"
    And it has a "runtime"
    And its "hash" begins with "sha256:"

    Examples:
      | id                |
      | aof-architect     |
      | aof-qa            |
      | add-milestone     |
      | refine            |
