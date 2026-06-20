---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 04 · Round-trip Proof — Architecture Decisions

> This milestone ships no product feature. It is a **proof**: that `aof work init` plus the bundled
> ACD assets compose into a working refine → continue → verify loop (the round-trip the ROADMAP calls
> for). The ADRs below are therefore about *how the proof is built so it actually proves something* —
> isolation, reuse of the real code paths, and where the deterministic/agent line sits — not about a
> shippable surface. `depends: [01]` (the proof `aof work init`s a fresh repo from the shipped bundle).

## ADR-001: The round-trip executes in a throwaway, isolated repo (temp dir + `git init`), never the dev tree or a global location

**Status:** Accepted
**Date:** 2026-06-20

**Context.** The proof must run `aof work init`, which *writes files* — it renders the bundle into
`.claude/…` and writes the `work` section of `.aof/aof.lock.json` (ADR-009 of milestone 02;
`src/work-init.mjs`). `initWork` resolves every path from `options.targetDir` (defaulting to
`process.cwd()`), so a proof that forgets to set `targetDir` — or that points it at a shared
location — would render the bundle *into this very repo* (clobbering the authored `src/bundle/` source
of truth, polluting the tracked tree) or into a developer's global `~/.aof`. Either is a footgun: a
test that mutates the working tree is non-repeatable, order-dependent, and dangerous to run in CI or on
a contributor's machine. The other arch-tests in this codebase already establish the safe pattern —
`mkdtemp(os.tmpdir())` → run → `rm(..., { recursive: true })` in a `finally` (see
`test/arch/acd-no-clobber-without-force.test.mjs`, `test/arch/acd-work-list-contract.test.mjs`). The
round-trip wants the same discipline, plus a real `git init` because the loop the proof drives expects
a git repo (the work stream lives under version control and the commands assume one).

**Decision.** The entire round-trip runs against a **fresh, throwaway repository** created per run: a
unique `mkdtemp` directory under the OS temp root, `git init`-ed, with every `aof` call given that
directory as its explicit `targetDir` / `cwd`. The repo is removed in a `finally` regardless of
outcome. The proof **never** uses `process.cwd()` as the target, **never** writes under this dev repo's
tree, and **never** touches a shared global workspace (`~/.aof`, `defaultGlobalWorkspaceDir`). Creating
and tearing down that isolated repo is the job of the **round-trip harness** (ADR-005) — there is one
place that owns isolation, and every story consumes it.

**Alternatives considered.**
- *Run against this repo's own tree (dogfood in place)* — rejected: `initWork` would render the bundle
  over the authored `src/bundle/` and write a `work` section into the tracked `.aof/aof.lock.json`,
  corrupting the source of truth and making the proof destructive and non-idempotent.
- *A fixed, reused scratch dir (e.g. `./.tmp-roundtrip`)* — rejected: shared mutable state across runs
  reintroduces order-dependence and stale-state flakes; a per-run `mkdtemp` is hermetic by construction.
- *A global location (`~/.aof` / a user temp the framework already knows)* — rejected: couples the
  proof to developer-machine state and risks clobbering a real global install.

**Consequences.** The proof is hermetic and repeatable: each run starts from nothing and leaves nothing
behind. Isolation becomes a single enforceable property of the harness rather than a discipline each
story must re-implement. The cost is that the harness must own temp-repo lifecycle (create, `git init`,
cleanup) — a small, well-understood surface already modelled by the existing arch-tests.

**Invariant.** The round-trip harness creates each repo with `mkdtemp` under the OS temp root and
`git init`, drives every `aof` call with that dir as `targetDir`/`cwd`, and writes nothing outside it;
it never targets `process.cwd()`, never writes under this dev repo, and never references the global
workspace. (Enforced by `acd-roundtrip-isolation`.)

## ADR-002: The proof drives the real shipped code paths — never a re-implementation or a hand-built fake install

**Status:** Accepted
**Date:** 2026-06-20

