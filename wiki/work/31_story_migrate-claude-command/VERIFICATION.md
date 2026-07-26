---
doc: verification
updated: 2026-07-02
---
<!--
  Story VERIFICATION.md — answers ONE question: is story 31 truly done, and what is the evidence?
  Written at aof:verify 31. Only sections with content appear (absence is information).
  Standalone story (parent: null) → the record doc is this VERIFICATION.md, no milestone SPEC box to tick.
  NO @uat scenarios → no ## User sign-off section (no human was pestered).
  NO UI surface (a CLI command / bundle body) → no design-conformance section.
  NO findings against this story → no ## Findings section.
-->
# 31 · Migrate Claude Command — Verification

## Verification evidence

### Automated + fitness (always; no human)

- **`@executable` suite green** — `node scripts/test.mjs` → **1961 ok / 2 not-ok**, verify 2026-07-02. The
  two reds are out-of-scope (see below); every lane this story owns is green:
  - **Story-31's own 14 `migrate-cmd/*` tests all pass** — _verifies →_ every `@executable` row across
    `tasks/00` and `tasks/03`. `00`'s two body-content pins (`migrate-cmd/body:` — frontmatter
    description + argument-hint naming the source folder; `aof migrate $ARGUMENTS --json` runs FIRST via
    the shared offset-ordering `assertCliFirst` predicate; the --json hand-off resolves the produced item;
    the write-boundary + non-fabrication statements; the hardening pins for the @manual contracts) plus
    the self-test proving `assertCliFirst` FAILS on both mutants (invocation removed / inference lane
    hoisted before it). `03`'s distribution + matrix (`migrate-cmd/distribution:` + `migrate-cmd/matrix:`):
    the descriptor member (kind command, `commands/migrate.md`, claude runtime, `aof` namespace), the
    derived-manifest byte-for-byte regeneration (ADR-002), the `aof work update` landing (hash matches the
    shipped manifest entry), and the install-state × invocation matrix (never-inited refusal, init landing,
    idempotent skip, `--dry-run` pending render, ADR-005 drift preserved / `--force` restored).
- **Task 03 non-regression — the story-29 mechanical CLI is untouched** _(03/@executable)_. The
  `migrate-cmd/non-regression:` guard verifies by REGISTRY MEMBERSHIP (not source-grep) that the runner's
  assembled suite still registers every story-29 test + both fitness functions + this story's tests. And
  the suite bears it out live: **all 32 `migrate-core/00–03` tests pass, 0 not-ok**, and both story-29
  fitness functions are green — `arch/migrate-bijection` (3 cases: frozen `{id,input,run,cli}`; `cli.mjs`
  routes `migrate` → `migrateCommand` → `getCommand("migrate:folder")` → `invoke`; `aof migrate <fixture>
  --json` runs end-to-end) and `arch/migrate-read-only-source` (3 cases: no git write verb / no shell-string
  spawn against the source; every fs WRITE targets the work.dir scaffold; source byte-for-byte unchanged
  after a real migrate). The observable contract of `aof migrate` is unchanged — the inference lane added
  no inference to the CLI.

### `@manual` lanes (agent-run over fixtures — no human)

