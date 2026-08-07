---
type: spike
number: 44
slug: terminal-origin-boundary
title: "Terminal origin boundary — where a pane's socket comes from"
status: done
owner: architect
created: 2026-08-02
updated: 2026-08-06
depends: []
timebox: 2d
origin: ../../planning/PRD-web-ui-restructure.md
schema: 1
aofVersion: 0.1.0
---
<!--
  SPIKE.md — the record doc for a de-risk spike. Answers ONE question:
  is the unknown resolved, and what did we find?
  A spike is a TOP-LEVEL DRIVER that groups no stories and carries no behavioural contract — no
  tasks/, no .feature. Its whole deliverable is a RECORDED FINDING; the code it produces (if any) is
  a throwaway prototype, never shipped as-is. "Done" = ## Finding is filled and the unknown is
  resolved (aof:verify checks exactly this). It gates the stream: 46 and 49 wait on it.
-->
# 44 · Terminal origin boundary — where a pane's socket comes from

## Question

**Can a terminals home served from the fleet origin (`:4181`) reach a local board PTY through the
relay/control path — and should it — or must the browser keep dialling the board's ephemeral port
directly?**

This is the PRD's own open decision #1 ([PRD](../../planning/PRD-web-ui-restructure.md)), promoted to
a gating spike because it is not a preference: it decides the *session-source* parameterisation that
milestone 46 extracts, and it decides whether milestone 49's grid can render a local-PTY pane at all.
Getting it wrong is a rewrite of the one terminal control, not a tweak.

The concrete shape of the unknown, as the tree stands on 2026-08-02:

- The read-write PTY route (`/ws/terminal?ref=&provider=`, [terminal-ws.mjs](../../../src/terminal-ws.mjs))
  lives **only** on a board server — one per workspace, on an **ephemeral** port
  ([board-serve.mjs](../../../src/board-serve.mjs)).
- The mirror route (`/ws/terminal-view?nodeId=&sessionId=`) lives **only** on the fleet server, on the
  **fixed** `:4181`, and its input path is already fitness-locked to a tuple-bound seam
  ([acd-fleet-terminal-input-constrained.test.mjs](../../../test/arch/acd-fleet-terminal-input-constrained.test.mjs)).
