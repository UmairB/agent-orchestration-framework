---
type: story
number: 00
slug: doc-bloat-check-group
parent: 16
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-25
---
# 00 · Doc-bloat check-group — the configurable context-budget lint

## User story

As an operator (and the agent ecosystem downstream of these docs) who wants agent context kept lean,
I want `work:doctor` to flag a long-form context doc — a milestone **SPEC.md** / **ARCHITECTURE.md** or a
story **STORY.md** — whose line count exceeds a **configurable** per-artifact budget, surfaced as a
`doc-over-budget` **warn** finding anchored at the offending file (naming its measured lines and the budget),
so that an over-long artifact that would poison every downstream agent's context is caught through the
*unchanged* `aof work doctor` surface — while a doc within budget stays silent, and the budget is tunable
from config rather than baked in.

<!-- This story is the WHOLE of milestone 16 (ARCHITECTURE.md ADR-007: a single, non-splittable unit). It
     plugs ONE pure check-group into the milestone-15 doctor engine via the m15/ADR-003 registry seam — it
     builds NO new command and NO new face (those are inherited, "no new door"). The three code pieces are
     one causal chain: a snapshot extension that records per-artifact line counts (ADR-002), a
     `budgetsFromConfig` resolver with documented defaults + the `budgets` schema block (ADR-005/006), and
     the `budgetGroup` fn in a new module `src/work-doctor-budget.mjs` appended to `CHECK_GROUPS` (ADR-001). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 16 --autonomous`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. The STRUCTURAL invariants —
     the `doc-over-budget` ENVELOPE shape, the no-baked-in-literal / config-sourced guarantee, the
     determinism/no-wall-clock invariant, the no-new-door bijection — are the milestone's ARCH-TESTS
     (ARCHITECTURE.md Fitness functions), NOT task scenarios. These task features carry only the
     OBSERVABLE check BEHAVIOUR, with the per-kind default budgets (spec 300 · architecture 700 · story
     150) fixed in the Examples. -->

- [x] **00 · [doc-over-budget](tasks/00_doc-over-budget.feature)** — the core check behaviour: an over-budget
  SPEC.md / ARCHITECTURE.md / STORY.md ⇒ one `doc-over-budget` warn finding at that file naming measured
  lines + budget; a doc within budget ⇒ no finding (silent when healthy); only the long-form context docs
  (SPEC/ARCHITECTURE/STORY) are measured — STATE.md / VERIFICATION.md / `.feature` files are NOT budgeted;
  two over-budget artifacts in one milestone (SPEC + ARCHITECTURE) ⇒ two distinct findings. A Scenario
  Outline keyed on artifact-kind + measured-lines-vs-default-budget → the expected finding.
- [x] **01 · [configurable-budget](tasks/01_configurable-budget.feature)** — the budget is config-sourced,
  not baked in: the SAME over-length artifact flips finding↔no-finding across a LOW vs HIGH configured
  `work.doctor.budgets` value; an absent budget key ⇒ the documented default applies (300/700/150); a
  partially-configured `budgets` (one key set) leaves the other artifact kinds on their defaults.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md): ADR-001 (one pure `budgetGroup` in
`src/work-doctor-budget.mjs` appended to `CHECK_GROUPS` — the module name is load-bearing so the m15
determinism glob auto-covers it) · ADR-002 (the snapshot additively carries per-artifact line metrics from
texts `buildSnapshot` already reads — the group is PURE over them, no FS read of its own) · ADR-003 (the
metric is LINES via `/\r?\n/`, platform-invariant; bytes deferred) · ADR-004 (one `doc-over-budget` warn
code, anchored at the over-budget FILE's raw absolute path) · ADR-005 (`budgetsFromConfig` resolver; defaults
300/700/150 live ONLY in the resolver, never in the group body) · ADR-006 (the `budgets` schema block on the
closed `work.doctor`) · ADR-007 (this single-story partition; faces inherited free).

This story **owns** the snapshot extension, the resolver + schema block, and the `budgetGroup` module — one
atomic change. It reads each item's recorded per-artifact line counts off the snapshot and compares them to
the resolved budgets from `ctx`; it does **not** read the wall-clock, does **not** read the filesystem
itself (the snapshot carries the measurement), and does **not** touch `src/commands/doctor.mjs` or any face
(no new door).

**Independent / atomic because** there is no second group fn, no second face, and no second artifact to
partition along (ARCHITECTURE.md ADR-007): the snapshot metric, the resolver, and the consuming group are one
causal chain over one shared edit to `work-doctor.mjs` — splitting would force two stories onto the same
`buildSnapshot` / `CHECK_GROUPS` body, the exact coupling the independent-partition rule forbids. Build-time
it needs only the milestone-15 doctor spine, which is `done`.

**Feasibility (developer amigo seat — confirmed at Contract):** the design is buildable against the real
seam exactly as the ADRs describe — one pure `budgetGroup` appended to `CHECK_GROUPS`
(`work-doctor.mjs:254`), a `budgetsFromConfig` resolver mirroring `staleWindowFromConfig`
(`work-doctor.mjs:268`) injected through the engine's existing `ctx` assembly (`work-doctor.mjs:325–329`,
where `staleWindow` already defaults via its resolver at `:327` — budgets default the same way), and a
`docSizes` line-metric carried additively on each enriched item like `docs`/`hasTasks`
(`work-doctor.mjs:146–156`). The group is pure over the snapshot (no FS, no wall-clock), the schema's
closed `work.doctor` (`aof.schema.json:415`) gains the closed `budgets` block, and the module name
`work-doctor-budget.mjs` is auto-swept by the determinism glob (`acd-doctor-engine-determinism.test.mjs:30`)
— no new determinism test. **One concrete implementation note (the only non-free part of ADR-002):** the
bytes the snapshot needs to measure ARE already read, but both read sites currently DISCARD the text — the
SPEC/STORY read at `work-doctor.mjs:134` passes the text inline to `parseFrontmatter` without binding it,
and the ARCHITECTURE read inside `fileState` (`work-doctor.mjs:95–102`) computes `{present, nonEmpty}` and
drops the text. So the snapshot extension is a small, contained refactor to RETAIN each already-read text
long enough to take `text.split(/\r?\n/).length` (bind the frontmatter read to a `const`; have `fileState`
return a `lines` count alongside `{present, nonEmpty}`, or measure off the same read) — measurement of an
existing read, NOT a second FS traversal, so ADR-002's "no new read" intent holds. **Second note — the
trailing-newline convention (ADR-003):** `text.split(/\r?\n/)` is platform-invariant (CRLF and LF both
collapse to one break), but a file ending in a final newline yields a trailing empty-string element, so a
file of N visible lines with a terminating `\n` counts as N+1; the resolver must FIX one convention (count
raw split length, or drop a single trailing empty element) and QA's Examples fixtures must be authored to
that same convention so the per-kind defaults (300/700/150) compare consistently across win32 and CI. With
those two notes the rest is inherited free: `src/commands/doctor.mjs` is untouched (no new door — the
finding flows through the existing `run`/`--json`/`--strict`/board faces), the artifact→kind mapping is
already there (`recordDoc`, `work-doctor.mjs:40`, plus ARCHITECTURE.md in `CONVENTION_DOCS`, `:91`), and the
bijection arch-tests stay green because m16 adds no `work:*` command. Purity and no-new-door confirmed; the
single open obligation is that the schema `budgets` block and the resolver land TOGETHER (a config carrying
`work.doctor.budgets` fails validation against the closed object today, `aof.schema.json:415`).
