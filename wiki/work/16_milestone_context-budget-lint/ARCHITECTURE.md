---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 16 · Context-Budget Lint — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — a *doc-bloat* check-group plugged into the
> milestone-15 `work:doctor` command: per-artifact line/size budgets for the long-form context docs
> agents consume — SPEC/ARCHITECTURE/STORY — warning when an artifact exceeds a *configurable* budget,
> inheriting m15's `--json` envelope, `--strict` promotion, and CLI/board/MCP faces; "no new door") and
> `STATE.md` (the 15 dependency; this milestone is otherwise independent of 15's other check-groups —
> parallel-eligible once the doctor foundation lands). ADRs cite these as `SPEC §…` / `STATE §…`.
> The framework this milestone plugs INTO is milestone 15 (`wiki/work/15_milestone_work-doctor-core/
> ARCHITECTURE.md`): m15/ADR-001 (the frozen `Finding = { code, severity, path, message }` envelope —
> `severity ∈ {"warn","error"}`, `path` a RAW ABSOLUTE in its on-disk OS form, the FACE relativises),
> m15/ADR-002 (`--strict` is a FACE-level exit-code policy, not a `run` mutation), m15/ADR-003 (the
> engine is a registry of pure `(snapshot, ctx) => Finding[]` GROUPS over a snapshot built ONCE, with an
> injectable clock — the NAMED extension seam: "a new check family = a new group fn appended to the
> registry; it edits no other group"), and m15/ADR-005 (registry-derived bijection — "no new door").
> The exact seams this milestone touches: `src/work-doctor.mjs` — the `CHECK_GROUPS` array
> (`work-doctor.mjs:254`, where a new group is APPENDED), `buildSnapshot` (`work-doctor.mjs:125`, which
> already reads SPEC/STORY text for frontmatter + ARCHITECTURE text for the `docs` fileState and carries
> additive per-item DATA — `docs`/`hasTasks`/`mtimeMs`/`newestFileMtimeMs` — the precedent for the
> snapshot extension), `staleWindowFromConfig` (`work-doctor.mjs:268`, the config-sourced resolver
> precedent), and `doctorWork` (`work-doctor.mjs:322`, the engine taking an injectable `groups`
> registry); `src/work-doctor-freshness.mjs` (the pure-group module style/purity this mirrors);
> `src/commands/doctor.mjs` (the command/CLI face — UNCHANGED here; budgets are read in the engine like
> staleWindow); `schemas/aof.schema.json:409–416` (the CLOSED `work.doctor` object holding only
> `staleWindowDays` — the schema change this milestone SPECIFIES); and
> `test/arch/acd-doctor-engine-determinism.test.mjs:27–32` (the glob over `work-doctor*.mjs` that
> auto-covers "any future m16 group" for the no-wall-clock invariant — which makes the module NAME
> load-bearing).

> **Memory recall (role-scoped, run once):**
> `aof work memory recall "context budget doc bloat artifact length lint" --area architecture --block`
> returned **empty** — memory off (the backend is `none` in this repo). Nothing to surface; proceeding
> unchanged from the recon directions.

## ADR-001: Doc-bloat is ONE new pure check-group fn in a new module `src/work-doctor-budget.mjs`, APPENDED to `CHECK_GROUPS`

**Status:** Accepted
**Date:** 2026-06-25

**Context.** `SPEC §Scope` requires the doc-bloat check to register "as a new check-group in the *same*
registered command" — inheriting m15's faces, "otherwise independent of the other check-groups". m15/ADR-003
is the published extension seam for exactly this: the engine `doctorWork` (`work-doctor.mjs:322`) iterates a
registry `CHECK_GROUPS` (`work-doctor.mjs:254`) of pure `(snapshot, ctx) => Finding[]` functions, and "a new
check family = a new group fn APPENDED to the registry; it edits no other group". The freshness group
(`work-doctor-freshness.mjs`) is the worked example: a standalone module exporting a pure group fn, imported
by the spine and appended to the registry. The only open question is the module *name* — and it is
load-bearing, not cosmetic.

**Decision.** The doc-bloat check is a single pure group function — `budgetGroup(snapshot, ctx) =>
Finding[]` — living in a NEW module `src/work-doctor-budget.mjs` and APPENDED to `CHECK_GROUPS`
(`work-doctor.mjs:254`). It edits no existing group body and no spine control flow; the only edit to
`work-doctor.mjs` is (a) the import of the new group and (b) one new entry in the `CHECK_GROUPS` array —
the additive, order-independent append the registry exists to make safe (the engine concatenates +
de-dupes, so position does not matter). The group is PURE over the snapshot: it reads ONLY the per-artifact
size metrics the snapshot already records (ADR-002) and the resolved budgets from `ctx` (ADR-005) — it
performs NO filesystem reads of its own and reads NO wall-clock, exactly as m15/ADR-003 mandates for every
group.

**The module name is load-bearing.** `test/arch/acd-doctor-engine-determinism.test.mjs:27–32` globs the
src dir for `/^work-doctor.*\.mjs$/` and applies the no-wall-clock ban across the WHOLE matched family
("any future m16 group"). Naming the module `work-doctor-budget.mjs` makes the new group AUTO-COVERED by
that determinism invariant with zero new test (ADR-007 (c)). A name outside the `work-doctor*` prefix
(e.g. `budget-lint.mjs`) would silently escape the determinism grep — a regression risk the convention
exists to foreclose. The name is therefore an architectural constraint, not a preference.

**Alternatives considered.**
- *Fold the doc-bloat check into an existing group (e.g. lifecycle-completeness, which already reads the
  `docs` map).* Rejected: it edits another story's group body, violating the m15/ADR-003 "edits no other
  group" seam and coupling two unrelated check families (a missing-RETROSPECTIVE coherence fact vs a
  context-length budget fact) into one function — the exact shared-body coupling the registry dissolves.
