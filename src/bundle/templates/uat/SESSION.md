---
type: uat
number: NN
slug: <kebab-slug>
title: "<Session Title>"
status: not-started
owner: qa
depends: [<milestone numbers this session accepts>]
created: YYYY-MM-DD
updated: YYYY-MM-DD
schema: <schema-version>
aofVersion: <aof-version>
---
<!--
  UAT SESSION.md — the record doc for an acceptance session. Answers ONE question:
  is the delivery so far acceptable as an integrated whole, and have we confirmed it?
  Owner: qa. A uat session GROUPS no stories and delivers no new behaviour — it references existing
  scenarios across the milestones it accepts (`depends:`), re-runs what can be automated, and brokers
  the irreducibly-human acceptance. THE RULE: reference scenarios (verifies →), NEVER restate them.
  It gates the stream: downstream work that `depends:` on it waits until status is `done`.
-->
# NN · <Session Title> — UAT Session

## Scope

<!-- Which delivery this session accepts — the milestones (= the `depends:` list) and, if narrower,
     the specific stories/scenarios in play. Reference them; don't restate their outcomes. -->

- Accepts: `01_milestone_<slug>`, `02_milestone_<slug>`, …
- Entry: every accepted milestone is `done` (its own `@executable` + `@manual` lanes green).
- Exit: every check below has a result, and no **blocker** finding is open.

## Plan

<!-- How the session runs — which lanes are automated vs human. "Could be automated": the
     `@executable` suite and agent-runnable `@manual` scenarios are re-run as a regression sweep
     across the accepted milestones; only the `@uat` (human-judgment) scenarios need a person. -->

- [ ] Regression sweep — re-run the `@executable` suite + fitness functions across the accepted milestones (green)
- [ ] Re-run agent-runnable `@manual` scenarios (evidence below)
- [ ] Broker the human `@uat` scenarios (sign-off below)

## Live / environmental checks

<!-- Things CI can't run on the integrated delivery: real credentials, vendor portals, live
     round-trips that only appear when milestones are exercised together. Each references the
     scenario it confirms. -->

- [ ] <check name>
      verifies → `@<tags> "<scenario name>"`  (in `<milestone>/<story>/tasks/<slug>.feature`)
      Environment: <what's needed — account, creds, env>
      1. <step>
      Expected: <observable result>
      Result: ___   By: ___   Date: ___

## Acceptance judgment (human, not a scenario)

<!-- "Does the delivery so far actually satisfy the person who asked for it?" — the whole-is-more-
     than-its-parts question a per-milestone gate can't ask. Judgment no assertion captures. -->

- [ ] <judgment>
      Owner: <person>   Result: ___   Date: ___

## Findings

<!-- Defects/gaps discovered during the session. Triaged and ROUTED — the fix lives at its
     destination, not here (a record + audit trail, never a duplicate of the contract). A bug
     becomes a scenario tagged `@bug` + `@uat-<id>` in the OWNING milestone, not a bugs file here.
     Raised by anyone — incl. `aof:feedback <uat-ref>`, which appends a raw `open` finding here (an
     acceptance observation against a UAT gate IS a finding, not a retro note). Triaged at `aof:verify`.
     Genuine *process* notes (how the session went) go to STATE.md ## Feedback (for retro) instead. -->

### F-01 — <short title>
- Observed: <date> — <what was seen, where>
- Type: <defect | design-gap | enhancement>   Severity: <blocker | major | minor | cosmetic>
- Triage (PO): <fix-now | defer to backlog>
- Routed to: <owning milestone `@bug` scenario | `DESIGN.md` rule | backlog>
- Status: open → triaged → scenario-written → fixed → verified → closed

## Sign-off / verdict

<!-- The session's accept decision — recorded only once the exit criteria are met. Accepting flips
     SESSION.md `status: done`, which unblocks anything that `depends:` on this session. -->

- Verdict: <accepted | accepted-with-follow-ups | rejected>   By: ___   Date: ___
