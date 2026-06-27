---
doc: retrospective
updated: 2026-06-27
---
<!--
  Milestone RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson; APPEND, never renumber. Reference findings/ADRs/commits, never restate.
  Source: STATE ## Feedback (for retro) + VERIFICATION ## Findings + blocker stops.
  Clean findings with no process lesson stay in VERIFICATION — they are NOT retro entries.
-->
# 17 · Notion Work-Board Sync — Retrospective

## R1 — A green `@executable` suite that STUBS the one external seam proves the internal wiring and NOTHING about the integration; the live check must be a build-gate BLOCKER, not a deferrable `@manual` lane

- **Kind:** defect (process + integration) · **Area:** verification discipline · **Stage:** verify (held `in-review`) → only caught when finally run live, post-acceptance · **Owner:** product-owner / architect · **Raised by:** the live verification run (VERIFICATION `@finding-NTN-V2`)
- **What happened.** m17 passed **1310+ green tests** with seven fitness functions, a VERIFICATION doc, and a clean validate gate — and was **completely non-functional against real `ntn`**. Every `@executable` test injected a fake spawn (`ctx.notionSpawn`), so the suite verified the projection/decision logic against a `ntn` command surface **that does not exist**: the apply layer built `ntn api pages create --data-source-id … --status-option … --relation-property …` (invented flags), assumed `NOTION_API_TOKEN` was **required** (wrong — `ntn` uses keychain `ntn login`; the env var is an optional override), and on Windows spawned the unspawnable `.cmd` shim. The single finding that should have caught all of it — **NTN-V1**, the live `@manual` round-trip — was **deferred** ("no token on the dev host"), so the one test that mattered never ran. The milestone shipped hollow and was only exposed when an operator tried to actually use it (`2026-06-27`), forcing a ground-up rebuild (NTN-V2) before it worked.
- **Why.** Two compounding causes: (1) the test architecture mocked the external boundary, so a passing suite was **structurally incapable** of detecting a wrong external contract — it tested aof against aof's *assumption* of `ntn`, never `ntn`. (2) The ACD process treats `@manual`/live lanes as **deferrable** (sign off "later, with a token"), which is reasonable for a UI screenshot or a 429-pacing check — but catastrophic when the milestone's **headline capability IS the external egress**. Deferring it deferred the whole proof.
- **Lesson.** For any milestone whose core deliverable is an **external integration** (the value is "we talk to X correctly"), the live round-trip against a real X is a **build-gate blocker**, not an `@manual` lane that verify can defer. At minimum: run ONE real call early (even an error response proves the argv/auth/transport are real), and treat "we have no credential to test it" as a **build blocker to resolve**, not a sign-off to postpone. A stub is for the *edges* (pacing, outage handling) — never for the *contract itself*. Corollary: a fitness function that asserts a **fictional** argv shape (`["api","pages","create",…]`) is worse than none — it manufactures false confidence; the four `acd-notion-*` arch-tests were rewritten to assert the REAL `ntn api -X POST/PATCH v1/pages -d <json>` egress.
- **Refs:** VERIFICATION `@finding-NTN-V1` (resolved) + `@finding-NTN-V2` (the rebuild); ARCHITECTURE ADR-003/004 (the apply layer + the CLI lane); commit `7bcb02e`; memory [[notion-sync-rebuilt]] + [[ntn-keychain-auth]].
