---
doc: retrospective
---
<!--
  RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson; APPEND, never renumber. References findings/ADRs, never restates them.
-->
# 43 · Mesh artifact authority — Retrospective

Seventeen lessons, from a milestone that ran refine → six stories → a verification session that found
and fixed a blocker at the gate. The dominant theme is not "we wrote bugs": it is **that a green suite
and a true system are different claims**, and this milestone paid for that distinction five times in
one class alone (R1).

---

## R1 — In a system with a repair path, a test of the fast path is a test of the repair path

- **Kind:** mistake · **Area:** contract · **Stage:** build · **Owner:** qa + developer
- **Raised by:** qa, developer, architect (five separate instances)

**What happened.** Five times, scenarios were green and proved nothing. 43/03: five drain scenarios —
including the story's headline — produced byte-identical observables whether the queue held the right
names, the wrong names, nothing, or did not exist; a plant that disabled the drain entirely left four
green. 43/04: the bounded watch poll could be **deleted outright** and three lanes stayed green,
including the very scenario it exists to protect.

**Why.** Each system had a second path to the same observable — a reconciliation backstop, a periodic
tick, or (the sharpest case) **the user's own manual `⟳ sync` affordance**, which nobody thinks of as a
repair mechanism while writing a test.

**Lesson.** Before choosing an assertion, **enumerate every path that can produce the observable,
including the ones a human triggers.** Then assert on something only the fast path can produce — a
named-but-now-missing artifact, an `unresolved-path` line, the consumed batch's own bytes. If no such
observable exists, the scenario cannot distinguish the mechanism from its backstop and should say so.

**Refs:** VERIFICATION `@finding-C8`, 43/03 and 43/04 feedback notes; ADR-013.

---

## R2 — When an AC's subject is a DECLARATION, only a declaration-asserting proof will do

- **Kind:** mistake · **Area:** contract · **Stage:** build · **Owner:** architect

**What happened.** 43/03's central trigger **was never delivered** and every test still passed. A fresh
`aof work init` installed the enqueue script and **no hook entry** — the matcher string existed nowhere
in `src/` or `.aof/`, only in a constant the tests built themselves. Four task features, 32 green
scenarios, three armed fitness functions, and the mechanism was unreachable from the product.

**Why.** AC1 was a claim about the **shipped configuration**; every proof was a claim about behaviour
*given* that configuration. Behaviour tests can only ever assume the declaration.

**Lesson.** When an AC's subject is a declaration — a bundle member, a config key, a registered route —
the fitness function must **assert the declaration exists in the shipped artefact**.

**Refs:** VERIFICATION `@finding-C1`.

---

## R3 — A ratchet over a NAME is a ratchet over a convention; key it on the DATA

- **Kind:** mistake · **Area:** architecture · **Stage:** build · **Owner:** architect

**What happened.** The same mistake twice, then a third variant. ADR-014/E4 detected wire provenance
keys **by name**; ADR-006 counted files mentioning `stalenessSeconds`. Measured, not hypothesised:
`const stale = now - Date.parse(row.syncedAt) > windowSeconds * 1000` passes every clause — and
`windowSeconds` is what every consumer already calls it, so **the evasion is the natural spelling**.
Then the MOVE half: `acd-cache-read-surface-boundary` pinned a symbol that had **relocated** in 43/03,
so it went green on a different `listItems` in the publish path for three stories.

**Why.** A detector keyed on an identifier's spelling tests the vocabulary the current implementation
happens to use, not the guarantee.

**Lesson.** If the invariant is "one place decides X", the detector must key on **the data the decision
consumes**, and a positive pin must name its **subject** and fail when that subject leaves the module.

**Refs:** ADR-015/F1, ADR-016/G2; VERIFICATION `@finding-F-06.2`.

---

## R4 — "This hazard is retired" is a claim that needs a mechanism and a test, not a design argument

- **Kind:** mistake · **Area:** contract · **Stage:** build · **Owner:** architect + qa

**What happened.** 43/02's AC5 claimed `applyDeltaFrame`'s whole-transaction rollback had died "because
there is no longer a whole-workspace transaction" — but the new seam still opened one `BEGIN IMMEDIATE`
per batch, and its completeness screen checked four of the eight columns it binds. A `title: [alpha,
beta]` in one record doc's frontmatter — **ordinary operator input** — froze the entire workspace's
cache on every tick.

**Why.** The AC asserted a property of the *design*, which the build never had to satisfy. The Examples
table meant to catch it enumerated eight shapes of the **same** failure class (missing/empty strings),
so it could not reach a present-but-non-bindable value.