**Context.** The point of this milestone is to prove *aof's own machinery* composes. That guarantee is
only real if the proof exercises the **actual shipped code**: the bundle loader (`loadBundle`,
`src/work-bundle.mjs`), the install orchestrator (`initWork`, `src/work-init.mjs`), the render/lock
engine they delegate to (`createRenderPlan`/`planApplyActions`/`createLockManifest`,
`src/render-plan.mjs`), and the deterministic work verbs (`findWork`/`listStream`/`validateWork`/
`nextWork`, `src/work.mjs`). The tempting shortcut — to fabricate an install by hand-copying a few
`.claude/*.md` files into the temp repo, or to re-implement a miniature "next actionable item" walk so
the proof reads cleanly — would make the proof a tautology: it would prove the *fake*, not the product.
Milestone 01's ADR-003 already enshrined the same principle for init/update themselves ("do not
implement your own drift logic; delegate to the engine"); this ADR extends it to the proof layer.

**Decision.** The round-trip harness and the proof **import and invoke the real, exported functions** —
at minimum `initWork` (or the `aof work init` CLI), `loadBundle`, and the work verbs
`findWork`/`listStream`/`validateWork`/`nextWork` — to perform the install and to drive the loop's
mechanics. The harness contains **no second install routine** (no hand-rolled file-copy that stands in
for `initWork`), **no re-implementation** of the bundle render or the lock manifest, and **no parallel
copy** of the `next`/`validate` traversal. Where the proof must observe behaviour it asserts against
what the *shipped* functions return, not against a locally-reconstructed expectation. The agent-driven
half of the loop (ADR-003) is likewise driven by the *bundled* commands/agents, not by a scripted
imitation of them.

**Alternatives considered.**
- *Hand-build the install (copy bundle files into the temp repo)* — rejected: proves nothing about
  `initWork`, the synthesis, the capability matrix, the stamp, or the manifest — exactly the machinery
  the milestone exists to validate.
- *Re-implement `next`/`validate` inline for a tidier proof* — rejected: a private fork of the
  traversal can pass while the shipped one is broken; the proof must read the product's own answer.
- *Snapshot a pre-rendered install fixture and assert against it* — rejected as the install proof: a
  frozen snapshot rots and decouples from the live bundle. (A snapshot is acceptable only as recorded
  *evidence* for the manual surface — ADR-003 — not as a substitute for running the real install.)

**Consequences.** The proof's green is a genuine statement about the shipped pipeline; a regression in
`initWork`, the synthesis, the work verbs, or the bundle breaks the proof. Findings the proof surfaces
are about *real* code and route back into milestones 00/01 (ADR-004). The constraint costs a little
ergonomics — the harness can't take shortcuts — and it makes the import surface load-bearing, which is
exactly what the fitness function pins.

**Invariant.** The harness source imports the shipped entry points (`initWork`/`work init`,
`loadBundle`, and the `findWork`/`listStream`/`validateWork`/`nextWork` verbs) and contains no
re-implementation of install, render/lock, or the work-stream traversal. (Enforced by
`acd-roundtrip-reuses-shipped-code`.)

## ADR-003: The verification split — the deterministic CLI spine is `@executable`; the agent-driven loop is proven once as `@manual`/`@uat` with captured evidence

**Status:** Accepted
**Date:** 2026-06-20

**Context.** This is the crux decision; the product-owner's per-story task tagging follows it. The
round-trip has two fundamentally different halves:

1. **A deterministic CLI spine.** `aof work init` producing a rendered bundle + the `work` lock
   section; `aof work find/list/validate/next` walking a *seeded* work stream; `validate` gating on
   folder↔frontmatter / tag-vocabulary / `depends`-graph problems; `next` returning the first
   dependency-ready actionable item. These are pure functions of files on disk (`src/work.mjs`,
   `src/work-init.mjs`) — fully scriptable, byte-stable, repeatable.
2. **An irreducibly agent-driven loop.** The bundled `/aof:refine`, `/aof:continue`, `/aof:verify`
   commands are **markdown the agent executes** (`src/bundle/commands/*.md`), not deterministic CLI —
   they orchestrate the architect/PO/developer/qa *reasoning* (authoring stories, building code,
   verifying with the bundled actors). A unit test cannot assert the *content* an LLM produces; only
   that, given that content, the CLI spine and the lock behave. So the agent reasoning **cannot** be a
   green-forever automated assertion.

The methodology already names exactly three verification surfaces (`wiki/workflow.md`): fitness
functions (Decide, CI-forever), `@executable` BDD (Build, CI-forever), and `@manual`/UAT (Verify,
human, migrates to surface 2 over time). The split here is just *placing each half on its honest
surface*.

**Decision.** Draw the line precisely:

