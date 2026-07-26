---
type: story
number: 02
slug: headroom-wrap-routing
title: "Headroom wrap routing — wire the resolver into the terminal launch"
parent: 06
status: done
owner: product-owner
created: 2026-06-20
updated: 2026-06-20
schema: 1
aofVersion: 0.1.0
---
# 02 · Headroom wrap routing — wire the resolver into the terminal launch

## User story

As a developer running a `claude` or `codex` session from the work-board terminal with the plugin enabled,
I want that session's provider calls to actually go through `headroom wrap <provider>` when the binary is installed, and to fall back silently to the raw provider when it isn't,
so that I get the token savings the plugin promises without the terminal ever breaking — and a session with the plugin off behaves byte-for-byte as it does today.

<!-- This is the SEAM wiring — the one place resolveHeadroomLaunch meets the real spawn path. It
     turns the frozen decision (story 00) into observable launch behaviour. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 06/02`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] `tasks/00_wrap-spawn-routing.feature` — with the plugin enabled, provider `claude`/`codex`, and `headroom` on PATH, the spawn receives `headroom` as the binary and `["wrap", <provider>, ...rawArgs]` as the args (ADR-003 branch 4, observed end-to-end)
- [x] `tasks/01_degrade-spawn-passthrough.feature` — enabled but `headroom` absent → spawn gets the RAW provider (terminal not broken, no error frame); `gemini` is never wrapped even when the plugin is enabled (ADR-003 degrade/gemini)
- [x] `tasks/02_absent-config-unchanged.feature` — with no `work.headroom` (or `enabled:false`), the spawn binary/args are byte-for-byte today's behaviour; the missing-PROVIDER-binary error gate is unchanged (ADR-001/003)

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**: the single new
call site in `handleConnection` ([src/terminal-ws.mjs](../../../../../src/terminal-ws.mjs)) — between
the provider's `buildArgs()` / `resolveBinaryPath()` and `spawn(...)` — passing `config.work?.headroom`
(config is already in scope there via `loadWorkspace(projectDir)`). It builds `resolveHeadroomLaunch`'s
caller; the resolver itself is story 00's.

**Independent because** it couples to story 00 only through the resolver signature (ADR-003). Against
the existing injectable `which` and `spawn` seams (`terminal-ws.mjs` already injects both for tests),
it needs nothing from the CLI story. The end-to-end "a wrapped session spawns `headroom wrap claude`"
is a behavioural scenario here (real `handleConnection` + stubbed `spawn`), distinct from story 00's
pure-resolver arch-test.

**Feasibility (developer amigo seat):** Buildable — no infeasible scenarios — with one load-bearing
correction to the current-state wording. I read `handleConnection` in `src/terminal-ws.mjs`. The QA
amigo is RIGHT: `config` is NOT actually in scope at the spawn call today. `handleConnection` calls
`const workspace = await loadWorkspace(projectDir)` INSIDE a `try` (around the ref→cwd resolution) and
uses only `workspace.workDir`; `workspace.config` is discarded and the binding does not survive past
the `catch`. So ADR-003/STORY.md's "config is already in scope there via `loadWorkspace(projectDir)`"
over-states the current state — the contract is still buildable, but the dev must MAKE it true: hoist a
`let headroomConfig` (or retain `workspace.config`) out of the try, default it to plugin-off on the
catch path (resolution failure ⇒ treat as no `work.headroom`, never break the terminal), and pass
`headroomConfig` to `resolveHeadroomLaunch`. The call slots between the existing `args = provider.buildArgs()`
and `spawn(bin, args, …)`, and CRITICALLY only AFTER the existing `bin = provider.resolveBinaryPath(baseEnv);
if (bin === null) { …error control-frame…; return; }` provider gate — so a missing PROVIDER still fires
the unchanged error frame and never reaches the resolver, while a missing HEADROOM degrades to the raw
launch with no error. Then spawn `result.bin` with `result.args`; nothing else in `handleConnection`
changes. `loadWorkspace` does return `{ config, workDir, projectRoot }` (confirmed via `work-memory.mjs`),
so retaining `config` is a one-line change. `which` and `spawn` are already injected for tests, so the
end-to-end scenarios drive every branch with no real PATH and no PTY. `buildEnv`'s reserved `_opts`
stays untouched (no proxy code — guarded by `acd-headroom-no-proxy-runtime`, GREEN now and must stay
green). The story's own pure-resolver dependency (`src/headroom.mjs`) is story 00's.