- *Add a new spine control-flow branch in `doctorWork` for budgets.* Rejected: budgets are a check FAMILY,
  not engine plumbing; the spine stays check-agnostic (it only iterates the registry). A group fn is the
  whole mechanism.
- *Name the module `budget-lint.mjs` / `work-doc-budget.mjs`.* Rejected: it falls outside the
  `work-doctor*.mjs` determinism glob (above), losing the inherited no-wall-clock coverage. `work-doctor-
  budget.mjs` is the only name that is both descriptive and auto-covered.

**Consequences.** Story 00 lands `src/work-doctor-budget.mjs` exporting `budgetGroup` and appends it to
`CHECK_GROUPS`. The new module is automatically swept by the m15 determinism + no-wall-clock arch-test via
its `work-doctor*` name (no new determinism test — ADR-007 (b)). The config-sourced + envelope-conformance
invariants get their own arch-tests (Fitness functions table).

## ADR-002: The snapshot ADDITIVELY carries per-artifact line metrics — the group is pure over them (the one allowed snapshot extension)

**Status:** Accepted
**Date:** 2026-06-25

**Context.** m15/ADR-003 forbids a check-group from reading the filesystem itself — every group is a pure
function over the snapshot `buildSnapshot` builds ONCE (`work-doctor.mjs:125`). So the doc-bloat group
cannot `readFile` the artifacts to measure them; the measurement must be DATA the snapshot already carries.
Crucially, the snapshot ALREADY reads the long-form context docs it needs to measure: it reads SPEC.md /
STORY.md text to `parseFrontmatter` (`work-doctor.mjs:132–137`, via `recordDoc` mapping milestone→SPEC.md,
story→STORY.md) and it reads ARCHITECTURE.md text for the `docs` fileState non-empty probe
(`work-doctor.mjs:91, 142–145`, `CONVENTION_DOCS` includes `ARCHITECTURE.md`). Adding a line COUNT to these
already-read texts is *measurement of an existing read*, not a new read — precisely the additive snapshot
extension m15 set the precedent for when it added `docs` / `hasTasks` (`work-doctor.mjs:139–156`).

**Decision.** Extend `buildSnapshot` (`work-doctor.mjs:125`) to record, per item, a per-artifact size map —
the LINE COUNT (ADR-003) of the long-form context docs that item owns. The natural carrier is a new additive
field on each enriched item (mirroring `docs` exactly), e.g.:

```
item.docSizes = { "SPEC.md": { lines: N }, "ARCHITECTURE.md": { lines: M }, "STORY.md": { lines: K } }
```

— populated ONLY for the artifacts that item type owns and that exist (a milestone records SPEC.md and, when
present, ARCHITECTURE.md; a story records STORY.md). The count is taken from the SAME text the snapshot
already reads — the frontmatter read for SPEC.md/STORY.md and the `docs` fileState read for ARCHITECTURE.md —
so this adds a `splitLines(text).length` measurement, not a filesystem traversal. (The resolver MAY also
carry byte size in the same map for a future byte budget — ADR-003 — but lines is the v1 metric.) The
`budgetGroup` (ADR-001) is PURE over `item.docSizes`: it reads the recorded line counts and the resolved
budgets, and emits a finding per over-budget artifact. This is "the one allowed snapshot extension," the
same shape as the `docs` / `hasTasks` additions.

