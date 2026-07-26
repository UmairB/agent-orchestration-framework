---
type: story
number: 00
slug: supervisor-core
title: "Supervisor core — the Rust app skeleton + the spawn/watchdog/restart engine that keeps the right mesh processes alive for this node's role, reaps them on quit, and polls the fleet — the foundation the tray + window render off"
parent: 36
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 00 · Supervisor core — keep the mesh alive, reap it cleanly, read the fleet

## User story

As a **client-machine operator**, I want a resident Rust supervisor that spawns and watchdogs **the right
`aof` mesh processes for this node's role**, restarts them on crash under a sane backoff, **reaps the whole
child tree cleanly when I quit** (no orphaned `aof`/Node processes), and continuously reads the fleet's
`mesh:status` — so that "run these commands and keep them alive" becomes an always-on background fact I never
babysit, and the tray (story 01) + window (story 02) have **one truthful model** to render.

<!-- The FOUNDATION. This is the shell-agnostic supervisor core (ADR-002) + the Tauri app skeleton /
     single-instance (ADR-001) + the single-data-path poll + the trusted co-located spawn (ADR-004). It has
     NO visible surface of its own — it is the engine + model stories 01/02 sit on. Independent of story 03
     (the CLI seam): it resolves "the sibling aof in my own install dir" and falls back for a dev/unpackaged
     run, so it is testable without 03 (the architect's boundary refinement — ARCHITECTURE §Story breakdown). -->

## Tasks

<!-- Contract authored `2026-07-09` via `aof:refine 36 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). Rust `@executable` = `cargo test` (the dev-amigo confirms the
     lane); the Job-Object reap + restart-on-crash are observable supervisor behaviour → `@manual` (ARCHITECTURE
     §Fitness functions "armed at build"), not a grep. -->

- [x] [`tasks/00_trusted-aof-resolution.feature`](tasks/00_trusted-aof-resolution.feature) — `@executable` — resolve the
  sibling `aof` binary by an **absolute co-located path** (`$HOME/.aof/bin`), **never a bare-PATH `aof`
  lookup**, spawned as **shell-less argv**; an unpackaged/dev run falls back per the `mesh-fabric` precedent.
  Arms `acd-desktop-trusted-spawn` (ADR-004 d4).
- [x] [`tasks/01_status-poll-deserialize.feature`](tasks/01_status-poll-deserialize.feature) — `@executable` —
  poll `aof mesh status --json` on a cadence and deserialize the **corrected shape**
  (`{ nodes, boards, isControlNode }`; `presence.activeRuns`/`aofVersion` **nested** under each node's optional
  `presence`; `node.local`; `node.stale`) as the **single** fleet-data path; extract `isControlNode` as the
  role signal. Arms `acd-desktop-single-data-path` + `acd-desktop-no-mesh-logic` (ADR-004 d1–2).
- [ ] [`tasks/02_supervision-restart-and-role.feature`](tasks/02_supervision-restart-and-role.feature) —
  `@manual` — the **role-driven** supervision set (control ⇒ `serve --serve` + `ui`; worker ⇒ `ui` only, off
  `isControlNode`) + spawn/watchdog/**restart-with-jittered-backoff**, **crash-vs-clean-exit aware**
  (`ui-build-missing`/`EADDRINUSE`/`launcher-already-running (pid N)` are named clean exits — surfaced, never
  tight-looped); the local-process state machine (`Running`/`Restarting`/`Stopped`/`CleanExit`) → DESIGN's
  local-process ramp (ADR-002 d1–2).
- [ ] [`tasks/03_job-object-reap.feature`](tasks/03_job-object-reap.feature) — `@manual` — each child is
  **Job-Object-contained** (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`); `Quit` **and even a supervisor crash** reap
  the entire child tree (`aof`, its Node process, grandchildren) — **no orphans** (ADR-002 d3).

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md) — this story arms (guard-if-present today, hard
assertions once `app/desktop/` lands):

- `acd-desktop-no-mesh-logic` (ADR-004 d1) — the Rust app reimplements no git store / fabric transport / relay
  / projection store; fleet data comes ONLY from spawning `aof`.
- `acd-desktop-single-data-path` (ADR-004 d1–2) — fleet data read ONLY via `aof mesh status`; `serve`/`ui`
  spawns are lifecycle, not data.
- `acd-desktop-trusted-spawn` (ADR-004 d4) — absolute co-located `aof` resolution, never bare-PATH, no
  shell-string spawn.

The **Job-Object reap** + **restart-on-crash** are observable supervisor behaviour (tasks 02/03 `@manual`),
NOT arch-tests (ARCHITECTURE §Fitness functions — armed at build here).

## Notes

Inherits **ADR-001** (Tauri v2 skeleton + first-party single-instance), **ADR-002** (the supervision model),
**ADR-004** (no-mesh-logic / single-data-path / read-only / trusted spawn). **The corrected `mesh:status`
contract is load-bearing** — code against `presence.activeRuns` / `node.local` / `node.stale` / top-level
`isControlNode`, NOT the flatter assumed shape ([RESEARCH.md](../../RESEARCH.md) §3 / ADR-004 §Context).

