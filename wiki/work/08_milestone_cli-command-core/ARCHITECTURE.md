---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 08 · CLI Command Core — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the two load-bearing deliverables: the
> command-core/CLI-contract pattern and the enforcing fitness function, proven on the `/api/work` read
> API) and `STATE.md` (PO decision 1 = the boundary model; PO decision 2 = scope = foundation + first
> surface only; the carry-forwards). ADRs cite these as `SPEC §…` / `STATE §…`.
> The seam is milestone 03's `/api/work*` HTTP API (`src/board-ui.mjs`, wired into the single
> `http.createServer` via `handleWorkApi` in `src/setup-ui.mjs:120`) and the CLI's `work` dispatch
> (`workCommand` in `src/cli.mjs:189`, renderers `workListCommand`/`workValidateCommand`/`workNextCommand`
> ~537–628). Both faces already import the SAME core (`loadWorkspace, listStream, findWork, validateWork,
> nextWork`) from `src/work.mjs` — but via two independent call sites with no registry and no enforcement.
> The precedent is milestone 06 ADR-003's `resolveHeadroomLaunch` "one shared contract, two faces": this
> milestone generalizes that move from a single extension to the whole operation surface.

## ADR-001: The boundary model is CLI-as-contract over ONE shared in-process command core — NOT a per-request subprocess

**Status:** Accepted
**Date:** 2026-06-21

**Context.** Today the board API (`/api/work*`), the terminal WS, and the setup-UI API each `import`
aof's core modules **directly** (`STATE §Origin`: recon confirmed `work.mjs`/`terminal-providers.mjs`/
`headroom.mjs` are imported by the UI servers). They *share* the core library with the CLI, but nothing
routes "through the CLI" and nothing **enforces** that every UI capability has a CLI equivalent — so logic
can (and does) live in a UI server with no CLI form. Concretely on the first surface: 3 of the 6
`/api/work` operations (`doc`, `tasks`, `feedback`) are **bespoke server logic in `board-ui.mjs`** with no
CLI form at all, and the other 3 (`list`, `validate`, `next`) share a `work.mjs` export but via two
independent, unenforced call sites. The PO settled the boundary at framing (`STATE §PO decision 1`): one
**in-process** command core is the source of truth; the CLI and the UI server are both thin faces over it.
The alternative — a strict per-request subprocess boundary (the UI shells out to `aof …` per request and
parses stdout) — was considered and rejected for this milestone: it pays a spawn/serialize tax per request
and is awkward for the streaming seam that follows (`SPEC §Out of scope`).

**Decision.** The boundary is **CLI-as-contract over ONE shared in-process command core**. A single
in-process command registry is the source of truth for every operation; the CLI is a thin
`argv → command → result` face, and each UI server is a second thin `transport → command → result` face.
**Both call the SAME core in-process** — never a per-request subprocess. The contract that binds them is
structural, not procedural: it is enforced by fitness functions (ADR-004), not by routing every call
through a literal `aof` shell-out. The subprocess boundary is recorded as a *possible stricter
implementation of the very same command contract* in a later milestone (it would swap the in-process
`invoke(commandId, input)` for `spawn(aof, [commandId, --json])` behind the identical registry contract),
not a thing this milestone builds. The command contract is deliberately designed so that swap stays
additive: a command's input and result are plain serialisable data (ADR-002), so a subprocess face could
reproduce them over stdout without changing any command.

**Alternatives considered.**
- *Keep the status quo (shared core, two independent call sites, no registry)* — rejected: it is exactly
  the drift this milestone exists to invert. A shared library with no enforced bijection lets UI-only logic
  accrete (it already has: `doc`/`tasks`/`feedback`) and lets the two faces silently diverge.
- *Strict per-request subprocess boundary* — rejected for this milestone (`STATE §PO decision 1`,
  `SPEC §Out of scope`): per-request spawn/serialize tax, and awkward for the `/ws/terminal` streaming seam
  that follows. Recorded as the graduation path: the same command contract, a stricter face.
