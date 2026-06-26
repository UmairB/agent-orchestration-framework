---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 15 · Work Doctor Core — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the health-lane the validity-lane lacks: a
> deterministic *cross-item* check engine surfaced as `work:doctor`, advisory-by-default with `--strict`,
> wired into `/aof:validate` after `aof work validate`) and `STATE.md` (the 08 dependency; 16 ·
> context-budget-lint plugs a doc-bloat check-group into the framework framed here). ADRs cite these as
> `SPEC §…` / `STATE §…`.
> The seams this milestone builds on: the command registry `src/command-core.mjs` (the frozen
> `{ id, input, run, cli:{argv,render,json} }` contract + `invoke`/`getCommand`/`listCommands`; the
> COMMANDS array is where `work:doctor` registers); its sibling `src/commands/validate.mjs` (the basis-
> neutral `{ findings }` envelope — raw absolute paths in `run`, the face relativises: the 08/ADR-002
> keystone, and scope-as-filter via `validateWork`); the model `src/work.mjs` (`listItems` folder-only
> enumeration, `parseFrontmatter`, `readMeta`, `isDriver`, `recordDoc`, `ITEM_RE`, and `validateWork`'s
> EXISTING per-file checks doctor must NOT duplicate); the config validate/doctor split
> (`src/config-inspect.mjs` `doctorConfig` ~236, `src/cli.mjs` `doctorCommand` ~1590 + its `--strict`
> exit logic, and the injectable-seam idiom `resolveManagedBinary`); the milestone-08 bijection fitness
> functions `test/arch/acd-work-command-cli-bijection.test.mjs` + `acd-work-command-route-coverage.test.mjs`
> (they HARD-CODE the six and assert EXACTLY-the-six); the board face `src/board-ui.mjs` `/api/work/<op>`
> route table + `src/setup-ui.mjs` `handleWorkApi`; and the lint keystone `src/bundle/commands/validate.md`.
> The precedent is milestone 08 ADR-002 ("the command is canonical; path display is a face adapter") and
> the config `validate`/`doctor` split this milestone mirrors for the work stream.

> **Memory recall (role-scoped, run once):**
> `aof work memory recall "work stream health doctor cross-item check engine" --area architecture --block`
> returned **empty** — the memory backend is `none` (memory off). Nothing to surface; proceeding
> unchanged from the recon directions.

## ADR-001: `work:doctor` is the validate sibling on the command core, with its OWN richer finding envelope `{ code, severity, path, message }`

**Status:** Accepted
**Date:** 2026-06-25

**Context.** The work stream has a *validity* lane (`aof work validate` → folder↔frontmatter, the closed
tag vocabulary, the `depends` graph) but no *health* lane (`SPEC §Objective`). Every `validateWork` check
is per-file well-formedness (`work.mjs:302–394`); none sees across items, so the stream can be 100% valid
while a `done` milestone hides an `in-progress` child, a `done` milestone has no `RETROSPECTIVE.md`, an
`in-progress` item's `updated` is months stale, or a typo'd folder vanishes from `listItems` entirely —
all deterministic, computable facts that nothing reports. The config side already runs this exact split
(`aof project validate` / `aof project doctor`); this milestone gives the work stream the same.

The doctor must register on the SAME command core as `work:validate` (`SPEC §Scope`: "`work:doctor` as a
registered command-core command … so the CLI, board, and MCP faces inherit it for free", and `STATE`:
"authored as a registered command on milestone 08's contract") — never a side-channel. The open question
is the envelope: `work:validate`'s finding is `{ path, problem }` (a per-file string), which cannot carry
the two things SPEC requires of a health finding — a **severity** (so `--strict` and the faces can reason
over it) and a stable **machine code** (so a finding is addressable, e.g. a CI rule or a 16 follow-on can
key on `lying-parent`). And a *cross-item* finding's natural anchor (the lying parent's SPEC.md) is one
path, but the message is about a relationship, not a malformed field.

**Decision.** `work:doctor` registers as a command `{ id: "work:doctor", input, run, cli }` into the
`COMMANDS` array (`command-core.mjs:63`), exactly the 08/ADR-002 contract. Its finding envelope is a
**superset** of validate's, frozen here:

