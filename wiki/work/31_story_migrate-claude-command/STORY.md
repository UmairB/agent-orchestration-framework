---
type: story
number: 31
slug: migrate-claude-command
title: "Migrate Claude Command — an inference lane over the mechanical migrate CLI"
status: done
owner: product-owner
created: 2026-07-02
updated: 2026-07-02
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A standalone story (no parent) is self-contained.
-->
# 31 · Migrate Claude Command — an inference lane over the mechanical migrate CLI

## User story

As a developer adopting aof on a codebase whose intent lives outside a README — a PRD, a
`.planning/` tree, an `ARCHITECTURE.md` the mechanical scan cannot read as such,
I want an `/aof:migrate` claude command that wraps `aof migrate`: the CLI does everything
mechanical (read-only recovery, scaffold, slot allocation, gap-derived findings, validation)
and the agent lane then recovers by inference what the scan honestly marked "Not recoverable"
— grounding intent from PRD/planning docs and running the architect's review of delivered
work at migrate time,
so that a migrated item starts life with a real objective and real structural findings instead
of honest-but-thin absence markers a developer must backfill by hand — without ever growing
inference into the CLI itself or fabricating what the source never stated.

<!--
  The division of labour is the load-bearing contrast (the story-29 lesson, one layer up):
    - `aof migrate` (CLI)   → the MECHANICAL FLOOR. Deterministic, offline, CI-testable.
                              Recovers what pattern-matching can recover; marks the rest
                              "Not recoverable"; derives findings from recovery-signal gaps.
                              This story adds NO inference to it.
    - `/aof:migrate` (cmd)  → the INFERENCE CEILING. Runs the CLI first, then agent passes:
                              recover intent the scan missed (F29-1/F29-2 territory), have
                              aof-architect review the delivered work and upgrade gap-derived
                              findings into grounded structural findings, enrich the thin
                              scaffold (SPEC objective/scope, story + task breakdown).
  The CLI's honest-absence markers ARE the hand-off contract: "_Not recoverable_" is exactly
  the seam the agent lane fills. Everything the agent writes must trace to real source content
  (the story-29 non-fabrication rule survives into this lane); if even inference finds nothing,
  honest absence stands. The agent writes only through the produced managed item under
  work.dir — the source folder stays byte-untouched (same read-only source rule as the CLI).
-->

## Tasks

<!-- Authored by `aof:refine 31 --autonomous` (Three Amigos): each task is a tasks/NN_<slug>.feature
     whose scenarios are its acceptance criteria. Tick a box when its lanes are green (03 is the
     @executable task; 00–02 verify chiefly through agent-run @manual lanes, story-29 style). -->

- [x] [00 — command body + CLI-first hand-off](tasks/00_command-body-cli-first-handoff.feature)
      (the orchestration contract: the body runs `aof migrate` first, consumes its `--json` hand-off,
      confines writes to the produced item, respects the CLI's refusal; source byte-untouched)
- [x] [01 — inference recovers unrecoverable intent](tasks/01_inference-recovers-unrecoverable-intent.feature)
      (F29-1/F29-2 territory: PRD / `.planning/**` / ARCHITECTURE.md-by-name grounded into the produced
      SPEC; every line traces to real source content; honest absence survives inference)
- [x] [02 — architect review at migrate time](tasks/02_architect-review-at-migrate-time.feature)
      (delivered work reviewed within the command flow per `work.agents.mode`; gap-derived findings
      upgraded into grounded, developer-actionable findings; none fabricated)
- [x] [03 — bundle distribution + non-regression](tasks/03_bundle-distribution-and-nonregression.feature)
      (bundle member + derived manifest (ADR-002) + `aof work update` render; story-29 suite and both
      fitness functions stay green — the mechanical CLI's contract untouched)

## Notes

- Follow-up to `29_story_migrate-command`. Its VERIFICATION.md findings are the direct
  motivation: **F29-1** (recovery scans ADR-style dirs but misses `.planning/**` and a plain
  `ARCHITECTURE.md`-by-name) and **F29-2** (`recoverArbitraryIntent` reads only a README —
  a PRD recovers `intent=null`). Both were deferred as recovery-engine backlog; this story
  covers them via the inference lane instead. Whether the mechanical engine ALSO grows those
  scans later stays a separate backlog decision — not this story's scope.
- Story 29 pinned the architect review as an `@manual` verification lane that runs AFTER
  migrate. Here it moves into the command's flow: `/aof:migrate` orchestrates the review at
  migrate time (per `work.agents.mode`), so the findings a developer picks up at
  `aof:continue` are architect-grounded, not only gap-derived.
- Distribution: the command is a new bundle body (`src/bundle/commands/migrate.md` → rendered
  `.claude/commands/aof/migrate.md`), so the bundle manifest must be regenerated (ADR-002:
  manifest is derived, never hand-maintained) and lands in installs via `aof work update`.
- Non-goals: no new CLI verbs, no change to `aof migrate`'s observable contract (story 29's
  features keep passing untouched), no source mutation, no `import` changes.

### Default decisions taken at `aof:refine 31 --autonomous` (documented, revisable at build)

- **Honest-absence is recorded in the produced STATE.md, never the SPEC or `## Findings`.** File 01's
  "inference ran and found nothing" note lands as an appended line to STATE.md's migration preamble.
  Rationale (developer feasibility): validate doesn't inspect STATE.md content; the SPEC stays
  byte-comparable to the CLI's markers (which file 01's bare-code row pins); and a `## Findings` entry
  would collide with file 02's "no findings section invented to look reviewed". The command body must
  state this placement explicitly.