**Alternatives considered.**
- *Have the budget group `readFile` each artifact itself.* Rejected: it violates m15/ADR-003's "no FS reads
  of its own beyond what the snapshot already holds" — the group must be pure over the snapshot. It would
  also re-read files the snapshot already read (the SPEC/STORY/ARCHITECTURE texts), an N-redundant traversal.
- *Measure size lazily in the resolver / CLI face instead of the snapshot.* Rejected: the metric must be
  snapshot DATA so the group stays pure and the determinism invariant (same snapshot ⇒ same findings) holds;
  a face-level measure would make the metric invisible to the board/MCP faces and to `doctorWork`'s injectable
  composition the arch-tests assert over.
- *Reuse the existing `docs` map's fileState to also hold the count.* Rejected as a coupling risk — `docs`
  is story 01's lifecycle-completeness contract (present/non-empty); overloading it with a `lines` field
  would entangle two stories' data shapes. A SEPARATE additive `docSizes` map keeps the budget data its own,
  honouring the same "additive, never overload an existing group's data" discipline.

**Consequences.** Story 00 extends `buildSnapshot` to populate `docSizes` (line counts) from the
already-read artifact texts. The config-sourced fitness function (Fitness functions table) proves the group
is pure over this data behaviourally (the same artifact flips finding↔no-finding across two budgets with no
FS change). This snapshot extension is owned by the single story (ADR-006).

## ADR-003: The metric is LINES, counted platform-invariantly (`/\r?\n/`); a byte/size budget is a DEFERRED config knob

**Status:** Accepted
**Date:** 2026-06-25

**Context.** `SPEC §Objective` anchors the rule on length — "a 600-line SPEC poisons every agent" — and
`SPEC §Scope` says "per-artifact line / size budgets". Lines is the legible unit an author reasons in.
But the metric MUST be deterministic (m15/ADR-003): this repo is on win32, so files may carry CRLF line
endings while CI on Linux carries LF. A naive count that differs by line-ending convention would make the
SAME artifact yield DIFFERENT line counts on different platforms — a non-reproducible finding, the exact
violation m15/ADR-003's determinism invariant forbids (and the freshness group already guards platform
determinism for timezones, `work-doctor-freshness.mjs:50–58`).

**Decision.** The v1 metric is **LINES**, counted by splitting the artifact text on `/\r?\n/` so a CRLF
(`\r\n`) and an LF (`\n`) line break yield the SAME count — a file with N line breaks reads as the same N
lines whether checked out on win32 or Linux. The count is `text.split(/\r?\n/).length` over the
already-read text (ADR-002); a trailing newline is counted consistently (the convention is fixed in the
resolver and asserted by the behaviour fixtures, not re-litigated here). Lines is the v1 unit because it is
the unit the catalog's anchor names ("a 600-line SPEC") and the unit an author can act on directly.

**The byte/size budget is DEFERRED, recorded as a documented default decision.** `SPEC §Scope` says "line /
size"; bytes does not earn its place in v1 because (a) lines is the legible, actionable unit and the only
unit the PRD anchors on; (b) a byte budget and a line budget measuring the same bloat would double-report
the same artifact (two findings for one fact) unless carefully reconciled — added complexity for no v1
signal; (c) the snapshot's `docSizes` map (ADR-002) is shaped to ADMIT a `bytes` field later
(`{ lines, bytes? }`) and the schema's `budgets` object (ADR-006) can grow a sibling key, so deferring costs
no rework. If a future need (e.g. token-budget proxying) earns it, a byte budget is an additive resolver
default + a new `budgets` schema key — not a re-architecture.

**Alternatives considered.**
- *Count lines by `text.split("\n")` (LF only).* Rejected: on win32 a CRLF file would count `\r`-suffixed
  lines correctly by accident but a `\r`-only legacy ending (rare) would mis-count; more to the point, the
  explicit `/\r?\n/` split DOCUMENTS the platform-invariance intent. Determinism must be visible in the
  metric, not incidental.
- *Ship bytes alongside lines in v1.* Rejected: see "deferred" above — double-reporting risk and no v1
  signal; lines alone satisfies SPEC's "warning when an artifact exceeds a configurable budget".
- *Count "characters" / a token estimate.* Rejected: tokens are model-specific and non-deterministic across
  tokenisers (an ADR-003 violation); characters are less legible than lines and not what the PRD anchors on.
  Lines is the honest, deterministic, author-actionable unit.

