@cli @adapter @scaffold @executable
Feature: Headroom's binary lookup resolves the managed store copy first, falling back to PATH, with its config surface unchanged
  In order that a provisioned headroom wins over a global while the headroom plugin's behaviour is otherwise untouched
  headroom's lookup is re-pointed at the store-first resolver — store copy first, then the existing PATH probe — and only the lookup moves,
  so that milestone 06's headroom binary is now aof-managed, while useHeadroom/unuseHeadroom and the plugin's isolation guard keep working exactly as before.

  # ADR-004: headroom's defaultWhich-based lookup (src/headroom.mjs, src/work-headroom.mjs)
  # is re-pointed store-first then PATH-fallback. ONLY the binary lookup moves — headroom's
  # enable/disable config surface (useHeadroom/unuseHeadroom, 06/ADR-004) and its
  # isolation guard are UNCHANGED. The "store STRUCTURALLY ahead of PATH" fact is a fitness
  # function (ADR-005 inv. 1, extended to the headroom lookup); here we assert the
  # OBSERVABLE resolution outcome and that enabling the plugin is independent of the lookup.
  # Hermetic via injected store/PATH seams; the live headroom-ai[all] install is task 01 (@manual).
  Background:
    Given headroom's lookup loaded in-process with injectable store/PATH seams

  # Observable resolution outcome: both present → the store copy; only PATH → the 06 PATH
  # location, unchanged. (The total-miss / hint path is headroom's own 06 lookup contract,
  # exercised where headroom is unconfigured — not re-litigated here.)
  Scenario Outline: headroom's lookup returns the right copy for each presence state
    Given headroom present "<presence>"
    When headroom's binary is resolved
    Then it resolves the "<source>" copy

    Examples:
      | presence                       | source        |
      | BOTH in the managed store and on PATH | managed store |
      | ONLY on PATH                   | PATH          |

  # The enable/disable config surface is untouched by the lookup re-point.
  Scenario: useHeadroom still writes the plugin config regardless of the binary lookup
    When I enable the headroom plugin
    Then the headroom plugin config is written exactly as before
    And enabling does not depend on where the binary resolves from
