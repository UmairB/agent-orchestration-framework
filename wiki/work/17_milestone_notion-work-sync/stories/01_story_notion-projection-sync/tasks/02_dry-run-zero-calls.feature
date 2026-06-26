@cli @adapter @work-stream
Feature: --dry-run prints the full per-item diff and issues zero Notion calls
  In order to let the PO see exactly what the sync would push before it writes, --dry-run must compute and
  print the full per-item diff (create/patch/noop/skip) for the milestone and its stories, issue ZERO
  Notion calls and spawn no CLI, leave the board untouched, and produce a plan that equals the one the real
  sync would apply — a true preview, not an estimate.

  # ADR-003: --dry-run runs the WHOLE projection (traversal + sidecar lookup + statusMap resolution + the
  # create/patch decision per item) and returns the plan, applying nothing. Because the create/patch
  # decision is the local sidecar lookup (ADR-001/003), the dry-run plan is EXACT, not an estimate. These
  # rows run @executable in-process with the ADR-004 CLI spawn seam injected as a spy — provable offline,
  # no live token (RESEARCH §A2), exactly the milestone-13 dry-run discipline.
  #
  # These are OBSERVABLE behaviours: the diff is printed/emitted, the spy is never called, nothing is
  # created or patched. The STRUCTURAL invariant "the projection IS the preview / no resolve-by-query path"
  # is story-03 arch-tests acd-notion-one-way + acd-notion-mapping-sidecar (ADR-005 inv. 1/2) — comment
  # only, never a Then.

  Background:
    Given a configured work.integrations.notion bound to a data-source with a complete statusMap
    And a fixture milestone "17" with stories "17/01" and "17/02"
    And the Notion CLI spawn seam injected as a spy

  @executable
  Scenario: --dry-run computes and prints the full per-item diff for the milestone and its stories
    Given a sidecar that records a page id for "17" and nothing for "17/01" or "17/02"
    When I run "aof work integrations notion sync-work 17 --dry-run"
    Then the command exits 0
    And the output reports a per-item decision for "17", "17/01", and "17/02"
    And each item's decision is one of create, patch, noop, or skip

  @executable
  Scenario: --dry-run issues zero Notion calls and creates or patches nothing
    Given a sidecar that records a page id for "17" and nothing for "17/01" or "17/02"
    When I run "aof work integrations notion sync-work 17 --dry-run"
    Then the command exits 0
    And the injected spawn-seam spy is never called
    And no page is created or patched on the board

  @executable
  Scenario: --dry-run with --json emits the per-item plan as structured data without writing
    Given a sidecar that records a page id for "17" and nothing for "17/01" or "17/02"
    When I run "aof work integrations notion sync-work 17 --dry-run --json"
    Then the command exits 0
    And the JSON envelope has dryRun true
    And the JSON envelope lists a per-item decision for "17", "17/01", and "17/02"
    And the injected spawn-seam spy is never called

  # The dry-run is a TRUE preview, not an estimate: the create/patch decision is the local sidecar lookup
  # (ADR-001/003), so the printed plan equals the plan the real sync would apply for the same inputs.
  @executable
  Scenario: the dry-run plan equals the plan the real sync would apply for the same inputs
    Given a sidecar that records a page id for "17" and nothing for "17/01" or "17/02"
    When I project the fixture with --dry-run and again without --dry-run over the same sidecar and config
    Then the per-item op decisions of the two plans are identical for "17", "17/01", and "17/02"
