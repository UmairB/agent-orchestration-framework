<!--
  F3 EVIDENCE / FIX SEED — captured at aof:verify 02 (2026-06-19, @uat live round-trip).
  This is a GENUINE PRD produced by the installed pm-execution `create-prd` skill (pm-skills v2.0.0,
  commit 5042ff61…) for the sample initiative "On-Call Compass". It is kept verbatim as the evidence
  for Finding F3: the real create-prd skill emits the 8-section template below (Summary / Contacts /
  Background / Objective / Market Segment(s) / Value Proposition(s) / Solution / Release) — there is
  NO `## Scope` heading and NO `## Milestones` heading, which is exactly what `readSeam`
  (src/planning-prd.mjs) keys on. So `readSeam` over this real output extracts only the objective and
  returns empty scope + empty milestones. The two sibling fixtures (`PRD-acme-notify.md`,
  `write-prd-output.md`) were hand-shaped WITH Scope/Milestones headings the real producer never emits,
  which is why the @manual lane was green against a PRD shape that does not occur in practice.

  This file is the F3 fix seed: harden `readSeam` to read this real 8-section structure (derive the
  milestone chunks from `## 7. Solution → 7.2 Key Features` + `## 8. Release`; derive scope from the
  in/out implied by Solution + `7.4 Assumptions`/`Release`), and make a real-producer fixture like this
  one a first-class case in `test/planning-prd.test.mjs`. (.md extension intentionally lacks the `PRD-`
  prefix-at-root so it is NOT auto-discovered as a second root PRD by the story's other scenarios.)
-->
# PRD — On-Call Compass

## 1. Summary

On-Call Compass is a lightweight internal tool that lets engineering teams define on-call
schedules, rotate them automatically, and notify the right person when something breaks. It
replaces the brittle shared spreadsheet teams use today, where the "who's on call?" answer is
often wrong and nobody gets paged in time.

## 2. Contacts

| Name | Role | Comment |
|------|------|---------|
| (sample) | Product Owner | Owns scope and milestone acceptance |
| (sample) | Eng Lead, Platform | Owns the rotation engine + integrations |
| (sample) | SRE Manager | Primary customer; defines escalation rules |
| (sample) | Design | Owns the schedule UI |

## 3. Background

**Context.** Most small-to-mid engineering teams track on-call duty in a shared spreadsheet: a tab
per team, a row per week, a name in a cell. It works until it doesn't — the cell is stale, the
person rotated off, or the alert goes to someone on holiday.

**Why now?** Teams have grown past the point where one spreadsheet owner can keep it correct, but
they are too small to justify a heavyweight commercial incident platform. The gap is a simple,
self-hosted tool that does the rotation and the paging, and nothing else.

**What changed.** Internal chat and email already expose webhooks/APIs we can notify through, so the
"page the right person" half is now cheap to build — we no longer need a dedicated telephony vendor
for a v1.

## 4. Objective

**Objective.** Give every engineering team a single source of truth for who is on call right now,
and make sure that person is actually reached when an incident fires — without anyone maintaining a
spreadsheet.

**Why it matters.** A wrong on-call answer turns a 5-minute fix into an hour of "who do I call?".
Correct, automatic rotation + reliable paging directly cuts time-to-acknowledge.

**Key Results (SMART).**
- Reduce median time-to-acknowledge for paged incidents from ~18 min to under 5 min within one
  quarter of rollout.
- 100% of participating teams have a live, auto-rotating schedule (zero spreadsheets) within 6 weeks.
- ≥95% of pages reach an acknowledging human on the first escalation step.

## 5. Market Segment(s)

- **On-call engineers** — need to know when they're on, and to stop being paged when they're off.
- **Team leads / SRE managers** — need to define the rotation cadence and the escalation policy, and
  trust it runs itself.
- **Incident responders** — need the current on-call resolved instantly at 3am, not looked up.

**Constraints.** Self-hosted / internal-only (no customer data leaves the network); must integrate
with the chat + calendar tools teams already use; one engineer can stand it up in an afternoon.

## 6. Value Proposition(s)

- **Always-correct "who's on call".** The schedule rotates on a defined cadence with no manual edits,
  so the answer is never stale.
- **The right person actually gets paged.** Notifications fire on the live schedule, and escalate to
  a backup when the primary doesn't acknowledge.
- **It shows up where people already are.** On-call shifts appear in personal calendars and the team
  chat, not in a tab someone forgot to open.
- **Better than the spreadsheet** on the one job that matters: it is correct without anyone tending it.

## 7. Solution

### 7.1 UX / Prototypes
- A schedule view: a calendar grid showing who is on call per day/week, with the current on-call
  highlighted.
- A rotation editor: pick the team, the members, the cadence (e.g. weekly), and the handoff time.
- An escalation policy editor: primary → backup → manager, with acknowledge timeouts.

### 7.2 Key Features
1. **Schedule & rotation model** — define a team, its members, a rotation cadence and handoff time;
   resolve "who is on call at time T".
2. **Automatic rotation engine** — advance the rotation on schedule with no manual edits; handle
   overrides (swaps, holidays) without breaking the cadence.
3. **Notifications & escalation** — page the live on-call when an incident fires; escalate to the
   backup, then the manager, on acknowledge-timeout.
4. **Calendar sync** — publish each engineer's on-call shifts to their personal calendar (iCal feed).
5. **Web UI** — the schedule, rotation editor, and escalation editor in a simple browser app.

### 7.3 Technology (optional)
- A small service with a persisted schedule model; integrations to chat + email webhooks for paging
  and an iCal feed for calendars. Exact stack TBD by engineering.

### 7.4 Assumptions
- Teams will accept a fixed set of cadences (weekly/daily) for v1 — no arbitrary custom patterns yet.
- Chat + email webhooks are sufficient for v1 paging; no SMS/voice vendor needed.
- One escalation chain per team is enough for v1.

## 8. Release

- **First version (MVP).** The schedule/rotation model + the automatic rotation engine + basic
  notifications — i.e. a correct, auto-rotating "who's on call" that can page that person. This is the
  smallest thing that replaces the spreadsheet.
- **Fast follow.** Escalation chains (backup/manager on timeout) and calendar sync.
- **Later.** The full web UI for self-service rotation/escalation editing; richer override handling.
- Timeframes are relative; no fixed dates.
