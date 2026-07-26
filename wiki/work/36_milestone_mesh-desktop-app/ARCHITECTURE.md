---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 36 · Mesh Desktop App — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (a native Windows companion that **supervises**, not reimplements —
> spawns + watchdogs the *existing* `aof mesh serve --serve` (control node) and `aof mesh ui` (all nodes),
> lives in the Windows tray, renders its OWN read-only node/work view from `mesh:status`, installed +
> launched through the `aof mesh` CLI namespace alongside the m28 binary), `STATE.md` (the user-confirmed
> framing: **supervise-don't-reimplement**, **native tray window AND launches the web `aof mesh ui`**,
> **Windows-first with a portable Rust core**; the native-shell tech choice is explicitly delegated to this
> ADR), `RESEARCH.md` (the measured facts these ADRs build on — the Tauri-v2-vs-egui tradeoff table, the
> `win32job`-vs-`processkit` supervision tradeoff, the **corrected `mesh status --json` contract**, the
> `serve` probe-vs-daemon split, the `$HOME/.aof/bin` install convention, and the trusted-spawn precedent),
> and `DESIGN.md` (the two surfaces + the two-ramps discipline the node-work-view story codes against).
>
> **The precedents this milestone APPLIES and never re-litigates:** milestone **28** (the SEA packaging /
> Authenticode signing precedent + the `$HOME/.aof/bin` per-user install join point — m28/ADR-006), milestone
> **25** (the `mesh:status` single-data-command; `aof mesh ui` as a CLI-only serve verb outside the mesh
> bijection — 25/ADR-003), milestone **33** (`aof mesh serve --serve` the foreground daemon; the
> `probeFabric` preflight-and-refuse-with-guidance discipline; `mesh:serve` the registered non-blocking
> probe), milestone **34** (the control-node stream server + the global-work store the "current work" is
> read from), and the aof house **trusted-spawn idiom** (`src/mesh-fabric.mjs`: shell-less `execFile` argv,
> bounded timeout, PATH-first-then-pinned-absolute-fallback). ADRs cite these as `NN/ADR-00n` / `SPEC §…` /
> `STATE §…` / `RESEARCH §n` / `DESIGN §…`.
>
> **The seam — grounded in the codebase graph, cited as ACTUAL structure, not inferred.** `aof graph build
> src` was run fresh at author time → **1491 nodes / 3837 edges, 69 communities, egress none, builtAt
> 2026-07-09** (readback surfaced so no boundary is drawn over a stale graph). `aof graph impact` on the
> Node-side integration files returned, deterministically from the graph's edges:
> - `src/cli.mjs` → **← 0 dependents** (only `bin/aof.mjs`, outside the src graph, imports `run`) / **→ 28
>   dependencies** (every top-level command module, incl. `commands/mesh-repo.mjs`, `commands/mesh-assign.mjs`,
>   `mesh-launcher.mjs`, `mesh-ui-serve.mjs`). This is the single command spine; the new desktop verbs are two
>   more additive `subcommand === "…"` branches in `meshCommand`, one new command module each.
> - `src/commands/mesh-repo.mjs` → **← 1** (`cli.mjs`) / **→ 3**; `src/commands/mesh-assign.mjs` → **← 1**
>   (`cli.mjs`) / **→ 4**. **These are the exact shape the new desktop command module joins** — a CLI-only
>   nested-verb sibling with a SINGLE inbound edge from `cli.mjs`, cleanly isolable, not fanned into by any
>   other module.
> - `src/mesh-launcher.mjs` → **← 2** (`cli.mjs`, `commands/mesh-serve.mjs`) / **→ 13** — the daemon the app
>   supervises via `aof mesh serve --serve`; the app does NOT import it (it spawns the CLI), so there is **no
>   new source edge** into the launcher cluster from this milestone.
> - `src/mesh-fabric.mjs` → **← 6** / **→ 0** — the trusted-spawn idiom the Rust spawn mirrors (an
>   informational precedent, not a code edge; the Rust app is a greenfield subtree, not in this graph).
> The graph **informs** the boundary below; it never **dictates** it — the partition is mine, citing the graph
> as one input. **The Rust app itself (`app/desktop/`) is a greenfield subtree with ZERO edges into `src/`** —
> its only coupling to aof is the ARTIFACT boundary (it spawns the installed `aof` binary), never a source
> import. That is exactly what makes stories 00/01/02 (the Rust internals) independent of story 03 (the CLI
> seam), argued in the story-breakdown rationale.

---

## ADR-001: The native shell is **Tauri v2** — WebView2-hosted UI driven from a Rust supervisor core, chosen for its first-party Windows bundler + single-instance plugin + HTML/CSS design-handoff fit; the Rust core stays portable and only the Windows tray ships

**Status:** Accepted
**Date:** 2026-07-09

> **This is the headline ADR — the user delegated the shell choice to this decision (`STATE §Owed at refine`)
> and will see it at the single end review for veto. The rationale is crisp and the reversal cost is stated
> explicitly below.**

