# ACD — Port State & Next Steps

> Where the ACD build is, and what's left to lift it from the test-ground into this CLI.
> (This is a project-state doc for the *build effort* — the methodology canon is the rest of `wiki/`.)

## Status — 2026-06-14

**Methodology: designed + documented** (this wiki). Model locked:
`milestone > story > task`, **nested by scope**, folders `NN_type_slug`, **task-level Gherkin**,
frontmatter-as-record + a validator, status/recency, parallelism by story.

**Test-ground: proving it live** — `C:\Source\voice-vox\let-shield-portal`:
- `.aof/aof.config.json` — the `work` section (`dir`, `agents`, `tags`)
- `.claude/agents/aof-*` — 6 role agents (product-owner, researcher, architect, designer, developer, qa)
- `.claude/commands/aof/*` — 8 commands (`add-milestone/story/task`, `refine`, `continue`, `verify`, `validate`, `recent`), XML-segmented with `<progress_tracking>`
- `wiki/work/` — 33 items (14 milestones + 19 stories), validates clean
- **Observability** — `.claude/settings.json` hooks → `.aof/log-hook.mjs` → per-item `log.jsonl`

**This repo:** the `work` section is in `schemas/aof.schema.json`. Nothing else ported yet.

## The lift (next milestone)

Goal: turn the test-ground artifacts into **AOF source assets** so `aof assets apply` generates the
full ACD setup into any project, with the `aof-generated` markers, for both runtimes.

| # | Step | Maps to |
|---|---|---|
| 1 | **Agents → assets.** Add the 6 `aof-*` agents as `agent` resources. | `.aof/assets/agent/...` + `resources[]` |
| 2 | **Commands → assets.** Add the 8 commands as `command` resources; verify the renderer maps the `aof:` namespace to `.claude/commands/aof/<id>.md` (+ `.codex`). | `.aof/assets/command/...` |
| 3 | **Templates → package files.** Ship `wiki/templates/{milestone,story,task}` so commands can reference them in a generated project. | bundled files |
| 4 | **Observability → hooks.** Declare the 3 hooks + `log-hook.mjs` as a `hooks` entry + bundled script. | `aof.config.json hooks[]` |
| 5 | **`work` runtime.** Decide: add deterministic **`aof work` CLI subcommands** (add-milestone/story/task, recent) alongside the agent slash commands? CLI = scaffolding/CI; slash = agent runs. | `src/cli.mjs` |
| 6 | **Validator as a CLI command.** Promote `aof:validate` logic to **`aof work validate`** so the traceability spine is **CI-enforceable** (the keystone). | new `src/` module |
| 7 | **Methodology docs.** Decide how `wiki/` ships with the package (reference / `projectDocs`). | — |
| 8 | **Prove the round-trip.** `aof assets apply` into a fresh repo → run a milestone end-to-end → `log.jsonl` confirms the agent loop. | — |

## Open decisions

- Bundle as **one ACD package** (like `gsd`) vs. individual `resources`?
- **CLI vs slash-only** for `aof work ...`?
- **Codex parity** now, or claude-first then port?
- Where the methodology `wiki/` lives in the shipped package.

## Don't

- Don't stamp hand-authored source with `aof-generated: true` — that marker is for rendered output
  (the CLI adds it on `apply`).
