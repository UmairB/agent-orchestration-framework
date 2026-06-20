---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 03 · Work Board UI — Architecture Decisions

These ADRs build directly on the Decide docs and do not re-litigate their findings:
`SPEC.md` (scope: board + detail + actions + agent terminal; vibeyard as reference, not a fork),
`RESEARCH.md` (the measured facts — node-pty@1.1.0 win32-x64 prebuilt, `ws@8` `noServer`/upgrade,
`validateWork`/`nextWork` in-process exports, no `appendFeedback` export, `path.join(item.dir,'<DOC>.md')`
doc resolution, the `CliProvider` shape, MIT attribution obligation), and `DESIGN.md` (single-screen
board+detail+terminal-dock; derived status with NO drag-to-restatus; feedback append is the board's
only write). The seam this milestone freezes — the `aof work list --json` stream contract (ADR-002) —
is the m02-analogue of the PRD-fixture seam: it is what makes the three-story breakdown buildable in
parallel.

## ADR-001: One `http.createServer` carries the board's HTTP API and the terminal WebSocket; the route namespaces are disjoint by design

**Status:** Accepted
**Date:** 2026-06-19

**Context.** RESEARCH §3 measured the seam: `src/setup-ui.mjs` is a single bare
`http.createServer(...)` bound to `127.0.0.1` (`setup-ui.mjs:19`, `:136`) that already multiplexes
static `/ui` files and `/api/*` JSON routes in one request handler, ends every API path with a
`startsWith("/api/")` 404 guard (`:118`) and falls through to static (`:123`), and returns the live
`server` handle to its caller (`return { server, url }`, `:138`). RESEARCH §3 proved that adding the
terminal WebSocket to *this same server and port* is the standard `ws` `noServer` +
`server.on('upgrade', …)` pattern: the HTTP `upgrade` event is a **separate channel** from the normal
request handler, so a `wss.handleUpgrade(...)` on a matched pathname coexists cleanly with the existing
static + `/api/*` handler — HTTP requests never reach the upgrade path and vice-versa. `ws@8.21.0` is
pure JS with zero required runtime deps (its native addons are optional perf-only `optionalDependencies`),
so it adds no native-build risk on top of node-pty. The SPEC/DESIGN require the board's HTTP routes and
the terminal stream to be **same-origin, same-port** (one localhost console, no auth surface, no second
port). This namespace split is also **load-bearing for story independence** (ADR-005): story 01 owns the
HTTP routes, story 02 owns the WS route, so the two touch different code paths and never collide.

**Decision.** The board's HTTP API and the terminal WebSocket are served by **one
`http.createServer`** on one 127.0.0.1 port, with **disjoint, pinned route namespaces**:
- **Board HTTP routes live under `/api/work*`** (e.g. `/api/work/list`, `/api/work/doc`,
  `/api/work/validate`, `/api/work/next`, `/api/work/feedback`) — added to the existing `/api/*`
  request handler, reusing its JSON-response + `startsWith("/api/")` 404-guard shape. Exact sub-paths
  are story-01 task detail; the **`/api/work` prefix is the frozen namespace**.
- **The terminal WebSocket lives at exactly one pathname, `/ws/terminal`**, served via `ws`
  `new WebSocketServer({ noServer: true })` + `server.on('upgrade', …)`: the upgrade handler routes by
  `new URL(request.url, 'ws://127.0.0.1').pathname`, calls `wss.handleUpgrade(...)` on `/ws/terminal`,
  and `socket.destroy()`s any unknown upgrade pathname (the `ws` pattern's default branch — not extra
  work, and the only "auth" needed on a 127.0.0.1-only single-user server, matching DESIGN §Intent).
- The two namespaces are **disjoint**: no board HTTP route begins `/ws/`, and the WS upgrade is never
  routed to anything outside `/ws/`. They share the one `server` returned by `serveSetupUi`, so they
  are guaranteed same-origin/same-port.

**Implementation form — extend, do not stand up a sibling server.** The new surface attaches the
`upgrade` listener to the **same `server` instance** `serveSetupUi` already creates. The board's
HTTP routes and the WS-upgrade wiring SHOULD be factored into their own module(s) so the file split
mirrors the story split (story 01's `/api/work*` handlers; story 02's `/ws/terminal` upgrade +
PTY bridge) and `setup-ui.mjs` is not turned into a god-file — but it remains **one process, one
server, one port**. A second `http.createServer` or a second port is forbidden (RESEARCH §3
constraint). The shared `server` handle is the only thing the two stories co-touch; it is kept from
forcing a build sequence by the namespace disjointness (each story registers its own routes/upgrade
on a handle the other never edits).

**Alternatives considered.**
- *A second HTTP server / second port for the terminal WS* — rejected: RESEARCH §3 proved one server
  carries both with no conflict, and a second port breaks the same-origin requirement and adds a port
  to manage; the `upgrade` channel already isolates the surfaces.
- *Route the terminal over `/api/...` (e.g. a long-poll or SSE under the JSON namespace)* — rejected:
  a PTY is bidirectional binary streaming; `ws` upgrade is the right transport (RESEARCH §1/§3/§4), and
  keeping it OUT of `/api/*` is what makes the namespaces cleanly disjoint for the story split.
- *Cram all routes + the upgrade into `setup-ui.mjs`* — rejected: it would make story 01 and story 02
  edit the same file, re-coupling them; factor the board surface into its own module(s) behind the
  shared `server`.
