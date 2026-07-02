---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 25 · Mesh UI — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the load-bearing deliverables: **rename
> `aof work board` → `aof work ui`** as a *deliberate* ACD change carrying milestone-03's registered board
> + its frozen `/api/work` envelope + its fitness functions forward, NOT a drive-by; **add `aof mesh ui`**,
> the read-only fleet surface that sits *on top* of the per-stream work UIs — nodes (presence + active runs)
> **and** every registered board, each drillable into its own `aof work ui`; **`aof mesh status`**, the CLI
> mirror of the fleet view; everything routes through **registered commands**, preserving the thin-face +
> frozen-envelope discipline) and `STATE.md` (the open contract points refined here: how the rename touches
> the m03 envelope while keeping its fitness functions + the m08 bijection / no-UI-core-import guards green;
> the `aof mesh ui` layout and the registered commands it reads — the group registry from 24, presence from
> 23; **whether the fleet view is its own face or an extension of the work UI** — resolved: its OWN face,
> ADR-003). Prior art: `PRD-decentralized-agent-orchestration.md` (§7.1/§7.2 KF7 "one mission-control view
> of the whole fleet"; §7.3 "two levels of git-of-record" + poll/refresh visibility, NOT a WebSocket event
> stream; §8 Phase-1 flags the board→ui rename as a DELIBERATE change to milestone 03's command).
>
> **The precedents this milestone APPLIES and never re-litigates: milestone 03 (the work-board surface + its
> frozen `/api/work` envelope + the single same-origin server), milestone 08 (cli-command-core + the
> registry-derived bijection), milestone 21 (board-run-observability — the per-board run READ this milestone
> surfaces fleet-wide), and milestones 22/23/24 (the mesh foundation — the partition seam, the presence
> dimension, the group registry).** The fleet view is authored *as a registered command-core command + a
> serve face*, inheriting wholesale: `08/ADR-001` (CLI-as-contract over ONE in-process command core; a serve
> verb is a thin face over a one-shot core); `08/ADR-002` (the frozen `{ id, input, run, cli } → result`
> contract; basis-neutral `run` data; path-display is a face adapter); `08/ADR-004 inv.3` (the command
> registry is the ONLY door — a web face imports no operation module except `./command-core.mjs`);
> `03/ADR-001` (ONE `http.createServer` on one `127.0.0.1` port; the API + terminal WS + static share it);
> `03/ADR-004` (board write-isolation — the board face writes at most the one feedback bullet); `15/ADR-005`
> (the route↔command bijection is registry-DERIVED, not hard-coded); `21/ADR-001` (the `work:run-status`
> read route — the per-board run surface this milestone renders fleet-wide); `22/ADR-002` (the path-partition
> seam + `meshDir`); `22/ADR-004` (the payload-agnostic git-sync engine); `23/ADR-002` (the presence /
> node-staleness signal `mesh:status` already renders); `24/ADR-001` (the SINGLE-WRITER group registry —
> `src/mesh-registry.mjs`, `readRegistry(workspace)`, absence-tolerant — the roster of nodes + registered
> boards this milestone RENDERS). ADRs below cite these as `08/ADR-00n` / `03/ADR-00n` / `21/ADR-00n` /
> `22/ADR-00n` / `23/ADR-00n` / `24/ADR-00n` / `SPEC §…` / `STATE §…` / `PRD §…`.
>
> **The seam (confirmed against the codebase graph, `aof graph build src` → 1174 nodes / 3162 edges / 31
> communities, builtAt 2026-07-01, egress:none; `aof graph impact` consulted at author time — cited as
> ACTUAL structure, not inferred).** The three moves fall on THREE near-disjoint seams, which is why the
> partition below is clean:
> - **The rename seam is ISOLATED from all mesh code.** `aof graph impact src/board-serve.mjs src/board-ui.mjs`
>   returns `board-serve.mjs` ← `cli.mjs` (1) → `setup-ui.mjs` (1), and `board-ui.mjs` ← `setup-ui.mjs` (1)
>   → `command-core.mjs`, `work.mjs` (2). So the board serve-face touches NO `mesh-*` module and NO mesh
>   command; the rename is a pure `cli.mjs` + `board-serve.mjs` edit. (The `work.mjs` edge from `board-ui.mjs`
>   is ONLY the `displayPath` helper — the `08/ADR-004 inv.3` no-core-import guard forbids *operation*
>   imports, which this is not; it stays green.)
> - **The fleet-data seam is the mesh spine.** `aof graph impact src/mesh-store.mjs src/mesh-presence.mjs`
>   returns `mesh-store.mjs` ← `mesh-identity.mjs`, `mesh-presence.mjs`, `mesh-sync.mjs` (3) → `fs.mjs`,
>   `run-store.mjs` (2); `mesh-presence.mjs` ← `mesh-heartbeat.mjs`, `mesh-identity.mjs` (2) → `fs.mjs`,
>   `mesh-store.mjs`, `run-store.mjs` (3). `src/commands/mesh-identity.mjs` HOSTS both `mesh:identity` and
>   `mesh:status` and ALREADY imports the presence + staleness reads (`readPresenceRecord`, `isNodeStale`,
>   `mergePresence`, `resolveStalenessSeconds`) — so the fleet aggregation EXTENDS `mesh:status` in place,
>   adding only a `readRegistry` read (the m24 seam) + the per-board active-runs projection. `command-core.mjs`
>   is the one additive door; `aof graph impact src/cli.mjs` shows it importing `board-serve.mjs`,
>   `command-core.mjs`, `setup-ui.mjs` (25 deps) with ZERO inbound — the top of the tree, edited additively.
> - **The `aof mesh ui` serve-face is greenfield**, a SIBLING to `board-serve.mjs`: it stands up NO second
>   server (it reuses the `setup-ui.mjs` single-`http.createServer` precedent, `03/ADR-001`) and reaches
>   fleet data ONLY through `command-core.mjs` (the `board-ui.mjs` `08/ADR-004 inv.3` posture, mirrored).
>
> **Prior-lesson recall** (`work memory recall "mesh fleet ui board rename thin face frozen envelope
> registered command drill-in" --area architecture --block`) surfaced four m23 ADRs + one m23 near-miss;
> each is acknowledged as honoured or a conscious departure:
> - **23/ADR-004 — the relay subscriber applies fanned-out presence into an IN-MEMORY liveness cache,
>   overlaid by `mesh:status` as `git-on-disk ?? cache` (git wins); the cache is NEVER a second system of
>   record.** **HONOURED — load-bearing here:** the fleet view reads presence THROUGH the SAME `mesh:status`
>   command, so it inherits the merge for free — the web face never re-implements the disk↔cache reconcile
>   and never reads presence a second way (fitness `acd-mesh-ui-single-data-command`). The fleet view renders
>   already-`mergePresence`-reconciled records; it is a pure renderer over `mesh:status`.
> - **23/ADR-003 — presence is published over BOTH buses; the relay push NEVER gates the git write, so
>   relay/control-node loss degrades cleanly to git-only.** **HONOURED (the render mirror):** the fleet view
>   is a READER, so its degradation is symmetric — with no relay it renders the ≤30s git-durable roster
>   (poll/refresh, PRD §7.3), never a blank; with no registry it renders the local node's own records
>   (absence-tolerant, ADR-002). Losing the accelerator loses *freshness*, not the *view*.
> - **23/ADR-002 — the node-staleness signal EXTENDS m20's run heartbeat, published as a git-TRACKED
>   presence record.** **HONOURED:** the fleet view renders `stale`/`live`/`no-presence` EXACTLY as
>   `mesh:status` computes it (the `isNodeStale` shape) — no parallel staleness. The per-board "running ♥Ns"
>   is m21's `work:run-status` surfaced fleet-wide, not a re-derived run scan.
> - **23/ADR-001 — the thin relay is payload-agnostic; the control node is a re-nominate-able role/config.**
>   **HONOURED (out of scope, cited for the boundary):** `aof mesh ui` renders — it neither brokers relay
>   frames nor nominates a control node. It reads the registry + presence records the relay ALREADY synced.
> - **23/R3 (near-miss) — a git-as-bus EOL pin must match the REAL nested record path, not a root anchor.**
>   **HONOURED — no new pin owed:** this milestone AUTHORS no new `.mesh/**` record type (it RENDERS the
>   node/presence/registry records m22/23/24 already author under `.mesh/`); the m23-landed
>   `.gitattributes **/.mesh/** text eol=lf` + `.gitignore wiki/work/.mesh/` already cover every record it
>   reads. No `.gitattributes` / `.gitignore` deliverable is owed (unlike m23/m24, which authored new
>   record types).
>
> **Scope-precision carry-forwards (22/R1 — enumerate EVERY registry-derived fitness gate a change trips,
> AND the inverse).** The `aof work board → aof work ui` rename touches NO registered command (the board is a
> CLI-only serve verb, NOT a `work:*` command — `STATE §Notes`, confirmed: `cli.mjs:339` dispatches
> `subcommand === "board"` to a local `workBoardCommand`, never `invoke("work:board")`), so it trips NO
> registry-derived gate: `acd-work-command-cli-bijection` and `acd-work-command-route-coverage` are
> registry-DERIVED and see no `work:board` command, so they neither require nor forbid the verb — they stay
> green untouched, and the frozen `/api/work` envelope + its guards (`acd-board-single-server`,
> `acd-board-write-isolation`, `acd-work-ui-no-core-import`) target `board-ui.mjs`, which the rename does not
> touch (ADR-001, fitness table). The NEW `mesh:status` aggregation IS a registered `mesh:*` command, so it
> rides the EXISTING `acd-mesh-command-cli-bijection` (`22/fitness #3`, `mesh:`-filtered) — no new bijection
> gate. `aof mesh ui` is a CLI-only serve verb (like `aof work ui`), NOT a `mesh:*` command, so it does NOT
> enter the mesh bijection; its structural guarantees are the NEW `acd-mesh-ui-*` gates (ADR-003, fitness
> table). The board route-coverage bijection is `work:`-filtered and stays on `/api/work`; the fleet view
> serves a DISJOINT `/api/mesh` namespace (ADR-003), so it does NOT enter `/api/work` route-coverage.

## ADR-001: `aof work board` → `aof work ui` — a deliberate CLI serve-verb rename that leaves the frozen `/api/work` envelope and milestone-03's registered board byte-identical; the board's fitness functions carry forward, most green UNCHANGED

**Status:** Accepted
**Date:** 2026-07-01

**Context.** The PRD (§8 Phase-1) flags renaming `aof work board` → `aof work ui` as a *deliberate* ACD
change, not a drive-by: the "board" of a single work stream becomes its **`ui`**, and the fleet layer above
it becomes `aof mesh ui` (ADR-003). Two structural facts, confirmed against the source, bound the blast
radius:

1. **`aof work board` is a CLI-ONLY serve verb, NOT a registered `work:*` command.** `cli.mjs:339`
   dispatches `if (subcommand === "board") await workBoardCommand(rest)`; `workBoardCommand`
   (`cli.mjs:859`) calls `serveBoard(...)` from `src/board-serve.mjs` directly — it never
   `invoke("work:board", …)`. There is no `work:board` in the registry. So the rename is a **CLI surface
   edit**, not a registry rename: rename the dispatch branch, the `workBoardCommand` function, the two usage
   strings (`cli.mjs:359` + `cli.mjs:2423`), and the human log lines (`cli.mjs:884` "AOF work board is
   running locally.").
2. **The board serve-face is graph-ISOLATED from the frozen envelope AND from all mesh code.** `aof graph
   impact` (author time): `board-serve.mjs` ← `cli.mjs` (1) → `setup-ui.mjs` (1); `board-ui.mjs` ←
   `setup-ui.mjs` (1) → `command-core.mjs`, `work.mjs` (2). The `/api/work` envelope lives in
   `board-ui.mjs` — the rename touches NEITHER `board-ui.mjs` NOR `setup-ui.mjs`. So the six `/api/work`
   routes (list/doc/tasks/validate/doctor/run-status) stay **byte-identical**, and the m21 board extension
   (the `work:run-status` read route) is carried FORWARD, not forked (the rename lands *after* m21, per
   `depends: 21`).

**Decision.** Rename the CLI serve verb only — `aof work board` becomes `aof work ui`:

1. **Rename the dispatch + the function + the surface strings, nothing else.** `subcommand === "board"` →
   `subcommand === "ui"`; `workBoardCommand` → `workUiCommand`; both usage lines and the human log lines
   read "ui". The `serveBoard` import and `board-serve.mjs` itself keep their names (they are the *server*,
   not the *verb*; renaming the module is optional cosmetics out of scope — the ADR pins the VERB name, not
   the file name). The default port (`4180`) and the `?mode=board` bundle query are UNCHANGED (the built UI
   bundle's internal mode selector, `ui/src/main.tsx`, is not the CLI surface; retargeting the bundle is a
   later, separable cosmetic — out of scope, so the frozen envelope + the bundle contract stay put).
2. **The frozen `/api/work` envelope is UNTOUCHED (the load-bearing invariant).** `board-ui.mjs` and its six
   routes are not edited. The board's structural guarantees — one same-origin server (`03/ADR-001`),
   write-isolation (`03/ADR-004`), the registry-only door (`08/ADR-004 inv.3`), the route↔command bijection
   (`15/ADR-005`) — all target `board-ui.mjs`/`setup-ui.mjs`/`command-core.mjs`, so they carry forward GREEN
   and UNCHANGED (fitness table below distinguishes carry-green-unchanged from needs-reference-update).
3. **The drill-in target from the fleet view is this renamed `aof work ui`.** ADR-003's fleet view drills
   into a board by launching / linking that board's own `aof work ui`; the name the drill-in references is
   the renamed verb. This is the ONE coupling from ADR-003 back to ADR-001 (story 03 depends on story 01 for
   the drill target name).

**Alternatives considered.**
- *Register a `work:board`/`work:ui` command so the bijection covers it.* Rejected: `aof work board` is
  intrinsically a long-lived serve verb (it blocks on the server until SIGINT), not a one-shot invoke →
  render command — forcing it into the registry would fight `08/ADR-001`'s serve-is-a-thin-face-over-a-
  one-shot-core shape and gain nothing (the `graph:serve` / `mesh:relay` precedent: a serve verb is a CLI
  branch, its *status probe* may be a command, but the serve itself is not). The verb stays a CLI-only
  dispatch branch, exactly as today.
- *Rename `board-ui.mjs` → `work-ui.mjs` and the `/api/work` prefix → `/api/ui` to match.* Rejected: that
  would edit the FROZEN envelope (`08/ADR-003` froze the `{ ok:false, error, code }` shape AND the route
  prefix `board-ui.mjs` owns) and RED every board fitness function for a cosmetic gain. The envelope is the
  contract; the CLI verb name is the surface. Rename the surface, freeze the envelope.

**Consequences.**
- The rename is a small, isolated `cli.mjs` diff; every `/api/work` guard stays green unchanged.
- ONE guard must FLIP (not merely stay green): a completeness gate asserting `subcommand === "board"` is
  GONE from `workCommand` and `subcommand === "ui"` EXISTS — the "the rename actually happened" proof, in
  the bijection-grep idiom (fitness `acd-work-ui-rename-complete`, RED until the rename lands).
- The board module keeps its `board-*` filenames; a future cosmetic file-rename is a separable, guard-free
  edit (the ADR deliberately does not couple the verb rename to a module rename).

## ADR-002: The fleet data model is ONE registered command — `mesh:status` EXTENDED to aggregate nodes + presence/staleness + registered boards + per-board active runs; BOTH faces (the `aof mesh status` CLI mirror AND the `aof mesh ui` web surface) consume this ONE command through the registry — no second data path; degrades gracefully when the m24 registry seam is absent

**Status:** Accepted
**Date:** 2026-07-01

**Context.** The fleet view needs four facts: (1) the **nodes** (`readNodeRecords`), (2) each node's
**presence + staleness** (`readPresenceRecord` / `isNodeStale` / `mergePresence`, `23/ADR-002`+`23/ADR-004`),
(3) the **registered boards** (the m24 group registry roster, `readRegistry`, `24/ADR-001`), and (4) each
board's **active runs** (m21's run READ — `work:run-status` / `readActiveRuns`, `21/ADR-001`). `mesh:status`
(hosted in `src/commands/mesh-identity.mjs`) ALREADY reads (1) + (2): it calls `readNodeRecords`, and for
each node reads presence and computes `stale` via the injected-clock `isNodeStale` shape, returning
`{ nodes: [ { nodeId, presence?, stale } ] }` — a PURE READ (it writes nothing). The graph confirms this is
the mesh spine: `mesh-identity.mjs` ← `command-core.mjs`, `mesh-heartbeat.mjs` (2) → `mesh-store.mjs`,
`mesh-presence.mjs`, `fs.mjs`, `node-identity.mjs`, `work-bundle.mjs` (5). What is MISSING from `mesh:status`
today is (3) the registered-boards roster and (4) the per-board active-runs projection — the "every board
being worked on" half of the SPEC.

The danger to guard against: a SECOND data path — the web face reading `readNodeRecords`/`readRegistry`
directly, diverging from the CLI mirror (the `board-ui.mjs` anti-pattern m08 already outlawed for
`/api/work`). One command, two faces.

**Decision.** EXTEND `mesh:status` in place to be the single fleet-data command; render it two ways.

1. **`mesh:status` aggregates the whole fleet, additively over its frozen shape (`08/ADR-001`
   additive-friendly).** It keeps `{ nodes: [ … ] }` (byte-identical for existing node/presence consumers,
   `23/ADR-002`) and ADDS a `boards` projection: `readRegistry(workspace)` yields the registered boards +
   roster (m24), and for each board the active-run ids are the m21 run READ (`readActiveRuns` over the
   board's items, or the `work:run-status` `runs[]` filtered to `state === "running"` — the SAME `21/ADR-001`
   read, never a re-scan). The result is `{ nodes: [ … ], boards: [ { ref, activeRuns, … } ] }`. This stays
   a PURE READ — `mesh:status` writes nothing (the `acd-board-write-isolation` posture, carried to the mesh
   face by `acd-mesh-ui-write-isolation`, ADR-003).
2. **The `aof mesh status` CLI mirror is the existing `meshVerbCli("mesh:status", …)` render.** The CLI
   branch (`cli.mjs:482`) is unchanged in wiring; the command's `cli.render` gains the boards lines, its
   `cli.json` passes the extended `{ nodes, boards }` through. The CLI face injects NO presence cache
   (git-only read — byte-identical to the relay-less path, `23/ADR-004`).
3. **The `aof mesh ui` web surface consumes the SAME command through the registry (ADR-003), NEVER a second
   read.** The fleet web face reaches `mesh:status` ONLY via `invoke("mesh:status", …, ctx)` through
   `./command-core.mjs` — exactly as `board-ui.mjs` reaches `work:*`. There is ONE fleet-data command and
   two faces over it (fitness `acd-mesh-ui-single-data-command` asserts the web face imports no
   `mesh-store`/`mesh-presence`/`mesh-registry` module directly).
4. **Degrade gracefully when the m24 registry seam is absent (the codebase's ENOENT→`[]`/`null` discipline
   everywhere).** `readRegistry` does NOT exist yet — m24 story 00 authors `src/mesh-registry.mjs`, and it
   is absence-tolerant by design (no registry file ⇒ an empty registry, `24/ADR-001` decision 3). So
   `mesh:status`'s boards projection MUST tolerate: (a) the module ABSENT (m24 not yet built) — the boards
   read is guarded so its absence yields `boards: []`, mirroring `readNodeRecords`' `ENOENT → []`; (b) the
   module present but no registry file — `readRegistry` returns the empty roster; (c) a torn/unparseable
   record — skipped, never blinding the list (`readNodeRecords`' per-file `try/continue`). The fleet view
   NEVER blanks on a missing seam — it renders the local node's own records as a one-node fleet. This is the
   `23/ADR-003` clean-degradation discipline applied to the render.

**Alternatives considered.**
- *A new `mesh:fleet` command distinct from `mesh:status`.* Rejected: `mesh:status` is ALREADY the fleet
  read (it returns the whole roster + presence); a second command would split the fleet data across two
  commands and force the web face + CLI mirror to choose — reintroducing the two-path hazard. One command
  is the single door. (`mesh:status` is the natural home: its very name is "the status of the mesh".)
- *The web face reads `readRegistry`/`readNodeRecords` directly (skip the command).* Rejected outright: it
  is the exact `08/ADR-004 inv.3` violation for the mesh face — a second data path that diverges from the
  CLI mirror and bypasses the registry door. Forbidden by `acd-mesh-ui-single-data-command` (ADR-003).
- *Hard-require the m24 registry (fail if absent).* Rejected: it violates the codebase-wide
  absence-is-benign discipline (`mesh-store`/`mesh-presence`/`run-store` all `ENOENT → []`/`null`) and
  would make m25 un-buildable until m24 ships. Absence-tolerant lets m25 render a single-node fleet today
  and light up boards as the registry populates.

**Consequences.**
- ONE fleet-data command; the CLI mirror and the web view can NEVER diverge (both `invoke` it).
- `mesh:status` gains a `boards` key additively; the `23/ADR-002` `{ nodes }` consumers are unaffected.
- The boards read is written absence-first (guarded import + `readRegistry`'s own tolerance), so m25 is
  build-able and green BEFORE m24 lands — the fleet view degrades to the local node's records.

## ADR-003: `aof mesh ui` is its OWN thin serve-face — a sibling to `aof work ui`, NOT an extension of the work UI — reaching fleet data ONLY through the registered `mesh:status` command and drilling into each board via that board's own `aof work ui`

**Status:** Accepted
**Date:** 2026-07-01

**Context.** `STATE §Notes` leaves open: "whether the fleet view is its own face or an extension of the work
UI." The graph answers it. The board serve-face (`board-serve.mjs` ← `cli.mjs` → `setup-ui.mjs`) is a
SINGLE-STREAM view: it reads ONE work stream through `/api/work` (list/doc/tasks/validate/doctor/run-status)
and offers a per-item terminal at `/ws/terminal`. The fleet view reads a DIFFERENT source (the group
registry + presence across MANY nodes/boards, ADR-002) and offers NO per-item terminal — it is a
mission-control roster that DRILLS INTO a board, not a board itself. Cramming the fleet reads onto the
`/api/work` face would either overload the frozen envelope (adding fleet routes to a stream-scoped API) or
require a `mode` conditional — both fight the thin-face discipline. Two views, two sources, two faces.

**Decision.** `aof mesh ui` is its OWN serve-face — a sibling to `aof work ui`, mirroring `board-serve.mjs`.

1. **A NEW `mesh:ui` CLI serve verb + a NEW thin serve-face module.** `meshCommand` (`cli.mjs`) gains an
   additive `if (subcommand === "ui") await meshUiCommand(rest); return;` branch above the unknown-sub
   fallthrough (the m22 additive-branch idiom). `meshUiCommand` stands up the fleet server — a NEW module
   `src/mesh-ui-serve.mjs` (the `board-serve.mjs` sibling) — and, like every serve verb, it is a CLI-ONLY
   branch, NOT a registered `mesh:*` command (so it does not enter the mesh bijection; ADR-002 §note).
2. **ONE `http.createServer` on `127.0.0.1` — the `03/ADR-001` single-server precedent.** The fleet face
   reuses the `setup-ui.mjs` single-server shape (or stands up exactly one server of its own bound to
   `127.0.0.1`); it declares NO second server and NO second port. It serves a DISJOINT `/api/mesh` HTTP
   namespace (never `/api/work` — that prefix is the frozen board envelope; the fleet view owns `/api/mesh`).
   The one fleet route the web bundle needs is `GET /api/mesh/status` → `invoke("mesh:status", …)` (ADR-002).
3. **It reaches fleet data ONLY through the registry (the `08/ADR-004 inv.3` posture, mirrored).** The new
   face imports NO mesh-core/operation module (`mesh-store`, `mesh-presence`, `mesh-registry`, `mesh-sync`,
   `commands/*`) except `./command-core.mjs` — it `invoke`s `mesh:status` and serialises the result. Its
   only jobs are TRANSPORT (read the request, map the error/status envelope, own the unknown-route 404) and
   PATH DISPLAY (the `board-ui.mjs` `displayPath` face adapter, if any raw path leaks) — ZERO operation
   logic (fitness `acd-mesh-ui-no-core-import`).
4. **It DRILLS INTO a board via that board's own `aof work ui` (ADR-001).** The fleet view does not proxy a
   board's `/api/work`; it LINKS/LAUNCHES the board's own `aof work ui` (the renamed verb) — each board keeps
   its own git + its own serve-face (PRD §7.3 "each board keeps its own git"). This is the one coupling from
   this face back to ADR-001 (the drill target is the renamed verb name).
5. **Read-only; no per-item terminal.** The fleet face serves NO `/ws/terminal` and NO write route — it
   renders already-git-synced records (poll/refresh, PRD §7.3), never a WebSocket event stream (SPEC out of
   scope). Issuing/assigning work is m27 (ADR-004). The board write-isolation posture is mirrored: the fleet
   face writes NOTHING (fitness `acd-mesh-ui-write-isolation`).

**Alternatives considered.**
- *Extend the work UI with a `?mode=fleet` conditional on the same `/api/work` server.* Rejected: it
  overloads a stream-scoped frozen envelope with fleet reads and forces a provider-style `mode` conditional
  on the board face — the exact structural smell the thin-face discipline forbids. The graph shows the two
  views have disjoint data sources; disjoint faces keep each thin.
- *A fleet face that reads `mesh-store`/`mesh-registry` directly for speed.* Rejected: the `08/ADR-004
  inv.3` violation (a second data path, ADR-002). The registry door is the invariant; the perf cost of one
  in-process `invoke` is nil.
- *The fleet face proxies each board's `/api/work` so the whole fleet renders in one page.* Rejected: each
  board keeps its own git + own serve-face (PRD §7.3); a proxy would make the fleet face a durability/
  liveness SPOF for streams it does not own. The fleet view DRILLS (links/launches), it does not proxy.

**Consequences.**
- `aof mesh ui` is a self-contained thin serve-face; the board's frozen envelope is untouched (ADR-001) and
  the fleet reads flow through one command (ADR-002).
- A NEW `/api/mesh` namespace is introduced, disjoint from `/api/work`; the board route-coverage bijection
  (`work:`-filtered) does not fire on it, and a NEW mesh-ui single-server/no-core-import pair of guards
  locks the fleet face (fitness table).
- The fleet face module (`src/mesh-ui-serve.mjs`) does not exist on the current tree — its guards are
  SPECIFIED here and authored at build (specify-over-write for a not-yet-existing module, suite hygiene).

## ADR-004: The fleet view is READ-ONLY and adds no new threat surface — it renders already-git-synced records over a `127.0.0.1` same-origin server (the board's isolation model); issuing/assigning work is out of scope (milestone 27)

**Status:** Accepted
**Date:** 2026-07-01

**Context.** A "mission-control view of the whole fleet" could sound like a new attack surface — a place to
issue work across machines. It is not, in this milestone: the SPEC scopes m25 to RENDER read-only; the
issue/assign/route affordance is m27.

**Decision.** The fleet view introduces NO new threat surface beyond the board's existing model.

1. **It renders only already-git-synced records.** The nodes/presence/registry records the fleet view reads
   were authored + admitted by m22/23/24 and synced over git (the durable bus) / the relay (the accelerator)
   — the fleet face reads them off disk through `mesh:status`, minting nothing and admitting no one.
2. **Same-origin `127.0.0.1` server — the board's isolation model (`03/ADR-001`).** The fleet face binds
   `127.0.0.1`, serves same-origin (the bundle + `/api/mesh` on one port), and offers NO write route and NO
   `/ws/terminal`. The board's guards carry: single-server, write-isolation (nothing is written), no
   cross-origin surface.
3. **Issuing / assigning / routing work is OUT of scope (m27).** No route on `/api/mesh` mutates a peer's
   state; the fleet view cannot start/assign a run on another node. That affordance — and its genuinely new
   authz surface — arrives in m27, over the m24 credential/trust boundary.

**Security lens.** The fleet view reads the SAME `.mesh/` records the relay already brokers over the m24
credential boundary; it opens no new inbound port beyond the local same-origin board server and mutates
nothing. I judge NO genuinely new attack surface is introduced by m25 (the read-only render over the
existing local server). The write/issue affordance that WOULD introduce one is deferred to m27, where its
authz belongs. **No new security-lens review is owed for this milestone** beyond confirming the write-isolation
+ single-server guards hold on the new face (fitness `acd-mesh-ui-write-isolation` / `acd-mesh-ui-single-server`).

**Consequences.**
- The fleet face inherits the board's threat model unchanged; the new-surface analysis lands in m27 with the
  issue/assign affordance.
- The read-only posture is STRUCTURALLY locked (write-isolation + no-`/ws/terminal` + single-server guards),
  not merely asserted in prose.

## ADR-005: A board's `activeRuns` is its OWNER node's synced `presence.activeRuns` — the only fleet-durable run signal — superseding ADR-002 decision 1's local-work-stream read (verify finding F1)

**Status:** Accepted (supersedes ADR-002 decision 1's board→active-runs source; ADR-002 is immutable, so the correction lives here)
**Date:** 2026-07-02

**Context.** ADR-002 decision 1 sketched a board's `activeRuns` as "the m21 run READ (`readActiveRuns` over
the board's items … the SAME `21/ADR-001` read)". The build resolved that against
`boardWorkDir(ws, slug) = path.join(ws.workDir, slug)` — a `<workDir>/<slug>/` sub-stream. Verify finding
**F1** proved this source is **dead-`[]` in production**: aof items are direct children of `workDir`, and
the m24 registry mints **group-level project slugs** (each board keeps its OWN git — separate repos, PRD
§7.3 / ADR-003), never a `<slug>` subdirectory of *this* node's stream. So NO real producer ever writes
run records under `<workDir>/<slug>/`; the tests passed only because a white-box fixture invented that
layout. The consequence: the fleet's NODES half showed a node's real running count (from its presence),
while the BOARDS half showed **every board idle** — the two halves of the one aggregate disagreed,
defeating "every board being worked on" (SPEC Objective).

The feasibility flaw (STATE Feedback): a contract locked a read against a source that had no **runtime
producer**, only a fixture that could plant it. The board→runs seam the DEV note reached for
(`listItems(ws.workDir)`, the whole local stream) is no better — it attributes THIS node's runs to EVERY
board, including peers'. There is no board-slug→workspace-path map anywhere on the tree, and a peer board's
run records are never synced here (only `.mesh/**` records sync — nodes, presence, registry). So per-board
run records are **not fleet-reachable** from `mesh:status`, for local OR peer boards.

**Decision.** A board's `activeRuns` is its **owner node's** `presence.activeRuns` — read from the SAME
merged presence `mesh:status` already computes for the nodes half.

1. **The source is the owner's synced presence.** `mesh:heartbeat` already publishes each node's running run
   ids as `presence.activeRuns` (`readActiveRuns(listItems(ws.workDir))`, m23), git-synced fleet-wide under
   `.mesh/presence`. The boards projection joins each board to its `owner` (the first-wins roster scan,
   unchanged) and reads that owner's `presence.activeRuns`. This is the ONE run signal that is (a) a real
   runtime producer, (b) durable fleet-wide, and (c) reachable for **peer** boards (their owner's presence
   syncs even though their run records do not). `mesh:status` re-reads nothing — it reuses the presence map
   the nodes loop already built (still ONE data command, ADR-002).
2. **An ownerless board, or an owner with no presence / no active runs, reads `activeRuns: []`** (the
   absence-tolerant never-blank discipline — []-not-error, ADR-002 decision 4). The key is always a present
   array; only its contents change.
3. **The board→run source is now presence, so the `<workDir>/<slug>/` read + `boardWorkDir` are removed**
   (dead code); `mesh:status` imports no `listItems`/`readActiveRuns`. The projection stays a PURE read
   (it reads presence records, writes nothing — the `acd-mesh-ui-write-isolation` posture holds).

**Consequence — the fleet board chip is a REDUCED, coarse signal (feeds design-gap A).** Owner-presence
carries only the set of *running* run ids (no per-run terminal state, no per-board attribution when a node
owns several boards). So the fleet board tile can honestly render **running** (the owner has ≥1 active run)
vs **idle / no active run** — but NOT the full m21 `done`/`failed`/`queued`/`cancelled` ramp per board, and a
node owning several boards paints them all "running" together. The richer per-board run state stays a
**drill-in** concern (one level down, in that board's own `aof work ui`, where the board's run records ARE
local). **This re-authors `01/tasks/00_boards-projection` (the run-source scenarios) and the
`01_mesh-status-render` running-count scenario** to the owner-presence seam, and pins design-gap A's
resolution: the fleet chip is the reduced running/idle signal, the full ramp is drill-in — DESIGN surface 1
is annotated accordingly, not the aspirational per-board terminal chip.

**Alternatives considered.**
- *Keep `<workDir>/<slug>/` (the shipped build).* Rejected — F1: no producer, dead-`[]`.
- *`listItems(ws.workDir)` (the whole local stream, the DEV note's seam).* Rejected — attributes THIS node's
  runs to every board including peers'; wrong for any multi-node fleet.
- *Sync each board's run records into `.mesh/` so per-board terminal state is fleet-available.* Rejected —
  out of scope (m25 renders the ALREADY-synced `.mesh/**` records; syncing work-stream run records is a new
  durability surface, not a render). The reduced chip + drill-in is the honest m25 boundary.

## Fitness Functions

Each fitness function names the arch-test file under `test/arch/`, the invariant it locks, and its status on
the CURRENT tree (before the m25 code lands). **Suite hygiene:** every test WRITTEN in this Decide stage
passes GREEN now (via the absence-tolerant / vacuous-pass idiom the codebase already uses); a test that
would hard-fail on a not-yet-existing module (`src/mesh-ui-serve.mjs`) is SPECIFIED here and authored at
build (specify-over-write). `node scripts/test.mjs` stays green.

### A. Carried-forward board guards (green through the rename, UNCHANGED — they target `board-ui.mjs`, which ADR-001 does not touch)

| Fitness function | Invariant it locks | Status |
| --- | --- | --- |
| `acd-board-single-server` (existing) | ONE `http.createServer` on one `127.0.0.1` port; API + `/ws/terminal` share it (`03/ADR-001`). | **GREEN, unchanged.** Targets `setup-ui.mjs`/`terminal-ws.mjs`; the rename edits neither. NO reference update. |
| `acd-board-write-isolation` (existing) | The board face writes at most the one feedback bullet; no restatus route; no shell-out (`03/ADR-004`). | **GREEN, unchanged.** Targets `board-ui.mjs`/`commands/feedback.mjs`; untouched by the rename. |
| `acd-work-ui-no-core-import` (existing) | `board-ui.mjs`/`setup-ui.mjs` import no work-operation module except `./command-core.mjs` (`08/ADR-004 inv.3`). | **GREEN, unchanged.** Targets `board-ui.mjs`; the `work.mjs` `displayPath` edge is allowed (not an operation import). NO reference update. |
| `acd-work-command-route-coverage` (existing) | The `/api/work/<op>` routes are in registry-DERIVED bijection with the `work:*` commands (`15/ADR-005`). | **GREEN, unchanged.** Registry-derived; the rename adds no `work:*` command and edits no route. |
| `acd-work-command-cli-bijection` (existing) | Every `work:*` command has a reachable `aof work <sub>` branch + parseable `--json` (`08`). | **GREEN, unchanged.** The board verb is NOT a `work:*` command, so it is out of this gate's scope; the rename adds no command. |

### B. The rename-is-complete guard (must FLIP red→green when the rename lands — the "it actually happened" proof)

| Fitness function | Invariant it locks | Status |
| --- | --- | --- |
| `acd-work-ui-rename-complete` **(WRITE now, vacuous-safe)** | In `workCommand` (isolated body, comments discounted — the bijection-grep idiom): `subcommand === "board"` is ABSENT **iff** `subcommand === "ui"` is PRESENT (an XOR the current tree satisfies with `"board"` present + `"ui"` absent, and the post-rename tree satisfies with `"board"` absent + `"ui"` present). Also asserts `workCommand` IS defined. | **WRITE now — GREEN on the current tree** by phrasing it as the XOR/consistency invariant (exactly ONE of the two branch literals present), NOT a bare "ui exists" that would RED today. It flips to the renamed side automatically when the rename lands. (See note below.) |

*Note on `acd-work-ui-rename-complete` (suite hygiene):* the naive form "`subcommand === "ui"` exists AND
`subcommand === "board"` is gone" hard-REDs the current tree. To keep it green NOW and still lock the rename,
phrase the assertion as a mutual-exclusion consistency check over the `workCommand` body:
`has("ui") !== has("board")` (exactly one present) — true today (`board` present, `ui` absent) AND true
post-rename (`ui` present, `board` absent), FALSE only in the broken half-renamed states (both present =
dead branch left behind; neither present = the board verb vanished with no replacement). This is the
vacuous-safe idiom (`acd-mesh-command-cli-bijection`'s RED-until-commands posture); it is a WRITABLE test
now. *If the ACD convention prefers a hard rename gate, author instead the "`board` gone ∧ `ui` present"
form at BUILD (specify-over-write) — but the XOR form is preferred here so the invariant is locked from the
Decide stage forward.*

### C. New mesh-ui face guards (the load-bearing new invariants)

| Fitness function | Invariant it locks | Status |
| --- | --- | --- |
| `acd-mesh-ui-no-core-import` **(SPECIFY — targets the not-yet-existing `mesh-ui-serve.mjs`)** | The new fleet web face (`src/mesh-ui-serve.mjs`) imports NO mesh-core/operation module — `mesh-store.mjs`, `mesh-presence.mjs`, `mesh-registry.mjs`, `mesh-sync.mjs`, `./commands/*` — except `./command-core.mjs`; performs no operation fs write (mirror `acd-work-ui-no-core-import` / `08/ADR-004 inv.3`). Positive: it DOES import `./command-core.mjs` (the door). | **SPECIFY** (authored at build). A source-grep of `mesh-ui-serve.mjs` (comments discounted): the ONLY operation-bearing local import is `./command-core.mjs`; the deny-list `mesh-store|mesh-presence|mesh-registry|mesh-sync` + `./commands/` is empty. RED-until-module (do NOT write now — it would hard-fail on the missing module). |
| `acd-mesh-ui-single-server` **(SPECIFY)** | The fleet face is served by exactly ONE `http.createServer` bound to `127.0.0.1`; no second server/port; the fleet HTTP routes live under `/api/mesh*` and NEVER `/api/work*` (mirror `acd-board-single-server`). | **SPECIFY** (authored at build). Structural grep + behavioural stand-up: exactly one `http.createServer` across the fleet serve surface; a `GET /api/mesh/status` answers JSON on the same port; no `/api/work` route is declared by the fleet face. RED-until-module. |
| `acd-mesh-ui-write-isolation` **(SPECIFY)** | The fleet face performs ZERO fs write and NO shell-out (read-only render, `03/ADR-004` posture + ADR-004); it serves NO `/ws/terminal` and no write route (mirror `acd-board-write-isolation`). | **SPECIFY** (authored at build). Grep `mesh-ui-serve.mjs`: no `writeFile`/`appendFile` call form; no `child_process`/`spawn`/`exec`; no `/ws/` route; a behavioural snapshot proving a `GET /api/mesh/status` mutates no file under the fixture. RED-until-module. |
| `acd-mesh-ui-single-data-command` **(WRITE now, vacuous-safe)** | The fleet web face + the `aof mesh status` CLI mirror share ONE data command (`mesh:status`) — there is NO second fleet-data path. Concretely: no module OTHER than `commands/mesh-identity.mjs` (which HOSTS `mesh:status`) aggregates the fleet by importing `readRegistry` alongside `readNodeRecords`/`readPresenceRecord`; and when `src/mesh-ui-serve.mjs` exists, it reaches fleet data ONLY via `invoke("mesh:status", …)` (no direct `mesh-store`/`mesh-registry` import). | **WRITE now — GREEN, absence-tolerant.** Phase 1 (writable today): assert `mesh:status` is the SINGLE command that reads the fleet aggregate — grep the registered `mesh:*` command modules; today only `mesh-identity.mjs` hosts `mesh:status`, and no second module co-reads `readRegistry` + node records (vacuously true — `mesh-registry.mjs` does not exist yet, so nothing imports `readRegistry`). Phase 2 (guarded by `existsSync(mesh-ui-serve.mjs)`): when the module exists, assert its only fleet-data reach is `invoke("mesh:status")`. The `existsSync` guard is the absence-tolerant idiom — GREEN now, tightening automatically when the face lands. |

### D. The mesh bijection (existing, rides the new command)

| Fitness function | Invariant it locks | Status |
| --- | --- | --- |
| `acd-mesh-command-cli-bijection` (existing) | Every registered `mesh:*` command carries a `cli` adapter + a reachable `aof mesh <sub>` branch + parseable `--json`; the sub set is registry-DERIVED (`22/fitness #3`). | **GREEN, unchanged.** The `mesh:status` EXTENSION (ADR-002) is the SAME registered command — it already has its `cli` adapter + `aof mesh status` branch, so it rides this gate with no new entry. `aof mesh ui` is a serve verb, NOT a `mesh:*` command, so it does NOT enter this bijection (ADR-003 §note). |

### Summary: write-vs-specify at a glance
- **WRITE now (green on the current tree, vacuous-safe):** `acd-work-ui-rename-complete` (XOR form),
  `acd-mesh-ui-single-data-command` (phase-1 + `existsSync`-guarded phase-2).
- **SPECIFY (authored at build — target modules do not exist yet):** `acd-mesh-ui-no-core-import`,
  `acd-mesh-ui-single-server`, `acd-mesh-ui-write-isolation`.
- **Carry forward UNCHANGED (green, no edit):** `acd-board-single-server`, `acd-board-write-isolation`,
  `acd-work-ui-no-core-import`, `acd-work-command-route-coverage`, `acd-work-command-cli-bijection`,
  `acd-mesh-command-cli-bijection`.

## Recommended story partition

Grounded in the graph coupling (`aof graph impact`, author time). The three moves fall on THREE near-disjoint
seams, which makes a 3-story partition clean. **Confirmed** — the PO's working 3-story partition is the right
grain; refinements below pin the exact parallelism.

- **Story 01 — the `aof work board → aof work ui` rename.** Scope: `cli.mjs` (the `subcommand === "board"`
  branch → `"ui"`, `workBoardCommand` → `workUiCommand`, the two usage strings + the human log lines) +
  writing `acd-work-ui-rename-complete`. Graph-isolated: `board-serve.mjs` ← `cli.mjs` (1) → `setup-ui.mjs`
  (1), touching NO mesh module and NOT `board-ui.mjs` (the frozen envelope). ADR-001. **Fully parallel with
  story 02** (disjoint files — `cli.mjs`'s `workCommand` body vs `mesh-identity.mjs`; the only shared file is
  `cli.mjs`, but the two edits are in different functions, so they merge cleanly).
- **Story 02 — the fleet data model + `aof mesh status` CLI mirror.** Scope: EXTEND `mesh:status` in
  `src/commands/mesh-identity.mjs` (add the `boards` projection: `readRegistry` + per-board active runs,
  absence-tolerant) + extend its `cli.render`/`cli.json` + write `acd-mesh-ui-single-data-command`
  (phase 1). Graph seam: `mesh-identity.mjs` ← `command-core.mjs`, `mesh-heartbeat.mjs` (2) →
  `mesh-store.mjs`, `mesh-presence.mjs` (+3); it already imports the node + presence reads, so the extension
  is additive on the spine. Depends on the m24 registry seam (`readRegistry`) but degrades gracefully when
  absent (ADR-002) — so it is **build-able and testable NOW** against a single-node fleet. **Fully parallel
  with story 01.**
- **Story 03 — the `aof mesh ui` web surface.** Scope: NEW `src/mesh-ui-serve.mjs` (the `board-serve.mjs`
  sibling) + the `meshCommand` `subcommand === "ui"` branch + `meshUiCommand` + the `/api/mesh/status`
  route (`invoke("mesh:status")`) + the fleet web bundle + authoring the three SPECIFY'd guards
  (`acd-mesh-ui-no-core-import`, `acd-mesh-ui-single-server`, `acd-mesh-ui-write-isolation`) + the phase-2
  half of `acd-mesh-ui-single-data-command`. Greenfield face; the graph shows the board serve-face is
  isolated, so the new sibling adds no coupling to existing modules beyond `command-core.mjs`. ADR-003.
  **Must SEQUENCE after BOTH 01 and 02:** it depends on **01** for the drill-in target name (`aof work ui`,
  the renamed verb it links/launches) and on **02** for the `mesh:status` fleet aggregate it renders. It has
  no other cross-story dependency.

**Parallelism verdict:** 01 ∥ 02 (fully parallel — disjoint functions), then 03 (sequences after both).
The single shared file (`cli.mjs`) is edited in three different functions (`workCommand`, `meshCommand`,
plus the new `meshUiCommand`/`workUiCommand`), so even the shared-file contention is a clean merge, not a
logical dependency. This is the maximally-parallel partition the graph supports: two independent seams up
front, one thin renderer that closes over both.