**Lesson.** An AC claiming a hazard is retired must **name the mechanism that retires it and the test
that proves it gone**. And **class-diversity in an Examples table is worth more than row count**.

**Refs:** ADR-012; VERIFICATION 43/02 findings.

---

## R5 — When a story removes a self-healing mechanism, ask what it was silently repairing

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** qa

**What happened.** 43/02 removed the wholesale rebuild. That fixed the authority model — and introduced
a regression **no AC covered**: a control-side renumber now leaves a worker-authored row parked at the
old ref forever, so an operator's newly-inserted story never reaches the cache and the ref renders a
*different* item's slug, title and status. The old disease self-healed this case by rebuilding
everything.

**Why.** A wholesale rebuild was both a bad authority model **and** a free reconciler. Only the first
half was in scope.

**Lesson.** The retro question is not "is the new rule correct" but **"what was the old mechanism
silently repairing?"** Found only because QA drove a real `insert-story` instead of reasoning about the
predicate.

**Refs:** VERIFICATION 43/02 findings.

---

## R6 — An Examples table is a claim that N cases differ; nothing checks that they do

- **Kind:** mistake · **Area:** contract · **Stage:** refine · **Owner:** qa + product-owner

**What happened.** Four Examples defects in one story (43/04), all the same root: a table varying a
value the `Then` never binds. An unsatisfiable third row; three rows sharing one identical fabric with
the distinguishing column dropped; two rows looping one fixture under two labels; and cells spelling
out a formatter's output the formatter cannot produce (`4 seconds` → `synced 4s ago`, when
`relativeTime` renders anything under five seconds as `just now`).

**Lesson.** A cheap refine-time gate would catch most of it: **every column named in an Examples header
must appear in at least one `Given`/`When`/`Then` placeholder.** And when a scenario delegates its
vocabulary to an existing formatter, **its cells become claims about that formatter's thresholds** —
refine has no gate that checks them.

**Refs:** VERIFICATION 43/04 findings.

---

## R7 — "At narrow viewports" and "in a narrow container" diverge exactly where a grid reflows

- **Kind:** misunderstanding · **Area:** contract · **Stage:** refine · **Owner:** designer

**What happened.** DESIGN specified a responsive yield ladder keyed to the **viewport** for a card whose
width is viewport-**invariant**. Three parties took it as a build gap before anyone checked the premise:
the developer reported it unimplemented, QA raised it as a must-fix with three clauses resting on it,
and the PO briefed the designer for the missing numbers. The designer **withdrew its own requirement**
and supplied the arithmetic: the fleet grid is `repeat(auto-fill, minmax(320px, 1fr))`, so it adds
COLUMNS rather than width — the card sits in a ~300–370px band at every breakpoint and is **narrower at
2560 than at 1280**. The specified ladder would have painted `full` at 2560 and `minimal` at 390 in
cards of the same size.

**Lesson.** **Check the container, not the viewport** — most responsive specs are written in viewport
language out of habit, and for any auto-fill/auto-fit grid that language is simply wrong. Second half,
equally durable: **check that a borrowed instrument's preconditions hold before borrowing it** — m38's
derived character budgets are honest only over `mono`, where `ch` is the exact advance; the badge is
fixed strings in proportional Inter, so a `ch` budget would have been false precision dressed as rigour.

**Refs:** VERIFICATION 43/04 design review.

---

## R8 — A design-conformance pass can find that the SPEC does not match itself

- **Kind:** near-miss · **Area:** contract · **Stage:** build · **Owner:** designer

**What happened.** The design review's most valuable output was two defects **in `DESIGN.md` itself**,
neither reachable from any test: a self-contradiction ("the badge and the provenance label never both
appear for the same record" flatly contradicted the same document's §1c and a11y rule 10, which
*require* the panel to carry both), and a **whole missing rule** — the detail panel header, the narrowest
row carrying the widest badge form, had no yield rule at all.

**Lesson.** This inverts the usual framing. A design review is normally "does the build match the spec";
here the highest-value finding was **"the spec does not match itself"** — which no implementation care
would surface, and **which a mock would have hidden rather than exposed** (a mock shows one width of one
state and would have looked fine).

**Refs:** VERIFICATION 43/04 design review.

---

## R9 — A record doc's citations decay; cite what survives an edit

- **Kind:** mistake · **Area:** process · **Stage:** refine · **Owner:** architect

