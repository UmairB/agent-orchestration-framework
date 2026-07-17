---
type: story
number: 03
slug: cli-install-run
title: "aof mesh install + run — the CLI seam that installs the desktop app alongside the aof binary and launches it, so one command brings the whole thing up"
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
# 03 · aof mesh install + run — one command brings up the supervisor

## User story

As an **operator**, I want to **install** the desktop app and **launch** it with a single `aof mesh` command
each — packaged **alongside the `aof` binary I already have** — so that getting the ambient supervisor is
"run one command," with no separate installer and no manual path wiring, shipping as part of the same tool.

<!-- The Node-side SEAM (ADR-003): two CLI-only nested verbs under `aof mesh`, siblings to `ui`/`repo`/`assign`,
     one new `commands/mesh-desktop.mjs` (← 1 cli.mjs), deliberately OUTSIDE the mesh bijection. Independent of
     the Rust internals (00/01/02) — it couples only at the ARTIFACT boundary (it installs + launches the built
     app), so its `@executable` units (dispatch + arg-parse + install-dir resolution over a fixture) build in
     parallel with the Rust stories. Its install PLACEMENT guarantees the co-located dir 00's trusted-spawn
     resolution depends on (the thin 00↔03 contract). -->

## Tasks

<!-- Contract authored `2026-07-09` via `aof:refine 36 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). Verb dispatch + install-dir resolution are `@executable` in the
     existing Node harness (the `mesh-repo`/`mesh-assign` sibling shape); the real install + launch + the
     end-to-end outsider acceptance are `@manual`/`@uat`. -->

- [x] [`tasks/00_verb-dispatch.feature`](tasks/00_verb-dispatch.feature) — `@executable` — `aof mesh <install>`
  and `aof mesh <run>` dispatch as **CLI-only nested verbs** (siblings to `ui`/`repo`/`assign`), added as
  additive `subcommand === "…"` branches ABOVE the unknown-sub fallthrough; the `--json` single-structured
  envelope discipline (08/ADR-003); unknown-flag rejection; **NO `mesh:*` registry id** (the verbs stay outside
  the bijection). The exact verb spelling is decided here. Arms `acd-desktop-verbs-outside-bijection` (ADR-003).
- [x] [`tasks/01_install-placement.feature`](tasks/01_install-placement.feature) — `@executable` — the install
  verb places the app executable(s) into **`$HOME/.aof/bin`** alongside the m28 `aof` binary (**co-location
  makes ADR-004's trusted spawn true**); an **idempotent** re-install updates in place; it bundles the
  **WebView2 Evergreen Bootstrapper** (ADR-001); friendly refusals (never a stack trace), mirroring the board /
  mesh-ui refusal idiom. (Real-machine install → task 03 `@uat`.)
- [x] [`tasks/02_run-launch.feature`](tasks/02_run-launch.feature) — `@executable` — the run/launch verb
  **discovers the installed app** in the install dir and starts it **detached**; a **not-installed** condition
  is a **calm, actionable refusal** ("run `aof mesh <install>` first"), never a crash or stack trace.
  (Real-machine launch → task 03 `@uat`.)
- [ ] [`tasks/03_end-to-end-install-launch.feature`](tasks/03_end-to-end-install-launch.feature) — `@uat` —
  **the milestone's outsider acceptance** (SPEC §Objective): on a **Windows control node**, one `aof mesh`
  command installs the app; launching it puts a **tray icon on the taskbar**, brings the **mesh server AND
  `aof mesh ui` up and keeps them up across a crash**, and the **window shows nodes + current work** — with the
  terminal closed. On a **worker node**, the same brings up `aof mesh ui` (no server). Cross-story acceptance —
  the whole milestone.

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md):

- `acd-desktop-verbs-outside-bijection` (ADR-003) — the new desktop verbs are CLI-only nested verbs with NO
  `mesh:*` registry id (like `ui`/`repo`/`assign`); the `acd-mesh-command-cli-bijection` gate stays green. (The
  guard already asserts the sibling precedent NOW; it arms on the new verbs' dispatch branch here.)

## Notes

Inherits **ADR-003** (the CLI-only nested verbs, packaged at `$HOME/.aof/bin`) and **ADR-001** (the WebView2
bootstrapper bundle + the m28 Authenticode signing precedent — no new signing story). The Node-side coupling is
only the new `commands/mesh-desktop.mjs` (`← 1 cli.mjs`) + two additive `meshCommand` branches — it touches no
existing `src/` module's shared lines and adds no registry id (ARCHITECTURE §Story breakdown).

**Depends:** none for its own `@executable` units (Node-side, file-disjoint from the Rust subtree). Its
**`@uat` task 03 is the milestone-level acceptance** and naturally exercises the built app (stories 00–02) —
run it at `aof:verify` once the Rust stories land. **The 00↔03 contract:** 03's install placement guarantees
`$HOME/.aof/bin` holds both binaries, which is what 00's trusted co-located resolution resolves against.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: tasks 00–02 stay `@executable` in the EXISTING Node harness (`node scripts/test.mjs`, NOT `cargo
test`); task 03's `@uat` is the milestone acceptance. The per-verb real-machine `@manual` scenarios (formerly
at the tail of tasks 01–02) were folded into task 03's `@uat` so each `@executable` feature stays single-lane
(validate: exactly one verification tag per scenario) — no scenario retag, the real-machine coverage is
preserved in task 03's `@uat`.**

- **Confirmed: this story's `@executable` units are Node-side, in the existing `test/*.test.mjs` +
  `scripts/test.mjs` harness — no cargo lane involved.** `commands/mesh-desktop.mjs` is a new `← 1 cli.mjs`
  module, the exact `commands/mesh-repo.mjs`/`commands/mesh-assign.mjs` shape already proven in this repo
  (`grep`-confirmed at `cli.mjs:554/563/572` — CLI-only nested verbs, no `mesh:*` registry id). Task 00
  (verb dispatch) is pure arg-parse/dispatch/`--json`-envelope assertion — no fixture even needed beyond the
  CLI's own argv. Tasks 01–02's `@executable` halves (placement, idempotence, bootstrapper bundling, the
  friendly-refusal matrix, discovery, the not-installed refusal) run over a **fixture install root with an
  injected `$HOME`** — the same convention m28's own install tests use — never the real machine, never a
  live signed artifact. All three land in `scripts/test.mjs` alongside the existing `meshRepoPublishTests` /
  `meshAssignVerbTests` imports (`scripts/test.mjs:10,18` precedent), not as a new lane.
- **Resolving doubt 1 — the detached-launch fixture-spawn stand-in: a fixture "app" is a trivial long-lived
  stub executable/script the test controls (e.g. a tiny Node script written into the fixture install dir at
  test setup, invoked via the SAME spawn call `mesh-desktop.mjs` would use for the real Tauri `.exe`), and the
  assertion is on the SPAWN SHAPE — detached (`spawn(..., { detached: true, stdio: "ignore" }).unref()`-style,
  mirroring the aof house detached-spawn idiom), the CLI returning immediately (the parent process exits/
  resolves without waiting on the child), and the resolved path being the fixture's absolute co-located path
  — NOT that a real tray icon appeared or a real window opened (that observable requires the real signed
  Tauri app and is exactly why the REAL launch is verified by task 03's whole-milestone `@uat` — the per-verb
  real-machine scenarios were folded into it to keep each feature single-lane). This mirrors `RESEARCH §4`'s own trusted-spawn idiom (shell-less argv, resolved
  absolute path) applied to a stand-in binary instead of the real one.
- **Resolving doubt 2 — the WebView2-bootstrapper pin: treat it as a PLACED FILE under the install dir (the
  Evergreen Bootstrapper `.exe`, ~1.8 MB per `RESEARCH §1`), not a manifest/config entry.** The install verb's
  contract (task 01) is "placed/recorded as part of the install" and "discoverable by the run verb" — a
  placed file is directly fixture-testable the same way the app executable itself is (assert its presence
  under `$HOME/.aof/bin` post-install, assert it survives/updates idempotently on re-install) with no extra
  schema to invent or keep in sync; a manifest/config-entry approach would add a second source of truth (a
  JSON/TOML the test would ALSO have to assert matches the placed reality) for no behavioural gain at this
  layer — the run verb's actual bootstrapping decision ("is WebView2 present, if not run the bootstrapper")
  is real OS-level behaviour Tauri's own runtime performs at first launch, correctly left to task 03's `@uat`
  real-machine acceptance, not something this story's fixture test can or should simulate. This is the
  simpler, single-source-of-truth pin — a placed file the fixture test can `stat()` directly.
- **The `@manual` and `@uat` scenarios in tasks 01–03 hold as tagged** — a real cross-machine install of a
  real Authenticode-signed bundle, a real detached launch producing a real tray icon, and the milestone's
  outsider acceptance (task 03) are all observable only on a real Windows box with the built Rust app; no
  fixture substitutes for "the operator sees a tray icon" or "the terminal can be closed and it keeps
  running." No retag.
