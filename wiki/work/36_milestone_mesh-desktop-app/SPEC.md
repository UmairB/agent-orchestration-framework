---
type: milestone
number: 36
slug: mesh-desktop-app
title: "Mesh Desktop App — a native Windows supervisor for the mesh server + UI, with a taskbar tray + node/work view"
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
depends: [25, 28, 33, 34]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 36 · Mesh Desktop App — a native Windows supervisor for the mesh server + UI

## Objective

The mesh is driven from the terminal today: an operator starts the control node's mesh server and the
`aof mesh ui` web surface by hand, keeps a terminal open, and there is **no ambient presence** on the
machine. This milestone gives a client machine a **native desktop companion** — a small Rust app — that
turns "run these commands and keep them alive" into "install once, it's always there in the tray."

The app is a **supervisor, not a re-implementation**. It spawns and watchdogs the *existing* `aof` mesh
processes — the **mesh server/relay** on a control node (milestone 33) and the **`aof mesh ui`** web
surface (milestone 25) on both control and worker nodes — restarting them on crash and reflecting their
health. It lives in the **Windows taskbar/tray** (ambient presence, survives closing the window), and it
renders its **own simple native view of the fleet** — the nodes and what each is currently working on —
read from the same `aof mesh status` data the web UI already consumes (nodes: milestones 25/33; current
work: the global store, milestone 34). It is **installed and launched through the `aof mesh` CLI
namespace** — one `aof mesh` verb installs it, another runs it — so it ships as part of the same tool,
alongside the milestone-28 console binary it supervises.

An outsider can verify the objective is met when, on a **Windows control node**, a single `aof mesh`
command installs the app; launching it puts a **tray icon on the taskbar**, brings the mesh server **and**
`aof mesh ui` up (and keeps them up across a crash), and its window shows the mesh's **nodes and their
current work** — all with the terminal closed. On a worker node the same app brings up `aof mesh ui`
(no server) and the same view. No mesh logic is duplicated in the app: `aof` stays the system of record.

## Scope

In scope:
- **Native Rust desktop app (Windows-first)** — installable and runnable on a client machine; the Rust
  core is kept portable so a later macOS/Linux tray is additive, but only the Windows tray ships here.
- **Process supervision** — spawn + watchdog + restart the existing mesh server/relay (control node) and
  the `aof mesh ui` web surface (control + worker); reflect their up/down/health. The app runs **no mesh
  logic of its own** — it shells out to the `aof` binary.
- **Windows taskbar/tray presence** — a tray icon with status and basic controls (start/stop, open the
  web UI, show/hide the window, quit); ambient — it stays resident when the window is closed.
- **A simple native node/work view** — the fleet's nodes and each node's current work, rendered from the
  `aof mesh status` contract (the milestone-25/33/34 fleet data), to **user-provided designs** (the
  milestone's DESIGN is authored at refine once the mocks land).
- **`aof mesh` CLI integration** — a verb to **install** the app and a verb to **run/launch** it; the app
  is discovered and launched through the mesh namespace and packaged alongside the milestone-28 binary.

Out of scope:
- **Reimplementing the relay / mesh server or the web UI in Rust** — the app supervises the existing `aof`
  processes; the mesh logic stays the single-source-of-truth Node binary (milestones 22–35).
- **macOS / Linux tray** — deferred to a follow-up; the Rust core stays portable but only the Windows
  taskbar/tray is delivered in this milestone.
- **Issuing / assigning / routing work from the app** — the native view is **read-only**; assignment
  stays `aof mesh assign` (milestone 35). This app *renders* the fleet, it does not dispatch to it.
- **An auto-update / release-channel pipeline for the app** — first signed install only, mirroring the
  milestone-28 boundary.
- **A new fleet data model** — the native view reads the existing `mesh:status` contract; it adds no
  second data path (the milestone-25 single-data-command discipline carried forward).

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 36.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

<!-- Broken down `2026-07-09` via `aof:refine 36 --autonomous`. Four stories drawn from the codebase-graph
     coupling (see ARCHITECTURE.md §Story breakdown rationale): the Rust supervisor **core** (00) is a
     greenfield subtree with ZERO source edges into `src/`; the tray (01) + window (02) are two INDEPENDENT
     faces forking off 00 in parallel; the CLI **seam** (03) is `← 1 cli.mjs` (the `mesh-repo`/`mesh-assign`
     shape), file-disjoint from the Rust subtree. Every contract authored (Three Amigos) in the same
     autonomous pass. Build order: {00, 03} → then {01, 02}. -->

- [x] [`00 · supervisor-core`](stories/00_story_supervisor-core/STORY.md) — the Rust app skeleton + the
  spawn/watchdog/**restart** engine behind a Job-Object **kill-on-close** seam, role-driven off `isControlNode`,
  the single-data-path `mesh status` poll, and the trusted co-located `aof` resolution. **Foundation**
  (ADR-001/002/004). Depends: none.
- [x] [`01 · tray-presence`](stories/01_story_tray-presence/STORY.md) — the ambient Windows tray icon (states
  by shape+badge) + menu (start/stop, open web UI, show/hide, quit), resident when the window is closed; local
  supervision only. **Surface 2** (ADR-001/002/004). Depends: 00 (parallel to 02).
- [x] [`02 · node-work-view`](stories/02_story_node-work-view/STORY.md) — the native window rendering the fleet
  (nodes + current work) from `mesh:status`, strictly read-only, across empty/loading/error/populated. **Surface
  1** (ADR-001/004; DESIGN §Surface 1). Depends: 00 (parallel to 01).
- [x] [`03 · cli-install-run`](stories/03_story_cli-install-run/STORY.md) — the `aof mesh` install + run verbs
  (CLI-only nested, outside the bijection), packaged at `$HOME/.aof/bin` alongside the m28 binary; task 03 is
  the milestone-level `@uat` acceptance. **Seam** (ADR-003). Depends: none (couples to 00–02 only at the
  artifact boundary).

## Dependencies

- **25 · mesh-ui** — supplies the **`aof mesh ui`** web surface the app launches and keeps alive, and the
  **`mesh:status`** fleet-data contract the native node/work view reads (the same command both faces
  consume — no second data path).
- **28 · console-app** — the signed, install-anywhere **`aof` binary** the app supervises (it shells out to
  `aof mesh …`) and the **packaging/signing precedent** for shipping this second installable through the
  `aof mesh` namespace.
- **33 · mesh-relay-transport-redesign** — the current **mesh server/relay** the app fires off and keeps
  alive on a control node (the live transport milestones 34/35 build on).
- **34 · global-mesh-work-store** — the source of the **"current work"** the native view renders (the
  machine-wide work store the fleet aggregate draws from).