- *Add auth / a token on the WS upgrade* — rejected as out of scope: the server is 127.0.0.1-only and
  single-user (DESIGN §Intent: "no auth"); the upgrade handler still rejects unknown pathnames
  (`socket.destroy()`), which is the `ws` default branch, not an auth layer.

**Consequences.** The board's HTTP API and terminal stream are same-origin/same-port with no second
server. The `/api/work*` ↔ `/ws/terminal` disjointness is the structural decoupling that lets stories
01 and 02 build independently (ADR-005), and it is checkable by source-grep (`acd-board-single-server`).
node-pty/ws are **server-side** deps added to the **root** `package.json` (`engines.node >=20`), never
to `ui/`. Whether the upgrade rejects an unknown pathname and how a connection lifecycle behaves are
behaviour (story 02 `.feature`), not invariants here.

**Invariant.** The board surface is served by exactly ONE `http.createServer` on one 127.0.0.1 port;
the board's HTTP routes are confined to the `/api/work*` namespace and the terminal WebSocket to the
single pathname `/ws/terminal` (via `ws` `noServer`/`server.on('upgrade')`); there is no second
`http.createServer` and no second port for the terminal. (Enforced by `acd-board-single-server`.)

## ADR-002: The `aof work list --json` stream shape is the LOCKED SHARED CONTRACT — a flat array of items, each carrying `parent` so the board derives the tree

**Status:** Accepted
**Date:** 2026-06-19

**Context.** This is the seam that makes the breakdown independent — the m03 analogue of m02's
PRD-fixture seam. The board's entire read model is the work stream, and RESEARCH §A1 established the
source: `listItems(workDir)` (`work.mjs:57`) and `findWork` (`work.mjs:140`) already serialize, per
item, exactly `{ ref, type, slug, status, title, parent, dir }` — deterministic and **content-free for
listing** (`work.mjs:1-7` states resolution/listing "never need to read content"; items are enumerated
by folder name only, `:57-87`). The CLI story (00) produces this stream; the board story (01) consumes
it. If the shape is frozen here, story 01 can bind to a **fixture** of the frozen shape and build
without story 00 — exactly the decoupling m02 got from freezing the PRD fixture. The shape choice
(flat-with-`parent` vs nested) determines who owns tree assembly.

**Decision.** `aof work list --json` emits a **flat JSON array** of item objects (NOT a nested tree);
the board derives the milestone → story → task hierarchy client-side from the `parent` links. The
per-item shape is **frozen** as exactly the `listItems` field set, with these semantics:

```jsonc
[
  {
    "ref":    "03/01",          // canonical hierarchical ref (string); milestones "NN", stories "NN/SS", etc.
    "type":   "story",          // item type: milestone | story | task | uat (the ACD item vocabulary)
    "slug":   "board-tree",     // folder slug (kebab); identity within its parent
    "status": "in-progress",    // DERIVED status — one of the ACD status vocabulary; the board NEVER writes it (ADR-004)
    "title":  "The work board", // human title from the record-doc frontmatter
    "parent": "03",             // ref of the parent item; null/absent for depth-0 items (milestones, uat) — the tree edge
    "dir":    "C:/…/wiki/work/03_milestone_work-board-ui/stories/01_story_board-tree"  // absolute item dir
  }
  // … one object per item in the whole stream, in a stable order
]
```

Field semantics that are load-bearing:
- **`ref`** is the stable identity the board keys rows on, deep-links via the URL hash (DESIGN §3,
  `/#03/02`), and passes to the actions and the terminal launch contract (ADR-003).
- **`parent`** is the single tree edge: depth-0 items (milestones, and UAT sessions which sit at depth 0
  per DESIGN §1) have `parent: null`/absent; the board groups children under their `parent` ref. Choosing
  flat-with-`parent` keeps the CLI emit-side trivial (`listItems` already returns this) and puts tree
  assembly in the board, where DESIGN §1 already specifies depth/indentation rendering.
- **`status`** is the **derived** ACD status the board renders as a chip (DESIGN §1 ramp). It is
  read-only on the wire; the board never sends it back (ADR-004).
- **`dir`** is the absolute item directory. It is the join base the detail panel later uses —
  `path.join(dir, '<DOC>.md')` (RESEARCH §5, ADR layered in story 01) — and the feedback writer uses —
  `path.join(dir, 'STATE.md')` (ADR-004). It is included precisely so the detail/feedback work needs no
  re-glob of the filesystem.

The shape is frozen at **this milestone's** breakdown: the CLI story (00) MUST emit exactly these
seven fields per item (no more, no fewer, on the contract surface), and the board story (01) binds to a
checked-in **fixture** of this shape. Neither story may unilaterally add or rename a contract field;
extending the contract is a superseding ADR, not an ad-hoc field.

**Alternatives considered.**
- *Emit a nested tree (`children: [...]`)* — rejected: it pushes tree assembly to the CLI (more emit-side
  logic than `listItems` has today, which is flat), bloats the fixture, and is harder to snapshot-diff;
  the board already renders by depth (DESIGN §1), so client-side assembly from `parent` is the natural cut.
- *Add convenience fields (depth, hasChildren, doc paths)* — rejected for the **contract** surface:
  derivable fields belong on the consumer side (depth/hasChildren from `parent`), and doc paths are
  `path.join(dir,…)` joins the board does itself (RESEARCH §5). A fat contract is harder to freeze and
  invites drift; keep it to the `listItems` seven.
