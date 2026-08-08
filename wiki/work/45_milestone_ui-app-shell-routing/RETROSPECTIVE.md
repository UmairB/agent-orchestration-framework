---
doc: retrospective
milestone: 45
written: 2026-08-08
---
<!--
  Milestone RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson, appended and never renumbered. References VERIFICATION findings, ADRs and
  the observability snapshot; never restates them. A clean catch with no process lesson is NOT an
  entry — it already lives in VERIFICATION.md.
-->
# 45 · UI app shell & path routing — Retrospective

Distilled from `STATE.md`'s `## Feedback (for retro)` notes, `VERIFICATION.md`'s findings across the
four story gates and the milestone end gate, and `observability/report.md`. Thirteen lessons from
roughly forty recorded observations; the rest were clean catches that carry no carryable lesson.

The through-line, and it is worth naming before the entries: **six of the first twelve are the same
mistake in different costumes — a rule that nothing could check.** A contract in a comment, a fitness
function whose name outran its body, a lane that asserted a class string, a DESIGN clause with no
producer, a deferral written on only one side, a promise about layout that no headless test could
reach. Each looked like a rule and behaved like a wish.

---

## R1 — A contract stated in a comment is not a contract

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** orchestrator (verify)

**What happened.** `Shell.tsx` stated that a surface reached on an origin that cannot serve its API
"degrades through its OWN existing error state". Three of four surfaces did. `/config` on the fleet
origin unmounted the entire application instead — a blank page, one click from the fleet's own nav.

**Why.** The sentence was written at build, read by two reviewing agents, and never had a lane. The
`failed` state it promises was built, rendered and tested — but only ever reachable from
`surfaceMountFor`'s unknown-route-id path, so the tests proved the state RENDERS without proving that
anything ever ENTERS it.

**Lesson.** When a contract says "X degrades into state S", the row that matters drives **X**, not S.
A state with a test but no producer is an untested state wearing a passing lane.

**Refs:** `@finding-F-45-M-1`; `stories/03_.../tasks/05_surface-crash-degrades-in-shell.feature`

---

## R2 — Ask whether a rule is untested or UNTESTABLE; the second is a tooling bug in costume

- **Kind:** misunderstanding · **Area:** process · **Stage:** build · **Owner:** QA · **Raised by:** orchestrator (verify)

**What happened.** R1's contract had no lane because `test/support/mini-react.mjs` had no class
components, and a React error boundary — the only containment React offers — has no function form. The
promise was undrivable headlessly, so prose filled the gap for the whole milestone.

**Why.** Nobody decided not to test it. The instrument could not, and the limits of the instrument
silently became the shape of the contract.

**Lesson.** When a contract has no lane, ask which it is. "Untestable with what we have" is cheap to
fix once named — class + boundary support was ~40 additive lines — and leaving it unnamed lets the
document and the build drift apart with neither looking wrong.

**Refs:** `test/support/mini-react.mjs`; `test/support/react-app-harness.mjs`

---

## R3 — A lane that asserts a class string can only ever confirm the class

- **Kind:** mistake · **Area:** contract · **Stage:** build · **Owner:** QA · **Raised by:** designer (GAP-4) + orchestrator

**What happened.** Two `shell-regions` lanes existed over the identity chip's width and named the right
rule in their own titles ("the chip PULSES at its final size"). They passed all milestone while the chip
reserved 4.26 characters instead of 7, because they asserted the literal `min-w-[7ch]`. Under
`box-sizing: border-box` that is a border-box minimum, so `px-2` and the border ate 18px of it; any
identity over ~4 characters grew the box and moved the nav.

**Why.** DESIGN named a utility class where it meant an invariant. The lanes copied the class. The
prose said "same-sized", the cascade said otherwise, and the lanes froze the cascade's answer.

**Lesson.** State rules as measurable invariants ("the box and its placeholder measure identically"),
never as a utility class — a class name is an implementation that reads like a contract. And route both
call sites through one constant so sameness is structural rather than two strings agreeing today.