```
Finding = { code: string, severity: "warn" | "error", path: string, message: string }
  code     — a stable kebab machine string, the addressable identity of the check that fired,
             e.g. "lying-parent" | "stale-parent" | "story-done-under-not-started" |
             "depends-blocked-in-progress" | "missing-verification" | "missing-retrospective" |
             "milestone-no-stories" | "started-story-no-tasks" | "missing-architecture" |
             "stale-updated" | "updated-before-created" | "unparseable-date" | "mtime-ahead-of-updated" |
             "numbering-gap" | "duplicate-driver-number" | "roadmap-folder-mismatch" | "orphan-folder".
  severity — "warn" (advisory) or "error" (a coherence violation). EXACTLY these two values; there is
             NO "ok"/"info" row (the deliberate divergence below). The code→severity mapping is the
             check-group's own contract (e.g. lying-parent is "error"; stale-updated is "warn").
  path     — the RAW ABSOLUTE OS-native path of the finding's anchor item/folder/file. NO projection.
  message  — the human one-liner naming the cross-item fact (e.g. "milestone 07 is done but story
             07/02 is in-progress (lying parent)").
```

`run(input, ctx)` returns `{ findings: Finding[] }` **basis-neutral**: every `finding.path` is a raw
absolute in its on-disk OS form — NO `displayPath`, NO `path.relative`, NO slashing inside `run` (the
08/ADR-002 keystone, inherited verbatim from `validate.mjs`). The faces relativise: the board projects
to `projectRoot` + forward-slash (mirroring `board-ui.mjs` `displayPath`), the CLI `--json` adapter to
`process.cwd()`. **Finding-oriented**, like validate: there are no `ok` rows, and an **empty `findings`
array means healthy** — the stream is silent when well. `input` is `{ scope?: string }`, scope-as-filter
with the SAME semantics as `validate` (an unresolved scope matches nothing → empty findings, no error).

**The deliberate divergence from config `doctor` (recorded, not an accident).** `config-inspect.mjs`
`doctorConfig` (~236) is **check-oriented**: it emits one row per check ALWAYS, including `severity: "ok"`
rows ("Config is valid.", "No stale root config detected.") and uses four severities (`ok` / `warning` /
`error` / `info`). `work:doctor` deliberately does NOT mirror that. It is **finding-oriented** like
`work:validate` (only problems are emitted; a clean stream is an empty array) and uses only two
severities (`warn` / `error`). Reasons: (a) the work stream can have hundreds of items — a row-per-check
×N-items report would bury the signal; the validate precedent (silent when clean) is the right house
shape for the work surface; (b) a cross-item check fires zero or many times over the snapshot, so "one
ok row per check" is not even well-defined (which item is the ok row about?). The `warn`/`error` split is
exactly what `--strict` (ADR-002) needs and no more.

**Alternatives considered.**
- *Reuse `validate`'s `{ path, problem }` verbatim.* Rejected: it carries neither severity nor a machine
  code, so `--strict` could not distinguish advisory from blocking, and a finding could not be addressed
  by a stable id (the 16 follow-on, a CI rule, a future `--only <code>`). The envelope MUST be richer.
- *Fold doctor's checks INTO `validateWork` (one `aof work validate` that does both).* Rejected by SPEC
  (`§Objective`: validate stays "the hard non-zero gate", doctor stays "advisory until `--strict`") — the
  two lanes have different exit policies (ADR-002) and different audiences (validate = a CI gate; doctor =
  a health advisory). Conflating them would force validate to go advisory or doctor to go gating. Two
  commands, one core.
- *Mirror config doctor's check-oriented `ok`-rows + four severities for house consistency.* Rejected: see
  the divergence above — the validate precedent (finding-oriented, silent-when-clean, two severities) is
  the right shape for the work surface, and consistency with the *work* sibling (validate) outranks
  consistency with the *config* sibling.

**Consequences.** Story 00 lands `src/commands/doctor.mjs` registering `work:doctor` with this frozen
envelope; the envelope is the contract stories 01/02's check-groups emit into and 16 inherits. The
envelope-contract fitness function (below) freezes the four-key shape and the basis-neutral-path rule.

## ADR-002: `--strict` is a FACE-level exit-code policy, not a `run`-level mutation — mirroring `aof project doctor` exactly

**Status:** Accepted
**Date:** 2026-06-25

**Context.** SPEC requires doctor "advisory by default; `--strict` promotes warnings to failures exactly
as the config doctor does" (`§Objective`, `§Scope`). The danger is letting `--strict` change WHAT `run`
returns (e.g. dropping warnings, or re-tagging them) — that would make the command result non-canonical
(the board/MCP faces would see a different finding set than the CLI under `--strict`) and would couple
exit-policy into operation logic. The exact rule must be read from the real seam, not guessed.

**The exact rule, read from `src/cli.mjs` `doctorCommand` (~1590) — verbatim:**

```js
const errors   = report.checks.filter((item) => item.severity === "error");
const warnings = report.checks.filter((item) => item.severity === "warning");
const failed   = errors.length > 0 || (options.strict && warnings.length > 0);
// …
if (failed) process.exitCode = 1;
```