**Consequences.** Story 00's snapshot extension (ADR-002) and resolver count lines via `/\r?\n/`. The
determinism invariant (inherited, ADR-007 (b)) covers the count's reproducibility — the same fixture yields
byte-identical findings. The byte budget is a documented deferral STATE echoes for the retrospective.

## ADR-004: ONE machine code `doc-over-budget`, severity `warn`, anchored at the over-budget FILE's raw absolute path

**Status:** Accepted
**Date:** 2026-06-25

**Context.** `SPEC §Scope` asks for a finding that fires "when an artifact exceeds a configurable budget",
carrying "the same severity + stable machine-code shape the milestone-15 engine already defines"
(m15/ADR-001's `{ code, severity, path, message }`). SPEC describes a single behaviour — a WARNING at a
configurable budget — across three artifact kinds (SPEC/ARCHITECTURE/STORY). The questions: one code or
per-artifact codes; warn-only or a hard-ceiling error tier; what the `path` anchors.

**Decision.** ONE machine code — `doc-over-budget` — severity `warn`, fired ONCE per over-budget artifact
(mirroring how `orphan-folder` fires once per offending artifact with the name in the message,
`work-doctor.mjs:192–217`). The finding anchors `path` at the SPECIFIC over-budget FILE's raw absolute path
(e.g. `…/16_milestone_…/SPEC.md`), which m15/ADR-001 permits — the envelope's `path` is "the finding's
anchor item/folder/FILE", and a budget finding's natural anchor is the one file that is too long. The
`message` names the artifact, its measured line count, and the budget it exceeded, e.g.:

```
{ code: "doc-over-budget", severity: "warn",
  path: "<abs>/16_milestone_context-budget-lint/SPEC.md",
  message: 'SPEC.md is 412 lines, over the 300-line budget for milestone 16' }
```

`run`'s `finding.path` stays a RAW ABSOLUTE in its on-disk OS form — NO projection (m15/ADR-001, the
08/ADR-002 keystone); the FACE relativises. `severity` is `warn` (advisory): SPEC asks for a "warning", and
an over-budget doc is a health smell, not a coherence violation — it never blocks a clean run except under
`--strict` (m15/ADR-002, inherited).

**Alternatives considered.**
- *Per-artifact codes (`spec-over-budget` / `architecture-over-budget` / `story-over-budget`).* Rejected:
  it triples the code vocabulary for one behaviour. The artifact is already identified by the `path` anchor
  (the over-budget file) and named in the `message`; a CI rule or follow-on keying on "any doc over budget"
  keys on the single `doc-over-budget` code, and can still discriminate by inspecting the path/message.
  One code per BEHAVIOUR (not per artifact kind) matches the m15 codes (`orphan-folder` covers root AND
  story orphans with one code, `work-doctor.mjs:192–217`).
