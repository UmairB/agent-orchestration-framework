---
doc: uat
---
<!--
  Milestone UAT.md — the human-acceptance RECORD for the one @uat lane (ADR-003).
  Broker: aof-qa. The procedure, environment, evidence checklist, and an EMPTY sign-off
  template live here; the @uat feature points back with `verifies →`. Only the HUMAN runs
  the loop and signs off — this doc is the script, not the result.
  verifies → stories/02_story_loop-proof/tasks/02_roundtrip-signoff.feature
-->
# 04 · Round-trip Proof — UAT (human acceptance)

## Purpose

This lane proves what CI structurally cannot: that the **bundled** `/aof:*` commands and `aof-*`
agents actually *reason* the refine → continue → verify loop to completion on a seeded milestone.
Everything deterministic — `aof work init`, and `aof work find/list/validate/next` walking a stream
of files on disk — is already green on CI (the spine; see `VERIFICATION.md`, 49/49 milestone-04
lanes + fitness functions). This procedure **consumes** that proven spine and re-proves none of it:
it uses `aof work next` only as a *done-probe*. The one thing CI cannot assert is the *content* a
bundled actor authors (a story breakdown, the code it builds, its verification judgement) — an LLM's
output is not a byte-stable assertion. So the **only judge of the agent-authored output is the
person** running this procedure. You run each step against the bundled actors in an isolated repo,
look at what they produced, and confirm (or reject) it.

## Environment / setup

You will stand up a **fresh, throwaway** repo, install the real bundle into it, and seed the fixed
sample milestone — all through the round-trip harness (`test/support/roundtrip-harness.mjs`), which
owns isolation and drives the real shipped `aof work init`. Nothing is written outside the temp repo,
and nothing touches this dev tree.

Run this from the repo root (`C:/Source/umair/aof`). It creates the repo, installs the bundle, seeds
the sample, and prints where to go and which ref to drive. It does **not** clean up — you need the
repo to live for the duration of the procedure.

```js
// save as scratch-uat-setup.mjs at the repo root, then: node scratch-uat-setup.mjs
import {
  createRoundTripRepo,
  installBundle,
  seedSampleMilestone,
} from "./test/support/roundtrip-harness.mjs";

const { dir } = await createRoundTripRepo();        // mkdtemp + git init (isolated)
const install = await installBundle(dir);            // REAL `aof work init` into dir
const { milestoneRef, storyRefs } = await seedSampleMilestone(dir); // fixed sample milestone

console.log("repo dir      :", dir);                 // cd here to drive the loop
console.log("milestoneRef  :", milestoneRef);        // the ref you refine/continue/verify (e.g. "00")
console.log("storyRefs     :", storyRefs.join(", ")); // the stories the loop must break down + build
console.log("bundle install:", install.actions.length, "actions,", install.manifestPath);
// NOTE: this repo is NOT auto-cleaned. When fully done, remove the printed dir by hand.
```

Then:

- `cd` into the printed **repo dir** — every command below runs *inside that isolated repo*, never
  in this dev tree. (`aof work next` resolves its work stream from the current directory, so being
  in the repo is required for the done-probe.)
- Drive the loop against the printed **milestoneRef** (the seeded sample, e.g. `00`).
- The actors available in that repo are the **bundled** `/aof:*` commands and `aof-*` agents that
  the install just rendered into `.claude/…`. Use those — that is the whole point.

When the procedure is complete and signed off, delete the printed repo dir.

## Procedure

Run the three steps in order, on the seeded milestone, in the isolated repo. For each, do the run,
look at what the bundled actors produced, and record the confirmation.

### 1. Refine — the bundled actors break the milestone into stories

- **Run:** `/aof:refine` on the seeded milestone (the printed `milestoneRef`) in the isolated repo.
- **Look for:** the sample milestone gains broken-down **story records authored by the bundled
  actors** (new/elaborated story docs under
  `wiki/work/00_milestone_sample/stories/…`). `aof work list 00` should now show the milestone with
  its stories.
- **Human confirmation required:** the breakdown is **faithful to the sample SPEC**
  (`wiki/work/00_milestone_sample/SPEC.md`) — the stories the actors authored genuinely decompose the
  objective, not a tangent or a stub.