- **`@executable` (CI-forever) — the deterministic CLI spine.** Everything that is a function of files
  on disk: `aof work init` into the isolated repo renders the expected bundle files and writes a
  conformant `work` lock section; `aof work find/list` resolve a seeded stream; `aof work validate`
  reports the seeded problems (and passes a clean stream); `aof work next` returns the correct
  dependency-ordered item across seeded states. These become task `.feature` scenarios tagged
  `@executable`, driven through the harness against real `initWork`/work verbs (ADR-002).
- **`@manual` / `@uat` (Verify, human, evidence-backed) — the agent-driven loop.** Actually running
  `/aof:refine` → `/aof:continue` → `/aof:verify` on the worked-milestone fixture (ADR-004) with the
  bundled actors authoring stories, building code, and verifying it. Proven **once** as a recorded UAT
  procedure with **captured evidence** (the transcript / the resulting work-stream state / the final
  `aof work next` → `done`), signed off in `UAT.md`. It is NOT asserted by a CI test of agent reasoning.

The line is: **if the outcome is determined by files-on-disk, it is `@executable`; if it is determined
by an agent's reasoning, it is `@manual`/`@uat`.** No `@executable` scenario and no fitness function may
assert what an agent *authored*; conversely, the manual round-trip must not re-prove the CLI spine that
CI already covers — it consumes that spine and proves only the irreducible agent layer on top.

**Alternatives considered.**
- *Try to automate the whole loop, agent included* — rejected: an LLM's authored output is not a
  deterministic assertion; pinning it would be flaky and would test the model, not the framework.
- *Make the entire proof manual* — rejected: the CLI spine IS deterministic and belongs on CI-forever
  surface 2, where it catches regressions automatically; demoting it to manual throws away the cheapest,
  strongest coverage.
- *Add a fourth "round-trip" verification surface* — rejected: the methodology is explicit that
  security/compliance/proof concerns map onto the existing three surfaces, never a fourth
  (`wiki/workflow.md`). The split here is a *routing* of the two halves onto surfaces 2 and 3.

**Consequences.** The PO can tag every round-trip task unambiguously: spine scenarios `@executable`, the
loop scenario `@manual`/`@uat`. CI carries the deterministic guarantee forever; the human carries the
agent-reasoning guarantee once, with evidence, and can migrate parts to surface 2 as deterministic
seams emerge. The structural residue this ADR leaves for a fitness function is narrow — the harness must
expose only the deterministic spine and carry **no scripted stand-in for the agent loop** that could
masquerade as automated proof (that would violate both this ADR and ADR-002). The *which-scenario-is-
tagged-what* outcome is behavioural and lives in the task `.feature` files, not here.

**Invariant.** The harness exposes only the deterministic CLI spine (isolated-repo + real install +
real work verbs) and contains no scripted imitation of the agent-driven loop (no fabricated
refine/continue/verify "result" presented as an automated assertion). (Enforced by
`acd-roundtrip-reuses-shipped-code`, agent-stub clause — the same source that pins ADR-002's
reuse, since both forbid a fake stand-in.)

## ADR-004: The worked-milestone fixture is minimal, self-contained, deterministic, and fast; gaps it exposes route back to milestones 00/01

**Status:** Accepted
**Date:** 2026-06-20

**Context.** The loop is driven over a *canned sample milestone* — the "worked milestone" the SPEC
calls for. If that fixture is large, depends on the network, or pulls in real product complexity, the
proof becomes slow, flaky, and unrepeatable, defeating its purpose (a proof you can re-run cheaply). It
also must be *self-contained*: the deterministic spine scenarios (ADR-003) seed a work stream and assert
`find`/`list`/`validate`/`next` over it — that seed must be a fixed, in-repo fixture with no external
inputs. The SPEC is explicit that this milestone *"surfaces gaps back into 00/01"* — i.e. when the proof
reveals a missing affordance or a bug in the work CLI (00) or the bundle/installer (01), the fix lands
**there**, not patched into the proof in place.

**Decision.** The worked-milestone fixture is **minimal, self-contained, deterministic, and fast**: a
small `NN_milestone_<slug>` work-stream skeleton (a SPEC plus a couple of stories/tasks) authored as a
fixed fixture the harness seeds into the isolated repo, with **no network access and no external
service** — every input is local. It is sized so the whole spine proof runs in seconds and is byte-
stable across machines (forward-slashed paths, fixed frontmatter — the same discipline the existing
arch-tests use). **Findings route back, not in-place:** any gap the proof exposes in the work CLI or the
bundle/installer is recorded as a finding against **milestone 00 or 01** (via `aof:feedback`, routed by
item type) and fixed there; the proof is amended only to *cover* the fix, never to *work around* the
bug. The fixture lives with the harness (ADR-005) so both stories seed an identical sample.

