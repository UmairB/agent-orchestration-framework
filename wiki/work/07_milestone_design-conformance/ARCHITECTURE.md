---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 07 · Design-Conformance Verification — Architecture Decisions

These ADRs build on the Decide inputs and do not re-litigate them: `SPEC.md` (scope: committed-mock
convention; structured conformance verdict; role split made real; optional QA-owned a11y lane;
bundle-drift fix — and the out-of-scope list: no pixel-exact regression suite as a hard gate, ACD never
boots the app, no design-system authoring, no perf lane, no m03 backfill) and `STATE.md` (the in-session
decisions confirmed here: designer "looks right" / QA "works right"; designer judges a screenshot,
stays read-only; QA runs the harness + owns the `toHaveScreenshot` regression; `INCONCLUSIVE`-without-
baseline; a11y is a QA, opt-in lane; the ecc `browser-qa` reference distilled into the verdict shape +
INCONCLUSIVE rule).

**Memory recall.** Ran `aof work memory recall "…" --area architecture --block` per the refine process;
the backend is `none` in this repo, so the block is empty — nothing prior to surface, proceed unchanged.

The seam this milestone freezes — the **responsibility-split contract** (ADR-001): designer = read-only
fidelity judge of a *provided* screenshot (no `Bash`); QA = runs the Playwright browser harness (has
`Bash`) and owns the `toHaveScreenshot` regression; the **orchestration** (`verify`/`continue`) renders
the screenshot and hands it to the designer — is the m03-ADR-002 analogue. It is the frozen seam that
lets the stories build in parallel, and it is enforceable because the tool boundary is structural (the
designer's `tools:` list literally cannot run a browser).

## ADR-001: The responsibility-split contract — designer JUDGES a provided screenshot (read-only, no Bash); QA RUNS the browser harness and owns the regression; the ORCHESTRATION renders and hands off

**Status:** Accepted
**Date:** 2026-06-21

**Context.** The diagnosis (SPEC Objective, STATE Origin) is that the design-conformance loop has no
real seam: the designer is asked to "compare the built surface to the mock" but has neither a
machine-readable mock nor a rendered screenshot, so it infers from code or guesses. The tools already
encode the answer. The designer agent is `tools: Read, Grep, Glob, Write, WebSearch, WebFetch` — it has
**no `Bash`**, so it is *structurally* read-only and cannot invoke a browser. QA is
`tools: Read, Grep, Glob, Bash, Write` — it **has `Bash`**, so it can run Playwright. ecc's `browser-qa`
skill bundles "looks right" + "works right" into one capability; ACD already has the contract seam to
unbundle them along — fidelity-judgement vs harness-execution — and that seam happens to be the exact
tool boundary above. ACD never boots the app (SPEC out-of-scope): the project serves it and ACD points
at `work.ui.baseUrl` / `--url`; rendering is Playwright invoked by the *orchestration*, not by either
agent's own loop. This is the m03-ADR-002 move: freeze the hand-off contract so the stories build in
parallel against it.

**Decision.** Fix the three-party design-conformance contract:
- **Designer = read-only fidelity judge of a *provided* screenshot.** The designer's job is "looks
  right": given a rendered screenshot it is *handed*, it compares that screenshot to the conformance
  baseline (committed mock and/or binding checklist — ADR-003) region-by-region and returns the
  structured verdict (ADR-002). It **stays `Bash`-free** (it never runs the browser); its tool list is
  `Read, Grep, Glob, Write, WebSearch, WebFetch` and MUST NOT gain `Bash`. When no screenshot is
  available it does not fall back to guessing — it returns `INCONCLUSIVE` and names the missing render as
  the gap (ADR-002).
- **QA = runs the browser harness + owns the regression.** QA's job is "works right" + running the
  machinery: it has `Bash`, runs the Playwright harness (the render command, breakpoints — ADR-002),
  owns the **`toHaveScreenshot` visual-regression** that locks the designer-approved baseline, the
  optional **a11y lane** (ADR-004), and the functional/behavioural checks it already owns. The
  `toHaveScreenshot` regression and any browser/Playwright invocation are **QA-owned**, never the
  designer's.
- **Orchestration = renders and hands off.** The `verify` / `continue` commands (which carry `Bash`)
  perform the actual render — `npx playwright screenshot "<baseUrl><Route>" <out>.png` at the documented
  breakpoints — then spawn the designer with the screenshot path(s) + the baseline to judge, and spawn QA
  for the harness/regression/a11y. The orchestration is the only party that bridges "run the browser"
  to "judge the result"; neither agent reaches across its own tool boundary.

This split is the **frozen seam** for the breakdown (ADR-005): the designer story, the QA story, and the
review-wiring story each bind to this contract (judge-from-screenshot ↔ run-harness ↔ render-and-hand-off)
without depending on each other's internals.

**Alternatives considered.**
- *Give the designer `Bash` so it renders its own screenshot* — rejected: it collapses the seam (the
  designer becomes both runner and judge, the ecc `browser-qa` bundling ACD is deliberately unbundling),
  removes the structural read-only guarantee, and makes the "designer judges, QA runs" split
  unenforceable. The tool boundary IS the contract.
- *Make QA the fidelity judge too (one agent owns the whole loop)* — rejected: "looks right" is design
  judgement (the designer owns the DESIGN.md rules and the correct answer for design-gaps); folding it
  into QA loses the role specialisation and the design-gap → DESIGN-rule resolution path.
- *Have ACD boot the app to render it* — rejected: out of scope (SPEC); ACD points at a URL the project
  already serves. The render is against `work.ui.baseUrl`/`--url`, never a server ACD stands up.
- *Leave rendering inside the designer's loop conceptually (the current `.claude/verify.md` wording)* —
  rejected: the designer has no `Bash`, so "the designer renders it" was never executable; the render
  must live in the orchestration. This ADR makes the prose match the tool reality.

**Consequences.** The split is checkable by source-grep of the BUNDLED assets (not just `.claude/`):
the designer agent's `tools:` contains no `Bash`; `toHaveScreenshot` / Playwright-run ownership appears
in QA's contract, not the designer's; the orchestration commands carry the render→hand-off step. The
three stories build in parallel against this frozen contract. Whether a real Playwright render actually
paints, and the *quality* of the designer's judgement, are `@manual`/`@uat` (see "NOT fitness functions"),
not CI invariants.

**Invariant.** The design-conformance loop is split across exactly three parties with a structural tool
boundary: the **designer** judges a *provided* screenshot and carries NO `Bash` (tools stay
`Read, Grep, Glob, Write, WebSearch, WebFetch`); **QA** owns every browser/Playwright invocation and the
`toHaveScreenshot` regression (and has `Bash`); the **orchestration** (`verify`/`continue`) renders the
screenshot and hands it to the designer. No browser run or `toHaveScreenshot` ownership appears in the
designer's contract. (Enforced by `acd-design-role-split`.)

## ADR-002: The conformance review is a render + a STRUCTURED, evidence-backed, region-by-region verdict — CONFORMS / GAPS(list) / INCONCLUSIVE — and is INCONCLUSIVE (never a guess) when there is no baseline

**Status:** Accepted
**Date:** 2026-06-21

**Context.** SPEC requires the review to "render the built surface and return a structured,
evidence-backed verdict — or `INCONCLUSIVE` when there is no baseline — instead of a vibe-check", and
names the borrowed principle: ecc's `browser-qa` independently arrived at refusing-and-flagging when it
has nothing to judge against. The render target is fixed by the existing config: `work.ui.baseUrl`
already exists in the schema (closed `work.ui`), overridable per run with `aof:verify --url`; each
DESIGN surface carries a `Route` that is appended. The current `.claude/` loop renders at no defined
breakpoints and returns prose; this ADR fixes the render contract and the verdict shape so the output
is checkable and the no-baseline case is honest rather than invented.

**Decision.** Pin the render contract and the verdict shape:
- **Render via orchestration** (ADR-001) against the **design-review base URL** = `--url` if given, else
  `work.ui.baseUrl` (may be absent), with each DESIGN surface's **`Route`** appended, at **defined
  breakpoints** — the documented default is **390 / 768 / 1280** (mobile / tablet / desktop; a
  per-milestone DESIGN may override). Playwright is invoked **on-demand via `npx`** (`npx playwright
  screenshot …`); it is **NOT** added to `package.json` (it stays opt-in/on-demand — browser
  availability is a build-time `@manual` confirmation, not a refine blocker, and not a hard dependency).
- **The verdict is one of exactly three terminal values:** **`CONFORMS`** (the surface matches the
  baseline), **`GAPS`** (a concrete list of region-by-region divergences — each a design-gap finding with
  the region, the expected-vs-observed, and a concrete fix, not "looks fine"), or **`INCONCLUSIVE`**.
  The verdict is **evidence-backed** (it cites the screenshot + the baseline region) and **region-by-
  region** per the DESIGN binding checklist (ADR-003).
- **`INCONCLUSIVE` is mandatory when there is no baseline.** "No baseline" =
  (no committed mock AND no binding checklist) OR no render available (no base URL / no screenshot / no
  breakpoint render). In that case the review **refuses and names the missing baseline as the gap** — it
  does **NOT** infer from component code and call it a verdict, and does **NOT** guess. (The old
  "otherwise read the component code and infer (weaker)" fallback is demoted: inferring-from-code is no
  longer a CONFORMS/GAPS verdict — absent a render or a baseline the honest answer is INCONCLUSIVE +
  "produce the missing baseline".) This is the ADR-004-of-m03 "honest degrade, never a dishonest
  success" discipline applied to design review.

**Alternatives considered.**
- *Keep the prose "looks fine / here are some notes" verdict* — rejected: it is the vibe-check the SPEC
  exists to kill; a structured CONFORMS/GAPS/INCONCLUSIVE with region-cited evidence is the contract.
- *Infer from component code when no render is available, and return CONFORMS/GAPS* — rejected: that is
  the "guess" the SPEC forbids; without a render you cannot judge what actually paints, so the honest
  verdict is INCONCLUSIVE naming the missing render. (Reading code may *inform* a checklist gap, but it
  is not a fidelity verdict.)
- *Bake Playwright into `package.json` so the render is always available* — rejected: SPEC keeps ACD from
  booting/owning the app stack; Playwright is heavyweight and not always wanted; `npx` on-demand + a
  build-time `@manual` browser-availability confirmation keeps it opt-in. Absence of a render ⇒
  INCONCLUSIVE, which is a feature, not a failure.
- *Leave breakpoints to the implementer* — rejected: undefined breakpoints are why the current loop is
  unreproducible; a documented default (390/768/1280, DESIGN-overridable) makes the render deterministic.

**Consequences.** The verdict is a fixed three-value vocabulary the wiring can branch on, and the
no-baseline path is honest. The render target reuses the existing `work.ui.baseUrl` / `--url` config
(no schema change for render). Playwright stays out of `package.json` (checkable). That a *real*
Playwright render paints correctly, and the *judgement quality* of CONFORMS-vs-GAPS, are `@manual`/`@uat`
(NOT fitness functions). The structural residue — the three-value verdict + INCONCLUSIVE-without-baseline
+ on-demand-`npx` (no Playwright dep) — is checkable in the bundled contract text and `package.json`.

**Invariant.** The conformance review returns exactly one of `CONFORMS` / `GAPS(list)` / `INCONCLUSIVE`;
it returns `INCONCLUSIVE` (and names the missing baseline) whenever there is no committed mock AND no
binding checklist, or no render is available — it never guesses from code in place of a render; Playwright
is invoked on-demand via `npx` and is NOT a dependency in `package.json`. (Enforced by
`acd-conformance-verdict-contract` for the verdict/INCONCLUSIVE text in the bundled assets and the
no-Playwright-dependency assertion.)

## ADR-003: A mock, when one exists, is a COMMITTED artifact under the milestone's `mocks/` dir referenced from DESIGN.md as the source of truth; with no mock, the DESIGN binding checklist is MANDATORY and is the source of truth (going-forward only)

**Status:** Accepted
**Date:** 2026-06-21

**Context.** The root cause (STATE Origin) is concrete: m03's mock is a *remote* `claude.ai/design`
artifact (`Work Board.dc.html`, project `a1e976a1…`) that the read-only designer literally cannot open,
and `work.ui.baseUrl` was unset — so the review fell back to inferring from code. The fix has two halves
(SPEC scope): when a mock exists it must be a **committed, local, readable** artifact the read-only
designer can `Read`; when no mock exists, the **binding checklist** (which m03's DESIGN.md already
demonstrates as the durable spec — layout regions in order, components, states, ramps) must be mandatory
so "match the mock" is replaced by something *checkable*. The DESIGN *template* must encode both so new
milestones inherit the convention. m03 is NOT backfilled (SPEC out-of-scope).

**Decision.** Fix the conformance source-of-truth:
- **A committed mock lives under the milestone's `mocks/` directory** (e.g.
  `wiki/work/NN_milestone_<slug>/mocks/<surface>.png`), a committed artifact, and is **referenced from
  `DESIGN.md`** as the conformance source of truth for that surface. It must be a format the read-only
  designer can `Read` (an image / local HTML), never a remote design-tool link as the *sole* reference.
  **Refine elicits mocks from the user** (the `refine`/designer flow asks; any that exist are committed).