**Context.** `SPEC §Scope` asks for a native Windows-first tray app that renders its OWN node/work view AND
launches the web `aof mesh ui`, with a portable Rust core. `RESEARCH §1` measured the two viable stacks head
to head (facts, no verdict imposed): **Tauri v2** (`tauri` 2.11.5) — an actively-shipping first-party project
that gives a built-in Windows NSIS/WiX bundler wired to `signtool`/a custom `signCommand`, a first-party
`tauri-plugin-single-instance` (2.4.2), native tray via `TrayIconBuilder` (wrapping the same `tray-icon`
crate), and **web-technology UI authoring** — at the cost of a **WebView2 runtime dependency** (present by
default on Windows 11, not guaranteed on older Windows 10) and an **IPC boundary** between the Rust supervisor
logic and the rendered view. **egui/eframe + `tray-icon`** (`tray-icon` 0.24.1 — the SAME tray crate Tauri
wraps) gives a **smaller, self-contained binary with no webview runtime**, at the cost of **hand-rolling** the
Windows installer/signing wiring and the single-instance guard (a generic `single-instance` crate, self-wired)
and **translating pixel mocks into immediate-mode Rust layout code**. `RESEARCH §1` establishes that the
ambient "hide-on-close, stay-in-tray" wiring is **manual either way** — NOT a differentiator. The real fork is
(a) UI-authoring medium — web (HTML/CSS) vs immediate-mode Rust — and (b) whether a WebView2 runtime dependency
is acceptable on a Windows-first target.

**Decision. Ship Tauri v2.** Three factors decide it for this specific app:

1. **The design handoff is web-native (`DESIGN §Conformance`).** `DESIGN.md` specifies **two surfaces with
   committed pixel mocks** and a Windows-11-system-utility ramp (Segoe UI Variable, Mica/acrylic, WinUI layer
   fills, light+dark, a health ramp where colour+shape always travel together). Authoring that against
   HTML/CSS — where the designer's mock maps to markup + a stylesheet — is materially less labor and less
   drift than translating each region into egui's immediate-mode layout model (`RESEARCH §1`, the
   "mock/design handoff" row: *Direct (HTML/CSS)* vs *Translated to egui layout code*). For a milestone whose
   conformance bar IS a pixel mock, web authoring is the lower-risk path to fidelity.
2. **Packaging + single-instance are first-party, matching the m28 signing precedent with less hand-rolling.**
   Tauri's bundler invokes `signtool` / a custom `signCommand` directly (`RESEARCH §1`), so the **same
   Authenticode / HSM-cloud-key precedent m28/ADR-005 established for the Node SEA binary applies verbatim** —
   no new signing story is invented. The first-party `tauri-plugin-single-instance` handles the Windows named-
   mutex primitive so the app does not hand-roll it (egui would need the generic `single-instance` crate,
   self-wired — one more manual integration).
3. **The web UI is already the fleet-view language.** The app ALSO launches the web `aof mesh ui`
   (`SPEC §Objective`); the native view renders the SAME `mesh:status` concepts the web `ui/src/fleet/Fleet.tsx`
   renders (`DESIGN §Shared ramp` — "one vocabulary, two faces"). A WebView-hosted native view keeps both faces
   in one authoring medium, so the native surface can share visual tokens/idioms with the web fleet view rather
   than reimplement them in a second (immediate-mode) paradigm.

**The portability posture (SPEC-required).** The Rust **supervisor core** — process spawn/watchdog/restart
(ADR-002), the `mesh status --json` poll + deserialize (ADR-004), the role model — is written against
**platform-neutral abstractions and is OS-agnostic**; only the **Windows tray + the WebView2-hosted window**
ship in this milestone. Tauri already supports macOS (WKWebView) and Linux (WebKitGTK), so a later
cross-platform tray is a **config/target change, not a rewrite** — provided the supervisor core does not leak
Windows-only assumptions into the shared layer (the Job Object is a Windows-only *containment detail* behind a
neutral "kill the child tree" seam — ADR-002). `SPEC §Out of scope` defers the mac/Linux tray; this ADR keeps
the core additive-ready.

**The WebView2 runtime dependency is owned as a doctor-style preflight (`RESEARCH §1` closing note).** WebView2
ships by default on Windows 11 but not on every Windows 10 install. The install verb (ADR-003) bundles Tauri's
**WebView2 Evergreen Bootstrapper** (~1.8 MB, `RESEARCH §1`) so a missing runtime self-installs on first run;
a missing-WebView2 condition surfaces as a **calm, actionable preflight message** (mirroring m33's
`probeFabric` refuse-with-guidance idiom, `RESEARCH §1`), never a crash.

**Consequences.**
- The app is a Tauri v2 project under a NEW greenfield subtree `app/desktop/` (the exact path the fitness
  functions guard). The UI layer is HTML/CSS/JS in WebView2; the supervisor logic is Rust, exposed to the view
  via Tauri IPC commands/events. This IPC boundary is real architecture (state flows Rust→view via events;
  toggles flow view→Rust via commands) and is where the two DESIGN ramps (local-process vs fleet-presence,
  `DESIGN §Non-negotiable framing`) are kept distinct — the Rust core emits both signals separately and the
  view never conflates them.
