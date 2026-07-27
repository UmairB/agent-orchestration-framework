# PRD — Web UI Restructure (terminals-first)

> Planning PRD for the web-UI restructure arc. Upstream of ACD: this document is the seam
> `aof:shatter` consumes to lay out the milestone roadmap. Prior art for the *home surface* is
> [ogulcancelik/herdr](https://github.com/ogulcancelik/herdr) — an **agent multiplexer**: named panes
> in a grid, per-pane agent state (blocked / working / done), sessions that persist independently of
> the viewer, and mouse-and-keyboard interaction. herdr is a single Rust TUI binary with no web
> client, so what this arc adopts is its **model**, not its code or stack.

## Objective

**Objective.** Invert the web UI's centre of gravity: make the **live terminals of the fleet** the
home screen, demote fleet management to its own `/fleet` route, and collapse the two-and-a-half
terminal implementations into **one reusable, resizable terminal control** used everywhere a terminal
appears.

Today `ui/` is not an application — it is three unrelated pages sharing one bundle, selected by a
query parameter at the render root ([main.tsx:1261-1267](../../ui/src/main.tsx#L1261-L1267)):
`?mode=fleet` → `<Fleet>`, `?mode=board` → `<Board>`, anything else → the config editor `<App>`.
There is no router, no shell, no navigation between them, and the one thing an operator actually
watches — an agent working — is buried two levels down as a per-card peek. The fleet page renders
*everything the mesh knows* (every workspace, every milestone, every node) with no way to narrow to
the repo in hand, and the terminal itself exists twice: a read-write local-PTY dock on the board
([TerminalDock.tsx](../../ui/src/board/TerminalDock.tsx)) and a read-only worker mirror on the fleet
([FleetTerminalView.tsx](../../ui/src/fleet/terminal-view/FleetTerminalView.tsx)), each with its own
xterm wiring, its own connection-state ramp, and its own socket-URL builder — with the dock having
already grown a `remote` session kind that re-implements the mirror a third time.

The payoff is three axes. First, **attention**: the home screen answers "what is every machine in my
fleet doing right now, and let me get into it" in one view instead of a card drill-in per assignment.
Second, **control**: a terminal you can type into and a session you can start against a chosen repo —
the fleet UI is currently a monitor with exactly one verb (`assign`). Third, **coherence**: one
terminal control, one connection-state vocabulary, one resize behaviour, reused by the terminals home,
the board dock and the fleet cards, so a fix lands once. The arc is foundation-first — routing and the
terminal primitive are enablers the surface work consumes — and its riskiest step is explicit: making
terminals interactive **reverses a load-bearing, test-enforced security invariant**, so it gets its own
de-risk spike before any code.

## Context & Constraints

- **No router exists; the "route" is a query param at the render root.** `main.tsx` reads
  `?mode=` (or `VITE_AOF_UI_MODE`) and renders one of three roots. A `/fleet` path route is therefore
  net-new plumbing, not a re-wire.
- **Both static servers will 404 a client-side path on refresh.** The fleet server
  ([mesh-ui-serve.mjs:746](../../src/mesh-ui-serve.mjs#L746)) and the board/setup server
  ([setup-ui.mjs:272](../../src/setup-ui.mjs#L272)) each resolve a request as
  `pathname === "/" ? "index.html" : pathname.slice(1)` — a literal file lookup. `/fleet` deep-linked
  or refreshed is a 404 until both grow an SPA history fallback. This is in scope, not incidental.
- **Three origins, and the boundary is already leaking.** The fleet/control UI is a **fixed** port
  (`:4181`), the control stream is `:4182`, and each board is a **separate per-workspace server on an
  ephemeral port** ([board-serve.mjs](../../src/board-serve.mjs)). The read-write PTY route
  (`/ws/terminal?ref=&provider=`, [terminal-ws.mjs](../../src/terminal-ws.mjs)) lives **only** on the
  board server; the read-only mirror (`/ws/terminal-view?nodeId=&sessionId=`) lives **only** on the
  fleet server. The board dock already hard-codes `FLEET_PORT = 4181` to reach across
  ([TerminalDock.tsx:77](../../ui/src/board/TerminalDock.tsx#L77),
  [:433-438](../../ui/src/board/TerminalDock.tsx#L433-L438)). A terminals home on the fleet origin must
  decide this boundary deliberately rather than accumulate more hard-coded ports.
- **The read-only mirror is a decision, not an omission — and it is asserted.** ADR-014 invariant 1 /
  SECURITY T14 make the terminal-view socket **server→browser only**: the route registers no
  `ws.on("message")` sink ([mesh-ui-serve.mjs:564-567](../../src/mesh-ui-serve.mjs#L564-L567)), the
  view registers no `onData` and constructs xterm with `disableStdin: true`, and
  [test/arch/acd-fleet-terminal-mirror-read-only.test.mjs](../../test/arch/acd-fleet-terminal-mirror-read-only.test.mjs)
  asserts that structural absence. "Each terminal should be interactable" is a **deliberate reversal**
  of that invariant across an inter-machine relay. It needs an ADR amendment, a fresh threat model, and
  the arch-test rewritten from *no sink exists* to *the sink is authenticated, bounded and audited*.
- **A node's live sessions carry no routable id.** The mirror routes strictly on the
  `(nodeId, sessionId)` tuple ([mesh-terminal-mirror.mjs](../../src/mesh-terminal-mirror.mjs)), and the
  only place a `sessionId` reaches the browser today is on an **assignment** record. The presence
  record's `sessions[]` is `{ workspaceId, repo, assistant, lastPingAt }`
  ([api.ts:15-20](../../ui/src/fleet/api.ts#L15-L20)) — no session id, no pid, nothing addressable. So
  a terminals home can render today's `working · <repo> (session)` text
  ([fleet/runs.mjs](../../ui/src/fleet/runs.mjs)) but **cannot open a terminal on it** until session
  identity is on the wire. This is the true foundation of the home screen.
- **There is no "start a terminal" verb anywhere in the fleet.** `/api/mesh/assign` dispatches a *work
  item* plus a lifecycle phase (`refine | continue | verify | autonomous`,
  [mesh-assignment-directive.mjs:28](../../src/mesh-assignment-directive.mjs#L28)) to a node; it cannot
  open a bare shell. `terminal-ws.mjs` spawns PTYs but only on a board server, only inside that
  server's `projectDir`, and only for a resolved item `ref`. "New session bound to a repo/project" is a
  new capability on both faces.
- **The fleet face's write surface is bounded on purpose.** `/api/mesh/assign` is the *one* mutation;
  everything else is read-only, and that is fixed by
  [mesh-ui-read-only-contract.test.mjs](../../test/mesh-ui-read-only-contract.test.mjs) and
  [mesh-ui-write-isolation-bounded.test.mjs](../../test/mesh-ui-write-isolation-bounded.test.mjs). New
  routes (spawn a session, send input) must be **named additions to that allowlist**, so the bound
  stays a bound instead of quietly becoming "the fleet is writable now".
- **The fleet shows everything, and the only narrowing is scope.** `GlobalScopeView`
  ([Fleet.tsx:372-388](../../ui/src/fleet/Fleet.tsx#L372-L388)) renders all workspaces, all milestone
  cards, all nodes; `?scope=global|local` only means "the whole mesh" vs "the daemon's own workspace".
  Every card already carries workspace identity (`workspaceId`, `name`, `projectRoot`) — the filter key
  exists, the filter does not.
- **The fleet card's footer geometry is hard-won; do not disturb it casually.** Region 5 carries an
  explicit yield order settled across design gaps DG-13…DG-22 and locked by
  [fleet-assign-row-geometry.test.mjs](../../test/fleet-assign-row-geometry.test.mjs). A repo filter is
  in fact *relief* here (a filtered view can drop the workspace-name column) — but the assign row's
  membership is fitness-locked and must be treated as a contract.
- **Two terminal implementations already disagree on geometry.** The board dock fits xterm to the pane
  (`FitAddon.fit()` + a resize frame up the socket); the fleet mirror pins xterm to the worker's fixed
  80×24 and CSS-transform-scales it, because the worker's `claude` TUI paints with absolute cursor
  addressing ([mesh-worker-execution.mjs](../../src/mesh-worker-execution.mjs)) and fitting garbles it.
  **Both behaviours are correct for their source.** The one terminal control must therefore be
  parameterised by *session source*, not unified into a single sizing rule — "resizable and responsive"
  means the control fits when the far end can be told to resize, and scales when it cannot.
- **The house has no React test harness.** Every fleet/board surface keeps its logic in framework-free
  `.mjs` helpers beside the component (`ui/src/board/terminal/*.mjs`, `ui/src/fleet/*.mjs`) so
  `node:test` can drive it headlessly. New UI logic follows that pattern; it is not optional here.
- **What herdr contributes, precisely.** The model: sessions are **named, persistent and viewer-
  independent** (detach/reattach is normal); the home surface is a **grid of panes** you can focus,
  split and rearrange; each pane advertises **agent state** (blocked / working / done) so a fleet is
  scannable at a glance; interaction is **both** keyboard and mouse. What it does not contribute: a
  Rust TUI, tmux prefix-key parity, its socket API, or its plugin marketplace.

## Scope

### In scope

- **Path routing and one app shell.** Real URL routes — `/` (terminals), `/fleet`, and the board's
  existing surface — behind a shared shell (top bar, group chip, scope/nav), with an **SPA history
  fallback** added to both static servers and back-compatible redirects from the current `?mode=`
  links (including `/api/mesh/board-url` consumers and the desktop app's entry URLs).
- **One terminal control, reused everywhere.** A single component + framework-free state helpers,
  parameterised by session source (`local-pty` | `mirror` | `interactive-remote`), owning: xterm
  lifecycle, the connection-state ramp (one vocabulary, colour never alone), fit-vs-scale geometry,
  viewport-responsive sizing, drag-resize, and expand-to-fullscreen. The board dock and the fleet card
  peek are **re-homed onto it**; `TerminalDock`'s `remote` kind and `FleetTerminalView`'s duplicate
  wiring are deleted, not kept in parallel.
- **Routable session identity.** A stable session id (and the repo/workspace it belongs to) on the
  presence record and in a fleet-side session index, so any live session on any node can be addressed
  as `(nodeId, sessionId)` **without** going through an assignment record — plus the lifecycle
  (appears, ends, expires) the home screen renders.
- **The terminals home screen.** A responsive grid of every live session across the fleet: node, repo,
  work item when there is one, agent state, and a live pane. Focus / expand / close, keyboard and
  mouse, layout persisted per operator. Read-only first — it is useful before it is interactive.
- **Interactive terminals.** The ADR-014 reversal: a browser→control→worker input path with an
  authenticated, bounded, audited sink; input permitted only for sessions the operator's node is
  entitled to; the arch-test rewritten to assert the new invariant; explicit read-only fallback when a
  session cannot accept input, stated as a label, never as a silently dead pane.
- **New session bound to a repo/project.** A "new session" affordance on the terminals home that picks
  a **node + repo/workspace** (and optionally an item ref), a named spawn route added to the fleet
  face's bounded write allowlist, and the worker-side directive that opens a PTY in the chosen
  repo/worktree and registers it with a routable id.
- **`/fleet` with repo filtering.** The existing fleet surface moved to its own route and given a
  first-class repo/workspace filter — persisted in the URL alongside `?scope=`, applied consistently to
  workspaces, milestone cards and nodes, with an honest empty state and a visible "filtered by" chip.

### Out of scope

- Porting herdr: no Rust binary, no TUI, no tmux prefix-key parity, no socket API for agents to spawn
  panes, no plugin marketplace.
- Replacing or absorbing the board. Boards stay per-workspace on their own origin and keep their own
  route; the terminals home links to them, it does not swallow them.
- Multi-user auth, accounts or RBAC. The posture stays single-operator over the existing mesh
  credential; the interactive path is gated by that credential, not by a new user system.
- Re-skinning the config editor (`<App>`), or reworking the Rust desktop app's own views beyond the
  entry URLs the routing change touches.
- Making the fleet face generally writable. The write allowlist gains **named** entries and stays
  bounded, with its isolation tests intact.
- Terminal scrollback persistence / session replay. The mirror is ephemeral by design (ADR-014); a
  durable transcript store is a separate arc (see below).

## Milestones

> Foundation-first. Routing and the terminal primitive are enablers; the repo filter is an independent
> quick win that only needs routing; session identity gates both surface milestones; the interactive
> path is gated by its own de-risk spike.

- **spike: interactive-terminal-safety** — a de-risk driver, **not** a code milestone. Settle whether
  and how the ADR-014 server→browser-only invariant is reversed: the input path (browser → control →
  relay → worker PTY stdin), what authenticates and bounds it, what is audited, what the replacement
  arch-test asserts, and what the fallback is when a session must stay read-only. **Blocking unknown
  gating `interactive-terminals`.** Deliverable: a recorded finding + the ADR amendment shape.
- **ui-app-shell-routing** — the foundation. Introduce URL-path routing and a shared app shell; add the
  SPA history fallback to both static servers; redirect the legacy `?mode=` entries; keep every current
  surface reachable and byte-identical in behaviour. Everything below needs a `/fleet` to move to and a
  `/` to build on.
- **terminal-control-unification** — extract the ONE terminal control (component + framework-free
  helpers), parameterised by session source, responsive and resizable; re-home the board dock and the
  fleet card peek onto it and delete the duplicates. **Depends on `ui-app-shell-routing`** (shares the
  shell's layout primitives).
- **fleet-repo-filter** — move the fleet surface to `/fleet` and give it repo/workspace filtering,
  URL-persisted beside `?scope=`, applied to every region, with the assign-row geometry contract
  intact. **Depends on `ui-app-shell-routing`**; independent of everything else — the earliest visible
  win.
- **fleet-session-identity** — put a routable session id (plus repo/workspace attribution and
  lifecycle) on the presence record and in a fleet-side session index, so any live session is
  addressable without an assignment. Wire-shape change: additive, TTL-filtered, never a second source
  of truth. **The enabler for both surfaces below.**
- **terminals-home** — the herdr-modelled home screen at `/`: a responsive grid of live fleet sessions
  with node / repo / item / agent-state and a live pane each, focus + expand + close, persisted layout,
  honest empty and degraded states. Read-only. **Depends on `terminal-control-unification` and
  `fleet-session-identity`.**
- **interactive-terminals** — make the panes typeable: the input path, its gate, its audit, the
  rewritten arch-test, and the explicit read-only fallback. **Depends on the
  `interactive-terminal-safety` spike and on `terminals-home`.**
- **session-launcher** — "new session" bound to a **node + repo/project** (optionally an item ref): the
  named spawn route on the fleet face's bounded allowlist, the worker-side PTY-open directive, and
  registration of the new session with a routable id so it appears in the grid like any other.
  **Depends on `fleet-session-identity` and `interactive-terminals`** (a session you cannot type into
  is not worth spawning).

## Open decisions (settle during refinement, not blocking this PRD)

- **Where the terminals home is served.** Recommended: the **fleet origin** (`:4181`) — it is the one
  fixed, always-running, fleet-wide port, and it already hosts the mirror. Consequence: local board
  PTYs must become reachable through the relay/control path rather than by the browser dialling an
  ephemeral board port directly, which also retires the hard-coded `FLEET_PORT` in the dock.
- **Grid vs. list-plus-focus at scale.** herdr's grid assumes a handful of panes. A fleet with many
  live sessions may want a list with one focused pane. Recommended: build the grid, but make "how many
  panes render live sockets at once" an explicit, bounded number rather than an emergent one.
- **Whether `?scope=global|local` survives the repo filter.** A repo filter subsumes most of what
  `scope=local` is used for. Recommended: keep both initially (scope is a deep-link contract with
  existing consumers) and revisit once the filter has soak time.

## Adjacent techniques (separate arcs — captured, not scoped here)

- **Durable session transcripts.** The mirror is ephemeral: a browser that subscribes late sees an
  empty pane, and a closed session cannot be reviewed. A bounded, per-session transcript store would
  make the terminals home *historical* as well as live — and would feed `aof work observe`, which
  already reads `~/.claude/projects` transcripts for stall/token diagnostics. → an observability arc.
- **A stall watchdog on the terminals home.** The known gap that a refine "taking hours" is usually a
  **stalled** agent, not a slow one, has no recovery affordance anywhere. Per-pane idle detection with
  a nudge/restart control is a natural home-screen feature but is its own behavioural arc (it decides
  what "stalled" means and what recovery is safe). → a run-resilience arc.
- **An agent-facing session API.** herdr's socket API lets *agents* spawn panes and wait on each
  other's dependencies. aof's equivalent would be command-core operations for session spawn/attach —
  interesting, but it belongs with the orchestration arc, not with the web UI.