**Refs:** designer GAP-4; `IDENTITY_CHIP_WIDTH_CLASS`; DESIGN §R2 identity chip

---

## R4 — Some rules are facts about the cascade, and only interaction can check them

- **Kind:** mistake · **Area:** code · **Stage:** verify · **Owner:** developer · **Raised by:** orchestrator (`@uat`)

**What happened.** The top bar scrolled clean out of view on `/fleet` (measured y = −1200 after a
1200px wheel), against DESIGN's R2 row saying in terms that it never does. The bar carried
`sticky top-0`. Two independent causes: DESIGN GAP D1's `overflow-x: hidden` clamp made `html`, `body`
**and** a redundant third copy on the shell root into scroll containers, so `sticky` resolved against a
box that never scrolls; and the bar's sticky was additionally confined to its 88px parent.

**Why.** Every lane in the milestone tests values a module returns or nodes a tree contains. This is a
property of the computed cascade across four ancestors. No model lane could see it, and no screenshot
could either — it only exists once something scrolls.

**Lesson.** A milestone that introduces layout chrome needs at least one lane that *interacts*:
scrolls, tabs, resizes. The `@uat` gate caught this only because it was actually run; a review that
judged stills alone would have shipped it. Corollary: prefer `overflow-x: clip` to `hidden` for a
page-level clamp — identical clamping, but `hidden` computes the other axis to `auto` and creates a
scroll container.

**Refs:** GAP-5 in `VERIFICATION.md` §`@uat`; `contentModeFor.rootEstablishesScrollport`

---

## R5 — A fitness function must check what its name claims

- **Kind:** near-miss · **Area:** architecture · **Stage:** verify · **Owner:** architect · **Raised by:** architect (45/04 review)

**What happened.** `acd-no-surface-mode-url-literal` claimed "a fifth producer cannot appear unseen"
over a hand-maintained four-entry loop. A sandboxed fifth producer minting a path directly kept it
green.

**Why.** The name described the intent; the body described the four cases someone had thought of.

**Lesson.** Name assertions for what the body checks, or make the body check the name. Strengthened
before close to a closed route-path vocabulary sweep over 295 files with shrink-only exemptions.

**Refs:** 45/04 findings, arch F1

---

## R6 — A cross-milestone deferral is complete only when it appears in the RECEIVER's record

- **Kind:** mistake · **Area:** process · **Stage:** verify · **Owner:** architect · **Raised by:** architect (45/04 review)

**What happened.** m45's STATE said "routed to m47" for two findings while m47's documents carried no
trace of either.

**Why.** Writing the deferral where you noticed it feels like routing it. It is not; it is a note to
yourself.

**Lesson.** A routing is a write to the receiving item, and the sending record cites it. The same rule
earned its keep again at the end gate: DG-45-4 and DG-45-5 are recorded with fix shapes and close
conditions, and DG-45-5 sits **at the rule it defers** rather than in a gap list, so a reader meets the
deferral and the rule together.

**Refs:** 45/04 findings, arch F2/F3/F4; DESIGN §Cross-origin honesty

---

## R7 — A rule this milestone cannot produce must say so at the rule

- **Kind:** misunderstanding · **Area:** contract · **Stage:** verify · **Owner:** designer · **Raised by:** designer (GAP-3)

**What happened.** DESIGN's cross-origin honesty rule requires that an unresolvable destination "must
not render as a live link". Nothing in production passes `resolvable`, so every nav item is a live link
on every origin — and following `Board` from the fleet lands on a surface that cannot load its stream.
The reviewer could not tell "not built" from "built and never triggered", which cost a full review
round-trip.

**Why.** The rule was written for the finished arc and filed as though it bound this milestone.

**Lesson.** A binding rule with no producer is worse than a deferred one. Name the deferral, its owner
and its close condition **at the rule**, and re-point any `@uat` scenario that depends on it to the
milestone that owns the producer.

**Refs:** DG-45-5; designer GAP-3