So: an **`error`-severity finding ALWAYS exits non-zero** (with OR without `--strict`); a
**`warning`-severity finding exits non-zero ONLY under `--strict`**; a clean run (no errors, and no
warnings-under-strict) exits 0. (`configCommand`'s validate at ~1565 uses the identical
`failed = errors.length > 0 || (options.strict && warningCount > 0)`.) `--strict` never changes the
emitted finding set — it only changes the gate.

**Decision.** `run` ALWAYS returns every finding with its severity (pure advisory data; `--strict` is not
even part of the command `input`). The exit-code decision lives entirely in the **CLI face**, mirroring
the rule above with `warn` in place of config's `warning`:

```
errors = findings.filter(f => f.severity === "error")
warns  = findings.filter(f => f.severity === "warn")
failed = errors.length > 0 || (options.strict && warns.length > 0)
if (failed) process.exitCode = 1     // error ⇒ always gate; warn ⇒ gate only under --strict
```

The CLI is `aof work doctor [scope] [--json] [--strict]`. `--json` emits the canonical envelope through
the CLI path-projection (cwd-relative paths), plus the same `{ healthy: !failed, strict, errors, warnings,
findings }` summary shape config doctor's `--json` carries, so a CI step can read `healthy`/exit-code
without re-deriving. The human `render` lists each finding `severity: code — message` (cwd-relative path),
"healthy" when empty. The **board and MCP faces project the SAME envelope but do NOT gate** — they have no
exit code; `--strict` is a CLI-only concern (a board cannot "fail CI"). The board route is a thin
pass-through (ADR-003).

**Alternatives considered.**
- *Pass `--strict` into `run` and have it drop/re-tag warnings.* Rejected: it makes the command result
  non-canonical across faces and couples exit policy into operation logic — the exact anti-pattern the
  08/ADR-002 face-adapter design exists to prevent. `run` is advisory data; the gate is a face.
- *Make `error` advisory too (only `--strict` ever gates anything).* Rejected: it contradicts the real
  config-doctor rule (an `error` ALWAYS exits non-zero there) and SPEC's "promotes *warnings* to
  failures" — errors are already failures; `--strict` only promotes *warnings*. Mirror the sibling
  faithfully.
- *Reuse validate's "any finding ⇒ exit 1" policy.* Rejected: that is the GATE lane's policy; doctor is
  the ADVISORY lane (`SPEC §Objective`). A `warn`-only doctor run must exit 0 by default, or doctor
  becomes a second hard gate and the lane distinction collapses.

**Consequences.** Story 00's CLI face owns the `--strict` exit logic and the `--json` summary; the engine
(ADR-003) and the board route stay gate-agnostic. The `--strict` exit-policy fitness function (below)
pins the four cases (no findings → 0; warn-only default → 0; warn-only `--strict` → non-zero; any error →
non-zero regardless of `--strict`).

## ADR-003: The engine is a composition of independent, pure check-GROUP functions over a shared snapshot, with an injectable clock

**Status:** Accepted
**Date:** 2026-06-25

**Context.** Two forces shape the engine. (1) **Parallel authorship + build.** SPEC groups the checks into
five families (status coherence, lifecycle completeness, freshness/date-sanity, ROADMAP↔folder, orphans);
the story partition (below) needs these to be authored AND built independently — no two stories editing the
same function body. (2) **The named extension seam.** `STATE` and `SPEC §Out of scope` name milestone 16
explicitly: it "plugs a doc-bloat check-group into the `work:doctor` command framed here." So the engine is
not just doctor's internals — it is a *published extension point* a later milestone composes into. (3)
**Determinism.** SPEC's freshness/date checks compare `updated` against file mtimes and against a "stale
window" — anything reading the wall-clock (`Date.now()`/`new Date()`) makes a freshness finding
non-reproducible in CI. The config-doctor precedent already solves the analogue with injectable seams
(`options.resolveManagedBinary`, `options.env`, `options.platform` in `config-inspect.mjs` — "every state
is CI-assertable with the resolver stubbed").

**Decision.** The engine is `doctorWork(workDir, config, scope, { now, staleWindow })`:

1. **Build the item snapshot ONCE.** Reuse `listItems(workDir)` (folder-only, `work.mjs:57`) for the item
   set, then ONE `readMeta`-style pass to attach each item's frontmatter (`status`/`created`/`updated`/
   `parent`/`depends`). The snapshot also carries the raw `workDir` directory listing (for orphan
   detection — dirs not matching `ITEM_RE`) and, for the freshness group, a per-item folder-mtime probe.
   The snapshot is the shared, read-only input every check-group reads; no group re-traverses the FS for
   identity.