**Alternatives considered.**
- *Drive a real, full product milestone* — rejected: slow, complex, and entangled with product
  concerns the proof shouldn't depend on; it would make the round-trip expensive to re-run.
- *Generate the fixture dynamically per run* — rejected: non-determinism undermines byte-stable
  assertions on `list`/`next` output; a fixed fixture is reproducible.
- *Fix discovered gaps inside the proof* — rejected: that hides bugs in the proof scaffolding instead
  of correcting the real machinery; the SPEC's "surface back into 00/01" requires routing the finding
  to its owning milestone.

**Consequences.** The proof is fast and repeatable, so it can run in CI's spine portion and be re-driven
by hand for the manual portion without friction. Bugs found become durable fixes in 00/01 with their own
regression coverage, so the framework actually improves from the proof. This ADR is mostly a **fixture-
shape and routing** decision; its structural residue (self-contained, no network) is covered by the
isolation fitness function (ADR-001) plus ADR-002's no-fake-install clause — it does not need a separate
arch-test. *(If a future story adds a network call to the fixture, that is a behavioural regression for
a `.feature`, not a new invariant here.)*

## ADR-005: The independent-story seam is the round-trip harness — a frozen, shared contract that creates the isolated repo, runs the real install, and seeds the sample milestone

**Status:** Accepted
**Date:** 2026-06-20

**Context.** This is the heart of the break-down. A round-trip proof is *naturally sequential*: you
cannot prove the loop without first proving an install, and both halves need the same isolated repo,
the same real install, and the same seeded sample. Left implicit, that shared setup would force the
install-proof story and the loop-proof story to serialise (each waiting to agree on how the repo is
built) or to duplicate the setup (two drifting copies). Milestone 01 solved the identical problem with a
**locked shared contract** — the install-manifest schema + the `aof-generated` stamp (ADR-004/005 of
01) — which was the *only* coupling between `work-init` and `work-update`, letting them parallelise. The
same technique applies here: extract the common setup into **one harness with a frozen API**, freeze it
at refine time, and let each story consume the harness but not the other story.