- *Let story 01 read `work.mjs` exports directly instead of the `--json` contract* — rejected: that
  re-couples the board to in-process function shapes and bypasses the very seam (00 → JSON → 01) that
  makes the stories independent; the board binds to the **JSON contract**, fixtured.
- *Leave the shape to the implementing task* — rejected: this IS the decoupling seam; freezing it here
  (path + fields + semantics) is what lets 00 and 01 build in parallel, exactly as m02 froze its fixture.

**Consequences.** Stories 00 and 01 build in parallel against the frozen shape: 00 produces it, 01
consumes a fixture of it. The shape is structurally checkable on the emitted JSON
(`acd-work-list-contract`). `dir` is the single join base for both the detail-panel doc reads and the
feedback write, so neither needs a filesystem re-glob. The contract being **flat** keeps the CLI emit a
thin pass over `listItems`. The ACD status vocabulary values themselves are owned by `work.mjs`'s
derivation, not redefined here; this ADR freezes the wire *shape*, not the status algorithm.

**Invariant.** `aof work list --json` emits a flat JSON array whose every element is exactly
`{ ref, type, slug, status, title, parent, dir }` (the `listItems` field set) — a flat array (not a
nested tree), with `parent` as the only tree edge (null/absent at depth 0). (Enforced by
`acd-work-list-contract`.)

## ADR-003: The terminal transport is `node-pty@1.1.0` + `ws@8` at `/ws/terminal` with a tiny envelope; the provider seam is vibeyard's `CliProvider` ported under MIT attribution; a missing provider binary surfaces as an error control-frame, never a crash

**Status:** Accepted
**Date:** 2026-06-19

**Context.** RESEARCH §1/§2/§4 measured the whole terminal stack. node-pty@1.1.0 (upstream Microsoft,
MIT, published 2025-12-22) **bundles a win32-x64 N-API prebuilt** in its npm tarball — no node-gyp, no
VS Build Tools, no download — and is ABI-safe across Node 20/22/24 (single `pty.node`, `node-addon-api
^7.1.0`); the homebridge fork's 0.13.1 ships **no win32-x64 prebuild** at all, and `@lydell/node-pty`
is still beta — so upstream `node-pty@1.1.0` is strictly the right pin for this win32 repo (RESEARCH §2,
evidenced from the actual tarballs). vibeyard's terminal capability is three separable, MIT-clean
pieces (RESEARCH §1): the `pty.spawn` options + `onData`/`onExit`/`write`/`resize`/`kill` lifecycle
(already win32-guarded with try/catch); the `CliProvider` interface
(`resolveBinaryPath`/`validatePrerequisites`/`buildArgs`/`buildEnv` → `pty.spawn`, selected per-session
by a `providerId`); and the xterm render side. The **one thing that must change** is the carrier:
vibeyard is Electron IPC end-to-end (`window.vibeyard.pty.*`) with **no `ws` dependency** — we replace
that carrier with a WebSocket (RESEARCH §1/§3). The message shapes to re-home are small and known
(RESEARCH §1/§4): PTY data both directions, a `{cols,rows}` resize, a `{exitCode,signal}` exit. DESIGN
§4 specifies the dock's `error` state for a failed spawn (provider missing / server down). RESEARCH §1
records the **MIT attribution obligation** as a hard licence requirement, not optional.

**Decision.** Pin the transport and the provider seam:
- **PTY (server-side):** `node-pty@1.1.0` — the upstream Microsoft package, added to the **root**
  `package.json` (NOT `ui/`). Explicitly **not** `@homebridge/node-pty-prebuilt-multiarch` (no win32-x64
  prebuild in 0.13.1) and **not** `@lydell/node-pty` (beta). Spawn via the ported lifecycle:
  `pty.spawn(bin, args, { name:'xterm-256color', cols, rows, cwd, env })`, `onData`/`onExit`, and
  guarded `write`/`resize`/`kill` (the win32 try/catch from vibeyard is carried, not re-invented).
- **Carrier (server-side):** `ws@8` `noServer` + `server.on('upgrade')` at **`/ws/terminal`** (the
  ADR-001 namespace) — the re-homed replacement for vibeyard's Electron IPC.
- **The message envelope is frozen** (the small, known shapes from RESEARCH §1/§4):
  - **PTY bytes** flow as **raw WS data frames in both directions** (client→server input → `pty.write`;
    server→client output → `term.write`). Raw frames carry no JSON wrapper — they are terminal bytes.
  - **Control messages are a tiny JSON envelope** distinguished from raw bytes by being JSON objects:
    **client→server `{ "type": "resize", "cols": <n>, "rows": <n> }`** → `pty.resize(cols, rows)`;
    **server→client `{ "type": "exit", "exitCode": <n> }`** → the dock's "exited (N)" state (DESIGN §4),
    and **server→client `{ "type": "error", "message": <string> }`** → the dock's `error` state (below).
- **Provider seam:** port vibeyard's **`CliProvider` interface** —
  `resolveBinaryPath()`/`validatePrerequisites()`/`buildArgs(opts)`/`buildEnv(sessionId, baseEnv, opts?)`
  feeding `pty.spawn(...)` — with **per-session `providerId` ∈ {claude, codex, gemini}** (the DESIGN §4
  provider picker, exactly-one-selected). Provider selection resolves the binary + args + env, then
  spawns. Port the **recipe** (the interface shape, spawn-options block, event lifecycle), not the
  package; do NOT pull vibeyard's WebGL/`better-sqlite3`/`chokidar`/`gridstack` (app-shell, not the seam).