- *A network/RPC boundary (the UI calls a local aof daemon)* — rejected: heavier than the problem; the
  in-process registry already makes "every UI op is a registered command" structural without a transport.

**Consequences.** The command core is a new in-process module (ADR-002); the migration re-homes the
`/api/work` surface onto it (ADR-003) with the milestone-03 envelope preserved byte-for-byte; the
enforcement (ADR-004) is the load-bearing deliverable. Because the boundary is in-process, there is no
spawn tax and the streaming seam stays unblocked. A future subprocess milestone inherits the contract
unchanged.

**Invariant.** This is the framing ADR; its structural teeth live in ADR-002/003/004. The single concrete
guard it owns: no `/api/work*` request path spawns a subprocess to serve the operation (the boundary is
in-process). (Enforced by `acd-work-command-no-subprocess`, folded into the ADR-004 suite.)

## ADR-002: The command core is a registry of pure operations keyed by id; each command has a frozen `{ id, input, run, cli } → result` contract, and the bespoke `board-ui.mjs` logic moves INTO the commands

**Status:** Accepted
**Date:** 2026-06-21

**Context.** This is the spine of the milestone — the *one* place an operation's logic lives, that both
faces couple through (the generalization of 06 ADR-003's single `resolveHeadroomLaunch` from one extension
to the whole operation surface). The six `/api/work` operations split today into two shapes that this ADR
unifies: (a) three operations (`list`, `validate`, `next`) call a `work.mjs` export and then **shape** the
result for the wire — and the two faces shape it *differently* (the crux below); (b) three operations
(`doc`, `tasks`, `feedback`) are **bespoke logic in `board-ui.mjs`** (`handleDoc` reads `<dir>/<DOC>.md`
with ENOENT→`{present:false}`; `handleTasks` readdirs `<dir>/tasks/*.feature` and `parseFeature`-aggregates;
`handleFeedback`+`appendFeedbackBullet` resolve-exact and append one attributed bullet under the verbatim
`## Feedback (for retro)` heading) with **no CLI form**. For the contract to be the source of truth, both
shapes must become registered commands and the bespoke logic must move *out of the UI server and into the
command*, so both faces share it.

**The byte-for-byte crux (resolved here).** Comparing the two existing call sites:
- `list`: the CLI emits `JSON.stringify(listStream(workDir), null, 2)` (`cli.mjs:547`); the board emits
  `sendJson(200, await listStream(workDir))` (`board-ui.mjs:50`). **Same data** — the `listStream` array,
  whose `dir` field `listStream` already forward-slashes (`work.mjs:223`). Only the wire *formatting*
  differs (pretty 2-space vs compact). Formatting is a **face** concern.
- `validate`: the board emits `{ findings: [{ path: displayPath(projectRoot, p), problem }] }`
  (`board-ui.mjs:165`, paths **relative to `projectRoot`, forward-slashed**); the CLI emits a **bare array**
  `[{ path: path.relative(cwd, p), problem }]` (`cli.mjs:586`, **relative to `cwd`, OS separators**). They
  differ in BOTH the envelope (`{findings}` vs bare array) AND the path basis.
- `next`: the board does `{ ...result, path: displayPath(projectRoot, result.path) }` (`board-ui.mjs:176`);
  the CLI does `{ ...result, path: path.relative(cwd, result.path) }` (`cli.mjs:611`). Same core `result`
  object, divergent **path basis** only.

So the divergence between the two faces is entirely **(i) wire formatting** and **(ii) path-display basis
(`projectRoot` vs `cwd`) + separator** — both of which are *presentation*, not operation. **The command's
canonical result therefore carries the operation's data with paths as raw, basis-neutral absolutes (or,
for `list`, the `dir` exactly as `listStream` already emits it), and each face applies its own
path-display projection and formatting.** The board face projects against `projectRoot` with forward
slashes and JSON-stringifies compact — reproducing milestone 03's frozen envelope byte-for-byte
(ADR-003); the CLI face projects against `cwd` with `path.relative` and pretty-prints. Neither face is
"canonical over the other": the *command* is canonical, and path display is a declared face-level adapter.

