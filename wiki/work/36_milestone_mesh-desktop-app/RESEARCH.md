---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Report facts; the architect decides what to do about them (→ ARCHITECTURE.md).
-->
# 36 · Mesh Desktop App — Research

**Gathered:** 2026-07-09
**Method:** This repo as ground truth — `src/cli.mjs`, `src/mesh-launcher.mjs`,
`src/commands/mesh-identity.mjs`, `src/mesh-role.mjs`, `src/mesh-ui-serve.mjs`, `src/mesh-fabric.mjs`,
`bin/aof.mjs`, `scripts/build-sea.mjs`, `scripts/release/stage-release-assets.mjs`; a live run of
`node ./src/cli.mjs mesh status --json` and `node ./src/cli.mjs mesh serve --json` against this
machine's real mesh state (2-node fleet, control node `umairs-msi`, worker `umairs-mac-mini`); the
milestone-28 `ARCHITECTURE.md`/`RESEARCH.md` (packaging precedent) and milestone-33 `ARCHITECTURE.md`
(the launcher/serve-verb model). Rust crate landscape from crates.io/docs.rs/lib.rs pages fetched
2026-07-09 (dated inline — versions move fast; re-check before the architect locks the ADR if this
research goes stale).
**Status:** No blockers found. Two crate ecosystems are viable for the shell choice (Tauri v2 vs
egui+tray-icon); the process-supervision crate landscape is thin and one purpose-built candidate
(`processkit`) is very new (published the day before this research). The `aof` CLI contracts the
supervisor codes against are read, exercised live, and documented below — one correction against the
task brief's assumed shape is noted in §3.

---

## 1. Rust desktop-shell choice — Tauri v2 vs egui/eframe + tray-icon

### Tauri v2

- **Version / maturity.** `tauri` crate is at **2.11.5** (docs.rs, fetched 2026-07-09); the `tauri-cli`
  is at 2.11.4, `tauri-plugin` at 2.6.3 (published ~8 days prior). This is an actively-shipping,
  first-party project (tauri-apps org), not a side crate. [docs.rs/crate/tauri/latest]
- **Windows tray/taskbar fidelity.** Native tray via `TrayIconBuilder` (Tauri wraps the same
  `tray-icon` crate described below — Tauri v1 needed a separate `tauri-plugin-system-tray`; v2 has
  tray support in core). [v2.tauri.app/learn/system-tray/]
