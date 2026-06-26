---
doc: verification
updated: 2026-06-25
---
<!--
  Milestone VERIFICATION.md — answers ONE question: is it truly done, and what is the evidence?
  Written at aof:verify. Only sections with content appear (absence is information — no empty "None").
  This milestone has NO @uat scenarios → no ## User sign-off section (no human was pestered).
  This milestone has NO UI surface → no design-conformance section (CLI/knowledge tooling only).
-->
# 13 · External Milestone Import — Verification

## Verification evidence

### Automated + fitness (always; no human)

- **`@executable` suite green** — `node scripts/test.mjs` → **1151 ok / 0 not-ok** (exit 0), re-run at
  verify 2026-06-23. _verifies →_ every `@executable` scenario across stories 00/01/02 task features:
  `import-core/00-03` (command + materialize + dry-run + source-untouched), `recovery/00-02`
  (aof-structured + arbitrary + the 2³ absence truth table), `import-mem/00-02` (indexer scan + recall +
  reindex trigger).
- **Fitness functions green (the load-bearing deliverable, story 03 / ADR-001…005)** — all six
  `test/arch/acd-import-*.test.mjs` enforce in the suite, each proven non-vacuous:
  - `acd-import-artifact-shape` (ADR-001) — the materialized `ARCHITECTURE.md`/`RETROSPECTIVE.md` parse with
    the EXISTING `parseArchitecture`/`parseRetrospective` into frozen `MemoryRecord`s; `SPEC.md` yields ZERO
    records (legible intent, never indexed); no import module defines/imports a parser.
  - `acd-import-read-only-source` (ADR-002) — `getCommand("import:milestone")` is the frozen `{id,input,run,cli}`;
    NO git WRITE verb is constructed against the source; NO shell-string spawn; the only git verbs are
    read-only (`ls-remote`/`log`/`status`/`rev-parse`/`fetch`).
  - `acd-import-indexer-extends-scan` (ADR-003) — a fixture import indexes into the ONE existing
    `.aof/aof.memory.index.json`; `buildRecords` COMPOSES the import-store scan; the import command never
    writes the index JSON directly.
  - `acd-import-no-graphify-spawn` (ADR-003) — no import module imports `../graphify.mjs` or spawns a
    graphify binary (its only child_process use is the read-only git probe).
  - `acd-import-not-a-work-item` (ADR-004) — `listItems`/`findWork`/`nextWork`/`validateWork` never
    enumerate the import as a managed item (positive exclusion vs a real milestone, even with a decoy
    `NN_..`-shaped source slug); the store is OUTSIDE `workDir`, non-`NN_type_slug`, git-ignored via the
    NESTED `.aof/imports/.gitignore` (never the repo-root `.gitignore`).
  - `acd-import-derived-index` (ADR-001/005) — every imported record's `source:line` resolves to live text
    in the import store; a SECOND import over the same fixture yields the IDENTICAL artifact + record set
    (clean one-time snapshot); the store is git-ignored.

### `@manual` lanes (agent-run, live network + live graphify binary 0.8.44 — no human)

The build deferred these as "needs external repo / network / live binary" (CI-bound). This host has live
network (`git ls-remote` reaches GitHub) and the provisioned graphify `0.8.44` (`aof project provision
graphify --json` → `status:"installed"`), so the agent-runnable rows were executed against a **real
external repo** (a local clone of `github.com/octocat/Spoon-Knife`, an arbitrary non-aof repo).