- **Mode-invariance (file 02, block 2) is semantic set-equality**, never byte-equality — two agent
  passes word findings differently; the evidence procedure compares the finding sets (same issues,
  same grounding, none duplicated/fabricated) across fresh workspaces. Noted in the matrix comment.
- **Fixture precondition for every no-README shape**: carry commit history (recovered outcomes) so the
  CLI scaffolds and hands off rather than refusing — otherwise task 00's own terminality axis ends
  the command before any lane runs. Noted in files 00/01.

### Developer feasibility notes (carried from the Three Amigos — for `aof:continue 31`)

All four features **BUILDABLE** (none blocked). The contract rides on existing machinery; the body +
distribution are the only new assets:

- **File 00's `@executable` content pins** follow the proven idiom of
  `test/arch/acd-doctor-validate-keystone.test.mjs` (grep-able marker facts + character-offset
  ordering over a command body); co-design the body around deliberate stable marker phrases. Assert
  the *authored* `src/bundle/commands/migrate.md` (the renderer injects `aof-invocation:` into the
  render — already covered by the derived arch-test). Frontmatter mirrors `continue.md`
  (`description:` + `argument-hint: <source folder>`).
- **The `--json` hand-off is real**: `migrateCommand` (src/cli.mjs) emits
  `{milestoneRef, dir, status, …, findingCount}` (dir cwd-relativised) and an `{ok:false, error, code}`
  envelope + exit 1 on refusal (`nothing-recoverable`, 422) / source-read error; `--dry-run` previews.
  All terminality rows are directly observable. The body must state flags pass through to the CLI and
  a dry-run ends the flow after the preview.
- **File 01, PRD row**: the CLI writes TWO markers (objective and scope) — the PRD fixture must state
  both intent and in/out scope or the scope marker honestly remains (row amended accordingly).
- **File 02's mechanical floor is as assumed**: gap-derived findings are `- [ ]` rows in STATE.md
  `## Findings` via `detectGaps`/`renderState`; no delivered work → no section at all (pinned by
  `test/migrate-command-core.test.mjs`). The fully-delivered-clean row needs the story's most
  elaborate fixture (intent + decisions + tasks + outcomes all present → `findingCount: 0`).
  `work.agents.mode` literals `"orchestrated"`/`"solo"` are real (`src/config-inspect.mjs`); nothing
  enforces the enum, so the body states its default branch (anything ≠ `"solo"` → orchestrated),
  matching continue.md's idiom.
- **File 03 rows map 1:1 onto proven test seams**: `bundleOverride` added-member precedent
  (`test/work-update.test.mjs` `fixture-added-member`), never-inited `notInitialized` refusal,
  idempotent `skip`, dry-run action list, and the ADR-005 no-clobber section (drift preserved
  without `--force`, restored with it). `test/work-init.test.mjs` iterates the descriptor, so
  migrate is auto-covered there.
- **Tests/constants the build must update** (membership pins, by design): `test/bundle.test.mjs`
  `COMMAND_IDS` + the literal `14` count/name strings → 15; `test/arch/acd-command-namespace.test.mjs`
  count 14 → 15; regenerate `src/bundle/manifest.json` in the SAME commit
  (`acd-bundle-manifest-hashes` fails otherwise, and `acd-bundle-membership` forces body + descriptor
  to land atomically); wire any new test file into `scripts/test.mjs` (a hand-maintained registry —
  unimported tests silently never run). Cosmetic: the "all 34 members" comment in
  `src/work-bundle-synthesis.mjs`.
- **New assets**: `src/bundle/commands/migrate.md` (the deliverable), the `bundle.json` member entry,
  the regenerated manifest, and new test file(s) for file 00's content pins + file 03's matrix
  (e.g. `test/migrate-claude-command.test.mjs`).
