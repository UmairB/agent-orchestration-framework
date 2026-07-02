---
doc: verification
updated: 2026-06-30
---
<!--
  Story VERIFICATION.md — answers ONE question: is story 29 truly done, and what is the evidence?
  Written at aof:verify 29. Only sections with content appear (absence is information).
  Standalone story (parent: null) → the record doc is this VERIFICATION.md, no milestone SPEC box to tick.
  NO @uat scenarios → no ## User sign-off section (no human was pestered).
  NO UI surface (a CLI command) → no design-conformance section.
-->
# 29 · Migrate Command — Verification

## Verification evidence

### Automated + fitness (always; no human)

- **`@executable` suite green** — `node scripts/test.mjs` → the **38 migrate tests all ok / 0 not-ok**
  (32 `migrate-core/00–03` rows + 6 fitness-function cases), verify 2026-06-30. _verifies →_ every
  `@executable` scenario/outline across the four task features: `migrate-core/00` (command shape +
  managed-item creation + `work find`/`work validate` resolution + intent→SPEC + substructure→stories/tasks
  + next-free-slot + `--dry-run` + missing-arg + the invocation-shape & `--json` matrices + the
  adversarial-title YAML-safety fix), `migrate-core/01` (managed-not-digest, nothing under `.aof/imports/`,
  visible to `work list`/`work next`, import stays a co-located digest, the divergence + non-interference
  matrices), `migrate-core/02` (delivered→non-not-started status, developer-actionable findings, no-delivery→
  clean not-started, the delivery-axis matrix, the `done`-marker clamp guard), `migrate-core/03`
  (non-aof / no-reshape / thin / empty-refusal / source-untouched + the source-shape matrix + the
  blocked-destination rollback boundary & structural guard).
- **Fitness functions green (the load-bearing story arch-tests)** — both enforce in the suite:
  - `acd-migrate-command-cli-bijection` (3 cases) — every registered `migrate:*` command is the frozen
    `{id,input,run,cli}` with a callable adapter; `cli.mjs` routes the top-level `migrate` verb to
    `migrateCommand` → `getCommand("migrate:folder")` → `invoke`; `aof migrate <fixture> --json` runs
    end-to-end emitting parseable JSON naming the produced milestone.
  - `acd-migrate-read-only-source` (3 cases) — `migrate-folder.mjs` constructs **no git write verb** and
    **no shell-string/exec spawn** against the source; **every fs WRITE targets the work.dir scaffold,
    never the sourceDir**; after a real migrate the source tree is byte-for-byte unchanged.

### `@manual` lanes (agent-run over REAL-WORLD folders — no human)

The build deferred two `@manual` rows as "agent-judgement / needs a real external folder". Both were
executed against **two real arbitrary repos on this host** (not test fixtures), migrated into an isolated
scratch workspace so the live work stream was untouched:

- **task 03 — real-world arbitrary folder → legible, non-fabricated managed item** _(03/@manual)_.
  Procedure: `aof migrate <folder>` over **`cool-widgets`** (README + 6 git commits + HTML/CSS/JS) and
  **`feynman-diagrams`** (Rust repo, docs/ + PRD + roadmap, 686 commits, **no README**). Result: **PASS**.
  `cool-widgets` → `in-progress`, SPEC objective = the README overview **verbatim**, `## Delivered` = the
  6 real commit subjects, "no distinct stories recovered" (honest absence, not invented).
  `feynman-diagrams` → `in-progress`, SPEC objective/scope = honest **"_Not recoverable from the source_"**
  markers (no README to recover intent from — absence recorded, never fabricated), `## Delivered` = the real
  commit subjects. Both produced milestones **pass `aof work validate`** (`PASS — work stream is
  well-formed`); the `feynman-diagrams` source repo is **byte-for-byte unchanged** (HEAD identical, `git
  status --porcelain` 0 lines) — read-only proven live on a 686-commit repo, beyond the fixture-based
  arch-test. _verifies →_ 03/@manual "the produced SPEC/stories/tasks are legible and grounded … no
  objective/story/task the real source did not warrant".
