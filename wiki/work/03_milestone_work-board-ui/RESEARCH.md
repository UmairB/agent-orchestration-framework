---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Report facts; the architect decides what to do about them (→ ARCHITECTURE.md).
-->
# 03 · Work Board UI — Research

**Gathered:** 2026-06-19
**Method:** vibeyard repo (`elirantutia/vibeyard` @ `main`) — README, `CLAUDE.md`, `package.json`,
and source files `src/main/pty-manager.ts`, `src/main/providers/provider.ts`,
`src/renderer/components/terminal-pane.ts` read via GitHub raw/web; the **npm registry API**
(`registry.npmjs.org`) queried directly for exact versions/publish-dates/install-scripts; the
**published tarballs** of `node-pty@1.1.0` and `@homebridge/node-pty-prebuilt-multiarch@0.13.1`
downloaded and their `prebuilds/` contents listed (decisive for the Windows verdict); the `ws`
docs/registry; and the **local repo** as ground truth — `src/setup-ui.mjs`, `src/work.mjs`,
`ui/package.json`, `src/bundle/commands/feedback.md`, `src/bundle/templates/uat/STATE.md`, item
folder layouts under `wiki/work/`.
**Status:** Desk + tarball-inspection research complete. The node-pty Windows verdict is evidenced
from the actual published binaries (not docs). Two items are genuine **build-time confirmations**
(node-pty actually loading inside Electron-free Node 20+ on *this* machine; a live agent CLI being
present to spawn) — labelled as such, not faked. No blockers found.

---

## 1. vibeyard terminal stack — what is actually reusable

- **Finding — the reusable modules exist and are cleanly layered, but every one of them talks
  Electron IPC, not a socket.** vibeyard is an Electron app (`electron: ^41.0.0`) with a strict
  three-layer split (`CLAUDE.md`): `src/main/` (Node side: PTY, providers, IPC), `src/preload/`
  (`contextBridge` exposing `window.vibeyard`), `src/renderer/` (vanilla TS + xterm UI). The terminal
  capability is three separable pieces:
  - **PTY spawn side** — `src/main/pty-manager.ts`. Imports `import * as pty from 'node-pty'` and
    spawns with: `pty.spawn(shell, spawnArgs, { name: 'xterm-256color', cols: 120, rows: 30, cwd, env })`.
    Lifecycle is `ptyProcess.onData((data) => onData(data))`, `ptyProcess.onExit(({ exitCode, signal })
    => …)`, and guarded `instance.process.write(data)` / `instance.process.resize(cols, rows)` /
    `instance.process.kill()` — every call wrapped in try/catch "to prevent crashes from already-exited
    processes on Windows" (so the module already accounts for win32). IPC handlers dispatch into this
    via `src/main/ipc-handlers.ts`; the create channel is `pty.create`.
  - **xterm render side** — `src/renderer/components/terminal-pane.ts` ("xterm.js wrapper per session").
    `new Terminal({ theme, fontSize, fontFamily, cursorBlink, allowProposedApi: true, linkHandler })`;
    loads `FitAddon`, `SearchAddon`, `WebLinksAddon`, plus WebGL via `loadWebglWithFallback(...)`;
    mounts with `terminal.open(xtermWrap)`. Data flow: PTY→term `instance.terminal.write(data)`;
    term→PTY `terminal.onData((data) => window.vibeyard.pty.write(sessionId, data))`; resize
    `instance.fitAddon.fit()` then `window.vibeyard.pty.resize(sessionId, cols, rows)`.
  - **`CliProvider` abstraction** — `src/main/providers/provider.ts`, registered in
    `src/main/providers/registry.ts` at startup, selected per-session via a `providerId` field on
    `SessionRecord` (defaults to `'claude'`); concrete impl `src/main/providers/claude-provider.ts`.
    The interface is **CLI-shape**, not transport: `readonly meta: CliProviderMeta`,
    `resolveBinaryPath(): string`, `validatePrerequisites(): boolean`,
    `buildEnv(sessionId, baseEnv, opts?): Record<string,string>`, `buildArgs(opts): string[]`,
    `installHooks(win?, projectPath?): Promise<void>`, `cleanup(): void`,
    `getConfig(projectPath): Promise<ProviderConfig>`, `getShiftEnterSequence(): string | null`,
    plus optional cost/transcript helpers. Provider selection feeds `resolveBinaryPath()` +
    `buildArgs()` + `buildEnv()` straight into `pty.spawn(...)`.
