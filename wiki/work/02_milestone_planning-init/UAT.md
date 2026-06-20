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
# 02 · Planning Init (the bought seam) — UAT

## Live / environmental checks
<!-- Things CI can't run: real credentials, vendor portals, live round-trips. -->

- [x] Shatter produces framed milestone SPECs with origin from a representative PRD
      verifies → `@manual "shatter produces one milestone SPEC per identified chunk"`,
                 `@manual "each produced SPEC stamps origin back to the PRD it was shattered from"`,
                 `@manual "the seam is one-directional — the PRD is not edited back"`
                 (in `stories/01_story_shatter-consumes-prd/tasks/01_seam-readout-and-origin.feature`)
      Environment: a runtime that can run the `aof:shatter` agent command; the checked-in
      `fixtures/PRD-acme-notify.md`; a scratch `work.dir` to receive the new milestone SPECs.
      1. Copy `fixtures/PRD-acme-notify.md` to a scratch workspace root.
      2. Run `aof:shatter` with no path argument so it auto-discovers the fixture.
      3. Inspect the SPECs written under the scratch `work.dir`.
      Expected: one milestone `SPEC.md` per chunk in the fixture's milestone list; each SPEC has an
      objective + in/out scope; each frontmatter `origin:` points at the consumed PRD; the fixture PRD
      is byte-for-byte unchanged.
      Result: **PASS** (agent-run `@manual`, isolated OS-temp scratch — 3 SPECs, one per chunk, each
      origin-stamped; PRD byte-identical sha256 `29fc9367…4be4880`). Evidence: VERIFICATION.md
      `## Verification evidence`.   By: aof-developer (orchestrated)   Date: 2026-06-18

- [x] Live create-prd → shatter round-trip (the seam's real end-to-end proof, RESEARCH A9)
      verifies → `@uat "a live create-prd writes a discoverable PRD-*.md"`,
                 `@uat "shatter discovers and shatters the live PRD into framed milestones"`
                 (in `stories/01_story_shatter-consumes-prd/tasks/02_live-roundtrip.feature`)
      Environment: a live runtime with pm-skills `pm-execution` available; a clean workspace with no
      pre-existing `PRD-*.md`.
      1. In a clean workspace, run create-prd (pm-execution) to author a PRD for a small sample
         initiative.
      2. Confirm a `PRD-*.md` was written to the workspace and read it.
      3. Run `aof:shatter` with no explicit path.
      4. Inspect the produced milestone SPECs.
      Expected: create-prd wrote a well-formed `PRD-*.md` (objective / scope / milestone-sized chunks);
      shatter found it without being given a path; one framed `SPEC.md` per chunk; each stamps `origin`
      back to the produced PRD.
      Result: **PASS** (run live at aof:verify, F1/F2 now resolved so the planner installs). The
      installed pm-execution `create-prd` skill authored a well-formed `PRD-oncall-compass.md` at the
      scratch root; `discoverPrd` auto-found it with no path; shatter framed it into **5 origin-stamped
      milestone SPECs** with an acyclic `depends` graph (`aof work validate` → PASS). Evidence:
      VERIFICATION.md `## User sign-off`. **Caveat → Finding F3 (now RESOLVED 2026-06-19):** the faithful
      framing had been produced by the PO reading the PRD prose because `readSeam`'s structured read-out
      returned empty scope/milestones on the real create-prd 8-section template; with F3 fixed (ADR-010,
      re-verified) the read-out now carries objective + 5 milestone chunks + 2-in/1-out scope from the
      genuine producer output, so the seam is proven end-to-end and the milestone is **accepted**.
      By: product-owner (brokered inline)   Date: 2026-06-19

## Acceptance judgment (human, not a scenario)
<!-- "Does this actually satisfy the person who asked for it?" — judgment no assertion captures. -->

- [x] Does the live-produced PRD's framing into milestones feel faithful to the initiative — would the
      product-owner accept these milestone boundaries as the roadmap?
      Owner: product-owner   Result: **SIGNED OFF — faithful.** The PO judged the 5-milestone framing of
      the On-Call Compass PRD (boundaries + `depends` edges) faithful to the initiative and acceptable as
      the roadmap.   Date: 2026-06-19

## Findings
<!-- Issues discovered during UAT. Triaged and ROUTED — the fix lives at its destination, not here.
     A finding is a record + audit trail, never a duplicate of the contract. A bug becomes a
     scenario tagged @bug + @uat-<id>, NOT a bugs file. -->

- **F1 (blocker, RESOLVED 2026-06-19).** `aof planning init --runtime claude` (live) cloned the
  `owner/repo` shorthand over **SSH** → `Permission denied (publickey)` for HTTPS-only GitHub auth.
  Fixed under ADR-007 (emit `https://github.com/phuryn/pm-skills.git#<sha>`). Re-verified live: the clone
  now goes over HTTPS, no SSH denial.

- **F2 (blocker, RESOLVED 2026-06-19).** F1's HTTPS fix worked, but `aof planning init --runtime claude`
  still failed for everyone — `claude plugin marketplace add …git#<sha>` → `Remote branch <sha> not found
  in upstream origin` (`marketplace add` is `git clone --branch <ref>`, which takes a branch/tag, not a
  bare sha). Fixed under ADR-008 (pin the immutable tag `#v2.0.0`; record the resolved 40-hex commit as
  the audit anchor) + a networked clone-smoke fitness function. Re-verified live: marketplace registered
  at `…git#v2.0.0`, 3 plugins installed.

- **F3 (blocker, RESOLVED 2026-06-19 — surfaced by this `@uat`, fixed + re-verified).** The live
  round-trip ran and the framing was signed off faithful, but `readSeam` over the genuine create-prd PRD
  returned objective ✓ / scope `{in:[],out:[]}` / milestones `[]`. The real create-prd skill emits the
  8-section template (Summary / Contacts / Background / Objective / Market Segment(s) / Value
  Proposition(s) / Solution / Release) — no `## Scope` and no `## Milestones` heading, which is what the
  read-out helper title-matched on. Both story-01 fixtures were hand-shaped with those headings, so the
  `@manual` read-out lane was green against a PRD shape the bought planner never produces. Triaged
  **blocker** and routed → `aof:continue 02` via
  `stories/01_story_shatter-consumes-prd/tasks/03_real-template-readout.feature` (`@bug @finding-F3`):
  `readSeam` hardened to the real template (ADR-010 — milestone chunks ← `### 7.2 Key Features` fallback;
  scope ← `## 8. Release` bold-lead labels), genuine create-prd output added as a first-class fixture
  (`fixtures/PRD-oncall-compass.real-create-prd.md`), ADR-005 annotated + RESEARCH §7 corrected.
  **Re-verified at this `aof:verify`:** the read-out over the genuine fixture yields objective + 5
  milestone chunks + 2-in/1-out scope (was objective-only), no regression on the prior fixtures — F3 is
  closed and the milestone is accepted. Full record: VERIFICATION.md `## Findings`.