- **Reversal cost (stated for the veto review): MODERATE, and it shrinks over time.** Reversing to egui after
  build costs (a) **re-authoring the UI layer** from HTML/CSS into immediate-mode Rust widgets — the largest
  cost, and the whole node-work-view story (02) — and (b) **hand-rolling the installer/signing wiring + the
  single-instance guard** that Tauri gave for free (stories 01/03). It does **NOT** cost the supervisor core
  (ADR-002) — the spawn/watchdog/restart engine, the Job Object containment, the `mesh status` poll, and the
  role model are shell-agnostic Rust and port to egui unchanged. So the reversible surface is "the view + the
  packaging plumbing"; the load-bearing supervisor is not entangled with the shell choice. The cheapest window
  to reverse is BEFORE story 02 authors the WebView UI; after that, the view is the sunk cost.
- No fitness function is armed by THIS ADR directly (the shell choice is not a source invariant a grep can
  assert). Its downstream invariants — no-mesh-logic, single-data-path, read-only, trusted-spawn — are armed by
  ADR-004; the CLI-seam invariant by ADR-003.

**Alternatives considered.**
- **egui/eframe + `tray-icon` (the pure-Rust, self-contained option)** — rejected as primary, kept as the
  documented reversal target (above). It wins on binary leanness (no WebView2 runtime) and dependency-surface
  minimalism, which genuinely matter on a fresh Windows box. It loses on the two factors that dominate THIS
  milestone: the pixel-mock design handoff (egui needs the mock translated to layout code) and the
  installer/single-instance hand-rolling Tauri supplies first-party. If the WebView2 dependency proves an
  install-friction blocker in `@uat`, egui is the recorded escape hatch — the supervisor core ports unchanged.
- **A webview-embed-only launcher (no native view) / a launcher-only app (no window)** — rejected by
  `STATE §Framing`: the user explicitly confirmed a native tray window that renders its own node/work view AND
  launches the web UI — "not a webview-embed, not launcher-only." (Tauri's native view is itself WebView-hosted,
  but it is the app's OWN rendered surface over `mesh:status`, distinct from launching the separate web
  `aof mesh ui` in a browser — both ship, per `SPEC §Objective`.)
- **Electron / a Node-based shell** — rejected: `SPEC §Scope` names a **Rust** core (portable, small); Electron
  reintroduces a bundled-Chromium payload (100+ MB, `RESEARCH §1`) the Rust-first framing exists to avoid.

---

## ADR-002: Process-supervision model — spawn + watchdog + restart-with-jittered-backoff for the two long-lived children, behind a Windows **Job Object kill-on-close** containment seam, a **role-driven** supervision set (control brings up `serve --serve` + `ui`; worker brings up `ui` only, off `mesh status`'s `isControlNode`); the containment primitive is `win32job` + a hand-rolled restart loop over `tokio::process`

**Status:** Accepted
**Date:** 2026-07-09