**What happened.** Three citation decays, each costing a verification pass: a line-number citation that
had moved; a count ("25 disk-read call sites across 18 modules") that a reproducible grep measured as
33 across 21; and two commit hashes that **resolve on no machine in this checkout** (they were made on
the Mac worker, on another branch) — reading as authoritative but unverifiable where the refine actually
runs.

**Lesson.** Cite **module + function name** — stable across edits, greppable on any machine — and
reserve line numbers for a same-session quote. **A count asserted in prose must carry the command that
produced it, or it silently becomes folklore.** RESEARCH.md did exactly the right thing by re-measuring
and flagging the deltas rather than inheriting them.

**Refs:** STATE feedback (architect).

---

## R10 — `node_modules` is a path INTO the source tree, and `--force` follows it

- **Kind:** blocker · **Area:** process · **Stage:** build · **Owner:** product-owner

**What happened.** `ui/` was destroyed mid-milestone and story 04's uncommitted UI half was lost. To
measure a regression against a baseline commit, a detached `git worktree` was given a Windows
**directory junction** to the repo's real `node_modules`. `git worktree remove --force` recursed THROUGH
the junction into the real `node_modules`, and from there through npm's workspace **symlink**
`node_modules/@aof/ui → ../../ui` into the source tree. **Two link hops, one `--force`, 56 files gone.**

**Lesson.** Three, in descending order of value. (1) **Never link `node_modules` into a git worktree** —
`npm ci` is slower and correct. (2) **In an npm-workspaces repo, `node_modules` contains paths back into
your source**, which is not how anyone pictures it; `rm -rf node_modules` is normally the safest command
in the toolbox and there it is not. (3) The recoverable-vs-lost split was decided entirely by **what had
been committed** — 49 of 56 files returned byte-perfect from `573c18c`; story 04's seven reviewed,
green, uncommitted files did not. **Commit at each story's green gate, not its accept gate.**

**Refs:** STATE feedback (product-owner); commit `573c18c`.

---

## R11 — A tiebreaker clause must name the actors it arbitrates between

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer + architect

**What happened.** ADR-004's "outside a lock, last-write-wins by `syncedAt`" cannot hold BETWEEN nodes —
it hands authority to clock skew, and would let a worker with a trailing clock have its own frames
rejected. Narrowed at build time to same-author-only, with arrival order deciding between two workers.

**Lesson.** "Last-write-wins by timestamp" is **safe within one author and unsafe across two, and the
sentence reads identically in both cases.** An ADR clause naming a tiebreaker should state WHICH ACTORS
it arbitrates between.

**Refs:** ADR-011/A1, ADR-012.

---

## R12 — A version stamp read at heartbeat time is not evidence of what is RUNNING

- **Kind:** near-miss · **Area:** process · **Stage:** verify · **Owner:** product-owner

**What happened.** At the verification gate, `aof mesh status` reported the control node's presence
`buildId` as the **new payload roughly 90 minutes before either daemon had restarted onto it**. Presence
re-reads `BUILD_ID.json` at every heartbeat, so it reflects what is **installed**, never what is
**loaded**.

**Why.** The deploy rules say to verify with `aof --version` and the daemons' `Build:` line. The first of
those is not evidence, and it is the more convenient one to reach for.

**Lesson.** **Only the `daemon-started` log line proves a restart.** More generally: a stamp computed at
read time answers "what is on disk", and any check gated on "the running process has the new code" must
read something the process emitted **when it started**. This nearly made every lane in the session
vacuous — the entire milestone would have been "verified" against a two-day-old module graph.

**Refs:** VERIFICATION 43/06 `@manual` lane; TECH_DEBT 20.

---

## R13 — A "never discards" invariant must guard the QUESTION, not just the forbidden verbs

- **Kind:** blocker · **Area:** architecture · **Stage:** verify · **Owner:** architect

**What happened.** `acd-gate-propagation-never-discards` forbids rebase / force / reset on the
branch-advance path, and it was green. The two-node soak then discarded a whole phase's commits
**without using any of them**: the reuse-door predicate asked only `refs/heads/<branch>`, so a worker
holding the item's line at `refs/remotes/origin/<branch>` was judged to have no line at all, took the
create door, and based the item on the pinned base — orphaning every commit the previous phase made.

**Why.** The invariant guarded the **verbs that destroy history** and not the **question whose wrong
answer makes history irrelevant**. The history was discarded by *not looking for it*.

**Lesson.** When an invariant is "X is never lost", enumerate the ways X can *stop being reachable*, not
only the operations that delete it. This is R3's shape one level up: the detector was correct about
what it watched and watched the wrong thing. Fixed at the gate, invariant extended to the create door,
and **mutation-tested** — reverting the fix reds exactly the new proof.

