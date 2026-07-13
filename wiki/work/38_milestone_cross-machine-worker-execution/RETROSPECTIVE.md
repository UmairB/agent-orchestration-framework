---
doc: retrospective
milestone: 38
updated: 2026-07-13
---
<!--
  Milestone RETROSPECTIVE.md — the lessons, distilled. Written at `aof:verify 38`.
  Durable decisions graduate to ADRs (here: ADR-008); this doc carries the LESSONS.
-->
# 38 · Cross-machine worker execution & session presence — Retrospective

## The one-line story

**The milestone arrived at verify with 2409 green assertions, 9 green fitness functions, a green `validate`, and a
CONFORMS design review — and its headline feature did not work at all.** Six blockers were open. The live soak found
the first one at its very first step, and the rest fell out of pulling that thread.

## The defect class — ONE bug, SIX times

Every blocker is the same mistake wearing a different hat:

> **A component was exercised against a FIXTURE shaped to its own convenience, and never against its REAL PRODUCER.**

| # | Where | The fixture lie | What production actually does |
| --- | --- | --- | --- |
| **F1** | reconciliation fitness test (build) | fed attributed run **objects** | producer emits a bare `string[]` |
| **F4** | `aof session` CLI + task-05 contract | payload carries `workspace`/`repo` | Claude Code sends **`cwd`** — and **RESEARCH.md §2.2 had already measured this** |
| **F6** | fleet card render test | hand-built presence record | the real route carried **no presence at all** |
| **F9** | design review + task-04 render | a **LOCAL-shaped** fixture, which mounts `NodeCard` | production always mounts `GlobalNodePanel` — `NodeCard` was **dead code** |
| **F7/F8** | Rust desktop | demo fixture with object-shaped `activeRuns` | producer emits `string[]`; and the desktop never learned `sessions` at all |
| **F11** | ADR-003 aggregation tests | injected workspaces with **absolute** `workDir`s | the real registry hands back **relative** ones (`"./wiki/work"`) |

**F11 is the one to remember.** The milestone existed to fix *"a packaged tray app launched from the install dir
reads permanently `idle`."* ADR-003's cross-workspace aggregation was that fix. But descriptors stored `work_dir`
relative, so it resolved against the daemon's cwd: it re-read **one** workspace N times, rendered one run as
`running 2 runs`, silently **destroyed every cross-workspace session**, and from an install dir resolved **zero
workspaces → permanently `idle`**. *The fix did not fix the bug.* It only ever looked fixed because every test and
every dev run happened to launch from the repo — the one cwd where a relative path accidentally works.

## Lessons

### R1 — A green suite is not evidence a feature works. Only a producer-fed path is. → **ADR-008**
This is the milestone's whole yield, and it is now a durable decision (ARCHITECTURE **ADR-008**) with three armed,
non-vacuous fitness functions. Wherever we do **not own the producer** — a vendor hook payload, an HTTP route, a
cross-language surface — the contract test **must be fed a REAL CAPTURED payload from that producer**, and a
component must be tested **through the component production actually mounts**. A "wiring" test that inspects a
command string, and a render test fed a hand-built record, prove nothing.

### R2 — The answer was already in our own RESEARCH. Nobody cross-checked the contract against it.
F4's root cause was not a hard problem. **RESEARCH.md §2.2 had captured the real hook payload** — *"Common fields
present on every payload (measured, consistent across all four): `session_id`, `transcript_path`, `cwd`,
`hook_event_name`."* The task-05 contract nonetheless asserted the payload carries `workspace` and `repo`. The
developer faithfully built the contract; QA faithfully tested the contract; the contract contradicted the milestone's
own measured research, and no step in Three Amigos caught it.
**→ At contract time, a claim about a foreign producer must be traced to the RESEARCH line that measured it, or it is
not a claim — it is a guess.**

### R3 — Three times, the DOCUMENT was the liar — and once it was the designer's own doc.
- ADR-004 asserted *"both UIs consume the SAME projection function."* Structurally impossible — the desktop is
  **Rust** and cannot import a JS module. (Amended.)