- **No mock ⇒ the DESIGN binding checklist is MANDATORY and IS the source of truth.** The binding
  checklist enumerates, per surface: the layout regions (in order), the components each region holds, the
  states (empty / loading / error / populated), and which design ramp each uses — the same shape m03's
  DESIGN.md already carries. With a mock, the checklist still makes the mock *checkable* (the mock stays
  the visual source of truth; the checklist is the region-by-region rubric); without one, the checklist
  alone is the baseline.
- **The DESIGN template encodes both** — the `mocks/` convention (committed, referenced) and a mandatory
  binding-checklist section per surface — so every new UI milestone's DESIGN.md is born conformance-ready.
- **Going-forward only.** The convention applies to new milestones; m03's remote mock is **not**
  backfilled into a committed local file (SPEC out-of-scope) — that is optional, not required here.

A surface with **neither** a committed mock **nor** a binding checklist has no baseline, so its review is
`INCONCLUSIVE` (ADR-002) — which makes the missing baseline the named gap, closing the loop.

**Alternatives considered.**
- *Keep referencing the remote claude.ai/design mock* — rejected: it is the exact failure (the read-only
  designer cannot open it); the mock must be committed + locally readable.
- *Make the mock mandatory always* — rejected: many surfaces ship without a polished mock; forcing one
  blocks delivery. The binding checklist is the always-available baseline; the mock is the richer one
  when present.