**Decision.** A new in-process module **`src/command-core.mjs`** holds a **registry** of commands keyed by
string `id`. A command is the frozen shape below. The registry is the single export both faces import; the
operation bodies for `doc`/`tasks`/`feedback`/`validate`/`next`/`list` live in **`src/commands/*.mjs`**
(one module per command, registered into the core), and the bespoke `handleDoc`/`handleTasks`/
`handleFeedback`/`appendFeedbackBullet` logic and the `displayPath`/envelope shaping move **out of
`board-ui.mjs` into those command modules**. Each command's `run(input) → result` is a pure-ish operation
over `loadWorkspace`-resolved paths returning basis-neutral data; path-display projection is a face adapter
(`projectRoot`+slash for the board, `cwd`+`path.relative` for the CLI), NOT command logic.

**The locked command/result contract (frozen 2026-06-21):**

```js
// src/command-core.mjs — the in-process command registry. The single source of truth
// for every operation. Both faces import `getCommand`/`listCommands` and invoke `run`.
//
// A Command:
// {
//   id:     string,        // stable kebab id, the registry key, e.g. "work:list" / "work:doc"
//   input:  JSONSchema,    // the input contract (validated; the board maps query/body→input,
//                          // the CLI maps argv→input). Plain serialisable data only.
//   run:    async (input, ctx) => result,
//                          // ctx = { workspace } (the loadWorkspace result: { workDir, config,
//                          // projectRoot, configPath }). `run` performs the operation and returns
//                          // basis-NEUTRAL data: any filesystem path in `result` is a raw absolute
//                          // (or, for list, `dir` exactly as listStream emits it). NO displayPath,
//                          // NO cwd/projectRoot relativisation inside run — that is a face concern.
//   cli:    {              // the CLI face contract — every command HAS one (ADR-004 bijection).
//     argv:  (positionals, options) => input,   // argv → input
//     render:(result, faceCtx) => string,       // human render (the non-json CLI output)
//     // the --json form is the canonical result with the CLI path-projection applied (see below).
//   },
// }
//
// invoke(id, input, ctx) => result        // the in-process call both faces make.
// getCommand(id) / listCommands()         // registry access (ADR-004 enforces against these).
//
// PATH-DISPLAY PROJECTION is a FACE adapter, not command logic:
//   board face:  project(result) relativises raw paths to ctx.workspace.projectRoot AND forward-slashes
//                → reproduces the milestone-03 envelope byte-for-byte (ADR-003).
//   cli  --json: project(result) relativises raw paths to process.cwd() (path.relative, OS separators)
//                → reproduces today's `aof work <op> --json` byte-for-byte.
//
// THE SIX REGISTERED COMMANDS (work surface):
//   work:list      input {}                      → ListRow[]            (listStream; dir already slashed)
//   work:doc       input { ref, doc }            → { ref, doc, present, body }   (was handleDoc)
//   work:tasks     input { ref }                 → { ref, tasks: TaskAgg[] }     (was handleTasks)
//   work:validate  input { scope? }              → { findings: Finding[] }       (Finding.path = RAW abs)
//   work:next      input { scope? }              → NextResult                    (NextResult.path = RAW abs)
//   work:feedback  input { ref, note, actor?, refs? } → { ok, bullet }           (was handleFeedback; WRITE)
```