- **Recovery holds on a REAL arbitrary external repo** _(01/01 — @manual, "the heuristics hold on a real
  shape")_. Procedure: clone `Spoon-Knife` (read-only), `aof import milestone <clone> repo --json`. Result:
  PASS. The README overview recovered into `SPEC.md` intent ("…an example for *forking* a repository on
  GitHub"); the **3 real commit subjects** recovered into `RETROSPECTIVE.md` as `## R1`/`R2`/`R3` lessons,
  oldest-first; **no `ARCHITECTURE.md` was materialized** (the repo has no `docs/`/ADRs → no fabricated
  decisions — "absence is information" confirmed on a real shape). The folder is `spoon-knife/import-repo/`
  (not an `NN_type_slug` name) under `.aof/imports/`, git-ignored via the nested `.gitignore`.
  _verifies →_ 01/01 "given an arbitrary repo … recovery materializes what is present".
- **Import REACHES memory — imported precedent is recall-able** _(02/02 recall mechanism — the load-bearing
  win, agent-run on real data)_. Procedure: with `memory.backend=local`, the import's auto-`reindex` scanned
  the import store (recordCount 120-work-stream → 141 incl. the import); `aof work memory recall "forking a
  repository example index page collaborative edits guide" --json` returned the imported Spoon-Knife lessons
  **ranked first** (`source: spoon-knife/import-repo/RETROSPECTIVE.md:8` and `:16`) alongside work-stream ADR
  records, through the UNCHANGED `recall` verb. Result: PASS — import → materialize → reindex → recall closes
  the loop end-to-end on a real external repo. _verifies →_ 02/00–02 "reindex scans the import store … the
  imported precedent is recall-able through the unchanged verbs".
- **Source repo untouched after a real import** _(00/03 — @manual, local lane)_. Procedure: capture
  `git rev-parse HEAD` + `git status` of both real clones (`Spoon-Knife`, `Hello-World`) before/after import.
  Result: PASS — both byte-identical (0 changed files, identical HEAD); the import constructs only the
  read-only `git log` verb against the source. _verifies →_ 00/03 "the source repo's tree + git state are
  unchanged".

### `@manual` lanes deferred on this host (not a defect — and one scope-gap finding, F13-1)

- **Remote-URL import** _(00/02 dry-run + 00/03 real, live-remote rows)_ — exercised live and found
  **unimplemented**: `aof import milestone <remote-url> <selector>` (and `--dry-run`) returns code
  `remote-source-unsupported` (exit 1). Only the read-only `git ls-remote` boundary is wired (reachability
  confirmed against the real GitHub remote); the scratch-fetch + recovery over a fetched tree is a documented
  deferred seam (`src/import/source.mjs:86-89`, `STATE §Feedback`). The milestone's objective ("import an
  external repo's milestone as knowledge") IS delivered via the **local-path lane** (clone locally → import
  the path, proven above on a real external repo). Logged as **F13-1** (non-blocker, deferred).
- **graphify-backend recall** _(02/02 — @manual, graphify variant)_ — the graphify backend is installed and
  active (`aof work memory status` → `backend:"graphify"`, `graphState:"built"`, 120 records), and the
  import triggers its `reindex`. But the graphify `reindex` runs an LLM extraction pass (`extractionBackend:
  "claude-cli"`) over the full record set that **did not complete within a 10-minute window** on this host —
  environment-bound, not a logic defect. The recall MECHANISM that this row asserts is proven on real
  imported data via the `local` backend (above) + the `import-mem/01` `@executable` suite; only the
  graphify-specific re-rank is unexercised here. To be confirmed on a host where the graphify extraction pass
  completes in a practical window. This is the extraction backend's runtime cost functioning as designed,
  **not** a finding.

### Re-open 2026-06-25 — story 04 · import-digest (the deferred 13×14 follow-up; ADR-006/007)

The milestone was re-opened to take the intent-only-import digest gap. No new `@uat` and no UI surface
(CLI/knowledge tooling) — so still no human-acceptance or design-conformance lane. Story 04's `.feature`
is entirely `@executable`; the agent-run lane below exercises the REAL command path the `@executable`
tests deliberately skip.

- **`@executable` suite + all seven fitness functions green** — `node scripts/test.mjs` → **1247 ok / 0
  not-ok** (exit 0), re-run at verify 2026-06-25. The count grew from the 2026-06-23 baseline because
  milestones 15–17 are in flight in the working tree; every milestone-13 test is green within it. _verifies →_
  the six story-03 arch-tests (unchanged) + story 04: `test/import-digest.test.mjs` (6/6 — digest emitted
  for the zero-record case, sections index as `summary` records resolving in the store, recall-able through
  the unchanged verb, NO digest when adr/lesson records exist, no fabrication on absent intent, byte-identical
  re-import) and the seventh fitness arch-test `test/arch/acd-import-digest-recallable.test.mjs` (4 cases —
  intent-only `AOF.md` → frozen `summary` records, rich import emits none, indexed via the EXISTING `parseAof`
  with no new parser/shape, canonical identity+provenance frontmatter with `importedAt` off the record-bearing
  artifacts).
- **Intent-only import → recallable digest, through the REAL `import:milestone` command + recovery engine**
  _(story-04 dogfood proof, agent-run; ADR-006/007)_. Procedure: built an isolated local-backend project
  (empty work stream) + a pay-guard-shaped aof source milestone (`SPEC.md` with `## Goal` + `## Scope`, **no
  `ARCHITECTURE.md`/`RETROSPECTIVE.md`** → the zero-record case); ran `invoke("import:milestone", { repo, selector:
  "07", importedAt: "2026-06-25" })` (which runs the recovery engine + triggers the backend `reindex`), then
  `aof work memory recall` for an intent phrase. Result: **PASS** — the import materialized `SPEC.md` **+ an
  `AOF.md` digest** (`recordCount: 2`); the digest carried the canonical frontmatter with **recovered**
  `slug: paywall-guard` / `title` / `status: in-progress` (status mapped from the source SPEC frontmatter,
  never fabricated) + `importedAt: 2026-06-25`; `## Intent` ← the recovered `## Goal` prose and `## Scope` ←
  the recovered scope, verbatim; the sibling `SPEC.md` stayed timestamp-free (ADR-007). `recall` returned the
  **two imported `summary` records** (`source: …/import-07/AOF.md:15` and `:19`) through the UNCHANGED verb —
  the work stream was empty, so these were the *sole* recallable presence. This closes the gap end-to-end: the
  same import contributed **zero** records (invisible to recall) before story 04. _verifies →_ 04/00 "an
  intent-only import materializes an `AOF.md` digest … the imported intent becomes recall-able", through the
  real command + recovery path the `@executable` lane stubs with a fixed `recovered`.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|---|---|---|---|---|---|---|
| F13-1 | Remote-URL import is unimplemented: `aof import milestone <url> …` (and `--dry-run`) returns `remote-source-unsupported` (501). Only the read-only `git ls-remote` boundary is wired; the scratch-fetch + recovery over a fetched remote tree is a deferred seam. The CLI/ADR-002 surface advertises `<repo>` as "a path **or URL**", so a URL erroring is a minor honesty gap. | scope-gap / deferral | non-blocker | defer to backlog (the deferred "live sync / remote fetch" successor); meanwhile the local-path lane fully delivers the SPEC objective. Optionally narrow the CLI help to "local path in v0" until the seam lands. | backlog / future milestone | open (deferred) |
| F13-2 | The `02/01` off-topic-row feature wording still slightly over-claims for the lesson leg (PO note carried from build `§Feedback`); the assertion itself was hardened at review to key off a true zero-scoring import `adr`. Cosmetic test-prose only. | test-prose nit | non-blocker | defer to backlog | backlog | open |

Triage (PO, inline): both findings are **non-blocker** — neither breaks an accepted-scope behaviour. F13-1
is a refine-time **deferral** (ADR-002 tags the live remote fetch `@manual`; STATE/STORY carry the
scratch-fetch as a known seam), not a regression: the load-bearing "import an external repo's milestone as
recall-able knowledge" ships via the local-path lane, proven end-to-end on a real external repo above.
No blocker and no design-gap finding is open.

The **re-open (2026-06-25, story 04)** surfaced **no new finding**: the only dogfooding observation — the
digest's first-cut `doc: digest`-only frontmatter being too thin — was folded into the design as **ADR-007**
during the build (the canonical identity+provenance block), so it graduated to an ADR rather than a
verification gap. F13-1/F13-2 are unchanged by the re-open (story 04 touches neither the remote transport
leg nor the `02/01` test prose).

## Accept decision

**ACCEPTED — 2026-06-23.** The `@executable` suite (**1151/0**, exit 0) and all six story-03 fitness
functions are green; every agent-runnable `@manual` lane on this host passed — recovery holds on a **real
external arbitrary repo** (Spoon-Knife: README→intent, 3 real commits→lessons, no fabricated decisions),
the source repo is byte-untouched after a real import, and **import reaches memory** end-to-end (imported
precedent recalled first through the unchanged verb on real data); the two unexercised `@manual` slices are
either a documented non-blocker deferral (remote-URL transport, F13-1) or environment-bound (the graphify
extraction window), neither a defect; no `@uat` scenarios exist (no human gate); no blocker or design-gap
finding is open. The `aof:validate 13` gate PASSES (recorded below). All three production stories (00/01/02)
plus the fitness story (03) are accepted → **the milestone is accepted.**

**RE-ACCEPTED — 2026-06-25 (re-open, story 04 · import-digest).** The `@executable` suite + all **seven**
fitness functions are green (`node scripts/test.mjs` → **1247/0**, exit 0; the higher count vs the 1151
baseline is milestones 15–17 in flight, every milestone-13 test green within it). The story-04 agent-run
`@manual` dogfood proof PASSES through the **real** `import:milestone` command + recovery engine: an
intent-only source (pay-guard shape — `## Goal`+`## Scope`, no ARCHITECTURE/RETROSPECTIVE) materializes an
`AOF.md` digest with recovered identity+provenance frontmatter, and its two `## ` sections become
recall-able `summary` records through the unchanged verb — where the same import contributed **zero**
records before story 04. No new finding (the digest-frontmatter observation graduated to ADR-007 during the
build); F13-1/F13-2 unchanged and still non-blocker; no `@uat` and no UI surface (no human/design lane).
The `aof:validate 13` gate **PASSES** (`PASS — 13 is well-formed`; whole stream also PASS) and story-04
test-traceability is 1:1 (the feature's 6 scenarios ↔ `test/import-digest.test.mjs` `import-digest/00`–`05`).
Story **04 → done**; with **00/01/02/03** already done, **all stories are done → the milestone is
re-accepted (done).** Lessons distilled to RETROSPECTIVE **R8–R9**; `aof work memory ingest` run (no-op —
backend `none`).