**Refs:** VERIFICATION `@finding-F-05.3`; commit `5184f0c`.

---

## R14 — A soak against a quiet adversary proves nothing; prove the adversary was awake

- **Kind:** near-miss · **Area:** process · **Stage:** verify · **Owner:** product-owner

**What happened.** 43/06's permanence scenario asks that a worker-authored answer not revert "while the
control node's republish tick keeps running". The naive form — read, wait, read again, observe no change
— would have passed **even if the tick had been dead**, which is precisely the condition that makes the
answer stable.

**Lesson.** The check was made falsifiable by measuring a **control-authored** population moving during
the same window (stamped 4s before sampling) while the worker-authored rows stood still for two days.
**When a scenario says "while X runs on", the evidence must include that X ran.** This is R1's class
arriving at verify stage rather than build stage — and it is the reason the milestone's headline claim
is now backed by a measurement rather than by an absence.

**Refs:** VERIFICATION 43/06 `@manual` lane.

---

## R15 — The environment blocked verification harder than the code did, and had been failing for days

- **Kind:** blocker · **Area:** process · **Stage:** verify · **Owner:** product-owner

**What happened.** Reaching a two-node lane at all required working around **three** independent mesh
defects: a fleet-global clone-credential provider that cannot serve a non-GitHub repo (TECH_DEBT 14,
worked around by a temporary, byte-restored config flip); a worker that fails an assignment outright
rather than fetching when its managed checkout already exists (TECH_DEBT 21); and a desktop supervisor
with no programmatic stop at all (TECH_DEBT 20). The second turned out to mean **a workspace is
dispatchable exactly ONCE per worker checkout** — and the 2026-08-03 history shows the same shape (three
of five assignments failing identically), so it had been true for days and was read as unrelated noise.

**Lesson.** Two. (1) **Repeated failures with one error code are a pattern until proven otherwise** —
the earlier session recorded three failed dispatches as incidental; one grep across the assignment table
would have shown the shape. (2) A milestone that can only be verified on real hardware should treat
**"can we dispatch twice?"** as a precondition to check on day one, not something to discover at the
gate. The verification lanes were sound; the road to them was not.

**Refs:** TECH_DEBT 14, 20, 21; VERIFICATION `@finding-F-05.4`.

---

## R16 — A fixture defined in relative time ages out of its own precondition

- **Kind:** near-miss · **Area:** process · **Stage:** verify · **Owner:** product-owner

**What happened.** The design-review fixture seeded a **fresh** row at `now − 10s` and a **stale** one at
`now − 12m` against a 300s window. Judged ten hours later, *everything* was stale: the fresh/stale
contrast several scenarios depend on — "the status chip sits at exactly the same right edge as on the
fresh item rendered beside it" — had silently evaporated, and the renders looked plausible while proving
less than they claimed.

**Lesson.** A fixture whose states are defined **relative to now** has a shelf life. Either re-seed
immediately before judging, or pin the clock. The failure is quiet: nothing errors, the surface still
renders, and only a reader who checks the ages notices that the comparison case is gone.

**Refs:** VERIFICATION 43/04 `@uat`.

---

## R17 — Spend the human on judgement, never on interaction the harness can drive

- **Kind:** mistake · **Area:** process · **Stage:** verify · **Owner:** product-owner
- **Raised by:** the operator

**What happened.** The `owner unreachable` Resync state is reached by a click, so it was handed to the
operator to perform — twice, in a prepared "here are the URLs, click Resync" package. The operator's
reply was a question: *"You cannot test the ui with playwright cli?"* The cached Chromium was already
being driven over CDP for width measurements **in the same session**; clicking was one more call, and
the state was captured and judged within minutes of being asked.

**Why.** `npx playwright` is policy-blocked in this repo, and that prohibition was over-generalised into
"UI interaction needs a human". The `@uat` tag was then used as cover: the scenario does need a human —
for the **verdict on tone**, not for the **click that produces the state**.

**Lesson.** Before asking for human time, ask what part is genuinely human. **A `@uat` is a request for
judgement, not for labour**: produce the state, hand over the render, ask only for the verdict. An
operator asked to do mechanical work will (rightly) ask why the machine is not doing it. Related and
worth stating: an `AskUserQuestion` option labelled *"You restart it too"* was read by the operator as an
instruction to the assistant — **option labels must name the actor unambiguously**, because a
mis-parsed option costs a whole round trip.

**Refs:** VERIFICATION 43/04 `@uat`; TECH_DEBT 20.