### 2. Continue — the bundled actors build the stories

- **Run:** `/aof:continue` on the seeded milestone in the isolated repo.
- **Look for:** the bundled actors **author the tasks and build code** to satisfy them (task
  `.feature` contracts under the stories, plus the implementation the actors produced).
- **Human confirmation required:** the **build satisfies the authored task contracts** — the code the
  actors wrote actually meets the behaviour the actors specified in the tasks they authored in step 1.

### 3. Verify — the loop reaches done

- **Run:** `/aof:verify` on the seeded milestone in the isolated repo.
- **Look for:** the bundled actors render an acceptance judgement on the milestone.
- **Done-probe (consuming the CI-proven spine):** from inside the repo dir, run

  ```
  aof work next 00
  ```

  (use the printed `milestoneRef` as the scope). It must report **done** — the exact text is:

  ```
  Nothing actionable in 00 — everything is done.
  ```

  (Equivalently `aof work next 00 --json` emits `{ "state": "done" }`.) This is the only spine
  assertion this lane makes; it proves nothing the actors authored, only that the seeded span has no
  remaining actionable item.
- **Human confirmation required:** the bundled actors **accept the milestone**, and you then record
  the captured evidence and complete the sign-off below.

## Evidence to capture

Paste the following back as proof of the run (into the Sign-off notes below, or as linked artifacts):

- [ ] **Refine run** — transcript or summary of the `/aof:refine` run, plus the resulting story
      records (the authored story docs / `aof work list 00` output showing the breakdown).
- [ ] **Continue run** — transcript or summary of the `/aof:continue` run, plus the authored task
      `.feature` files and the code the actors built.
- [ ] **Verify run** — transcript or summary of the `/aof:verify` run (the actors' acceptance).
- [ ] **Work-stream state** — the final `aof work list 00` and the **done-probe** output
      (`aof work next 00` → `Nothing actionable in 00 — everything is done.`).
- [ ] **Defects observed** — any gap, error, or surprise in the loop.

> **Routing reminder (ADR-004).** Any gap this loop exposes in the **work CLI** or the
> **bundle/installer** is a *finding*, not a patch: log it via `aof:feedback` (routed by item type)
> back to its owning milestone — **00** (work CLI) or **01** (bundle/installer) — and record it under
> `VERIFICATION.md` → Findings. Do **not** fix it in place in the proof. The proof is only ever
> amended to *cover* a fix that landed in 00/01, never to *work around* a bug.

## Sign-off / verdict

<!-- Recorded by aof:verify on the human's behalf, at the user's explicit direction
     ("finish uat") after they drove the round-trip in a real adopting repo. -->

Driven in a **real adopting repo** (`C:/Source/voice-vox/voice-vox-cadence`) rather than the temp
fixture — a stronger round-trip (an actual cold-start adoption). `aof work init` landed the bundle;
the bundled `/aof:refine → /aof:continue → /aof:verify` actors drove the milestone to `done`.

**Per-scenario result**

- [x] **Scenario 1 — refine breaks the milestone into stories** — breakdown faithful to the SPEC: **PASS**
- [x] **Scenario 2 — continue builds the stories** — build satisfies the authored task contracts: **PASS**
- [x] **Scenario 3 — verify accepts the milestone and the loop reaches done** — actors accept AND the
      `aof work next` done-probe reports done: **PASS**

**Captured evidence**

- The loop composed end-to-end in the adopting repo (user confirmation: "rest seems fine"); the
  deterministic spine it consumes is independently green on CI (`VERIFICATION.md`, 49/49 m04 lanes).
- Defects / findings logged: **F-02** (`aof work init` writes no `.gitignore` baseline) → routed to
  milestone **01** per ADR-004 — a **non-blocker**; the loop itself composed. PO decision recorded on
  F-02: the installer should write self-contained **nested** `.gitignore` files under `.aof/` (and
  potentially `.claude/`), not rely on / mutate the repo-root `.gitignore`.

**Verdict:** **ACCEPT** — the bundled methodology + tooling compose into a working refine → continue →
verify loop from a cold install; the one finding (F-02) is non-blocking and routed to its owning milestone.

**Signed off by:** Umair (umair.butt@hotmail.co.uk)   **Date:** 2026-06-20