The `validate` result is wrapped `{ findings }` (the board's milestone-03 envelope shape) with each
`finding.path` left **raw absolute**; the board face slashes+relativises-to-projectRoot to reproduce its
frozen wire, and the CLI `--json` adapter relativises-to-cwd AND unwraps to the bare array it emits today
(ADR-003 records that the CLI's historical bare-array `--json` is preserved by the CLI adapter — the
*command* result is the richer `{findings}` envelope, and each face adapts). `next`/`list` results pass
through unwrapped; only the path-basis projection differs per face.

**Alternatives considered.**
- *Make the command emit the board's exact wire shape and have the CLI adapt down* — partially adopted:
  the command result IS the board's envelope *shape* (`{findings}`, raw paths), but path display stays a
  face adapter (raw-absolute in the result) rather than baking `projectRoot`+slashes into the command —
  because the CLI's basis is `cwd`, and a command that pre-projected to `projectRoot` would force the CLI
  to *un*-project, which is lossy on Windows separators. Basis-neutral raw paths let each face project
  losslessly. (Rejected the stronger "command emits board wire verbatim".)
- *Make the command emit the CLI's bare-array `--json` and have the board wrap* — rejected: the board's
  `{findings}` envelope is the milestone-03 frozen contract (richer); demoting the command result to the
  CLI's historical bare array would make the board re-wrap and lose the natural envelope as the canonical
  shape. The CLI's bare-array quirk is the *adapter's* job to preserve, not the contract's.
- *Leave `doc`/`tasks`/`feedback` as UI-only and register only `list`/`validate`/`next`* — rejected by the
  SPEC (`§Scope`, "the board UI consumes the same command contract the CLI exposes"): UI-only logic is the
  exact drift the milestone inverts. All six become commands with CLI forms.
- *One giant `commands.mjs` instead of `src/commands/*.mjs` + a registry* — rejected: a per-command module
  keeps each operation independently testable and reviewable and makes the registry a thin index; it
  mirrors the codebase's existing one-concern-per-module idiom (`work-memory.mjs`, `work-headroom.mjs`).

**Consequences.** Story 00 builds `src/command-core.mjs` + the six `src/commands/*.mjs`, moving the bespoke
`board-ui.mjs` logic in. The contract above is frozen the moment story 00 lands; stories 01/02 consume it
without further negotiation. `work.mjs`'s existing exports (`listStream`/`validateWork`/`nextWork`/
`findWork`) stay — the commands *call* them — so this is a re-home behind the registry, not a rewrite of the
core mechanics. The path-basis-as-face-adapter decision is what makes "byte-for-byte on BOTH faces"
simultaneously achievable (ADR-003).

## ADR-003: The `/api/work` migration is route→command with the milestone-03 envelope preserved byte-for-byte (incl. the error envelope, status codes, and the read-vs-write resolver distinction); the CLI gains thin `work doc`/`work tasks`/`work feedback` and rewires `list`/`validate`/`next` through the registry

**Status:** Accepted
**Date:** 2026-06-21

