# GSD-era development archive

> Condensed record of how `aof` was built under GSD (Get Shit Done), preserved
> when the repo migrated to ACD on **2026-06-14**. The full `.planning/`
> directory (55 phases, per-phase plans/research/verification, milestone
> archives, codebase maps) was removed from the working tree and is recoverable
> from git history at tag **`gsd-planning-archive`**.
>
> Kept here: this digest plus [MILESTONES.md](MILESTONES.md) (per-milestone
> deliverables) and [RETROSPECTIVE.md](RETROSPECTIVE.md) (lessons + patterns).

## What aof is

A CLI that lets you define assistant assets (skills, commands, agents, rules,
workflows) **once** in `.aof/aof.config.json` and render correct Claude Code and
Codex files from them — no hand-maintaining per-assistant folders. `.aof/` is the
source of truth; `.claude/` and `.codex/` are generated and lock-protected.

## Milestone timeline

| Milestone | Shipped | Phases | Theme |
|-----------|---------|--------|-------|
| v1 — Assistant Configuration Foundation | 2026-05-07 | 1–5 | `.aof/` source-of-truth; Claude/Codex render adapters; dry-run/drift/lock; setup UI config editor |
| v1.1 — Aligned Core Hardening | 2026-05-08 | 6–10 | CLI lifecycle (sync/validate/doctor/clean); DSL primitives (mcp/hooks/docs/settings); adapter degradation policy; package semantics; split-domain BDD |
| v1.2 — Global Asset Library | 2026-05-09 | 11–15 | `~/.aof` global assets; project `globalRefs` (reference, not copy); code-bearing associated files; Project/Global setup UI |
| v1.3 — Interactive CLI Hardening | 2026-05-09 | 16–17 | Removed SQLite catalog + seeded repo defaults (empty `.aof` on init); `@inquirer/prompts` interactive `add` |
| v1.4 — Namespaced CLI Contract | 2026-05-11 | 18–22 | Full CLI rewrite into namespaces: `aof assets/packages/project ...`; `aof init` stays top-level; no legacy aliases |
| v1.5 — Runtime Semantics & Workflow Assets | 2026-05-14 | 23–27 | Claude-only commands (Codex command targets rejected); workflow-backed assets; `{{skills.*}}`/`{{workflows.*}}` placeholders |
| v1.6 — Task Management (boards) | 2026-05-15 | 28–32 | `aof boards` kanban + GSD-backed milestone/phase sync + agent execution + boards UI — **removed in the ACD migration** |
| v1.7 — Typed GSD SDK Backend | 2026-05-17 | 33–38 | Single typed `@gsd-build/sdk` adapter; typed milestone binding; BoardBackend seam; SDK fixtures/contract tests — **removed in the ACD migration** |
| v1.8 — AOF Boards Dogfood UAT | (in progress) | 39–41+ | Dogfooding `aof boards` on aof itself; boards UI — **superseded by the ACD migration** |

## Durable architectural decisions (still true post-migration)

- **`.aof/` is canonical; runtimes are generated.** Apply and dry-run share one
  action-plan analysis before any side effect. Generated `.claude`/`.codex` files
  are lock-owned and drift-protected, never source.
- **Runtime overrides** merge only allowed metadata/body fields and **cannot
  change resource identity** (kind/id).
- **Capability model** is central: e.g. Claude renders command assets, Codex
  command targets are rejected with diagnostics — differences never leak into ad
  hoc adapter/UI branches.
- **Global assets** are referenced via `globalRefs` (`{kind,id}`), not copied;
  source scope is recorded in lock state.
- **Setup UI writes valid config only; the CLI owns execution.**
- **Packages** (`aof packages ...`) record managed framework intent and install
  behind an explicit network/package-code boundary; install never runs during
  `aof assets apply`.

## Key lessons (see RETROSPECTIVE.md for the full set)

1. Commit shipped code **before** tagging a milestone — otherwise the tag points
   at docs without code.
2. Keep closeout labels tied to **product** blockers; missing optional process
   artifacts are process notes, not tech debt.
3. Central runtime/resource metadata pays off across validation, rendering, setup
   UI, and tests.

## Recurring deferred / future scope (across milestones)

Hosted asset/package registry & discovery; cross-machine `~/.aof` sync; semantic
version pinning + upgrade flows for references; runtimes beyond Claude/Codex;
UI-driven execution (init/apply/install); Rust/native core. (Boards, GSD SDK
streaming, and global task sync were the v1.6–v1.8 frontier — now retired by the
move to ACD.)