- *Add an `error` hard-ceiling tier (e.g. >2× budget ⇒ error).* Rejected: SPEC asks ONLY for a "warning when
  an artifact exceeds a configurable budget" — no hard ceiling. An `error` tier would make doc length a
  blocking gate (changing the lane's exit policy), which SPEC does not ask for; `--strict` already lets a
  consumer promote the warn to a gate (m15/ADR-002). A second tier is a future concern only if SPEC earns it.
- *Anchor `path` at the item FOLDER rather than the file.* Rejected: the budget finding is about a specific
  FILE being too long; anchoring at the file (which m15/ADR-001 permits) lets a reader jump straight to the
  offending artifact and lets two over-budget artifacts in one milestone (SPEC + ARCHITECTURE) each anchor
  distinctly, rather than collapsing to one folder anchor.

**Consequences.** Story 00's `budgetGroup` emits `doc-over-budget` per over-budget artifact at the file's
raw absolute path. The envelope-conformance fitness function (Fitness functions table) freezes the four-key
shape, `severity:"warn"`, and the absolute file path; the OBSERVABLE behaviour ("a 412-line SPEC over a
300-line budget ⇒ a `doc-over-budget` finding") lives in the story's task `.feature`, not here.

## ADR-005: The budget is config-sourced via a `budgetsFromConfig(config)` resolver — NO baked-in artifact-budget literal in the group body

**Status:** Accepted
**Date:** 2026-06-25

**Context.** `SPEC §Objective` / `§Scope` require the budget be "configurable rather than a baked-in
constant" / "read from config, not hard-coded". m15 already solved the analogue: `staleWindowFromConfig`
(`work-doctor.mjs:268`) resolves `config.work.doctor.staleWindowDays` to a duration, defaulting to 30 days
when absent, and the freshness group reads the resolved value off `ctx` — it holds no `30`-day literal of
its own. Budgets follow that precedent exactly.

**Decision.** A resolver `budgetsFromConfig(config)` (mirroring `staleWindowFromConfig`,
`work-doctor.mjs:268`) reads `config.work.doctor.budgets = { spec, architecture, story }` (line counts) and
returns a resolved `{ spec, architecture, story }`, substituting DOCUMENTED DEFAULTS for any absent key. The
resolved budgets flow into the group via `ctx` (the CLI face supplies them at the edge, exactly as it
supplies `staleWindow`; the engine's `ctx` already carries `config`, so the resolver may also be applied
inside `doctorWork`'s ctx assembly — mirroring how `staleWindow` defaults via `staleWindowFromConfig` at
`work-doctor.mjs:327`). The `budgetGroup` body contains NO artifact-budget numeric literal — the only place
a budget NUMBER appears is the resolver's defaults. The group reads `ctx`'s resolved budgets and compares
each artifact's recorded line count against the budget for its kind.

**The documented default line budgets (calibrated against this repo's real, healthy artifacts):**

| Artifact | Default budget (lines) | Calibration |
|---|---|---|
| **SPEC.md** | **300** | The richest healthy SPEC in-repo is 124 lines (m13); m15 SPEC = 106, m16 = 73. 300 clears the healthiest by ~2.4× and sits well under the PRD's "600-line SPEC is too long" alarm — it flags genuine bloat, not the repo's healthy SPECs. |
| **ARCHITECTURE.md** | **700** | ADR logs LEGITIMATELY grow (immutable, supersede-not-edit). The largest healthy ADR log in-repo is m13 at 631 lines; m15 = 449 (6 ADRs). 700 clears the healthiest ADR log with headroom — the most generous budget, because an ADR log's growth is by design, not bloat. |
| **STORY.md** | **150** | The ENTIRE STORY.md corpus tops out at 81 lines. 150 clears the corpus max by ~1.8×; a STORY is one user story + slices, so bloat there is a real smell — but the budget must not false-positive the healthy 60–81-line stories. |

These are the v1 defaults; STATE echoes them as documented defaults for the retrospective. They are chosen
so that running `aof work doctor` over THIS repo today yields ZERO `doc-over-budget` findings (no healthy
artifact is flagged) while a 600-line SPEC, an 800-line ARCHITECTURE, or a 200-line STORY would each fire.

**Alternatives considered.**
- *A baked-in constant in the group body.* Rejected outright by `SPEC §Objective` ("configurable rather than
  a baked-in constant") and by the config-sourced fitness function (Fitness functions table), which
  source-greps the group body for any artifact-budget literal. Defaults live ONLY in the resolver.
- *One global budget for all three artifact kinds.* Rejected: an ARCHITECTURE.md (an immutable, growing ADR
  log) and a STORY.md (a single user story) have wildly different healthy lengths (631 vs 81 in-repo); one
  number would either false-positive every ARCHITECTURE or under-police every STORY. Per-kind budgets are
  the honest shape.
- *Default the budgets to OFF (no check unless configured).* Rejected: SPEC wants the check to surface bloat
  out of the box ("an outsider can verify it … surfaces a … doc-bloat finding"); sensible per-kind defaults
  give the value immediately while staying overridable. Absent config ≡ defaults, mirroring `staleWindowDays`.

**Consequences.** Story 00 lands `budgetsFromConfig` (defaults only here) and the group reads resolved
budgets off `ctx`. The config-sourced fitness function (Fitness functions table) asserts both the absence of
a baked-in literal in the group body AND the behavioural flip (same artifact, finding↔no-finding across a
low vs high budget). The schema change that admits `budgets` is ADR-006.

## ADR-006: The schema gains a `budgets` key on the CLOSED `work.doctor` object (SPECIFIED here; applied by the owning story)

**Status:** Accepted
**Date:** 2026-06-25

**Context.** `config.work.doctor` is a CLOSED object — `additionalProperties:false`
(`schemas/aof.schema.json:415`) — currently holding only `staleWindowDays` (`:413`). Because it is closed,
a config carrying `work.doctor.budgets` would FAIL schema validation today. The config-sourced budget
(ADR-005) therefore REQUIRES a schema change before any project can override the defaults. This ADR records
the change as an obligation of the owning story; per the doc-only discipline of this refine, it is SPECIFIED,
not applied now.

**Decision (SPECIFY only — do NOT edit `schemas/aof.schema.json` at this refine).** Add a `budgets` property
to the `work.doctor` object's `properties` (`schemas/aof.schema.json:412–414`), itself a CLOSED object with
optional integer `spec` / `architecture` / `story` (each `minimum: 1`), `additionalProperties:false`,
described in the house style of `staleWindowDays` — naming the per-artifact line budget, the
milestone/ADR provenance, and "absent ⇒ defaults" with the default numbers from ADR-005. Shape:

```jsonc
"budgets": {
  "type": "object",
  "description": "OPTIONAL per-artifact line budgets for the work-doctor doc-bloat check (milestone 16). Each is the max line count before a `doc-over-budget` warn finding fires for that artifact kind. Absent keys ⇒ documented defaults (spec 300, architecture 700, story 150). Closed (additionalProperties:false).",
  "properties": {
    "spec":         { "type": "integer", "minimum": 1, "description": "Max lines for a milestone SPEC.md before doc-over-budget. Absent ⇒ 300." },
    "architecture": { "type": "integer", "minimum": 1, "description": "Max lines for a milestone ARCHITECTURE.md before doc-over-budget. Absent ⇒ 700 (ADR logs legitimately grow)." },
    "story":        { "type": "integer", "minimum": 1, "description": "Max lines for a story STORY.md before doc-over-budget. Absent ⇒ 150." }
  },
  "additionalProperties": false
}
```

`work.doctor` STAYS closed (the new `budgets` sits beside `staleWindowDays`); `budgets` itself is closed so a
typo'd budget key (`stories`, `arch`) is caught by validation rather than silently ignored.

**Alternatives considered.**
- *Make `work.doctor` open (`additionalProperties:true`) to admit budgets without a named schema.* Rejected:
  it loses validation of budget keys (a typo'd `stories` would be silently dropped, defaulting unexpectedly)
  and breaks the house "closed config objects" discipline (`staleWindowDays` precedent, the `roadmap`/
  `headroom` siblings are all closed, `schemas/aof.schema.json:407, 434`). Closed-with-named-keys is the
  house shape.
- *Put budgets at `work.doctor.budget` (singular, one number).* Rejected: ADR-005 needs per-kind budgets;
  a single number cannot express the SPEC=300 / ARCHITECTURE=700 / STORY=150 split.
- *Apply the schema edit at THIS refine.* Rejected: this is a doc-only Decide stage; editing the schema now
  is out of scope. The owning story applies it alongside the resolver that reads it (so the schema and the
  reader land together and config validation stays green).

**Consequences.** The single owning story (ADR-007) carries the obligation to apply this `budgets` schema
block when it lands `budgetsFromConfig`. STATE records the documented defaults (300/700/150) so they are
visible without reading the schema. Until applied, a config overriding budgets would fail validation — which
is why the schema edit and the resolver are one story's atomic change.

## ADR-007: The single-story partition — `00_story_doc-bloat-check-group` (one non-splittable unit; faces inherited free)

**Status:** Accepted
**Date:** 2026-06-25

**Context.** The story partition must be independent BY CONSTRUCTION (the architect's contract with the PO):
no two stories edit the same function body except through the agreed registry-append seam. m15 was a
five-family engine that genuinely split into a spine + pluggable check-group stories + a keystone-wiring
story (m15/ADR-006). m16 is a different shape: it adds ONE check family to a framework that already exists,
inheriting every face for free.

**Decision — ONE story: `00_story_doc-bloat-check-group`.** It owns the entire milestone as a single
non-splittable unit:
1. the snapshot extension — `docSizes` line metrics in `buildSnapshot` (ADR-002);
2. the resolver — `budgetsFromConfig` with the documented defaults (ADR-005) + the `budgets` schema block
   (ADR-006);
3. the group — `src/work-doctor-budget.mjs` exporting `budgetGroup`, appended to `CHECK_GROUPS` (ADR-001);
4. the new arch-tests (envelope-conformance + config-sourced — Fitness functions table); and
5. the inherited-invariant verification (no new test — ADR-007 (b) below).

**Why a second story would be artificial coupling, not independence.** The three code pieces are ONE causal
chain over ONE shared change: the resolver feeds `ctx`, the snapshot feeds the metric, and the group is the
only consumer of BOTH — and the snapshot extension AND the registry append BOTH edit `buildSnapshot` /
`CHECK_GROUPS` in `work-doctor.mjs`. Splitting (say "snapshot story" + "group story") would force TWO stories
to edit `buildSnapshot` and the same `CHECK_GROUPS`/import region — the exact shared-body coupling the
independent-partition rule forbids (the opposite of m15's stories, which each appended a DISTINCT group fn to
a frozen registry). There is no second group fn, no second face, no second artifact to partition along. The
unit is genuinely atomic; one story is the honest partition.

**Faces are inherited — ZERO face work.** `SPEC §Scope` ("inherited faces, no new door"): m16 adds NO
`work:*` command. `src/commands/doctor.mjs` is UNCHANGED — budgets are resolved in the engine like
staleWindow; the new finding flows through the existing `work:doctor` `run`/`--json`/`--strict`/board/MCP
faces untouched (m15/ADR-001, ADR-002). So there is no CLI story, no board story, no bijection-generalisation
story — those are m15's, already green.

**Fitness functions fold into this one owning story** (per m15/ADR-006's "fold the fitness function into the
owning story"): the two NEW arch-tests ship WITH the code they assert over, in this single story.

**Inherited invariants — recorded, NO new test:**
- **(a) "no new door" (m15/ADR-005).** m16 adds NO `work:*` command, so the registry-derived bijection
  arch-tests (`test/arch/acd-work-command-route-coverage.test.mjs`,
  `test/arch/acd-work-command-cli-bijection.test.mjs`) stay GREEN for free — the `work:*` set is unchanged.
  No new test, no edit.
- **(b) determinism + no-wall-clock (m15/ADR-003).** AUTO-COVERED by
  `test/arch/acd-doctor-engine-determinism.test.mjs:27–32`'s glob over `work-doctor*.mjs` — the moment the
  module is named `work-doctor-budget.mjs` (ADR-001), the no-wall-clock ban and the byte-identical-findings
  proof span it. The ONLY obligation is the module name. No new determinism test.
- **(c) the frozen envelope (m15/ADR-001).** The new `doc-over-budget` finding conforms to
  `{ code, severity, path, message }`, `severity:"warn"`, raw absolute path — asserted by the NEW
  envelope-conformance arch-test below (which proves m16's finding honours m15's frozen shape).

**Alternatives considered.**
- *Split into a "snapshot + resolver" story and a "group + tests" story.* Rejected: both would edit
  `buildSnapshot`/`work-doctor.mjs`, and the group cannot be proven without the snapshot metric and the
  resolver — the pieces are not independently shippable. Artificial coupling, not parallelism.
- *Mirror m15's spine + check-group + keystone-wiring four-story shape.* Rejected: m16 has no spine to build
  (m15 built it), no second check family, and no keystone wiring (validate.md already references
  `aof work doctor` from m15/ADR-006 story 03). Copying m15's shape would manufacture empty stories.

**Consequences.** `aof:refine 16` authors exactly one story, `00_story_doc-bloat-check-group`, carrying the
snapshot extension + resolver + schema block + group module + the two new arch-tests, with the inherited
invariants verified by m15's existing arch-tests. The owning story is the atomic, reviewable unit.

## Fitness functions

<!-- Each structural invariant an ADR implies, paired with the arch-test that will enforce it in CI.
     SPECIFIED ONLY at this refine — NOT written. RED-until-built is correct: src/work-doctor-budget.mjs,
     the budgetsFromConfig resolver, and the docSizes snapshot field do not exist yet; the new arch-tests
     reference them and would FAIL until the owning story lands. Writing a failing arch-test now would
     break CI and cross the doc-only line, so these are prose specs the build authors.
     STRUCTURAL invariants live HERE, never in a task .feature: the QA amigos keep task features to
     observable check BEHAVIOUR (e.g. "a 412-line SPEC over a 300-line budget ⇒ a `doc-over-budget`
     finding"; "a doc within budget ⇒ no finding"). -->

| Invariant | Enforced by (arch-test) | Target file | State now | From |
|---|---|---|---|---|
| **`doc-over-budget` envelope + behaviour-at-the-contract conformance.** The `doc-over-budget` finding is exactly `{ code, severity, path, message }`: `code === "doc-over-budget"`, `severity === "warn"` (no other value), `path` PRESENT and ABSOLUTE (`path.isAbsolute(p)`, equal to its on-disk OS form — NOT cwd-/projectRoot-relativised, NOT forward-slashed by `run` — the m15/ADR-001 keystone), `message` present and naming the artifact + measured lines + budget. Fired ONCE per over-budget artifact, anchored at the over-budget FILE. | **NEW** `acd-context-budget-finding.test.mjs` — `invoke` `work:doctor` (or call `doctorWork` with `groups:[budgetGroup]`) over a fixture stream carrying an OVER-budget SPEC/ARCHITECTURE/STORY; assert every `doc-over-budget` finding has exactly the four keys, `severity:"warn"`, and `path.isAbsolute(finding.path)` pointing at the offending FILE. (Architect note: a NEW file, not an extension of m15's `acd-doctor-finding-envelope.test.mjs` — that test fixtures m15's structural codes; a separate file keeps m16's invariant self-contained and its RED-state isolated from m15's green suite.) | `test/arch/acd-context-budget-finding.test.mjs` | RED until the owning story lands `budgetGroup` emitting `doc-over-budget` | ADR-004, ADR-001 (inherited m15 envelope) |
| **Config-sourced budget / NO baked-in literal.** (a) The group body in `src/work-doctor-budget.mjs` holds NO artifact-budget numeric literal — defaults live ONLY in the `budgetsFromConfig` resolver (source-grep the group fn body, comments stripped per the house strip-comments discipline, for any budget-magnitude integer literal). (b) BEHAVIOURALLY, the SAME over-length artifact flips finding↔no-finding across two configs — a LOW budget (below the artifact's line count) yields a `doc-over-budget` finding, a HIGH budget (above it) yields none — proving the budget is read from config, not baked. | **NEW** `acd-context-budget-config-sourced.test.mjs` — (a) read `src/work-doctor-budget.mjs`, strip comments, assert the `budgetGroup` body contains no artifact-budget numeric literal (the resolver, not the group, owns defaults); (b) run `doctorWork` over ONE fixture with `config.work.doctor.budgets` set LOW then HIGH and assert the `doc-over-budget` finding appears then disappears. | `test/arch/acd-context-budget-config-sourced.test.mjs` | RED until the owning story lands `budgetsFromConfig` + the literal-free group body | ADR-005 |
| **Determinism / no-wall-clock for the new module.** Same fixture + same snapshot ⇒ byte-identical `doc-over-budget` findings; the new module reads NO wall-clock (no `Date.now(` / argless `new Date()`). | **INHERITED — NO new test.** `test/arch/acd-doctor-engine-determinism.test.mjs:27–32` globs `/^work-doctor.*\.mjs$/` and applies the byte-identical-findings + no-wall-clock ban across the WHOLE family. The ONLY obligation is naming the module `work-doctor-budget.mjs` (ADR-001) so the glob covers it. | `test/arch/acd-doctor-engine-determinism.test.mjs` (existing, unchanged) | GREEN once the module is named `work-doctor-budget.mjs` and is wall-clock-free (it has no reason to read the clock) | ADR-003, ADR-001 (module name), m15/ADR-003 |
| **No-new-door (inherited).** m16 adds NO `work:*` command, so the registry-derived bijection (`/api/work/<op>` ↔ `work:*` registry, and `work <sub>` CLI dispatch ↔ `work:*` registry) stays in bijection unchanged. | **INHERITED — NO new test.** m15's `test/arch/acd-work-command-route-coverage.test.mjs` + `test/arch/acd-work-command-cli-bijection.test.mjs` (registry-derived per m15/ADR-005) stay green because the `work:*` command set is unchanged by m16. | `test/arch/acd-work-command-route-coverage.test.mjs`, `test/arch/acd-work-command-cli-bijection.test.mjs` (existing, unchanged) | GREEN (no `work:*` command added) | m15/ADR-005 |

<!-- Arch-test vs behavioural task scenario (the QA-amigos boundary):
     - The ENVELOPE shape of doc-over-budget, the CONFIG-SOURCED / no-baked-literal guarantee, the
       DETERMINISM/no-wall-clock invariant, and the NO-NEW-DOOR bijection are structural invariants over the
       command contract / group source / registry → arch-tests (this table). They are NOT task features.
     - The OBSERVABLE check BEHAVIOUR — "a SPEC of N lines over its M-line budget ⇒ a `doc-over-budget`
       finding naming the file/lines/budget", "an ARCHITECTURE within its 700-line budget ⇒ no finding",
       "an over-budget STORY ⇒ a finding at the STORY.md anchor", "two over-budget artifacts in one milestone
       ⇒ two findings" — is behaviour over the real seam and belongs in the owning story's task .feature
       file, NOT here. The Examples table in that .feature fixes the per-kind default budgets the behaviour
       asserts against (300/700/150), echoing ADR-005's documented defaults. -->