- DESIGN §Surface 1's binding checklist named `NodeCard` — a component production never mounts — which is *how the
  false CONFORMS was manufactured*. As the designer put it: **"a checklist that enumerates the wrong anatomy is
  worse than no checklist — it lets a reviewer tick four rows against a six-row card and return a confident
  CONFORMS. It did."**
- Then, judging the final render, the designer found the build violated rules **they themselves had written that
  morning** — and correctly ruled **the build right and the doc wrong**: a run in workspace A and an editor open on
  workspace B are *two different pieces of work on one machine*, not competing claims. Enforcing the old per-node
  rule would have **suppressed the second session — hiding real work, re-introducing this milestone's exact lie of
  omission at a new address.**
**→ A spec/doc is a hypothesis about reality, not reality. When the build and the doc disagree, find out which one
is lying — do not assume it is the build.**

### R4 — Budget the live soak EARLY. It is the only step that touched reality.
Every automated gate passed while the feature was inert. The soak was scheduled as a closing formality and instead
did all the real verification work. **The `@uat`/`@manual` soak is not a rubber stamp at the end — for anything that
crosses a boundary we do not own, it is the primary instrument.** Run it as soon as a vertical slice exists, not
after the suite is green.

### R5 — "Deployed" is part of "done".
The milestone's code was complete and green in the working tree, but the *running* daemon and the *installed* binary
were the old build — so the wired hooks were calling a binary with no `session` verb. Nothing could have worked, and
no test could have told us. **Verification must run against the artifact a user actually runs**, not the source tree.

### R6 — Fixtures are contagious. Kill the one that lied.
The object-shaped `activeRuns` demo fixture in `app/desktop/ui/app.js` is what taught the Rust code the wrong shape
(F8) — and **it is still there** (finding F10, deferred). A convenience fixture does not just hide one bug; it
*teaches the next developer* the same false shape. When a fixture is found lying, delete it or re-capture it from the
real producer — do not leave it to re-offend.

## What went right (worth keeping)

- **The soak's step 1 was correctly designed.** It asserted a *concrete, judgeable* threshold ("within one heartbeat
  window the card reads exactly `working · <repo> (session)`"), so its failure was unambiguous and immediate.
- **The architecture underneath was sound.** Once the seams were connected, ADR-001 (additive fifth key), ADR-002
  (TTL reusing `isStale`), ADR-003 (aggregation) and ADR-004 (run-wins subsumption) all behaved exactly as designed.
  The pipeline was right; only its *edges* were untested.
- **Self-checks in fitness functions paid for themselves.** The new guards were written with planted-defect
  self-checks, and writing them **caught a real weakness twice** (a detector that missed F8's aliased array; another
  that was matching a *comment* naming the projection — which would itself have been the vacuous test this milestone
  is about).
- **Honest scoping in review.** The designer refused to pass states that were not in frame ("2 of 5 witnessed"),
  which forced the fleet into the run/two-repo/expired states and surfaced **DG-2**. A verdict is only as good as
  the states in frame.

## Carry-forward (open, non-blocking)

- **F5** — `aof session <verb>` reads stdin unconditionally (guards only `isTTY`); a flags-only caller with an open
  non-TTY stdin hangs forever.
- **F10** — the lying demo fixture (R6) still ships in `app/desktop/ui/app.js`.
- **F3** — task-00's unsatisfiable Scenario-Outline row; amend at next refine.
- **DG-1** — the product speaks two presence vocabularies (`♥ Ns` / `stale · Nm` vs `last seen 8d ago`). One ramp,
  one vocabulary.
- **Story-01 is unverified, not done.** Its `@executable` lanes are green — *and this milestone just proved six times
  over that this means nothing*. SPEC objective (b) (a worker cloning a private repo across machines) has **never
  been demonstrated**. It needs its two-machine soak and the SECURITY R1/R2/R4 sign-off before anyone believes it.
