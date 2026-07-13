<!-- aof-generated: bundle -->

---
type: chore
number: NN
slug: <kebab-slug>
title: "<Chore Title>"
status: not-started
owner: <role>
created: YYYY-MM-DD
updated: YYYY-MM-DD
depends: []
---
<!--
  CHORE.md — the record doc for a housekeeping chore. Answers ONE question:
  what needs doing, and is it done?
  Owner: whoever runs the chore. A chore is a TOP-LEVEL DRIVER (like a milestone or uat session) that
  groups no stories and carries no behavioural contract — no tasks/, no .feature, no user story. Its
  whole deliverable is a TICKED CHECKLIST. "Done" = every ## Definition of Done box is ticked AND
  `aof work validate` is green (aof:verify checks exactly this — no scenario run). It gates the stream:
  a milestone that `depends:` on this chore waits until it is `done`.
-->
# NN · <Chore Title>

## Intent

<!-- What housekeeping this is, and why it's needed now (a migration, config tidy-up, a cleanup
     discovered mid-build). One or two sentences — a chore is minimal-ceremony by design. -->

<what this chore does, and why>

## Definition of Done

<!-- The CLOSE CRITERION — a checklist of concrete, checkable items. The chore closes when every box
     below is ticked. Keep each item independently verifiable (a black-box check, not a vague goal). -->

- [ ] <concrete checkable item>
- [ ] <concrete checkable item>
- [ ] `aof work validate` is green (no regression)

## Notes

<!-- Optional. Anything chore-specific worth recording — context, gotchas, links. Keep light. -->