**Context.** The first surface must prove the architecture end-to-end while the board returns **byte-for-byte
what it does today** (`SPEC §Scope`; `STATE §Carry-forward`: "the board's `/api/work` envelope (03) must be
preserved byte-for-byte"). That envelope, frozen in milestone 03, includes more than the success bodies:
the **error envelope** `{ ok:false, error, code }` with `error.status ?? 500` status mapping
(`board-ui.mjs:78,315`); the specific status codes (`400` invalid-doc / missing-ref / missing-note /
unsupported-target; `404` ref-not-found / route-not-found; `413` payload-too-large; `200` on
absent-doc/absent-tasks); and — load-bearing — the **read-vs-write resolver distinction**: reads
(`doc`/`tasks`) use `resolveItem` (exact-ref-preferred but **slug fallback** tolerated), while the
`feedback` **write** uses `resolveItemExact` (**no slug fallback** — a typo'd/partial ref must `404`, never
append the bullet to the wrong item; `board-ui.mjs:281–295`). This distinction is the milestone-03
write-isolation invariant and must survive the migration intact.

**Decision.** Each `/api/work*` route becomes a thin `HTTP → command → result` adapter: the route maps
query/body → the command's `input`, calls `invoke(id, input, { workspace })`, and renders the result
through the **board face projection** (relativise-to-`projectRoot` + forward-slash + compact JSON) — which,
by ADR-002's basis-neutral result, reproduces the milestone-03 success envelope byte-for-byte. The error
envelope `{ ok:false, error, code }`, the status-code mapping, the 404-for-unknown-route, and the
`resolveItem` (read, slug-fallback) vs `resolveItemExact` (feedback write, exact-only) distinction are
**preserved as the commands' own contract**: the resolver choice moves *into* the command (`work:doc`/
`work:tasks` resolve with slug-fallback; `work:feedback` resolves exact-only), so both faces inherit it and
neither face can weaken it. On the CLI side: three **new thin subcommands** `work doc` / `work tasks` /
`work feedback` are added to `workCommand`'s dispatch (`cli.mjs:189`), each `argv → command → result →
render`/`--json`; and `work list` / `work validate` / `work next` are **rewired** to invoke the registry
(their existing `--json` and human renders become the command's CLI face adapter, preserving today's CLI
output byte-for-byte per ADR-002's CLI projection).

**The locked migration mapping (frozen 2026-06-21):**

```
ROUTE (board face)                    →  COMMAND          resolver        success envelope (board projection)
GET  /api/work/list                   →  work:list        —               ListRow[]                        (200)
GET  /api/work/doc?ref&doc            →  work:doc         resolveItem     { ref, doc, present, body }      (200; absent→present:false)
GET  /api/work/tasks?ref              →  work:tasks       resolveItem     { ref, tasks: [...] }            (200; absent tasks/→[])
GET  /api/work/validate?scope         →  work:validate    —               { findings:[{path,problem}] }    (200; path=projectRoot-rel, slashed)
GET  /api/work/next?scope             →  work:next        —               NextResult (path projectRoot-rel)(200)
POST /api/work/feedback {ref,note,..} →  work:feedback    resolveItemExact{ ok:true, bullet }              (200)

ERROR envelope (ALL routes, unchanged): { ok:false, error:<msg>, code:<code> }, HTTP status = error.status ?? 500.
  invalid-doc/missing-ref/missing-note/unsupported-target → 400 ; ref-not-found/not-found → 404 ;
  payload-too-large → 413 ; empty-json/malformed-json → 400.
The unknown-/api/work* route still 404s with { ok:false, error, code:"not-found" } (board-ui owns the response).

CLI face (new + rewired), each argv→command→result:
  NEW  aof work doc      <ref> <DOC> [--json]    (DOC ∈ {SPEC,STORY,VERIFICATION,RETROSPECTIVE})
  NEW  aof work tasks    <ref> [--json]
  NEW  aof work feedback <ref> --note "…" [--actor …] [--refs …]   (resolveItemExact; write)
  REWIRED aof work list / validate / next  → invoke the registry; --json + human render = the command's CLI adapter,
          byte-for-byte unchanged from today (cwd-relative paths, validate bare-array --json, pretty 2-space).