- *Make the checklist optional* — rejected: an optional checklist + no mock = nothing to judge against =
  the vibe-check returns. The checklist is mandatory precisely so there is always a baseline (or an
  honest INCONCLUSIVE).
- *Backfill m03's mock as part of this milestone* — rejected: out of scope (SPEC); the convention is
  forward-looking, and m03 can adopt it later without gating this work.

**Consequences.** Every UI milestone going forward has a readable, committed baseline (a `mocks/`
artifact and/or a mandatory checklist), so the designer always has something concrete to `Read` and
judge — or the review is honestly INCONCLUSIVE. The DESIGN template change is the durable carrier. The
*content* of any given milestone's mock/checklist, and whether refine actually elicited a mock, are
authoring outcomes, not CI invariants — the structural residue is "the DESIGN template carries the
`mocks/` convention + a mandatory binding-checklist section".

**Invariant.** The bundled DESIGN milestone template encodes BOTH the committed-`mocks/`-dir convention
(a committed, locally-readable artifact referenced as the source of truth) AND a mandatory binding-
checklist section (regions-in-order / components / states / ramp) per surface; a surface with neither a
committed mock nor a checklist yields INCONCLUSIVE (ADR-002). (Enforced by `acd-design-template-baseline`;
the per-milestone mock/checklist content is an authoring outcome, not an arch-test.)

