@cli @work @work-stream @manual
Feature: The loop skips self-triggering hand-offs, applying the anti-loop policy over the store's lineage and initiator facts
  In order that the cascade's multi-agent hand-offs cannot loop by re-triggering their own work
  the autonomous loop applies the skip-self-trigger policy — reading the run lineage (retryOf) and brief.initiator the store records to detect a hand-off that would re-trigger its own lineage or initiator, and declining it,
  so that the store provides the FACTS (lineage, initiator) and the skill applies the POLICY (skip self-triggers) — the ADR-006 altitude split, the deterministic mechanic in the store, the multi-agent sequencing judgment in the skill.

  # ARCHITECTURE ADR-006 (anti-loop SPLIT by altitude): the store RECORDS the lineage /
  # brief.initiator facts (covered by ADR-001/003 key invariants, story 00); the skill
  # APPLIES the skip-self-trigger POLICY (this story, the 11 prompt-wiring altitude). Story
  # 02 owns NO fitness function — the policy is judgment, asserted by review + an
  # agent-observed demonstration in VERIFICATION.md. The store FACTS the policy relies on
  # are already @executable in story 00 (retryOf / brief round-trip); here we assert the
  # SKILL reads them and skips.
  # LITMUS: the policy wiring is read in autonomous.md and the skip is agent-observed by
  # driving a would-be self-trigger over a fixture — agent-runnable → @manual.

  Background:
    Given the autonomous loop in src/bundle/commands/autonomous.md
    And the store records each run's retryOf lineage and brief.initiator (story 00)

  # The policy reads the store FACTS, not a re-derived topology (ADR-006): the loop uses
  # the lineage (retryOf) and brief.initiator the store persisted as the self-trigger
  # signal — it does not bake cascade topology into the run mechanic.
  Scenario: the loop uses the recorded lineage and initiator as the self-trigger signal
    When the loop considers a multi-agent hand-off
    Then it reads the candidate's brief.initiator and run lineage from the store records
    And the skip decision is made from those recorded facts, not a hard-coded agent graph

  # A self-trigger is skipped (ADR-006): a hand-off whose initiator is the same agent it
  # would trigger — or that would re-trigger its own lineage — is declined, so the cascade
  # cannot spin on its own hand-offs.
  Scenario Outline: a hand-off that would re-trigger its own initiator or lineage is skipped
    Given a candidate hand-off whose "<self-signal>" matches the run that would produce it
    When the loop evaluates the hand-off
    Then it skips the self-triggering hand-off
    And the cascade does not loop on it

    Examples:
      | self-signal                                  |
      | brief.initiator equals the triggering agent  |
      | retryOf lineage points back at its own run   |

  # A genuine (non-self) hand-off is NOT skipped (the anti-loop guard must not over-block):
  # a hand-off to a DIFFERENT agent / a fresh lineage proceeds normally — the policy
  # skips only self-triggers, leaving the legitimate cascade flowing.
  Scenario: a genuine hand-off to a different agent proceeds normally
    Given a candidate hand-off whose initiator and lineage differ from the run that produced it
    When the loop evaluates the hand-off
    Then it proceeds with the hand-off
    And the cascade advances

  # The dedup backstop (ADR-006): even if the skill's policy were to slip, the store's
  # dedup guard refuses a second non-terminal run per item — so a self-trigger that got
  # past the skill is still caught. This scenario asserts the SKILL-OBSERVABLE half: the
  # loop TREATS the store's duplicate-run as an in-loop event (continues, does not hand
  # back), per ADR-008. The store's actual duplicate-run rejection is the @executable
  # behaviour owned by story 00's 04_dedup-and-atomic-persist (cross-referenced, not
  # re-asserted here — keeping this @manual feature to prose-confirmable judgment).
  Scenario: the loop treats a store duplicate-run rejection as an in-loop event, not a hand-back
    Given a self-triggering hand-off the policy failed to skip
    And the store has refused its second non-terminal run with "duplicate-run" (story 00)
    When the loop receives that rejection
    Then it continues the cascade without handing control back
    And it does not add a stop for the duplicate-run