**Context.** `SPEC §Scope` requires the app to spawn, watchdog, and restart-on-crash the existing mesh
processes and to reap them when it quits. `RESEARCH §2` measured the Rust landscape: neither `std::process`
nor `tokio::process` natively supports supervision (restart/backoff) or reaches beyond the DIRECT child — a
child's descendants are not tracked or reaped by either primitive alone. The correct Windows primitive for
"kill the process tree on quit" is a **Job Object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: assign the
child to the job, and closing the job handle (including on the supervisor's OWN crash/exit) kills every process
in the job transitively (`RESEARCH §2`). Two crates deliver this: **`win32job`** (2.0.3, 2025-05-15 — a narrow,
stable, Windows-only wrapper around exactly this API) composed with a hand-written restart/backoff loop over
`tokio::process`, OR **`processkit`** (2.2.1 — an all-in-one `Supervisor` with `RestartPolicy` + jittered
exponential backoff + Job-Object containment, but **published literally the day before the research**, single-
maintainer, un-battle-tested). `RESEARCH §2` also established: both supervised children (`aof mesh serve
--serve`, `aof mesh ui`) are **long-lived** (they block until SIGINT/SIGTERM), so an exit is a genuine
crash/exit signal; and on Windows there is **no true POSIX SIGTERM** — `Child::kill()` is `TerminateProcess`
(hard kill), which is exactly what Job-Object kill-on-close implies. `RESEARCH §3` established the role signal
and the two children's clean-exit-1 failure modes.

**Decision.**

1. **Two supervised long-lived children, role-driven (`RESEARCH §3`).** The supervision SET is driven off the
   `isControlNode` boolean read from the SAME `mesh status --json` poll the fleet view already needs (ADR-004) —
   no re-derivation in Rust, no config-file parse:
   - **Control node** (`isControlNode: true`): supervise **`aof mesh serve --serve`** (the foreground
     presence+sync+stream daemon) **AND `aof mesh ui`**.
   - **Worker node** (`isControlNode: false`): supervise **`aof mesh ui` ONLY** — no server. (`startLauncher`
     is itself role-aware internally — `RESEARCH §3` — so the supervisor's job is simply "don't start `serve
     --serve` on a worker," not to replicate the control/worker/standalone branching.)
   This directly honours `DESIGN §States` ("a worker node omits the Mesh-server control") and
   `SPEC §Objective` ("on a worker node the same app brings up `aof mesh ui` (no server)").
2. **Watchdog + restart with jittered exponential backoff, crash-vs-clean-exit aware (`RESEARCH §3`).** A child
   that exits is restarted under a backoff policy — BUT the two children's **named clean-exit-1 modes are
   special-cased, not blindly restart-looped**: for `aof mesh ui`, a fast exit-1 right after spawn is
   `ui-build-missing` or `EADDRINUSE` (surface the message, do not tight-loop); for `aof mesh serve --serve`,
   an exit-1 with the "launcher already running (pid N)" message is the daemon's OWN lock-file single-instance
   guard firing (treat as "someone else already has it," not a crash to restart). A later, unexpected exit is a
   real crash worth the backoff-restart. This maps to `DESIGN`'s **`restarting`** local-process state (a real
   supervisor signal, `DESIGN §UI behaviour`).
3. **Windows Job Object kill-on-close is the child-tree reaper, behind a neutral containment seam.** Each
   spawned child is assigned to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
   (`RESEARCH §2`), so `Quit` (and even the supervisor's own crash) reaps the entire child tree — `aof`, its
   Node process, and any grandchildren — with no orphans. The Job Object is a **Windows-only containment detail
   behind a platform-neutral "kill the supervised tree" seam** so the portable core (ADR-001) does not leak the
   Win32 primitive into shared logic (a later macOS/Linux tray swaps a process-group/cgroup behind the same
   seam).
4. **The containment primitive is `win32job` (2.0.3) + a hand-rolled restart/backoff loop over
   `tokio::process` — NOT `processkit` (the crate-risk call).** For a component whose ENTIRE JOB is
   reliability ("keep the mesh alive"), a **narrow, stable, auditable** Windows-only crate (`win32job`, a year
   old, focused surface) plus a few-dozen-line restart loop the app fully owns is preferred over a **day-old,
   single-maintainer all-in-one** (`processkit`, 2.2.1) — even though `processkit` is exactly the right shape
   and would spare the hand-rolled code. `RESEARCH §2` framed this as the explicit risk/convenience tradeoff;
   the decision resolves it toward zero-unfamiliar-crate-risk. (`processkit` is recorded as a fast-follow the
   app MAY adopt once it has matured and been battle-tested — the restart/backoff seam is written so swapping
   the containment+supervision engine behind it is additive.)

**Consequences.**
- The supervisor core is a Tauri-agnostic Rust module set: a `spawn(child_spec) → JobBackedChild`, a watchdog
  task per child, a restart-policy state machine (`Running | Restarting(backoff) | Stopped | CleanExit(reason)`
  mapping to `DESIGN`'s local-process ramp), and the Job Object owner dropped on quit. This is the whole of
  **story 00** and the dependency root for stories 01/02.
- The **role-driven supervision set** couples to ADR-004's single data path: `isControlNode` is read from the
  `mesh status --json` poll, so there is ONE data command feeding BOTH the fleet view and the "start the server
  or not" decision — no second command, honouring `SPEC §Out of scope` ("adds no second data path").
- No new *aof source* invariant is armed here (the supervision engine is Rust, in `app/desktop/`); its
  discipline is covered structurally by ADR-004's Rust-subtree fitness functions (a reimplemented supervisor
  that started reaching fleet data by any path other than spawning `aof` would trip `acd-desktop-no-mesh-logic`
  / `acd-desktop-single-data-path`).

**Alternatives considered.**
- **`processkit` (the all-in-one Supervisor)** — rejected as primary (kept as a matured fast-follow, above):
  right shape, wrong maturity for a reliability-critical dependency at one day old, single-maintainer
  (`RESEARCH §2`).
- **A bare `child.kill()` with no Job Object** — rejected: it signals only the direct child, orphaning the Node
  process's descendants on quit (`RESEARCH §2` — Windows has no SIGKILL-to-process-group). Job Object
  kill-on-close is the correct, documented primitive.
- **Expecting a graceful POSIX-SIGTERM shutdown handshake on Windows** — rejected as unavailable:
  `Child::kill()` is `TerminateProcess` on Windows (no Node SIGTERM handler runs); the hard-kill via the Job
  Object is the realistic Windows-first shutdown path (`RESEARCH §2`).

---

## ADR-003: CLI integration — the **install** verb + the **run/launch** verb are CLI-ONLY nested verbs under `aof mesh` (siblings to `ui`/`repo`/`assign`, deliberately OUTSIDE the `acd-mesh-command-cli-bijection`), one new command module in the mesh dispatch, packaged + discovered alongside the m28 SEA binary at `$HOME/.aof/bin`

**Status:** Accepted
**Date:** 2026-07-09

**Context.** `SPEC §Scope` requires the app to be **installed AND launched through the `aof mesh` CLI
namespace** — one verb installs it, another runs it — packaged alongside the m28 binary. The graph shows the
mesh dispatch (`meshCommand` in `cli.mjs`) already hosts a family of **CLI-only nested verbs** —
`ui`/`repo`/`assign` — that dispatch as `subcommand === "…"` branches but do NOT register a `mesh:*` command id
(confirmed: `cli.mjs:554/563/572`; each is `commands/*.mjs ← 1 cli.mjs` in the graph). They sit **outside**
`acd-mesh-command-cli-bijection` deliberately, because their flag-bearing / nested faces don't fit the
single-positional `meshVerbCli` / `mesh:<verb>` registry shape (`cli.mjs:548-575` comments; the bijection guard
`test/arch/acd-mesh-command-cli-bijection.test.mjs` DERIVES its sub set from the registry, so a verb with no
registry id is correctly not covered — and must not be, or it would redden the gate with no `cli` adapter).
The m28 installer places the SEA binary per-user at **`$HOME/.aof/bin`** (m28/ADR-006, confirmed at
`28/ARCHITECTURE.md:403`).

**Decision.**

1. **Two new CLI-only nested verbs under `aof mesh`, siblings to `ui`/`repo`/`assign`.** The **install** verb
   (installs/updates the desktop app) and the **run/launch** verb (starts it) are added as additive
   `subcommand === "<verb>"` branches in `meshCommand`, ABOVE the unknown-sub fallthrough (the m22 additive-
   branch idiom), each routing to **ONE new command module** (e.g. `src/commands/mesh-desktop.mjs`) — the exact
   graph shape of `mesh-repo.mjs`/`mesh-assign.mjs` (`← 1 cli.mjs`). They are **NOT** registered `mesh:*`
   commands: they take flags / a nested sub-verb face that does not fit `meshVerbCli`'s single-positional shape,
   so they are **deliberately outside the mesh bijection**, exactly as their three siblings are.
2. **The exact verb spelling is the build story's call**, recorded here as candidates (`desktop install` /
   `desktop run`, or a flat `install-desktop` / `desktop`) — the ARCHITECTURAL invariant is only that they are
   **CLI-only nested verbs with NO `mesh:*` registry id** (fitness `acd-desktop-verbs-outside-bijection`), not
   which noun is chosen. Whichever lands, the guard fires on its dispatch branch.
3. **Packaged + discovered alongside the m28 binary at `$HOME/.aof/bin`.** The desktop app's installer places
   its executable(s) into the SAME per-user install dir the m28 `aof` binary lives in (`$HOME/.aof/bin`,
   m28/ADR-006) — no new install-location decision, joining the existing convention (`RESEARCH §4`). This
   co-location is load-bearing for ADR-004's trusted spawn: the app resolves its sibling `aof` by an absolute
   path in its OWN install dir, no PATH search.

**Consequences.**
- One new command module in the mesh dispatch (`← 1 cli.mjs`), two additive `meshCommand` branches — no
  shared-line edits beyond the additive branch append (the `07/ADR-006` co-touch discipline). **No new `mesh:*`
  registry id is created**, so `acd-mesh-command-cli-bijection` stays green untouched (the R1-recall dividend:
  no registry-derived gate is armed — same as m28/ADR-004's "no new verb" case).
- Fitness **`acd-desktop-verbs-outside-bijection`** (below) protects BOTH halves: it asserts the existing
  `ui`/`repo`/`assign` sibling precedent NOW (a real assertion today), and guard-if-present that the new desktop
  verbs, once dispatched, carry no `mesh:*` id.
- The install verb bundles the WebView2 Evergreen Bootstrapper (ADR-001) and reuses the m28 Authenticode
  signing precedent (ADR-001, m28/ADR-005) — no new signing story.

**Alternatives considered.**
- **Register the verbs as real `mesh:*` commands (`mesh:install`/`mesh:run`)** — rejected: they take flags /
  a nested face incompatible with the single-positional `meshVerbCli` shape, and forcing them into the registry
  would require a `cli` adapter the bijection gate demands but the verb can't cleanly provide — the exact reason
  `ui`/`repo`/`assign` are CLI-only. Follow the established sibling pattern.
- **A separate top-level `aof desktop` namespace (not under `mesh`)** — rejected: `SPEC §Scope` names the
  **`aof mesh`** namespace explicitly ("installed and launched through the `aof mesh` CLI namespace"); the app
  is a mesh companion, so it belongs under `mesh` beside `ui`.
- **A standalone installer outside the aof CLI** — rejected: `SPEC §Objective` requires "a single `aof mesh`
  command installs the app," shipping as part of the same tool alongside the m28 binary.

---

## ADR-004: Supervise-don't-reimplement + read-only + trusted co-located spawn — the app runs NO mesh logic; it reaches fleet data ONLY through `aof mesh status --json` (single path, corrected shape); it NEVER invokes a mesh mutation; it resolves the `aof` binary by an ABSOLUTE co-located path (never bare-PATH). Spawn-safety is the whole local security surface — NO standalone SECURITY.md warranted

**Status:** Accepted
**Date:** 2026-07-09

**Context.** This is the milestone's load-bearing discipline (`SPEC §Objective`/`§Out of scope`,
`DESIGN §Non-negotiable framing`): the app is a **supervisor, not a re-implementation** — `aof` stays the
system of record. `RESEARCH §3` corrected the data contract the app codes against: `aof mesh status --json`
returns **`{ nodes: [...], boards: [...], isControlNode }`** — TWO arrays plus a scalar flag — where
`activeRuns`/`aofVersion` live **nested under each node's optional `presence`** (a node with no heartbeat omits
`presence`), the "this is me" marker is **`node.local: true`** (present only on this node's own entry), and
`node.stale` is a boolean. Coding against the brief's assumed flatter shape would silently fail to parse
`activeRuns`/`aofVersion` and misread which node is local (`RESEARCH §3`, confirmed against
`src/commands/mesh-identity.mjs:270-324` and the live run). `RESEARCH §4` established the spawn-hijack risk and
the aof house trusted-spawn idiom (`src/mesh-fabric.mjs`: shell-less `execFile` argv, bounded timeout,
PATH-first-then-pinned-absolute-fallback), and that co-location makes an absolute sibling path **unambiguous**
— strictly safer than even that precedent, since both binaries install together (ADR-003).

**Decision.**

1. **NO mesh logic in the app.** The Rust app reimplements NONE of aof's mesh machinery — no git record store,
   no tailscale/fabric transport, no relay/stream server, no global-work projection store. Its ONLY path to
   fleet data is **spawning the `aof` binary** and deserializing its output. Encoded as
   **`acd-desktop-no-mesh-logic`** (no Rust source imports a websocket-server / git / SQLite crate family or
   carries a fleet-record schema literal like `global_assignments`).
2. **ONE fleet-data path: `aof mesh status --json`.** Fleet data is read through **exactly one** aof command —
   `mesh status` — never a second data-bearing command (`mesh identity`/`mesh sync`) and never a direct read of
   aof's on-disk record/config store. Both the node/work view AND the `isControlNode` role decision (ADR-002)
   come from this ONE poll (`SPEC §Out of scope` "no second data path," the m25 single-data-command discipline).
   The deserialization matches the **corrected** shape (`RESEARCH §3`): `presence.activeRuns`, `node.local`,
   `node.stale`, top-level `boards[]` + `isControlNode`. Encoded as **`acd-desktop-single-data-path`**.
   (`mesh serve`/`mesh ui` spawns are process LIFECYCLE, not data reads — explicitly allowed by the guard.)
3. **Strictly read-only over the fleet.** The app NEVER invokes a mesh mutation — no `aof mesh assign`, no
   `issue`, no `revoke`, no `invite`/`join`. Assignment stays CLI-only (`aof mesh assign`, milestone 35;
   `DESIGN §Read-only`). The ONLY writes the app performs are **LOCAL process supervision** (spawning
   `serve --serve`/`ui` on THIS machine — ADR-002). Encoded as **`acd-desktop-read-only-fleet`** (the allow-list
   of spawnable `aof mesh` verbs is EXACTLY {status, serve, ui}).
4. **Trusted co-located spawn (the spawn-hijack control — stronger than the fabric precedent).** The app
   resolves the `aof` binary it spawns by an **ABSOLUTE path to its sibling in the SAME install dir**
   (`$HOME/.aof/bin`, ADR-003) — **never a bare-PATH `aof` lookup** (which any earlier malicious `aof.exe` on
   PATH could hijack, `RESEARCH §4`). Because both binaries install together, the sibling path is unambiguous,
   removing the PATH-order ambiguity even aof's own tailscale-spawn (PATH-first-then-pinned-fallback) can't
   fully avoid. Spawns are **shell-less argv** (never `cmd /c` / a shell string — the injection surface).
   Encoded as **`acd-desktop-trusted-spawn`** (no `Command::new("aof")` bare-PATH spawn, no shell-string spawn).

**Security posture — spawn-safety folded here; NO standalone SECURITY.md warranted (recommendation, stated
explicitly).** The app's entire security surface is **local process spawn**: it holds no credentials, opens no
listening socket, performs no network I/O of its own (all fleet reach is through the spawned `aof`), and
performs no fleet mutation (decision 3). The one real risk — a hijacked `aof` binary — is fully controlled by
decision 4 (absolute co-located resolution + shell-less argv) and enforced by `acd-desktop-trusted-spawn`. The
supervised children inherit `aof`'s own already-established security model (the m22–35 mesh machinery), which
this app neither extends nor weakens. **Therefore a standalone `SECURITY.md` is NOT warranted for this
milestone** — the surface is local-spawn, covered completely by this ADR and its fitness function. (Were the
app ever to open a socket, accept remote input, or gain a fleet-mutation affordance, that would flip this
recommendation — but all three are out of scope by `SPEC §Out of scope` + decision 3.)

**Consequences.**
- Four fitness functions armed (below), all **guard-if-present** over the greenfield `app/desktop/` Rust
  subtree — green now (subtree absent, pre-build), each a hard assertion the moment the crate lands (mirroring
  the repo's graceful-degradation ethos). They ARE authored + wired into `scripts/test.mjs` now, so the
  invariant is captured at Decide time without reddening the current suite.
- The corrected-shape deserialization is a **build correctness fact, not a fitness function** — it is verified
  by the node-work-view story's `.feature` (rendering the four DESIGN states from a real `mesh status --json`),
  not a grep. This ADR records the shape so the developer codes against `presence.activeRuns` / `node.local` /
  `node.stale` / top-level `boards`+`isControlNode`, not the flatter assumed shape (`RESEARCH §3`).

**Alternatives considered.**
- **A second data command for role (`mesh identity` / a config read) alongside `mesh status`** — rejected:
  `isControlNode` is already in the `mesh status --json` poll (`RESEARCH §3`), so a second command is redundant
  and violates the single-data-path scope line. One poll feeds both the view and the role decision.
- **Bare-PATH `aof` spawn (simpler, no path resolution)** — rejected as the exact hijack vector `RESEARCH §4`
  describes; co-location makes the absolute path trivial and strictly safer.
- **A standalone SECURITY.md** — rejected (recommendation above): the surface is local-spawn only, fully
  covered by this ADR + `acd-desktop-trusted-spawn`; a separate doc would restate one control.

---

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI. These replace
     "invariant-as-scenario" — they belong here, never in a task feature. Each new arch-test registers in
     scripts/test.mjs (import + push into the suite), strips comments before matching, and carries the m03
     non-vacuous self-check (the detector fires on a planted violation, does NOT fire on the legitimate form).
     GUARD-IF-PRESENT is the correct state now: the Rust subtree (app/desktop/) and the new CLI verbs do not
     exist yet, so four guards are a deliberate no-op until their target lands, and the CLI-seam guard asserts
     the existing sibling precedent today. "From" names the owning story. -->

All five are **authored, wired into `scripts/test.mjs`, and GREEN now** (`npm test` / `node scripts/test.mjs`
confirmed). Four are **guard-if-present** over the greenfield `app/desktop/` Rust subtree (a clean no-op while
absent, a hard assertion the moment the crate lands); the fifth asserts the CLI-seam precedent NOW and
guard-if-present for the new verbs. None is a hollow `test.todo` — each has a live self-check proving the
detector is non-vacuous even before its target exists.

| Invariant | Enforced by (arch-test) | State now | Arms at build (story) |
|---|---|---|---|
| **No mesh logic in the app.** The Rust supervisor reimplements no git store / fabric transport / relay / projection store; fleet data comes ONLY from spawning `aof`. (ADR-004) | `test/arch/acd-desktop-no-mesh-logic.test.mjs` — over `app/desktop/**/*.rs` (Rust comments stripped): no `use tokio_tungstenite`/`tungstenite`/`git2`/`rusqlite`/`sqlx` import, no `global_assignments`/`global_work`/`mesh/nodes/` schema literal. Self-check: a planted `use rusqlite;` / `global_assignments` literal trips it; a commented mention does not. | GREEN (no-op; subtree absent) | **00** supervisor-core |
| **Single fleet-data path.** Fleet data is read ONLY via `aof mesh status` — no second data command, no direct record-store read. `serve`/`ui` spawns are lifecycle, not data. (ADR-004) | `test/arch/acd-desktop-single-data-path.test.mjs` — over `app/desktop/**/*.rs`: no `["mesh","identity"]`/`["mesh","sync"]` argv, no `.aof/mesh/nodes` / `.aof/aof.config.json` direct read; AND (once built) `mesh status` IS invoked. Self-check: a planted `mesh identity` argv / direct record read trips it; `mesh serve`/`mesh ui` do not. | GREEN (no-op; subtree absent) | **00** (+ **02** exercises the shape) |
| **Read-only over the fleet.** The app NEVER spawns a mesh-mutating verb (assign/issue/revoke/invite/join); the spawnable allow-list is exactly {status, serve, ui}. (ADR-004) | `test/arch/acd-desktop-read-only-fleet.test.mjs` — over `app/desktop/**/*.rs`: no argv/string spawn of `mesh assign`/`issue`/`revoke`/`invite`/`join`. Self-check: a planted `mesh assign`/`issue`/`revoke` spawn trips it; status/serve/ui do not. | GREEN (no-op; subtree absent) | **02** node-work-view (+ **01** tray controls) |
| **Trusted co-located spawn.** The `aof` binary is spawned by a resolved absolute co-located path, never bare-PATH, never a shell string. (ADR-004) | `test/arch/acd-desktop-trusted-spawn.test.mjs` — over `app/desktop/**/*.rs`: no `Command::new("aof"/"aof.exe")` bare-PATH spawn, no `Command::new("cmd"/"sh"/"powershell")` shell-string spawn. Self-check: a planted bare-PATH / shell-string spawn trips it; a resolved-path-variable spawn does not. | GREEN (no-op; subtree absent) | **00** (resolution) + wherever the spawn lands |
| **Install/run verbs outside the bijection.** The new desktop verbs are CLI-only nested verbs with NO `mesh:*` registry id — like `ui`/`repo`/`assign`. (ADR-003) | `test/arch/acd-desktop-verbs-outside-bijection.test.mjs` — (A, NOW) `ui`/`repo`/`assign` dispatch in `meshCommand` but register no `mesh:{ui,repo,assign}` id; (B, guard-if-present) the desktop verbs, once dispatched, carry no `mesh:*` id. Self-check: a synthetic registry with `mesh:ui` shows what a leak looks like. | GREEN — half **armed NOW** (sibling precedent), half no-op | **03** cli-install-run |

**Note on what is DELIBERATELY NOT a fitness function (armed at build, not here):**
- **The corrected `mesh status --json` deserialization** (nested `presence.activeRuns`, `node.local`,
  `node.stale`, top-level `boards`+`isControlNode`) is a **build-correctness fact** verified by the
  node-work-view `.feature` against a real `mesh status --json`, NOT a source grep — a Rust JSON-shape assertion
  is a story-02 unit, not an arch invariant.
- **The two DESIGN ramps staying separate** (local-process health vs fleet-presence — `DESIGN §Non-negotiable
  framing`) is a **design-conformance / `@uat` visual-review** concern (`DESIGN §Review notes`), judged against
  the mock + checklist, not a grep.
- **The Job Object kill-on-close / restart-backoff behaviour** (ADR-002) is **observable supervisor behaviour**
  — a `.feature` + `@manual` (spawn a child, kill the supervisor, assert no orphan; crash a child, assert
  restart), NOT a structural grep. It is honestly un-writable as an arch-test until the engine exists; it is
  **armed at build by story 00** as a behavioural scenario, recorded here so the PO places it correctly.

---

## Story breakdown rationale

<!-- Informs the PO's break-down; does NOT itself create stories. The partition follows the real
     call/dependency coupling the codebase graph reports, not inferred coupling. The PO owns the final cut. -->

**Confirmed: the proposed 4-story partition holds, grounded in the graph.** `aof graph build src` → **1491
nodes / 3837 edges, 69 communities, builtAt 2026-07-09**; `aof graph impact` consulted at author time — cited
as **actual** structure, not inferred. The decisive graph fact: **the Rust app (`app/desktop/`) is a greenfield
subtree with ZERO edges into `src/`** — its only coupling to aof is the ARTIFACT boundary (it spawns the
installed `aof` binary). So the four stories couple almost entirely through the Rust crate's OWN internal
dependency (00 is the foundation) — NOT through the aof source graph.

- **00 · supervisor-core** — the Rust crate skeleton + Tauri app lifecycle (ADR-001) + single-instance
  (the first-party plugin) + the spawn/watchdog/restart-with-backoff engine behind the Job Object containment
  seam (ADR-002) + the health/role model + the trusted co-located `aof` resolution (ADR-004 decision 4) + the
  `mesh status --json` poll/deserialize (ADR-004 decisions 1–2). **The foundation** — arms
  `acd-desktop-no-mesh-logic`, `acd-desktop-single-data-path`, `acd-desktop-trusted-spawn` and the Job-Object /
  restart behavioural scenarios. 01 and 02 both depend on it.
- **01 · tray-presence** — the Windows tray icon (healthy/degraded/stopped states, light+dark) + the menu
  (start/stop, open web UI, show/hide, quit — `DESIGN §Surface 2`) + ambient residency (hide-on-close, the
  manual `prevent_close`+`hide` wiring, `RESEARCH §1`). **Depends 00** (renders the health/role model + drives
  the local start/stop through the supervisor engine). Its start/stop menu items exercise the read-only
  allow-list (`acd-desktop-read-only-fleet` — local supervision only).
- **02 · node-work-view** — the native WebView-hosted main window rendering `mesh:status`'s four DESIGN states
  (empty/loading/error/populated), strictly read-only, to `DESIGN §Surface 1`. **Depends 00** (reads the poll'd
  fleet model + role). Arms/exercises `acd-desktop-read-only-fleet` and the corrected-shape deserialization
  `.feature`.
- **03 · cli-install-run** — the `aof mesh` install + run/launch verbs (ADR-003), packaged at `$HOME/.aof/bin`
  alongside the m28 binary. **The seam — independent of the Rust internals** (it is Node-side `cli.mjs` +
  one new command module; `← 1 cli.mjs`, the `mesh-repo`/`mesh-assign` sibling shape). Arms
  `acd-desktop-verbs-outside-bijection` (the guard-if-present half). Couples to 00–02 only at the ARTIFACT
  boundary (it installs + launches the built app), not a source import.

**Why this boundary is graph-grounded, not inferred:**
1. **00 is the Rust-crate dependency root; 01 and 02 are leaves under it.** The tray (01) and the window (02)
   both consume the supervisor-core's health/role model + supervision engine but do NOT depend on each other —
   a tray with no window and a window with no tray each render off the same core. This is the classic
   foundation-then-two-independent-faces shape; 01 and 02 can be built in parallel once 00 lands.
2. **03 is file-disjoint from the Rust subtree AND low-coupled in the aof source graph.** It is a new
   `commands/mesh-desktop.mjs` (`← 1 cli.mjs`, the exact `mesh-repo`/`mesh-assign` shape the graph reports) +
   two additive `meshCommand` branches. It touches NO existing `src/` module's shared lines (the `07/ADR-006`
   co-touch append) and adds no `mesh:*` registry id, so it cannot redden the bijection. It couples to the Rust
   stories ONLY through the artifact it installs/launches — which is exactly why it can be authored in parallel
   with the Rust internals (its `@executable` units are verb dispatch + arg-parse + install-dir resolution over
   a fixture, not a live built app).

**One boundary refinement I would flag (advisory — the PO owns the cut).** The **trusted co-located `aof`
resolution** (ADR-004 decision 4) is the ONE piece that structurally belongs in **00** (it is core supervisor
plumbing — every spawn depends on it) but is CONCEPTUALLY tied to **03**'s install placement (the app is
co-located with `aof` only because 03's install verb puts it there). I recommend the **resolution logic lands
in 00** (so the spawn engine is complete and `acd-desktop-trusted-spawn` arms with the core) while **03 owns
the install placement that MAKES co-location true** — with a thin contract between them (00 resolves "the
sibling `aof` in my own install dir"; 03 guarantees that dir is `$HOME/.aof/bin` with both binaries present).
This keeps 00 self-contained and testable (it resolves a path; a dev/unpackaged run falls back per the
`mesh-fabric` precedent) without waiting on 03. The alternative — putting resolution in 03 — would leave 00's
spawn engine unable to actually spawn until 03 lands, coupling the two unnecessarily. Everything else in the
proposed partition I would cut identically.

The coupling is **advisory**: it informs why supervisor-core (00) + two independent faces (01/02) + a
file-disjoint CLI seam (03) is the right cut (the Rust subtree has zero source edges; 03 is `← 1 cli.mjs`), but
the PO draws the final partition. The graph confirms — it does not dictate.
