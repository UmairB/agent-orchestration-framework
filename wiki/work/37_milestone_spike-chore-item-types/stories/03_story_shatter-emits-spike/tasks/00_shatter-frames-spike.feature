<!-- aof-generated: bundle -->

# Task feature — what is observably true after `/aof:shatter` runs on a PRD carrying a blocking unknown?
# LITMUS: every line is confirmable by an agent running `/aof:shatter` and observing the skill's report +
#   the produced folders/frontmatter (`type`, `depends`, presence/absence of `stories/`) + `aof work
#   validate` — WITHOUT reading shatter.md, src/planning-prd.mjs, or src/work.mjs internals.
# `/aof:shatter` is skill-orchestrated (the PRD → roadmap batch session): the @executable suite cannot
#   drive it, so these scenarios are @manual — an agent runs the skill and observes the framed roadmap.
# The reason shatter *chose* a spike ("because the chunk was an unknown") is not observable; the Background
#   states the chunk's nature as the precondition and the scenarios assert the observable RESULT — a
#   `NN_spike_<slug>` driver exists with the consuming milestone depending on it (backward-only).

@cli @planning @manual
Feature: aof:shatter frames a blocking unknown as a spike driver, not a milestone
  In order to land de-risking investigation as a first-class, ordered roadmap driver
  the system must frame a `NN_spike_<slug>` driver (from the SPIKE.md template) for a PRD chunk that is a
  blocking unknown, and wire the consuming milestone's backward-only `depends` to it (ADR-001/ADR-004).

  Background:
    Given a planning PRD at the workspace root whose seam surfaces a blocking unknown that must be
      resolved before a milestone can be committed to
    And a milestone-sized chunk that consumes the finding from that unknown
    And `/aof:shatter` is run over that PRD

  # Headline: the unknown lands as its own spike driver — a NN_spike_<slug> folder framed from SPIKE.md,
  # not folded into a milestone SPEC.
  Scenario: shatter frames the blocking unknown as a top-level spike driver
    When the shatter run completes
    Then a `NN_spike_<slug>` folder exists at the stream root carrying a `SPIKE.md` record doc
    And that record doc's frontmatter has `type: spike`
    And the shatter report lists the framed spike among the created roadmap drivers
    And no milestone SPEC has folded the unknown into its own scope

  # Headline: the consuming milestone depends on the spike, backward-only — the spike's number is lower.
  Scenario: shatter wires the consuming milestone's backward-only depends to the spike
    When the shatter run completes
    Then the consuming milestone's frontmatter `depends` includes the spike's number
    And the spike's number is lower than that milestone's number (a backward-only edge)
    And the shatter report records the rationale for that milestone→spike dependency

  # Headline: a spike is a driver, item-is-the-work — shatter frames it but never breaks it into stories.
  Scenario: the framed spike is not broken into stories
    When the shatter run completes
    Then the spike folder contains no `stories/` subfolder
    And the spike folder contains no task `.feature` file

  # Headline: the produced mixed milestone/spike roadmap is structurally green and its ordering is acyclic.
  Scenario: the produced roadmap validates green with an acyclic mixed depends graph
    When the shatter run completes
    Then `aof work validate` over the produced roadmap reports green
    And the shatter self-verify reports the mixed milestone/spike `depends` graph resolves and is acyclic