## ADR-004: The a11y lane is OPTIONAL, opt-in via `work.tags.domains` containing `a11y` (absent ≡ off), QA-owned (axe-core-via-Playwright default); the level lives in a new additive, CLOSED `work.ui.a11y` block

**Status:** Accepted
**Date:** 2026-06-21

**Context.** SPEC scopes an "optional a11y lane, owned by QA — opt-in via an `a11y` entry in
`work.tags.domains` (absent ≡ off); conformance level optionally recorded in `work.ui.a11y`. Absence is
the decision." The schema already has the extension shape: `work.tags.domains` is a free string array
(so `a11y` is a valid domain with no schema change), and `work.ui` is a closed object
(`additionalProperties:false`) currently holding only `baseUrl` — the precedent for adding an optional,
closed block is exactly how `work.headroom` and `memory` were added (a peer block, closed, absent ≡ off,
mirrored by a schema fitness function). a11y is QA's because QA owns the browser harness (ADR-001) and
axe-core runs in the browser via Playwright.

**Decision.** Pin the a11y lane as opt-in, additive, QA-owned:
- **Opt-in via `work.tags.domains` containing `a11y`** — its **absence is the decision** (a11y off, no
  pestering where it does not belong). No new opt-in mechanism; it reuses the existing free-string
  `domains` array (no schema change to enable the lane).
- **The conformance level is recorded in a NEW `work.ui.a11y` block** — additive, **closed**
  (`additionalProperties:false`), a **peer to `baseUrl`** under the already-closed `work.ui`, mirroring
  how `work.headroom` / `memory` were added. Shape: an optional `level` (the documented default vocabulary
  **WCAG 2.1 AA**, e.g. `enum: ["A","AA","AAA"]` with `AA` the default), kept minimal and closed.
  **Absent `work.ui.a11y` ≡ the default level when the lane is on, and irrelevant when the lane is off.**
- **The lane is QA-owned** (ADR-001): when on, QA runs the a11y check via **axe-core injected through
  Playwright** (the documented default tooling) as part of its harness, and logs violations as findings.
  The designer does not run it (no `Bash`).

**Alternatives considered.**
- *Always-on a11y* — rejected: SPEC says absence is the decision; forcing a11y onto milestones where it
  does not belong is noise. Opt-in via an existing domain tag is the cheapest correct switch.
- *A new top-level `a11y` config block / a new opt-in flag* — rejected: `work.tags.domains` already
  exists as the project's domain vocabulary; reusing it for the opt-in needs no schema change, and the
  *level* fits naturally as a closed peer under `work.ui` (the established pattern). Inventing a parallel
  mechanism duplicates config surface.
- *Open `work.ui.a11y` (additionalProperties:true)* — rejected: `work.ui` is deliberately closed; an
  open sub-block invites drift. Closed-and-additive matches headroom/memory precedent and keeps the
  config honest.
- *Give a11y to the designer* — rejected: a11y needs to run a browser tool (axe-core via Playwright); the
  designer has no `Bash` (ADR-001). It is QA's by the same tool boundary.