**Depends:** none — the foundation. Stories 01 and 02 depend on this; they can be built in parallel once it
lands. **The thin contract with 03:** the **trusted-spawn resolution logic lands HERE** (00 resolves "the
sibling `aof` in my own install dir"); **03's install verb guarantees that dir** (`$HOME/.aof/bin`, both
binaries co-located) — so 00 is self-contained and testable without waiting on 03 (ARCHITECTURE §Story
breakdown, the boundary refinement).

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: tasks 00–01 stay `@executable` (a new `cargo test` lane, guard-if-present), tasks 02–03 stay
`@manual` — no retag.** Confirmed against `scripts/test.mjs`, the five wired `test/arch/acd-desktop-*.test.mjs`
guards, and a fresh `app/desktop/` check (absent — confirmed greenfield, no Rust subtree, no `cargo`
invocation in the harness today).

**The cargo-lane decision (recorded here in full — this story is the foundation that establishes it):**

- **This story scaffolds `app/desktop/` (a Cargo workspace/crate) and OWNS wiring `cargo test` into
  `scripts/test.mjs`** as a new lane, `guard-if-present` exactly like the five Rust arch-tests already wired
  by the architect: when the Rust toolchain and `app/desktop/Cargo.toml` are both present, the harness shells
  `cargo test --manifest-path app/desktop/Cargo.toml` (or equivalent) and folds its pass/fail into the
  suite's overall exit code; when either is absent, it is a clean, explicit skip (mirroring the `dirExists`
  guard pattern in `test/arch/acd-desktop-no-mesh-logic.test.mjs:84-89` — pin the vacuity, don't silently
  omit it) so `node scripts/test.mjs` stays green pre-build and turns into a real gate the moment the crate
  lands. This is purely additive to the existing five arch-test imports at `scripts/test.mjs:60-64` — no
  existing lane is touched.
- **The pure functions live in a shell-agnostic core module**, separate from the Tauri/native-shell glue
  (`TrayIconBuilder`, `tauri::Builder`, IPC command registration, the WebView bootstrap) — the resolver
  (task 00), the `mesh status --json` deserializer (task 01), and (consumed by stories 01/02) the icon-state
  selector, the tray-menu builder, and the render/state-selection view-models. Each is a plain Rust function
  over fixture inputs (a fake `$HOME`, a fixture status JSON, a fake clock tick) — `cargo test` runs them
  headlessly, no window, no real spawn, no live `aof`.
- **Spawn and clock are behind mockable traits/seams** — this resolves the cross-cutting doubt flagged by QA
  for 00/01/02: task 00's resolver returns a resolved path + argv WITHOUT itself invoking `Command::spawn`
  (the spawn call is the `acd-desktop-trusted-spawn` fitness's surface, not this feature's); task 01's poll
  cadence is asserted "N ticks → N status invocations" over an injectable timer/clock, never a real
  `sleep`-driven loop; task 02's role-set/backoff logic (01's + 02's consumers) drives its restart-timing
  assertions off the SAME kind of fake-clock seam once story 00's Cargo scaffold lands the trait boundary.
  This is why tasks 00–01 are cleanly `@executable` and tasks 02–03 are genuinely not: 02/03 need a REAL
  spawned child (or a stub child process) whose REAL exit/crash and REAL process tree are observed — the
  seam makes resolution/deserialization pure, but restart-timing-over-a-real-watchdog-loop and Job-Object
  tree-reaping are observable OS behaviour no fixture-fed unit test can substitute for.
- **Tasks 02 (`supervision-restart-and-role`) and 03 (`job-object-reap`) stay `@manual`** exactly as tagged:
  restart-under-backoff needs a real watchdog loop driving real (or stub) long-lived child processes and
  timing the actual restart; Job-Object kill-on-close needs a real spawned process tree and real enumeration
  of surviving PIDs after a Quit / hard-kill — genuinely un-writable as a source grep (ARCHITECTURE §Fitness
  functions already records this: "armed at build by story 00", not a structural invariant). No retag; the
  QA tagging already lands correctly.
- **No scenario in tasks 00–01 was retagged.** Every scenario in both features — including the Scenario
  Outlines (PATH-fallback mode, presence-optional deserialization, stale-boolean, cadence ticks) — is a pure
  function over a fixture input/fake clock; none needs a live spawn, a live `aof`, or OS-level process
  enumeration to observe. They hold as `@executable` under the cargo lane.

**Build-order:** this story is the dependency root — `cargo test` lane + `app/desktop/` scaffold land here
FIRST; stories 01/02 consume the pure-selector seam this establishes, and their own `@executable` Rust
scenarios only run once this story's Cargo project exists (until then the harness's guard-if-present keeps
the whole suite green).
