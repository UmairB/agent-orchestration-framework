@cli @work @round-trip @executable
Feature: seedSampleMilestone writes the fixed worked-milestone fixture
  In order to drive the loop over a deterministic, self-contained sample
  seedSampleMilestone must write a fixed milestone the shipped work verbs can resolve.

  # The fixture's "self-contained / no-network / hermetic" property is the SOURCE residue covered
  # by acd-roundtrip-isolation + ADR-002's no-fake clause (ADR-004) — NOT restated here. These
  # scenarios assert only the observable fixture: it lands on disk, resolves through the shipped
  # verbs, the returned refs match what's on disk, and it is byte-identical across runs.

  Background:
    Given a fresh isolated repo from createRoundTripRepo()

  Scenario: seeding writes the sample milestone into the repo's work stream
    When seedSampleMilestone(dir) is called
    Then a milestone folder is written under the repo's work directory
    And it returns a "milestoneRef" and a list of "storyRefs"

  Scenario: the seeded refs resolve through the shipped work verbs
    When seedSampleMilestone(dir) is called
    Then running "aof work find" on the returned milestoneRef in the repo resolves the seeded milestone
    And each returned storyRef resolves to a seeded story under that milestone

  # QA added: the returned refs must MATCH what is on disk, not just resolve individually.
  # Per ADR-005 a story asserts against the returned refs, so storyRefs count and shape are
  # load-bearing. Observable via the shipped listStream: the set of seeded story refs in the
  # stream equals storyRefs, every storyRef is shaped "NN/SS" and parents the milestoneRef "NN".
  Scenario: the returned refs match the seeded folders on disk exactly
    When seedSampleMilestone(dir) is called
    Then "aof work list" in the repo reports exactly one milestone, whose ref equals milestoneRef
    And the list's story refs under that milestone equal the returned storyRefs as a set
    And every returned storyRef has the form "<milestoneRef>/SS"
    And the count of returned storyRefs is at least one

  # QA added: the fixture is a CLEAN stream — ADR-003/004 seed a stream the spine verbs walk, and
  # `validate` must pass on a clean seed (the deterministic spine's happy path). Black-box: run
  # the shipped validateWork over the seeded stream and observe zero findings. This is the
  # observable counterpart to "the work verbs can resolve it" — they can also validate it.
  Scenario: the seeded stream validates clean through the shipped validator
    When seedSampleMilestone(dir) is called
    And "aof work validate" is run over the seeded stream in the repo
    Then it reports no findings

  Scenario: the fixture is deterministic across runs
    When seedSampleMilestone(dir) is called into two separate fresh repos
    Then the seeded work-stream files are byte-identical between the two repos

  # QA added: determinism is observable at the RETURNED-REFS level too, not just file bytes —
  # two independent seedings return the same milestoneRef and the same storyRefs. This is what
  # lets the loop-proof story bind to stable refs (ADR-004 "fixed, in-repo fixture").
  Scenario: the returned refs are identical across two independent seedings
    When seedSampleMilestone(dir) is called into two separate fresh repos
    Then both calls return the same "milestoneRef"
    And both calls return the same "storyRefs" in the same order