**Consequences.** a11y ships as a clean opt-in: a domain tag turns it on, a closed `work.ui.a11y.level`
records the bar (default AA), QA runs it via axe-core-through-Playwright. The schema stays closed and
additive (an absent block, and an unknown key under `work.ui.a11y`, both behave per the headroom/memory
precedent and are checkable by Ajv). Whether axe-core actually runs and what it finds is `@manual`/`@uat`
(it needs the browser + the running app), NOT a CI invariant — the structural residue is the additive,
closed schema block + the QA ownership in the bundled contract.

**Invariant.** `work.ui.a11y` is an OPTIONAL, CLOSED (`additionalProperties:false`) block peer to
`work.ui.baseUrl`; an absent block validates (absent ≡ default/off), and an unknown key under it fails
validation; the a11y lane is opt-in via `work.tags.domains` containing `a11y` (no schema change to
enable) and is QA-owned (the a11y run appears in QA's bundled contract, never the designer's). (Enforced
by `acd-a11y-config-schema` for the schema shape; the QA-ownership half is covered by
`acd-design-role-split` (ADR-001).)

## ADR-005: All design-conformance contract edits land in `src/bundle/` (`.claude/`/`.aof/` are regenerated, never hand-edited); the derived manifest is the only co-touched artifact; a NEW drift-guard asserts the contract markers live in the BUNDLED assets

**Status:** Accepted
**Date:** 2026-06-21

**Context.** The drift this milestone fixes (SPEC scope, key fact 3) is that the design-conformance loop
was **prototyped directly in `.claude/`** — the upgraded designer agent, the `verify`/`continue` render
steps, the DESIGN intent — while `src/bundle/` (the source of truth) still ships the STALE versions
(`src/bundle/agents/aof-designer.md` has no design-conformance review section; the bundled template is the
simple one). `src/bundle/` is the source of truth; `.claude/` + `.aof/` are install/regenerate targets.
The manifest (`src/bundle/manifest.json`) is **derived** — `scripts/generate-bundle-manifest.mjs`
regenerates it, and `acd-bundle-manifest-hashes` already (currently green) fails CI if the shipped
manifest drifts from the rendered bundle. Arch-tests are wired explicitly in `scripts/test.mjs` (each new
one is imported there). This is the discipline that makes the breakdown's independence real and keeps the
loop from regressing back into `.claude/`-only drift.

**Decision.** Pin the bundle source-of-truth discipline + drift guard + breakdown rationale:
- **All ACD contract edits land in `src/bundle/`.** The designer agent, QA agent, `refine`/`verify`/
  `continue` commands, the DESIGN template, and the schema change are edited in `src/bundle/`
  (and `schemas/`); `.claude/` and `.aof/` are **regenerated** (init/update), never hand-edited. The
  prototyped-in-`.claude/` content is *lifted into* `src/bundle/` and the install targets re-rendered.
- **The manifest is derived, not hand-maintained.** After any bundle body change, regenerate via
  `scripts/generate-bundle-manifest.mjs`; the existing `acd-bundle-manifest-hashes` guards
  manifest↔bundle consistency. No story hand-edits `manifest.json`.
- **A NEW drift-guard fitness function asserts the design-conformance contract markers are present in the
  BUNDLED assets** (`src/bundle/…`), not only in `.claude/`. It source-greps the bundled designer/QA
  agents + the bundled `verify`/`continue`/`refine` commands + the bundled DESIGN template for the
  contract markers (the role-split language, the render→judge hand-off, the CONFORMS/GAPS/INCONCLUSIVE
  verdict, the `mocks/` + binding-checklist convention) so the loop cannot ship lifted-into-`.claude/`-
  only again. (This is the marker-presence guard; the per-ADR structural assertions live in ADR-001..004's
  own fitness functions, which themselves read the bundled assets.)
- **Breakdown rationale (the stories are decoupled by ADR-001).** The three stories (ADR-006) each own a
  **disjoint set of `src/bundle/` files** and are decoupled by the frozen responsibility-split contract
  (ADR-001). The **only co-touched artifact is the DERIVED `manifest.json`**, regenerated by the script —
  a *mechanical* coupling, the m03-ADR-001 analogue of the shared `server` handle: every story that
  changes a bundle body reruns the generator, but no story hand-edits the manifest, so it imposes **no
  build order**. The integration point is "rerun `generate-bundle-manifest.mjs`", exercised by
  `acd-bundle-manifest-hashes`, not by making one story wait on another.

**Alternatives considered.**
- *Keep editing `.claude/` (the prototyping location)* — rejected: `.claude/`/`.aof/` are regenerate
  targets; edits there are overwritten on the next init/update and never reach new aof projects. Source of
  truth is `src/bundle/`.
- *Hand-maintain `manifest.json` per story* — rejected: it is derived; `acd-bundle-manifest-hashes` fails
  on a stale hand-edited manifest. Regenerate via the script.