- The board dock already reaches **across** the boundary with a hard-coded constant
  (`FLEET_PORT = 4181`, [TerminalDock.tsx:78](../../../ui/src/board/TerminalDock.tsx#L78),
  [:440](../../../ui/src/board/TerminalDock.tsx#L440)) — the leak this spike either legitimises or retires.

Sub-questions the finding must answer, not dodge:

1. **Discovery.** A fleet-origin page holds `(nodeId, sessionId)`. How does it learn a board's
   ephemeral port — or does it never need to, because the relay carries the bytes? `/api/mesh/board-url`
   is today's answer for *links*; is it an answer for *sockets*?
2. **The local node's own PTYs.** The relay is an inter-machine path. Is routing the control node's own
   board PTYs through it a needless hop, an acceptable uniformity win, or a deadlock (the control node
   relaying to itself)?
3. **The bounded write allowlist.** `/api/mesh/assign` is the fleet face's ONE mutation, fixed by
   [mesh-ui-read-only-contract.test.mjs](../../../test/mesh-ui-read-only-contract.test.mjs) and
   [mesh-ui-write-isolation-bounded.test.mjs](../../../test/mesh-ui-write-isolation-bounded.test.mjs).
   Does a relayed local-PTY path add a **named** allowlist entry, or does it ride the existing
   terminal-view socket (which is an upgrade, not an API route, and so sits outside that contract)?
4. **Geometry follows origin.** A relayed local PTY can still be told to resize; a worker mirror cannot
   (the worker's `claude` TUI paints with absolute cursor addressing,
   [mesh-worker-execution.mjs](../../../src/mesh-worker-execution.mjs), so it is pinned 80×24 and
   CSS-scaled). Confirm the fit-vs-scale rule keys off *far-end resizability*, not off transport — and
   that the answer here doesn't collapse the two into one wrong rule.
5. **The fallback.** If the answer is "browser dials the board port directly", what does the terminals
   home render for a board it cannot reach (a different machine's board, a stopped board)? A labelled
   unavailable pane, never a silently dead one.

## Timebox

- Box: `2d` — stop and record the best-available finding at the boundary. If the relay path is
  unproven at 2d, the finding is **"direct-dial, with the FLEET_PORT constant made configuration"**
  plus the recorded reason, and 46 parameterises for both so the decision stays reversible. A timebox
  extension requires explicit re-scoping.

## Investigation

<!-- Throwaway-prototype notes as the spike runs: what was tried, what broke, what surprised. Scratch
     work, not a deliverable — keep it, don't polish it. -->

Ran 2026-08-06, on the **Mac** (`darwin`), not the Windows control node — so everything below is
source-analysis plus an in-process prototype against the REAL `attachTerminalWebSocket` /
`dispatchDirectiveOverTargets`, never a live two-machine soak. Timebox used: well inside `2d`.

### The prototype

A throwaway probe (scratchpad, not committed) stood up a real `http.createServer` +
`attachTerminalWebSocket` on an **ephemeral** port with a stubbed PTY, then dialled it with an
`Origin: http://127.0.0.1:4181` header — i.e. exactly what a terminals home served from the fleet
origin would do. Measured, verbatim:

```json
{
  "boardEphemeralPort": 64855,
  "crossOriginUpgradeAccepted": true,
  "framesReceived": ["hello from pty\r\n", "echo:typed input\r"],
  "ptyResizeApplied": [[143, 41]],
  "ptyInputApplied": ["typed input\r"],
  "dispatchToSelf": { "sent": false, "code": "assignment-target-not-connected" }
}
```

Three things fell out of that one run:

1. **The cross-origin dial just works.** Neither server registers a `verifyClient` or reads `Origin`,
   and a WebSocket upgrade is not subject to CORS preflight. Bytes flowed both ways.
2. **The board PTY is resizable over that socket** — `resize(143, 41)` reached the far end. The
   mirror lane has no resize at all, by construction (below). So the two lanes stay distinguishable.
3. **`dispatchDirective` to a node with no admitted stream connection is a silent `sent:false`** —
   which is the control node's own permanent state (below).

### What surprised me — a real defect, found by accident

The FIRST resize, sent **immediately on `open`** (111×11), never reached the PTY. Only the one sent
400 ms later did — see `ptyResizeApplied` above holding exactly one entry. Cause:
[terminal-ws.mjs](../../../src/terminal-ws.mjs) registers `ws.on("message")` at
[:306](../../../src/terminal-ws.mjs#L306), inside `wireSession`, which runs only **after**
`loadWorkspace` + `trustCwd` + `await spawn(...)`. Frames that arrive before that are dropped on the
floor — no buffer, no error.

`TerminalDock` does precisely this today: `socket.onopen = () => { sendResize(); }`
([:214-215](../../../ui/src/board/TerminalDock.tsx#L214-L215)). It self-heals only because the
`ResizeObserver` fires again later. A terminals home opening N panes at once hits it N times, and a
pane that never resizes again keeps the wrong geometry. Routed to 46 in `## Outcome / Next` — it is
not this spike's question, but it is squarely in the path of the answer.

### Two stale premises in this spike's own framing, corrected at source

- The spike cites `test/mesh-ui-write-isolation-bounded.test.mjs`. **That file does not exist.** The
  real gate is [test/arch/acd-mesh-ui-write-isolation.test.mjs](../../../test/arch/acd-mesh-ui-write-isolation.test.mjs).
- `wireTerminalBridge` ([mesh-terminal-relay-bridge.mjs:187](../../../src/mesh-terminal-relay-bridge.mjs#L187))
  is described everywhere as the worker-side output bridge, but **nothing in `src/` calls it** — grep
  finds its own definition and `test/mesh-terminal-relay-bridge.test.mjs`, nothing else. Production
  streams through `onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(...)`
  ([mesh-launcher.mjs:1152](../../../src/mesh-launcher.mjs#L1152), [:1291](../../../src/mesh-launcher.mjs#L1291)).
  It is dead production code with a live fitness function pointed at it.

### Gates confirmed green before reasoning about them

```
node --test test/arch/acd-fleet-terminal-input-constrained.test.mjs   → 1 pass
node --test test/mesh-ui-read-only-contract.test.mjs                  → 1 pass
```

## Finding

<!-- THE DELIVERABLE. The recorded finding/decision that resolves ## Question. "Done" = this section
     is filled and the unknown is resolved — aof:verify checks exactly this. -->

### The answer

**The browser keeps dialling the board directly — and the board's origin stops being a guess.**

A terminals home served from `:4181` reaches a local board PTY by opening
`ws://<board-origin>/ws/terminal?ref=&provider=`, cross-origin, exactly as it does today. It does
**not** route those bytes through the relay. What changes is not the socket but the *port*: today the
boundary is crossed by a hard-coded constant in the opposite direction (`FLEET_PORT = 4181`,
[TerminalDock.tsx:78](../../../ui/src/board/TerminalDock.tsx#L78)); after this finding, **each side
learns the other's origin as a served fact**, and no terminal surface holds a port literal.

This is the timebox's stated fallback ("direct-dial, with the `FLEET_PORT` constant made
configuration") — but it is **not** reached by running out of time. It is the positively-argued answer:
the relay path for local PTYs is not merely unproven, it is structurally absent in *both* directions,
and the direct path is already proven in production in the mirror direction.

### Sub-question 1 — Discovery: the fleet origin already knows the board's port

A fleet-origin page never has to *discover* an ephemeral port, because **the fleet process starts the
board itself**. `GET /api/mesh/board-url?workspaceId=&ref=`
([mesh-ui-serve.mjs:278](../../../src/mesh-ui-serve.mjs#L278)) resolves the workspace and calls
`boardUrlForWorkspace` ([:740](../../../src/mesh-ui-serve.mjs#L740)), which lazily runs
`serveBoard({ projectDir: workspace.projectRoot, port: 0 })` and **memoises the server per
`workspaceId`** in an in-process `Map`, closing it with the fleet server.

So the answer to "is `/api/mesh/board-url` an answer for *sockets* as well as *links*?" is **yes — the
mechanism is right, the shape is wrong.** The route returns a page URL
(`http://127.0.0.1:PORT/?mode=board#ref`), so a socket consumer would have to string-parse an origin
out of a URL built for navigation. 46 should take the origin as a **first-class additive field on the
same route's JSON body**, over the same lazy-launch seam — no new route, no new discovery mechanism,
and no addition to the fleet face's mutation surface (it is already a `GET`).

### Sub-question 2 — The local node's own PTYs: not a hop, a dead end. Rejected.

Routing the control node's own board PTYs through the relay is neither "a needless hop" nor "a
deadlock". It is **structurally impossible in both directions today**, and making it possible means
building a loopback worker.

**Input direction — cannot arrive.** `createTerminalInputRouter` routes by
`dispatchDirective({ to: nodeId })` ([mesh-terminal-input.mjs:94](../../../src/mesh-terminal-input.mjs#L94)),
which resolves against `directiveTargets` — a map populated **exclusively** inside
`wss.on("connection")`, i.e. only by admitted *worker* stream connections
([control-stream-server.mjs:957](../../../src/control-stream-server.mjs#L957)). And roles are
**exclusive**: `meshRole` returns `control | worker | standalone`
([mesh-role.mjs:29-33](../../../src/mesh-role.mjs#L29-L33)), and the launcher's control branch
([mesh-launcher.mjs:862](../../../src/mesh-launcher.mjs#L862)) is `else if`-ed against the worker
branch that builds the stream client ([:1034](../../../src/mesh-launcher.mjs#L1034)). **A control node
holds no stream connection to itself.** Measured: `{ sent: false, code:
"assignment-target-not-connected" }`. Not a crash — a *silent drop*, which is worse.

**Output direction — is never produced.** `onTerminalFrame` fires only when an admitted worker socket
sends a `terminal-frame` ([control-stream-server.mjs:1219](../../../src/control-stream-server.mjs#L1219)).
A board PTY spawned by `terminal-ws.mjs` emits nothing onto the mesh at all: its `term.onData` goes
straight to its own WebSocket ([terminal-ws.mjs](../../../src/terminal-ws.mjs)), and — see
Investigation — `wireTerminalBridge` has **no production caller anywhere**.

So "uniformity" would cost: a self-dialling stream client on the control node, a self-admission
credential path through a boundary whose whole design is *admission is the trust boundary* (T5), and a
second producer wired into `wireTerminalBridge`. Three new mechanisms, one of which deliberately
punches a hole in the mesh's admission model — to replace a socket that already works and is already
interactive. **Rejected.** `local-pty` relayed is not a session source; it should not be built.

### Sub-question 3 — The bounded write allowlist: no new named entry

Direct-dial adds **nothing** to the fleet face's write surface. `POST /api/mesh/assign` remains the one
mutation. Checked at source:

- [acd-mesh-ui-write-isolation.test.mjs:131](../../../test/arch/acd-mesh-ui-write-isolation.test.mjs#L131)
  asserts `mesh-ui-serve.mjs` declares no `"/ws/terminal"` literal — and it still doesn't; the existing
  `/ws/terminal-view` is a different literal and already coexists with a green gate.
- [mesh-ui-read-only-contract.test.mjs](../../../test/mesh-ui-read-only-contract.test.mjs) row 04
  dials `/` and row 05 dials `/ws/terminal` and `/`. Neither enumerates an upgrade *allowlist*; both
  assert that specific paths are refused. Direct-dial adds no upgrade path to the fleet face at all —
  the socket it opens is on the **board** server, which has always served `/ws/terminal`.
- Extending `/api/mesh/board-url`'s response body is additive on an existing `GET`. The read-only
  contract's own assertion is that every `/api` request on the wire is a GET poll of the status
  route — a `GET` of `board-url` is already outside that count today (it is a drill-in, not the
  poll), so nothing there moves either.

The relayed alternative would have been the one that costs: a `local-pty` relay lane needs the input
router to route to a node that is not a stream client, which is a change to the **admission** model,
not to an API allowlist. That is the real reason to prefer direct-dial on this axis.

### Sub-question 4 — Geometry keys off far-end resizability, and direct-dial keeps it that way

Confirmed, and the two rules do **not** collapse:

| Session source | Far end | Control frames | Geometry |
|---|---|---|---|
| `local-pty` (board origin, `/ws/terminal`) | a PTY this server owns | `{type:'resize'}` → `term.resize` | **fit** |
| `mirror` (fleet origin, `/ws/terminal-view`) | a worker's `claude` TUI, absolutely addressed | none | **scale**, pinned 80×24 |

Evidence: the prototype's `resize(143, 41)` reached the board PTY *over a cross-origin socket* — so
resizability is a property of the far end, not of which origin served the page. The mirror lane cannot
carry a resize even in principle: `buildTerminalInputEnvelope` carries only opaque bytes
([mesh-terminal-relay-bridge.mjs](../../../src/mesh-terminal-relay-bridge.mjs)), the input lane is
content-blind and bounded at `MAX_TERMINAL_INPUT_BYTES`
([mesh-ui-serve.mjs:160](../../../src/mesh-ui-serve.mjs#L160)), and the dock's `sendResize` early-returns
for a remote session ([TerminalDock.tsx:203](../../../ui/src/board/TerminalDock.tsx#L203)) against a
terminal fixed at 80×24 ([:168](../../../ui/src/board/TerminalDock.tsx#L168)).

**The rule 46 encodes: fit ⇔ the session source exposes a resize control frame; scale otherwise.** Keyed
on the source's own declared capability, never on transport and never on "is it remote". Direct-dial is
what *keeps* this honest — a relayed local PTY would have been a resizable far end on a transport with
no resize lane, which is exactly the case that collapses the two rules into one wrong one.

### Sub-question 5 — The fallback: reachability is a per-pane fact, and one guard is missing today

Direct-dial makes "can this pane's origin be reached" a real per-pane question. Three distinct cases;
**only one is handled today, and the handled one is on the wrong route.**

1. **Workspace not checked out on this machine.** `POST /api/mesh/assign` already refuses with a named
   409 `workspace-not-local` after an `existsSync(row.projectRoot)` probe
   ([mesh-ui-serve.mjs:423](../../../src/mesh-ui-serve.mjs#L423)), with a comment stating the rule
   outright: *"A refusal must name its own cause."* **`/api/mesh/board-url` has no such guard.** It
   calls `serveBoard` on a `projectRoot` that may not exist here; `serveBoard` only checks that
   `ui/dist/index.html` exists ([board-serve.mjs:48](../../../src/board-serve.mjs#L48)), so it
   *succeeds* — handing back a live board URL for a directory that isn't there, whose every
   `/api/work` read then fails. **49 must copy assign's guard onto `board-url` before rendering a pane
   from it.** This is the concrete gap this sub-question was asking about.
2. **A board that isn't running.** For a *local* workspace this cannot happen under the memoised-launch
   seam — the route starts one on demand. It remains possible for a board started outside the fleet
   process, and for a socket that opens and then dies.
3. **A different machine's board.** Out of reach by construction, and correctly so: a session on
   another node is a `mirror` pane, not a `local-pty` pane. That is the session-source split doing its
   job, not a hole.

**The rule: a pane whose origin cannot be resolved renders a labelled unavailable state that names its
cause** — `not checked out on this machine` / `board unreachable` — never a blank pane, never a
silently dead one. This is the same discipline the mirror already keeps, where a worker's end-of-stream
closes the browser socket so the pane reads ENDED rather than `streaming` forever
([mesh-ui-serve.mjs](../../../src/mesh-ui-serve.mjs), DESIGN §Surface 3 V9).

### Why direct-dial is safe to commit to (the premise under all of it)

The cross-boundary socket is not novel — **it already ships, in the mirror direction.** The board dock,
served from an ephemeral origin, dials the fixed `:4181` `/ws/terminal-view` today
([TerminalDock.tsx:440-445](../../../ui/src/board/TerminalDock.tsx#L440-L445)) and types into it.
Direct-dial is that same cross-origin WebSocket with the endpoints swapped, and the prototype confirms
the swap is symmetric: no `Origin` check, no CORS preflight, bytes and control frames both ways.

**And it stays reversible**, which is what the timebox asked for. Because both lanes are addressed by
an **origin** rather than a port constant, adding a relayed local-PTY lane later is a new entry in the
session-source table, not a rewrite of the terminal control.

## Outcome / Next

<!-- What this finding unblocks — which milestone(s) depend on this spike, and what they should do
     differently (or not) as a result. -->

- **46 · terminal-control-unification** — the session-source list is **two entries, not three**:

  | source | socket | interactive | geometry |
  |---|---|---|---|
  | `local-pty` | `ws://<boardOrigin>/ws/terminal?ref=&provider=` | yes | **fit** (far end resizes) |
  | `mirror` | `ws://<fleetOrigin>/ws/terminal-view?nodeId=&sessionId=` | yes (since m42) | **scale**, fixed 80×24 |

  `local-pty` **relayed does not exist and must not be built** (sub-question 2). Three consequences
  for 46:
  1. Parameterise the control on an **origin**, not a port. `FLEET_PORT = 4181`
     ([TerminalDock.tsx:78](../../../ui/src/board/TerminalDock.tsx#L78)) is retired by the board being
     *handed* the fleet origin, symmetrically to how the fleet page is handed the board origin —
     falling back to the configured/default `4181` when the board is started standalone via
     `aof work ui`. No terminal surface keeps a port literal.
  2. Encode geometry as **fit ⇔ the source declares a resize control frame**, on the source
     descriptor — never on transport, never on an `isRemote` boolean.
  3. **Fix the dropped-first-frame race** found here (Investigation): `terminal-ws.mjs` registers
     `ws.on("message")` at [:306](../../../src/terminal-ws.mjs#L306) only after `loadWorkspace` +
     `trustCwd` + `spawn`, so `TerminalDock`'s `socket.onopen -> sendResize()`
     ([:214-215](../../../ui/src/board/TerminalDock.tsx#L214-L215)) is silently discarded. Measured:
     an on-open `resize(111,11)` never reached the PTY; the same frame 400 ms later did. Buffer
     pre-`wireSession` frames, or re-emit the fit once the session is live. A grid of panes multiplies
     this by N.

  While in there: `wireTerminalBridge` has no production caller (Investigation) — either wire it or
  delete it, but do not leave a fitness function guarding dead code.

- **49 · terminals-home** — served from the fleet origin (`:4181`); it dials each pane's own origin.
  Two things it must carry:
  1. Take the board origin from an **additive field on `GET /api/mesh/board-url`**, not by parsing the
     navigation URL it returns today (sub-question 1).
  2. **Copy `assign`'s `workspace-not-local` guard onto `board-url`**
     ([mesh-ui-serve.mjs:423](../../../src/mesh-ui-serve.mjs#L423)) — today that route will hand back
     a live URL for a project root that does not exist on this machine. A pane whose origin cannot be
     resolved renders a **labelled unavailable state naming its cause**, never a blank one
     (sub-question 5).

- **48 · fleet-session-identity** — unchanged by this finding, and confirmed as the true foundation for
  `mirror` panes only. Note for it: a **`local-pty` pane is addressed by `(boardOrigin, ref, provider)`,
  not by `(nodeId, sessionId)`** — so 48's routable session id is what unlocks the *mirror* half of the
  grid, and the local half needs nothing from it. Separately confirmed here: presence `sessions[]` is
  keyed `(node, workspace, assistant)`
  ([mesh-session.mjs](../../../src/mesh-session.mjs)) and written only by the `aof mesh session` CLI
  verb — so today two PTYs on one node/workspace/assistant collapse to a single record, which is the
  shape 48 has to change.

- **Not blocked by this finding:** 45, 47, 50.
