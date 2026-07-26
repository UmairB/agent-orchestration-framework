---
doc: retrospective
milestone: 38
updated: 2026-07-26
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

## The second arc (`2026-07-16` → `2026-07-26`) — the class recurred THREE more times, and once inside its own fix

The retro above was written at the first close attempt, with six instances of one defect class. The milestone then
ran ten more days, added five stories, and the class appeared at **three more addresses** — the last one *inside the
evidence of an earlier fix for the same key*:

| # | Where | The lie | What production actually does |
| --- | --- | --- | --- |
| **F18** | cross-node presence **write** seam | `control-stream-server/02` fed a **four-key** fixture and asserted a round-trip — it had no `sessions` key to lose | `applyPresenceFrame` rebuilt only the m23 four keys, so a remote node's `sessions` died in transit |
| **F21** | fleet assign route | tasks 00–03 are honestly **producer-fed** — but in a **single-workspace** fixture, where the right target and the wrong target are the same value | the fleet face is global; `POST /api/mesh/assign` resolved the ref against the daemon's OWN project dir and **dispatched different work off a `200 ok`** |
| **F23** | cross-node presence **read** seam | F18's own proof read the store's bytes and rendered them correctly — one layer **below** the consumer | `fabricLivenessFor`'s four-key pseudo record always wins `mergePresence`, so `sessions` is destroyed again on the way out; the desktop can never show a remote node `working` |

**The same additive key was destroyed at two different seams, eight days apart, by two separate blockers.** That is
the finding that sent F23 to milestone 42 rather than to another point fix: three places rebuild a presence record
field-by-field, and a field-by-field rebuild is a whitelist.

### R7 — Producer-fed constrains the DATA, not the CONFIGURATION. → **ADR-008 addable clause**
Story 04 honoured ADR-008 in full — real route, real verb, every mint read back from the real store — and still
shipped F21, because a single-workspace fixture **structurally cannot express a wrong-target defect**: the caller's
own workspace is the only candidate, so the right answer and the wrong answer are the same value. F-38.04a then
repeated it on the node axis (a stale `<select>` value POSTing a different target than it displayed).
**→ A seam whose failure mode is a WRONG TARGET must be exercised with ≥2 candidate targets, one of which is not the
caller's own — and where the discriminator is an identifier, with that identifier COLLIDING across them.** The live
soak's `ref 18` existing in two workspaces is exactly what turned a silent failure into a silent wrong dispatch.

### R8 — Prove the evidence command fails before trusting that it passed. (F19)
Five passes recorded *"`node --test test/arch/*.test.mjs` → 219 ok"* as their foundation. **That command ran nothing:**
those files export case *arrays* and register zero `node:test` tests, so it reported one trivial pass **per file** —
the "219" was a file count, and it masked nine genuinely red cases. The milestone's own thesis, turned on its
verification: the green that proved nothing was the green about proving nothing.
**→ An evidence command must be shown to go RED when the thing it measures is broken. Count assertions, not files —
and if a number in a record doc equals `ls | wc -l`, that is not a coincidence.**

### R9 — Take evidence at the CONSUMER's door, not at the store. (F23)
F18's fix was real and its proof was real: the peer's record on disk carried `sessions`, and `fleetCurrentWorkLines`
rendered it. Both halves stop one layer short of the surface that actually polls. The desktop's only data path is
`aof mesh status --json` — pinned by its own test as *"the only fleet-data command issued"* — and that command strips
the key.
**→ The honest terminus of a claim is the exact command or route the consumer polls. Name it in the evidence, or the
evidence is one layer short. "Correct in the store" and "renders correctly when handed the bytes" do not compose into
"the consumer receives it."**

### R10 — For a constrained layout, measure; do not reason. (DG-15 → DG-22)
The assign row's yield order was first built from flex `shrink` factors (1000000 : 1000 : 1 — on paper, ~99.6% of any
squeeze goes to the lowest-priority element). Measured, the drill-in yielded 13.1px while the chip, weighted 1, yielded
17.5px, and the protected target truncated anyway. **Flexbox distributes a squeeze; it cannot express "this element
goes away so that one can be whole."** Two more defects fell out the same way (`min-w-0` letting a pinned arrow escape
the card's content box; `flex-1` making a kept label GROW and squeeze the element it was meant to protect).
**→ None of the three was visible in the markup; all three came off a `getBoundingClientRect` ledger. Priority is a
discrete budgeted drop, not a ratio — and a design rule whose own exemplar does not fit the slot is a wrong RULE, not
a build defect (DG-17: the arithmetic proved it before any code changed).**

