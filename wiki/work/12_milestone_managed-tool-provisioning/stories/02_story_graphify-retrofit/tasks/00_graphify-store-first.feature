@cli @adapter @scaffold @executable
Feature: resolveGraphifyBinary resolves the managed store copy first, falling back to PATH
  In order that a provisioned graphify wins over a stray global while an unprovisioned project still works
  resolveGraphifyBinary is re-pointed at the store-first resolver — the store copy first, then its existing PATH walk,
  so that milestone 09's graphify lookup now prefers the aof-managed store, keeps the no-throw miss contract, and points an absent operator at `aof project provision graphify`.

  # ADR-004: src/graphify.mjs resolveGraphifyBinary is re-pointed to call
  # resolveManagedBinary({ name:"graphify", version:PINNED_GRAPHIFY_VERSION,
  # binary:GRAPHIFY_BINARY, … }) — store-first, then its existing where/which PATH walk
  # as the fallback. The 09 frozen { found:false, hint } no-throw contract is preserved;
  # only the hint updates to name `aof project provision graphify`. graphify's
  # privacy/backend model (09/ADR-005) is untouched — only the binary LOOKUP moves.
  # The "store STRUCTURALLY ahead of PATH" fact is a fitness function (ADR-005 inv. 1,
  # extended to the re-pointed resolver); here we assert the OBSERVABLE outcome — given
  # both/only-PATH/neither, which copy resolveGraphifyBinary returns. Hermetic via the
  # injected store/PATH seams; the live provision is task 01 (@manual).
  Background:
    Given resolveGraphifyBinary loaded in-process with injectable store/PATH seams

  # Observable resolution outcome across the three presence states the re-point must hold:
  # both present → the store copy; only PATH → the 09 PATH location, unchanged; neither →
  # the 09 structured miss, now hinting provisioning.
  Scenario Outline: resolveGraphifyBinary returns the right copy for each presence state
    Given graphify present "<presence>"
    When I call resolveGraphifyBinary()
    Then it returns "<found>"
    And the resolved source is "<source>"

    Examples:
      | presence                       | found       | source       |
      | BOTH in the store and on PATH  | found true  | managed store |
      | ONLY on PATH                   | found true  | PATH          |
      | in neither the store nor PATH  | found false | (none)        |

  # The 09 no-throw miss contract is preserved; the hint now points at provisioning.
  Scenario: an absent graphify is the structured miss, now hinting aof project provision
    Given graphify present in neither the store nor PATH
    When I call resolveGraphifyBinary()
    Then it returns found false without throwing
    And the hint names "aof project provision graphify"