- *No drift guard (trust that edits land in the bundle)* — rejected: the drift already happened once
  (prototyped in `.claude/`); a marker-presence fitness function on the BUNDLED assets is what makes
  "the contract lives in the bundle" enforceable rather than hoped-for.
- *Sequence the stories to avoid the manifest co-touch* — rejected: the co-touch is mechanical
  (regenerate a derived file), not a real dependency; sequencing for it would forfeit parallelism for no
  benefit. Contain it with the existing manifest-hashes guard, exactly as m03 contained the shared server.

**Consequences.** The design-conformance loop ships from `src/bundle/` to every new aof project (no more
`.claude/`-only drift), and the drift cannot silently recur (the marker guard trips CI). The manifest
stays derived (regenerate + existing guard). The breakdown is genuinely parallel: disjoint bundle-file
ownership + one mechanical co-touch (the derived manifest) contained by an existing fitness function.
Whether `init`/`update` actually re-render `.claude/`/`.aof/` from the bundle is existing, already-tested
machinery (the bundle render/manifest tests), not new work here.

**Invariant.** The design-conformance contract markers (role-split, render→judge hand-off,
CONFORMS/GAPS/INCONCLUSIVE verdict, committed-`mocks/`+binding-checklist convention) are present in the
BUNDLED assets under `src/bundle/` (the designer/QA agents, the `verify`/`continue`/`refine` commands, the
DESIGN template) — not only in `.claude/`; `manifest.json` is derived (regenerated by the script, guarded
by `acd-bundle-manifest-hashes`) and is the only artifact co-touched across stories, imposing no build
order. (Enforced by `acd-design-conformance-bundled` (NEW marker guard) + the existing
`acd-bundle-manifest-hashes`.)

## ADR-006: The breakdown is three independent stories, each owning a disjoint set of `src/bundle/` files, decoupled by the frozen responsibility-split contract (ADR-001); the derived `manifest.json` is the only co-touched artifact

**Status:** Accepted
**Date:** 2026-06-21

**Context.** The PO/architect partition the milestone so the stories are as independent as possible. The
SPEC's five scope items (committed-mock convention; structured verdict; role split made real; optional
a11y lane; bundle-drift fix) cut cleanly along the responsibility-split contract (ADR-001): the
fidelity-judge half (designer), the harness half (QA + a11y), and the wiring/convention half
(commands + DESIGN template + drift guard). The job here is to confirm the cut is genuinely independent
(or improve it), record WHY, and name the one residual coupling.

**Decision.** Three stories, decoupled by the **frozen responsibility-split contract (ADR-001)** and the
disjoint `src/bundle/` file ownership:

- **Story 01 — `designer-fidelity-judge` (the read-only judge contract).** Owns
  `src/bundle/agents/aof-designer.md`. Lifts + completes the designer into the read-only fidelity judge:
  judge-from-a-provided-screenshot (no `Bash`), region-by-region verdict vs the committed mock + binding
  checklist, CONFORMS/GAPS/INCONCLUSIVE with INCONCLUSIVE-when-no-baseline (ADR-001/002/003).
  **Independent because** it *implements its half of the frozen contract* (ADR-001) in one file; it binds
  to the render→hand-off seam, not to who renders.

- **Story 02 — `qa-browser-harness` (the harness + a11y lane).** Owns `src/bundle/agents/aof-qa.md` +
  the schema `work.ui.a11y` extension (`schemas/aof.schema.json`) + the a11y opt-in via
  `work.tags.domains`. QA runs the Playwright harness, owns the `toHaveScreenshot` regression + functional
  checks, and the optional axe-core-via-Playwright a11y lane (ADR-001/002/004). **Independent because** it
  owns the "runs the browser" half of the contract in its own agent file + an additive, closed schema
  block; it does not depend on the designer's or the wiring's internals.

- **Story 03 — `review-wiring-and-convention` (the orchestration + committed-mock convention + bundle
  discipline).** Owns `src/bundle/commands/refine.md`, `src/bundle/commands/verify.md`,
  `src/bundle/commands/continue.md`, `src/bundle/templates/milestone/DESIGN.md`, the NEW drift-guard
  fitness function (`test/arch/acd-design-conformance-bundled.test.mjs` + its wiring in
  `scripts/test.mjs`), and the bundle-discipline note. It wires mock-elicitation at refine and the
  render→designer-judge→QA-regression review steps with INCONCLUSIVE handling, encodes the committed-
  `mocks/` + mandatory-binding-checklist convention in the DESIGN template, and adds the drift guard
  (ADR-002/003/005). **Independent because** it owns the orchestration + template + guard files; it calls
  the designer and QA *through the frozen contract* (render → hand screenshot → spawn judge / spawn
  harness), so it depends on the contract shape, not on stories 01/02's authored bodies.