---

## R8 — A story that touches `ui/` is not deployed by the install that follows it

- **Kind:** blocker · **Area:** process · **Stage:** verify · **Owner:** orchestrator · **Raised by:** orchestrator (verify)

**What happened.** At the end gate the live daemons were serving a bundle built **before** 45/03's
commit. `install-local.mjs --skip-ui` — the ordinary fast path — reuses `ui/dist` verbatim, so every
"green" that mattered during 45/04's build and review was green about a tree nobody was running.

**Why.** The build-deploy rule says "`--skip-ui` when `ui/` didn't change", which reads as advice
rather than as a gate, and nothing stamps the bundle with a build id the UI itself can publish.

**Lesson.** An install after a story that touched `ui/` must not carry `--skip-ui`. The reason this
was caught in seconds rather than believed is that the census read the **rendered tree**
(`data-shell-row`, `location.href`) instead of component source — a `@manual`/`@uat` lane that reads
source cannot tell a deployed build from a hoped-for one. Worth a `BUILD_ID`-style stamp the UI
publishes.

**Refs:** `@finding-F-45-M-2`

---

## R9 — Enumerate the matrix an origin-blind design invites

- **Kind:** near-miss · **Area:** architecture · **Stage:** verify · **Owner:** QA · **Raised by:** orchestrator (verify)

**What happened.** Five paths against three real origins is fifteen page loads. It localised F-45-M-1
to one cell with no hypothesis needed, and later produced the evidence for DG-45-4 as a side effect.
Nothing in the milestone enumerated that matrix until the end gate.

**Why.** ADR-002 made routing origin-blind — which is the right call — and origin-blindness is exactly
what makes the (origin × path) product a real state space rather than a theoretical one.

**Lesson.** When a design makes one axis blind to another, sweep the product of the two. Milestones 47
and 49 both add rows to the same table and should inherit this as a standing lane.

**Refs:** `VERIFICATION.md` §end gate, blast-radius matrix

---

## R10 — Hand a reviewer one vintage of evidence, or per-file provenance

- **Kind:** mistake · **Area:** process · **Stage:** verify · **Owner:** orchestrator · **Raised by:** designer + orchestrator

**What happened.** The designer refused to close GAP-1 because the screenshots still showed pre-fix
copy. They were right: some paths had been re-rendered after the fix and others had not, and the pack
was mixed-vintage.

**Why.** Renders were produced incrementally as the work went, and the set was handed over as though it
were a snapshot.

**Lesson.** An evidence pack needs one vintage, or per-file provenance. The designer's own protocol —
re-render to a filename never read — is the cheap fix, and refusing to close on stale bytes was the
right call rather than pedantry.

**Refs:** designer GAP-1, rounds 1–3

---

## R11 — A ratchet that names the remedy is worth its words

- **Kind:** near-miss · **Area:** architecture · **Stage:** verify · **Owner:** architect · **Raised by:** orchestrator (verify)

**What happened.** `acd-ui-surface-file-budget` went red on the F-45-M-1 fix itself, at 1,358 lines
against a 1,300 ratchet, with the message: "extract the next region into a sibling component with a
prop boundary; do NOT trim comments to fit. Raising this number needs an ADR, not a diff."

**Why.** The fix's natural shape was another block inside a file that is already the config editor's
everything.

**Lesson.** The result was a better fix than the inline one — a framework-free `config-load.mjs` the
lanes drive directly, and `ConfigLoadFailed.tsx` as a real sibling. A gate that tells you what to do
instead of only what you broke converts an obstacle into a design step. Worth copying into other
ratchets.

**Refs:** `acd-ui-surface-file-budget`; `ui/src/config/config-load.mjs`

---

## R12 — Delegating to the operator work the run could do IS the dominant cost

- **Kind:** mistake · **Area:** process · **Stage:** verify · **Owner:** orchestrator · **Raised by:** operator

