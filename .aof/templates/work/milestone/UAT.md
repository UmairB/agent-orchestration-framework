<!-- aof-generated: bundle -->

---
doc: uat
---
<!--
  Milestone UAT.md — answers ONE question: how does a human confirm it in the real world, and have they?
  Owner: qa. Conditional (only if something needs human/live verification CI can't run). Covers the
  milestone's stories/tasks.
  THE RULE: reference task scenarios (verifies →), NEVER restate their outcome text. Add the three
  things a scenario doesn't carry: procedure, environment, sign-off.
  A FRONTIER, not a graveyard — items migrate to @executable as they get automated; delete the row here.
-->
# NN · <Milestone Title> — UAT

## Live / environmental checks
<!-- Things CI can't run: real credentials, vendor portals, live round-trips. -->

- [ ] <check name>
      verifies → `@<tags> "<scenario name>"`  (in `<story>/tasks/<slug>.feature`)
      Environment: <what's needed — account, creds, env>
      1. <step>
      2. <step>
      Expected: <observable result>
      Result: ___   By: ___   Date: ___

## Acceptance judgment (human, not a scenario)
<!-- "Does this actually satisfy the person who asked for it?" — judgment no assertion captures. -->

- [ ] <judgment>
      Owner: <person>   Result: ___   Date: ___

## Findings
<!-- Issues discovered during UAT. Triaged and ROUTED — the fix lives at its destination, not here.
     A finding is a record + audit trail, never a duplicate of the contract. A bug becomes a
     scenario tagged @bug + @uat-<id>, NOT a bugs file. -->

### F-01 — <short title>
- Observed: <date> — <what was seen, where>
- Type: <defect | design-gap | enhancement>   Severity: <blocker | major | minor | cosmetic>
- Triage (PO): <fix-now | defer to backlog>
- Routed to: <DESIGN.md rule | new @bug task scenario | backlog>
- Status: open → triaged → scenario-written → fixed → verified → closed
