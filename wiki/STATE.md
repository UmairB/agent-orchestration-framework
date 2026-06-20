# ACD — Port State & Next Steps

> Where the ACD build is, and what's left to lift it from the test-ground into this CLI.
> (Project-state doc for the *build effort* — the methodology canon is the rest of `wiki/`.)

## Status — 2026-06-14

**GSD removed from this repo (the migration).** Done on branch `migrate/gsd-to-acd`:
- **Layer B — boards/GSD-SDK product feature:** deleted (`src/boards*`, `gsd-sdk-adapter`,
  `gsd-runtime-fallback`, `backends/`, `internal-skills`; the `aof boards` CLI tree;
  `/api/boards/*`; the boards UI + `kanban.tsx`; `@gsd-build/sdk`; board tests/fixtures/scripts).
  `npm run check` green (207 ok); PowerShell parity green (87 ok).
- **Layer A — GSD planning methodology:** `.planning/` distilled into [`gsd-archive/`](gsd-archive/)
  (SUMMARY + MILESTONES + RETROSPECTIVE), then deleted. Full history at tag `gsd-planning-archive`.
  `gsd` package removed from `.aof/aof.config.json` + lock.
- **Kept (deliberately):** the generic `aof packages` namespace (its only package was gsd) — see Open decisions.
- **Left for the user:** delete the generated gsd dev tooling under `.claude/` and `.codex/`
  (`gsd-*` agents, `commands/gsd/`, `get-shit-done/`, manifests).

**Methodology: designed + documented** (this wiki). Model locked: `milestone > story > task`,
nested by scope, folders `NN_type_slug`, task-level Gherkin, frontmatter-as-record + validator,
status/recency, parallelism by story.

**Test-ground: still proving it live** — `C:\Source\voice-vox\let-shield-portal`. The user is
**evaluating command effectiveness there**; the ACD agent/command **content is not final**, so the
port into aof is intentionally deferred (see below).

**This repo:** the `work` schema section is in `schemas/aof.schema.json`. Nothing else ported yet.

## Distribution — LOCKED decision (2026-06-14)

**ACD ships bundled inside the `aof` CLI** (not as a separate package, not vendored source).

- ACD agents/commands/templates/observability-hook live as **bundled assets in the aof npm package**.
- An **`aof work init`** command renders them into a target repo's `.claude`/`.codex`, stamped
  `aof-generated: true` and tracked in a **manifest** (same idea as the old `gsd-file-manifest.json`).
- **Issuing updates / bugfixes:** publish a new aof version → user runs **`aof work update`** →
  the manifest diff re-renders only changed files cleanly (no hand-merge). This is the answer to
  "how do we issue updates when we bugfix commands/agents."
- Reuses the existing render-plan / lock / drift-protection / `aof-generated` machinery.

## The lift (deferred — do when let-shield content stabilizes)

| # | Step | Notes |
|---|---|---|
| 1 | **Bundle ACD assets** in aof (e.g. `assets/acd/{agents,commands,templates,hooks}/`). | content snapshot from let-shield — defer until stable |
| 2 | **`aof work init`** — render bundled ACD into `.claude`/`.codex` + write manifest + stamp. | new renderer; reuse render-plan |
| 3 | **`aof work update`** — manifest-diff re-render for bugfix propagation. | the update mechanism |
| 4 | **`aof work validate`** — promote the `aof:validate` traceability-spine logic to a CLI command (the keystone: every `@executable` scenario → green test, CI-enforceable). | methodology-stable; could be built ahead of content |
| 5 | **`aof work` scaffolding** — add-milestone/story/task, recent (deterministic CLI alongside the agent slash-commands). | |
| 6 | **Observability hook** — ship the session-keyed `aof-hook.mjs` + `.claude/settings.json` wiring as a bundled hook. | proven in let-shield |
| 7 | **Prove the round-trip** — `aof work init` into a fresh repo → run a milestone end-to-end → `log.jsonl` confirms the agent loop. | |

## Open decisions

- **`aof packages` namespace fate.** Its only consumer was gsd; the bundled-ACD model doesn't use it.
  Keep as generic framework-installer infra, or remove it (+ `frameworks.mjs`, `packages.mjs`, schema
  `packages`, tests)? Decide when resuming the ACD build.
- **Codex parity** for ACD now, or claude-first then port?
- Where the methodology `wiki/` ships in the package (reference / `projectDocs`).

## Minor gsd remnants (cosmetic, non-blocking)

- `{{GSD_ARGS}}` kept as one token in the simple-asset argument-marker detection
  (`config-editor.mjs`, `config-inspect.mjs`) — a generic robustness heuristic, not gsd functionality.

## Don't

- Don't stamp hand-authored source with `aof-generated: true` — that marker is for rendered output
  (the CLI adds it on `apply`/`work init`).
