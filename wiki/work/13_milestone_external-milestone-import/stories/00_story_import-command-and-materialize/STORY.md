---
type: story
number: 00
slug: import-command-and-materialize
title: "The import command + the frozen materialize contract — import:milestone, read-only source, the .aof/ store (the spine)"
parent: 13
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
schema: 1
aofVersion: 0.1.0
---
# 00 · The import command + the frozen materialize contract (the spine)

## User story

As an aof user who wants the ACD agents to learn from a milestone delivered outside this stream,
I want a registered `aof import milestone <repo> <selector>` command that reads the source **read-only**, materializes the recovered milestone as a **frozen pair** of legible `.md` artifacts in a dedicated `.aof/` import store (outside `workDir`, git-ignored, never an `NN_type_slug` work item), and supports `--dry-run`,
so that there is one safe seam that turns "a milestone in another repo" into re-derivable local knowledge — and the **materialize artifact shape + import-store layout are frozen** for the sibling stories (01 recovery, 02 indexing, 03 fitness) to fan out from without re-opening them.

<!-- This is the SPINE the milestone exists to make safe: it freezes the two contracts every other
     story builds against — the materialized artifact shape (ADR-001: a recovered SPEC.md + an
     ARCHITECTURE.md/RETROSPECTIVE.md-shaped knowledge artifact, reusing the 05 doc conventions so
     the EXISTING parsers index it) and the import-store layout (ADR-004: under `.aof/`, outside
     `workDir`, git-ignored, non-`NN_type_slug`). It owns the `import:milestone` registration + CLI
     face + `--dry-run` + the read-only source-access seam. It owns NO recovery heuristics (story 01
     — it materializes from a fixed/stubbed recovery input), NO indexer change (story 02), and NO
     arch-tests (story 03). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 13 --autonomous`): PO headline Scenarios +
     aof-qa Examples tables/tagging + aof-developer feasibility. Each task is one `.feature` under
     tasks/; done when its @executable feature is green (live-remote rows are @manual — they need a
     real external repo + network). -->

- [x] `tasks/00_command-registered-and-invokable.feature` — `import:milestone` is registered in the frozen Command core (`{id,input,run,cli}`), `aof import milestone <repo> <selector>` dispatches via `invoke`, and `--json` projects the result; an unknown sub-noun / missing args fail cleanly.
- [x] `tasks/01_materializes-frozen-artifact-pair.feature` — a recovered milestone materializes the frozen pair (`SPEC.md` legible intent + `ARCHITECTURE.md`/`RETROSPECTIVE.md`-shaped knowledge) in the `.aof/` import store, outside `workDir`, git-ignored, non-`NN_type_slug` names.
- [x] `tasks/02_dry-run-previews-without-writing.feature` — `--dry-run` previews the artifacts (and the records they would yield) and materializes / indexes / networks nothing.  _(@executable rows green; the `@manual` live-remote dry-run row is DEFERRED.)_
- [x] `tasks/03_source-repo-untouched.feature` — after an import (local path read in place, or remote fetched read-only), the source repo's tree + git state are byte-for-byte unchanged.  _(@executable local rows green; the `@manual` live-remote row is DEFERRED.)_

**Three-Amigos pass (`2026-06-22`, `aof:refine 13 --autonomous`):** PO headline Scenarios + aof-qa Examples
tables/tagging + aof-developer feasibility. **Developer verdict: BUILDABLE** — the `import` top-level
command slot is free in [src/cli.mjs](../../../../../src/cli.mjs), the frozen `{id,input,run,cli}` +
`invoke`/`getCommand` are exactly as ADR-002 claims, the `--json` adapter split is proven verbatim by
`graphVerbCommand`, and every `@executable` row is offline-feasible. **Build-time decisions to carry into
`aof:continue 13/00` (none re-opens a frozen contract):**
- **Injection-seam name** — add `resolveInjectedSource({ repo, resolveSource, AOF_IMPORT_* })` mirroring
  `resolveInjectedSha` ([src/planning-init.mjs](../../../../../src/planning-init.mjs)); a LOCAL `<repo>`
  reads in place (no network → the `@executable` lane), a remote uses the read-only `git ls-remote`/fetch
  argv-spawn; `--dry-run` never reaches the live leg.
- **Missing-`<selector>` default** (decided at the QA pass, recorded in `tasks/00`): a missing selector is
  NOT a usage error — exactly one recoverable milestone ⇒ import it (exit 0); ambiguous (>1) ⇒ non-zero
  asking which.
- **New harness helpers** — these features run as `node:test` suites (like `planning-init.test.mjs`), not
  the Gherkin runner: `makeGitFixtureRepo`, `treeStateOf` (HEAD + `git status --porcelain`),
  `parseJsonStdout`. Prefer a real temp git repo (`git` is already a CI dependency); QA's
  tree-enumeration is the documented fallback.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** the materialize pair reusing
05 doc shapes → existing parsers, no new parser/record shape; **ADR-002** `aof import milestone` as the
registered `import:milestone` command + the read-only `git`-argv-spawn idiom + `--dry-run`; **ADR-004**
the `.aof/` import store outside `workDir`, git-ignored via `src/aof-gitignore.mjs`, non-`NN_type_slug`;
**ADR-005** the materialized `.md` is the re-derivable source). This story **owns**: the
`import:milestone` Command registration in [src/command-core.mjs](../../../../../src/command-core.mjs)
(frozen `{id,input,run,cli}`) + the `aof import …` CLI dispatch in
[src/cli.mjs](../../../../../src/cli.mjs); the read-only source-access seam (reusing the
[src/planning-init.mjs](../../../../../src/planning-init.mjs) read-only `git`-argv-spawn + offline
injection idiom); `--dry-run`; the materialize writer (the artifact-pair shape + the `.aof/` import-store
layout) + its git-ignore via [src/aof-gitignore.mjs](../../../../../src/aof-gitignore.mjs). It **calls**
the recovery transform (story 01) behind a **stubbed/fixed materialize input** and triggers indexing
(story 02) — it does not implement either.

**Independent because** it consumes only already-frozen contracts — the Command core (`08/ADR-002`,
`command-core.invoke`), the 05 `MemoryRecord` doc-shape conventions (`05/ADR-005/007`), the read-only
fetch idiom (`src/planning-init.mjs`), the nested-`.gitignore` discipline (`src/aof-gitignore.mjs`) — and
produces the ONE frozen contract the siblings consume: the materialize artifact shape + the import-store
layout. It stubs recovery behind a fixed materialize signature and is fully testable with a hand-authored
fixture import, so 01 / 02 / 03 fan out from its frozen output without touching its internals. **It is the
critical path.**