- **A missing provider binary is an honest error control-frame, never an unguarded throw/crash.** When
  `resolveBinaryPath()`/`validatePrerequisites()` cannot find the chosen provider (or `pty.spawn`
  throws), the server emits **`{ "type": "error", "message": … }`** over the WS (the dock renders DESIGN
  §4's `error` state — "failed to spawn/connect (provider missing…)"), and the connection closes
  cleanly. The server process MUST NOT crash, and MUST NOT pretend a missing provider succeeded — this
  is the m02-ADR-004 "honest degrade, never a silent/dishonest success" discipline applied to the
  terminal: a missing binary is reported as the dock's error state, exactly as Codex's missing
  `plugin install` was reported as `pluginsInstalled: false` rather than faked.
- **MIT attribution is a binding obligation.** Every file that adapts vibeyard code (the `pty.spawn`
  options block, the `CliProvider` interface, the terminal-pane WS wiring pattern) **carries vibeyard's
  MIT copyright notice** (RESEARCH §1: "a hard licence obligation, not optional"). This is recorded here
  as an architectural decision, not left to the implementer's discretion.

**Alternatives considered.**
- *Use the homebridge node-pty fork ("the prebuilt-to-avoid-node-gyp" reputation)* — rejected: RESEARCH
  §2 proved its 0.13.1 tarball ships **only linux** prebuilds (no win32-x64), so on this repo it would
  fall through to a network fetch / node-gyp; upstream `node-pty@1.1.0` ships the win32-x64 prebuilt.
- *Use `@lydell/node-pty` (per-platform optional-dep split)* — rejected: viable in shape but currently
  beta (`1.2.0-beta.12`); a beta native dep is the wrong pin for the headline feature.
- *Keep vibeyard's Electron IPC carrier / import vibeyard as a package* — rejected: aof is a
  Node-server + browser stack, not Electron; vibeyard files don't drop in unmodified (RESEARCH §1). We
  port the recipe over `ws`, the one piece that must change.
- *Wrap PTY bytes in JSON too (uniform `{type:'data',bytes}` frames)* — rejected: it doubles the
  per-keystroke payload and forces base64/serialisation on a hot path; raw frames for bytes + a JSON
  envelope only for the rare control messages is vibeyard's shape and the minimal one.
- *Let a missing provider throw / surface as a generic 500* — rejected: an unguarded throw can crash
  the single-user server and gives the dock no `error` state to render; the explicit `error`
  control-frame is the honest, DESIGN-specified path.
- *Treat attribution as a build-time nicety* — rejected: it is an MIT licence obligation (RESEARCH §1);
  recording it as a decision (and a fitness function) is what keeps it from being silently dropped.

**Consequences.** The terminal works on this win32 repo from a bundled prebuilt with no build
toolchain (the residual is the routine A2 build-time confirmation that `pty.node` loads + spawns here —
a documented default, not a blocker; see the note to the PO). The envelope is frozen, so the browser
xterm component (story 02, `ui/` deps `@xterm/xterm@^6` + `addon-fit` + `addon-web-links`, RESEARCH §4)
and the server agree on the wire. The provider seam is one interface for three CLIs, with missing-binary
honesty checkable structurally (no `node-pty` outside the server; the `error` control-frame is the only
spawn-failure path) and the MIT notice presence checkable by source-grep
(`acd-terminal-server-only`, `acd-vibeyard-attribution`). Whether a real provider actually spawns and
streams end-to-end is `@uat`/`@manual` (RESEARCH A4/A7), not a CI invariant.

**Invariant.** The PTY dependency is `node-pty@1.1.0` (root package, never `ui/`); the terminal is
carried by `ws` at `/ws/terminal`; the wire envelope is raw frames for PTY bytes + JSON
`{type:'resize',…}` (client→server) and `{type:'exit',…}`/`{type:'error',…}` (server→client); a missing
provider binary emits an `{type:'error'}` control-frame (never an unguarded throw); and every file
adapting vibeyard code carries vibeyard's MIT copyright notice. (Enforced by `acd-terminal-server-only`
and `acd-vibeyard-attribution`; the no-crash spawn behaviour and live stream are `@manual`/`@uat`.)

## ADR-004: The board is read-mostly; status is DERIVED and never written; the feedback append to `STATE.md` is the board's ONLY filesystem mutation

**Status:** Accepted
**Date:** 2026-06-19

**Context.** DESIGN's whole model is "see the stream, act on a selected item" with status **derived**,
not user-set — DESIGN §"No drag-to-restatus" / Documented Default 5 makes "dnd-kit is layout-only;
status is derived, never set by the UI" a binding constraint. RESEARCH §6 measured the action seam:
`validateWork(workDir, config, scopeRef)` (`work.mjs:252`) returns `{path, problem}[]` and
`nextWork(workDir, scopeRef)` (`work.mjs:377`) returns `{state, ref, …}` — both are **in-process,
read-only** exports the board calls directly (no `child_process`, no CLI round-trip). Add-feedback is
different: there is **no `appendFeedback` export** in `work.mjs` (confirmed by reading it in full); the
feedback contract is authored only in `src/bundle/commands/feedback.md` (for a milestone/story it routes
to that item's `STATE.md` `## Feedback (for retro)`, appending one attributed bullet
`- <note> — Raised by: <actor>   Refs: <…>`, the canonical form in `templates/uat/STATE.md:23-30`). So
the board's feedback append is **new server work**, and it is the board's one mutation. The detail panel
also reads doc bodies — `path.join(item.dir, '<DOC>.md')`, doc-absent treated as empty-not-error
(RESEARCH §5) — but reads are not mutations.