**The drift-guard / bundle-lift is folded into story 03, not split into a 4th story.** It is the same
concern as the wiring (lifting the prototyped-in-`.claude/` loop into `src/bundle/` and proving it landed
there): the wiring story is precisely the one that edits the commands + template that drifted, so it owns
the guard that asserts those bundled markers exist. A separate 4th story would own a fitness function with
no production file of its own and would have to reach into 01/02/03's bundled assets to assert markers —
inventing a cross-story dependency for a guard that naturally belongs with the wiring it guards. The
ADR-001..004 structural fitness functions are each authored alongside the story that owns the asset they
read (role-split with the designer/QA stories; verdict + template-baseline with the wiring story; a11y
schema with the QA story), so no test orphans.

**The residual coupling and how it is contained.** The one artifact all three stories co-touch is the
**derived `src/bundle/manifest.json`**: any change to a bundle body (the designer agent, the QA agent, the
commands, the DESIGN template) requires rerunning `scripts/generate-bundle-manifest.mjs`. ADR-005 contains
this exactly as m03-ADR-001 contained the shared `server` handle: the manifest is **derived, never
hand-edited**, each story reruns the generator over its own body change, and `acd-bundle-manifest-hashes`
(already green) guarantees consistency — so the co-touch is mechanical and imposes **no build order**.
(The schema change in story 02 touches `schemas/aof.schema.json`, which only story 02 edits — not a
co-touch.)

**Alternatives considered.**
- *Fold designer + QA into one "agents" story* — rejected: they are the two halves of the role split
  (ADR-001) and live in different files with different tool boundaries; keeping them separate is what
  makes the split's independence real and lets each agent's contract be reviewed against its own ADR.
- *Split the drift-guard / bundle-lift into a 4th story* — rejected (above): the guard belongs with the
  wiring it guards; a standalone guard story owns no production file and re-couples to 01/02/03's assets.
- *Put the schema `work.ui.a11y` change in the wiring story* — rejected: the schema block exists to record
  the a11y *level*, and a11y is QA-owned (ADR-004); the schema change belongs with the QA harness story
  that consumes it, keeping the a11y concern in one story.
- *Sequence the stories to avoid the manifest co-touch* — rejected: the co-touch is a derived-file
  regeneration, not a dependency; sequencing forfeits parallelism for no gain (ADR-005).

**Consequences.** The three stories build in parallel against the frozen responsibility-split contract
(ADR-001): 01 implements the judge half, 02 the harness/a11y half + the additive schema block, 03 the
orchestration + convention + drift guard. The only co-touched artifact is the derived `manifest.json`,
contained by `acd-bundle-manifest-hashes`. The independence rests on the frozen contract (ADR-001), which
is itself a fitness function (`acd-design-role-split`), so a regression that re-couples the stories (the
designer gaining `Bash`, the harness moving into the designer, the wiring bypassing the hand-off) trips CI.

**Invariant.** Story independence is carried by the frozen responsibility-split contract (ADR-001) and
disjoint `src/bundle/` file ownership (designer agent ↔ QA agent + schema ↔ commands + DESIGN template +
drift guard); no story depends on another's authored body, and the only co-touched artifact is the derived
`manifest.json` (regenerated by the script, guarded by `acd-bundle-manifest-hashes`), which imposes no
build order. (Enforced indirectly by `acd-design-role-split` + `acd-bundle-manifest-hashes`; the partition
itself is a planning decision, not a single arch-test.)

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     SPECIFIED here (name + what it asserts + which ADR); the developer implements them at build.
     NEW tests must be imported/wired into scripts/test.mjs (the runner imports each arch-test
     module explicitly) — that wiring is part of the owning story. All bundled-asset greps read
     src/bundle/… (NOT .claude/), per ADR-005. -->