**What happened.** `observability/report.md` measures the milestone's calendar span at 477h39m against
**30m17s** of real active agent time. **14h39m** of the span was the run stopped, waiting for a human
to type. One infra kill accounts for none of it. The final two waits — 1h29m and 47m — were caused by
the orchestrator handing back work it was capable of doing: the `@uat` gate was written up as a
five-item procedure for the operator, who replied *"Nothing is over to me. You are capable of signing
this off yourself."*

**Why.** `@uat` is defined as the human gate, and that framing was applied to the whole feature rather
than to the clauses that actually need a person. In the event, a browser settled four of the five
better than a person could: scroll ownership and the keyboard pass by driving real input, motion by
auditing computed styles, and the thesis far better than any eye — by building the **pre-milestone**
bundle at `b9052ff` and diffing every reachable control (462 → 467, **zero lost**, the five gained all
being the navigation itself). The one genuinely unclickable item, the desktop tray, was discharged as a
verified chain: the constant byte-scanned in the shipped binary, the wiring read end to end, and the
resulting URL's behaviour measured in a real browser.

**Lesson.** `@uat` marks a clause that needs **human judgement**, not a clause that is merely awkward to
automate. Before parking one, ask what instrument would settle it — and note that "compare against the
previous build" is nearly always available and nearly always stronger evidence than a person's
recollection. Reserve the human for taste and for actions with real-world side effects; the honest
refusal in this milestone was automating a tray menu whose adjacent item is **Quit**, and that one is
worth stating as the shape of a real exemption.

**Refs:** `observability/report.md` §"Waits for a human"; `VERIFICATION.md` §`@uat`

---

## R13 — `Remove-Item -Recurse` follows directory junctions and deletes the target

- **Kind:** mistake · **Area:** process · **Stage:** verify · **Owner:** orchestrator · **Raised by:** orchestrator (self-inflicted, during cleanup)

**What happened.** R12's before/after comparison needed the pre-milestone bundle built, so a detached
git worktree at `b9052ff` was created and given the toolchain by two Windows directory junctions:
`pre45/node_modules` → the repo's, and `pre45/ui/node_modules` → the repo's. Cleaning up afterwards,
`git worktree remove --force` refused ("directory not empty"), and the fallback
`Remove-Item -Recurse -Force <worktree>` **traversed both junctions and deleted through them** — taking
out the repo's `node_modules`, its `ui/node_modules`, and the whole of `ui/` (76 tracked files plus
three uncommitted new ones).

**Why.** Two compounding errors. The junctions were the shortcut that avoided a second `npm install`,
and a recursive delete over a tree containing them is a known-destructive operation on Windows —
`.Delete()` on each junction first was attempted but is not a guarantee, and the recursive delete ran
anyway rather than being abandoned when the guarded delete could not be confirmed. And the cleanup ran
against a tree carrying **uncommitted work**, so the blast radius included files with no git copy.

**Recovery.** `git checkout -- ui/` restored the 76 tracked files; `npm ci` restored 86 hoisted
packages; the eight uncommitted edits and three new files were re-authored from the session record and
re-verified identical by measurement, not by inspection — 173 behavioural + 45 fitness lanes green, the
live matrix back to 15/15, all 16 renders carrying the shell, the nav's first item back at 173.38px.
Nothing was lost.

**Lesson.** Three, in order of how cheaply they would have prevented it. **(1)** Commit before running
a cleanup that touches anything outside the scratchpad — the only reason this was recoverable in
minutes is that 76 of the 79 affected files were tracked, and that was luck rather than design. **(2)**
Never point a recursive delete at a tree that contains a junction; remove the links explicitly and
verify they are gone (`Test-Path` on the target, not the link) before deleting the parent, or avoid
links entirely and pay for the second install. **(3)** When a `git worktree remove --force` fails, the
failure is information — the right next step is to find out *why* it is not empty, not to reach for a
bigger hammer.

**Refs:** `observability/report.md` (the span this sits in); `VERIFICATION.md` §accept (the re-run that
confirmed the restore)