**Decision.** Introduce a **round-trip harness** — test-only support code (it is consumed by the proof's
tests, not shipped as a CLI surface) at a single, fixed module path — that owns the three shared
concerns and exposes them through a **frozen contract** (mirroring 01's frozen schema):

- `createRoundTripRepo()` → `{ dir, cleanup }` — `mkdtemp` + `git init` an isolated repo (ADR-001),
  returning its path and a teardown handle.
- `installBundle(dir, opts)` — run the **real** `aof work init` (`initWork`) into `dir`, returning the
  structured install result (actions + manifest) — never a hand-rolled copy (ADR-002).
- `seedSampleMilestone(dir)` — write the **fixed worked-milestone fixture** (ADR-004) into `dir`'s work
  stream, returning the seeded refs so a story can assert against them.

These three functions ARE the locked shared contract — the *only* coupling point between the stories.
The install-proof story consumes `createRoundTripRepo` + `installBundle`; the loop-proof story consumes
`createRoundTripRepo` + `seedSampleMilestone` (and, for its manual half, the installed bundle). Neither
story imports or depends on the other's code — they bind to the harness, frozen here.

**The locked shared contract — round-trip harness API (frozen 2026-06-20):**

```js
// test-only support module (single fixed path). The proof's stories bind to THIS
// surface and to nothing in each other. Each function drives the REAL shipped code
// (ADR-002) and stays inside the isolated repo (ADR-001).

// Create a hermetic repo: mkdtemp under the OS temp root + `git init`.
//   → { dir: string /* abs path inside os.tmpdir() */, cleanup: () => Promise<void> }
export async function createRoundTripRepo();

// Run the REAL `aof work init` (src/work-init.mjs initWork) into `dir`.
//   opts: { runtimes?: string[] /* default ["claude"] */, force?: boolean }
//   → the structured initWork result { actions, manifest, manifestPath, ... }
export async function installBundle(dir, opts);

// Seed the fixed, minimal worked-milestone fixture (ADR-004) into `dir`'s work
// stream (wiki/work/<NN>_milestone_<slug>/…), self-contained, no network.
//   → { milestoneRef: string, storyRefs: string[] } /* the seeded refs */
export async function seedSampleMilestone(dir);
```

**Alternatives considered.**
- *No harness; each story does its own setup* — rejected: duplicate, drifting setup, and the stories
  serialise on agreeing how the repo is built — exactly the coupling 01 eliminated with a frozen
  contract.
- *One monolithic round-trip story* — rejected unless the seam is genuinely absent; but the
  deterministic-spine half (CI-forever `@executable`) and the agent-driven half (one `@manual`/`@uat`)
  are different verification surfaces (ADR-003) owned by different concerns and can be built and signed
  off independently once the harness exists. The seam is real; a single story would lose the parallelism
  and conflate two surfaces.
- *Make the harness a shipped CLI command (`aof work roundtrip`)* — rejected: the round-trip is a *proof
  of aof*, not a feature *of aof*; shipping it as a command would put test scaffolding in the product
  surface. It is test-only support code.

**Consequences.** The harness story builds first (it has no dependency); then the install-proof story
and the loop-proof story build in **parallel**, coupled only through the frozen harness API — never
through each other. The harness is the single owner of isolation (ADR-001), real-install reuse
(ADR-002), and the sample fixture (ADR-004), so those invariants are enforced in one place. The cost is
one extra (small) story up front — the same trade 01 made, and for the same payoff: parallelism.

**Invariant.** The harness exposes exactly the frozen contract above (`createRoundTripRepo`,
`installBundle`, `seedSampleMilestone`) from a single module; each downstream story binds to the harness
and not to its sibling story's source. (Enforced by `acd-roundtrip-harness-contract`.)

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     EXPECTED RED until the harness exists (the proof is built downstream); each test's header
     states why its red is the correct red. -->

| Invariant | Enforced by (arch-test) | From |
|---|---|---|
| The round-trip harness creates each repo with `mkdtemp` under the OS temp root + `git init`, drives every `aof` call with that dir as `targetDir`/`cwd`, and writes nothing outside it — never `process.cwd()`, never under this dev repo, never the global workspace | `test/arch/acd-roundtrip-isolation.test.mjs` (source: the harness names `mkdtemp`/`os.tmpdir` + `git init` and passes an explicit `targetDir`, and never references `globalWorkspacePaths`/`defaultGlobalWorkspaceDir` nor defaults the target to bare `process.cwd()`; behavioural: drive the harness from a sentinel cwd and assert the dev tree and cwd are untouched and the created path is under `os.tmpdir()`) | ADR-001 |
| The proof drives the shipped code paths — the harness imports `initWork`/`work init`, `loadBundle`, and the `findWork`/`listStream`/`validateWork`/`nextWork` verbs, and contains no re-implementation of install / render-lock / the work-stream traversal, and no scripted stand-in for the agent loop | `test/arch/acd-roundtrip-reuses-shipped-code.test.mjs` (source: the harness imports the real entry points from `src/work-init.mjs` / `src/work-bundle.mjs` / `src/work.mjs`; it contains no second install copy-loop and no fabricated refine/continue/verify "result"; behavioural: the harness install result is byte-identical to a direct `initWork` call) | ADR-002, ADR-003 |
| The harness exposes exactly the frozen contract (`createRoundTripRepo`, `installBundle`, `seedSampleMilestone`) from a single module, and each downstream story binds to the harness, not to its sibling story | `test/arch/acd-roundtrip-harness-contract.test.mjs` (the harness module exports exactly those three functions; `createRoundTripRepo` returns `{ dir, cleanup }`, `installBundle` returns a structured install result, `seedSampleMilestone` returns `{ milestoneRef, storyRefs }`) | ADR-005 |

<!--
  No separate arch-test for ADR-004: its structural residue (self-contained / no-network / hermetic
  fixture) is covered by ADR-001's isolation test plus ADR-002's no-fake-install clause. ADR-004 is
  otherwise a fixture-shape + finding-routing decision (behavioural / process), not a structural
  invariant. ADR-003's "no automated assertion of agent reasoning" residue is enforced via the
  agent-stub clause of acd-roundtrip-reuses-shipped-code rather than a standalone test, because it is
  the same "no fake stand-in" rule as ADR-002.
-->