```

**Alternatives considered.**
- *Migrate only the three shared ops (`list`/`validate`/`next`) and leave `doc`/`tasks`/`feedback`
  bespoke in `board-ui.mjs`* — rejected: those three are precisely the UI-only logic the milestone exists
  to re-home; the bijection fitness function (ADR-004) would (correctly) fail. All six migrate.
- *Have the CLI shell out to the board, or vice versa* — rejected by ADR-001 (in-process, not subprocess).
- *Add the CLI `--json` shapes as NEW canonical and break the board envelope to match* — rejected: the
  board envelope is milestone-03 frozen and must not change (`STATE §Carry-forward`); the migration is a
  re-home, not a wire change. The face-adapter design (ADR-002) preserves both wires at once.
- *Fold the read/write resolver distinction into the route adapters (keep it in `board-ui.mjs`)* —
  rejected: if it lived in the face, the CLI `work feedback` could resolve differently (e.g. slug-fallback)
  and silently write to the wrong item — the exact bug the exact-resolver guards. It belongs in the
  command so BOTH faces inherit it.

**Consequences.** Story 02 (board face) reduces `board-ui.mjs` to route→`invoke`→project adapters with
**no operation logic left** (no `readFile`/`readdir`/`appendFile`/`parseFeature`/`displayPath` for the work
ops — those moved to commands in story 00). Story 01 (CLI face) adds three subcommands and rewires three.
The milestone-03 board behaviour (success bodies, error envelope, status codes, write-exactness) is
observable-unchanged — which makes the existing milestone-03 board tests (`test/board-api.test.mjs`,
`acd-board-write-isolation`) a free regression net on the migration. The observable end-to-end ("the board
still returns today's bytes", "`work feedback` appends one bullet") is a **task `.feature`** for stories
01/02, not a fitness function (it is behaviour over the real seam); the **structural** guarantees are
ADR-004's.

## ADR-004: The CLI-as-source-of-truth guarantee is THREE structural invariants — (a) every `/api/work*` route resolves to a registered command, (b) every registered command has a CLI invocation, (c) the UI face imports no work-core/operation module except through the registry — enforced as arch-tests

**Status:** Accepted
**Date:** 2026-06-21

**Context.** This is **the load-bearing deliverable** (`SPEC §Scope`: "the enforcing fitness function(s) …
the pattern is only durable if it is enforced"). The contract (ADR-002) and the migration (ADR-003) are
worthless if the next change can quietly add a UI route with no command, or a command the CLI can't run, or
re-import `work.mjs` directly into the UI server behind the registry's back. The guarantee is three
distinct structural facts — a **bijection** (UI op ↔ command, and command ↔ CLI form) plus an **import
guard** — and each becomes an arch-test in the house idiom (`test/arch/*`: Ajv-compile, source-grep with
the call-form-not-comment discipline, stand-up-and-prove via `serveSetupUi`, and CLI spawn-and-parse — as
in `acd-board-single-server`, `acd-command-namespace`, `acd-work-list-contract`). RED-until-built is the
correct state now: `src/command-core.mjs` and `src/commands/*` do not exist yet, so the tests reference
them and fail cleanly until story 00 lands.

**Decision.** Three invariants, four arch-tests (the bijection is two tests + the import guard + the
no-subprocess guard from ADR-001), all under `test/arch/`:

1. **Route→command surjection (no UI route without a command).** Every `/api/work*` HTTP route the board
   serves resolves to a `getCommand(id)` that exists in the registry. Proven structurally: enumerate the
   `pathname === "/api/work/<op>"` routes in `board-ui.mjs` (source-grep on the route literals) and assert
   each maps to a registered command id, AND behaviourally: stand up `serveSetupUi` and assert every route
   answers via the registry (a 200/4xx envelope), with `board-ui.mjs` carrying **no work-operation logic**
   of its own.

2. **Command→CLI injection (no command the CLI cannot run).** Every command in the registry has a non-null
   `cli` adapter AND a reachable `aof work <sub>` dispatch. Proven by importing the registry, asserting each
   command's `cli.argv`/`cli.render` are defined, and asserting `workCommand`'s dispatch (`cli.mjs`) has a
   branch for each command's subcommand (source-grep the dispatch + a CLI spawn-and-parse smoke for each:
   `aof work list/doc/tasks/validate/next/feedback --json` exits cleanly against a fixture stream).

3. **No UI-only core import (the registry is the only door).** The UI server surface (`board-ui.mjs`, and
   `setup-ui.mjs` for the work surface) imports **no** work-operation/core module (`./work.mjs`,
   `./feature-parse.mjs`, the `src/commands/*` bodies) **except** the command registry
   (`./command-core.mjs`) — and performs no work-operation filesystem call itself (no `readFile`/`readdir`/
   `appendFile`/`parseFeature` for the work ops). Proven by source-grep (comments/strings discounted via the
   call-form discipline the house tests use): `board-ui.mjs`'s only operation-bearing import is the
   registry; the `loadWorkspace, listStream, findWork, validateWork, nextWork` direct import (today
   `board-ui.mjs:16`) and the `parseFeature` import (`:17`) are gone.

4. **In-process boundary (ADR-001's guard).** No `/api/work*` serving path spawns a subprocess for the
   operation (`child_process.spawn`/`spawnSync`/`exec` of `aof`/the CLI). Proven by source-grep of
   `board-ui.mjs` for `spawn(`/`exec(` of an aof invocation — none.

These are **structural** (over the registry, the route table, the dispatch table, and the import surface),
so they belong here as fitness functions — NOT as task `.feature` scenarios. The *observable* counterparts
("the board returns milestone-03 bytes", "`work feedback` writes exactly one bullet", "`work tasks` lists a
story's scenarios") are behaviour over the real seam and belong in task `.feature` files authored by stories
01/02. (Mirrors milestone 06's closing split: ADR-003's degrade *table* is an arch-test; the wrapped session
*actually spawning* is a `.feature`.)

**Alternatives considered.**
- *Fold enforcement into ADR-002/003 with no standalone ADR* — rejected: the enforcement is the SPEC's
  named load-bearing deliverable; it earns its own ADR so the three invariants and their arch-test names are
  a single reviewable contract the fitness-functions table indexes.
- *Make the bijection a runtime assertion (throw at server boot if a route lacks a command)* — rejected: a
  boot-time throw catches it late and only when the server runs; an arch-test fails in CI on the diff that
  introduces the drift, which is the point of a fitness function. (A boot-time guard is a fine *belt* but
  not the *braces*.)
- *Enforce the import guard with a lint rule (no-restricted-imports) instead of an arch-test* — viable but
  rejected for house consistency: the codebase enforces import boundaries with `test/arch` source-greps
  (`acd-terminal-server-only`), and an arch-test can assert the *positive* (the registry import IS present)
  as well as the negative, which a deny-list lint cannot.

**Consequences.** Story 03 authors the four arch-tests against the **frozen** registry (story 00); they are
RED until 00 lands the core and 01/02 land the faces, then GREEN and load-bearing forever after. Any future
change that adds a `/api/work` route without a command, a command without a CLI form, or a direct
`work.mjs`/operation import into the UI server fails CI loudly. The guard generalises: when the follow-on
milestones migrate the `/ws/terminal` and setup-UI surfaces, the *same* three invariants extend to those
route tables and import surfaces (the arch-tests parameterise on the surface).

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is the correct state now: the command core (src/command-core.mjs) and the
     six commands (src/commands/*.mjs) do not exist yet; the migrated faces are not wired; the
     tests reference them so they fail cleanly until built. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **Route→command surjection.** Every `/api/work*` route the board serves resolves to a registered command id (`getCommand(id)` exists); `board-ui.mjs` enumerates exactly the six routes `list/doc/tasks/validate/next/feedback`, each backed by a command — no UI route without a command. | `test/arch/acd-work-command-route-coverage.test.mjs` (source-grep `board-ui.mjs` for the `pathname === "/api/work/<op>"` route literals → map each to a registry id and assert `getCommand(id)` is defined; behavioural: stand up `serveSetupUi` over a fixture stream like `acd-board-single-server` and assert each route answers a JSON envelope via the registry) | RED until `src/command-core.mjs` exports the registry and `board-ui.mjs` routes through it | ADR-004 (inv. 1), ADR-003 |
| **Command→CLI injection.** Every registered command has a non-null `cli` adapter (`cli.argv`/`cli.render` defined) AND a reachable `aof work <sub>` dispatch branch — no command the CLI cannot run. | `test/arch/acd-work-command-cli-bijection.test.mjs` (import the registry; assert each command's `cli` adapter is present; source-grep `workCommand` in `cli.mjs` for a dispatch branch per command subcommand; CLI spawn-and-parse `aof work {list,doc,tasks,validate,next,feedback} --json` against a fixture stream and assert clean exit + parseable JSON — the `acd-work-list-contract` spawn idiom, generalised to all six) | RED until the six commands register and `cli.mjs` dispatches `work doc`/`work tasks`/`work feedback` + rewires `list`/`validate`/`next` | ADR-004 (inv. 2), ADR-003 |
| **No UI-only core import (registry is the only door).** The UI-server surface (`board-ui.mjs`, the work paths of `setup-ui.mjs`) imports no work-core/operation module (`./work.mjs`, `./feature-parse.mjs`, the `src/commands/*` bodies) except `./command-core.mjs`, and runs no work-operation filesystem call itself (`readFile`/`readdir`/`appendFile`/`parseFeature` for the work ops are gone from `board-ui.mjs`). | `test/arch/acd-work-ui-no-core-import.test.mjs` (source-grep `board-ui.mjs` — call/import form, comments discounted per the house discipline — asserting the only operation-bearing import is `./command-core.mjs`; assert the `loadWorkspace, listStream, findWork, validateWork, nextWork` import from `./work.mjs` and the `parseFeature` import are ABSENT; assert no `appendFile`/`readdir`/feature-parse call remains; the import-boundary idiom of `acd-terminal-server-only`) | RED until story 02 strips the direct imports + bespoke logic from `board-ui.mjs` | ADR-004 (inv. 3), ADR-001 |
| **In-process boundary.** No `/api/work*` serving path spawns a subprocess to serve the operation — the boundary is in-process, not per-request subprocess. | `test/arch/acd-work-command-no-subprocess.test.mjs` (source-grep `board-ui.mjs` (comments discounted) for `child_process`/`spawn(`/`spawnSync(`/`exec(` of an `aof`/CLI invocation on the work-serving path → none) | GREEN now (no subprocess in `board-ui.mjs` today) and must STAY green — a regression guard that the migration honours the in-process boundary | ADR-004 (inv. 4), ADR-001 |
| **Board envelope preserved byte-for-byte (regression net, not a new test).** The milestone-03 `/api/work` success bodies, error envelope `{ok:false,error,code}`, status codes, and the read (`resolveItem`, slug-fallback) vs feedback-write (`resolveItemExact`, exact-only) resolver distinction are unchanged by the migration. | Existing milestone-03 tests `test/board-api.test.mjs` + `test/arch/acd-board-write-isolation.test.mjs` (kept green through the migration; the route→command re-home must not change observable bytes — these are the byte-for-byte net) | GREEN now and must STAY green across the migration (story 02's re-home is observably inert) | ADR-003 |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 06's split):
     - The BIJECTION and the IMPORT GUARD are true structural invariants over the registry / route table /
       dispatch table / import surface → arch-tests (this table). They are the milestone's load-bearing
       deliverable.
     - The OBSERVABLE end-to-end behaviours — "the board returns milestone-03 bytes for each route",
       "`aof work feedback` appends exactly one attributed bullet under the verbatim heading",
       "`aof work tasks <ref>` lists a story's scenarios with lane counts", "an unknown /api/work route
       404s" — belong in task .feature files authored by stories 01/02 (they exercise the real seam,
       the real filesystem, the real serveSetupUi), NOT here.
     - The path-display divergence (board → projectRoot+slash; CLI → cwd+OS-sep) is a FACE adapter
       (ADR-002), proven byte-for-byte by the existing milestone-03 board tests (board face) and the
       existing CLI --json tests (CLI face) staying green — not a new fitness function of its own. -->