**Decision.** The board is **read-mostly with exactly one write**:
- **Status is derived, never written.** The board renders the `status` field from the contract (ADR-002)
  as a chip; it never sends status/frontmatter back, never mutates an item's record-doc frontmatter, and
  dnd-kit is wired to pane/dock resize ONLY (DESIGN Default 5). There is no restatus route and no
  status-write code path.
- **Validate and Next are in-process, read-only calls.** The board imports `validateWork`/`nextWork`
  from `work.mjs` and calls them in-process behind `/api/work/validate` and `/api/work/next` — never via
  a child `aof` CLI shell-out (keeps results structured, avoids a round-trip). Neither mutates anything.
- **The feedback append is the SOLE filesystem mutation.** `/api/work/feedback` locates
  `path.join(item.dir, 'STATE.md')` for the selected **milestone/story** item, ensures the
  `## Feedback (for retro)` heading exists (creating it verbatim if absent), and appends **one**
  attributed bullet in the documented format (`- <note> — Raised by: <actor>   Refs: <…>`) — mirroring
  `src/bundle/commands/feedback.md` so the board and the slash-command stay byte-consistent. This append
  is the **only** filesystem write the board server performs.
- **Doc reads are reads, not writes.** The detail panel reads `path.join(item.dir, '<DOC>.md')` for
  SPEC/STORY/VERIFICATION/RETROSPECTIVE with **doc-absent = empty, not error** (ENOENT → "No
  RETROSPECTIVE yet", consistent with how `readMeta` swallows missing files, `work.mjs:129-131`). These
  resolve off the `dir` already in the contract (ADR-002) — no filesystem re-glob.

The board MUST NOT write any file other than the feedback append to a milestone/story `STATE.md`. (The
`feedback.md` uat→`SESSION.md` `## Findings` route is out of scope for the board's three actions, which
target milestone/story items — noted so the implementer routes only the milestone/story case.)

**Alternatives considered.**
- *Allow drag-to-restatus / a status-write route* — rejected: ACD status is derived from contract/build
  state (SPEC Approach rejects vibeyard's kanban; DESIGN Default 5); a writable status would fork the
  model and let the UI lie about an item's real state.
- *Shell out to `aof work validate`/`aof work next` as child processes* — rejected: RESEARCH §6 shows
  both are exported in-process functions; shelling out loses the structured return and adds a CLI
  round-trip for no gain.
- *Add an `appendFeedback` export to `work.mjs` and call it* — viable but **not required by this ADR**:
  the structural invariant is "the feedback append is the board's only write to a `STATE.md`", wherever
  the helper lives. Whether it is a new `work.mjs` export or a board-server function is a build-time
  factoring choice (story 01), not an architecture decision — the invariant binds either way.
- *Treat a missing doc as an error* — rejected: a not-started item legitimately has no
  RETROSPECTIVE/VERIFICATION (DESIGN §2); empty-state is the correct read, matching `readMeta`'s
  swallow-missing precedent.

**Consequences.** The board cannot corrupt the work stream: it derives status and writes nothing but
one feedback bullet, protecting ACD's derived-status model. The "only write is the feedback append" is
structurally checkable (the server source has exactly one filesystem-write site, targeting `STATE.md`'s
`## Feedback (for retro)`; no status/frontmatter write) — `acd-board-write-isolation`. The feedback
bullet format and the validate/next result rendering, and the doc-absent empty state, are **behaviour**
tested in story 01 `.feature`s (RESEARCH A5/A6), not invariants here.

**Invariant.** The board server performs exactly ONE kind of filesystem mutation — appending an
attributed bullet under `## Feedback (for retro)` in a selected milestone/story item's `STATE.md`. It
never writes item status/frontmatter, never exposes a restatus route, wires dnd-kit to layout only, and
calls `validateWork`/`nextWork` in-process (no CLI shell-out). (Enforced by `acd-board-write-isolation`.)

## ADR-005: The breakdown is three independent stories decoupled by the frozen contract (ADR-002) and the disjoint route namespaces (ADR-001)

**Status:** Accepted
**Date:** 2026-06-19

**Context.** The PO/architect partition the milestone so the stories are as independent as possible —
cross-story dependencies are the enemy of parallelism. DESIGN composes one screen from four surfaces
(board, detail, actions, terminal) and the SPEC names the four scope items
(`aof work list --json`; board+detail; actions; agent terminal). The proposed cut groups these into
three stories along the seams the earlier ADRs froze. The job here is to confirm the cut is genuinely
independent (or improve it) and record WHY, plus name the one residual coupling and how it is kept from
forcing a sequence — exactly as m02 recorded its breakdown rationale.

**Decision.** Three stories, decoupled by the **frozen `work list --json` contract (ADR-002)** and the
**disjoint `/api/work*` ↔ `/ws/terminal` route namespaces (ADR-001)**:

- **Story 00 — `aof work list --json` (the stream data source / CLI).** Adds the `aof work list`
  subcommand emitting the frozen flat-array contract (ADR-002) over the existing `listItems`/`findWork`.
  Pure CLI/backend; depends on nothing in this milestone. **Independent because** it *produces* the
  locked contract — its only obligation to the others is the frozen shape, which is a checked-in fixture,
  not a runtime dependency.

- **Story 01 — the work board + item detail + actions (the React surface + its `/api/work*` HTTP API).**
  Renders the stream (tree, derived-status chips — DESIGN §1), the detail panel
  (SPEC/STORY/VERIFICATION/RETROSPECTIVE/findings via `path.join(dir,'<DOC>.md')` — DESIGN §2,
  RESEARCH §5) and the three actions (feedback append / validate / next — DESIGN §3, ADR-004). Owns the
  **`/api/work*` HTTP routes** (ADR-001) and the board's only write (ADR-004). **Independent of story 00**
  because it binds to a **fixture** of the frozen contract (ADR-002), not to the live CLI — it builds and
  tests against the fixture and works against 00's real output unchanged. **Independent of story 02**
  because it owns a different route namespace (`/api/work*` vs `/ws/terminal`) and different files; it
  emits the "selected ref + chosen provider" launch contract that 02 consumes, but does not depend on 02
  to render or act.

- **Story 02 — the agent terminal (node-pty + ws + xterm + `CliProvider`).** The headline. Owns the
  **`/ws/terminal` WS route** + the PTY/provider seam (ADR-003) + the xterm React pane (DESIGN §4). **Independent
  of stories 00/01** because it lives on a disjoint route namespace and in its own files (server: the
  upgrade handler + PTY bridge + providers; UI: the terminal dock component), and it attaches to the
  board via a **thin launch contract** — "selected `ref` + chosen `providerId`" — which is just two
  fields off the board's selection state, fixturable on its own. It needs no board HTTP route to spawn.

**The residual coupling and how it is contained.** The one thing stories 01 and 02 co-touch is the
**shared `server`** instance from `serveSetupUi` (story 01 registers `/api/work*` handlers on it;
story 02 registers the `server.on('upgrade')` for `/ws/terminal`). ADR-001 contains this: the namespaces
are disjoint, each story registers on the handle in its **own** module without editing the other's, so
the shared server does not impose a build order. The integration point is mechanical (both call
`server.on(...)`/add a route on the one handle) and is exercised by the single-server fitness function
(`acd-board-single-server`), not by making one story wait on the other.

**Alternatives considered.**
- *Split board and detail/actions into separate stories (four stories)* — rejected: board, detail and
  actions all live in the same React surface, share the selection-as-context state (DESIGN), and all hang
  off the same `/api/work*` namespace; splitting them invents a cross-story dependency on shared
  selection state with no parallelism gain. Keep them as one story (01).
- *Fold the CLI (00) into the board story (01)* — rejected: that re-couples the consumer to the producer
  and loses the fixture seam; the whole point of freezing the contract (ADR-002) is that 00 and 01 build
  in parallel, m02-style.
- *Fold the terminal (02) into the board story (01)* — rejected: the terminal is the largest, riskiest
  piece (native node-pty, ws upgrade, xterm) and is cleanly decoupled by its own route namespace and
  launch contract; keeping it a separate story isolates the native-dep risk and lets the read-mostly
  board land independently of the headline.
- *Make 02 depend on 01's `/api/work*` for the selected item* — rejected: the launch contract is just
  `ref + providerId` (board selection state), so 02 binds to those two fields directly, not to an HTTP
  route — keeping the WS story independent of the board's HTTP story.

**Consequences.** The three stories build in parallel: 00 produces the contract, 01 consumes a fixture
of it and owns the HTTP namespace + the sole write, 02 owns the WS namespace + the native terminal seam.
The only shared artifact is the one `server` handle, contained by the disjoint namespaces (ADR-001).
The independence rests on two frozen seams — the `work list --json` shape (ADR-002) and the route
namespaces (ADR-001) — both of which are fitness functions, so a regression that re-couples the stories
(a nested contract, a second server, a board status-write, a terminal route under `/api/`) trips CI.

**Invariant.** Story independence is carried by the two frozen seams: the flat `work list --json`
contract (ADR-002) and the disjoint `/api/work*` ↔ `/ws/terminal` route namespaces (ADR-001). No story
introduces a runtime dependency on another's internals; the only co-touched artifact is the shared
`server` handle, registered on per-story in disjoint namespaces. (Enforced indirectly by
`acd-work-list-contract` + `acd-board-single-server`; the partition itself is a planning decision, not a
single arch-test.)

## ADR-006: The board's primary action is STATE-AWARE; launching auto-runs the matching `aof` command by TYPING it as ordinary PTY input into the spawned agent — the ADR-003 wire envelope and the ADR-004 read-mostly board are both unchanged

**Status:** Accepted
**Date:** 2026-06-20

**Context.** The detail panel's headline action was a generic "Run agent" — spawn the chosen provider
CLI in the item's dir (the ADR-003 launch: `ref` + `providerId`). Operator feedback: the action should
depend on the item's **derived status** (ADR-002/ADR-004), because ACD has a fixed per-item lifecycle
(`refine → continue → verify`). So both the button **label** and the **command it runs** are derived
from the item's status:
- `not-started` AND not yet broken down (a milestone with no stories) → **Refine** → `/aof:refine <ref>`
- `not-started` (already broken down) or `in-progress` → **Continue** → `/aof:continue <ref>`
- `in-review` → **Verify** → `/aof:verify <ref>`
- `blocked` → **disabled** ("waiting on …")
- `done` → a quiet ad-hoc **Run agent** (interactive, no auto-command)

Plus a liveness rule: if a terminal session is already **live** for the item's `ref`, the action becomes
**View terminal** (focus the dock) — it never spawns a duplicate. The architectural question this raises
is *how the derived command reaches the agent* — and whether that touches either of the two frozen
seams (ADR-003's wire envelope, ADR-004's read-mostly board).

**Decision.** The matching `aof` command is delivered by **typing it into the spawned agent as ordinary
initial PTY input on connect** — exactly as a human would type the slash-command into the agent's REPL.
Concretely: after the WS session opens and the provider has spawned, the **client** sends the command as
**raw input bytes** on the already-established stream (e.g. `/aof:verify 03\r`), which flow through the
existing `client→server → pty.write` path unchanged.

This ADR **clarifies and extends ADR-003 additively; it does not break the frozen envelope:**
- **ADR-003's wire envelope is UNCHANGED.** The command travels as **ordinary raw PTY-input data frames**
  — NOT a new frame type, NOT a JSON control message, NOT a new field. It is indistinguishable on the
  wire from a human typing the same characters. The control-message set stays exactly ADR-003's:
  `{type:'resize'}` (client→server), `{type:'exit'}`/`{type:'error'}` (server→client). No new envelope
  member is introduced.
- **The launch URL/contract (ADR-003 / ADR-005) is UNCHANGED on the wire** — a session is still opened
  with `ref` + `providerId` and nothing more. The status→command **derivation** and the **auto-typing of
  the initial input** are **additive UI behaviour layered on top** of the existing launch, not a new wire
  field or a new server capability.

This ADR also **preserves ADR-004 (the board is read-mostly):**
- Running an `aof` command this way is the **AGENT** doing the work *inside the terminal* (the provider's
  own REPL executes the slash-command). The **board server performs NO new filesystem write** and **NO
  `child_process`/`exec`/`spawn` of an `aof`/command CLI** to deliver it — the command is **PTY input to
  an already-spawned provider**, never executed by the board server. The board's sole filesystem mutation
  remains the ADR-004 feedback bullet append to `STATE.md`; nothing here adds a second write or a
  shell-out.

The **status→action/label/command derivation** (and the live-session → "View terminal" rule) is
**observable UI behaviour** — a `.feature` / design-conformance concern owned by **story 02**'s task
features — NOT a structural invariant, and therefore **NOT a new fitness function**. The only structural
guards that matter here are the two existing ones it must not violate: the wire envelope
(`acd-terminal-server-only`, which already pins the envelope members) and the no-shell-out / single-write
discipline (`acd-board-write-isolation`, which already asserts the board server has no
`child_process`/`spawn`/`exec` of an `aof`/command CLI). No heavy new arch-test is warranted; this ADR
deliberately defers the derivation behaviour to story 02's `.feature`s and leans on those two existing
fitness functions to backstop the structural claim (unchanged envelope + no board shell-out).

**Alternatives considered.**
- *Add a new control frame (e.g. `{type:'run', command:'/aof:verify 03'}`) for the server to execute* —
  rejected: it would (a) break ADR-003's frozen envelope by adding an envelope member, and (b) make the
  **server** the thing that runs the command, re-coupling it to command execution and inviting a
  shell-out — violating ADR-004's read-mostly/no-`child_process` discipline. Typing raw input reuses the
  hot path that already exists and changes nothing on the wire.
- *Have the board server shell out `aof refine/continue/verify <ref>` as a child process and stream it* —
  rejected: that is exactly the board-as-executor anti-pattern ADR-004 forbids; the agent's REPL, not the
  board, must run the slash-command. The board stays read-mostly with its single feedback write.
- *Encode the derived command in the launch URL as a third field* — rejected: it widens the ADR-003 launch
  contract (`ref` + `providerId`) for no benefit — the client already knows the derived command and can
  type it once connected; the wire contract stays the two frozen fields.
- *Keep a single generic "Run agent" and let the operator type the command themselves* — rejected: it
  ignores the operator feedback and the fixed ACD lifecycle; deriving the action from status is the whole
  point. But note the *delivery mechanism* (raw typed input) is identical to what a human would do — so
  the `done` "Run agent" case (no auto-command) is just the same launch with no initial input typed.
- *Make the derivation a fitness function* — rejected: which label/command a status maps to, and the
  live-session "View terminal" swap, are observable UI behaviour (a `.feature`/design concern), not a
  structural invariant; forcing it into an arch-test would mis-altitude behaviour as structure. The
  structural residue (envelope unchanged, no board shell-out) is already covered.

**Consequences.** The state-aware action ships as **pure UI layering**: the board derives label + command
from the ADR-002 `status` field and (on launch) types the command as initial input over the existing
ADR-003 stream. Nothing on the wire changes — the browser xterm/server contract from ADR-003 stands as-is,
so story 02's terminal work is unaffected at the transport layer. The board server gains **no** new write
and **no** command-executing shell-out, so ADR-004's "only write is the feedback bullet" and "no
`child_process` of a command CLI" both still hold and remain enforced by `acd-board-write-isolation`. The
status→action/command mapping and the live-session "View terminal" behaviour are validated in **story 02
`.feature`s** (and design review), not in CI arch-tests. The duplicate-launch guard (one live session per
`ref`) is likewise behaviour, owned by the story.

**Invariant.** The derived `aof` command reaches the agent ONLY as ordinary raw PTY-input bytes on the
existing `/ws/terminal` stream (as a human would type it) — it adds NO new wire frame, NO JSON control
message, and NO new field to the ADR-003 envelope or the `ref`+`providerId` launch contract; and the
board server NEVER executes the command itself (no new filesystem write, no `child_process`/`exec`/`spawn`
of an `aof`/command CLI to run it). The status→action/label/command derivation and the live-session
"View terminal" swap are observable behaviour, deferred to story 02 `.feature`s, NOT a fitness function.
(The two structural halves are already backstopped by `acd-terminal-server-only` (frozen envelope) and
`acd-board-write-isolation` (no board shell-out / single write); no new arch-test is added.)

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     SPECIFIED here (name + what it asserts + which ADR); the developer implements them at build. -->

| Invariant | Enforced by (arch-test) | From |
|---|---|---|
| The board surface is served by exactly ONE `http.createServer` on one 127.0.0.1 port; the board's HTTP routes live only under the `/api/work*` namespace and the terminal WebSocket only at `/ws/terminal` (via `ws` `noServer` + `server.on('upgrade')`); there is no second `http.createServer` and no second port for the terminal | `test/arch/acd-board-single-server.test.mjs` (source-grep the board/terminal server modules: assert exactly one `http.createServer` in the UI-server surface; assert the terminal is wired via `server.on('upgrade')` + `new WebSocketServer({ noServer: true })` and routes only `/ws/terminal`; assert no board HTTP route string begins `/ws/` and the WS pathname is the single `/ws/terminal`; behavioural option: stand up the server, assert a GET `/api/work…` returns JSON, a static GET serves, AND a WS handshake to `/ws/terminal` succeeds on the SAME port, with a stubbed connection handler — no real PTY) | ADR-001 |
| `aof work list --json` emits a flat JSON array whose every element is exactly `{ ref, type, slug, status, title, parent, dir }` (the `listItems` field set) — a flat array, NOT a nested tree, with `parent` as the only tree edge (null/absent at depth 0) | `test/arch/acd-work-list-contract.test.mjs` (run `aof work list --json` against a fixture work-stream; parse stdout; assert the result is an array (not an object with `children`); assert every element's key set is exactly the seven contract fields — no missing, no extra; assert depth-0 items have `parent` null/absent and nested items carry a `parent` ref that resolves to another element's `ref`) | ADR-002 |
| The PTY/terminal native stack is confined to the SERVER: `node-pty` is a dependency of the ROOT `package.json` (never `ui/package.json`), and no `import`/`require` of `node-pty` appears under `ui/src/` | `test/arch/acd-terminal-server-only.test.mjs` (assert root `package.json` `dependencies` contains `node-pty` (and `ws`) and `ui/package.json` does NOT; grep `ui/src/**` for `node-pty`/`require('node-pty')`/`from "node-pty"` → zero matches; assert the browser side imports only `@xterm/*`) | ADR-003 |
| Every source file that adapts vibeyard code (PTY spawn-options block, the `CliProvider` interface, the terminal-pane WS wiring) carries vibeyard's MIT copyright attribution notice | `test/arch/acd-vibeyard-attribution.test.mjs` (grep the ported terminal/provider source files for a vibeyard MIT attribution notice — `vibeyard` + `MIT` (or an `Adapted from … vibeyard …` notice) — assert present in each adapted file; assert the repo's licence/NOTICE surface records the vibeyard MIT obligation) | ADR-003 |
| The board server performs exactly ONE kind of filesystem mutation — appending a bullet under `## Feedback (for retro)` in a selected milestone/story `STATE.md`; it never writes item status/frontmatter, exposes no restatus route, wires dnd-kit to layout only, and calls `validateWork`/`nextWork` in-process (no CLI shell-out for them) | `test/arch/acd-board-write-isolation.test.mjs` (source-grep the board server: the only filesystem-write call sites target `STATE.md`/`## Feedback (for retro)`; assert NO write to item frontmatter/`status`, NO `/api/work` route that sets status, and NO `child_process`/`spawn`/`exec` of an `aof`/`work validate`/`work next` CLI (validate/next are imported in-process); behavioural: run the feedback route against a fixture `STATE.md`, assert exactly one bullet appended under the verbatim heading and that no other file under the fixture changed) | ADR-004 |

<!-- NOT fitness functions (deliberately):
  - A real `node-pty` spawn — that the bundled win32-x64 `pty.node` actually loads and forks a PTY on
    this machine/Node — is a BUILD-TIME CONFIRMATION (RESEARCH A2), @manual. Routine (N-API + bundled
    prebuilt), not a blocker; a `pty.spawn` smoke test resolves it. NOT a CI arch-test.
  - The end-to-end agent stream (Run-agent spawns a provider and the dock streams
    idle→connecting→running→exited, input echoes, resize works) requires the live wiring + an installed
    agent CLI on PATH (RESEARCH A4) → @uat. NOT a CI arch-test.
  - A provider CLI actually being present to spawn, and a missing one surfacing as the dock ERROR state
    rather than a crash (RESEARCH A7) is environment-dependent → @manual. The error CONTROL-FRAME path
    (server emits `{type:'error'}`, never an unguarded throw) is structural and lives in ADR-003's
    server-side code; that a real missing binary triggers it end-to-end is @manual/@uat.
  - The feedback bullet's exact wording/format, the validate/next result rendering, and the detail
    panel's doc-absent empty state are observable BEHAVIOUR → story 01 task `.feature`s (RESEARCH A5/A6).
  - The status-chip colour ramp, provider-picker exactly-one-selected, and the dock connection-state
    ramp are DESIGN-conformance / behaviour → story `.feature`s + design review, not structural invariants.
  - Which providers are offered and how a missing provider is reported to the user is a task-feature
    outcome (DESIGN §"Behavioural outcomes"), not a fitness function.
-->