- **task 02 — the architect's findings are real structural issues, none fabricated** _(02/@manual)_.
  Procedure: `aof-designer`/`aof-architect` read-only judgement (ADR-001 hand-off) over the two produced
  STATE.md `## Findings` sections against the real source content. Verdict: **CONFORMS**. Per finding —
  `cool-widgets`: "no decisions/ADRs captured" **REAL** (zero ADR dirs/files), "no aof tasks/feature
  scenarios" **REAL** (no `wiki/work`, no `.feature`), intent-finding correctly **suppressed** (README
  present). `feynman-diagrams`: "no ADRs captured" **REAL** (no conventional ADR location), "no aof tasks"
  **REAL**, "source states no intent" **REAL/defensible-honest** (genuinely no README → intent recovers
  null). No finding was recorded that the delivered work does not exhibit. _verifies →_ 02/@manual "the
  recorded findings each trace to a real gap … no finding the delivered work does not actually exhibit".

### Out-of-scope suite reds (NOT migrate — recorded for honesty)

`node scripts/test.mjs` is **not** 100% green on this branch: **2 unit failures**,
`mesh-identity-status-commands/01` and `mesh-identity-cli-face/02` (both "node carries capabilities").
These belong to the **in-flight milestone-23 mesh work** co-mingled on `feat/run-lifecycle-and-mesh-
foundation` (the heartbeat/presence story), have their own later verification, and **do not trace to
migrate** — every migrate `@executable` row and both story arch-tests are green within the same run. Not a
story-29 finding or blocker.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|---|---|---|---|---|---|---|
| F29-1 | The shared recovery engine migrate reuses (`recoverArbitraryDecisions` / `collectDecisionFiles`, `src/import/recovery.mjs`) scans `docs/adr[s]`, `docs/decisions`, `decisions/`, `adr/` and `*adr*`/`*decision*`-named markdown but misses `.planning/**` and a plain `ARCHITECTURE.md`-by-name. `feynman-diagrams` carries real architecture prose at `.planning/research/ARCHITECTURE.md` yet recovered 0 decisions → its "no decisions/ADRs captured" finding is honest but coarser than ideal. | recovery-coverage gap | non-blocker | defer to backlog (a recovery-engine refinement; migrate inherits import's recovery). Contract still holds — task 03 requires absent signals be *marked* not recoverable, never invented, which they are. | backlog / shared recovery engine | open (deferred) |
| F29-2 | `recoverArbitraryIntent` (`src/import/recovery.mjs`) recovers intent **only** from a README. A repo with a PRD (`docs/feynman-explorer-prd.md`) + `.planning/PROJECT.md` but no README recovers `intent=null` → the SPEC objective is the honest "_Not recoverable_" marker. A PRD-as-intent fallback would recover genuine intent. | recovery-coverage gap | non-blocker | defer to backlog (recovery-engine enhancement). Honest absence today, not fabrication. | backlog / shared recovery engine | open (deferred) |

Triage (PO, inline): both findings are **non-blocker** — neither breaks an accepted-scope behaviour. They
are coverage *enhancements* of the shared import/recovery engine (which migrate reuses by design), surfaced
by exercising migrate on real README-less / `.planning`-shaped sources; the migrate contract's rule — "what
is present is recovered, what is absent is marked not recoverable, never invented" (task 03) — **holds** in
both cases (the architect confirmed no fabricated finding). The known cosmetic deferral (arbitrary-source
slug = `repo`, observed live as `00_milestone_repo`/`01_milestone_repo`) is already a documented STORY.md
follow-up, not a new finding. **No blocker and no design-gap finding is open.**

## Accept decision

**ACCEPTED — 2026-06-30.** All four task features are green: the `@executable` suite (**38/38 migrate
tests**, 0 not-ok within `node scripts/test.mjs`) and both story fitness functions
(`acd-migrate-command-cli-bijection`, `acd-migrate-read-only-source`) pass; every agent-runnable `@manual`
lane PASSED on **two real external arbitrary repos** — migrate produces a legible, fully-grounded managed
milestone (README→objective verbatim, real commits→`## Delivered`, absent intent honestly marked
not-recoverable), the produced items pass `aof work validate`, the real source repo is byte-untouched, and
the architect judged every recorded finding **REAL / non-fabricated (CONFORMS)**. The `aof work validate 29`
gate **PASSES** (`PASS — 29 is well-formed`; whole stream also PASS) and test-traceability is 1:1
(`migrate-core/00–03` ↔ the four task features' `@executable` rows). No `@uat` scenarios exist (no human
gate); no UI surface (no design lane); two non-blocker recovery-coverage findings (F29-1/F29-2) are deferred
to backlog; the 2 suite reds are out-of-scope mesh work, not migrate. A standalone story → **status: done**.
The 2 unrelated mesh failures stay with the in-flight milestone-23 mesh work for its own verification.