2. **Run a registry/array of pure check-GROUP functions** `(snapshot, ctx) => Finding[]`, where
   `ctx = { now, staleWindow, config }`. The engine concatenates every group's findings (then de-dupes
   identical `code+path+message` exactly as `validateWork` de-dupes `path+problem`). Each group is a pure
   function of `(snapshot, ctx)` — no FS reads of its own beyond what the snapshot already holds, no
   wall-clock. **A new check family = a new group fn appended to the registry; it edits no other group.**
3. **Time is injected, never baked.** `now` (a millisecond timestamp / Date) and `staleWindow` (a
   config-sourced duration, e.g. `config.work?.doctor?.staleWindowDays`) flow through `ctx`. The engine
   reads NO `Date.now()`/`new Date()` of its own; freshness findings (`stale-updated`,
   `updated-before-created`, `mtime-ahead-of-updated`, `unparseable-date`) are pure functions of the
   snapshot's recorded mtimes/dates and the injected `now`/`staleWindow`. Same fixture + same `now` ⇒
   byte-identical findings. (Mtimes come from the snapshot's `stat` pass, taken once at snapshot build —
   the only FS time read, and it is data the engine receives, not a clock the checks call.) The CLI face
   supplies `now = Date.now()` at the edge; tests supply a fixed `now`.
4. **`run` is a thin wrapper.** `work:doctor`'s `run(input, ctx)` resolves `scope`, calls
   `doctorWork(ctx.workspace.workDir, ctx.workspace.config, scope, { now: Date.now(), staleWindow:
   fromConfig(ctx.workspace.config) })`, and returns `{ findings }`. The `Date.now()` lives at the command
   boundary (the impure edge), NOT inside the engine or any group.

This engine **reuses `listItems`/`readMeta`/`parseFrontmatter`/`isDriver`/`recordDoc`/`ITEM_RE`** from
`work.mjs` and adds NO new identity-parsing — it is a new *consumer* of the model, like `validateWork` and
`nextWork`. It must NOT duplicate `validateWork`'s per-file checks (folder↔frontmatter, tag vocabulary,
depends-resolves/acyclic): those stay in the validity lane; doctor's groups are strictly the cross-item /
docs-for-status / freshness / structural-integrity facts validate cannot see.

**Alternatives considered.**
- *One monolithic `doctorWork` with all checks inline.* Rejected: the stories would all edit the same
  function body (no independent authorship/build), and 16 could not plug in without editing doctor's
  source — defeating the named extension seam. The group registry is what makes both true.
- *A snapshot per group (each group does its own `listItems`/`readMeta`).* Rejected: N re-traversals of
  the same FS for the same identity data, and a risk that two groups disagree on the snapshot (a folder
  added mid-run). One snapshot, many pure readers.
- *Let the engine read `Date.now()` directly in the freshness group.* Rejected: non-reproducible findings
  in CI; the config-doctor injectable-seam precedent (`resolveManagedBinary`) is the house answer.
  Determinism is a fitness function (below), so the wall-clock read must not exist in the engine source.
- *Make the group registry user-configurable (enable/disable groups via config).* Out of scope here — the
  registry is a code-level composition seam (16 appends a group in code); a config toggle is a later
  concern if it earns one.

**Consequences.** Story 00 lands `doctorWork` + the group registry + the injectable `now`/`staleWindow`
and proves the spine with zero-or-one trivial group. Stories 01/02 each append their groups as pure fns —
mutually independent, none editing another's body. 16 appends its doc-bloat group the same way. The
determinism fitness function (below) asserts the engine source contains no `Date.now()`/`new Date()` and
that a fixed-`now` fixture yields byte-identical findings.

## ADR-004: ROADMAP↔folder sync is folder-FIRST — the folder-only invariants always run; the ROADMAP cross-reference is opt-in / an honest no-op

**Status:** Accepted
**Date:** 2026-06-25

**Context.** SPEC's structural-integrity family lists "milestones on disk absent from ROADMAP.md (or
vice-versa); numbering gaps and duplicate top-level driver numbers" (`§Scope`). **Recon finding (recorded
here):** neither ROADMAP in this repo is a machine-parseable milestone index. `wiki/work/ROADMAP.md` is a
*deferred-work backlog*; `wiki/ROADMAP.md` is a *prose build narrative*. There is no structured
"milestone N → slug/status" table to diff folders against. So the "on disk absent from ROADMAP (or
vice-versa)" cross-reference rests on a document shape that does not exist in this repo today. This is a
non-critical open question; under `aof:refine … --autonomous`, the refine is authorised to record a
documented default decision for it (and STATE will note it for the retrospective).

**Decision. Folder-first.** Split SPEC's family into two tiers:

