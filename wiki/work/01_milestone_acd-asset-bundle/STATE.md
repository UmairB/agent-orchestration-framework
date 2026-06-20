---
doc: state
---
# 01 · ACD Asset Bundle + work init/update — State

**Closed 2026-06-17** (`aof:verify 01`) — accepted. Compacted at close: the durable decisions have
graduated to ADRs ([ARCHITECTURE.md](ARCHITECTURE.md) ADR-001…007); the process lessons have graduated
to [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R4); the verification record lives in
[VERIFICATION.md](VERIFICATION.md). The blow-by-blow refine/build narrative has been archived; only the
closure record and carried follow-ups remain below.

## Outcome

All three independent stories built, verified, and accepted:

- [x] `00_story_acd-bundle-resources` — built-in content-addressed bundle (`src/bundle/`) + descriptor
  + loader + manifest. (`status: done`)
- [x] `01_story_work-init` — `aof work init` → `src/work-init.mjs`. (`status: done`)
- [x] `02_story_work-update` — `aof work update` → `src/work-update.mjs`, shared
  `src/work-bundle-synthesis.mjs`. (`status: done`)

Verification: `@executable` only — 12 task features green, 9 fitness functions green; zero
`@manual`/`@uat`. Gate `aof:validate 01` → PASS. See [VERIFICATION.md](VERIFICATION.md).

## Carried follow-ups

Open items deliberately deferred past this milestone (not lessons — see RETROSPECTIVE.md for those):

- **Renderer field-fidelity (decision owed).** The shared command renderer drops `argument-hint` /
  `allowed-tools` from bundle commands (RETROSPECTIVE R4). If consumer-installed commands must preserve
  them, extend `renderResource` (`src/adapters.mjs`) — a milestone-level decision touching `apply` too.
- **Codex manifest scope.** The shipped `manifest.json` catalogues the `claude` render only (ADR-006).
  If it should ever enumerate codex too, `src/work-bundle-manifest.mjs` takes a `runtimes` option;
  follow-on decision.
- **Deferred polish nits (backlog).** No-op `aof work update` rewrites the work manifest with a fresh
  `generatedAt` (benign VCS churn); `init --force` reports content-identical files as "kept" (cosmetic
  wording). Neither violates a feature; left for a future polish pass.