- **Ambient tray presence surviving window close.** Documented, common pattern, NOT automatic: you
  must intercept `WindowEvent::CloseRequested`, call `.hide()` + `api.prevent_close()` instead of
  letting the window destroy, and separately handle `RunEvent::ExitRequested` with `prevent_exit()` —
  otherwise Tauri's default is "exit when all windows are destroyed." This is boilerplate the app
  owns, not a toggle. [github.com/tauri-apps/tauri discussion #2684; v2.tauri.app/learn/system-tray/]
- **Single-instance behaviour.** A first-party plugin, `tauri-plugin-single-instance` (**2.4.2**,
  published 2026-05-02, docs.rs), must be registered FIRST (before other plugins) and exposes an
  `init()` callback fired on a second-launch attempt (e.g. to focus/show the existing window) — the
  plugin handles the platform primitive (Windows/macOS/Linux; Linux uses DBus) so the app doesn't
  hand-roll a named mutex. [docs.rs/crate/tauri-plugin-single-instance/latest;
  v2.tauri.app/plugin/single-instance/]
- **Bundle size + runtime deps.** WebView2 is a Windows **runtime dependency** — Tauri does not embed
  a browser engine; it drives the OS-supplied WebView2 (present on Windows 11 by default, but a fresh
  Windows 10 install may lack it). Tauri can bundle the WebView2 **Evergreen Bootstrapper**, adding
  ~1.8 MB to the installer and triggering a runtime download/install on first run if WebView2 is
  absent, OR bundle the full offline WebView2 redistributable (much larger) for zero-network installs.
  Reported binary sizes: ~3–5 MB for a simple app, 10–20 MB for a complex one (vs 100+ MB Electron).
  [oflight.co.jp Tauri v2 bundle-size guide, 2026]
- **Packaging/signing on Windows.** Tauri's own bundler (NSIS `.exe` or WiX `.msi`) invokes
  `signtool` directly, or a custom `signCommand` (e.g. an Azure Key Vault–backed signer, matching the
  same CA/B June-2023 HSM-only rule milestone 28's `RESEARCH.md §4` already established for the
  Node SEA binary) — the SAME signing precedent (Authenticode, HSM/cloud key, no exportable `.pfx`)
  applies here; no new signing story is invented. [v2.tauri.app/distribute/sign/windows/;
  v2.tauri.app/distribute/windows-installer/]
- **macOS/Linux portability.** Tauri already supports macOS (WKWebView) and Linux (WebKitGTK) — a
  later cross-platform tray is a config/target change, not a rewrite, IF the Rust core is written
  against Tauri's abstractions from day one.
- **Tradeoff for a "small custom window" app.** Tauri's rendering IS a webview — the "small native
  view" is actually HTML/CSS/JS running inside WebView2, driven from Rust via IPC commands/events.
  This is a real architectural fork: the UI layer is web technology, not immediate-mode Rust widgets.
  It buys familiar web-dev UI authoring (useful since the SPEC references "user-provided designs" /
  mocks — a designer can hand off HTML/CSS directly) at the cost of a WebView2 runtime dependency and
  an IPC boundary between the supervisor logic and the render layer.

### egui/eframe + tray-icon

- **Versions / maturity.** `tray-icon` is at **0.24.1**, published 2026-06-10 (docs.rs) — this is the
  SAME crate Tauri itself uses internally for its tray (tauri-apps org maintains it), so the two
  options are not fully independent ecosystems. `eframe`/`egui` are actively maintained
  (emilk/egui); could not confirm an exact eframe version via crates.io (JS-rendered page blocked
  direct fetch), but egui's release cadence and community size are well-established — treat this as
  a documented gap, not a blocker (a 5-minute `cargo add eframe` at build time resolves it).
- **Windows tray/taskbar fidelity.** `tray-icon` uses the native `Shell_NotifyIcon` Win32 API on
  Windows directly (no Electron-style shim) and "handles taskbar restart automatically" (the
  `TaskbarCreated` message Explorer broadcasts after an Explorer crash/restart, which a hand-rolled
  tray icon commonly forgets to re-register for). [docs.rs/tray-icon; crates.io search summary,
  2026-07-09]
- **Event-loop threading constraint (load-bearing).** On Windows and Linux, tray-icon's event loop
  must run **on the same thread that created the tray icon** (not necessarily the main thread); on
  macOS both the tray icon AND the event loop must be on the main thread, and the loop must already
  be running before the icon is created. For winit-based apps (which eframe uses under the hood),
  the documented integration is `TrayIconEvent::set_event_handler()` forwarding events into the
  winit loop via `EventLoopProxy`. egui's own community explicitly documents this integration
  (`tray-icon/examples/egui.rs` in the tray-icon repo itself) — this is a supported, not
  experimental, combination. [docs.rs/tray-icon/latest; github.com/tauri-apps/tray-icon
  examples/egui.rs; github.com/emilk/egui discussions #737, #1388]
- **Ambient presence surviving window close.** Same shape as Tauri: NOT automatic. egui/winit apps
  intercept the window's close request (a winit `WindowEvent::CloseRequested`) and hide the window
  instead of dropping it, keeping the tray-icon object alive and the event loop running. This is a
  known, discussed pattern in the egui community (not a built-in toggle either) — egui's own
  discussion threads (#737, #1388) exist specifically because this isn't automatic.
- **Single-instance behaviour.** No first-party plugin bundled with egui/tray-icon (unlike Tauri).
  The generic crate `single-instance` (platform-portable: a named mutex on Windows via
  `CreateMutex` + `GetLastError` check, an abstract Unix socket on Linux, `flock` on macOS) is the
  documented idiom — the app owns wiring it in, one more manual integration than Tauri's plugin.
  [docs.rs/single-instance/latest]
- **Bundle size + runtime deps.** No WebView2 dependency — egui renders via wgpu/glow (GPU) directly,
  so the binary is self-contained (no OS webview runtime to verify/bootstrap). This is the headline
  tradeoff against Tauri: smaller dependency surface on a fresh Windows box, at the cost of authoring
  the UI in immediate-mode Rust (`egui::Ui` calls) instead of HTML/CSS — a real cost if the
  milestone's "user-provided designs" (mocks) are authored as web mockups, since translating a pixel
  mock to egui's layout model is more labor than applying CSS.
- **Packaging/signing on Windows.** No bundler equivalent to Tauri's NSIS/WiX integration ships with
  egui — packaging (installer, Authenticode signing) is hand-rolled or reuses generic tooling
  (`cargo-wix`, a hand-written NSIS script, or the SAME `signtool`/HSM precedent from milestone 28).
  More assembly required than Tauri's built-in bundler, but nothing exotic — it is the identical
  Authenticode signing story either way.
- **macOS/Linux portability.** egui/eframe/tray-icon are all cross-platform crates (winit backend);
  portability is comparable to Tauri's, modulo tray-icon's platform-specific threading rules above
  (macOS needs main-thread discipline either way).

### Comparison summary (facts, not a verdict)

| Axis | Tauri v2 | egui + tray-icon |
|---|---|---|
| Current version (fetched 2026-07-09) | tauri 2.11.5 | tray-icon 0.24.1; eframe unconfirmed exact version |
| UI authoring | HTML/CSS/JS in WebView2, Rust via IPC | Immediate-mode Rust widgets |
| Windows runtime dep | WebView2 (bootstrapper ~1.8MB or bundled) | None — self-contained binary |
| Reported binary size | ~3–20 MB | Smaller (no webview payload); not independently measured here |
| Tray implementation | Wraps the SAME `tray-icon` crate | `tray-icon` directly |
| Ambient-on-close | Manual (`prevent_close`+`hide`+`prevent_exit`) | Manual (hide on `CloseRequested`) — same shape |
| Single-instance | First-party plugin (`tauri-plugin-single-instance` 2.4.2) | Generic crate (`single-instance`), self-wired |
| Windows packaging | Built-in NSIS/WiX bundler + `signCommand`/`signtool` | Hand-rolled (cargo-wix or custom) + `signtool` |
| macOS/Linux portability | Native (WKWebView / WebKitGTK) | Native (winit backend), main-thread tray rule on macOS |
| Mock/design handoff | Direct (HTML/CSS) | Translated to egui layout code |

**Constraint this imposes:** both stacks require the SAME manual "hide-don't-close" wiring for ambient
tray presence — this is not a Tauri-vs-egui differentiator, it is a requirement either way. The real
fork is UI-authoring medium (web vs immediate-mode) and whether a WebView2 runtime dependency is
acceptable on a Windows-first target (WebView2 ships by default on Windows 11 but not guaranteed on
older Windows 10 installs — a doctor-style preflight, mirroring milestone 33's `probeFabric` pattern,
would be the way to surface a missing WebView2, if Tauri is chosen).

---

## 2. Process supervision in Rust on Windows

- **std::process vs tokio::process.** `tokio::process::Command` mirrors `std::process::Command`'s API
  but returns futures that integrate with a Tokio runtime (`.status()`, `.output()`, async
  spawn/wait) — appropriate if the app's event loop (egui's or Tauri's) already runs async I/O
  elsewhere (e.g. polling `aof mesh status --json` on a timer) so the child-process wait doesn't
  block that loop. **Neither `std::process` nor `tokio::process` natively supports supervision**
  (restart-on-exit, backoff) or reaches beyond the DIRECT child — a child's own descendants (e.g. if
  `aof mesh ui`'s Node process itself spawns something) are NOT tracked or cleaned up by either
  primitive alone; only the immediate child is a `Child` handle. [docs.rs/tokio/latest/tokio/process;
  danielmschmidt.de "Managing Child Processes in Rust with Tokio", 2023]
- **Killing the process tree on Windows — Job Objects are the correct primitive.** A bare
  `child.kill()` only signals the direct child; Windows has no SIGKILL-to-process-group Unix
  analogue. The documented, correct mechanism is a **Job Object**
  (`CreateJobObject`/`AssignProcessToJobObject`/`JOBOBJECT_EXTENDED_LIMIT_INFORMATION` with the
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag): assign the spawned child to a job with that flag set,
  and closing/dropping the job handle (including on the supervisor's own crash/exit) kills every
  process in the job, transitively. [learn.microsoft.com/windows/win32/procthread/job-objects]
- **`win32job` crate.** A focused, safe Rust wrapper for exactly this Win32 API. Current version
  **2.0.3**, published 2025-05-15 (docs.rs). Usage shape confirmed from its own docs:
  ```
  let job = Job::create()?;
  let mut info = job.query_extended_limit_info()?;
  info.limit_kill_on_job_close();
  job.set_extended_limit_info(&mut info)?;
  job.assign_current_process()?;   // or assign a spawned Child's process handle
  ```
  This is a Windows-only crate (matches the SPEC's Windows-first scope) — narrow, auditable surface,
  not a general process-management framework. [github.com/ohadravid/win32job-rs;
  docs.rs/crate/win32job/latest]
- **`processkit` — a purpose-built candidate, but very new.** A crate offering exactly this
  milestone's shape out of the box: "async child-process management for tokio: whole-tree
  kill-on-drop (no orphans), plus streaming, pipelines, timeouts, and supervision." Its
  `Supervisor` type accepts a `RestartPolicy` (`Always | OnCrash | Never`), `max_restarts`, and
  configurable exponential backoff (jittered by default). Containment is OS-native per platform — a
  **Job Object on Windows** (the same primitive `win32job` wraps directly), a Linux cgroup v2 (with
  process-group fallback), a POSIX process group on macOS/BSD — "dropping the handle or group reaps
  every descendant, grandchildren included." **Version 2.2.1, published 2026-07-08** (docs.rs) — ONE
  DAY before this research was gathered. Lib.rs shows real adoption signals (3,176 downloads/month,
  used in 10 crates, 33 releases/7 stable, marked "stable — 1.0, feature-complete," single maintainer
  `ZelAnton`/Zhelezniakou Anton, MIT licensed). [docs.rs/crate/processkit/latest;
  lib.rs/crates/processkit; github.com/ZelAnton/ProcessKit-rs]
  - **Constraint this imposes:** `processkit` is exactly the right shape (restart+backoff+Job-Object
    containment in one crate, sparing hand-rolled supervisor code) but its extreme recency (2.2.1 the
    day before this research; the crate itself shows 33 releases suggesting rapid earlier churn) is a
    single-maintainer, un-battle-tested dependency for a "keep the mesh alive" supervisor. The
    lower-risk fallback is composing `tokio::process` (spawn/wait) with `win32job` (Windows tree-kill)
    directly and hand-writing the restart/backoff loop (a few dozen lines) — more code, zero
    unfamiliar-crate risk. Both are viable; this is exactly the kind of tradeoff the architect's ADR
    should record explicitly (crate risk vs hand-rolled surface).
- **The two supervised processes are long-lived, not one-shot — this matters for the design.**
  `aof mesh serve --serve` and `aof mesh ui` both run an internal event loop that resolves only on
  SIGINT/SIGTERM (confirmed by reading `src/cli.mjs`'s `meshServeDaemonCommand` at line 1187 and
  `meshUiCommand` at line 974 — both `await new Promise(resolve => { process.once("SIGINT", ...) ...
  })`), so "detect exit" is a genuine crash/exit signal, not a normal termination the supervisor should
  race to restart. On Windows, Node.js's SIGINT/SIGTERM handling is an emulation over Win32 console
  events / process termination — a supervisor sending a graceful "stop" to these children should
  prefer whatever cross-platform-clean signal Rust exposes (`Child::kill()` sends `TerminateProcess`
  on Windows, which does NOT let Node run its `SIGTERM` handler — there is no true POSIX-style SIGTERM
  delivery on Windows). This is a documented Windows/Node limitation, not a Rust-crate gap — the
  supervisor cannot expect the same graceful-shutdown handshake on Windows that a POSIX `SIGTERM` would
  give it; `TerminateProcess`-style hard-kill via the Job Object is the realistic Windows-first
  shutdown path, and Job-Object kill-on-close already implies exactly that.

---

## 3. Driving the real `aof` commands — the exact contracts (measured, not assumed)

Ran live against this machine's real mesh state (2 nodes: control `umairs-msi` / worker
`umairs-mac-mini`):

### `aof mesh status --json` — one-shot, exit 0, prints ONE JSON document, then returns

```
$ node ./src/cli.mjs mesh status --json
```
returns (elided to shape — full run captured 2026-07-09):
```json
{
  "nodes": [
    {
      "nodeId": "umairs-mac-mini",
      "role": "worker",
      "controlNode": false,
      "host": "Umairs-Mac-mini.local",
      "os": "darwin",
      "runtimes": ["claude", "codex"],
      "aofVersion": "0.1.0",
      "publishedAt": "2026-07-07T19:20:52.437Z",
      "lastSeenAt": null,
      "fabric": { "address": "100.114.105.64", "online": true },
      "recordSource": "node-record",
      "workspaces": [{ "workspaceId": "9db1fd84f5895e38", "name": "aof", "projectRoot": "C:\\Source\\umair\\aof" }],
      "descriptorPath": "C:\\Users\\Umair\\.aof\\mesh\\nodes\\umairs-mac-mini.json",
      "presence": { "nodeId": "umairs-mac-mini", "heartbeatAt": "2026-07-09T10:42:38.557Z", "activeRuns": [], "aofVersion": "" },
      "stale": false
    },
    {
      "nodeId": "umairs-msi",
      "role": "control",
      "controlNode": true,
      "...": "...",
      "stale": true,
      "local": true
    }
  ],
  "boards": [],
  "isControlNode": true
}
```
- **Correction against the task brief's assumed shape.** The brief describes the contract as
  `{ nodes: [...] }` with `nodeId/presence/activeRuns/aofVersion/stale/localId` fields directly on
  each node. The MEASURED shape (confirmed against `src/commands/mesh-identity.mjs:152-326`, the
  `meshStatusCommand` implementation, and the live run above) is:
  - top-level: `{ nodes: [...], boards: [...], isControlNode: boolean }` — TWO arrays, not one, plus a
    scalar flag.
  - `activeRuns`/`aofVersion` live NESTED under each node's `presence` object (when presence exists at
    all — a node with no heartbeat omits `presence` entirely and reads `{ ...base, stale: false }`),
    NOT as top-level node fields.
  - the "this is me" marker is `local: true` (boolean, present ONLY on this node's own entry, omitted
    everywhere else) — NOT a top-level `localId` string field.
  - `role`/`controlNode`/`fabric`/`recordSource`/`workspaces`/`descriptorPath` are additional fields
    the live schema carries that the brief didn't name.
  - **Constraint this imposes:** the Rust supervisor's JSON deserialization must match this MEASURED
    shape (nested `presence.activeRuns`, `node.local` boolean, `node.stale` boolean, the `boards[]` +
    `isControlNode` top-level siblings) — coding against the brief's assumed flatter shape would
    silently fail to parse `activeRuns`/`aofVersion` and misread "which node is local."
- **Exit code / process lifetime:** returns exit 0 immediately (measured, `$?` after the run above);
  prints exactly one JSON document to stdout, no other output on the `--json` path. Safe to invoke on
  a poll timer.

### `aof mesh serve [--serve]` — the SAME subcommand, two lifetimes gated by ONE flag

Read at `src/cli.mjs:585-592` (the `meshCommand` dispatch) and confirmed live:
```
$ node ./src/cli.mjs mesh serve --json
{ "fabricState": "running", "healthy": true, "selfAddress": "100.90.249.80", "peerCount": 1,
  "launcherRunning": false, "launcherPid": null, "issuanceAuthority": true }
```
returned immediately, exit 0 — this is the **non-blocking probe** (`launcherProbe`, `src/mesh-launcher.mjs:179-196`),
routed through the registered `mesh:serve` command (`meshVerbCli`). It reports whether a launcher is
ALREADY running (`launcherRunning`/`launcherPid`, read from a lock file via
`readMeshLauncherLockStatus` — `src/mesh-launcher-lock.mjs`) without itself starting anything.

`aof mesh serve --serve` is a DIFFERENT code path (`src/cli.mjs:1187-1223`, `meshServeDaemonCommand`):
it acquires a launcher lock (refusing with exit 1 + `"AOF mesh launcher is already running (pid N)."`
if one is already held — this IS the supervisor's built-in single-instance guard for the daemon
itself), then calls `startLauncher` (`src/mesh-launcher.mjs:224-426`), which:
- preflights the mesh VPN fabric (`probeFabric`) and REFUSES (prints guidance lines, exit 1, no loop
  started) if the fabric is degraded — never crashes, never half-starts;
- on success, publishes this node's presence, starts a propagation ticker, a peer-poll ticker, and
  (role-dependent) either a control-stream server (control node) or a worker-stream client (worker
  node) — see role determination below;
- BLOCKS in a `Promise` that resolves only on `SIGINT`/`SIGTERM` (`src/cli.mjs:1212-1219`) — this is
  the long-lived face; it never returns while healthy.
- **Constraint this imposes:** the supervisor must distinguish "probe" (`mesh serve --json`, exit
  immediately, tells you IF a launcher is already running) from "daemon" (`mesh serve --serve`, blocks
  forever) — they are the SAME subcommand gated by one flag, not two different verbs. The supervisor
  should probe first (to avoid double-starting into the daemon's own "already running" refusal) OR
  simply attempt the daemon spawn and treat its exit-1-with-that-message as "someone else already has
  it" rather than a crash to restart-loop on.

### `aof mesh ui [--port] [--local]` — always one-shot-that-blocks, never a probe/daemon split

Read at `src/cli.mjs:974-1023` (`meshUiCommand`) — there is no non-blocking-probe variant for this
verb (unlike `mesh serve`). It starts an HTTP server (`serveMeshUi`, `src/mesh-ui-serve.mjs`) then
blocks in the same `SIGINT`/`SIGTERM`-resolved `Promise` pattern. Two failure modes surfaced as clean
exit-1 (not a crash/stack trace) BEFORE the blocking promise: `ui-build-missing` (the `ui/dist` bundle
absent) and `EADDRINUSE` (the chosen port, default 4181, already bound) — both print a one-line
message and return with `process.exitCode = 1`. **Constraint:** the supervisor's crash-vs-clean-exit
classification for this child should treat a fast exit-1 right after spawn as "port conflict / missing
UI assets" (surface the message, don't restart-loop blindly) vs a later, unexpected exit as a real
crash worth the backoff-restart policy.

### Role determination — how the supervisor knows whether to bring up the server

Read at `src/mesh-role.mjs:29-33` — `meshRole(config, nodeId)` is the ONE shared predicate (an
explicit fitness-function-protected invariant in the codebase, `acd-worker-stream-single-predicate`):
```js
export function meshRole(config, nodeId) {
  const controlNode = config?.mesh?.relay?.controlNode ?? null;
  if (controlNode == null || controlNode === "") return "standalone";
  return controlNode === nodeId ? "control" : "worker";
}
```
This reads `config.mesh.relay.controlNode` from the WORKSPACE config, not a CLI flag — there is no
`--role` argument the supervisor can pass. **The measured, CLI-observable proxy the supervisor can
actually use without reading aof's config file itself is `mesh status --json`'s `isControlNode`
top-level boolean** (confirmed present in the live run above: `"isControlNode": true`) — this is a
pure read of the exact same `isControlNode(config)` predicate
(`src/commands/mesh-identity.mjs:279`, `../mesh-registry.mjs`'s `isControlNode`), so the supervisor
does not need to parse `.aof/aof.config.json` itself; it can drive the "bring up the server or not"
decision off the SAME `mesh status --json` poll it already needs for the fleet view — one data
command, as the SPEC's "no second data path" scope line requires. **Constraint:** `aof mesh serve
--serve` should be started on EVERY node (control or worker) per `SPEC.md`'s own framing ("the mesh
server/relay on a control node… and `aof mesh ui`… on both control and worker nodes") — re-reading
`src/mesh-launcher.mjs:262-339`, `startLauncher` itself is role-aware internally (it starts a control
stream SERVER only when `role === "control"`, a worker stream CLIENT only when `role === "worker"`,
and neither when `"standalone"`) — so the supervisor's OWN job is simpler than re-deriving role: launch
`aof mesh serve --serve` unconditionally on a control node (per SPEC scope) and `aof mesh ui`
unconditionally everywhere; the role branching already lives inside the Node process, not something
the Rust supervisor needs to replicate.

---

## 4. Packaging the second binary + safe spawn resolution

### Where the m28 binary lives — the install-directory convention this app joins

Confirmed from `scripts/build-sea.mjs` (comments + `assertSafeOutDir`) and
`scripts/release/stage-release-assets.mjs`:
- The SEA build's local output directory (`dist-sea/` by default) is NOT a bare binary — it is a
  **directory** containing the executable PLUS its sidecars side-by-side: a `bundle/` copy (the ACD
  bundle), a `ui/dist/` copy, a trimmed `package.json` (version stamp), and the node-pty native
  sidecar (`node_modules/node-pty/**` + a `node-pty-sidecar/` companion tree) — confirmed at
  `scripts/build-sea.mjs`'s step comments and `stage-release-assets.mjs`'s header comment describing
  the "beside-the-exe" shape.
- The PUBLISHED release asset names are pinned: `aof-windows-x64.exe` / `aof-windows-arm64.exe` (+
  macOS/Linux equivalents) with a matching `node-pty-<platform>-<arch>` sidecar archive
  (`stage-release-assets.mjs:14-20,ASSET_NAMES`). Milestone 28's `ARCHITECTURE.md` ADR-006 records the
  installer's target: **`$HOME/.aof/bin`** (per-user, no sudo/admin) — this is the SAME directory the
  Rust binary would join as a second installed file, discoverable at a KNOWN, ABSOLUTE, per-user path
  (e.g. `$HOME/.aof/bin/aof-desktop.exe` alongside `$HOME/.aof/bin/aof-windows-x64.exe` renamed on
  install to `aof.exe`, matching whatever the m28 installer's final on-disk name is).
- **Constraint this imposes:** "packaged alongside the m28 binary" has a concrete, already-decided
  target directory to land in — this is not a new install-location decision, it is joining the
  existing `$HOME/.aof/bin` convention (or whatever the m28 installer's ACTUAL final placement is
  post-build — the architect should confirm the exact installed filename against a real `install.ps1`
  run, since `stage-release-assets.mjs` only pins the RELEASE ASSET name, not necessarily the
  post-install PATH-facing name).

### The security reality of resolving `aof` to spawn — PATH is a hijack risk, aof's own codebase
already has the answer

- **The concrete risk.** If the Rust supervisor spawns a bare `"aof"` and relies on the OS to resolve
  it via the `PATH` environment variable, any earlier `PATH` entry containing a maliciously-named
  `aof`/`aof.exe` (a classic Windows PATH-order / DLL-planting-adjacent attack, and the exact class of
  risk Windows' own "unquoted service path" and "PATH hijacking" advisories describe) would execute
  instead of the real binary — especially dangerous here because the spawned `aof` process is handed
  no lower-privilege sandboxing and performs real mesh writes (presence records, git pushes via
  `mesh:sync`).
- **The trusted-resolution pattern already established in THIS codebase.** `src/mesh-fabric.mjs`
  (read at lines 61-113) is the aof project's own precedent for "spawn a trusted external tool
  safely": it calls `execFile("tailscale", args, { timeout, windowsHide: true })` (the shell-less
  argv form — never a shell string, so no shell-metacharacter injection) as the FIRST attempt, and ON
  ENOENT falls back to a small allow-list of `WINDOWS_INSTALL_PATHS`
  (`"C:\\Program Files\\Tailscale\\tailscale.exe"`, `"C:\\Program Files\\Tailscale
  IPN\\tailscale.exe"`), trying each via `execFile(installPath, ...)` with the SAME shell-less,
  timeout-bounded call shape. This is "PATH-first, then a pinned absolute-path fallback list" — NOT
  "trust whatever PATH resolves first," and NOT "trust only PATH."
- **Constraint this imposes — the pattern the Rust supervisor should mirror, stated as a fact, not a
  decision the researcher is making:** the aof project's own idiom for resolving a trusted external
  binary is (a) prefer an absolute, KNOWN install path when one is derivable (here: the Rust binary
  and the Node `aof` binary are installed TOGETHER by the SAME installer into the SAME known directory
  — `$HOME/.aof/bin` — so the Rust supervisor can construct an absolute path to its sibling `aof`
  executable directly, with NO PATH search at all, which is strictly safer than even aof's own
  PATH-first-tailscale pattern since co-location removes the ambiguity tailscale's external,
  independently-installed binary can't avoid); (b) if a co-located absolute path is unavailable for
  some reason (a dev/unpackaged run), a PATH lookup is the documented fallback aof itself uses
  elsewhere, but it is explicitly the FALLBACK, not the primary path, and pairs with a bounded timeout
  + shell-less spawn (no `cmd /c`/shell string) even in the fallback case.

---

## Decision inputs for the architect

**Shell-choice tradeoff (facts recap, no verdict imposed):** Tauri v2 (2.11.5) buys a built-in
Windows bundler, first-party single-instance plugin, and web-technology UI authoring (a natural fit
if the milestone's "user-provided designs" arrive as HTML/CSS mocks) at the cost of a WebView2
runtime dependency and an IPC boundary between Rust supervisor logic and the rendered view. egui +
tray-icon (0.24.1 — the SAME tray crate Tauri wraps) buys a smaller, self-contained binary with no
webview runtime dependency, at the cost of hand-rolling the Windows installer/signing wiring, the
single-instance guard, and translating pixel mocks into immediate-mode layout code. Both require
identical manual "hide-on-close, stay-in-tray" wiring — this is not a differentiator between them.

**Process supervision:** the correct Windows primitive for "kill the process tree on quit" is a
Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — either via the narrow, stable `win32job`
crate (2.0.3, 2025-05-15) composed with hand-written restart/backoff over `tokio::process`, or via
the newer all-in-one `processkit` crate (2.2.1, published literally the day before this research,
single-maintainer) which already bundles Job-Object containment + a `Supervisor` with restart
policy + jittered exponential backoff. This is a real risk/convenience tradeoff worth an explicit
ADR line: `processkit` saves real code but is unproven at this age; `win32job` + hand-rolled
supervision is more code but zero unfamiliar-crate risk for a component whose whole job is
reliability.

**The `aof` CLI contracts are settled facts, not open questions** — `mesh status --json` returns
`{ nodes: [...], boards: [...], isControlNode }` with `activeRuns`/`aofVersion` nested under each
node's optional `presence`, exit 0, one-shot (poll-safe); `mesh serve --json` (no `--serve`) is a
non-blocking probe reporting `launcherRunning`/`launcherPid`; `mesh serve --serve` is the same verb's
long-lived daemon face, self-guarding against double-launch via its own lock file (exit 1 + a named
message on collision); `mesh ui` is always long-lived with two named clean-exit-1 failure modes
(`ui-build-missing`, `EADDRINUSE`) the supervisor should special-case rather than blindly
backoff-restart. Role (control vs worker vs standalone) does not need re-deriving in Rust — it is
already exposed as `isControlNode` in the SAME `mesh status --json` poll, and `startLauncher`
internally branches control/worker/standalone behaviour without the caller needing to know which.

**Binary packaging + safe spawn:** the m28 installer's target (`$HOME/.aof/bin`, per milestone-28
ADR-006) is the existing convention this app's binary would join — not a new location decision.
Spawning the sibling `aof` binary should resolve an ABSOLUTE co-located path first (both binaries
installed together into the same known directory make this unambiguous, stronger than even aof's
own tailscale-spawn precedent), with a PATH-lookup fallback only as a documented last resort,
mirroring `src/mesh-fabric.mjs`'s existing "PATH-first, pinned-absolute-path-fallback,
shell-less-argv, bounded-timeout" idiom for every other trusted external spawn in this codebase.