1. **Folder-only invariants — ALWAYS run** (they read only `listItems`, no ROADMAP, no doc parse):
   - **`numbering-gap`** — a gap in the top-level driver number sequence (e.g. milestones 07, 08, 10 with
     no 09) is a `warn` finding (gaps are usually intentional reservations, not errors — advisory).
   - **`duplicate-driver-number`** — two top-level drivers (milestone/uat, via `isDriver`) sharing a
     number is an `error` (ambiguous `depends`/`next` resolution — `findWork`/`nextWork` key on number).
   - **`orphan-folder`** — a directory directly under `workDir` (and under any milestone's `stories/`)
     that does NOT match `ITEM_RE` (`^(\d+)_(milestone|story|task|uat)_…`). These are silently dropped by
     `listItems` today (`work.mjs:61`), so a typo'd folder vanishes from every command — a `warn` (it is
     a real artifact nothing else reports). (SPEC lists orphans as its own family; it is grouped with the
     structural-integrity story for build, but it is a distinct code.)
2. **The ROADMAP↔folder cross-reference — opt-in, honest no-op otherwise.** A SEPARATE check (`code:
   roadmap-folder-mismatch`) that activates ONLY when a structured, machine-parseable milestone-index
   ROADMAP is present/configured (e.g. a `config.work?.roadmap` pointing at a parseable index). When no
   such index is present/configured — the state of this repo today — the check is an **honest no-op**: it
   emits nothing and asserts nothing, rather than fabricating a diff against a prose narrative it cannot
   parse. This is the documented default for the non-critical open question.

**Alternatives considered.**
- *Drop the ROADMAP cross-reference entirely* (flagged in the recon as a candidate). NOT taken — kept as
  an opt-in/no-op rather than removed, because (a) the folder-only invariants (gap/duplicate/orphan)
  deliver the bulk of SPEC's structural-integrity value with zero ROADMAP dependency, and (b) leaving a
  dormant, contract-shaped hook means a project that DOES keep a structured milestone index gets the
  cross-reference for free without re-opening the ADR. Removing it would lose that, for no gain (a no-op
  check costs nothing). If the retrospective finds no project ever ships a structured index, dropping it
  is a clean follow-up. **(Architect note for the orchestrator: this is the one judgment call where I
  could see a reasonable "just drop it" — recorded as opt-in/no-op; not a blocker.)**