- **Finding — the transport is Electron IPC end-to-end; that is the ONE thing that must be replaced.**
  The data path is "Renderer → IPC invoke/send → Main → PTY/fs → IPC send back → Renderer updates
  xterm" (`CLAUDE.md`). `window.vibeyard.pty.write/resize` are `contextBridge`-exposed IPC, and
  `sandbox: false` is set specifically "because node-pty requires direct Node.js access from the main
  process." **There is no `ws` dependency** in vibeyard's `package.json` — it never uses a WebSocket;
  the network module it does ship is WebRTC P2P sharing (out of scope for this milestone per SPEC).
- **Finding — the message shapes to re-home are small and known:** per-session a *data chunk* (string,
  PTY→client), *input* (string, client→PTY → `process.write`), *resize* (`{cols, rows}` →
  `process.resize`), and *exit* (`{exitCode, signal}`, PTY→client). These map 1:1 onto WebSocket
  frames + a tiny JSON control envelope; nothing in the shapes is Electron-specific.
- **Constraint:** Reuse is **port-the-logic, not import-the-package**. Take (a) the `pty.spawn` options
  + `onData`/`onExit`/`write`/`resize`/`kill` lifecycle verbatim, and (b) the `CliProvider` shape
  (`resolveBinaryPath`/`buildArgs`/`buildEnv` → spawn) as the provider seam for claude/codex/gemini —
  but **replace the Electron IPC carrier with a WebSocket** (§3), and replace `window.vibeyard.pty.*`
  with a browser `WebSocket` in the React component (§4). vibeyard is vanilla-TS + Electron; none of
  its files drop in unmodified — the value is the *recipe* (spawn options, event lifecycle, provider
  interface, message shapes), which is MIT-licensed. Do NOT pull vibeyard's WebGL addon or
  `better-sqlite3`/`chokidar`/`gridstack` — they are app-shell concerns, not the terminal seam.
- **Attribution requirement:** vibeyard is **MIT** (README; repo LICENSE). Any adapted code (the
  `pty.spawn` options block, the `CliProvider` interface, the terminal-pane wiring pattern) must carry
  vibeyard's MIT copyright notice. This is a hard licence obligation, not optional.
- **Source:** `elirantutia/vibeyard` README + `CLAUDE.md`; `src/main/pty-manager.ts`,
  `src/main/providers/provider.ts`, `src/renderer/components/terminal-pane.ts`, `package.json` (read
  via GitHub raw/web, 2026-06-19); https://github.com/elirantutia/vibeyard.

## 2. node-pty on Windows — the highest-risk dependency, resolved by inspecting the binaries

- **Finding (decisive, from the published tarball — treat as ground truth over docs):**
  **`node-pty@1.1.0` (latest, published 2025-12-22, MIT, maintained by Microsoft) BUNDLES prebuilt
  Windows binaries in its npm tarball — no node-gyp, no Visual Studio Build Tools, no download.** The
  `prebuilds/` directory in `node-pty-1.1.0.tgz` contains, for **`win32-x64`** (and `win32-arm64`,
  `darwin-x64`, `darwin-arm64`): `pty.node`, `conpty.node`, `conpty_console_list.node`,
  `conpty/conpty.dll`, `conpty/OpenConsole.exe`, `winpty.dll`, `winpty-agent.exe`. The `install`
  script is `node scripts/prebuild.js || node-gyp rebuild`, and `scripts/prebuild.js` (read from the
  tarball) **only checks `fs.existsSync(prebuilds/<platform>-<arch>)` and `process.exit(0)`** — it
  does not download and does not compile; node-gyp is the *fallback* that fires only if the prebuilt
  dir is absent (i.e. on an unsupported platform/arch). The runtime loader (`lib/utils.js`) resolves
  from `build/Release`, `build/Debug`, then `prebuilds/<platform>-<arch>`.
