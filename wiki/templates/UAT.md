<!--
  UAT.md — answers ONE question: how does a human confirm it in the real world, and have they?
  Owner: qa.  Conditional (only if something needs human/live verification CI can't run).
  THE RULE: reference scenarios (verifies →), NEVER restate their outcome text. Add the three
  things a scenario doesn't carry: procedure, environment, sign-off.
  This is a FRONTIER, not a graveyard — items migrate to @executable as they get automated, and
  the corresponding row is deleted here. A shrinking UAT is a sign of maturity.
-->
# NNN · <Milestone Name> — UAT

## Live / environmental checks
<!-- Things CI can't run: real credentials, vendor portals, live round-trips. -->

- [ ] <check name>
      verifies → `@<tags> "<scenario name>"`
      Environment: <what's needed — account, creds, env>
      1. <step>
      2. <step>
      Expected: <observable result>
      Result: ___   By: ___   Date: ___

## Acceptance judgment (human, not a scenario)
<!-- "Does this actually satisfy the person who asked for it?" — judgment no assertion captures. -->

- [ ] <judgment>
      Owner: <person>   Result: ___   Date: ___

## Cross-milestone regression (if applicable)
<!-- Manual integration checks that span milestones. Reference the prior milestone's scenario. -->

- [ ] <check>
      verifies → `@milestone-<prior> "<scenario name>"`
      Result: ___