- *Parse `wiki/ROADMAP.md`'s prose with a heuristic.* Rejected: a prose narrative is not a deterministic
  index; a heuristic diff would emit non-reproducible findings (the opposite of ADR-003's determinism).
  Doctor only diffs against a STRUCTURED index or it stays silent.
- *Make numbering-gap an `error`.* Rejected: gaps are commonly intentional reservations; an `error` would
  false-positive a healthy stream. `warn` is honest; `duplicate-driver-number` is the `error` (it breaks
  resolution).

**Consequences.** Story 02 builds the folder-only group (gap/duplicate/orphan — always-on, deterministic,
folder-only) plus the dormant cross-reference hook. The structural-integrity checks are CI-assertable
against fixtures today (no ROADMAP shape required); the cross-reference is exercised only when a fixture
supplies a structured index. STATE records the documented default.

## ADR-005: The milestone-08 bijection generalises from "exactly six" to REGISTRY-DERIVED ("no new door")

**Status:** Accepted
**Date:** 2026-06-25

**Context.** SPEC requires the board/MCP faces to "surface the doctor envelope through the registered
command (no new door)" (`§Scope`) — i.e. a `/api/work/doctor` route that is a thin pass-through, and an
`aof work doctor` CLI branch, both reachable through the SAME registry, with NO operation logic in the
face. The milestone-08 bijection fitness functions already enforce exactly this property — BUT they
**hard-code the six**:
- `acd-work-command-route-coverage.test.mjs:26` `const EXPECTED_OPS = ["doc","feedback","list","next",
  "tasks","validate"]` and asserts `assert.deepEqual(routeOps(source), EXPECTED_OPS)` — "EXACTLY the six".
- `acd-work-command-cli-bijection.test.mjs:28` `const SUBCOMMANDS = ["list","doc","tasks","validate",
  "next","feedback"]` and greps `workCommand` for a `subcommand === "<sub>"` branch per sub, and
  spawn-parses `aof work <sub> --json` for each.

Adding `work:doctor` as the 7th work command **breaks both** (the route set is now seven; there is a
seventh command with a CLI branch the hard-coded list does not name). The fix is the structural
realisation of "no new door": stop hard-coding the set, DERIVE it from the registry.

**Decision (SPECIFY only — do NOT edit the test files at this refine; they would fail until story 00
wires doctor in).** Generalise both bijection arch-tests from a hard-coded six to **registry-derived**:

- **Route-coverage test.** Replace the literal `EXPECTED_OPS` with the set derived from
  `listCommands().filter(c => c.id.startsWith("work:")).map(c => c.id.slice("work:".length))`. The two
  assertions become a BIJECTION over that derived set: (a) **every served `/api/work/<op>` route** (the
  `pathname === "/api/work/<op>"` literals grepped from `board-ui.mjs`) maps to a registered `work:<op>`
  command (`getCommand("work:"+op)` is defined) — no UI route without a command; (b) **every registered
  `work:*` command** has a served `/api/work/<op>` route — no command without a door. The behavioural
  stand-up loops over the derived set (adding a `/api/work/doctor` GET probe). NOTE: the derived set is
  `work:*` only — the `graph:*`/`project:*`/`import:*` commands in the shared registry are NOT served on
  `/api/work` and are correctly excluded by the `work:` prefix filter (so generalising does not wrongly
  demand a `/api/work/graph-build` route).
- **CLI-bijection test.** Replace the literal `SUBCOMMANDS` with the SAME registry-derived `work:*` sub
  set. Assertions: every `work:*` command (i) carries a non-null `cli` adapter (`cli.argv`/`cli.render`
  functions — unchanged), (ii) has a reachable `subcommand === "<sub>"` branch in `workCommand`'s body,
  and (iii) `aof work <sub> --json` runs cleanly + emits parseable JSON against a fixture. `argsFor(sub)`
  gains a `doctor` case (`["work","doctor","--json"]`); doctor, like validate, may exit 0 OR non-zero
  cleanly (a `warn`/`error` finding can make it exit non-zero under the right args — accept `[0,1]` for
  doctor as the test already does for validate). The doctor probe must be a READ (no write), so its
  fixture args target the whole stream / a real ref and assert parseable JSON, nothing mutated.

**Alternatives considered.**
- *Just append `"doctor"` to the two hard-coded lists.* Rejected: it leaves the fitness function a
  manual-maintenance list that the NEXT command (16's, or any future `work:*`) breaks again — the bug
  SPEC's "no new door" exists to make impossible. Registry-derived means the bijection self-maintains:
  the day a `work:*` command is added without a route or a CLI branch, the test fails with no edit.
- *Derive from `board-ui.mjs` routes instead of the registry.* Rejected: that proves "every route has a
  command" but not "every command has a route" (the other half of the bijection — a command with no door
  is the exact drift). The registry is the canonical set both directions derive from.

**Consequences.** Story 00 (which wires `work:doctor`'s route + CLI branch) is also the story that lands
these generalised arch-tests — so the test change and the wiring land together and the suite stays green.
SPECIFIED here, NOT edited now: editing them at refine would make them RED (doctor is not wired) and break
CI, crossing the doc-only line. Their target files are the two existing `test/arch/*` files above.

## ADR-006: The independent-story partition (a foundation spine + three pluggable check-group stories + a keystone-wiring story)

**Status:** Accepted
**Date:** 2026-06-25

**Context.** The partition must be independent BY CONSTRUCTION: stories author and build in parallel, and
no two stories edit the same function body except through the agreed extension seam (ADR-003's group
registry — where "editing" means appending a NEW group fn, never touching an existing one). It mirrors the
m08 command-core/CLI/board/fitness shape, but FOLDS each fitness function into the owning story (rather
than a separate fitness story) and adds the keystone-wiring story SPEC names.

**Decision — the four stories (blessed, unchanged from the recon proposal):**

- **`00_story_doctor-command-core`** — the FOUNDATION the others plug into. Registers `work:doctor` (the
  `{code,severity,path,message}` envelope, ADR-001); builds `doctorWork` — the snapshot-once spine + the
  pure check-GROUP registry + the injectable `now`/`staleWindow` + scope-as-filter (ADR-003); the CLI
  face `aof work doctor [scope] [--json] [--strict]` with the render discipline + the `--strict` exit
  policy (ADR-002); the board `/api/work/doctor` thin pass-through route (ADR-001/ADR-002); and the
  **registry-derived bijection generalisation** of the two m08 arch-tests (ADR-005). Ships the spine +
  envelope provable end-to-end with ZERO or ONE trivial check-group. Owns the envelope-contract, engine-
  determinism, registry-derived-bijection, and `--strict`-exit-policy fitness functions.
- **`01_story_coherence-and-completeness-checks`** — the **status-coherence** group (`lying-parent`,
  `stale-parent`, `story-done-under-not-started`, `depends-blocked-in-progress`) and the
  **lifecycle-completeness** group (`missing-verification`, `missing-retrospective`,
  `milestone-no-stories`, `started-story-no-tasks`, `missing-architecture`) — each a PURE check-group fn
  appended to story 00's registry. Owns its check-BEHAVIOUR task `.feature`s.
- **`02_story_freshness-and-structural-integrity`** — the **freshness/date-sanity** group
  (`stale-updated`, `updated-before-created`, `unparseable-date`, `mtime-ahead-of-updated`, via the
  injected clock — ADR-003) and the **structural-integrity** group (folder-first `numbering-gap`,
  `duplicate-driver-number`, `orphan-folder` always-on, plus the dormant `roadmap-folder-mismatch`
  cross-reference hook — ADR-004) — pure check-group fns appended to the registry. Owns its check-
  BEHAVIOUR + determinism task `.feature`s.
- **`03_story_validate-keystone-wiring`** — wires `aof work doctor` into the `/aof:validate` skill
  (`src/bundle/commands/validate.md`) AFTER `aof work validate`, lane-grouped: validate stays the hard
  gate, doctor is the deterministic advisory floor beneath the skill's agent-only layer. A docs/bundle
  change only — it touches no engine source.

**Why the boundaries are genuinely independent.**
- **Stories 01 and 02 never edit the same function body.** Each appends its own group fn(s) to the
  registry story 00 freezes; the registry is an array, so appending is additive and order-independent
  (the engine de-dupes + concatenates). Neither edits the other's group, neither edits the spine.
- **Build-time dependency, expressed in prose.** 01, 02, and 03 each CONSUME story 00's spine (the engine
  + envelope + CLI/board faces + the generalised bijection must exist first). 01/02/03 are mutually
  independent and parallelizable once 00 lands. Per the model, **stories do NOT carry frontmatter
  `depends:`** (the model resolves `depends` for DRIVERS only — `work.mjs` `isDriver`); the 00→{01,02,03}
  ordering lives in each STORY's prose, not in frontmatter.
- **Story 03 is orthogonal.** It edits only `validate.md` (a bundle doc) — it touches no `src/`, so it
  cannot collide with 00/01/02's code. It depends on 00 only in that the CLI command it references must
  exist.
- **Rebalance check (recon proposal accepted, no moves).** Freshness was considered for story 01 (it is a
  "coherence" cousin), but it is the group that NEEDS the injected clock and the mtime probe, which makes
  it kin to the structural-integrity group (both read folder/file metadata beyond frontmatter); keeping
  freshness with structural-integrity in story 02 keeps the "reads only frontmatter" groups (status +
  lifecycle) in story 01 and the "reads folder/file metadata" groups (freshness + structure) in story 02
  — a clean, honest seam. No coupling missed.

**Alternatives considered.**
- *A separate fitness-only story (m08's shape).* Rejected here: each check-group's fitness function is the
  envelope/determinism/bijection invariant that the OWNING story's code must satisfy — folding it into the
  owner keeps the invariant and its code in one reviewable change. (The four cross-cutting fitness
  functions live with story 00, the spine they assert over.)
- *One big "all-checks" story.* Rejected: it serialises the check work and re-introduces the shared-body
  coupling the group registry exists to dissolve.

## Fitness functions

<!-- Each structural invariant an ADR implies, paired with the arch-test that will enforce it in CI.
     SPECIFIED ONLY at this refine — NOT written. RED-until-built is correct: src/commands/doctor.mjs
     and the engine do not exist yet, and the two bijection tests are not yet generalised; the new
     tests reference them and would fail until story 00 lands. WRITING a failing arch-test now would
     break CI and cross the doc-only line, so these are prose specs the build authors.
     STRUCTURAL invariants live HERE, never in a task .feature: the QA amigos keep task features to
     observable check BEHAVIOUR (e.g. "a lying-parent fixture ⇒ a `lying-parent` error finding"). -->

| Invariant | Enforced by (arch-test) | Target file | State now | From |
|---|---|---|---|---|
| **Doctor finding-envelope contract.** Every `work:doctor` finding is exactly `{ code, severity, path, message }`: `code` a non-empty string, `severity ∈ {"warn","error"}` (no other value — NO `ok`/`info`), `path` present, `message` present. `run` emits **raw absolute** paths (basis-neutral — assert each `finding.path` is absolute, NOT cwd-/projectRoot-relativised, NOT forward-slashed by `run` — the 08/ADR-002 keystone). | **NEW** `acd-doctor-finding-envelope.test.mjs` (import `getCommand("work:doctor")`, `invoke` it over a fixture stream that triggers ≥1 finding of each severity; assert every finding has exactly the four keys, `severity` is one of the two literals, and `path` is `path.isAbsolute(p)` and equals its on-disk OS form — no projection) | `test/arch/acd-doctor-finding-envelope.test.mjs` | RED until story 00 registers `work:doctor` with the envelope | ADR-001 |
| **Engine determinism.** Same fixture + same injected `now` ⇒ **byte-identical** `findings` (`JSON.stringify` equal across two runs); AND the engine source reads NO wall-clock — no `Date.now(`/`new Date(` in `src/commands/doctor.mjs` / the engine module (comments discounted per the house strip-comments discipline). Time enters only via the injected `now`/`staleWindow`. | **NEW** `acd-doctor-engine-determinism.test.mjs` (call `doctorWork(workDir, config, undefined, { now: FIXED, staleWindow: FIXED })` twice over the same fixture → assert `deepEqual` / byte-equal serialisation; source-grep the engine module → assert no `Date.now(`/`new Date(` call form) | `test/arch/acd-doctor-engine-determinism.test.mjs` | RED until story 00 lands the injectable-clock engine | ADR-003 |
| **Registry-derived bijection — route coverage.** The `/api/work/<op>` set served by `board-ui.mjs` is in BIJECTION with the registry's `work:*` commands: every served route maps to a registered `work:<op>` command, AND every registered `work:*` command has a served route. Derived from `listCommands()` (NOT hard-coded), so adding `work:doctor` (the 7th) — or any future `work:*` — is covered with no edit. | **GENERALISE** `acd-work-command-route-coverage.test.mjs` (replace the literal `EXPECTED_OPS` six with the `work:*`-prefixed set from `listCommands()`; assert the two-way map; loop the behavioural stand-up over the derived set incl. `/api/work/doctor`) | `test/arch/acd-work-command-route-coverage.test.mjs` | RED until story 00 wires `work:doctor`'s route + generalises this test (the test change ships WITH the wiring) | ADR-005, ADR-001 |
| **Registry-derived bijection — CLI injection.** Every registry `work:*` command has a non-null `cli` adapter AND a reachable `subcommand === "<sub>"` branch in `workCommand`, AND `aof work <sub> --json` runs cleanly + emits parseable JSON. Derived from `listCommands()` (NOT the hard-coded `SUBCOMMANDS`), so `work:doctor`/any future `work:*` is covered with no edit. | **GENERALISE** `acd-work-command-cli-bijection.test.mjs` (replace the literal `SUBCOMMANDS` with the `work:*`-derived set; add an `argsFor("doctor") = ["work","doctor","--json"]` read probe; accept `[0,1]` exit for `doctor` as for `validate`) | `test/arch/acd-work-command-cli-bijection.test.mjs` | RED until story 00 wires `aof work doctor`'s dispatch + generalises this test (ships WITH the wiring) | ADR-005, ADR-001 |
| **`--strict` exit policy.** Advisory by default; `--strict` gates — FACE-level, mirroring config doctor: (a) no findings → exit 0; (b) `warn`-only, no `--strict` → exit 0; (c) `warn`-only, `--strict` → exit non-zero; (d) any `error` finding → exit non-zero REGARDLESS of `--strict`. `run`'s `findings` are identical across all four (the gate is the face, not the run). | **NEW** `acd-doctor-strict-exit.test.mjs` (CLI spawn-and-parse `aof work doctor [--strict]` against four fixtures — clean / warn-only / warn-only+`--strict` / error-bearing — assert the exit code per the matrix, and that the `--json` `findings` set is unchanged by `--strict`) | `test/arch/acd-doctor-strict-exit.test.mjs` | RED until story 00 lands the CLI `--strict` exit logic | ADR-002 |

<!-- Arch-test vs behavioural task scenario (the QA-amigos boundary):
     - The ENVELOPE shape, the DETERMINISM/no-wall-clock guarantee, the registry-derived BIJECTION, and
       the --strict EXIT MATRIX are structural invariants over the command contract / engine source /
       registry / route+dispatch tables → arch-tests (this table). They are NOT task features.
     - The OBSERVABLE check BEHAVIOUR — "a done-milestone-with-in-progress-child fixture ⇒ a `lying-parent`
       error finding", "a done milestone with no RETROSPECTIVE.md ⇒ a `missing-retrospective` finding", "an
       updated-before-created fixture ⇒ `updated-before-created`", "a typo'd folder ⇒ `orphan-folder`" —
       is behaviour over the real seam and belongs in the stories' task .feature files (01/02), NOT here.
     - Per ADR-004: the structural-integrity behaviours (gap/duplicate/orphan) are CI-assertable today
       with NO ROADMAP shape; the roadmap-folder cross-reference is exercised only when a fixture supplies
       a STRUCTURED index, and is an honest no-op otherwise. -->