| Invariant | Enforced by (arch-test) | From | New/Existing | Story |
|---|---|---|---|---|
| The loop is split across three parties by a structural tool boundary: the bundled **designer** agent's `tools:` contains NO `Bash` (stays `Read, Grep, Glob, Write, WebSearch, WebFetch`) and judges a *provided* screenshot; **QA** owns every browser/Playwright run + the `toHaveScreenshot` regression (and has `Bash`); the **orchestration** (`verify`/`continue`) renders + hands off. No browser-run / `toHaveScreenshot` ownership in the designer's contract. | `test/arch/acd-design-role-split.test.mjs` (parse the bundled `src/bundle/agents/aof-designer.md` frontmatter: assert `tools` has no `Bash`; assert its body claims judge-from-provided-screenshot, not running a browser. Parse `src/bundle/agents/aof-qa.md`: assert `tools` includes `Bash` and the body owns the Playwright harness + `toHaveScreenshot` regression. Grep `src/bundle/commands/{verify,continue}.md` for the render→hand-screenshot-to-designer step. Assert `toHaveScreenshot` / `npx playwright` appear in QA/orchestration contracts, NOT in the designer's.) | ADR-001 | **NEW** | 01 (designer half) + 02 (QA half) + 03 (orchestration half) — each story authors its slice of the same test |
| The conformance review returns exactly `CONFORMS` / `GAPS(list)` / `INCONCLUSIVE`; INCONCLUSIVE (naming the missing baseline) when no committed mock AND no binding checklist, or no render available; never guesses from code in place of a render; Playwright is on-demand via `npx`, NOT a `package.json` dependency. | `test/arch/acd-conformance-verdict-contract.test.mjs` (grep the bundled designer agent + `verify`/`continue` commands for the three verdict tokens `CONFORMS`/`GAPS`/`INCONCLUSIVE` and the INCONCLUSIVE-when-no-baseline rule; assert the render is invoked as `npx playwright …` in the commands; assert `playwright`/`@playwright/test` is NOT in root `package.json` `dependencies`/`devDependencies`.) | ADR-002 | **NEW** | 03 (wiring owns the commands; the designer-side verdict text is authored by 01 and read by the same test) |
| The bundled DESIGN milestone template encodes BOTH the committed-`mocks/`-dir convention (committed, locally-readable, referenced as source of truth) AND a mandatory binding-checklist section (regions-in-order / components / states / ramp) per surface. | `test/arch/acd-design-template-baseline.test.mjs` (read `src/bundle/templates/milestone/DESIGN.md`: assert it references a committed `mocks/` dir convention as the conformance source of truth; assert it carries a mandatory binding-checklist section enumerating regions/components/states/ramp; assert it no longer presents a remote-link-only mock as the sole reference.) | ADR-003 | **NEW** | 03 |
| `work.ui.a11y` is an OPTIONAL, CLOSED (`additionalProperties:false`) block peer to `work.ui.baseUrl`; an absent block validates; an unknown key under it fails; the a11y lane opts in via `work.tags.domains` containing `a11y` (no schema change to enable). | `test/arch/acd-a11y-config-schema.test.mjs` (Ajv-2020, mirroring `acd-headroom-config-schema`: assert an absent `work.ui.a11y` validates; a valid `{level:"AA"}` validates; an unknown key under `work.ui.a11y` fails on `additionalProperties`; assert `work.tags.domains:["a11y"]` validates as a plain string domain.) | ADR-004 | **NEW** | 02 |
| The design-conformance contract markers (role-split, render→judge hand-off, CONFORMS/GAPS/INCONCLUSIVE, committed-`mocks/`+binding-checklist) are present in the BUNDLED assets under `src/bundle/` — not only `.claude/`. | `test/arch/acd-design-conformance-bundled.test.mjs` (source-grep `src/bundle/agents/aof-designer.md`, `src/bundle/agents/aof-qa.md`, `src/bundle/commands/{verify,continue,refine}.md`, `src/bundle/templates/milestone/DESIGN.md` for the contract markers above; assert each marker appears in the BUNDLED asset, so the loop cannot ship lifted-into-`.claude/`-only.) | ADR-005 | **NEW** | 03 |
| `src/bundle/manifest.json` is a true content-address of the rendered bundle (the derived manifest is not stale after the bundle bodies change). | `test/arch/acd-bundle-manifest-hashes.test.mjs` | ADR-005 / ADR-006 | **EXISTING** (relied on — currently green; the manifest co-touch is contained here) | all three (each reruns `generate-bundle-manifest.mjs`; no story hand-edits the manifest) |

<!-- NOT fitness functions (deliberately) — the @manual / @uat / judgment residuals:
  - A REAL Playwright render — that `npx playwright screenshot "<baseUrl><Route>"` actually paints the
    surface on this machine — is a BUILD-TIME @manual confirmation (browser/Playwright availability is
    opt-in, on-demand; Playwright is intentionally NOT a package.json dep, ADR-002). NOT a CI arch-test.
  - The JUDGEMENT QUALITY of the verdict — whether the designer correctly calls CONFORMS vs lists the
    right GAPS for a real surface — is human/agent judgement (@uat / design review), not structural.
  - A REAL a11y run — axe-core-via-Playwright actually executing against the running app and what it
    finds — needs the browser + the served app → @manual/@uat (ADR-004). The schema shape + QA ownership
    are structural; the run is not.
  - Whether REFINE actually elicited a mock from the user, and the CONTENT of any milestone's committed
    mock / binding checklist, are authoring outcomes (the convention is structural via the template,
    ADR-003; the per-milestone artifact is not an arch-test).
  - That `init`/`update` re-render `.claude/`/`.aof/` from the bundle is existing, already-tested bundle
    machinery — relied on, not re-asserted here.
  - The status→action behaviour of the review steps, breakpoint pixel exactness, and the toHaveScreenshot
    baseline build-out (a QA-owned follow-on, SPEC out-of-scope) are behaviour / future work, not invariants.
-->