### R11 — The STATE entry is part of the change, not a follow-up.
A dozen m38 commits landed on `2026-07-25`/`26` (F27/F27b's PTY submit timing, the folder-trust clear, F-38.06i's
commit-before-push, `mesh recover-push`, the assigned-workspace checkout fix, UI phase selection) with **no Progress
entry in STATE.md**. At this close the git log was the only narrative for a third of the milestone's fix history, and
this pass had to reconstruct it from commit subjects.
**→ A fix without its STATE line is a fix nobody can review the reasoning of later. Write the entry in the same pass
that writes the code, not at the close — by the close, the reasoning is gone.**

### R12 — When the agent cannot reach the second machine, the human gate is the ONLY gate. Say whose evidence it is.
This milestone's five remaining acceptance lanes were live cross-machine soaks. At the close, `ssh umairs-mac-mini`
refused every connection while the node was demonstrably up on the tailnet (**F25**), so the worker's build could not
even be preflighted, and the milestone closed on the **operator's first-hand attestation** that the soaks and UAT were
complete.
**→ That is a legitimate close — the operator is the human acceptance authority for a `@manual`/`@uat` lane — but the
record must say plainly which evidence was agent-measured and which was attested, and must transcribe no procedure it
did not run. Also: remote read access is part of the soak instrument. Treat it like the build — verify it before the
pass that depends on it, not during.**

### R13 — An agent's tool list must match the maturity of the doc it owns.
`aof-designer` owns `DESIGN.md` for a milestone's whole life but ships with `Write` and no `Edit`, so every pass over
a mature design doc costs a full hand-transcription round — and a transcription is a silent-clobber risk on exactly
the class of record this milestone spent itself learning to protect.
**→ A doc-owning agent needs `Edit` from the moment its doc starts growing. Capability is part of the role
definition, not an implementation detail of the harness.**

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
- **~~Story-01 is unverified, not done.~~** (resolved at the close) — story 01 was accepted `2026-07-26` with its
  two-machine private-clone soak **attested by the operator** (see R12); SECURITY's F14/F15/F16 residuals were fixed
  and re-verified closed during the `2026-07-16` provisioning arc.

### Carried out of this milestone at the close (`2026-07-26`)

- **F23 (blocker) → milestone 42, wave (b).** The presence record is rebuilt field-by-field at THREE seams and only
  two know its current shape, so `aof mesh status` strips `sessions` for every fabric-Online peer and the desktop
  fleet can never render a remote node `working`. Measured: `online:true` → key absent → `idle`; `online:false` → key
  present → `working · aof (session)`. **SPEC objective (a) is met for the control node, not for a remote node on the
  desktop face.**
- **F24 → milestone 42 (debt item 4).** A node descriptor's `workspaces[]` is the *publisher's* workspace stamped onto
  every node in the roster — both live cards advertise `C:\WINDOWS\system32`, the macOS worker included.
- **F26 → milestone 42, wave (a).** The atomic presence/node publish leaks its temp file (39 + 6 orphans live, the
  newest written by the running daemon).
- **F13 / F5 / F3** — unchanged, deferred, re-confirmed open at source at the close.
- **DG-18 / DG-23** — deferred design residues on the m35 card footer; plus the **§Surface 2 `@uat` visual residues**
  story 04 recorded (one-node roster, the chip-dot zoom crop, ladder rungs 1 and 3, a refusal whose holder differs
  from the picker's selection).
- **Two stale non-m38 test lanes surfaced by the honest sweep** — the bundle command-count constants (`22 !== 21`,
  7 cases) and `agent-model-override` still asserting the retired `sonnet` developer default. Neither is m38's, and
  neither should become the next milestone's inherited noise.