Executed as real command passes in **isolated scratch workspaces** (their own `.aof/aof.config.json` →
scratch `work.dir`, `agents.mode: orchestrated`), so the live work stream was untouched. The mechanical
CLI's `--json` result is real and drove each pass; the agent lanes were run per the authored body
`src/bundle/commands/migrate.md`; every result below was **independently re-checked by the orchestration**
(the record doc is verify-owned — evidence agents' writes are treated as untrusted).

- **task 00 — orchestration contract: CLI-first, write-boundary held, source byte-untouched, refusal ends
  the command, validate green after enrichment** _(00/@manual)_. **PASS.**
  - CLI-first + write boundary + source read-only + validate: over the **feynman-diagrams** exemplar
    (685 commits, no README) the mechanical CLI produced `00_milestone_repo` (`in-progress`,
    `findingCount:3`) FIRST; the inference lane then wrote to **exactly two files**, both inside the
    produced item's folder (`SPEC.md`, `STATE.md`) — a workspace-wide `find -mmin` confirmed nothing
    else was touched; `aof work validate 00 --json` → `[]` (exit 0) after enrichment; and the source
    repo is **byte-for-byte unchanged** — HEAD `1f5d898e…` identical before/after and `git status
    --porcelain` carries **zero** migrate/aof-caused entries (independently re-verified: no
    `wiki/work` / `SPEC.md` / `STATE.md` / `_milestone_` / `.aof` entry in the source).
  - Refusal terminality _(00/@manual matrix — the CLI's terminal outcomes end the command)_: an empty
    source (`F-empty`) is **refused** — `{ ok:false, code:"nothing-recoverable" }`, **exit 1** (re-run
    independently, deterministic) — the command surfaces the refusal and stops; **nothing** lands under
    `work.dir` (no agent pass runs). Inference never resurrects an empty source.
- **task 01 — the inference lane recovers the intent the mechanical scan honestly marked not recoverable**
  _(01/@manual)_. **PASS.** The exemplar is exactly the F29-1/F29-2 shape (PRD + `.planning/` +
  `research/ARCHITECTURE.md`, no README) whose mechanical floor was two `_Not recoverable from the source_`
  markers + a "source states no intent" gap finding.
  - **PRD recovers intent where the scan recovered none (F29-2)**: the produced SPEC's Objective/Scope
    now state the PRD's intent (Overview, Goals, Non-Goals → in/out scope), each grounded piece **naming
    its source document** (`docs/feynman-explorer-prd.md §1/§2.1/§2.2/§10`). Independently confirmed:
    **no `_Not recoverable_` marker remains** in the SPEC except the mechanical `## Stories` marker
    (`storyCount:0`, correctly left byte-intact — not an inference target).
  - **Planning-tree + by-name architecture surfaces as grounded content (F29-1)**: a new grounded
    `## Architecture` section carries the `.planning/PROJECT.md` "Context › Architecture"/"Key Decisions"
    substance and the `.planning/research/ARCHITECTURE.md` Kerr-integration invariants — correcting the
    gap-derived "no decisions/ADRs captured" impression.
  - **Every inference-written line traces to real source content**: the `aof-architect` fidelity judge
    (below) confirmed **no ungrounded / fabricated SPEC claim** — Objective/Scope/Architecture all trace
    to the PRD / PROJECT.md / ARCHITECTURE.md, with two source-*staleness* nuances (5-vs-6 crates; the
    trait-defaults framing) that are faithful reproductions of the source docs' own drift, NOT
    misrepresentations introduced by the lane.
  - **Recovered content is inviolable**: over `F-readme-prd` (a README the scan recovered + a PRD
    restating the same intent) the README-recovered Objective stands **byte-verbatim** after the lane
    (SPEC sha256 identical before/after; no rewrite from the PRD, no duplicate restatement).
  - **Honest absence survives inference**: over `F-bare` (code + commits, no docs) the lane finds no
    stated intent → the SPEC's Objective/Scope stay **byte-identical** to the CLI's `_Not recoverable_`
    markers, and the "inference ran and found nothing" note lands as an **appended line to STATE.md's
    migration preamble** (independently confirmed at STATE line 7, right after "Migrated from …", and
    **not** in the SPEC, **not** under `## Findings`) — the story's default placement decision, upheld.
- **task 02 — the architect reviews delivered work at migrate time, grounding developer-actionable
  findings** _(02/@manual)_. **PASS — verdict CONFORMS** (`aof-architect`, read-only ADR-001 hand-off).
  - Over the feynman-diagrams delivered work the three gap-derived `- [ ]` rows were **upgraded into
    grounded structural findings** (1:1, none duplicated): (1) ~22+ load-bearing decisions exist as
    unadopted prose not ADRs → extract into numbered ADRs; (2) a ~44k-TS/~5.7k-Rust, 685-commit codebase
    with dev tests (252 TS `it/test` + 202 Rust `#[test]` confirmed in-tree) but **no `@executable`
    contract** → `aof:refine` then wire the tests; (3) the "no intent" gap is **resolved** (intent
    recovered) and correctly upgraded into the real structural condition — the in-flight v5.0 Kerr work
    stopped mid-phase (`.planning/STATE.md` Phase 48.1 plan 4/5; a real `fix(46)…fix(48.1)` UAT/WASM-rebuild
    churn in the commit tail) with its ARCHITECTURE.md invariants unguarded. Each names WHAT/WHERE/what
    addressing entails — actionable at `aof:continue` without re-deriving the review.
  - **No fabricated finding**: the architect checked each against the delivered work (ADR-file scan,
    `git log` count, in-tree code paths `kerr.rs`/`spacetime-wasm/src/lib.rs`) and found every finding
    REAL — none recorded that the delivered work does not exhibit.
  - **No delivered work → no review lane**: over `F-not-started` (stated intent, zero recovered outcomes)
    the produced item is `not-started` and carries **no `## Findings` section** in SPEC or STATE
    (independently confirmed) — no review runs, nothing invented to look reviewed.

### Out-of-scope suite reds (NOT this story — recorded for honesty)

`node scripts/test.mjs` is not 100% green on this branch: **2 reds**, both
`arch/fleet-reclaim-guarded` (the config.mesh-gated fleet-reclaim / lease-release boundary). These belong
to the **in-flight milestone-26 distributed-runs-leasing work** co-mingled on this branch (its own STATE
docs + `mesh-lease.mjs` / `mesh-lease-tie.mjs` refactor were being modified live during this verify — an
earlier suite run briefly cascaded on a mid-refactor missing module, which resolved to these 2 on a clean
re-run). They have their own later verification and **do not trace to migrate/story-31** — every
`migrate-cmd/*`, `migrate-core/*`, and both migrate fitness functions are green within the same run. Not a
story-31 finding or blocker.

## Accept decision

**ACCEPTED — 2026-07-02.** All four task features are green. The `@executable` lanes pass — story-31's
**14 `migrate-cmd/*` tests** (the CLI-first body pins + the self-test mutants + the distribution/matrix) and,
per task 03's non-regression contract, the **32 `migrate-core/*` story-29 tests + both story-29 fitness
functions**, all untouched (the mechanical CLI grew no inference). Every agent-runnable `@manual` lane
**PASSED** and was independently re-verified: the command runs the CLI first and confines every write to the
produced item (source byte-untouched, validate `[]` after enrichment); the inference lane recovers PRD /
`.planning` / by-name-`ARCHITECTURE.md` intent that the mechanical scan marked not recoverable — **resolving
story-29's deferred F29-1/F29-2 live on the feynman-diagrams exemplar** — while holding recovered content
byte-verbatim and letting honest absence stand (the `F-bare` STATE-preamble note); the architect review at
migrate time upgraded the gap-derived findings into grounded, developer-actionable structural findings with
verdict **CONFORMS — no fabrication**; and the terminal outcomes (refusal, no-delivered-work) end the flow
without an agent pass or an invented findings section. The `aof work validate 31` gate **PASSES** (`PASS —
31 is well-formed`; whole stream also PASS); test-traceability is 1:1 over the `@executable` rows and the
litmus holds (inference-quality + architect-judgement correctly kept `@manual`). **No `@uat` scenario exists**
(no human gate); **no UI surface** (a bundle body — no design lane); **no finding is open** (no blocker, no
non-blocker defect, no design-gap — the two suite reds are out-of-scope milestone-26 fleet/lease work). A
standalone story → **status: done**; tasks 00–02 ticked (03 already green).