- **Finding (why it's ABI-safe):** the win32 binary is a **single `pty.node` per platform, NOT keyed
  by Node ABI** — node-pty 1.1.0 builds against **N-API / `node-addon-api: ^7.1.0`** (confirmed in its
  `binding.gyp` + `dependencies`), so one prebuilt binary works across Node 20 / 22 / 24 without a
  per-version rebuild. This is the modern, low-risk path.
- **Finding (the common fork is WORSE here — important):** `@homebridge/node-pty-prebuilt-multiarch`
  (latest `0.13.1`, published 2025-07-03, `engines: node >=18 <25`) was the historical "prebuilt to
  avoid node-gyp" recommendation, but its `0.13.1` tarball ships **only `linux-*` prebuilds
  (`linux-arm`, `linux-arm64`, `linux-ia32`, `linux-x64`) — there is NO `win32-x64` directory at
  all**, and its binaries are old-style ABI-keyed (`node.abiNNN.node`) relying on `prebuild-install`
  to fetch from GitHub releases at install time. On Windows it would fall through to a network fetch
  and/or node-gyp. So for **this repo's win32 platform, upstream `node-pty@1.1.0` is strictly better
  than the homebridge fork.** (`@lydell/node-pty`, latest `1.2.0-beta.12`, splits per-platform
  optional-dependency packages incl. `@lydell/node-pty-win32-x64` — viable but currently **beta**.)
- **Constraint (verdict): FEASIBLE-AS-IS with `node-pty@1.1.0` (the upstream Microsoft package).** On
  win32-x64 it installs from the bundled N-API prebuilt with no build toolchain. Do **not** reach for
  the homebridge fork (no Windows prebuilt in 0.13.1) and do **not** assume node-gyp is needed.
  `node-pty` is a **server-side (`src/setup-ui.mjs` / Node) dependency**, not a `ui/` browser
  dependency — it must be added to the aof root `package.json`, whose `engines.node` is `>=20`
  (root `package.json`), which N-API node-pty supports. The one residual is a **build-time
  confirmation** (A2): that the prebuilt `pty.node` actually loads and spawns a child on this exact
  machine/Node — a `pty.spawn` smoke test resolves it; it is routine, not a blocker.
- **Source:** `registry.npmjs.org/node-pty` (`latest 1.1.0`, time `2025-12-22T13:51:43Z`, install
  `node scripts/prebuild.js || node-gyp rebuild`, dep `node-addon-api ^7.1.0`, MIT); contents of
  `node-pty-1.1.0.tgz` `prebuilds/win32-x64/*` and `scripts/prebuild.js` + `lib/utils.js` (downloaded
  and listed, 2026-06-19); `registry.npmjs.org/@homebridge/node-pty-prebuilt-multiarch` (`0.13.1`,
  `engines node >=18 <25`) + its tarball `prebuilds/` listing (linux-only, **no win32-x64**);
  `registry.npmjs.org/@lydell/node-pty` (`1.2.0-beta.12`); root `package.json` `engines.node >=20`.

## 3. WebSocket on the existing `node:http` server (one server, two surfaces)

- **Finding:** `src/setup-ui.mjs` is a bare `http.createServer(...)` bound to `127.0.0.1`
  (`setup-ui.mjs:19`, `:136`) that already multiplexes static `/ui` files and `/api/*` JSON routes in
  one request handler. The standard, minimal way to add a terminal WebSocket to *this same server/port*
  is the **`ws` library `noServer` + `server.on('upgrade', …)`** pattern: create
  `new WebSocketServer({ noServer: true })`, listen for the HTTP `upgrade` event, route by
  `new URL(request.url, 'ws://127.0.0.1').pathname`, and on a match call
  `wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))`; on a non-match
  `socket.destroy()`. The `upgrade` event is a **separate channel from the normal request handler**, so
  it coexists cleanly with the existing static + `/api/*` handler — HTTP requests never reach the
  upgrade path and vice-versa. They share the one server returned by `serveSetupUi`, so the board's
  HTTP routes and the terminal WS are guaranteed same-origin, same-port (the SPEC/DESIGN requirement).
- **Finding (`ws` maturity):** `ws@8.21.0` (latest, published 2026-05-22, MIT, **zero runtime
  dependencies**, `engines: node >=10`). It is **pure JavaScript** (its two native addons —
  `bufferutil`, `utf-8-validate` — are *optional* perf-only `optionalDependencies`, not required to
  install or run), so it adds no native-build risk on top of node-pty. It is the de-facto Node
  WebSocket server, well suited to a localhost-only (127.0.0.1) single-user server.
- **Constraint:** Add **`ws` as a server-side dependency** and extend the existing `serveSetupUi`
  server via `server.on('upgrade', …)` with `noServer`/`handleUpgrade` — do **not** stand up a second
  HTTP server or a second port for the terminal. Pathname-route the upgrade (e.g. `/ws/terminal`) so
  it sits alongside the `/api/*` namespace. Because it is 127.0.0.1-only and single-user there is no
  auth surface (matches DESIGN.md §Intent: "no auth"), but the upgrade handler should still reject
  unknown pathnames (`socket.destroy()`) — that is the `ws` pattern's default branch, not extra work.
  Whether to extend `setup-ui.mjs` or factor a sibling `board-ui` server is the architect's call; the
  *fact* is that one `http.createServer` can carry both surfaces with no conflict.
- **Source:** `src/setup-ui.mjs:19,118-134,136`; `registry.npmjs.org/ws` (`8.21.0`, time
  `2026-05-22T17:59:59Z`, deps `{}`, `engines node >=10`, MIT); ws `noServer`/`handleUpgrade` upgrade
  pattern — https://github.com/websockets/ws#multiple-servers-sharing-a-single-http-server.

## 4. xterm frontend packages + React 19 integration

- **Finding (package names/versions — note the scope migration):** the current packages are the
  **`@xterm`-scoped** ones (the old unscoped `xterm` / `xterm-addon-*` are deprecated). Latest, all MIT,
  all zero-dependency, all published 2025-12-22: **`@xterm/xterm@6.0.0`**, **`@xterm/addon-fit@0.11.0`**
  (auto-size to container), **`@xterm/addon-web-links@0.12.0`** (clickable URLs). vibeyard additionally
  uses `@xterm/addon-search@0.16.0` and `@xterm/addon-webgl@0.19.0`; for this milestone fit + web-links
  are the minimum, webgl is optional polish. These are **`ui/` (browser) dependencies**, added to
  `ui/package.json` (React 19 + Vite 6 already present) — distinct from the server-side `node-pty`/`ws`.
- **Finding (React 19 mount pattern):** the standard pattern is a function component with a container
  `ref` + a single `useEffect`: inside the effect, `new Terminal({...})`, `term.loadAddon(new
  FitAddon())` + `new WebLinksAddon()`, `term.open(containerRef.current)`, `fitAddon.fit()`; open the
  `WebSocket`, then wire **WS→term** via `socket.onmessage = e => term.write(e.data)` (text or
  `ArrayBuffer`/Blob binary frames) and **term→WS** via `term.onData(d => socket.send(d))`; on resize
  `fitAddon.fit()` then `socket.send(JSON.stringify({type:'resize',cols,rows}))`; the effect's cleanup
  returns `() => { socket.close(); term.dispose(); }` to tear down on unmount. This is exactly
  vibeyard's `terminal-pane.ts` flow (§1) with `window.vibeyard.pty.*` swapped for the browser
  `WebSocket`. React 19 StrictMode double-invokes effects in dev, so the cleanup (`term.dispose()` +
  `socket.close()`) is load-bearing, not optional.
- **Constraint:** Add `@xterm/xterm@^6`, `@xterm/addon-fit@^0.11`, `@xterm/addon-web-links@^0.12` to
  **`ui/package.json`**. Mount per the ref+effect+dispose pattern; the data envelope must agree with
  the server's WS handler (§3): raw data frames for PTY bytes both directions, a small JSON control
  message for `resize` (and the server emits an `exit`/`{exitCode}` control message the component
  renders as the dock's "exited (N)" state per DESIGN.md §4). Today `ui/src/` is scaffold only
  (`components/ui/*`, `main.tsx`) — there is no terminal component yet, so this is greenfield in the UI.
- **Source:** `registry.npmjs.org/@xterm/xterm` (`6.0.0`), `/@xterm/addon-fit` (`0.11.0`),
  `/@xterm/addon-web-links` (`0.12.0`) — all MIT, deps `{}`, time `2025-12-22`; vibeyard
  `src/renderer/components/terminal-pane.ts` (addon set + `term.write`/`term.onData`/`fitAddon.fit`
  flow); `ui/package.json` (React `^19`, Vite `^6`); `ui/src/` listing (scaffold only).

## 5. Reading item docs for the detail panel (the one place doc bodies are read)

- **Finding:** `src/work.mjs` is deliberately content-free for listing — its header comment states
  "resolution and listing **never need to read content**" (`work.mjs:1-7`), and `listItems(workDir)`
  enumerates by **folder name only** (`work.mjs:57-87`). Each returned item carries a **`dir`**
  absolute path (`work.mjs:64,79`) — top-level items at `workDir/NN_type_slug`, stories at
  `workDir/NN_milestone_slug/stories/SS_story_slug`. The detail panel is the **one place that DOES read
  doc bodies**, and the per-item doc filenames are fixed by convention (`work.mjs recordDoc`,
  `:89-94`, + verified against real item folders):
  - **milestone** item dir contains `SPEC.md` (the record doc), plus `STATE.md`, `ARCHITECTURE.md`,
    `VERIFICATION.md`, and — when the milestone has been retro'd — `RETROSPECTIVE.md`
    (verified: `wiki/work/00_milestone_work-cli/` has SPEC/STATE/ARCHITECTURE/VERIFICATION;
    `wiki/work/01_milestone_acd-asset-bundle/RETROSPECTIVE.md` exists). The full milestone doc set the
    panel may surface is fixed by the templates: `wiki/templates/milestone/` =
    `SPEC, STORY-less, ARCHITECTURE, DESIGN, RESEARCH, SECURITY, COMPLIANCE, STATE, UAT` (RETROSPECTIVE
    is created at retro time, not a template).
  - **story** item dir contains **`STORY.md`** (the record doc; `recordDoc` returns `STORY.md` for
    stories — `work.mjs:91`) and a `tasks/` dir of `*.feature` files (verified:
    `wiki/work/02_.../stories/00_story_planning-init/STORY.md`; `wiki/templates/story/STORY.md`).
  - **uat** item dir contains **`SESSION.md`** (record doc) + `STATE.md` (`recordDoc` → `SESSION.md`,
    `work.mjs:92`).
- **Finding (the panel's doc set vs the record doc):** DESIGN.md §2 says the detail panel shows
  **SPEC|STORY / VERIFICATION / RETROSPECTIVE / Findings**. The server locates these by joining the
  item's `dir` (from `listItems`) with the literal filename: `SPEC.md` (or `STORY.md` for stories),
  `VERIFICATION.md`, `RETROSPECTIVE.md`. `work.mjs` does NOT expose a "read this doc body" helper —
  the only content reads it does are `parseFrontmatter`-via-`readMeta` (frontmatter only,
  `work.mjs:124-132`). So the detail-panel doc-body read is **new server work**, layered on top of the
  `dir` that `listItems`/`findWork` already return (`findWork` returns `dir` per row, `work.mjs:172`).
- **Constraint:** The detail panel's file resolution is `path.join(item.dir, '<DOC>.md')` where `<DOC>`
  is `SPEC`/`STORY` (by type), `VERIFICATION`, `RETROSPECTIVE`. The server must treat **doc-absent as a
  normal empty state, not an error** (DESIGN.md §2: a not-started item legitimately has no
  RETROSPECTIVE/VERIFICATION) — i.e. an `ENOENT` read is "No RETROSPECTIVE yet," consistent with how
  `readMeta` swallows missing files (`work.mjs:129-131`). "Findings" are not a file: they are the
  `aof:verify`-triaged finding rows (the design surfaces them as a tab) — their source is a doc section
  (e.g. VERIFICATION/STATE), an architect decision on which section, not a new on-disk file. Reuse the
  `dir`/`ref`/`type` already serialized by `aof work list --json`; do not re-glob the filesystem.
- **Source:** `src/work.mjs:1-7,57-87,89-94,124-132,172`; `wiki/work/00_milestone_work-cli/` and
  `wiki/work/01_milestone_acd-asset-bundle/RETROSPECTIVE.md` listings; `wiki/templates/milestone/`,
  `wiki/templates/story/STORY.md`; DESIGN.md §2.

## 6. The action seam (feedback / validate / next) — in-process, exports confirmed

- **Finding (validate / next are exported in-process functions, no shelling-out needed):** `src/work.mjs`
  exports both:
  - **`export async function validateWork(workDir, config, scopeRef)`** (`work.mjs:252`) — returns an
    array of `{ path, problem }` findings (deterministic folder↔frontmatter / tag-vocabulary / depends
    checks). The board's "Validate" action can call this directly; it maps onto DESIGN.md §3's
    `StatusLine`/`ValidationPanel` rows (path · problem).
  - **`export async function nextWork(workDir, scopeRef)`** (`work.mjs:377`) — returns
    `{ state: 'ready'|'blocked'|'done', ref, type, slug, status, path, [waitingOn] }`. The board's
    "Next" action calls this directly; its three states are exactly the ramp DESIGN.md §3 specifies
    (ready / blocked-with-`waitingOn` / done).
  - Supporting exports also present: `loadWorkspace` (`work.mjs:32` — yields `{config, workDir, …}` the
    above need), `listItems` (`:57`), `findWork` (`:140`). So the server can derive `workDir`/`config`
    from `loadWorkspace(projectDir)` once and call `validateWork`/`nextWork` **in-process** — no child
    `aof` CLI process required for validate/next.
- **Finding (feedback append target — exact section, located in the bundle):** "Add feedback" appends
  to the item's **STATE `## Feedback (for retro)`** section. The contract is authored in
  **`src/bundle/commands/feedback.md`** — for a milestone/story it routes to that item's `STATE.md`
  `## Feedback (for retro)` (`feedback.md:25-26`), appending **one attributed bullet**: the note,
  `Raised by: <actor>`, optional `Refs:` (`feedback.md:39-41`). The section's canonical shape lives in
  the templates: **`src/bundle/templates/uat/STATE.md:23-30`** (and `wiki/templates/uat/STATE.md`) —
  heading `## Feedback (for retro)` with the bullet form
  `- <note> — Raised by: <actor>   Refs: <ADR / scenario / commit>`. (Note: `feedback.md` also routes a
  **uat** item's feedback to `SESSION.md` `## Findings` instead — out of scope for the board's three
  actions, which target milestone/story items, but the architect should be aware the route is
  type-dependent.) **There is no `appendFeedback`-style export in `src/work.mjs`** — feedback today is
  performed by the agent following `feedback.md`, not by a code function. So the board's feedback append
  is **new server work**: locate `path.join(item.dir, 'STATE.md')`, ensure/append under the
  `## Feedback (for retro)` heading using the exact bullet format above.
- **Constraint:** Validate and Next are a clean **in-process function seam** (`validateWork`/`nextWork`
  from `src/work.mjs`) — the board server imports them, not a `child_process` shell-out, which keeps
  results structured and avoids a CLI round-trip. **Add-feedback has NO existing function** — it must
  be implemented as a STATE-file mutation that (a) targets the item's `STATE.md`, (b) creates the
  `## Feedback (for retro)` section if absent (matching the template heading verbatim), and (c) appends
  one bullet in the documented `- <note> — Raised by: … Refs: …` format — mirroring what
  `src/bundle/commands/feedback.md` instructs the agent to do, so the board and the slash-command stay
  consistent. The append must be the *only* mutation the board performs (status is derived, never
  written — DESIGN.md §"No drag-to-restatus").
- **Source:** `src/work.mjs:32,57,140,252,377` (the exported signatures + return shapes);
  `src/bundle/commands/feedback.md:25-26,33,39-41`; `src/bundle/templates/uat/STATE.md:23-30`;
  DESIGN.md §3; absence of any `feedback`/`append` export confirmed by reading `src/work.mjs` in full.

---

## Assumptions to confirm

<!-- CI-testable vs live-only (the latter become @manual / @uat checks). -->

**CI-testable (`@executable`)**

- **A1 — `aof work list --json` serializes exactly `{ ref, type, slug, status, title, parent, dir }`
  per item** (the board's data contract). Confirm with a fixture work-stream + a snapshot/string
  assertion on the JSON. Testable in CI: **yes** (the data comes from `listItems`/`findWork`, both
  deterministic and content-free for listing).
- **A3 — WS upgrade coexists with `/api/*` + static on one server.** Stand up `serveSetupUi` (or its
  successor) with the `ws` `noServer`/upgrade route added, then assert: a GET `/api/...` still returns
  JSON, a GET static path still serves the file, AND a WS handshake to `/ws/terminal` succeeds — same
  port. Testable in CI: **yes** (in-process http + a `ws` client; no native build, no real PTY needed
  if the connection handler is stubbed).
- **A5 — detail-panel doc resolution + doc-absent is empty-not-error.** Against a fixture item `dir`,
  assert SPEC/STORY/VERIFICATION/RETROSPECTIVE resolve by `path.join(dir, '<DOC>.md')` and that a
  missing RETROSPECTIVE yields an empty/placeholder result (ENOENT → empty), not a thrown error.
  Testable in CI: **yes** (filesystem fixtures).
- **A6 — Validate/Next in-process + feedback append.** Assert `validateWork`/`nextWork` return the
  documented shapes against fixtures, and that the new add-feedback writer appends a correctly-formatted
  bullet under `## Feedback (for retro)` in a fixture `STATE.md` (creating the section if absent).
  Testable in CI: **yes** (pure functions + a temp-file mutation assertion).

**Live-only / developer-run (`@manual`) and human (`@uat`)**

- **A2 — `node-pty@1.1.0` installs from its bundled win32-x64 prebuilt and `pty.spawn` actually spawns
  a child on this machine/Node 20+.** Build-time confirmation, not a guess: the prebuilt `pty.node`
  *exists in the tarball* (§2), but "it loads and forks a real PTY here" is only provable by running
  `npm install node-pty` + a `pty.spawn(shell, [], {...})` smoke test. **`@manual`** (developer/agent
  run). Routine — node-pty 1.1.0 is N-API + ships the Windows binary; this is a verify-the-happy-path
  step, **not a blocker**.
- **A4 — end-to-end terminal stream.** With node-pty (server) + ws (server) + xterm (browser) wired,
  Run-agent against a selected item spawns the chosen provider and the dock streams
  idle→connecting→running→exited, with input echoing and resize working. Requires the real wiring +
  an installed agent CLI on PATH. **`@uat`** (human watches the agent run and confirms the loop).
- **A7 — a provider CLI is actually present to spawn.** The `CliProvider.resolveBinaryPath()` seam
  assumes `claude`/`codex`/`gemini` is installed; spawning a missing binary must surface as the dock's
  *error* state (DESIGN.md §4), not a crash. Confirm per-machine which providers exist
  (`resolveBinaryPath` + `validatePrerequisites`). **`@manual`**, environment-dependent.

---

## Decisions this unblocks

- **server-extend-vs-new** → §3 + §5/§6. One `http.createServer` (the `setup-ui.mjs` shape) can carry
  static + `/api/*` + a `ws` upgrade with no conflict; validate/next are in-process exports of
  `src/work.mjs`. *Architect decides:* extend `setup-ui.mjs` vs a sibling `board-ui` server, and the
  WS pathname namespace. (Facts: both surfaces share one server/port cleanly; no second port needed.)
- **node-pty package choice** → §2. *Architect decides:* pin `node-pty@1.1.0` (upstream Microsoft,
  N-API, bundled win32-x64 prebuilt — the evidenced low-risk choice) and NOT the homebridge fork (no
  Windows prebuilt in 0.13.1) and NOT the `@lydell` beta. Server-side dependency, root `package.json`.
- **WS transport** → §3 + §1. *Architect decides:* `ws@8` with `noServer` + `server.on('upgrade')`,
  routing PTY data frames + a JSON `{resize}`/`{exit}` control envelope — the re-homed replacement for
  vibeyard's Electron IPC carrier.
- **provider seam** → §1. *Architect decides:* port vibeyard's `CliProvider` interface
  (`resolveBinaryPath`/`buildArgs`/`buildEnv` → `pty.spawn`) + per-session `providerId` selection for
  claude/codex/gemini, under aof's MIT-attribution obligation; what to do about a missing provider
  binary (dock error state).
- **doc-read paths** → §5. *Architect decides:* the detail panel reads `path.join(item.dir, '<DOC>.md')`
  for SPEC/STORY/VERIFICATION/RETROSPECTIVE (doc-absent = empty, not error), and which doc section the
  "Findings" tab draws from. Reuses `dir` from `aof work list --json`; new doc-body read layered on
  `work.mjs` (which intentionally has none today).
- **feedback append** → §6. *Architect decides:* a new STATE-file writer appending one attributed
  bullet under `## Feedback (for retro)` (per `feedback.md` + the `uat/STATE.md` template format),
  since no `appendFeedback` export exists — the board's only write, status stays derived.
