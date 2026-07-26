---
type: spike
number: NN
slug: <kebab-slug>
title: "<Spike Title>"
status: not-started
owner: <role>
created: YYYY-MM-DD
updated: YYYY-MM-DD
depends: []
timebox: <e.g. 1d / 2d>
schema: <schema-version>
aofVersion: <aof-version>
---
<!--
  SPIKE.md — the record doc for a de-risk spike. Answers ONE question:
  is the unknown resolved, and what did we find?
  Owner: whoever runs the spike. A spike is a TOP-LEVEL DRIVER (like a milestone or uat session) that
  groups no stories and carries no behavioural contract — no tasks/, no .feature. Its whole deliverable
  is a RECORDED FINDING; the code it produces (if any) is a throwaway prototype, never shipped as-is.
  "Done" = ## Finding is filled and the unknown is resolved (aof:verify checks exactly this — no
  scenario run, no "tests green"). It gates the stream: a milestone that `depends:` on this spike waits
  until it is `done`.
-->
# NN · <Spike Title>

## Question

<!-- The unknown / risk this spike exists to resolve. Frame it as a question with a real answer,
     not a task ("will X approach work for Y?", not "explore X"). -->

<the question this spike must answer>

## Timebox

<!-- The time-box from frontmatter, restated with the stop condition: what happens at the boundary if
     the question isn't yet answered (extend, park, or answer-with-uncertainty-noted). -->

- Box: `<timebox>` — stop and record the best-available finding at the boundary, timebox extension
  requires explicit re-scoping.

## Investigation

<!-- Throwaway-prototype notes as the spike runs: what was tried, what broke, what surprised. This is
     scratch work, not a deliverable — keep it, but don't polish it. -->

<notes as the investigation proceeds>

## Finding

<!-- THE DELIVERABLE. The recorded finding/decision that resolves ## Question. "Done" = this section is
     filled and the unknown is resolved — aof:verify checks exactly this. -->

<the answer, and the evidence/reasoning behind it>

## Outcome / Next

<!-- What this finding unblocks — which milestone(s) `depends:` on this spike, and what they should do
     differently (or not) as a result. -->

<what happens next as a result of this finding>
