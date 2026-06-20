---
type: story
number: 01
slug: headroom-toggle-cli
title: "Headroom toggle CLI — use-headroom / unuse-headroom / init --with-headroom"
parent: 06
status: done
owner: product-owner
created: 2026-06-20
updated: 2026-06-20
---
# 01 · Headroom toggle CLI — `use-headroom` / `unuse-headroom` / `init --with-headroom`

## User story

As a developer who wants long agent sessions on the work board to cost fewer tokens,
I want `aof work use-headroom` / `aof work unuse-headroom` to flip the plugin on or off on an existing repo, and `aof work init --with-headroom` to opt in on a fresh install — each writing only my config and telling me (not silently) when the `headroom` binary isn't installed,
so that turning the plugin on or off is a one-command, reversible, config-only act that never installs anything behind my back and never disturbs my install lock.

<!-- This is the opt-in SURFACE. It makes the plugin real to a developer without touching the runtime
     seam: it writes the work.headroom block the resolver later reads. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 06/01`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] `tasks/00_use-headroom-writes-config.feature` — `aof work use-headroom` sets `work.headroom = {enabled:true, mode:"wrap", providers}` in `aof.config.json`, preserving every other config key; the lock is never touched (ADR-004)
- [x] `tasks/01_unuse-headroom-disables.feature` — `aof work unuse-headroom` sets `enabled:false` and KEEPS the block (the `providers` choice survives); re-enabling restores it (ADR-004)
- [x] `tasks/02_use-headroom-install-hint.feature` — with `headroom` absent from PATH, `use-headroom` still writes the config AND prints a one-line install hint pointing at the headroom repo, and runs no installer (ADR-004/005)
- [x] `tasks/03_init-with-headroom.feature` — `aof work init --with-headroom` writes the enabled `work.headroom` block on a fresh install; without the flag the block is absent (plugin off) (ADR-004)

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**: the
read-merge-write helper (`useHeadroom` / `unuseHeadroom`) in `src/work-headroom.mjs` (ADR-004), the
`use-headroom` / `unuse-headroom` dispatch arms in `workCommand` ([src/cli.mjs](../../../../../src/cli.mjs)),
and the `--with-headroom` thread through `initWork` ([src/work-init.mjs](../../../../../src/work-init.mjs)).

**Independent because** it couples to story 00 only through the frozen `work.headroom` shape (ADR-001);
it writes config, never the runtime resolver or the terminal seam. The mechanism reuses the existing
`readJson` → mutate → `writeText(... JSON.stringify(config, null, 2) + "\n")` idiom already in
`cli.mjs`, and the injectable `which` for the PATH check. The "writes config, not the lock, never
installs" invariant is the arch-test `acd-headroom-config-isolation` (RED until this story builds); the
install-hint *text* is a behavioural scenario here, not a fitness function.

**Feasibility (developer amigo seat):** Buildable — no infeasible scenarios — with three concrete
build notes I confirmed against the real seam. (1) The read-merge-write helper is genuinely new (no
config-*block* toggle precedent), but every ingredient exists: `findProjectConfig`/`workspacePaths`
resolve the path, `readJson` → mutate → `writeText(... JSON.stringify(config,null,2)+"\n")` is the
established style (used by `assets remove`/`packages add` in `cli.mjs`), and the injectable `which`
comes from `terminal-providers.mjs`. The merge must be DEEP enough to preserve `work.*` siblings
(`work.ui`, `work.dir`) — replacing only `config.work.headroom`, not reassigning `config.work` — which
the isolation arch-test (`acd-headroom-config-isolation`, RED now: `src/work-headroom.mjs` missing)
enforces. (2) `--with-headroom` threading is two real edits: `parseOptions` camelCases the flag to
`options.withHeadroom` but it is NOT in the boolean allowlist (`cli.mjs` ~line 1523), so `withHeadroom`
must be added there or it swallows the next arg; then thread `withHeadroom: Boolean(options.withHeadroom)`
into the `initWork({...})` call in `workInitCommand`. Heads-up that `aof work init` (via `initWork`)
does NOT write `aof.config.json` today — it renders the bundle and writes the lock; the top-level
`aof init` is what creates the config. So task 03's "the resulting aof.config.json has work.headroom"
is genuinely new config-writing wiring in `initWork` (reuse the same `useHeadroom` read-merge-write,
creating/merging the config), not just a boolean thread — feasible and matches ADR-004 ("same write as
use-headroom, applied to the fresh config"). The `providers` default `["claude","codex"]` is correctly
independent of `--runtime` (the resolver intersects with the routable set at runtime). (3) For
`unuse-headroom` on a project with NO block, I intend the graceful path: write `work.headroom={enabled:false}`
(so the off-state is explicit and the lock stays untouched) — exit 0, plugin off; the no-op alternative
also satisfies `acd-headroom-config-isolation` and the task-01 "plugin is off" scenario, but writing the
explicit disabled block is the more honest, reversible record consistent with ADR-004's keep-the-block
ethos.
